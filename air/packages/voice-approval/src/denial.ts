/** Finding a voice-approval denial in the events of an agent run, for the voice controller. Pure. */
import { approvalDigest } from './digest.ts'
import { escalationSummary, isEscalation } from './summary.ts'

/** Start of the model-visible denial text. */
export const DENIAL_PREFIX = 'Needs voice approval: '

/** One session event as far as this module reads it. */
export interface EventLike {
  readonly type: string
  readonly data?: unknown
}

/** What the controller needs to ask the person. */
export interface ApprovalDenial {
  /** One line to speak after "It wants to". */
  summary: string
  /** Digest of the denied call; the approval token is bound to it. */
  digest: string
}

interface ToolCallBlock {
  type: 'tool-call'
  name: string
  arguments: unknown
}

function toolCalls(event: EventLike): ToolCallBlock[] {
  if (event.type !== 'assistant/message') return []
  const message = (event.data as { message?: { content?: unknown } } | undefined)?.message
  const content = message?.content
  if (!Array.isArray(content)) return []
  return content.filter((block): block is ToolCallBlock =>
    typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool-call' && typeof (block as { name?: unknown }).name === 'string')
}

/**
 * @param events - the events of one run.
 * @returns the denied escalation (the last escalating tool call), or undefined when no event other than the model's own
 *   messages carries the denial text.
 */
export function findApprovalDenial(events: readonly EventLike[]): ApprovalDenial | undefined {
  const denied = events.some(event => event.type !== 'assistant/message' && JSON.stringify(event.data ?? null).includes(DENIAL_PREFIX))
  if (!denied) return undefined
  const calls = events.flatMap(toolCalls).filter(call => isEscalation(call.arguments))
  const last = calls.at(-1)
  if (last === undefined) return undefined
  return { summary: escalationSummary(last.arguments), digest: approvalDigest(last.name, last.arguments) }
}
