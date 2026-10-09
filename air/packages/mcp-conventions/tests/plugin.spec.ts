import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpConventions from '../src/index.ts'
import { ApprovalStore, approvalKey, defaultApprovalIo } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { provideWorkingDirectory, stubAgent } from './harness.ts'

interface Gate {
  /** Holds every `mcp-client` start until it settles. */
  hold?: Promise<void> | undefined
  /** Holds every `.mcp.json` read until it settles. */
  holdRead?: Promise<void> | undefined
  /** Makes the `mcp-client` plugin wait for a service nobody provides, so its fiber stays pending. */
  pendingFiber: boolean
  /** Makes the first `Scope.dispose` call return without disposing, as when a mount finishes just as it is stopped. */
  skipFirstDispose: boolean
  /** Makes `Scope.dispose` reject after it disposed. */
  disposeError?: string | undefined
  /** Number of `.mcp.json` reads begun. */
  reads: number
  /** Number of `mcp-client` starts. */
  started: number
}

const gate = vi.hoisted((): Gate => ({ pendingFiber: false, skipFirstDispose: false, reads: 0, started: 0 }))

// Wraps the real scope so a test can hold the client mount, count live scopes, and fail disposal.
vi.mock('@deepseek-ai/dsh-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-scope')>()
  return Object.assign({}, actual, {
    createScope(...args: Parameters<typeof actual.createScope>) {
      const scope = actual.createScope(...args)
      const dispose = scope.dispose.bind(scope)
      scope.dispose = async () => {
        if (gate.skipFirstDispose) {
          gate.skipFirstDispose = false
          return
        }
        await dispose()
        if (gate.disposeError !== undefined) throw new Error(gate.disposeError)
      }
      return scope
    },
  })
})

// Wraps the real file read so a test can dispose an Agent while its `.mcp.json` is being read.
vi.mock('@air/dsh-convention-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@air/dsh-convention-core')>()
  return Object.assign({}, actual, {
    async readContained(...args: Parameters<typeof actual.readContained>) {
      gate.reads += 1
      await gate.holdRead
      return actual.readContained(...args)
    },
  })
})

// Wraps the real client so a test can hold its start or leave it pending on a service nobody provides.
vi.mock('@deepseek-ai/dsh-mcp-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-mcp-client')>()
  const wrapped = Object.assign({}, actual, {
    async apply(...args: Parameters<typeof actual.apply>) {
      gate.started += 1
      await gate.hold
      return actual.apply(...args)
    },
  })
  return Object.defineProperty(wrapped, 'inject', {
    enumerable: true,
    get() { return gate.pendingFiber ? [...actual.inject, 'airNeverProvided'] : actual.inject },
  })
})

const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
const created: string[] = []
const contexts: Context[] = []

// A plain string selects the untyped `provide` overload: the reviewer service is declared by the MCP trust plan, not by this one.
const REVIEW_SERVICE: string = 'mcpToolReview'

afterEach(async () => {
  gate.hold = undefined
  gate.holdRead = undefined
  gate.pendingFiber = false
  gate.skipFirstDispose = false
  gate.disposeError = undefined
  gate.started = 0
  gate.reads = 0
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  approvalsFile: string
}

async function world(mcpJson?: unknown): Promise<World> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'air-mcp-')))
  created.push(base)
  const root = join(base, 'project')
  await mkdir(join(root, '.git'), { recursive: true })
  if (mcpJson !== undefined) {
    await writeFile(join(root, '.mcp.json'), typeof mcpJson === 'string' ? mcpJson : JSON.stringify(mcpJson))
  }
  return { root, approvalsFile: join(base, 'state', 'mcp-approvals.json') }
}

const demo = { mcpServers: { demo: { command: process.execPath, args: [echoServer] } } }

async function mount(approvalsFile: string, startupTimeoutMs = 15_000, extra: mcpConventions.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  provideWorkingDirectory(ctx)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(mcpConventions, Object.assign({ approvalsFile, startupTimeoutMs }, extra))
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined, now?: string): Promise<Agent> {
  const { agent } = stubAgent(ctx, cwd, now)
  await ctx.agents.register(agent)
  return agent
}

