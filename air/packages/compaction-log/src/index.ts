/**
 * Compaction engine for small local models. It is upstream's `BasicCompactionEngine` with one change: the
 * instruction of the summary request ends with a section that requires a numbered chronological log of the
 * user requests and tool calls and a verbatim first request. A summary written under the stock instruction
 * kept only the most recent file on an 8B model, and the model then named that file as the one it read first.
 * Replay, thresholds, policies, checkpoint framing, and the durable log are upstream's, unchanged.
 *
 * @module @air/dsh-compaction-log
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { RequestMessage } from '@deepseek-ai/dsh-llm'

export const name = 'air-compaction-log'

/** Upstream fields plus the two fields of the appended section. */
export interface LogCompactionConfig extends BasicCompactionConfig {
  /** Most entries the chronological log keeps; older entries are merged into one line. Default 60. */
  logMaxEntries?: number
  /** Most characters of the first request that the summary quotes. Default 300. */
  firstRequestMaxChars?: number
}

/** The two fields of the appended section with defaults applied. */
export interface ResolvedLogConfig {
  readonly logMaxEntries: number
  readonly firstRequestMaxChars: number
}

/**
 * Apply defaults and reject values the instruction cannot honor.
 * @param config - raw engine configuration.
 * @returns the two section fields, complete.
 * @throws Error naming the offending field when a value is not usable.
 */
export function resolveLogConfig(config: LogCompactionConfig): ResolvedLogConfig {
  const logMaxEntries = config.logMaxEntries ?? 60
  const firstRequestMaxChars = config.firstRequestMaxChars ?? 300
  if (!Number.isSafeInteger(logMaxEntries) || logMaxEntries < 2) {
    throw new Error(`${name}: logMaxEntries must be an integer of at least 2, got ${String(logMaxEntries)}`)
  }
  if (!Number.isSafeInteger(firstRequestMaxChars) || firstRequestMaxChars < 1) {
    throw new Error(`${name}: firstRequestMaxChars must be a positive integer, got ${String(firstRequestMaxChars)}`)
  }
  return { logMaxEntries, firstRequestMaxChars }
}

/**
 * Build the text appended to upstream's summary instruction.
 * @param settings - resolved cap and truncation length.
 * @returns the section text, starting with a blank line so it follows the stock instruction.
 */
export function buildLogRule(settings: ResolvedLogConfig): string {
  return [
    '',
    '',
    'Two more sections are REQUIRED in addition to the structure above. Add them after "## Critical Context", in this order, and keep every earlier section.',
    '',
    '## Chronological Log',
    '- A numbered list, oldest first, of EVERY user request and EVERY tool call made so far, in the order they happened.',
    '- One entry per user request (a few words) and one per tool call: the tool name, its key argument (file path, command, or query), and a few words of the result.',
    '- If the conversation already contains a <compacted-summary> block, copy every entry of its Chronological Log forward in the same order without dropping or reordering any, then number the new entries after them.',
    `- Keep at most ${String(settings.logMaxEntries)} entries. When there would be more, merge the OLDEST entries into one line that still names their files and commands.`,
    '',
    '## First request',
    `- Quote the first user request of the whole session verbatim, cut to at most ${String(settings.firstRequestMaxChars)} characters. If a prior checkpoint already quotes it, keep that quote.`,
  ].join('\n')
}

/**
 * Append the rule to the final user message of a summary request, which holds upstream's instruction.
 * @param messages - messages of the summary request.
 * @param rule - text to append to the last text block of the final message.
 * @returns a copy of the messages with the final message extended.
 * @throws Error when the final message is not a user message that ends with a text block.
 */
export function appendLogRule(messages: readonly RequestMessage[], rule: string): RequestMessage[] {
  const last = messages.at(-1)
  const block = last?.content.at(-1)
  if (last?.role !== 'user' || block?.type !== 'text') {
    throw new Error(`${name}: the summary request does not end with a user text message`)
  }
  return [
    ...messages.slice(0, -1),
    { ...last, content: [...last.content.slice(0, -1), { ...block, text: block.text + rule }] },
  ]
}

/** Validate the two section fields, then remove them so upstream's strict key check accepts the rest. */
function upstreamPart(config: LogCompactionConfig): BasicCompactionConfig {
  resolveLogConfig(config)
  const rest: BasicCompactionConfig = Object.assign({}, config)
  Reflect.deleteProperty(rest, 'logMaxEntries')
  Reflect.deleteProperty(rest, 'firstRequestMaxChars')
  return rest
}

/**
 * Upstream's basic engine with the chronological-log section appended to its summary instruction.
 * `summarize()` is the hook upstream documents; the stream of the summary call it makes is rewritten
 * through the `llm/stream` waterfall for the duration of that call only.
 */
export class LogCompactionEngine extends BasicCompactionEngine {
  static override Config: z<LogCompactionConfig> = z.intersect([
    BasicCompactionEngine.Config,
    z.object({
      logMaxEntries: z.number().step(1).min(2).description('Most entries of the chronological log; older entries are merged into one line.'),
      firstRequestMaxChars: z.number().step(1).min(1).description('Most characters of the first request that the summary quotes.'),
    }),
  ])

  private readonly rule: string

  constructor(ctx: Context, config: LogCompactionConfig = {}) {
    super(ctx, upstreamPart(config))
    this.rule = buildLogRule(resolveLogConfig(config))
  }

  /**
   * Run upstream's summarization with the rule appended to its instruction.
   * @param input - replayed conversation prefix to condense.
   * @param agent - supplies routed-model history, fallback model, and session id.
   * @param signal - optional cancellation forwarded to the adapter.
   * @returns upstream's summary result.
   */
  protected override async summarize(
    input: Parameters<BasicCompactionEngine['summarize']>[0],
    agent: Agent,
    signal?: AbortSignal,
  ): ReturnType<BasicCompactionEngine['summarize']> {
    // The stream is rewritten once: the nested call below would match this listener again.
    const stop = this.ctx.on('llm/stream', (options, next) => {
      if (options.purpose !== 'compaction' || options.sessionId !== agent.session.id) return next()
      stop()
      return this.ctx.llm.stream({ ...options, messages: appendLogRule(options.messages, this.rule) })
    })
    try {
      return await super.summarize(input, agent, signal)
    } finally {
      stop()
    }
  }
}

export default LogCompactionEngine
