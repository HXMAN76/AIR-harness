import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lockKey } from '../src/lockfile.ts'
import type { McpToolReviewRequest } from '@deepseek-ai/dsh-mcp-client'
import {
  blockedReason, describeDiff, TrustEngine, type DriftRecord, type EngineConfig,
} from '../src/engine.ts'
import { readLockfile, updateLockfile } from '../src/lockfile.ts'
import { emptyDiff } from '../src/verdict.ts'
import type { McpTool, ObservedSurface, ServerPolicy } from '../src/types.ts'
import { pinSurface, withTools } from '../src/verdict.ts'

const NOW = new Date('2026-09-30T00:00:00.000Z')
const LONE_SURROGATE = String.fromCharCode(0xd800)
const A: McpTool = { name: 'a', description: 'Tool A.', inputSchema: { type: 'object' } }
const B: McpTool = { name: 'b', description: 'Tool B.', inputSchema: { type: 'object' } }

const ENFORCE: ServerPolicy = {
  mode: 'enforce', onAdded: 'withhold', onChanged: 'reject-generation', onRemoved: 'accept',
  instructions: 'pin', deny: [], override: {},
}

const CLI = 'pnpm dsh --profile air-mcp'
const KEY_X = 'a'.repeat(64)
const KEY_Y = 'b'.repeat(64)
const S = { serverName: 'srv' }
const R = { srv: S, ghost: { serverName: 'ghost' }, other: { serverName: 'other' } }

let dir: string
let lockfile: string
let warns: string[]
let errors: string[]
let drifts: DriftRecord[]
const engines: TrustEngine[] = []

function engine(config: Partial<EngineConfig> = {}, now: () => Date = () => NOW): TrustEngine {
  const created = new TrustEngine({
    config: {
      lockfile, lockWaitMs: 2000, denyUnreviewedMcpTools: true, maxPromptsPerServer: 1,
      minReverifyMs: 20, maxReverifyMs: 60, cliCommand: CLI, enrollOnApproval: false, policyOf: () => ENFORCE, ...config,
    },
    logger: { warn: message => warns.push(message), error: message => errors.push(message) },
    now,
    drift: record => drifts.push(record),
  })
  engines.push(created)
  return created
}

function request(tools: McpTool[], extra: Partial<McpToolReviewRequest> = {}) {
  const resync = vi.fn()
  const value: McpToolReviewRequest = {
    serverName: 'srv',
    tools: tools.map(definition => ({ rawName: definition.name, publicName: `mcp__srv__${definition.name}`, definition })),
    instructions: '',
    resync,
    ...extra,
  }
  return { value, resync }
}

const pin = (tools: McpTool[], instructions = '') =>
  updateLockfile(lockfile, (doc) => { doc.servers['srv'] = pinSurface(tools, instructions, 'cli', NOW.toISOString()) }, 2000)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'air-mcp-engine-'))
  lockfile = join(dir, 'mcp-lock.json')
  warns = []
  errors = []
  drifts = []
})