async function command(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
  return execution.result
}

function toolNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name)
}

async function approveInFile(approvalsFile: string, root: string, mcpJson: unknown): Promise<void> {
  const { servers } = parseMcpJson(JSON.stringify(mcpJson), { file: join(root, '.mcp.json'), cwd: root, env: process.env })
  for (const spec of servers) {
    await new ApprovalStore(approvalsFile).add(approvalKey(root, spec), {
      projectRoot: root,
      server: spec.serverName,
      approvedAt: '2026-10-01T00:00:00.000Z',
    })
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // Signal 0 throws ESRCH once the process has exited, on Windows as on POSIX.
    return false
  }
}

describe('air-mcp-conventions', () => {
  it('reads .mcp.json from the working directory, not the original session directory', async () => {
    const original = await world(demo)
    const current = await world({ mcpServers: { moved: { command: process.execPath, args: [echoServer] } } })
    const { ctx } = await mount(current.approvalsFile)
    const agent = await live(ctx, original.root, current.root)
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.text).toContain(`moved (stdio: ${process.execPath} ${echoServer}; cwd: ${current.root}): not approved`)
    expect(listed.text).not.toContain('demo')
  })

  it('does not start a project server that nobody approved', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.kind).toBe('success')
    expect(listed.text).toContain(`demo (stdio: ${process.execPath} ${echoServer}; cwd: ${root}): not approved`)
    expect(listed.text).toContain('/mcp approve <server>')
  })

  it('never spawns an unapproved or edited server process', async () => {
    const { root, approvalsFile } = await world()
    const base = dirname(root)
    const entry = (args: string[]) => ({ mcpServers: { demo: { command: process.execPath, args, env: { ECHO_PID_FILE: join(base, 'echo.pid') } } } })
    const approved = entry([echoServer])
    await approveInFile(approvalsFile, root, approved)
    // The approved definition changed after approval, so the stored approval no longer matches it.
    await writeFile(join(root, '.mcp.json'), JSON.stringify(entry([echoServer, '--changed'])))
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
    expect((await readdir(base)).filter(name => name.startsWith('echo.pid.'))).toEqual([])
  })

  it('approves, starts, and revokes a server for the calling Agent', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: 'Approved and started "demo".' })
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
    const result = await ctx.tools.execute({
      name: 'mcp__demo__echo',
      arguments: { text: 'hi' },
      callId: ToolCallId('air-mcp-call'),
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('echo: hi')
    expect((await command(ctx, agent, '/mcp')).text).toContain('): running')
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: '"demo" is already running.' })

    const second = await live(ctx, root)
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])

    expect(await command(ctx, agent, '/mcp revoke demo')).toEqual({
      kind: 'success',
      text: 'Revoked "demo"; its tools are removed from this session.',
    })
    expect(toolNames(ctx, agent)).toEqual([])
    expect(toolNames(ctx, second)).toEqual([])
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
    expect((await command(ctx, agent, '/mcp revoke demo')).kind).toBe('success')
  })

  it('stops server processes when the Agent is disposed and when the plugin unloads', async () => {
    const { root, approvalsFile } = await world()
    const base = dirname(root)
    const withPid = { mcpServers: { demo: { command: process.execPath, args: [echoServer], env: { ECHO_PID_FILE: join(base, 'echo.pid') } } } }
    await writeFile(join(root, '.mcp.json'), JSON.stringify(withPid))
    const pids = async (): Promise<number[]> => (await readdir(base))
      .filter(name => name.startsWith('echo.pid.'))
      .map(name => Number(name.slice('echo.pid.'.length)))
    await approveInFile(approvalsFile, root, withPid)
    const { ctx, fiber } = await mount(approvalsFile)
    const first = await live(ctx, root)
    const second = await live(ctx, root)
    const detached = await live(ctx, undefined)
    expect(toolNames(ctx, first)).toEqual(['mcp__demo__echo'])
    expect((await pids()).length).toBeGreaterThanOrEqual(2)
    ctx.emit('agent/disposed', { agent: first })
    ctx.emit('agent/disposed', { agent: detached })
    await vi.waitFor(() => { expect(toolNames(ctx, first)).toEqual([]) }, { timeout: 5000 })
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
    await fiber.dispose()
    expect(toolNames(ctx, second)).toEqual([])
    await vi.waitFor(async () => { expect((await pids()).some(isAlive)).toBe(false) }, { timeout: 5000 })
  })

  it('reports a server that fails to start, times out, or is unreachable', async () => {
    const servers = {
      mcpServers: {
        exits: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
        silent: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
        remote: { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      },
    }
    const { root, approvalsFile } = await world(servers)
    const { ctx } = await mount(approvalsFile, 500)
    const agent = await live(ctx, root)
    const exits = await command(ctx, agent, '/mcp approve exits')
    expect(exits.kind).toBe('error')
    expect(exits.text).toContain('Approved "exits", but it did not start: ')
    const silent = await command(ctx, agent, '/mcp approve silent')
    expect(silent).toEqual({ kind: 'error', text: 'Approved "silent", but it did not start: did not start within 500 ms' })
    expect((await command(ctx, agent, '/mcp approve remote')).kind).toBe('error')
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.text).toContain('): approved, not running')
    expect(listed.text).toContain('remote (streamable-http: http://127.0.0.1:1/mcp)')

    const next = await live(ctx, root)
    expect(toolNames(ctx, next)).toEqual([])
  })

  it('keeps the Agent usable when the approvals file is corrupt and says so in /mcp', async () => {
    const { root, approvalsFile } = await world(demo)
    await mkdir(dirname(approvalsFile), { recursive: true })
    await writeFile(approvalsFile, '{ truncated')
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.text).toContain('): not approved')
    expect(listed.text).toMatch(/Problem: the approvals file could not be read: /u)
    const again = (await command(ctx, agent, '/mcp')).text ?? ''
    expect(again.match(/Problem: the approvals file/gu)).toHaveLength(1)
  })

  it('does not fail Agent creation when the project file cannot be read', async () => {
    const { approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, join(tmpdir(), 'bad\0cwd'))
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('lists problems and projects without servers', async () => {
    const broken = await world('{ not json')
    const first = await mount(broken.approvalsFile)
    const agent = await live(first.ctx, broken.root)
    expect((await command(first.ctx, agent, '/mcp')).text).toContain(`Problem: ${join(broken.root, '.mcp.json')} is not valid JSON`)

    const empty = await world()
    const second = await mount(empty.approvalsFile)
    const other = await live(second.ctx, empty.root)
    expect((await command(second.ctx, other, '/mcp')).text).toContain(`No servers are declared in ${join(empty.root, '.mcp.json')}.`)
  })

  it('rejects unknown input and sessions whose .mcp.json was never read', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const usage = 'Usage: /mcp [approve <server> | revoke <server>]'
    expect(await command(ctx, agent, '/mcp start demo')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve demo extra')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve other')).toEqual({
      kind: 'error',
      text: `No server named "other" is declared in ${join(root, '.mcp.json')}. ${usage}`,
    })
    const { agent: detached } = stubAgent(ctx, root)
    expect(await command(ctx, detached, '/mcp')).toEqual({
      kind: 'error',
      text: 'No .mcp.json was read for this session: its working directory was not resolved when it was created.',
    })
  })
})

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const withPid = (base: string) => ({ mcpServers: { demo: { command: process.execPath, args: [echoServer], env: { ECHO_PID_FILE: join(base, 'echo.pid') } } } })

