import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { McpToolReviewRequest } from '@deepseek-ai/dsh-mcp-client'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { sessionAgent } from './support/agent.ts'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { createPreStep, promptReason } from '../src/approval.ts'
import { TrustEngine, type EngineConfig, type PendingSurface } from '../src/engine.ts'
import { lockKey, readLockfile, updateLockfile } from '../src/lockfile.ts'
import type { McpTool, ObservedSurface, ServerPolicy } from '../src/types.ts'
import { emptyDiff, pinSurface } from '../src/verdict.ts'

const SIGNAL = new AbortController().signal
const ENTER: PreStepDecision = { kind: 'enter', messages: [] }
const CLI = 'pnpm dsh --profile air-mcp'
const NOW = new Date('2026-09-30T00:00:00.000Z')
const KEY_X = 'a'.repeat(64)
const KEY_Y = 'b'.repeat(64)
const A: McpTool = { name: 'a', description: 'Tool A.', inputSchema: { type: 'object' } }
const B: McpTool = { name: 'b', description: 'Tool B.', inputSchema: { type: 'object' } }
const ENFORCE: ServerPolicy = {
  mode: 'enforce', onAdded: 'withhold', onChanged: 'reject-generation', onRemoved: 'accept',
  instructions: 'pin', deny: [], override: {},
}

const surface: ObservedSurface = {
  serverName: 'browser', surfaceDigest: 'sha256:2', instructions: '', tools: [],
  diff: { ...emptyDiff(), added: ['browser_evaluate'] }, state: 'withheld', action: 'withhold',
  withheld: ['browser_evaluate'], observedAt: 0,
}

function harness(outcome: ApprovalOutcome | Error | undefined) {
  const pending: PendingSurface = { serverName: 'browser', surface, resync: vi.fn() }
  const engine = {
    takePromptable: vi.fn(() => [pending]),
    settlePrompt: vi.fn(() => Promise.resolve()),
    surfaces: vi.fn(() => [surface]),
  }
  const audit = { recordTurn: vi.fn(() => Promise.resolve()) }
  const requests: ApprovalRequest[] = []
  const warns: string[] = []
  const handler = createPreStep({
    engine,
    audit,
    approval: () => outcome === undefined ? undefined : {
      request(req) {
        requests.push(req)
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
      },
    },
    logger: { warn: message => warns.push(message) },
    cli: CLI,
    enrolls: false,
  })
  const session = Session.create(SessionId('session-approval'))
  const agent = sessionAgent(session)
  const next = vi.fn(() => Promise.resolve(ENTER))
  return { pending, engine, audit, requests, warns, handler, agent, next }
}

