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

/** Longest tool or reason text spoken, in characters. */
const CLIP = 120

interface Asked {
  toolName: string
  reason: string
}

function asked(event: EventLike): [string, Asked] | undefined {
  if (event.type !== 'approval/asked') return undefined
  const data = event.data as { id?: unknown; toolName?: unknown; reason?: unknown } | undefined
  if (typeof data?.id !== 'string' || typeof data.toolName !== 'string') return undefined
  return [data.id, { toolName: data.toolName, reason: typeof data.reason === 'string' ? data.reason : '' }]
}

/**
 * The approval requests this run raised that were rejected, other than the escalations the voice flow asks about
 * (those never reach the answerer without a token). The answerer rejects everything else, silently for the model; the
 * voice app says what was refused.
 * @param events - the events of one run.
 * @returns one line for the last rejected request ("use plugin_manager", or the tool's own reason), or undefined.
 */
export function findRefusedAsk(events: readonly EventLike[]): string | undefined {
  const pending = new Map<string, Asked>()
  let refused: Asked | undefined
  for (const event of events) {
    const ask = asked(event)
    if (ask !== undefined) pending.set(ask[0], ask[1])
    else if (event.type === 'approval/decided') {
      const data = event.data as { id?: unknown; outcome?: unknown } | undefined
      const request = typeof data?.id === 'string' ? pending.get(data.id) : undefined
      if (request !== undefined && data?.outcome === 'rejected') refused = request
    }
  }
  if (refused === undefined) return undefined
  const text = (refused.reason === '' ? `use ${refused.toolName}` : refused.reason).replaceAll(/\s+/g, ' ').trim()
  return text.length > CLIP ? `${text.slice(0, CLIP - 1)}…` : text
}