async function pidsIn(base: string): Promise<number[]> {
  return (await readdir(base)).filter(name => name.startsWith('echo.pid.')).map(name => Number(name.slice('echo.pid.'.length)))
}

describe('Agent lifecycle races', () => {
  it('starts nothing for an Agent disposed while its approvals are being read', async () => {
    const { root, approvalsFile } = await world()
    const spec = withPid(dirname(root))
    await writeFile(join(root, '.mcp.json'), JSON.stringify(spec))
    await approveInFile(approvalsFile, root, spec)
    const { ctx } = await mount(approvalsFile)
    const reading = deferred()
    const has = vi.spyOn(ApprovalStore.prototype, 'has').mockImplementation(async () => {
      await reading.promise
      return true
    })
    const { agent } = stubAgent(ctx, root)
    const registered = ctx.agents.register(agent)
    await vi.waitFor(() => { expect(has).toHaveBeenCalledTimes(1) })
    ctx.emit('agent/disposed', { agent })
    reading.resolve()
    await registered
    expect(gate.started).toBe(0)
    expect(toolNames(ctx, agent)).toEqual([])
    expect(await pidsIn(dirname(root))).toEqual([])
  })

  it('keeps no state for an Agent disposed while its .mcp.json is being read', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const reading = deferred()
    gate.holdRead = reading.promise
    const { agent } = stubAgent(ctx, root)
    const registered = ctx.agents.register(agent)
    await vi.waitFor(() => { expect(gate.reads).toBe(1) })
    ctx.emit('agent/disposed', { agent })
    reading.resolve()
    await registered
    expect((await command(ctx, agent, '/mcp')).text).toContain('No .mcp.json was read')
  })

  it('reads nothing for an Agent disposed while its project root is being found', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const { agent } = stubAgent(ctx, root)
    const registered = ctx.agents.register(agent)
    ctx.emit('agent/disposed', { agent })
    await registered
    expect(gate.reads).toBe(0)
  })

  it('starts nothing for an Agent whose plugin is disposed while its approvals are being read', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx, fiber } = await mount(approvalsFile)
    const reading = deferred()
    const has = vi.spyOn(ApprovalStore.prototype, 'has').mockImplementation(async () => {
      await reading.promise
      return true
    })
    const { agent } = stubAgent(ctx, root)
    const registered = ctx.agents.register(agent)
    await vi.waitFor(() => { expect(has).toHaveBeenCalledTimes(1) })
    await fiber.dispose()
    reading.resolve()
    await registered
    expect(gate.started).toBe(0)
  })

  it('stops a server whose Agent is disposed while the server is starting', async () => {
    const { root, approvalsFile } = await world()
    const spec = withPid(dirname(root))
    await writeFile(join(root, '.mcp.json'), JSON.stringify(spec))
    await approveInFile(approvalsFile, root, spec)
    const { ctx } = await mount(approvalsFile)
    const starting = deferred()
    gate.hold = starting.promise
    const { agent } = stubAgent(ctx, root)
    const registered = ctx.agents.register(agent)
    await vi.waitFor(() => { expect(gate.started).toBe(1) })
    ctx.emit('agent/disposed', { agent })
    starting.resolve()
    await registered
    expect(toolNames(ctx, agent)).toEqual([])
    await vi.waitFor(async () => { expect((await pidsIn(dirname(root))).some(isAlive)).toBe(false) }, { timeout: 5000 })
  })

  it('starts one client when the same server is approved twice at once', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const starting = deferred()
    gate.hold = starting.promise
    const add = vi.spyOn(ApprovalStore.prototype, 'add')
    const first = command(ctx, agent, '/mcp approve demo')
    const second = command(ctx, agent, '/mcp approve demo')
    await vi.waitFor(() => { expect(add.mock.settledResults.filter(result => result.type === 'fulfilled')).toHaveLength(2) })
    starting.resolve()
    expect((await first).kind).toBe('success')
    expect((await second).kind).toBe('success')
    expect(gate.started).toBe(1)
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
    expect(await command(ctx, agent, '/mcp revoke demo')).toMatchObject({ kind: 'success' })
  })

  it('leaves no server running when a server is revoked while it is starting', async () => {
    const { root, approvalsFile } = await world()
    const spec = withPid(dirname(root))
    await writeFile(join(root, '.mcp.json'), JSON.stringify(spec))
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const starting = deferred()
    gate.hold = starting.promise
    const approving = command(ctx, agent, '/mcp approve demo')
    await vi.waitFor(() => { expect(gate.started).toBe(1) })
    const revoking = command(ctx, agent, '/mcp revoke demo')
    starting.resolve()
    expect((await revoking).kind).toBe('success')
    const approved = await approving
    expect(approved.kind).toBe('error')
    expect(approved.text).toContain('Approved "demo", but it did not start: ')
    expect(approved.text).toContain('Approved "demo", but it did not start: ')
    expect(toolNames(ctx, agent)).toEqual([])
    await vi.waitFor(async () => { expect((await pidsIn(dirname(root))).some(isAlive)).toBe(false) }, { timeout: 5000 })
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
  })

  it('lets a revoke issued while an approval is still being written win', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const writing = deferred()
    const realRename = defaultApprovalIo.rename
    const rename = vi.spyOn(defaultApprovalIo, 'rename').mockImplementationOnce(async (from, to) => {
      await writing.promise
      await realRename(from, to)
    })
    const approving = command(ctx, agent, '/mcp approve demo')
    await vi.waitFor(() => { expect(rename).toHaveBeenCalledTimes(1) })
    const revoking = command(ctx, agent, '/mcp revoke demo')
    writing.resolve()
    expect((await revoking).kind).toBe('success')
    await approving
    expect(toolNames(ctx, agent)).toEqual([])
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
    const stored = JSON.parse(await readFile(approvalsFile, 'utf8')) as { approved: unknown }
    expect(stored.approved).toEqual({})
  })

  it('disposes a server that finished starting after it was stopped', async () => {
    const { root, approvalsFile } = await world()
    const spec = withPid(dirname(root))
    await writeFile(join(root, '.mcp.json'), JSON.stringify(spec))
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const starting = deferred()
    gate.hold = starting.promise
    gate.skipFirstDispose = true
    const approving = command(ctx, agent, '/mcp approve demo')
    await vi.waitFor(() => { expect(gate.started).toBe(1) })
    const revoking = command(ctx, agent, '/mcp revoke demo')
    starting.resolve()
    expect((await revoking).kind).toBe('success')
    expect(await approving).toEqual({
      kind: 'error',
      text: 'Approved "demo", but it did not start: it was stopped before it finished starting',
    })
    expect(toolNames(ctx, agent)).toEqual([])
    await vi.waitFor(async () => { expect((await pidsIn(dirname(root))).some(isAlive)).toBe(false) }, { timeout: 5000 })
  })

  it('logs one warning and no unhandled rejection when stopping a server fails', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx, fiber } = await mount(approvalsFile)
    const warn = vi.spyOn(ctx.logger, 'warn')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const agent = await live(ctx, root)
      await command(ctx, agent, '/mcp approve demo')
      gate.disposeError = 'dispose boom'
      ctx.emit('agent/disposed', { agent })
      await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1) })
      expect(warn).toHaveBeenCalledWith('air-mcp-conventions: stopping servers failed: dispose boom')
      const second = await live(ctx, root)
      await command(ctx, second, '/mcp approve demo')
      await fiber.dispose()
      expect(warn).toHaveBeenCalledTimes(2)
      await new Promise<void>((done) => { setTimeout(done, 5) })
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('discards servers still starting when the plugin is disposed', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx, fiber } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const starting = deferred()
    gate.hold = starting.promise
    const approving = command(ctx, agent, '/mcp approve demo')
    await vi.waitFor(() => { expect(gate.started).toBe(1) })
    const closing = fiber.dispose()
    starting.resolve()
    await closing
    expect((await approving).kind).toBe('error')
    expect(toolNames(ctx, agent)).toEqual([])
  })
})

