/** Voice commands the app handles itself, before the agent sees the text. Pure. */

import type { Lang } from './frames.ts'

/** Model route: local Ollama, cloud conversation model, or cloud model with computer use. */
export type Route = 'local' | 'cloud' | 'screen'

/** A parsed command. `ask` is everything the agent should answer. */
export type VoiceCommand =
  | { kind: 'route'; route: Route }
  | { kind: 'new-conversation' }
  | { kind: 'cancel' }
  | { kind: 'memory-share'; on: boolean }
  | { kind: 'language'; lang: Lang }
  | { kind: 'end' }
  | { kind: 'ask'; text: string }

const ROUTE = /^(?:use|switch to|go to)(?: the)? (local|cloud|screen)(?: model| mode)?$|^(screen) mode on$/
const TAMIL_MODE = /^(?:(?:switch|go) to|use) tamil(?: mode)?$|^tamil mode(?: on)?$/
const ENGLISH_MODE = /^(?:(?:switch|go) to|use) english(?: mode)?$|^english mode(?: on)?$/
/** Tamil-script transliterations of "english mode" and "tamil mode", for a command spoken while the Tamil recogniser is active. */
const ENGLISH_MODE_TA = /^(?:இங்கிலீஷ்|ஆங்கிலம்)(?: மோட்| முறை)?$/u
const TAMIL_MODE_TA = /^தமிழ்(?: மோட்| முறை)?$/u
/** Ends a conversation: "stop", "that's all", "thank you (jarvis)". */
const END = /^(?:stop|(?:thats|that is) all|(?:thank you|thanks)(?: (?:very much|so much))?(?: jarvis)?|goodbye|bye)$/
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
  if (TAMIL_MODE.test(text) || TAMIL_MODE_TA.test(command.trim())) return { kind: 'language', lang: 'ta' }
  if (ENGLISH_MODE.test(text) || ENGLISH_MODE_TA.test(command.trim())) return { kind: 'language', lang: 'en' }
  if (END.test(text)) return { kind: 'end' }
  if (NEW_CONVERSATION.test(text)) return { kind: 'new-conversation' }
  if (CANCEL.test(text)) return { kind: 'cancel' }
  if (SHARE_ON.test(text)) return { kind: 'memory-share', on: true }
  if (SHARE_OFF.test(text)) return { kind: 'memory-share', on: false }
  return { kind: 'ask', text: command.trim() }
}

const SUGGEST_MAIL = /^(?:(?:my |the |your )?(?:important )?(?:mail|e-?mails?|inbox)|(?:read |check )?(?:my |the )?important (?:mail|e-?mails?))$/
const SUGGEST_NEWS = /^(?:(?:read )?(?:me )?(?:today s |the |todays )?(?:news|headlines)(?: please)?)$/

/**
 * Match a reply to the greeting's suggestions ("important mail", "the news") and give the full request for it.
 * @param text - what was said in a follow-up window.
 * @returns the request text, or null when it is not one of the suggestions.
 */
export function suggestionFor(text: string): string | null {
  const spoken = normalise(text)
  if (SUGGEST_MAIL.test(spoken)) return 'read my important mail'
  if (SUGGEST_NEWS.test(spoken)) return 'read the news'
  return null
}

const GUI = /\b(?:click|scroll|type (?:into|in)|press the|select the|on (?:the )?screen|this window|the button|drag)\b|\bfill (?:out |in )?the form\b/i

/**
 * @param text - an ask text.
 * @returns whether it needs GUI control (clicking, scrolling, typing into a window), which only the screen route can do.
 */
export function needsScreen(text: string): boolean {
  return GUI.test(text)
}

const REMEMBER = /^(?:please )?(?:remember|note|don['’]?t forget)(?: that)? (.+)$/i
const RECALL = /^(?:what do you remember about|do you remember) (.+)$/i

const EMAIL_SEND = /^(?:send|write|compose)(?: (?:a|an|the))? (?:gmail|e-?mail|mail)\b[\s,]*(.*)$/i
// "Open gmail" is not here: the operator opens it locally, with no model and no cloud key.
const EMAIL_CHECK = /^(?:check|read)(?: my)?(?: (?:important|unread))? (?:gmail|e-?mails?|mails?|inbox)$/i

/** The exact line the send rewrite tells the model to end its reply with, instead of pressing Send. */
export const CONFIRM_SEND = 'CONFIRM SEND'

/** An email request that needs the browser tools (read or send). */
export type EmailCommand = { kind: 'send'; details: string } | { kind: 'check' }

function stripEnd(text: string): string {
  return text.trim().replace(/[.!?,\s]+$/, '')
}

/**
 * Classify a spoken email request: send/write/compose a gmail, or check/read mail.
 * @param text - the ask text.
 * @returns the email request, or null when the text is not one.
 */
export function matchEmailCommand(text: string): EmailCommand | null {
  const trimmed = stripEnd(text)
  const send = EMAIL_SEND.exec(trimmed)
  if (send !== null) return { kind: 'send', details: captured(send).trim() }
  if (EMAIL_CHECK.test(trimmed)) return { kind: 'check' }
  return null
}

/** Read-only mail instruction for the agent: no attachments, no links inside mails, nothing sent. */
const READ_MAIL = 'Use the browser tools to open https://mail.google.com and list up to 5 unread messages in the Important or Primary view. Reply with one short spoken line per message in the form "From <sender>: <subject>." Never open attachments, never click links inside a mail, never reply, delete, or send anything.'

function emailInstruction(email: EmailCommand): string {
  if (email.kind === 'check') return READ_MAIL
  const details = email.details === '' ? 'ask me who it is for and what it should say' : email.details
  return `Use the browser tools to compose an email in Gmail at https://mail.google.com: ${details}. Fill in the recipient, a short subject, and the body, but do NOT press Send. End your reply with a one-sentence summary of the draft, then a final line that is exactly ${CONFIRM_SEND}`
}

/**
 * Turn memory phrases into explicit tool instructions, because a small model often answers "I'll remember" without calling the tool.
 * Email phrases become explicit browser-tool instructions the same way.
 * @param text - the ask text.
 * @returns the instruction for the agent, or the text unchanged.
 */
export function rewriteForAgent(text: string): string {
  const trimmed = text.trim()
  const recall = RECALL.exec(trimmed)
  if (recall !== null) return `Use memory_search for: ${stripEnd(captured(recall))}. Answer in one sentence.`
  const remember = REMEMBER.exec(trimmed)
  if (remember !== null) return `Use the memory_write tool with type user to save this note: ${stripEnd(captured(remember))}. Then reply "Noted."`
  const email = matchEmailCommand(trimmed)
  if (email !== null) return emailInstruction(email)
  return text
}

/** The text of the one capture group of a match. */
function captured(match: RegExpExecArray): string {
  return match.slice(1).join('')
}
