import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RequestMessage } from '@deepseek-ai/dsh-llm'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LogCompactionEngine, {
  type LogCompactionConfig,
  appendLogRule,
  buildLogRule,
  name,
  resolveLogConfig,
} from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildLoop, lastText, MODEL, SIGNAL, type Loop } from './harness.ts'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

async function loop(
  mount: (ctx: Context, config: BasicCompactionConfig) => unknown,
  config?: BasicCompactionConfig,
): Promise<Loop> {
  const built = await buildLoop(mount, config)
  disposers.push(async () => { await built.ctx.fiber.dispose() })
  return built
}

const stock = (ctx: Context, config: BasicCompactionConfig): unknown => new BasicCompactionEngine(ctx, config)
const log = (extra: { logMaxEntries?: number; firstRequestMaxChars?: number } = {}) =>
  (ctx: Context, config: BasicCompactionConfig): unknown => new LogCompactionEngine(ctx, Object.assign({}, config, extra))

async function summaryRequest(built: Loop): Promise<string> {
  const result = await built.ctx.compaction.compactNow(built.agent, SIGNAL)
  expect(result).not.toBeNull()
  const requests = built.adapter.compactionRequests()
  expect(requests).toHaveLength(1)
  return lastText(requests[0] ?? (() => { throw new Error('no compaction request') })())
}

describe('summary instruction', () => {
  it('sends upstream instruction unchanged, followed by the appended log section', async () => {
    const upstream = await summaryRequest(await loop(stock))
    const ours = await summaryRequest(await loop(log()))
    expect(ours.startsWith(upstream)).toBe(true)
    const appended = ours.slice(upstream.length)
    expect(appended).toBe(buildLogRule({ logMaxEntries: 60, firstRequestMaxChars: 300 }))
    expect(appended).toContain('## Chronological Log')
    expect(appended).toContain('## First request')
    expect(appended).toContain('numbered')
  })

  it('puts the configured cap and truncation length in the instruction', async () => {
    const ours = await summaryRequest(await loop(log({ logMaxEntries: 7, firstRequestMaxChars: 41 })))
    expect(ours).toContain('at most 7 entries')
    expect(ours).toContain('at most 41 characters')
    expect(ours).not.toContain('at most 60 entries')
  })

  /** Send a bare compaction-purpose request for the agent's session and return the text the adapter received. */
  async function probe(built: Loop): Promise<string> {
    const request = {
      provider: MODEL,
      model: MODEL,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'probe' }], source: { kind: 'user' } })],
      purpose: 'compaction' as const,
      sessionId: built.agent.session.id,
    }
    for await (const chunk of built.ctx.llm.stream(request)) void chunk
    const seen = built.adapter.requests.at(-1)
    return seen === undefined ? '' : lastText(seen)
  }

  it('leaves later requests alone once the summary call ended', async () => {
    const built = await loop(log())
    await summaryRequest(built)
    expect(await probe(built)).toBe('probe')
  })

  it('stops rewriting after a failed summary call', async () => {
    const built = await loop(log())
    built.adapter.failNext = new Error('model down')
    await expect(built.ctx.compaction.compactNow(built.agent, SIGNAL)).rejects.toThrow()
    expect(await probe(built)).toBe('probe')
  })

  it('does not touch other requests that pass while the summary call is pending', async () => {
    const built = await loop(log())
    let probed = false
    built.ctx.on('llm/stream', async function* (options, next) {
      if (options.purpose === 'compaction' && !probed) {
        probed = true
        const requests = [
          { provider: MODEL, model: MODEL, messages: [createUserMessage({ content: [{ type: 'text', text: 'title' }], source: { kind: 'user' } })], purpose: 'session-title' as const, sessionId: built.agent.session.id },
          { provider: MODEL, model: MODEL, messages: [createUserMessage({ content: [{ type: 'text', text: 'other' }], source: { kind: 'user' } })], purpose: 'compaction' as const, sessionId: SessionId('another-session') },
        ]
        for (const request of requests) for await (const chunk of built.ctx.llm.stream(request)) void chunk
      }
      yield* next()
    })
    await built.ctx.compaction.compactNow(built.agent, SIGNAL)
    const texts = built.adapter.requests.map(request => lastText(request))
    expect(texts).toContain('title')
    expect(texts).toContain('other')
    expect(built.adapter.compactionRequests().some(request => lastText(request).includes('## Chronological Log'))).toBe(true)
  })
})

