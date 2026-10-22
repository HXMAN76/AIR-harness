/** Gmail client tests with a fake fetch: request shapes and response parsing. No network. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FetchFn } from '../src/core/gmail/auth.ts'
import { GmailApiError, GmailClient, hashAddress, sentLogger } from '../src/core/gmail/client.ts'

interface Seen { url: string; method: string | undefined; auth: string | undefined; body: string | undefined }

function fake(routes: (url: URL) => { status?: number; body?: unknown } | undefined, seen: Seen[] = []): FetchFn {
  return async (url, init) => {
    seen.push({ url, method: init?.method, auth: init?.headers?.authorization, body: init?.body })
    const answer = routes(new URL(url)) ?? { status: 404, body: {} }
    const status = answer.status ?? 200
    return { ok: status < 300, status, json: async () => { if (answer.body === 'bad') throw new Error('bad json'); return answer.body } }
  }
}

const tokens = (log: boolean[] = []) => ({
  accessToken: async (force = false) => {
    log.push(force)
    return force ? 'fresh-token' : 'token-1'
  },
})

const message = (id: string, from: string, subject: string, to = '') => ({
  id,
  payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Date', value: 'Mon, 1 Jan 2026 10:00:00 +0000' }, { name: 'To', value: to }] },
})

describe('GmailClient.list', () => {
  it('lists then fetches metadata, decoding encoded-word subjects and senders', async () => {
    const seen: Seen[] = []
    const client = new GmailClient({
      tokens: tokens(),
      fetchFn: fake((url) => {
        if (url.pathname.endsWith('/messages')) return { body: { messages: [{ id: 'm1' }, { id: 'm2' }, { nope: 1 }], resultSizeEstimate: 9 } }
        if (url.pathname.endsWith('/m1')) return { body: message('m1', '=?UTF-8?B?w4lj?= <asha@example.com>', '=?UTF-8?Q?Caf=C3=A9?= menu') }
        if (url.pathname.endsWith('/m2')) return { body: { payload: {} } }
        return undefined
      }, seen),
    })
    const result = await client.list('is:unread is:important in:inbox', 5)
    expect(result.estimate).toBe(9)
    expect(result.messages).toEqual([
      { id: 'm1', from: { name: 'Éc', address: 'asha@example.com' }, subject: 'Café menu', date: 'Mon, 1 Jan 2026 10:00:00 +0000' },
      { id: '', from: { name: '', address: '' }, subject: '', date: '' },
    ])
    const list = new URL(seen[0]?.url as string)
    expect(list.origin + list.pathname).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages')
    expect(list.searchParams.get('q')).toBe('is:unread is:important in:inbox')
    expect(list.searchParams.get('maxResults')).toBe('5')
    const get = new URL(seen[1]?.url as string)
    expect(get.searchParams.get('format')).toBe('metadata')
    expect(get.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject', 'Date'])
    expect(seen[0]?.auth).toBe('Bearer token-1')
    expect(seen[0]?.method).toBeUndefined()
  })

  it('handles an empty listing, and never lets the estimate fall below the count', async () => {
    const empty = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ body: {} })) })
    expect(await empty.list('q', 5)).toEqual({ messages: [], estimate: 0 })
    const small = new GmailClient({
      tokens: tokens(),
      fetchFn: fake(url => (url.pathname.endsWith('/messages') ? { body: { messages: [{ id: 'a' }], resultSizeEstimate: 0 } } : { body: message('a', 'x@y.zz', 's') })),
    })
    expect((await small.list('q', 5)).estimate).toBe(1)
  })

  it('retries once with a fresh token after a 401, then gives up', async () => {
    const log: boolean[] = []
    let first = true
    const client = new GmailClient({
      tokens: tokens(log),
      fetchFn: fake(() => {
        if (first) {
          first = false
          return { status: 401, body: {} }
        }
        return { body: { messages: [] } }
      }),
    })
    await client.list('q', 1)
    expect(log).toEqual([false, true])
    const denied = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ status: 401, body: {} })) })
    await expect(denied.list('q', 1)).rejects.toMatchObject({ status: 401 })
    const other = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ status: 500, body: {} })) })
    await expect(other.list('q', 1)).rejects.toBeInstanceOf(GmailApiError)
  })

  it('skips malformed headers', async () => {
    const client = new GmailClient({
      tokens: tokens(),
      fetchFn: fake(url => (url.pathname.endsWith('/messages') ? { body: { messages: [{ id: 'a' }] } } : { body: { id: 'a', payload: { headers: [5, { name: 'Subject' }, { name: 'Subject', value: 'ok' }] } } })),
    })
    expect((await client.list('q', 1)).messages[0]?.subject).toBe('ok')
  })

  it('tolerates an unreadable JSON body', async () => {
    const client = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ body: 'bad' })) })
    expect(await client.list('q', 1)).toEqual({ messages: [], estimate: 0 })
  })
})

describe('GmailClient.read', () => {
  it('fetches the full format and extracts the text', async () => {
    const seen: Seen[] = []
    const body = Buffer.from('Hello Asha.', 'utf8').toString('base64url')
    const client = new GmailClient({
      tokens: tokens(),
      fetchFn: fake(() => ({ body: { ...message('m1', 'Asha <a@b.co>', 'Hi'), payload: { ...message('m1', 'Asha <a@b.co>', 'Hi').payload, mimeType: 'text/plain', body: { data: body } } } }), seen),
    })
    const mail = await client.read('m1')
    expect(mail.summary.subject).toBe('Hi')
    expect(mail.text).toBe('Hello Asha.')
    expect(new URL(seen[0]?.url as string).searchParams.get('format')).toBe('full')
  })

  it('rejects an id that could change the request path', async () => {
    const client = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ body: {} })) })
    await expect(client.read('../labels')).rejects.toThrow('Invalid message id')
  })
})

describe('GmailClient.contacts', () => {
  it('searches from and to, and counts distinct addresses with the best display name', async () => {
    const seen: Seen[] = []
    const client = new GmailClient({
      tokens: tokens(),
      fetchFn: fake((url) => {
        if (url.pathname.endsWith('/messages')) return { body: { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { nope: 1 }] } }
        if (url.pathname.endsWith('/a')) return { body: message('a', 'Asha Rao <ASHA@example.com>', 's', 'me@example.com') }
        if (url.pathname.endsWith('/b')) return { body: message('b', 'me@example.com', 's', 'asha@example.com, Ravi <ravi@example.com>') }
        return { body: message('c', 'Asha Rao <asha@example.com>', 's') }
      }, seen),
    })
    const found = await client.contacts('  asha "rao"; ')
    expect(new URL(seen[0]?.url as string).searchParams.get('q')).toBe('from:(asha rao) OR to:(asha rao)')
    expect(new URL(seen[0]?.url as string).searchParams.get('maxResults')).toBe('20')
    expect(found[0]).toEqual({ name: 'Asha Rao', address: 'ASHA@example.com', count: 3 })
    expect(found.map(contact => contact.address.toLowerCase())).toEqual(['asha@example.com', 'me@example.com', 'ravi@example.com'])
  })

  it('does not search for a name with no usable characters', async () => {
    const seen: Seen[] = []
    const client = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ body: {} }), seen) })
    expect(await client.contacts('();"')).toEqual([])
    expect(seen).toEqual([])
    expect(await client.contacts('asha')).toEqual([])
  })
})

describe('GmailClient.send', () => {
  it('posts the base64url message as JSON', async () => {
    const seen: Seen[] = []
    const client = new GmailClient({ tokens: tokens(), fetchFn: fake(() => ({ body: { id: 'sent' } }), seen) })
    await client.send('To: a@b.co\r\n\r\nhi')
    expect(seen[0]?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(seen[0]?.method).toBe('POST')
    expect(JSON.parse(seen[0]?.body as string)).toEqual({ raw: Buffer.from('To: a@b.co\r\n\r\nhi').toString('base64url') })
  })
})

describe('sent log', () => {
  it('records an address hash and a time, never the address', () => {
    const dir = mkdtempSync(join(tmpdir(), 'air-gmail-log-'))
    try {
      const path = join(dir, 'sent.log')
      sentLogger(path)('Asha@Example.com', new Date('2026-10-22T10:00:00Z'))
      const line = readFileSync(path, 'utf8')
      expect(line).toBe(`sent to ${hashAddress('asha@example.com')} at 2026-10-22T10:00:00.000Z\n`)
      expect(line).not.toContain('asha')
      expect(hashAddress('ASHA@example.com')).toBe(hashAddress('asha@example.com'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
