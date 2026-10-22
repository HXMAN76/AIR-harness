/** The Gmail REST calls the voice app makes: list, get, find contacts, send. Plain `fetch`; bearer tokens come from {@link TokenSource}. */
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import type { FetchFn } from './auth.ts'
import { base64url, decodeHeader, extractText, parseAddressList, toPart, type Mailbox } from './mime.ts'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Source of bearer tokens: `force` asks for a fresh one after a 401. */
export interface TokenSource {
  accessToken(force?: boolean, announce?: () => Promise<void>): Promise<string>
}

/** A Gmail call that Google answered with an error status. */
export class GmailApiError extends Error {
  constructor(readonly status: number) {
    super(`Gmail returned ${status}.`)
    this.name = 'GmailApiError'
  }
}

/** One message in a listing. */
export interface MailSummary {
  id: string
  from: Mailbox
  subject: string
  date: string
}

/** A person found in the mailbox. */
export interface Contact {
  name: string
  address: string
  /** How many of the sampled messages carried this address. */
  count: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

/** @returns the ids of a message in a path or query: only the characters Gmail uses. */
function safeId(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid message id.')
  return id
}

function headerValue(message: Record<string, unknown>, name: string): string {
  const headers = record(message.payload)?.headers
  if (!Array.isArray(headers)) return ''
  for (const header of headers) {
    const entry = record(header)
    if (typeof entry?.name === 'string' && entry.name.toLowerCase() === name && typeof entry.value === 'string') return entry.value
  }
  return ''
}

function summarise(message: Record<string, unknown>): MailSummary {
  return {
    id: typeof message.id === 'string' ? message.id : '',
    from: parseAddressList(headerValue(message, 'from'))[0] ?? { name: '', address: '' },
    subject: decodeHeader(headerValue(message, 'subject')).trim(),
    date: headerValue(message, 'date'),
  }
}

/** Gmail over REST. */
export class GmailClient {
  constructor(private readonly deps: { fetchFn: FetchFn; tokens: TokenSource }) {}

  private async call(
    path: string,
    init?: { method: string; body: string },
    announce?: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    for (const force of [false, true]) {
      const token = await this.deps.tokens.accessToken(force, announce)
      const response = await this.deps.fetchFn(`${API}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init === undefined ? {} : { 'content-type': 'application/json' }) },
      })
      if (response.status === 401 && !force) continue
      if (!response.ok) throw new GmailApiError(response.status)
      return record(await response.json().catch(() => undefined)) ?? {}
    }
    /* v8 ignore next -- the second pass returns or throws. */
    throw new GmailApiError(401)
  }

  /**
   * `messages.list` then a metadata `get` per message.
   * @param query - Gmail search query.
   * @param max - how many messages at most.
   * @param announce - called just before a first-time sign-in opens the browser.
   * @returns the summaries and Google's estimate of the total.
   */
  async list(query: string, max: number, announce?: () => Promise<void>): Promise<{ messages: MailSummary[]; estimate: number }> {
    const listing = await this.call(`/messages?${new URLSearchParams({ q: query, maxResults: String(max) }).toString()}`, undefined, announce)
    const ids = (Array.isArray(listing.messages) ? listing.messages : []).flatMap((entry: unknown) => {
      const id = record(entry)?.id
      return typeof id === 'string' ? [id] : []
    })
    const messages = await Promise.all(ids.map(id => this.summary(id)))
    const estimate = Number(listing.resultSizeEstimate) || ids.length
    return { messages, estimate: Math.max(estimate, ids.length) }
  }

  private async summary(id: string): Promise<MailSummary> {
    const query = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date'
    return summarise(await this.call(`/messages/${safeId(id)}?${query}`))
  }

  /**
   * @param id - message id.
   * @returns the summary and the plain text of the message (no attachment or link is ever fetched).
   */
  async read(id: string): Promise<{ summary: MailSummary; text: string }> {
    const message = await this.call(`/messages/${safeId(id)}?format=full`)
    return { summary: summarise(message), text: extractText(toPart(message.payload)) }
  }

  /**
   * Addresses seen in the last mails from or to a name.
   * @param name - the spoken name (letters, digits, spaces, dots, hyphens, apostrophes; anything else is dropped).
   * @returns distinct addresses with their display names, most frequent first.
   */
  async contacts(name: string, announce?: () => Promise<void>): Promise<Contact[]> {
    const clean = name.replaceAll(/[^\p{L}\p{N} .'-]/gu, ' ').replaceAll(/\s+/g, ' ').trim()
    if (clean === '') return []
    const listing = await this.call(`/messages?${new URLSearchParams({ q: `from:(${clean}) OR to:(${clean})`, maxResults: '20' }).toString()}`, undefined, announce)
    const ids = (Array.isArray(listing.messages) ? listing.messages : []).flatMap((entry: unknown) => {
      const id = record(entry)?.id
      return typeof id === 'string' ? [id] : []
    })
    const found = new Map<string, Contact>()
    const query = 'format=metadata&metadataHeaders=From&metadataHeaders=To'
    for (const message of await Promise.all(ids.map(id => this.call(`/messages/${safeId(id)}?${query}`)))) {
      for (const box of [...parseAddressList(headerValue(message, 'from')), ...parseAddressList(headerValue(message, 'to'))]) {
        const key = box.address.toLowerCase()
        const seen = found.get(key)
        if (seen === undefined) found.set(key, { name: box.name, address: box.address, count: 1 })
        else {
          seen.count++
          if (seen.name === '') seen.name = box.name
        }
      }
    }
    return [...found.values()].sort((a, b) => b.count - a.count)
  }

  /**
   * `messages.send`. Only the voice app's confirmation code calls this.
   * @param raw - the RFC 2822 message.
   */
  async send(raw: string): Promise<void> {
    await this.call('/messages/send', { method: 'POST', body: JSON.stringify({ raw: base64url(raw) }) })
  }
}

/**
 * @param address - a recipient address.
 * @returns the first 16 hex characters of its SHA-256 (lower-cased), so a log never holds the address.
 */
export function hashAddress(address: string): string {
  return createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 16)
}

/**
 * @param path - log file.
 * @returns a logger that appends "sent to <address hash> at <ISO time>" lines; never the body or the address.
 */
export function sentLogger(path: string): (address: string, at: Date) => void {
  return (address, at) => {
    appendFileSync(path, `sent to ${hashAddress(address)} at ${at.toISOString()}\n`)
  }
}