describe('pre-step approval bridge (collaborators faked)', () => {
  it('asks once on step 1, accepts on allowed-once, records the turn, and delegates', async () => {
    const { pending, engine, audit, requests, handler, agent, next } = harness('allowed-once')
    expect(await handler({ agent, turn: 3, step: 1, signal: SIGNAL }, next)).toBe(ENTER)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.agent).toBe(agent)
    expect(requests[0]!.signal).toBe(SIGNAL)
    expect(requests[0]).toMatchObject({
      toolName: 'mcp__browser__*',
      reason: 'MCP server "browser" changed its tool surface: added browser_evaluate. Approve to use this surface until the process exits. '
        + 'The lockfile is not changed. '
        + `The person can run \`${CLI} diff browser\` to see what differs, then \`${CLI} pin browser\` to approve it or \`${CLI} revoke browser\` to keep it blocked. An allow rule never approves a server.`,
    })
    expect(engine.settlePrompt).toHaveBeenCalledWith(pending, true)
    expect(audit.recordTurn).toHaveBeenCalledWith('session-approval', 3, [surface])
    expect(next).toHaveBeenCalledTimes(1)
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)('leaves the surface withheld on %s', async (outcome) => {
    const { pending, engine, handler, agent, next } = harness(outcome)
    await handler({ agent, turn: 1, step: 1, signal: SIGNAL }, next)
    expect(engine.settlePrompt).toHaveBeenCalledWith(pending, false)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('treats a failed request as not accepted and still runs the turn', async () => {
    const { pending, engine, warns, handler, agent, next } = harness(new Error('no open turn'))
    await handler({ agent, turn: 1, step: 1, signal: SIGNAL }, next)
    expect(engine.settlePrompt).toHaveBeenCalledWith(pending, false)
    expect(warns).toEqual(['mcp-trust(browser): approval request failed: no open turn'])
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('still delegates when settling or recording fails', async () => {
    const { pending, engine, audit, warns, handler, agent, next } = harness('allowed-once')
    engine.settlePrompt.mockRejectedValueOnce(new Error('disk full'))
    await handler({ agent, turn: 1, step: 1, signal: SIGNAL }, next)
    expect(warns).toEqual([`mcp-trust(${pending.serverName}): could not settle the approval: disk full`])
    audit.recordTurn.mockRejectedValueOnce(new Error('audit down'))
    await handler({ agent, turn: 2, step: 1, signal: SIGNAL }, next)
    expect(warns.at(-1)).toBe('mcp-trust: pre-step review failed: audit down')
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('describes a server with no pin by its tool names and says what approving does', () => {
    const tools = ['a', 'b'].map(name => ({ name, inputSchema: { type: 'object' as const } }))
    const unpinned: ObservedSurface = { ...surface, state: 'unpinned', tools, diff: { ...emptyDiff(), added: ['a', 'b'] } }
    const pending: PendingSurface = { serverName: 'browser', surface: unpinned, resync: vi.fn() }
    expect(promptReason(pending, CLI, true)).toBe(
      'MCP server "browser" has not been approved yet. It offers 2 tools: a, b. '
      + 'Approve to use it and remember the approval in the trust lockfile. '
      + `To read the definitions first, decline and run \`${CLI} diff browser\`.`,
    )
    expect(promptReason(pending, CLI, false)).toContain(`Approve to use it until the process exits, or run \`${CLI} pin browser\` to save the approval.`)
  })

  it('shows the server name with the start of its key, and the key in every command', () => {
    const keyed: PendingSurface = { serverName: 'browser', reviewKey: KEY_X, surface: { ...surface, reviewKey: KEY_X, state: 'unpinned' }, resync: vi.fn() }
    expect(promptReason(keyed, CLI, true)).toBe(
      'MCP server "browser" (key aaaaaaaaaaaa) has not been approved yet. It offers 0 tools: . '
      + 'Approve to use it and remember the approval in the trust lockfile. '
      + 'To read the definitions first and get the command that saves the approval, decline and run `/mcp-trust diff browser --key aaaaaaaaaaaa`.',
    )
    expect(promptReason(keyed, CLI, false)).toContain('Approve to use it until the process exits. To read the definitions first and get the command that saves the approval')
    const changed: PendingSurface = { serverName: 'browser', reviewKey: KEY_X, surface: { ...surface, reviewKey: KEY_X }, resync: vi.fn() }
    const text = promptReason(changed, CLI, true)
    expect(text).toContain('MCP server "browser" (key aaaaaaaaaaaa) changed its tool surface: added browser_evaluate.')
    expect(text).toContain('`/mcp-trust diff browser --key aaaaaaaaaaaa`')
    expect(text).not.toContain(KEY_X)
  })

  it('shows at most eight names, one tool in the singular, and makes hostile characters visible', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ name: `t${String(index)}`, inputSchema: { type: 'object' as const } }))
    const wide: PendingSurface = { serverName: 'browser', surface: { ...surface, state: 'unpinned', tools: many }, resync: vi.fn() }
    expect(promptReason(wide, CLI, true)).toContain('It offers 10 tools: t0, t1, t2, t3, t4, t5, t6, t7, and 2 more.')
    const one: PendingSurface = { serverName: 'browser', surface: { ...surface, state: 'unpinned', tools: [{ name: 'a‮b', inputSchema: { type: 'object' as const } }] }, resync: vi.fn() }
    expect(promptReason(one, CLI, true)).toContain('It offers 1 tool: a<U+202E>b.')
    const long: PendingSurface = { serverName: 'browser', surface: { ...surface, state: 'unpinned', tools: [{ name: 'n'.repeat(500), inputSchema: { type: 'object' as const } }] }, resync: vi.fn() }
    expect(promptReason(long, CLI, true)).toContain('<truncated 400 more characters>')
  })

  it('claims no prompt without an approval service but still records the turn', async () => {
    const { engine, audit, handler, agent, next } = harness(undefined)
    await handler({ agent, turn: 1, step: 1, signal: SIGNAL }, next)
    expect(engine.takePromptable).not.toHaveBeenCalled()
    expect(audit.recordTurn).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does nothing on later steps except delegate', async () => {
    const { engine, audit, handler, agent, next } = harness('allowed-once')
    await handler({ agent, turn: 1, step: 2, signal: SIGNAL }, next)
    expect(engine.takePromptable).not.toHaveBeenCalled()
    expect(audit.recordTurn).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })
})

// Real engine, real lockfile, real approval service; only the answerer is a test double.
let dir: string
let lockfile: string
let warns: string[]
let ctxs: Context[]
let engines: TrustEngine[]

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'air-mcp-approval-')))
  lockfile = join(dir, 'mcp-lock.json')
  warns = []
  ctxs = []
  engines = []
})

