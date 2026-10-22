import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as sendGuard from '../src/index.ts'
import { issueSendToken } from '../src/token.ts'
import type { SessionLike } from '../src/session-text.ts'

const dirs: string[] = []
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tokenDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'air-send-guard-'))
  dirs.push(dir)
  return dir
}

function sessionSaying(...messages: string[]): SessionLike {
  const events = messages.flatMap(text => [{ type: 'assistant/message' }, { type: 'user/message', data: { content: [{ type: 'text', text }] } }])
  return { seq: events.length, eventAt: seq => events[Number(seq)] }
}

const click = (element: string): { name: string; arguments: unknown } => ({ name: 'mcp__browser__browser_click', arguments: { element, ref: 'e9' } })

describe('createGuard', () => {
  it('lets calls that do not send through', () => {
    const guard = sendGuard.createGuard(tokenDir())
    expect(guard({ name: 'mcp__browser__browser_click', arguments: { element: 'Compose' } })).toBeUndefined()
    expect(guard({ name: 'pwsh', arguments: { command: 'dir' } })).toBeUndefined()
  })

  it('blocks a send before any token exists, with no session, and with no user message', () => {
    const guard = sendGuard.createGuard(tokenDir())
    expect(guard(click('Send'))).toBe('Sending is locked until the user confirms.')
    expect(guard({ ...click('Send'), agent: { session: { seq: 0, eventAt: () => undefined } } })).toBe(sendGuard.REFUSAL)
  })

  it('blocks a send under a draft prompt, a wrong token and an old token', () => {
    const dir = tokenDir()
    const guard = sendGuard.createGuard(dir)
    const issued = issueSendToken(dir)
    expect(guard({ ...click('Send'), agent: { session: sessionSaying('send a gmail to Asha') } })).toBe(sendGuard.REFUSAL)
    expect(guard({ ...click('Send'), agent: { session: sessionSaying('Now press Send [AIR-SEND-ffffffffffffffff]') } })).toBe(sendGuard.REFUSAL)
    // The token exists but is not in the latest user message.
    expect(guard({ ...click('Send'), agent: { session: sessionSaying(`Press Send ${issued}`, 'Something later') } })).toBe(sendGuard.REFUSAL)
  })

  it('allows one send with the live token in the latest user message, then blocks the second', () => {
    const dir = tokenDir()
    const guard = sendGuard.createGuard(dir)
    const token = issueSendToken(dir)
    const session = sessionSaying('draft please', `Now press Send ${token}`)
    expect(guard({ ...click('Send'), agent: { session } })).toBeUndefined()
    expect(guard({ ...click('Send'), agent: { session } })).toBe(sendGuard.REFUSAL)
    expect(guard({ name: 'mcp__browser__browser_press_key', arguments: { key: 'Control+Enter' }, agent: { session } })).toBe(sendGuard.REFUSAL)
  })
})

describe('createGuard per-session target tracking', () => {
  const key = (k: string, session: SessionLike) => ({ name: 'mcp__browser__browser_press_key', arguments: { key: k }, agent: { session } })

  it('refuses Enter after a refused Send click, in the same user turn only', () => {
    const guard = sendGuard.createGuard(tokenDir())
    const turn1 = sessionSaying('read my mail')
    expect(guard({ ...click('Send'), agent: { session: turn1 } })).toBe(sendGuard.REFUSAL)
    expect(guard(key('Enter', turn1))).toBe(sendGuard.REFUSAL)
    const events: Array<{ type: string; data?: unknown }> = [{ type: 'user/message', data: { content: [{ type: 'text', text: 'first' }] } }]
    const live: SessionLike = { seq: events.length, eventAt: seq => events[Number(seq)] }
    const liveSession = { get seq() { return events.length }, eventAt: live.eventAt }
    expect(guard({ ...click('Send'), agent: { session: liveSession } })).toBe(sendGuard.REFUSAL)
    expect(guard(key('Enter', liveSession))).toBe(sendGuard.REFUSAL)
    events.push({ type: 'user/message', data: { content: [{ type: 'text', text: 'second' }] } })
    expect(guard(key('Enter', liveSession))).toBeUndefined()
  })

  it('does not mix up two sessions, and uses a detached state without a session', () => {
    const guard = sendGuard.createGuard(tokenDir())
    const a = sessionSaying('a')
    const b = sessionSaying('b')
    expect(guard({ ...click('Send'), agent: { session: a } })).toBe(sendGuard.REFUSAL)
    expect(guard(key('Enter', b))).toBeUndefined()
    expect(guard(key('Enter', a))).toBe(sendGuard.REFUSAL)
    expect(guard(click('Send'))).toBe(sendGuard.REFUSAL)
    expect(guard({ name: 'mcp__browser__browser_press_key', arguments: { key: 'Enter' } })).toBe(sendGuard.REFUSAL)
  })

  it('clears the Send focus after the one allowed send', () => {
    const dir = tokenDir()
    const guard = sendGuard.createGuard(dir)
    const session = sessionSaying('go', `Press Send ${issueSendToken(dir)}`)
    expect(guard({ ...click('Send'), agent: { session } })).toBeUndefined()
    expect(guard(key('Enter', session))).toBeUndefined()
  })
})

describe('plugin', () => {
  it('is refused through the real tool registry with the model-visible text', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    ctx.tools.register(defineTool({
      name: 'mcp__browser__browser_click',
      description: 'click',
      parameters: { element: { type: 'string', required: true, description: 'e' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean', required: true } } }, render: () => [{ type: 'text', text: 'clicked' }] },
      execute: async () => ({ done: true }),
    }))
    await ctx.plugin(sendGuard, { tokenDir: tokenDir() })
    const run = (element: string, id: string) =>
      ctx.tools.execute({ name: 'mcp__browser__browser_click', arguments: { element }, callId: ToolCallId(id), signal: new AbortController().signal })
    const blocked = await run('Send', 'c1')
    expect(blocked.isError).toBe(true)
    expect(JSON.stringify(blocked)).toContain('Sending is locked until the user confirms.')
    const fine = await run('Compose', 'c2')
    expect(fine.isError).toBe(false)
    expect(sendGuard.name).toBe('air-send-guard')
    expect(sendGuard.inject).toEqual(['tools'])
  })
})
