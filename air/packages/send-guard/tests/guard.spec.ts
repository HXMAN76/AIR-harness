import { describe, expect, it } from 'vitest'
import { isBrowserTool, isSendAttempt, newTargetState, REFUSAL } from '../src/guard.ts'

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

  it.each(['Enter', 'NumpadEnter', 'Space', ' ', 'return'])('blocks %j on a key press that names a Send element', (key) => {
    expect(isSendAttempt(tool('press_key'), { key, element: 'Send button', ref: 'e7' })).toBe(true)
  })

  it('blocks Enter or Space right after a click or hover that targeted a Send element, until another element is targeted', () => {
    const state = newTargetState()
    expect(isSendAttempt(tool('hover'), { element: 'Send', ref: 'e7' }, state)).toBe(false)
    expect(isSendAttempt(tool('press_key'), { key: 'Enter' }, state)).toBe(true)
    expect(isSendAttempt(tool('press_key'), { key: 'Space' }, state)).toBe(true)
    expect(isSendAttempt(tool('press_key'), { key: 'a' }, state)).toBe(false)
    expect(isSendAttempt(tool('click'), { element: 'Subject', ref: 'e3' }, state)).toBe(false)
    expect(isSendAttempt(tool('press_key'), { key: 'Enter' }, state)).toBe(false)
  })

  it('blocks a key press that names a ref previously described as Send', () => {
    const state = newTargetState()
    isSendAttempt(tool('snapshot'), {}, state)
    isSendAttempt(tool('click'), { element: 'Compose', ref: 'e1' }, state)
    isSendAttempt(tool('type'), { element: 'Send (Ctrl-Enter)', ref: 'e9', text: 'x' }, state)
    isSendAttempt(tool('click'), { element: 'Body', ref: 'e2' }, state)
    expect(isSendAttempt(tool('press_key'), { key: 'Enter', ref: 'e9' }, state)).toBe(true)
    expect(isSendAttempt(tool('press_key'), { key: 'Enter', ref: 'e2' }, state)).toBe(false)
  })

  it('forgets the Send focus on navigation', () => {
    const state = newTargetState()
    isSendAttempt(tool('click'), { element: 'Send', ref: 'e7' }, state)
    isSendAttempt(tool('navigate'), { url: 'https://example.org' }, state)
    expect(isSendAttempt(tool('press_key'), { key: 'Enter' }, state)).toBe(false)
  })

  it.each([
    '() => document.querySelector("#send").submit()',
    '() => form.requestSubmit()',
    'el.dispatchEvent(new MouseEvent("click"))',
    'document.querySelector("[aria-label=Send]").click()',
  ])('blocks a script on send-like selectors: %s', (code) => {
    expect(isSendAttempt(tool('evaluate'), { function: code })).toBe(true)
  })

  it('treats a script that targets a Send ref as a send', () => {
    const state = newTargetState()
    isSendAttempt(tool('hover'), { element: 'Send', ref: 'e7' }, state)
    expect(isSendAttempt(tool('evaluate'), { function: '(el) => 1', ref: 'e7' }, state)).toBe(true)
  })

  it('knows browser tools by name', () => {
    expect(isBrowserTool('mcp__browser__browser_click')).toBe(true)
    expect(isBrowserTool('pwsh')).toBe(false)
  })

  it('has the model-visible refusal text', () => {
    expect(REFUSAL).toBe('Sending is locked until the user confirms.')
  })
})
