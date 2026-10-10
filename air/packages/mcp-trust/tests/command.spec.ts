import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { McpToolReviewRequest } from '@deepseek-ai/dsh-mcp-client'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { TrustEngine } from '../src/engine.ts'
import * as trust from '../src/index.ts'
import { createTrustCommand } from '../src/command.ts'
import { lockKey, readLockfile, updateLockfile } from '../src/lockfile.ts'
import type { McpTool, ServerPolicy } from '../src/types.ts'
import { pinSurface } from '../src/verdict.ts'
import { sessionAgent } from './support/agent.ts'

const NOW = '2026-10-01T00:00:00.000Z'
const KEY_X = 'a1b2c3d4'.repeat(8)
const KEY_Y = 'a1b2c3d5'.repeat(8)
const A: McpTool = { name: 'a', description: 'Tool A.', inputSchema: { type: 'object' } }
const B: McpTool = { name: 'b', description: 'Tool B.', inputSchema: { type: 'object' } }
const ESC = String.fromCharCode(27)
const ENFORCE: ServerPolicy = {
  mode: 'enforce', onAdded: 'withhold', onChanged: 'reject-generation', onRemoved: 'accept', instructions: 'pin', deny: [], override: {},
}
const DEFAULTS = {
  mode: 'enforce', onAdded: 'withhold', onChanged: 'reject-generation', onRemoved: 'accept', instructions: 'pin', deny: [], override: {},
}

let dir: string
let lockPath: string
const contexts: Context[] = []

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'air-mcp-command-')))
  lockPath = join(dir, 'home', 'mcp-lock.json')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  // The audit writer finishes its last append after the plugin is disposed.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

async function world(withCommands = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withCommands) await ctx.plugin(CommandRuntime)
  await ctx.plugin(trust, {
    lockfile: lockPath,
    auditDir: join(dir, 'audit'),
    auditMaxBytes: 1_000_000,
    defaults: DEFAULTS,
    servers: {},
    denyUnreviewedMcpTools: true,
    maxPromptsPerServer: 1,
    minReverifyMs: 20,
    maxReverifyMs: 500,
    lockWaitMs: 2000,
    watchDebounceMs: 20,
    cliCommand: 'pnpm dsh --profile air-mcp',
    enrollOnApproval: false,
  })
  const agent: Agent = sessionAgent(Session.create(SessionId('session-command')))
  const reviewer = ctx.get('mcpToolReview')
  if (reviewer === undefined) throw new Error('mcpToolReview was not provided')
  const engine = ctx.get('mcpTrust')
  if (!(engine instanceof TrustEngine)) throw new Error('mcpTrust was not provided')
  /** Review a surface the way mcp-client does; a resync reviews the same surface again. */
  const observe = async (serverName: string, tools: McpTool[], reviewKey?: string, instructions = '') => {
    const resync = vi.fn()
    const request: McpToolReviewRequest = {
      serverName,
      ...reviewKey === undefined ? {} : { reviewKey },
      tools: tools.map(definition => ({ rawName: definition.name, publicName: `mcp__${serverName}__${definition.name}`, definition })),
      instructions,
      resync,
    }
    resync.mockImplementation(() => { void reviewer.review(request) })
    await reviewer.review(request)
    return resync
  }
  const run = async (line: string) => {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
    return execution.result
  }
  const surfaceHex = (serverName: string, reviewKey?: string): string =>
    (engine.observed(reviewKey === undefined ? { serverName } : { serverName, reviewKey })?.surfaceDigest ?? '').replace('sha256:', '')
  return { ctx, agent, engine, observe, run, surfaceHex }
}

const seedPin = (serverName: string, tools: McpTool[], reviewKey?: string) =>
  updateLockfile(lockPath, (doc) => { doc.servers[lockKey(serverName, reviewKey)] = pinSurface(tools, '', 'cli', NOW, reviewKey) }, 2000)

describe('registration', () => {
  it('registers /mcp-trust when a command registry exists', async () => {
    const { ctx, agent } = await world()
    expect(ctx.commands.list(agent).map(command => command.name)).toContain('mcp-trust')
  })

  it('loads without a command registry and registers the command when the registry arrives later', async () => {
    const { ctx, agent, engine } = await world(false)
    expect(engine.servers()).toEqual([])
    await ctx.plugin(CommandRuntime)
    await vi.waitFor(() => { expect(ctx.commands.list(agent).map(command => command.name)).toContain('mcp-trust') })
  })
})