describe('secrets and consent scope', () => {
  const canary = 'SECRET-CANARY-7c41'
  const secretServers = {
    mcpServers: {
      local: { command: process.execPath, args: [echoServer, '--token=${AIR_CANARY}'], env: { TOK: '${AIR_CANARY}', PLAIN: 'LIT-CANARY-1' } },
      remote: { type: 'http', url: 'http://127.0.0.1:1/${AIR_CANARY}', headers: { Authorization: 'Bearer ${AIR_CANARY}' } },
    },
  }

  function capture(ctx: Context): string[] {
    const lines: string[] = []
    for (const level of ['warn', 'info', 'error', 'debug'] as const) {
      vi.spyOn(ctx.logger, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')) })
    }
    return lines
  }

  it('keeps expanded values out of /mcp output and logs, approved or not', async () => {
    vi.stubEnv('AIR_CANARY', canary)
    const { root, approvalsFile } = await world(secretServers)
    const { ctx } = await mount(approvalsFile, 500)
    const lines = capture(ctx)
    const agent = await live(ctx, root)
    const before = (await command(ctx, agent, '/mcp')).text ?? ''
    expect(before).toContain('--token=${AIR_CANARY}')
    expect(before).toContain('env: TOK=${AIR_CANARY}, PLAIN=LIT-CANARY-1')
    expect(before).toContain('headers: Authorization=Bearer ${AIR_CANARY}')
    expect(before).toContain('http://127.0.0.1:1/${AIR_CANARY}')
    const approve = await command(ctx, agent, '/mcp approve remote')
    const approveLocal = await command(ctx, agent, '/mcp approve local')
    const after = (await command(ctx, agent, '/mcp')).text ?? ''
    const second = await live(ctx, root)
    const output = [before, approve.text, approveLocal.text, after, ...lines].join('\n')
    expect(second).toBeDefined()
    expect(output).not.toContain(canary)
  })

  it('scrubs expanded values from startup failure messages shown by /mcp', async () => {
    vi.stubEnv('AIR_CANARY', '/no/such/SECRET-CANARY-bin')
    const { root, approvalsFile } = await world({ mcpServers: { bad: { command: '${AIR_CANARY}' } } })
    const { ctx } = await mount(approvalsFile, 5000)
    const agent = await live(ctx, root)
    const result = await command(ctx, agent, '/mcp approve bad')
    expect(result.kind).toBe('error')
    expect(result.text).not.toContain('SECRET-CANARY')
  })

  it('does not echo malformed .mcp.json content in /mcp or logs', async () => {
    const { root, approvalsFile } = await world('{ "mcpServers": { "a": { "command": "FILE-CANARY-55", } } }')
    const { ctx } = await mount(approvalsFile)
    const lines = capture(ctx)
    const agent = await live(ctx, root)
    const text = (await command(ctx, agent, '/mcp')).text ?? ''
    expect(text).toContain(`${join(root, '.mcp.json')} is not valid JSON`)
    expect([text, ...lines].join('\n')).not.toContain('FILE-CANARY-55')
  })

  it('does not treat an approval from another working directory as approval', async () => {
    const { root, approvalsFile } = await world(demo)
    const sub = join(root, 'sub')
    await mkdir(sub)
    const { ctx } = await mount(approvalsFile)
    const inRoot = await live(ctx, root)
    expect((await command(ctx, inRoot, '/mcp approve demo')).kind).toBe('success')
    const store = JSON.parse(await readFile(approvalsFile, 'utf8')) as { approved: Record<string, { cwd?: string }> }
    expect(Object.values(store.approved).map(record => record.cwd)).toEqual([root])
    const inSub = await live(ctx, sub)
    expect(toolNames(ctx, inSub)).toEqual([])
    expect((await command(ctx, inSub, '/mcp')).text).toContain('): not approved')
    const again = await live(ctx, root)
    expect(toolNames(ctx, again)).toEqual(['mcp__demo__echo'])
  })

  it('ignores an approval recorded before the working directory joined the key', async () => {
    const { root, approvalsFile } = await world(demo)
    const spec = parseMcpJson(JSON.stringify(demo), { file: join(root, '.mcp.json'), cwd: root, env: process.env }).servers[0]
    if (spec === undefined) throw new Error('no spec')
    const old = createHash('sha256').update(JSON.stringify([root, spec.serverName, spec.definition])).digest('hex')
    await mkdir(dirname(approvalsFile), { recursive: true })
    await writeFile(approvalsFile, JSON.stringify({ version: 1, approved: { [old]: { projectRoot: root, server: 'demo', approvedAt: 'x' } } }))
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
  })

  it('stops a revoked server even when the approvals file cannot be rewritten', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    await command(ctx, agent, '/mcp approve demo')
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
    await writeFile(approvalsFile, '{ corrupt')
    const result = await command(ctx, agent, '/mcp revoke demo')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Stopped "demo"')
    expect(toolNames(ctx, agent)).toEqual([])
  })
})

