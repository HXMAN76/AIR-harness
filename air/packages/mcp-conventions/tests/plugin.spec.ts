import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { stubAgent } from './harness.ts'

const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
const created: string[] = []
const contexts: Context[] = []

// A plain string selects the untyped `provide` overload: the reviewer service is declared by the MCP trust plan, not by this one.
const REVIEW_SERVICE: string = 'mcpToolReview'

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  approvalsFile: string
}

async function world(mcpJson?: unknown): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-mcp-'))
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
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(mcpConventions, Object.assign({ approvalsFile, startupTimeoutMs }, extra))
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined): Promise<Agent> {
  const { agent } = stubAgent(ctx, cwd)
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
  const { servers } = parseMcpJson(JSON.stringify(mcpJson), { cwd: root, env: process.env })
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
  it('does not start a project server that nobody approved', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.kind).toBe('success')
    expect(listed.text).toContain(`demo (stdio: ${process.execPath} ${echoServer}): not approved`)
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
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
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
    expect((await command(first.ctx, agent, '/mcp')).text).toMatch(/Problem: \.mcp\.json is not valid JSON/u)

    const empty = await world()
    const second = await mount(empty.approvalsFile)
    const other = await live(second.ctx, empty.root)
    expect((await command(second.ctx, other, '/mcp')).text).toContain(`No servers are declared in ${join(empty.root, '.mcp.json')}.`)
  })

  it('rejects unknown input and sessions without a working directory', async () => {
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
    const detached = await live(ctx, undefined)
    expect(await command(ctx, detached, '/mcp')).toEqual({
      kind: 'error',
      text: 'This session has no working directory, so no .mcp.json was read.',
    })
  })
})

describe('reviewTools', () => {
  it('keeps a server pending until the MCP tool reviewer exists', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 500, { reviewTools: true })
    const agent = await live(ctx, root)
    const pending = await command(ctx, agent, '/mcp approve demo')
    expect(pending.kind).toBe('error')
    expect(pending.text).toContain('did not start within 500 ms')
    expect(pending.text).toContain('MCP tool reviewer')
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('starts the server once the MCP tool reviewer exists', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 15_000, { reviewTools: true })
    ctx.provide(REVIEW_SERVICE, {})
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

describe('resolveConfig', () => {
  it('applies defaults under the harness home', () => {
    const resolved = mcpConventions.resolveConfig({})
    expect(resolved.approvalsFile.endsWith(join('air', 'mcp-approvals.json'))).toBe(true)
    expect(resolved).toMatchObject({ startupTimeoutMs: 15000, toolCallTimeoutMs: 60000, projectRootMarkers: ['.git'], reviewTools: false })
  })

  it('rejects invalid values', () => {
    expect(() => mcpConventions.resolveConfig({ startupTimeoutMs: 0 })).toThrow('startupTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ toolCallTimeoutMs: 1.5 })).toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