describe('status', () => {
  it('lists observed servers and lockfile-only entries with state and tool count; bare command is status', async () => {
    await seedPin('pinned', [A, B])
    await seedPin('gone', [A, B], KEY_Y)
    const { observe, run } = await world()
    await observe('pinned', [A, B])
    await observe('fresh', [A])
    await observe('drifted', [A], KEY_X)
    await seedPin('drifted', [{ ...A, description: 'Old.' }], KEY_X)
    await observe('drifted', [A], KEY_X)
    const result = await run('/mcp-trust')
    expect(result.kind).toBe('success')
    const text = result.text ?? ''
    expect(text).toContain('pinned  -  approved  2 tools')
    expect(text).toContain('fresh  -  unpinned  1 tool')
    expect(text).toContain(`drifted  ${KEY_X.slice(0, 12)}  blocked pending review  1 tool  (1 changed tool (fields: description))`)
    expect(text).toContain(`gone  ${KEY_Y.slice(0, 12)}  pinned, not observed in this process  2 tools`)
    expect(await run('/mcp-trust status')).toEqual(result)
  })

  it('says so when nothing is known, and shows a failed review', async () => {
    const { run } = await world()
    expect((await run('/mcp-trust status')).text).toContain('no MCP servers were observed and the lockfile has no entries')
  })

  it('shows a server whose review failed, and refuses to diff-pin it', async () => {
    let broken = false
    const failing = new TrustEngine({
      config: {
        lockfile: lockPath, lockWaitMs: 2000, denyUnreviewedMcpTools: true, maxPromptsPerServer: 1, minReverifyMs: 20,
        maxReverifyMs: 60, cliCommand: 'cli', enrollOnApproval: false,
        policyOf: () => {
          if (broken) throw new Error('policy exploded')
          return ENFORCE
        },
      },
      logger: { warn: () => {}, error: () => {} },
      now: () => new Date(NOW),
      drift: () => {},
    })
    const handler = createTrustCommand(failing)
    const request = { serverName: 'bad', tools: [{ rawName: 'a', publicName: 'mcp__bad__a', definition: A }], instructions: '', resync: () => {} }
    await failing.review(request)
    broken = true
    await failing.review(request)
    expect((await handler({ rawInput: ' status' })).text).toContain('bad  -  review failed')
    expect((await handler({ rawInput: 'diff bad' })).text).toContain('cannot be pinned')
    const pinned = await handler({ rawInput: 'pin bad --surface aaaaaaaa' })
    expect(pinned.kind).toBe('error')
    expect(pinned.text).toContain('its review failed')
    expect(pinned.text).toContain('policy exploded')
    failing.dispose()
  })

  it('reports an unreadable lockfile with the reason', async () => {
    const { observe, run } = await world()
    await observe('srv', [A])
    await writeFile(lockPath, '{not json')
    const result = await run('/mcp-trust status')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('lockfile unreadable')
    expect(result.text).toContain('srv  -  lockfile unreadable')
  })

  it('shows control characters of a server name escaped', async () => {
    const { observe, run } = await world()
    await observe(`ev${ESC}[2Jil`, [A])
    const text = (await run('/mcp-trust')).text ?? ''
    expect(text).not.toContain(ESC)
    expect(text).toContain('ev<U+001B>[2Jil')
  })
})