describe('revoke and start-up ordering', () => {
  it('leaves no server running when a revoke lands between the startup approval check and the mount', async () => {
    const { root, approvalsFile } = await world()
    const spec = withPid(dirname(root))
    await writeFile(join(root, '.mcp.json'), JSON.stringify(spec))
    await approveInFile(approvalsFile, root, spec)
    const { ctx } = await mount(approvalsFile)
    const checking = deferred()
    const has = vi.spyOn(ApprovalStore.prototype, 'has').mockImplementationOnce(async () => {
      await checking.promise
      return true
    })
    const { agent } = stubAgent(ctx, root)
    const registered = ctx.agents.register(agent)
    await vi.waitFor(() => { expect(has).toHaveBeenCalledTimes(1) })
    const revoking = command(ctx, agent, '/mcp revoke demo')
    checking.resolve()
    expect((await revoking).kind).toBe('success')
    await registered
    expect(toolNames(ctx, agent)).toEqual([])
    await vi.waitFor(async () => { expect((await pidsIn(dirname(root))).some(isAlive)).toBe(false) }, { timeout: 5000 })
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
  })

  it('leaves nothing mounted or running when a server finishes starting after the startup timeout', async () => {
    const { root, approvalsFile } = await world()
    const spec = withPid(dirname(root))
    await writeFile(join(root, '.mcp.json'), JSON.stringify(spec))
    const { ctx } = await mount(approvalsFile, 50)
    const agent = await live(ctx, root)
    const starting = deferred()
    gate.hold = starting.promise
    const approving = command(ctx, agent, '/mcp approve demo')
    await vi.waitFor(() => { expect(gate.started).toBe(1) })
    // The timeout (50 ms) fires while the client plugin is still held; it is released only afterwards.
    await new Promise<void>((resolve) => { setTimeout(resolve, 150) })
    starting.resolve()
    expect(await approving).toEqual({ kind: 'error', text: 'Approved "demo", but it did not start: did not start within 50 ms' })
    await new Promise<void>((resolve) => { setTimeout(resolve, 300) })
    expect(toolNames(ctx, agent)).toEqual([])
    await vi.waitFor(async () => { expect((await pidsIn(dirname(root))).some(isAlive)).toBe(false) }, { timeout: 5000 })
  })

  it('stops a revoked server in every Agent of the project', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const first = await live(ctx, root)
    const second = await live(ctx, root)
    const sub = join(root, 'sub')
    await mkdir(sub)
    const elsewhere = await live(ctx, sub)
    expect((await command(ctx, elsewhere, '/mcp approve demo')).kind).toBe('success')
    expect((await command(ctx, first, '/mcp approve demo')).kind).toBe('success')
    expect((await command(ctx, second, '/mcp approve demo')).kind).toBe('success')
    expect(toolNames(ctx, first)).toEqual(['mcp__demo__echo'])
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
    expect((await command(ctx, first, '/mcp revoke demo')).kind).toBe('success')
    expect(toolNames(ctx, first)).toEqual([])
    expect(toolNames(ctx, second)).toEqual([])
    expect((await command(ctx, second, '/mcp')).text).toContain('): not approved')
    // A different working directory is a different approval, so that Agent keeps its server.
    expect(toolNames(ctx, elsewhere)).toEqual(['mcp__demo__echo'])
  })

  it('names the approvals file when approving fails because it is unreadable', async () => {
    const { root, approvalsFile } = await world(demo)
    await mkdir(dirname(approvalsFile), { recursive: true })
    await writeFile(approvalsFile, '{ corrupt')
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const result = await command(ctx, agent, '/mcp approve demo')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Could not approve "demo"')
    expect(result.text).toContain(approvalsFile)
    expect(toolNames(ctx, agent)).toEqual([])
  })
})

