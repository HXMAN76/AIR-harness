/** Parsing of spoken mail requests, spoken addresses, and recipient names. Pure. */
import type { Contact } from './client.ts'
import { isAddress } from './mime.ts'

/** A spoken mail request. */
export type MailIntent =
  | { kind: 'connect' }
  | { kind: 'disconnect' }
  | { kind: 'list' }
  | { kind: 'open'; index: number }
  | { kind: 'summarize' }
  | { kind: 'compose-help' }
  | { kind: 'send'; name: string; body: string; subject?: string | undefined; polish: boolean }

function normalise(text: string): string {
  return text.toLowerCase().replaceAll(/['’]/g, '').replaceAll(/[^a-z0-9 ]+/g, ' ').replaceAll(/\s+/g, ' ').trim()
}

const CONNECT = /^(?:connect|set up|sign in to|log in to|link)(?: my| the)? (?:gmail|google mail|email|e mail)$/
const DISCONNECT = /^(?:disconnect|sign out of|log out of|unlink|forget)(?: my| the)? (?:gmail|google mail)(?: account)?$/
const MAIL_NOUN = '(?:mails?|e ?mails?)'
const LIST = new RegExp(
  '^(?:(?:read|check)(?: me)?(?: my| the)?(?: (?:new|unread|important))* (?:gmail|mails?|e ?mails?|inbox)'
  + `|(?:do i have )?any (?:new|unread|important)(?: unread)? ${MAIL_NOUN})(?: please)?$`,
)
const SUMMARIZE = /^(?:summari[sz]e|give me a summary of|summary of)(?: it| that| this| the mail| the email| the message)?$/
const COMPOSE_HELP = /^(?:send|write|compose)(?: (?:a|an))? (?:gmail|e ?mail|mail)$/

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, one: 1, two: 2, three: 3, four: 4, five: 5,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
}
const OPEN = new RegExp(
  '^(?:read|open)(?: me)?(?: the)?(?: (?:mail|email|message|number))?'
  + ' (first|second|third|fourth|fifth|one|two|three|four|five|1st|2nd|3rd|4th|5th|[1-5])(?: (?:one|mail|email|message))?$',
)

const POLISH = /[,.]?\s*(?:and )?(?:please )?(?:write|make|word|say) it (nicely|politely|formally|professionally)\s*[.!?]*$/i
const SEND = new RegExp(
  String.raw`^(?:(?:send|write|compose)(?: (?:a|an|the))?(?: (?:e-?mail|mail|gmail))?(?: to)?|e-?mail|mail)\s+(.+?)(?:\s+subject\s+(.+?))?\s+(?:saying|that says|and say|says|that|and tell (?:him|her|them)(?: that)?)\s+(.+)$`,
  'i',
)

/**
 * @param text - body text.
 * @returns the text with a capital first letter and final punctuation added when missing.
 */
export function sentence(text: string): string {
  const body = text.trim()
  const capital = body.charAt(0).toUpperCase() + body.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/**
 * Classify a mail request.
 * @param text - the spoken text in its original casing.
 * @param context - what the user can refer to: a listing for "read the first one", an open mail for "summarize it".
 * @returns the intent, or null when the text is not a mail request.
 */
export function parseMailIntent(text: string, context: { hasList: boolean; hasOpen: boolean }): MailIntent | null {
  const trimmed = text.trim().replace(/[.!?\s]+$/, '')
  const spoken = normalise(trimmed)
  if (CONNECT.test(spoken)) return { kind: 'connect' }
  if (DISCONNECT.test(spoken)) return { kind: 'disconnect' }
  if (LIST.test(spoken)) return { kind: 'list' }
  if (COMPOSE_HELP.test(spoken)) return { kind: 'compose-help' }
  if (context.hasOpen && SUMMARIZE.test(spoken)) return { kind: 'summarize' }
  const open = OPEN.exec(spoken)
  if (context.hasList && open !== null) return { kind: 'open', index: ORDINALS[open[1] as string] as number }
  const send = SEND.exec(text.trim())
  if (send === null) return null
  const polish = POLISH.test(send[3] as string)
  const body = (send[3] as string).replace(POLISH, '').trim()
  const name = (send[1] as string).replace(/^to\s+/i, '').trim()
  if (body === '' || name === '') return null
  return { kind: 'send', name, body: sentence(body), subject: send[2]?.trim(), polish }
}

/**
 * @param body - the message body.
 * @returns the default subject: the first six words, capitalised, without final punctuation.
 */
export function subjectFor(body: string): string {
  const words = body.trim().split(/\s+/).slice(0, 6).join(' ').replace(/[.!?,;:]+$/, '')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const DIGITS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}
const SYMBOLS: Record<string, string> = { dot: '.', underscore: '_', dash: '-', hyphen: '-', plus: '+', at: '@' }

/**
 * Turn a spoken address ("asha dot rao at gmail dot com") into `asha.rao@gmail.com`.
 * @param spoken - the words; an address already typed out passes through.
 * @returns the address, or null when the result is not a plain address.
 */
export function normaliseSpokenAddress(spoken: string): string | null {
  const direct = spoken.trim().replace(/[.!?,\s]+$/, '')
  if (isAddress(direct)) return direct.toLowerCase()
  const out = normalise(direct.replaceAll('.', ' dot ').replaceAll('@', ' at ').replaceAll('_', ' underscore ').replaceAll('-', ' dash '))
    .split(' ')
    .map(word => SYMBOLS[word] ?? DIGITS[word] ?? word)
  const joined = out.join('')
  const at = joined.lastIndexOf('@')
  if (at < 0) return null
  const address = joined.slice(0, at).replaceAll('@', '') + '@' + joined.slice(at + 1)
  return isAddress(address) ? address : null
}

function tokens(text: string): string[] {
  return normalise(text).split(' ').filter(token => token !== '')
}

/** Edit distance of at most 1 (insert, delete, or substitute one letter). */
function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

function tokenMatches(spoken: string, have: string[]): boolean {
  return have.some(token => token.startsWith(spoken)
    || (token.length >= 3 && spoken.startsWith(token))
    || (spoken.length >= 4 && near(spoken, token)))
}

/**
 * Keep the contacts whose display name or address matches every word of the spoken name (case-insensitive;
 * prefix match, or one letter off for words of four letters or more).
 * @param contacts - candidates from the mailbox.
 * @param spoken - the spoken name.
 * @returns the matches in their given order.
 */
export function matchContacts(contacts: Contact[], spoken: string): Contact[] {
  const want = tokens(spoken)
  if (want.length === 0) return []
  return contacts.filter((contact) => {
    const have = [...tokens(contact.name), ...tokens(contact.address.split('@')[0] as string)]
    return want.every(token => tokenMatches(token, have))
  })
}

/**
 * @param contact - a contact.
 * @returns what to call them aloud: the display name, else the part of the address before the at sign.
 */
export function contactLabel(contact: Contact): string {
  return contact.name !== '' ? contact.name : (contact.address.split('@')[0] as string)
}

/**
 * Pick one of the offered contacts from a spoken answer: an ordinal ("the second") or words of exactly one name.
 * @param answer - the spoken answer.
 * @param offered - the contacts that were offered.
 * @returns the contact, or undefined when the answer does not single one out.
 */
export function chooseContact(answer: string, offered: Contact[]): Contact | undefined {
  const spoken = normalise(answer)
  const ordinal = /^(?:the )?(first|second|third|1st|2nd|3rd|one|two|three)(?: one)?$/.exec(spoken)
  if (ordinal !== null) return offered[(ORDINALS[ordinal[1] as string] as number) - 1]
  const hits = matchContacts(offered, spoken)
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * @param address - an email address.
 * @returns the address with at and dot spelled out, so a speech engine reads it.
 */
export function spokenAddress(address: string): string {
  return address.replaceAll('@', ' at ').replaceAll('.', ' dot ')
}

/**
 * @param answer - the spoken answer to "Say yes to send."
 * @returns whether it is an exact yes: "yes", "yes please", or "yes send it".
 */
export function isYes(answer: string): boolean {
  return /^yes(?: please| send it)?$/.test(normalise(answer))
}
