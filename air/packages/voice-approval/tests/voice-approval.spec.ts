import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as voiceApproval from '../src/index.ts'
import { approvalDigest, canonicalJson } from '../src/digest.ts'
import { DENIAL_PREFIX, findApprovalDenial, findRefusedAsk } from '../src/denial.ts'
import { escalationSummary, isEscalation } from '../src/summary.ts'
import { APPROVE_TOKEN, consumeApprovalToken, findApprovalToken, issueApprovalToken } from '../src/token.ts'
import type { SessionLike } from '../src/session-text.ts'

const dirs: string[] = []
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tokenDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'air-voice-approval-'))
  dirs.push(dir)
  return dir
}

function sessionSaying(...messages: string[]): SessionLike {
  const events = messages.flatMap(text => [{ type: 'assistant/message' }, { type: 'user/message', data: { content: [{ type: 'text', text }] } }])
  return { seq: events.length, eventAt: seq => events[Number(seq)] }
}

const ESCALATION = { command: 'Remove-Item C:\\temp\\old -Recurse', sandbox_permissions: 'danger-full-access', justification: 'Clean the old folder outside the workspace.' }

describe('digest', () => {
  it('is independent of key order and of object versus JSON text, and differs by tool and arguments', () => {
    const a = approvalDigest('pwsh', { b: 1, a: [1, { y: 2, x: 3 }] })
    expect(approvalDigest('pwsh', '{"a":[1,{"x":3,"y":2}],"b":1}')).toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(approvalDigest('bash', { b: 1, a: [1, { y: 2, x: 3 }] })).not.toBe(a)
    expect(approvalDigest('pwsh', { b: 2 })).not.toBe(a)
    expect(approvalDigest('pwsh', 'not json')).toMatch(/^[0-9a-f]{64}$/)
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson(null)).toBe('null')
  })
})

describe('summary', () => {
  it('says the command with the justification on one line', () => {
    expect(escalationSummary(ESCALATION)).toBe('run Remove-Item C:\\temp\\old -Recurse (Clean the old folder outside the workspace.)')
    expect(escalationSummary(JSON.stringify({ command: 'dir', sandbox_permissions: 'x' }))).toBe('run dir')
    expect(escalationSummary({ justification: 'because' })).toBe('do something outside the workspace (because)')
    expect(escalationSummary('not json')).toBe('do something outside the workspace')
    expect(escalationSummary({ command: `a\n  b ${'x'.repeat(200)}` })).toMatch(/^run a b x+\u2026$/)
    expect(escalationSummary(null)).toBe('do something outside the workspace')
  })

  it('detects an escalation by sandbox_permissions', () => {
    expect(isEscalation(ESCALATION)).toBe(true)
    expect(isEscalation(JSON.stringify(ESCALATION))).toBe(true)
    expect(isEscalation({ command: 'dir' })).toBe(false)
    expect(isEscalation({ sandbox_permissions: '  ' })).toBe(false)
    expect(isEscalation(7)).toBe(false)
  })
})

describe('tokens', () => {
  it('binds a token to a digest, finds it without consuming, and consumes it once', () => {
    const dir = join(tokenDir(), 'nested')
    const token = issueApprovalToken(dir, 'digest-a', () => Buffer.from('0123456789abcdef', 'hex'))
    expect(token).toBe('[AIR-APPROVE-0123456789abcdef]')
    expect(new RegExp(APPROVE_TOKEN.source).test(token)).toBe(true)
    expect(findApprovalToken(dir, `go ${token}`, 'digest-a')).toBe('0123456789abcdef')
    expect(findApprovalToken(dir, `go ${token}`, 'digest-a')).toBe('0123456789abcdef')
    expect(findApprovalToken(dir, `go ${token}`, 'digest-b')).toBeUndefined()
    expect(findApprovalToken(dir, 'no token here', 'digest-a')).toBeUndefined()
    expect(findApprovalToken(dir, '[AIR-APPROVE-ffffffffffffffff]', 'digest-a')).toBeUndefined()
    expect(consumeApprovalToken(dir, '0123456789abcdef')).toBe(true)
    expect(consumeApprovalToken(dir, '0123456789abcdef')).toBe(false)
    expect(findApprovalToken(dir, `go ${token}`, 'digest-a')).toBeUndefined()
  })

  it('uses random bytes by default', () => {
    const dir = tokenDir()
    expect(issueApprovalToken(dir, 'd')).toMatch(/^\[AIR-APPROVE-[0-9a-f]{16}\]$/)
  })
})