describe('reviewTools', () => {
  it('keeps a server pending until the MCP tool reviewer exists', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 500, { reviewTools: true })
    const agent = await live(ctx, root)
    const pending = await command(ctx, agent, '/mcp approve demo')
    expect(pending.kind).toBe('error')
    expect(pending.text).toContain('MCP tool reviewer')
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('fails at once, naming the reviewer, instead of waiting out the startup timeout', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 600_000, { reviewTools: true })
    const agent = await live(ctx, root)
    const began = Date.now()
    const pending = await command(ctx, agent, '/mcp approve demo')
    expect(Date.now() - began).toBeLessThan(10_000)
    expect(pending.kind).toBe('error')
    expect(pending.text).toContain('MCP tool reviewer service (mcpToolReview) is required and is not loaded')
    expect(pending.text).toContain('set reviewTools to false')
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('fails at once when a server plugin does not become active without a reviewer', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 600_000)
    const agent = await live(ctx, root)
    gate.pendingFiber = true
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({
      kind: 'error',
      text: 'Approved "demo", but it did not start: the server plugin did not become active',
    })
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('pins the active fiber state to the cordis release in use', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin({ name: 'air-fiber-probe', apply: () => {} })
    const state: number = fiber.state
    expect(state).toBe(mcpConventions.FIBER_ACTIVE)
  })

  it('starts the server once the MCP tool reviewer exists', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 15_000, { reviewTools: true })
    ctx.provide(REVIEW_SERVICE, {
      review: (request: { tools: readonly { definition: unknown }[]; instructions: string }) =>
        Promise.resolve({ tools: request.tools.map(entry => entry.definition), instructions: request.instructions }),
    })
    const agent = await live(ctx, root)
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: 'Approved and started "demo".' })
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
  })

  it('does not wait for a reviewer by default', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 500)
    const agent = await live(ctx, root)
    expect((await command(ctx, agent, '/mcp approve demo')).kind).toBe('success')
  })
})