describe('rewriting the final message', () => {
  const user = (text: string): RequestMessage => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

  it('appends the rule to the last text block of the final user message', () => {
    const out = appendLogRule([user('a'), user('instruction')], 'RULE')
    expect(out).toHaveLength(2)
    expect(out[0]?.content).toEqual([{ type: 'text', text: 'a' }])
    expect(out[1]?.content).toEqual([{ type: 'text', text: 'instructionRULE' }])
  })

  it('fails loudly when the request does not end with a user text message', () => {
    expect(() => appendLogRule([], 'RULE')).toThrow(`${name}: the summary request does not end with a user text message`)
    const thought: RequestMessage = { ...user('x'), content: [{ type: 'reasoning', text: 'hmm' }] }
    expect(() => appendLogRule([thought], 'RULE')).toThrow('does not end with a user text message')
    const reply: RequestMessage = createAssistantMessage({ content: [{ type: 'text', text: 'ok' }], source: { provider: 'p', model: 'm' } })
    expect(() => appendLogRule([reply], 'RULE')).toThrow('does not end with a user text message')
  })
})

/** A configuration object with a key that upstream does not accept. */
function unknownKeyConfig(): LogCompactionConfig {
  const config: LogCompactionConfig = {}
  Reflect.set(config, 'bogus', 1)
  return config
}

describe('configuration', () => {
  it('passes the upstream fields through, modelPolicies included', () => {
    const modelPolicies = [{ provider: 'ollama', model: 'qwen3-8b-32k', headroomTokens: 6672, maxTokens: 2048 }]
    const settings = { auto: false, headroomTokens: 9000, maxTokens: 3000, modelPolicies }
    const make = (): Context => {
      const ctx = new Context()
      void new LlmRuntime(ctx)
      void new SessionStore(ctx)
      new SessionProjectionRegistry(ctx)
      void new TokenMeter(ctx)
      disposers.push(async () => { await ctx.fiber.dispose() })
      return ctx
    }
    const reference = new BasicCompactionEngine(make(), settings)
    const ours = new LogCompactionEngine(make(), Object.assign({}, settings, { logMaxEntries: 12, firstRequestMaxChars: 80 }))
    expect(ours.config).toEqual(reference.config)
    expect(ours.config.modelPolicies).toEqual(modelPolicies)
  })

  it('resolves defaults and rejects values that cannot work', () => {
    expect(resolveLogConfig({})).toEqual({ logMaxEntries: 60, firstRequestMaxChars: 300 })
    expect(resolveLogConfig({ logMaxEntries: 2, firstRequestMaxChars: 1 })).toEqual({ logMaxEntries: 2, firstRequestMaxChars: 1 })
    for (const bad of [1, 0, -3, 2.5, Number.NaN]) {
      expect(() => resolveLogConfig({ logMaxEntries: bad })).toThrow(`${name}: logMaxEntries must be an integer of at least 2`)
    }
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => resolveLogConfig({ firstRequestMaxChars: bad })).toThrow(`${name}: firstRequestMaxChars must be a positive integer`)
    }
  })

  it('fails the engine constructor on a bad value and on an unknown upstream key', () => {
    const ctx = new Context()
    void new LlmRuntime(ctx)
    void new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    void new TokenMeter(ctx)
    disposers.push(async () => { await ctx.fiber.dispose() })
    expect(() => new LogCompactionEngine(ctx, { logMaxEntries: 1 })).toThrow('logMaxEntries')
    expect(() => new LogCompactionEngine(ctx, unknownKeyConfig())).toThrow('bogus')
  })

  it('constructs with no configuration and the upstream defaults', () => {
    const ctx = new Context()
    void new LlmRuntime(ctx)
    void new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    void new TokenMeter(ctx)
    disposers.push(async () => { await ctx.fiber.dispose() })
    expect(new LogCompactionEngine(ctx).config.headroomTokens).toBe(65_536)
  })

  it('declares upstream fields and its own two fields in the schema', () => {
    const parsed = LogCompactionEngine.Config({ logMaxEntries: 5, firstRequestMaxChars: 9, headroomTokens: 100, modelPolicies: [] })
    expect(parsed).toMatchObject({ logMaxEntries: 5, firstRequestMaxChars: 9, headroomTokens: 100, modelPolicies: [] })
    expect(() => {
      const bad: unknown = JSON.parse('{"logMaxEntries":"many"}')
      Reflect.apply(LogCompactionEngine.Config, undefined, [bad])
    }).toThrow()
  })
})
