/** The most recent user message of a session, read from its durable log. */
import { SessionSeq } from '@deepseek-ai/dsh-session'

/** The part of a `Session` read here. */
export interface SessionLike {
  readonly seq: number
  eventAt(seq: SessionSeq): { readonly type: string; readonly data?: unknown } | undefined
}

function textOf(message: unknown): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      const record = typeof block === 'object' && block !== null ? block as { type?: unknown; text?: unknown } : {}
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .join('\n')
}

/**
 * @param session - the session whose log is read.
 * @returns the text of the latest `user/message` event, or undefined when there is none.
 */
export function latestUserText(session: SessionLike): string | undefined {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(SessionSeq(seq))
    if (event?.type === 'user/message') return textOf(event.data)
  }
  return undefined
}