describe('diff', () => {
  it('prints the field-level difference and ends with the exact pin command for a keyless server', async () => {
    await seedPin('srv', [A])
    const { observe, run, surfaceHex } = await world()
    await observe('srv', [{ ...A, description: 'Changed.' }])
    const result = await run('/mcp-trust diff srv')
    expect(result.kind).toBe('success')
    const lines = (result.text ?? '').split('\n')
    expect(result.text).toContain('~ changed a (description)')
    expect(lines.at(-1)).toBe(`/mcp-trust pin srv --surface ${surfaceHex('srv').slice(0, 12)}`)
  })

  it('shows the definitions of an unpinned server before the pin command, one item per line', async () => {
    const { observe, run, surfaceHex } = await world()
    const echo: McpTool = {
      name: 'echo', description: `Echo "text".\n${ESC}[2J`, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }
    await observe('srv', [echo, B], undefined, 'Be careful.')
    const lines = ((await run('/mcp-trust diff srv')).text ?? '').split('\n')
    expect(lines).toContain('  + added   echo')
    expect(lines).toContain('      description: "Echo \\"text\\".<U+000A><U+001B>[2J"')
    expect(lines).toContain('      input:       text: string (required)')
    expect(lines).toContain('      description: "Tool B."')
    expect(lines).toContain('  instructions: "Be careful."')
    expect(lines.at(-2)).toBe('To approve exactly this surface, run:')
    expect(lines.at(-1)).toBe(`/mcp-trust pin srv --surface ${surfaceHex('srv').slice(0, 12)}`)
  })

  it('puts the key into the pin command of a keyed server', async () => {
    const { observe, run, surfaceHex } = await world()
    await observe('srv', [A], KEY_X)
    const lines = ((await run(`/mcp-trust diff srv --key ${KEY_X.slice(0, 8)}`)).text ?? '').split('\n')
    expect(lines.at(-1)).toBe(`/mcp-trust pin srv --key ${KEY_X.slice(0, 12)} --surface ${surfaceHex('srv', KEY_X).slice(0, 12)}`)
  })

  it('offers no pin command for an approved server', async () => {
    await seedPin('srv', [A])
    const { observe, run } = await world()
    await observe('srv', [A])
    const text = (await run('/mcp-trust diff srv')).text ?? ''
    expect(text).toContain('already approved')
    expect(text).not.toContain('/mcp-trust pin')
  })

  it('offers no pin command when the surface cannot be pinned', async () => {
    const { observe, run } = await world()
    await observe('srv', [{ name: 'a', inputSchema: { type: 'object', x: Number.NaN } }])
    const text = (await run('/mcp-trust diff srv')).text ?? ''
    expect(text).toContain('cannot be pinned')
    expect(text).not.toContain('/mcp-trust pin')
  })

  it('refuses a server that was not observed and a lockfile-only entry', async () => {
    await seedPin('ghost', [A])
    const { run } = await world()
    expect((await run('/mcp-trust diff ghost'))).toMatchObject({ kind: 'error' })
    expect((await run('/mcp-trust diff ghost')).text).toContain('not observed in this process')
  })
})

