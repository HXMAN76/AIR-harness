/** Which browser tool calls would send a message. Pure. */

/** Model-visible refusal. */
export const REFUSAL = 'Sending is locked until the user confirms.'

const BROWSER_TOOL = /^mcp__[A-Za-z0-9_-]+?__browser_([a-z_]+)$/
const SEND_WORD = /\bsend\b/i
const SEND_KEYS = /(?:control|ctrl|meta|cmd|command|controlormeta)\s*\+\s*(?:enter|return)/i
/** Script tools can click anything, so a script that mentions sending or submitting is a send attempt. */
const SEND_SCRIPT = /\bsend\b|\bsubmit\b|\.click\s*\(|requestSubmit|dispatchEvent|keyboard\.press|Control\+Enter|Meta\+Enter/i

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * @param name - the tool name (`mcp__<server>__browser_<action>`).
 * @param args - the parsed tool arguments.
 * @returns whether the call would send: a click on an element described as Send, Ctrl/Cmd+Enter, typing with submit,
 *   or a script that sends or submits.
 */
export function isSendAttempt(name: string, args: unknown): boolean {
  const action = BROWSER_TOOL.exec(name)?.[1]
  if (action === undefined) return false
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  switch (action) {
    case 'click':
    case 'double_click':
      return SEND_WORD.test(`${text(record.element)} ${text(record.ref)} ${text(record.selector)}`)
    case 'press_key':
      return SEND_KEYS.test(text(record.key))
    case 'type':
      return record.submit === true
    case 'evaluate':
    case 'run_code':
    case 'run_code_unsafe':
      return SEND_SCRIPT.test(`${text(record.function)} ${text(record.code)} ${text(record.element)}`)
    default:
      return false
  }
}