describe('containment', () => {
  it.skipIf(process.platform === 'win32')('does not read a .mcp.json linked to a file outside the project', async () => {
    const { root, approvalsFile } = await world()
    await writeFile(join(root, '..', 'outside.json'), JSON.stringify(demo))
    await symlink(join(root, '..', 'outside.json'), join(root, '.mcp.json'))
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const text = (await command(ctx, agent, '/mcp')).text ?? ''
    expect(text).toContain(`Problem: ${join(root, '.mcp.json')} skipped: its real path is outside the allowed directory`)
    expect(text).not.toContain('demo')
  })

  it.skipIf(process.platform === 'win32')('reads a .mcp.json linked to a file inside the project', async () => {
    const { root, approvalsFile } = await world()
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config', 'servers.json'), JSON.stringify(demo))
    await symlink(join(root, 'config', 'servers.json'), join(root, '.mcp.json'))
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect((await command(ctx, agent, '/mcp')).text).toContain('demo (stdio:')
  })

  it('refuses an oversize .mcp.json', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 15_000, { maxFileBytes: 10 })
    const agent = await live(ctx, root)
    expect((await command(ctx, agent, '/mcp')).text).toContain('skipped: it is larger than 10 bytes')
  })
})

describe('resolveConfig', () => {
  it('applies defaults under the harness home', () => {
    const resolved = mcpConventions.resolveConfig({})
    expect(resolved.approvalsFile.endsWith(join('air', 'mcp-approvals.json'))).toBe(true)
    expect(resolved).toMatchObject({ startupTimeoutMs: 15000, toolCallTimeoutMs: 60000, projectRootMarkers: ['.git'], reviewTools: false, maxFileBytes: 262144 })
  })

  it('rejects invalid values', () => {
    expect(() => mcpConventions.resolveConfig({ startupTimeoutMs: 0 })).toThrow('startupTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ toolCallTimeoutMs: 1.5 })).toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ maxFileBytes: 0 })).toThrow('maxFileBytes must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