describe('pin', () => {
  it('pins the observed surface under its lock key with identity and approvedBy command, then the tools register', async () => {
    const { engine, observe, run, surfaceHex } = await world()
    const resync = await observe('srv', [A, B], KEY_X)
    expect(engine.guard('mcp__srv__a')).toContain('/mcp-trust diff srv --key')
    const result = await run(`/mcp-trust pin srv --key ${KEY_X.slice(0, 8)} --surface ${surfaceHex('srv', KEY_X).slice(0, 12)}`)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('2 tools pinned')
    const entry = (await readLockfile(lockPath)).servers[lockKey('srv', KEY_X)]
    expect(entry?.identity).toBe(KEY_X)
    expect(Object.values(entry?.tools ?? {}).map(tool => tool.approvedBy)).toEqual(['command', 'command'])
    expect(resync).toHaveBeenCalled()
    await vi.waitFor(() => { expect(engine.guard('mcp__srv__a')).toBeUndefined() })
    expect(engine.observed({ serverName: 'srv', reviewKey: KEY_X })?.state).toBe('approved')
  })

  it('refuses a stale surface prefix, pins nothing, and tells the person to diff again', async () => {
    const { engine, observe, run, surfaceHex } = await world()
    await observe('srv', [A])
    const stale = surfaceHex('srv').slice(0, 12)
    await observe('srv', [A, B])
    const result = await run(`/mcp-trust pin srv --surface ${stale}`)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('surface changed')
    expect(result.text).toContain('/mcp-trust diff srv')
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(engine.guard('mcp__srv__a')).toBeDefined()
  })

  it('refuses without --surface and points to diff', async () => {
    const { observe, run } = await world()
    await observe('srv', [A])
    const result = await run('/mcp-trust pin srv')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('--surface')
    expect(result.text).toContain('/mcp-trust diff srv')
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['abc', 'zzzzzzzzzz'])('refuses a surface prefix %s that is not at least 8 hex characters', async (prefix) => {
    const { observe, run } = await world()
    await observe('srv', [A])
    const result = await run(`/mcp-trust pin srv --surface ${prefix}`)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('at least 8 hexadecimal characters')
  })

  it('refuses a lockfile-only entry and a surface that cannot be pinned', async () => {
    await seedPin('ghost', [A])
    const { observe, run } = await world()
    expect((await run('/mcp-trust pin ghost --surface aaaaaaaa')).text).toContain('not observed in this process')
    await observe('bad', [{ name: 'a', inputSchema: { type: 'object', x: Number.NaN } }])
    const result = await run('/mcp-trust pin bad --surface aaaaaaaa')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('cannot be pinned')
  })

  it('refuses when the lockfile is unreadable and writes nothing', async () => {
    const { observe, run, surfaceHex } = await world()
    await observe('srv', [A])
    const hex = surfaceHex('srv').slice(0, 12)
    await writeFile(lockPath, '{not json')
    const result = await run(`/mcp-trust pin srv --surface ${hex}`)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('lockfile')
    expect(await readFile(lockPath, 'utf8')).toBe('{not json')
  })

  it('reports zero tools when another process removed the entry right after the pin', async () => {
    const { engine, observe, run, surfaceHex } = await world()
    await observe('srv', [A])
    vi.spyOn(engine, 'pin').mockResolvedValue()
    const result = await run(`/mcp-trust pin srv --surface ${surfaceHex('srv').slice(0, 12)}`)
    expect(result.text).toContain('0 tools pinned')
  })

  it('turns a failed write into an error result', async () => {
    const { engine, observe, run, surfaceHex } = await world()
    await observe('srv', [A])
    vi.spyOn(engine, 'pin').mockRejectedValue(new Error('disk full'))
    const result = await run(`/mcp-trust pin srv --surface ${surfaceHex('srv').slice(0, 12)}`)
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.text).toContain('disk full')
  })
})

describe('server resolution', () => {
  it('requires --key when several servers share a name and lists the candidates', async () => {
    const { observe, run } = await world()
    await observe('srv', [A], KEY_X)
    await observe('srv', [A], KEY_Y)
    await observe('srv', [A])
    const result = await run('/mcp-trust diff srv')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('--key')
    expect(result.text).toContain(`srv  key ${KEY_X.slice(0, 12)}`)
    expect(result.text).toContain(`srv  key ${KEY_Y.slice(0, 12)}`)
    expect(result.text).toContain('srv  key -')
  })

  it('selects the keyless server with --key - and a keyed one by prefix', async () => {
    const { observe, run } = await world()
    await observe('srv', [A], KEY_X)
    await observe('srv', [A])
    expect((await run('/mcp-trust diff srv --key -')).text).not.toContain('(key')
    expect((await run(`/mcp-trust diff srv --key ${KEY_X.slice(0, 8)}`)).text).toContain(`(key ${KEY_X.slice(0, 12)})`)
    expect((await run('/mcp-trust diff srv --key=-')).kind).toBe('success')
  })

  it('refuses a too-short, unknown, or ambiguous key prefix', async () => {
    const { observe, run } = await world()
    const sibling = `${KEY_X.slice(0, 9)}f${KEY_X.slice(10)}`
    await observe('srv', [A], KEY_X)
    await observe('srv', [A], sibling)
    const short = await run(`/mcp-trust diff srv --key ${KEY_X.slice(0, 7)}`)
    expect(short.kind).toBe('error')
    expect(short.text).toContain('at least 8 hexadecimal characters')
    const none = await run('/mcp-trust diff srv --key ffffffff')
    expect(none.text).toContain('no server named "srv" has a key starting with ffffffff')
    expect(none.text).toContain(`srv  key ${KEY_X.slice(0, 12)}`)
    const both = await run(`/mcp-trust diff srv --key ${KEY_X.slice(0, 8)}`)
    expect(both.kind).toBe('error')
    expect(both.text).toContain('matches 2 servers named "srv"')
    expect((await run(`/mcp-trust diff srv --key ${KEY_X.slice(0, 12)}`)).kind).toBe('success')
    expect((await run('/mcp-trust diff other --key ffffffff')).text).toContain('no server named "other" is known')
  })

  it('refuses --key - when every server of that name has a key', async () => {
    const { observe, run } = await world()
    await observe('srv', [A], KEY_X)
    expect((await run('/mcp-trust diff srv --key -')).text).toContain('is without a key')
    expect((await run('/mcp-trust diff other --key -')).text).toContain('no server named "other" is known')
  })

  it('lists known servers for an unknown name', async () => {
    await seedPin('known', [A], KEY_X)
    const { observe, run } = await world()
    await observe('seen', [A])
    const result = await run('/mcp-trust diff nothing')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no server named "nothing"')
    expect(result.text).toContain('seen  key -')
    expect(result.text).toContain(`known  key ${KEY_X.slice(0, 12)}`)
  })

  it('says that no servers are known when there are none', async () => {
    const { run } = await world()
    expect((await run('/mcp-trust diff nothing')).text).toContain('No servers are known')
  })

  it('treats a lockfile entry and an observation of the same definition as one candidate', async () => {
    await seedPin('srv', [A], KEY_X)
    const { observe, run } = await world()
    await observe('srv', [A], KEY_X)
    expect((await run('/mcp-trust diff srv')).kind).toBe('success')
  })

  it('still resolves observed servers when the lockfile is unreadable', async () => {
    const { observe, run } = await world()
    await observe('srv', [A])
    await writeFile(lockPath, '{not json')
    const result = await run('/mcp-trust diff srv')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('unreadable')
  })
})

