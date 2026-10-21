/** Voice commands the app handles itself, before the agent sees the text. Pure. */

/** Model route: local Ollama, cloud conversation model, or cloud model with computer use. */
export type Route = 'local' | 'cloud' | 'screen'

/** A parsed command. `ask` is everything the agent should answer. */
export type VoiceCommand =
  | { kind: 'route'; route: Route }
  | { kind: 'new-conversation' }
  | { kind: 'cancel' }
  | { kind: 'memory-share'; on: boolean }
  | { kind: 'ask'; text: string }

const ROUTE = /^(?:use|switch to|go to)(?: the)? (local|cloud|screen)(?: model| mode)?$|^(screen) mode on$/
const NEW_CONVERSATION = /^(?:start )?(?:a )?new conversation$/
const CANCEL = /^(?:cancel(?: that)?|never mind)$/
const SHARE_ON = /^(?:share memory with(?: the)? cloud|turn on memory sharing)$/
const SHARE_OFF = /^(?:stop sharing memory|dont share memory(?: with(?: the)? cloud)?|turn off memory sharing)$/

function normalise(text: string): string {
  return text.toLowerCase().replaceAll(/['’]/g, '').replaceAll(/[^a-z0-9 ]+/g, ' ').replaceAll(/\s+/g, ' ').trim()
}

/**
 * Classify a command (the text after the wake phrase).
 * @param command - command text in its original casing.
 * @returns the app command, or `ask` with the trimmed original text.
 */
export function parseVoiceCommand(command: string): VoiceCommand {
  const text = normalise(command)
  const route = ROUTE.exec(text)
  if (route !== null) return { kind: 'route', route: (route[1] ?? route[2]) as Route }
  if (NEW_CONVERSATION.test(text)) return { kind: 'new-conversation' }
  if (CANCEL.test(text)) return { kind: 'cancel' }
  if (SHARE_ON.test(text)) return { kind: 'memory-share', on: true }
  if (SHARE_OFF.test(text)) return { kind: 'memory-share', on: false }
  return { kind: 'ask', text: command.trim() }
}

const REMEMBER = /^(?:please )?(?:remember|note|don['’]?t forget)(?: that)? (.+)$/i
const RECALL = /^(?:what do you remember about|do you remember) (.+)$/i

function stripEnd(text: string): string {
  return text.trim().replace(/[.!?,\s]+$/, '')
}

/**
 * Turn memory phrases into explicit tool instructions, because a small model often answers "I'll remember" without calling the tool.
 * @param text - the ask text.
 * @returns the instruction for the agent, or the text unchanged.
 */
export function rewriteForAgent(text: string): string {
  const trimmed = text.trim()
  const recall = RECALL.exec(trimmed)
  if (recall !== null) return `Use memory_search for: ${stripEnd(captured(recall))}. Answer in one sentence.`
  const remember = REMEMBER.exec(trimmed)
  if (remember !== null) return `Use the memory_write tool with type user to save this note: ${stripEnd(captured(remember))}. Then reply "Noted."`
  return text
}

/** The text of the one capture group of a match. */
function captured(match: RegExpExecArray): string {
  return match.slice(1).join('')
}