afterEach(async () => {
  for (const engine of engines) engine.dispose()
  for (const ctx of ctxs) await ctx.fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

interface BedOptions {
  /** Approval service policy; `undefined` composes no approval service at all. */
  policy?: 'ask' | 'never'
  answer?: (request: ApprovalRequest) => ApprovalOutcome | Promise<ApprovalOutcome>
  enroll?: boolean
  maxPrompts?: number
  lockfilePath?: string
}

async function bed(options: BedOptions = {}) {
  const path = options.lockfilePath ?? lockfile
  const config: EngineConfig = {
    lockfile: path, lockWaitMs: 2000, denyUnreviewedMcpTools: true, maxPromptsPerServer: options.maxPrompts ?? 3,
    minReverifyMs: 20, maxReverifyMs: 60, cliCommand: CLI, enrollOnApproval: options.enroll ?? false, policyOf: () => ENFORCE,
  }
  const engine = new TrustEngine({
    config, logger: { warn: message => warns.push(message), error: message => warns.push(message) }, now: () => NOW, drift: () => {},
  })
  engines.push(engine)
  const ctx = new Context()
  ctxs.push(ctx)
  if (options.policy !== undefined) await ctx.plugin(ApprovalService, { policy: options.policy })
  const asked: ApprovalRequest[] = []
  if (options.answer !== undefined) {
    const answer = options.answer
    ctx.on('approval/request', (request) => {
      asked.push(request)
      return Promise.resolve(answer(request))
    })
  }
  const recorded: ObservedSurface[][] = []
  const handler = createPreStep({
    engine,
    audit: { recordTurn: (_session, _turn, surfaces) => { recorded.push([...surfaces]); return Promise.resolve() } },
    approval: () => options.policy === undefined ? undefined : ctx.get('approval'),
    logger: { warn: message => warns.push(message) },
    cli: CLI,
    enrolls: config.enrollOnApproval,
  })
  const session = Session.create(SessionId('session-real'))
  session.append('turn/start', { turn: 1 })
  const agent = sessionAgent(session)
  const turn = (signal: AbortSignal = SIGNAL) => handler({ agent, turn: 1, step: 1, signal }, () => Promise.resolve(ENTER))
  const review = (tools: McpTool[], extra: Partial<McpToolReviewRequest> = {}) => {
    const resync = vi.fn()
    const value: McpToolReviewRequest = {
      serverName: 'browser',
      tools: tools.map(definition => ({ rawName: definition.name, publicName: `mcp__browser__${definition.name}`, definition })),
      instructions: '',
      resync,
      ...extra,
    }
    return { value, resync, run: () => engine.review(value) }
  }
  return { engine, ctx, session, asked, recorded, turn, review }
}

const events = (session: Session, prefix: string): string[] =>
  [...session.snapshotEvents()].map(event => event.type).filter(type => type.startsWith(prefix))

describe('pre-step approval bridge (real engine, lockfile, and approval service)', () => {
  it('approve: pins a first-use server under its lock key with its identity, like the command line does', async () => {
    const { engine, turn, review, session, asked } = await bed({ policy: 'ask', answer: () => 'allowed-once', enroll: true })
    const first = review([A, B], { reviewKey: KEY_X })
    await first.run()
    await turn()
    expect(asked).toHaveLength(1)
    expect(events(session, 'approval/')).toEqual(['approval/asked', 'approval/decided'])
    const lock = await readLockfile(lockfile)
    expect(Object.keys(lock.servers)).toEqual([lockKey('browser', KEY_X)])
    const entry = lock.servers[lockKey('browser', KEY_X)]!
    expect(entry.identity).toBe(KEY_X)
    expect(Object.values(entry.tools).map(tool => tool.approvedBy)).toEqual(['prompt', 'prompt'])
    expect(first.resync).toHaveBeenCalledTimes(1)
    expect((await first.run()).tools).toEqual([A, B])
    expect(engine.observed({ serverName: 'browser', reviewKey: KEY_X })?.state).toBe('approved')

    // The same surface approved through the command line writes the same entry apart from who approved it.
    const other = join(dir, 'cli-lock.json')
    const cli = await bed({ lockfilePath: other })
    const viaCli = cli.review([A, B], { reviewKey: KEY_X })
    await viaCli.run()
    await cli.engine.pin({ serverName: 'browser', reviewKey: KEY_X }, { approvedBy: 'cli' })
    const strip = (text: string): string => text.replaceAll('"approvedBy": "cli"', '"approvedBy": "prompt"')
    expect(strip(await readFile(other, 'utf8'))).toBe(await readFile(lockfile, 'utf8'))
  })

  it('accept once: a changed surface is not pinned, and the acceptance is bound to that exact digest', async () => {
    await updateLockfile(lockfile, (doc) => { doc.servers['browser'] = pinSurface([A], '', 'cli', NOW.toISOString()) }, 2000)
    const before = await readFile(lockfile, 'utf8')
    const { engine, turn, review } = await bed({ policy: 'ask', answer: () => 'allowed-once', enroll: true })
    const changed = { ...A, description: 'Changed.' }
    const first = review([changed])
    expect((await first.run()).tools).toEqual([])
    await turn()
    expect(await readFile(lockfile, 'utf8')).toBe(before)
    expect(first.resync).toHaveBeenCalledTimes(1)
    expect((await first.run()).tools).toEqual([changed])
    expect(engine.observed({ serverName: 'browser' })?.state).toBe('accepted-once')
    expect(engine.guard('mcp__browser__a')).toBeUndefined()
    // A further change has another digest and is not covered by the earlier acceptance.
    expect((await review([{ ...A, description: 'Changed again.' }]).run()).tools).toEqual([])
    expect(engine.observed({ serverName: 'browser' })?.state).toBe('quarantined')
    expect(engine.guard('mcp__browser__a')).toContain('blocked')
  })

  it('decline: the server stays blocked and the denial gives the command to review it', async () => {
    const { engine, turn, review, recorded } = await bed({ policy: 'ask', answer: () => 'rejected', enroll: true })
    await review([A], { reviewKey: KEY_X }).run()
    await turn()
    expect((await review([A], { reviewKey: KEY_X }).run()).tools).toEqual([])
    const denial = engine.guard('mcp__browser__a')
    expect(denial).toContain('blocked')
    expect(denial).toContain('`/mcp-trust diff browser --key aaaaaaaaaaaa`')
    await expect(readFile(lockfile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(recorded).toHaveLength(1)
  })

  it('prompt rejected by the access mode: policy never rejects without asking any answerer', async () => {
    const { engine, turn, review, session, asked } = await bed({ policy: 'never', answer: () => 'allowed-once', enroll: true })
    await review([A]).run()
    await turn()
    expect(asked).toEqual([])
    expect([...session.snapshotEvents()].find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'rejected' })
    expect((await review([A]).run()).tools).toEqual([])
    expect(engine.guard('mcp__browser__a')).toContain(`${CLI} diff browser`)
    await expect(readFile(lockfile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prompt unavailable: no answerer composed leaves the server blocked', async () => {
    const { engine, turn, review, session } = await bed({ policy: 'ask', enroll: true })
    await review([A]).run()
    await turn()
    expect([...session.snapshotEvents()].find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'unavailable' })
    expect(engine.guard('mcp__browser__a')).toContain('blocked')
  })

  it('no approval service at all: nothing is asked and the server stays blocked', async () => {
    const { engine, turn, review, recorded } = await bed({ enroll: true })
    await review([A]).run()
    await turn()
    expect(recorded).toHaveLength(1)
    expect(engine.guard('mcp__browser__a')).toContain(`${CLI} pin browser`)
  })

  it('prompt throws: an answerer that throws leaves the server blocked', async () => {
    const { engine, turn, review } = await bed({ policy: 'ask', answer: () => { throw new Error('answerer crashed') }, enroll: true })
    await review([A]).run()
    await turn()
    expect(engine.guard('mcp__browser__a')).toContain('blocked')
  })

  it('prompt throws: a request outside an open turn is logged and the server stays blocked', async () => {
    const { engine, turn, review, session } = await bed({ policy: 'ask', answer: () => 'allowed-once', enroll: true })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await review([A]).run()
    await turn()
    expect(warns.some(line => line.includes('approval request failed') && line.includes('outside an open turn'))).toBe(true)
    expect(engine.guard('mcp__browser__a')).toContain('blocked')
  })

  it('prompt times out: a withdrawn request settles cancelled and the server stays blocked', async () => {
    const { engine, turn, review, session } = await bed({ policy: 'ask', answer: () => new Promise<ApprovalOutcome>(() => {}), enroll: true })
    await review([A]).run()
    const controller = new AbortController()
    const done = turn(controller.signal)
    controller.abort()
    await done
    expect([...session.snapshotEvents()].find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'cancelled' })
    expect(engine.guard('mcp__browser__a')).toContain('blocked')
  })

  it('same-named servers with different keys are prompted and settled independently', async () => {
    const answer = vi.fn((request: ApprovalRequest): ApprovalOutcome => request.reason?.includes('(key aaaaaaaaaaaa)') ? 'allowed-once' : 'rejected')
    const { engine, turn, review, asked } = await bed({ policy: 'ask', answer, enroll: true })
    const x = review([A], { reviewKey: KEY_X })
    const y = review([A], { reviewKey: KEY_Y })
    await x.run()
    await y.run()
    await turn()
    expect(asked).toHaveLength(2)
    expect(asked.map(request => request.reason?.match(/\(key (\w+)\)/)?.[1])).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
    expect(Object.keys((await readLockfile(lockfile)).servers)).toEqual([lockKey('browser', KEY_X)])
    expect(x.resync).toHaveBeenCalledTimes(1)
    expect(y.resync).not.toHaveBeenCalled()
    expect((await x.run()).tools).toEqual([A])
    expect((await y.run()).tools).toEqual([])
    expect(engine.observed({ serverName: 'browser', reviewKey: KEY_X })?.state).toBe('approved')
    expect(engine.observed({ serverName: 'browser', reviewKey: KEY_Y })?.state).toBe('unpinned')
  })

  it('asks about a declined surface only within the prompt budget', async () => {
    const { turn, review, asked } = await bed({ policy: 'ask', answer: () => 'rejected', enroll: true, maxPrompts: 2 })
    await review([A]).run()
    await turn()
    await turn()
    await turn()
    expect(asked).toHaveLength(2)
  })
})