describe('revoke', () => {
  it('removes the pin, re-syncs, and the tools unregister', async () => {
    await seedPin('srv', [A], KEY_X)
    const { engine, observe, run } = await world()
    const resync = await observe('srv', [A], KEY_X)
    expect(engine.guard('mcp__srv__a')).toBeUndefined()
    const result = await run(`/mcp-trust revoke srv --key ${KEY_X.slice(0, 8)}`)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Revoked')
    expect(Object.keys((await readLockfile(lockPath)).servers[lockKey('srv', KEY_X)]?.tools ?? {})).toEqual([])
    expect(resync).toHaveBeenCalled()
    await vi.waitFor(() => { expect(engine.observed({ serverName: 'srv', reviewKey: KEY_X })?.state).toBe('withheld') })
    expect(engine.guard('mcp__srv__a')).toBeDefined()
  })

  it('revokes a lockfile-only entry', async () => {
    await seedPin('gone', [A])
    const { run } = await world()
    expect((await run('/mcp-trust revoke gone')).kind).toBe('success')
    expect((await readLockfile(lockPath)).servers['gone']?.tools).toEqual({})
  })

  it('turns a failed write into an error result', async () => {
    await seedPin('srv', [A])
    const { engine, observe, run } = await world()
    await observe('srv', [A])
    vi.spyOn(engine, 'revoke').mockRejectedValue('disk full')
    const result = await run('/mcp-trust revoke srv')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('could not revoke "srv": disk full')
  })

  it('refuses when there is no pin to revoke', async () => {
    const { observe, run } = await world()
    await observe('srv', [A])
    await updateLockfile(lockPath, () => {}, 2000)
    const result = await run('/mcp-trust revoke srv')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no pin')
  })

  it('refuses when the lockfile is unreadable', async () => {
    const { observe, run } = await world()
    await observe('srv', [A])
    await writeFile(lockPath, '{not json')
    const result = await run('/mcp-trust revoke srv')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('lockfile')
  })
})

describe('usage', () => {
  it('never throws: an unexpected failure becomes an error result', async () => {
    const { engine, run } = await world()
    vi.spyOn(engine, 'servers').mockImplementation(() => { throw new Error('engine down') })
    const result = await run('/mcp-trust')
    expect(result).toEqual({ kind: 'error', text: '/mcp-trust failed: engine down' })
  })

  it.each([
    '/mcp-trust bogus',
    '/mcp-trust diff',
    '/mcp-trust diff a b',
    '/mcp-trust diff srv --bogus x',
    '/mcp-trust diff srv --key',
    '/mcp-trust pin srv --surface',
    '/mcp-trust status extra',
    '/mcp-trust revoke srv --surface aaaaaaaa',
  ])('answers %s with the usage text as an error', async (line) => {
    const { run } = await world()
    const result = await run(line)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Usage: /mcp-trust')
  })
})