afterEach(async () => {
  for (const created of engines.splice(0)) created.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('review', () => {
  it('registers a pinned surface and lets its calls through', async () => {
    await pin([A, B], 'Use carefully.')
    const trust = engine()
    const verdict = await trust.review(request([A, B], { instructions: 'Use carefully.' }).value)
    expect(verdict).toEqual({ tools: [A, B], instructions: 'Use carefully.' })
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
    expect(trust.servers()).toEqual([S])
    expect(trust.observed(S)).toMatchObject({
      serverName: 'srv', state: 'approved', action: 'accept', withheld: [], observedAt: NOW.getTime(),
      pinnedDigest: (await readLockfile(lockfile)).servers['srv']?.surfaceDigest,
    })
    expect(trust.verify()).toHaveLength(1)
    expect(trust.verify(R.srv)).toHaveLength(1)
    expect(trust.verify(R.other)).toEqual([])
    expect(trust.surfaces()).toHaveLength(1)
    expect(drifts).toEqual([])
  })

  it('registers nothing for an unpinned server and denies its calls', async () => {
    const trust = engine()
    expect(await trust.review(request([A]).value)).toEqual({ tools: [], instructions: '' })
    expect(trust.observed(S)?.state).toBe('unpinned')
    expect(trust.observed(S)?.pinnedDigest).toBeUndefined()
    const denial = trust.guard('mcp__srv__a')
    expect(denial).toContain('server "srv"')
    expect(denial).toContain('no approved pin yet (1 added tool)')
    expect(denial).toContain(`\`${CLI} diff srv\``)
    expect(denial).toContain(`\`${CLI} pin srv\``)
    expect(denial).toContain('An allow rule never approves a server.')
    expect(trust.guard('mcp__other__a')).toContain('was not registered through trust review')
    expect(trust.guard('read_file')).toBeUndefined()
    expect(engine({ denyUnreviewedMcpTools: false }).guard('mcp__srv__a')).toBeUndefined()
    expect(drifts).toEqual([{ serverName: 'srv', added: ['a'], removed: [], changed: [], instructionsChanged: false, action: 'withhold' }])
    expect(warns.some(line => line.includes('1 added, 0 removed, 0 changed'))).toBe(true)
  })

  it('unregisters the previous generation when a pinned tool changes', async () => {
    await pin([A, B])
    const trust = engine()
    await trust.review(request([A, B]).value)
    const verdict = await trust.review(request([{ ...A, description: 'Changed.' }, B]).value)
    expect(verdict).toEqual({ tools: [], instructions: '' })
    expect(trust.observed(S)).toMatchObject({ state: 'quarantined', action: 'reject-generation' })
    const denial = trust.guard('mcp__srv__b')
    expect(denial).toContain('blocked server "srv": it differs from its pin: 1 changed tool (fields: description)')
    expect(denial).not.toContain('Changed.')
    expect(drifts.at(-1)).toMatchObject({ changed: [{ tool: 'a', fields: ['description'] }], action: 'reject-generation' })
  })

  it('rejects every review while the lockfile is unusable, says so, and recovers when it is repaired', async () => {
    await pin([A])
    const trust = engine()
    await trust.review(request([A]).value)
    await writeFile(lockfile, '{')
    const { value, resync } = request([A])
    expect(await trust.review(value)).toEqual({ tools: [], instructions: '' })
    expect(errors.some(line => line.includes('lockfile unusable'))).toBe(true)
    expect(trust.guard('mcp__srv__a')).toContain(`the lockfile ${lockfile} is unreadable`)
    expect(trust.guard('mcp__srv__a')).toContain('The file was not changed.')
    expect(trust.observed(S)).toMatchObject({ state: 'quarantined', surfaceDigest: '' })
    expect(trust.describe(R.srv)).toContain('is unreadable')
    expect(trust.takePromptable()).toEqual([])
    await rm(lockfile)
    await pin([A])
    await trust.lockChanged()
    expect(resync).toHaveBeenCalledTimes(1)
    expect((await trust.review(value)).tools).toEqual([A])
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
  })

  it('names the lockfile when a registered tool is denied because the file became unreadable', async () => {
    await pin([A])
    const trust = engine()
    await trust.review(request([A]).value)
    await writeFile(lockfile, '{')
    await trust.lockChanged()
    expect(trust.guard('mcp__srv__a')).toContain('is unreadable')
  })

  it('pins the first surface in tofu mode and never re-pins it', async () => {
    const trust = engine({ policyOf: () => ({ ...ENFORCE, mode: 'tofu' }) })
    expect((await trust.review(request([A]).value)).tools).toEqual([A])
    const first = await readFile(lockfile, 'utf8')
    expect((await readLockfile(lockfile)).servers['srv']?.tools['a']?.approvedBy).toBe('tofu')
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
    expect(warns.some(line => line.includes('pinned on first use'))).toBe(true)

    expect((await trust.review(request([{ ...A, description: 'Changed.' }]).value)).tools).toEqual([])
    expect(await readFile(lockfile, 'utf8')).toBe(first)
  })

  it('keeps a first pin that another process wrote during the review', async () => {
    const other = pinSurface([{ ...A, description: 'Pinned elsewhere.' }], '', 'cli', NOW.toISOString())
    const racing = (): Date => {
      // The clock is read after the lockfile was read and before the pin is written.
      writeFileSync(lockfile, JSON.stringify({ version: 1, canonicalization: 'RFC8785-JCS/SHA-256', servers: { srv: other } }))
      return NOW
    }
    const trust = engine({ policyOf: () => ({ ...ENFORCE, mode: 'tofu' }) }, racing)
    await trust.review(request([A]).value)
    expect((await readLockfile(lockfile)).servers['srv']).toEqual(other)
    const denial = trust.guard('mcp__srv__a')
    expect(denial).toContain('its approved definition no longer matches the registered one (fields: description)')
    expect(denial).toContain(`\`${CLI} pin srv\``)
  })

  it('does not guard servers in off mode', async () => {
    const trust = engine({ policyOf: () => ({ ...ENFORCE, mode: 'off' }) })
    expect((await trust.review(request([A]).value)).tools).toEqual([A])
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
    expect(trust.observed(S)?.state).toBe('unpinned')
    // Off mode registers even a surface it cannot digest, and still does not guard it.
    expect((await trust.review(request([{ ...A, description: LONE_SURROGATE }]).value)).tools).toHaveLength(1)
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
  })
})

describe('guard after lockfile changes', () => {
  it('denies a revoked tool before the re-sync and re-syncs the server', async () => {
    await pin([A, B])
    const trust = engine()
    const { value, resync } = request([A, B])
    await trust.review(value)
    await trust.revoke(R.srv, { tools: ['a'] })
    expect(trust.guard('mcp__srv__a')).toContain('its approval was removed from the lockfile')
    expect(trust.guard('mcp__srv__b')).toBeUndefined()
    expect(resync).toHaveBeenCalledTimes(1)
    expect(Object.keys((await readLockfile(lockfile)).servers['srv']?.tools ?? {})).toEqual(['b'])
  })

  it('keeps an empty entry after a whole-server revoke so tofu cannot re-pin', async () => {
    await pin([A], 'Use carefully.')
    const trust = engine({ policyOf: () => ({ ...ENFORCE, mode: 'tofu' }) })
    await trust.review(request([A], { instructions: 'Use carefully.' }).value)
    await trust.revoke(R.srv, {})
    expect((await readLockfile(lockfile)).servers['srv']).toEqual(withTools(undefined, {}))
    expect((await trust.review(request([A], { instructions: 'Use carefully.' }).value)).tools).toEqual([])
  })

  it('ignores a revoke for a server without an entry or an observation', async () => {
    const trust = engine()
    await trust.revoke(R.ghost, {})
    expect((await readLockfile(lockfile)).servers['ghost']).toBeUndefined()
  })

  it('applies an external lockfile change at once and re-syncs every server', async () => {
    await pin([A])
    const trust = engine()
    const { value, resync } = request([A])
    await trust.review(value)
    await updateLockfile(lockfile, (doc) => { doc.servers['srv'] = withTools(undefined, {}) }, 2000)
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
    await trust.lockChanged()
    expect(trust.guard('mcp__srv__a')).toContain('its approval was removed from the lockfile')
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('reports a watcher failure without stopping', () => {
    engine().watchFailed(new Error('EMFILE'))
    expect(warns).toEqual(['mcp-trust: lockfile watch failed; revocations apply at the next sync: EMFILE'])
  })
})

describe('one-shot acceptance', () => {
  it('offers a withheld surface once, accepts exactly that digest, and re-syncs', async () => {
    const trust = engine()
    const { value, resync } = request([A])
    await trust.review(value)
    const [pending] = trust.takePromptable()
    expect(pending).toMatchObject({ serverName: 'srv' })
    expect(trust.takePromptable()).toEqual([])

    await trust.settlePrompt(pending!, true)
    expect(resync).toHaveBeenCalledTimes(1)
    expect((await trust.review(value)).tools).toEqual([A])
    expect(trust.observed(S)?.state).toBe('accepted-once')
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
    expect(await readLockfile(lockfile)).toMatchObject({ servers: {} })
    expect(trust.takePromptable()).toEqual([])

    expect((await trust.review(request([A, B]).value)).tools).toEqual([])
  })

  it('caps prompts per server and leaves the surface withheld on rejection', async () => {
    const trust = engine({ maxPromptsPerServer: 2 })
    const { value, resync } = request([A])
    await trust.review(value)
    await trust.settlePrompt(trust.takePromptable()[0]!, false)
    expect(resync).not.toHaveBeenCalled()
    await trust.settlePrompt(trust.takePromptable()[0]!, false)
    expect(trust.takePromptable()).toEqual([])
    expect((await trust.review(value)).tools).toEqual([])
  })

  it('pins a server that had no entry when enrollment is on, and records who approved it', async () => {
    const trust = engine({ enrollOnApproval: true })
    const { value, resync } = request([A, B], { instructions: 'Use carefully.' })
    await trust.review(value)
    await trust.settlePrompt(trust.takePromptable()[0]!, true)
    const entry = (await readLockfile(lockfile)).servers['srv']
    expect(Object.keys(entry?.tools ?? {})).toEqual(['a', 'b'])
    expect(entry?.tools['a']?.approvedBy).toBe('prompt')
    expect(resync).toHaveBeenCalledTimes(1)
    expect((await trust.review(value)).tools).toEqual([A, B])
    expect(trust.observed(S)?.state).toBe('approved')
  })

  it('does not pin a changed surface even when enrollment is on', async () => {
    await pin([A])
    const trust = engine({ enrollOnApproval: true })
    const { value } = request([{ ...A, description: 'Changed.' }])
    await trust.review(value)
    const before = await readFile(lockfile, 'utf8')
    await trust.settlePrompt(trust.takePromptable()[0]!, true)
    expect(await readFile(lockfile, 'utf8')).toBe(before)
    expect(trust.observed(S)?.state).toBe('quarantined')
    expect((await trust.review(value)).tools).toEqual([{ ...A, description: 'Changed.' }])
    expect(trust.observed(S)?.state).toBe('accepted-once')
  })

  it('accepts for this process only, and says so, when the pin cannot be written', async () => {
    const trust = engine({ enrollOnApproval: true })
    const { value } = request([A])
    await trust.review(value)
    // A directory in the lockfile's place makes the locked update fail.
    await mkdir(lockfile)
    await trust.settlePrompt(trust.takePromptable()[0]!, true)
    expect(warns.some(line => line.includes('applies to this process only'))).toBe(true)
    await rm(lockfile, { recursive: true })
    expect((await trust.review(value)).tools).toEqual([A])
    expect(trust.observed(S)?.state).toBe('accepted-once')
    expect(await readLockfile(lockfile)).toMatchObject({ servers: {} })
  })

  it('never offers an approved surface or one that cannot be canonicalized', async () => {
    await pin([A])
    const trust = engine()
    await trust.review(request([A]).value)
    expect(trust.takePromptable()).toEqual([])
    await trust.review(request([{ ...A, description: LONE_SURROGATE }]).value)
    expect(trust.observed(S)).toMatchObject({ state: 'quarantined', surfaceDigest: '' })
    expect(trust.takePromptable()).toEqual([])
  })
})

describe('TTL re-verification', () => {
  afterEach(() => { vi.useRealTimers() })

  it('re-syncs after the server ttl clamped to the configured bounds', async () => {
    await pin([A])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const trust = engine({ minReverifyMs: 50, maxReverifyMs: 120 })
    const low = request([A], { serverName: 'low', ttlMs: 1 })
    const high = request([A], { serverName: 'high', ttlMs: 60_000 })
    const none = request([A], { serverName: 'none' })
    const zero = request([A], { serverName: 'zero', ttlMs: 0 })
    for (const each of [low, high, none, zero]) await trust.review(each.value)
    expect(low.resync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(49)
    expect(low.resync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(low.resync).toHaveBeenCalledTimes(1)
    expect(high.resync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(70)
    expect(high.resync).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(none.resync).not.toHaveBeenCalled()
    expect(zero.resync).not.toHaveBeenCalled()
  })

  it('replaces the timer on every review and clears it on dispose', async () => {
    await pin([A])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const trust = engine()
    const first = request([A], { ttlMs: 30 })
    const second = request([A], { ttlMs: 30 })
    await trust.review(first.value)
    await trust.review(second.value)
    expect(vi.getTimerCount()).toBe(1)
    trust.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(first.resync).not.toHaveBeenCalled()
    expect(second.resync).not.toHaveBeenCalled()
  })
})

describe('pin and describe', () => {
  it('pins the whole observed surface and re-syncs', async () => {
    const trust = engine()
    const { value, resync } = request([A, B], { instructions: 'Use carefully.' })
    await trust.review(value)
    expect(trust.describe(R.srv)).toContain('server srv: unpinned')
    await trust.pin(R.srv, { approvedBy: 'cli' })
    expect((await readLockfile(lockfile)).servers['srv']).toEqual(pinSurface([A, B], 'Use carefully.', 'cli', NOW.toISOString()))
    expect(resync).toHaveBeenCalledTimes(1)
    expect((await trust.review(value)).tools).toEqual([A, B])
    expect(trust.describe(R.srv)).toContain('no differences')
  })

  it('pins selected tools over the previous entry and keeps its instructions', async () => {
    await pin([A], 'Use carefully.')
    const trust = engine()
    const { value } = request([A, B], { instructions: 'Use carefully.' })
    await trust.review(value)
    await trust.pin(R.srv, { tools: ['b'], approvedBy: 'command' })
    const entry = (await readLockfile(lockfile)).servers['srv']
    expect(Object.keys(entry?.tools ?? {}).sort()).toEqual(['a', 'b'])
    expect(entry?.tools['b']?.approvedBy).toBe('command')
    expect(entry?.tools['a']?.approvedBy).toBe('cli')
    expect(entry?.instructions?.text).toBe('Use carefully.')
    expect((await trust.review(value)).tools).toEqual([A, B])
  })

  it('pins selected tools of a server that has no entry yet, without instructions', async () => {
    const trust = engine({ policyOf: () => ({ ...ENFORCE, instructions: 'accept' }) })
    await trust.review(request([A, B], { instructions: 'Text.' }).value)
    await trust.pin(R.srv, { tools: ['a'], approvedBy: 'cli' })
    const entry = (await readLockfile(lockfile)).servers['srv']
    expect(Object.keys(entry?.tools ?? {})).toEqual(['a'])
    expect(entry?.instructions).toBeUndefined()
  })

  it('fails loud for an unobserved server, an unlisted tool, and an unpinnable surface', async () => {
    const trust = engine()
    await expect(trust.pin(R.ghost, { approvedBy: 'cli' })).rejects.toThrow('server "ghost" has no observed surface')
    expect(() => trust.describe(R.ghost)).toThrow('server "ghost" has no observed surface')
    await trust.review(request([A]).value)
    await expect(trust.pin(R.srv, { tools: ['nope'], approvedBy: 'cli' })).rejects.toThrow('does not list nope')
    await trust.review(request([{ ...A, description: LONE_SURROGATE }]).value)
    await expect(trust.pin(R.srv, { approvedBy: 'cli' })).rejects.toThrow('cannot be canonicalized')
  })
})

describe('server definitions with review keys', () => {
  const X = { serverName: 'srv', reviewKey: KEY_X }
  const Y = { serverName: 'srv', reviewKey: KEY_Y }
  const keyed = (tools: McpTool[], reviewKey: string, extra: Partial<McpToolReviewRequest> = {}) => request(tools, { reviewKey, ...extra })
  const pinKeyed = (reviewKey: string, tools: McpTool[]) => updateLockfile(lockfile, (doc) => {
    doc.servers[lockKey('srv', reviewKey)] = pinSurface(tools, '', 'cli', NOW.toISOString(), reviewKey)
  }, 2000)

  it('pins and revokes each definition independently', async () => {
    const trust = engine()
    const x = keyed([A], KEY_X)
    const y = keyed([A], KEY_Y)
    await trust.review(x.value)
    await trust.review(y.value)
    expect(trust.servers()).toEqual([X, Y])
    await trust.pin(X, { approvedBy: 'cli' })
    expect(x.resync).toHaveBeenCalledTimes(1)
    expect(y.resync).not.toHaveBeenCalled()
    const doc = await readLockfile(lockfile)
    expect(Object.keys(doc.servers)).toEqual([lockKey('srv', KEY_X)])
    expect(doc.servers[lockKey('srv', KEY_X)]?.identity).toBe(KEY_X)
    expect((await trust.review(x.value)).tools).toEqual([A])
    expect((await trust.review(y.value)).tools).toEqual([])
    expect(trust.observed(X)?.state).toBe('approved')
    expect(trust.observed(Y)?.state).toBe('unpinned')
    expect(trust.observed(S)).toBeUndefined()
    expect(trust.verify(Y)).toHaveLength(1)

    await trust.pin(Y, { tools: ['a'], approvedBy: 'command' })
    expect(Object.keys((await readLockfile(lockfile)).servers).sort()).toEqual([lockKey('srv', KEY_X), lockKey('srv', KEY_Y)].sort())
    expect((await readLockfile(lockfile)).servers[lockKey('srv', KEY_Y)]?.identity).toBe(KEY_Y)

    await trust.revoke(X, {})
    const after = await readLockfile(lockfile)
    expect(after.servers[lockKey('srv', KEY_X)]).toEqual(withTools(undefined, {}, KEY_X))
    expect(Object.keys(after.servers[lockKey('srv', KEY_Y)]?.tools ?? {})).toEqual(['a'])
    await trust.revoke(Y, { tools: ['a'] })
    expect((await readLockfile(lockfile)).servers[lockKey('srv', KEY_Y)]).toEqual(withTools(undefined, {}, KEY_Y))
  })

  it('keeps one-shot acceptance and prompt budgets apart per definition', async () => {
    const trust = engine()
    const x = keyed([A], KEY_X)
    const y = keyed([A], KEY_Y)
    await trust.review(x.value)
    await trust.review(y.value)
    const pendings = trust.takePromptable()
    expect(pendings.map(pending => pending.reviewKey)).toEqual([KEY_X, KEY_Y])
    await trust.settlePrompt(pendings[0]!, true)
    expect(x.resync).toHaveBeenCalledTimes(1)
    expect(y.resync).not.toHaveBeenCalled()
    expect((await trust.review(x.value)).tools).toEqual([A])
    expect((await trust.review(y.value)).tools).toEqual([])
  })

  it('names the key and puts it into the commands of every denial', async () => {
    await pinKeyed(KEY_X, [A])
    const trust = engine()
    await trust.review(keyed([A], KEY_X).value)
    await trust.review(keyed([A], KEY_Y).value)
    const denial = trust.guard('mcp__srv__a')
    expect(denial).toBeUndefined()
    await trust.review(keyed([{ ...A, description: 'Changed.' }], KEY_X).value)
    const blocked = trust.guard('mcp__srv__a')
    expect(blocked).toContain(`server "srv" (key ${KEY_X.slice(0, 12)})`)
    expect(blocked).toContain(`\`${CLI} diff srv --key ${KEY_X.slice(0, 12)}\``)
    expect(blocked).toContain(`\`${CLI} pin srv --key ${KEY_X.slice(0, 12)}\``)
    expect(blocked).toContain(`\`${CLI} revoke srv --key ${KEY_X.slice(0, 12)}\``)
    expect(trust.describe(X)).toContain(`(key ${KEY_X.slice(0, 12)})`)
    expect(() => trust.describe({ serverName: 'srv', reviewKey: 'c'.repeat(64) })).toThrow(`(key ${'c'.repeat(12)})`)
    expect(warns.some(line => line.includes(`diff srv --key ${KEY_X.slice(0, 12)}`))).toBe(true)
    expect(drifts.at(-1)).toMatchObject({ serverName: 'srv', reviewKey: KEY_X, action: 'reject-generation' })
  })

  it('denies a registered tool by key when the pin is revoked', async () => {
    await pinKeyed(KEY_X, [A])
    const trust = engine()
    const x = keyed([A], KEY_X)
    await trust.review(x.value)
    await trust.revoke(X, {})
    expect(trust.guard('mcp__srv__a')).toContain(`\`${CLI} pin srv --key ${KEY_X.slice(0, 12)}\``)
  })

  it('writes a tofu pin under the key with its identity', async () => {
    const trust = engine({ policyOf: () => ({ ...ENFORCE, mode: 'tofu' }) })
    expect((await trust.review(keyed([A], KEY_X).value)).tools).toEqual([A])
    const entry = (await readLockfile(lockfile)).servers[lockKey('srv', KEY_X)]
    expect(entry?.identity).toBe(KEY_X)
    expect(warns.some(line => line.includes(`diff srv --key ${KEY_X.slice(0, 12)}`))).toBe(true)
    expect(trust.observed(Y)).toBeUndefined()
    expect((await trust.review(keyed([A], KEY_Y).value)).tools).toEqual([A])
    expect(Object.keys((await readLockfile(lockfile)).servers)).toHaveLength(2)
  })

  it('does not let a pin of the keyless server cover a keyed one', async () => {
    await pin([A])
    const trust = engine()
    expect((await trust.review(keyed([A], KEY_X).value)).tools).toEqual([])
    expect(trust.observed(X)?.state).toBe('unpinned')
  })
})

describe('failing closed', () => {
  it('registers nothing, reports the cause, and explains the denial when a review raises', async () => {
    await pin([A])
    const failing = engine()
    await failing.review(request([A]).value)
    expect(failing.guard('mcp__srv__a')).toBeUndefined()
    let broken = false
    const trust = engine({
      policyOf: () => {
        if (broken) throw new Error('policy exploded')
        return ENFORCE
      },
    })
    await trust.review(request([A]).value)
    broken = true
    expect(await trust.review(request([A]).value)).toEqual({ tools: [], instructions: '' })
    expect(errors.some(line => line.includes('the review failed') && line.includes('policy exploded'))).toBe(true)
    expect(trust.observed(S)).toMatchObject({ state: 'quarantined', surfaceDigest: '' })
    broken = false
    expect(trust.guard('mcp__srv__a')).toContain('its review failed, so none of its tools registered')
    expect(trust.guard('mcp__srv__a')).toContain(`\`${CLI} diff srv\``)
    expect(trust.describe(S)).toContain('its review failed: policy exploded')
    expect(trust.takePromptable()).toEqual([])
    await expect(trust.pin(S, { approvedBy: 'cli' })).rejects.toThrow('failed, so it cannot be pinned: policy exploded')
    expect((await trust.review(request([A]).value)).tools).toEqual([A])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('does not register tools when the first-use pin cannot be written', async () => {
    const readOnly = join(dir, 'read-only')
    await mkdir(readOnly)
    await chmod(readOnly, 0o500)
    try {
      const trust = engine({ lockfile: join(readOnly, 'mcp-lock.json'), lockWaitMs: 50, policyOf: () => ({ ...ENFORCE, mode: 'tofu' }) })
      expect(await trust.review(request([A]).value)).toEqual({ tools: [], instructions: '' })
      expect(errors.some(line => line.includes('the review failed'))).toBe(true)
      expect(trust.guard('mcp__srv__a')).toContain('its review failed')
    } finally {
      await chmod(readOnly, 0o700)
    }
  })

  it('ignores the lockfile in off mode, even when it is unreadable', async () => {
    await writeFile(lockfile, '{')
    const trust = engine({ policyOf: () => ({ ...ENFORCE, mode: 'off' }) })
    expect((await trust.review(request([A]).value)).tools).toEqual([A])
    expect(errors).toEqual([])
    expect(trust.guard('mcp__srv__a')).toBeUndefined()
    expect(trust.guard('mcp__other__x')).toBeUndefined()
    expect(trust.observed(S)?.state).toBe('unpinned')
  })

  it('names the unreadable lockfile for every server and keeps off-mode servers unguarded', async () => {
    await writeFile(lockfile, '{')
    const trust = engine({ policyOf: name => (name === 'free' ? { ...ENFORCE, mode: 'off' } : ENFORCE) })
    await trust.review(request([A]).value)
    expect(trust.guard('mcp__srv__a')).toContain('is unreadable')
    expect(trust.guard('mcp__free__a')).toBeUndefined()
  })
})

describe('dispose', () => {
  it('releases observations, registrations, acceptances, and prompt state, and ignores later lockfile events', async () => {
    await pin([A])
    const trust = engine()
    const { value, resync } = request([A], { ttlMs: 30 })
    await trust.review(value)
    trust.dispose()
    expect(trust.servers()).toEqual([])
    expect(trust.surfaces()).toEqual([])
    expect(trust.takePromptable()).toEqual([])
    expect(trust.guard('mcp__srv__a')).toContain('was not registered through trust review')
    await trust.lockChanged()
    expect(resync).not.toHaveBeenCalled()
  })
})


describe('denial text', () => {
  it('describes every kind of difference with counts and field names only', () => {
    expect(describeDiff(emptyDiff())).toBe('no difference was recorded')
    expect(describeDiff({
      added: ['x', 'y'], removed: ['z'], changed: [{ tool: 't', fields: ['inputSchema', 'description'] }, { tool: 'u', fields: ['name'] }],
      instructionsChanged: true,
    })).toBe('2 changed tools (fields: name, description, inputSchema), changed server instructions, 2 added tools, 1 removed tool')
  })

  it('says a surface that cannot be hashed cannot be pinned, and names a partial withhold', () => {
    const surface: ObservedSurface = {
      serverName: 'srv', surfaceDigest: '', instructions: '', tools: [], diff: { ...emptyDiff(), invalid: 'lone surrogate' },
      state: 'quarantined', action: 'reject-generation', withheld: [], observedAt: 0,
    }
    expect(blockedReason('srv', surface, CLI)).toContain('cannot be hashed')
    expect(blockedReason('srv', { ...surface, state: 'withheld', diff: emptyDiff() }, CLI)).toContain('withheld some tools of server "srv"')
  })

  it('reports a thrown non-error value', async () => {
    const trust = engine({ policyOf: () => { throw 'plain text' } })
    await trust.review(request([A]).value)
    expect(errors.some(line => line.endsWith(': plain text'))).toBe(true)
  })

  it('re-syncs a server whose review failed when the lockfile changes', async () => {
    let broken = true
    const trust = engine({
      policyOf: () => {
        if (broken) throw new Error('boom')
        return ENFORCE
      },
    })
    const { value, resync } = request([A])
    await trust.review(value)
    broken = false
    await trust.lockChanged()
    expect(resync).toHaveBeenCalledTimes(1)
    expect(trust.verify(S)).toHaveLength(1)
  })
})
