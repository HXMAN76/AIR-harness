import { describe, expect, it } from 'vitest'
import { isSendAttempt, REFUSAL } from '../src/guard.ts'

const tool = (action: string): string => `mcp__browser__browser_${action}`

describe('isSendAttempt', () => {
  it.each([
    ['click', { element: 'Send', ref: 'e12' }],
    ['click', { element: 'Send (Ctrl-Enter) button', ref: 'e3' }],
    ['click', { ref: 'send-button' }],
    ['click', { selector: 'div[aria-label="Send"]' }],
    ['double_click', { element: 'send message' }],
    ['press_key', { key: 'Control+Enter' }],
    ['press_key', { key: 'Ctrl+Enter' }],
    ['press_key', { key: 'Meta+Enter' }],
    ['press_key', { key: 'ControlOrMeta+Enter' }],
    ['press_key', { key: 'Cmd + Return' }],
    ['type', { element: 'Message body', ref: 'e5', text: 'hi', submit: true }],
    ['evaluate', { function: '() => document.querySelector("[aria-label=Send]").click()' }],
    ['run_code', { code: 'await page.keyboard.press("Control+Enter")' }],
    ['run_code_unsafe', { code: 'form.requestSubmit()' }],
  ])('blocks %s %j', (action, args) => {
    expect(isSendAttempt(tool(action), args)).toBe(true)
  })

  it.each([
    ['click', { element: 'Compose', ref: 'e1' }],
    ['click', { element: 'Sender name', ref: 'e2' }],
    ['click', {}],
    ['press_key', { key: 'Enter' }],
    ['press_key', { key: 'Control+a' }],
    ['press_key', {}],
    ['type', { element: 'To', ref: 'e4', text: 'asha@example.com' }],
    ['type', { element: 'To', ref: 'e4', text: 'x', submit: false }],
    ['evaluate', { function: '() => document.title' }],
    ['navigate', { url: 'https://mail.google.com' }],
    ['snapshot', {}],
  ])('allows %s %j', (action, args) => {
    expect(isSendAttempt(tool(action), args)).toBe(false)
  })

  it('ignores tools that are not browser tools and non-object arguments', () => {
    expect(isSendAttempt('open', { value: 'send' })).toBe(false)
    expect(isSendAttempt('mcp__other__click', { element: 'Send' })).toBe(false)
    expect(isSendAttempt('pwsh', 'send')).toBe(false)
    expect(isSendAttempt(tool('click'), 'Send')).toBe(false)
    expect(isSendAttempt(tool('click'), null)).toBe(false)
    expect(isSendAttempt(tool('evaluate'), { function: 5 })).toBe(false)
  })

  it('has the model-visible refusal text', () => {
    expect(REFUSAL).toBe('Sending is locked until the user confirms.')
  })
})
