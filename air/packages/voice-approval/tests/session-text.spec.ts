import { describe, expect, it } from 'vitest'
import { latestUserText, type SessionLike } from '../src/session-text.ts'

function session(events: Array<{ type: string; data?: unknown }>): SessionLike {
  return { seq: events.length, eventAt: seq => events[Number(seq)] }
}

describe('latestUserText', () => {
  it('returns the text blocks of the latest user message', () => {
    const events = [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'old' }] } },
      { type: 'assistant/message', data: {} },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }] } },
      { type: 'tool/call' },
    ]
    expect(latestUserText(session(events))).toBe('one\n\ntwo')
  })

  it('accepts string content and tolerates odd shapes', () => {
    expect(latestUserText(session([{ type: 'user/message', data: { content: 'plain' } }]))).toBe('plain')
    expect(latestUserText(session([{ type: 'user/message', data: { content: 7 } }]))).toBe('')
    expect(latestUserText(session([{ type: 'user/message', data: null }]))).toBe('')
    expect(latestUserText(session([{ type: 'user/message', data: { content: [null, { type: 'text' }] } }]))).toBe('\n')
  })

  it('returns undefined without a user message', () => {
    expect(latestUserText(session([]))).toBeUndefined()
    expect(latestUserText(session([{ type: 'turn/start' }]))).toBeUndefined()
  })
})