describe('guard and answerer', () => {
  function rig(trusted: string[] = []) {
    const dir = tokenDir()
    const approval = voiceApproval.createVoiceApproval({ tokenDir: dir, trustedToolPrefixes: trusted })
    const call = (args: unknown, session?: SessionLike, callId = 'call-1') =>
      approval.guard({ callId, name: 'pwsh', arguments: args, ...session === undefined ? {} : { agent: { session } } })
    const token = (args: unknown): string => issueApprovalToken(dir, approvalDigest('pwsh', args))
    return { dir, approval, call, token }
  }

  it('lets calls without an escalation through untouched', () => {
    const { call } = rig()
    expect(call({ command: 'dir' })).toBeUndefined()
  })

  it('denies an escalation without a token, saying what it wants', () => {
    const { call } = rig()
    const expected = `${DENIAL_PREFIX}run Remove-Item C:\\temp\\old -Recurse (Clean the old folder outside the workspace.).`
    expect(call(ESCALATION)).toBe(expected)
    expect(call(ESCALATION, sessionSaying('please clean up'))).toBe(expected)
    expect(call(ESCALATION, { seq: 0, eventAt: () => undefined })).toBe(expected)
  })

  it('denies a token issued for a different command', () => {
    const { call, token } = rig()
    const other = token({ ...ESCALATION, command: 'Get-ChildItem' })
    expect(call(ESCALATION, sessionSaying(`Approved. Run exactly that command again now. ${other}`))).toContain(DENIAL_PREFIX)
  })

  it('denies an old token that is no longer in the latest message', () => {
    const { call, token } = rig()
    const issued = token(ESCALATION)
    expect(call(ESCALATION, sessionSaying(`run it ${issued}`, 'something later'))).toContain(DENIAL_PREFIX)
  })

  it('approves once with the matching token, then denies a second use', () => {
    const { call, approval, token } = rig()
    const issued = token(ESCALATION)
    const session = sessionSaying(`Approved. Run exactly that command again now. ${issued}`)
    expect(call(ESCALATION, session)).toBeUndefined()
    expect(approval.answer({ callId: 'call-1', toolName: 'pwsh' })).toBe('allowed-once')
    expect(call(ESCALATION, session, 'call-2')).toContain(DENIAL_PREFIX)
    expect(approval.answer({ callId: 'call-2', toolName: 'pwsh' })).toBe('rejected')
  })

  it('rejects an approval request the guard did not let through, or that has no call id', () => {
    const { approval } = rig()
    expect(approval.answer({ callId: 'unknown', toolName: 'pwsh' })).toBe('rejected')
    expect(approval.answer({ toolName: 'memory_forget' })).toBe('rejected')
  })

  it('rejects a request whose token was consumed between the guard and the answer', () => {
    const { call, approval, token, dir } = rig()
    const issued = token(ESCALATION)
    expect(call(ESCALATION, sessionSaying(issued))).toBeUndefined()
    expect(consumeApprovalToken(dir, issued.slice(13, 29))).toBe(true)
    expect(approval.answer({ callId: 'call-1', toolName: 'pwsh' })).toBe('rejected')
  })

  it('allows the approval requests of trusted tool prefixes only', () => {
    const { approval } = rig(['mcp__browser__'])
    expect(approval.answer({ callId: 'x', toolName: 'mcp__browser__browser_click' })).toBe('allowed-once')
    expect(approval.answer({ callId: 'x', toolName: 'pwsh' })).toBe('rejected')
  })
})

