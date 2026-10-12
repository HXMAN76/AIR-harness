import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'

export const MODEL = 'mock'
export const SIGNAL = new AbortController().signal

/** One answer per request; every request is recorded in full. */
export class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  /** Failure thrown by the next `stream` call instead of an answer. */
  failNext: Error | undefined
  /** Context window the adapter reports. */
  contextWindow = 100_000

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.failNext !== undefined) {
      const error = this.failNext
      this.failNext = undefined
      throw error
    }
    await Promise.resolve()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  /** The requests whose purpose is compaction. */
  compactionRequests(): GenerateOptions[] {
    return this.requests.filter(request => request.purpose === 'compaction')
  }
}

export interface Loop {
  readonly ctx: Context
  readonly agent: Agent
  readonly adapter: RecordingAdapter
}

/** Text of the last request message, joined over its text blocks. */
export function lastText(request: GenerateOptions): string {
  const message: RequestMessage | undefined = request.messages.at(-1)
  return (message?.content ?? []).map(block => block.type === 'text' ? block.text : '').join('')
}

/**
 * Real agent loop with a recording adapter and one finished turn, ready for manual compaction.
 * @param mountEngine - creates the compaction engine under test on the context.
 * @returns the context, agent, and adapter.
 */
export async function buildLoop(
  mountEngine: (ctx: Context, config: BasicCompactionConfig) => unknown,
  config: BasicCompactionConfig = { auto: false },
): Promise<Loop> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter([MODEL], adapter)
  mountEngine(ctx, config)
  const agent = await ctx.agentLoop.create(SessionId('log-compact'), { provider: MODEL, model: MODEL })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'read file f1 first, then the others '.repeat(40) }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  return { ctx, agent, adapter }
}
