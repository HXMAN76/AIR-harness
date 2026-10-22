/** Which browser tool calls would send a message. Pure apart from the small per-session target state it updates. */

/** Model-visible refusal. */
export const REFUSAL = 'Sending is locked until the user confirms.'

const BROWSER_TOOL = /^mcp__[A-Za-z0-9_-]+?__browser_([a-z_]+)$/
const SEND_WORD = /\bsend\b/i
const SEND_KEYS = /(?:control|ctrl|meta|cmd|command|controlormeta)\s*\+\s*(?:enter|return)/i
/** A bare key that activates a focused button. */
const ACTIVATE_KEY = /^(?:enter|numpadenter|return|space| )$/i
/** Script tools can click anything, so a script that mentions sending or submitting is a send attempt. */
const SEND_SCRIPT = /\bsend\b|\bsubmit\b|\.click\s*\(|requestSubmit|dispatchEvent|keyboard\.press|Control\+Enter|Meta\+Enter/i
/** Actions that aim at one element and so change what has focus. */
const TARGETING = new Set(['click', 'double_click', 'hover', 'type', 'select_option', 'drag', 'check', 'uncheck'])

/** What the guard remembers about one session's browser calls. */
export interface TargetState {
  /** The element most recently targeted is described as Send, so Enter or Space would activate it. */
  sendFocused: boolean
  /** Element descriptions seen with each ref, because key presses carry no target of their own. */
  names: Map<string, string>
  /** The user message these facts belong to; a new message starts a new turn. */
  said: string | undefined
}

/** @returns an empty state. */
export function newTargetState(): TargetState {
  return { sendFocused: false, names: new Map(), said: undefined }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * @param name - a tool name.
 * @returns whether it is a browser tool (`mcp__<server>__browser_<action>`).
 */
export function isBrowserTool(name: string): boolean {
  return BROWSER_TOOL.test(name)
}

/**
 * @param name - the tool name.
 * @param args - the parsed tool arguments.
 * @param state - what earlier calls of the session targeted; updated here.
 * @returns whether the call would send: a click on an element described as Send, Ctrl/Cmd+Enter, Enter or Space
 *   while a Send element is focused or targeted, typing with submit, or a script that sends or submits.
 */
export function isSendAttempt(name: string, args: unknown, state: TargetState = newTargetState()): boolean {
  const action = BROWSER_TOOL.exec(name)?.[1]
  if (action === undefined) return false
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const ref = text(record.ref)
  const described = `${text(record.element)} ${ref} ${text(record.selector)} ${state.names.get(ref) ?? ''}`
  if (ref !== '' && text(record.element) !== '') state.names.set(ref, text(record.element))
  if (TARGETING.has(action)) state.sendFocused = SEND_WORD.test(described)
  if (action === 'navigate') state.sendFocused = false
  switch (action) {
    case 'click':
    case 'double_click':
      return SEND_WORD.test(described)
    case 'press_key': {
      const key = text(record.key).trim()
      if (SEND_KEYS.test(key)) return true
      return ACTIVATE_KEY.test(key === '' ? text(record.key) : key) && (state.sendFocused || SEND_WORD.test(described))
    }
    case 'type':
      return record.submit === true
    case 'evaluate':
    case 'run_code':
    case 'run_code_unsafe':
      return SEND_SCRIPT.test(`${text(record.function)} ${text(record.code)} ${text(record.element)} ${state.names.get(ref) ?? ''}`)
    default:
      return false
  }
}