describe('findApprovalDenial', () => {
  const call = { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: JSON.stringify(ESCALATION) }
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool-call', id: 'c0', name: 'pwsh', arguments: '{"command":"dir"}' }, call] } } },
    { type: 'tool/result', data: { error: { message: `${DENIAL_PREFIX}run something.` } } },
  ]

  it('returns the summary and the digest of the denied escalating call', () => {
    const found = findApprovalDenial(events)
    expect(found).toEqual({ summary: escalationSummary(ESCALATION), digest: approvalDigest('pwsh', ESCALATION) })
  })

  it('ignores a denial text that only the model wrote, a run without a denial, and a denial without an escalating call', () => {
    expect(findApprovalDenial([events[0]!, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: DENIAL_PREFIX }] } } }])).toBeUndefined()
    expect(findApprovalDenial([events[0]!])).toBeUndefined()
    expect(findApprovalDenial([{ type: 'tool/result', data: DENIAL_PREFIX }])).toBeUndefined()
    expect(findApprovalDenial([{ type: 'assistant/message', data: { message: { content: 'text' } } }, { type: 'tool/result', data: DENIAL_PREFIX }])).toBeUndefined()
    expect(findApprovalDenial([{ type: 'assistant/message' }, { type: 'tool/result' }])).toBeUndefined()
  })
})

describe('plugin', () => {
  it('denies an escalation through the real tool registry with the model-visible text, and answers approval requests', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    ctx.tools.register(defineTool({
      name: 'pwsh',
      description: 'run',
      parameters: {
        command: { type: 'string', required: true, description: 'c' },
        sandbox_permissions: { type: 'string', description: 's' },
        justification: { type: 'string', description: 'j' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean', required: true } } }, render: () => [{ type: 'text', text: 'ran' }] },
      execute: async () => ({ done: true }),
    }))
    await ctx.plugin(voiceApproval, { tokenDir: tokenDir(), trustedToolPrefixes: ['mcp__browser__'] })
    const run = (args: unknown, id: string) => ctx.tools.execute({ name: 'pwsh', arguments: args, callId: ToolCallId(id), signal: new AbortController().signal })
    const denied = await run(ESCALATION, 'e1')
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).toContain(`${DENIAL_PREFIX}run Remove-Item`)
    expect((await run({ command: 'dir' }, 'e2')).isError).toBe(false)
    const outcome = await ctx.waterfall('approval/request', { agent: { id: 'a' }, toolName: 'mcp__browser__browser_click' } as never, () => Promise.resolve('unavailable'))
    expect(outcome).toBe('allowed-once')
    expect(voiceApproval.name).toBe('air-voice-approval')
    expect(voiceApproval.inject).toEqual(['tools'])
  })
})

describe('findRefusedAsk', () => {
  const asked = (id: string, toolName: string, reason?: string) => ({ type: 'approval/asked', data: { id, toolName, ...reason === undefined ? {} : { reason } } })
  const decided = (id: string, outcome: string) => ({ type: 'approval/decided', data: { id, outcome } })

  it('says what the last rejected request was, from the tool name or its own reason', () => {
    expect(findRefusedAsk([asked('1', 'plugin_manager'), decided('1', 'rejected')])).toBe('use plugin_manager')
    expect(findRefusedAsk([asked('1', 'memory_forget', 'Forget\n  the   note about tea'), decided('1', 'rejected')])).toBe('Forget the note about tea')
    expect(findRefusedAsk([asked('1', 'a'), decided('1', 'rejected'), asked('2', 'b'), decided('2', 'rejected')])).toBe('use b')
  })

  it('ignores allowed and unmatched requests, and clips a long reason', () => {
    expect(findRefusedAsk([asked('1', 'mcp__browser__browser_click'), decided('1', 'allowed-once')])).toBeUndefined()
    expect(findRefusedAsk([decided('9', 'rejected'), { type: 'approval/decided' }, { type: 'approval/decided', data: { id: 5 } }])).toBeUndefined()
    expect(findRefusedAsk([{ type: 'approval/asked', data: { toolName: 'x' } }, { type: 'approval/asked' }, { type: 'approval/asked', data: { id: 'z', toolName: 7 } }])).toBeUndefined()
    expect(findRefusedAsk([asked('1', 'x', 'y'.repeat(300)), decided('1', 'rejected')])).toMatch(/^y{119}…$/)
    expect(findRefusedAsk([])).toBeUndefined()
  })
})
