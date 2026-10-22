import { describe, expect, it } from 'vitest'
import { base64url, buildMessage, decodeHeader, extractText, htmlToText, isAddress, parseAddressList, spokenName, toPart } from '../src/core/gmail/mime.ts'

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64url')

describe('decodeHeader', () => {
  it('decodes B and Q encoded-words, charsets, and joins adjacent words', () => {
    expect(decodeHeader('=?UTF-8?B?w4lj?=')).toBe('Éc')
    expect(decodeHeader('=?UTF-8?Q?Caf=C3=A9_au_lait?=')).toBe('Café au lait')
    expect(decodeHeader('=?iso-8859-1?Q?Andr=E9?= Smith')).toBe('André Smith')
    expect(decodeHeader('=?UTF-8?B?SGVs?=\r\n =?UTF-8?B?bG8=?=')).toBe('Hello')
    expect(decodeHeader('=?utf-8*en?q?a=zzb=?=')).toBe('a=zzb=')
    expect(decodeHeader('plain text')).toBe('plain text')
  })

  it('falls back to UTF-8 for an unknown charset', () => {
    expect(decodeHeader('=?x-unknown-charset?B?aGk=?=')).toBe('hi')
  })
})

describe('parseAddressList', () => {
  it('parses names, quoted names with commas, encoded names, and bare addresses; drops junk', () => {
    const boxes = parseAddressList('Asha Rao <asha@example.com>, "Menon, Asha" <am@example.com>, bare@example.com, =?UTF-8?B?w4lj?= <e@example.com>, nonsense, "Q \\"X\\"" <q@example.com>')
    expect(boxes).toEqual([
      { name: 'Asha Rao', address: 'asha@example.com' },
      { name: 'Menon, Asha', address: 'am@example.com' },
      { name: '', address: 'bare@example.com' },
      { name: 'Éc', address: 'e@example.com' },
      { name: 'Q "X"', address: 'q@example.com' },
    ])
  })

  it('names the sender by display name, else by the part before the at sign', () => {
    expect(spokenName({ name: 'Asha', address: 'a@b.co' })).toBe('Asha')
    expect(spokenName({ name: '', address: 'asha.rao@b.co' })).toBe('asha.rao')
  })
})

describe('body extraction', () => {
  it('prefers text/plain, skips attachments, and drops quoted replies', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', filename: 'a.txt', body: { data: b64('attachment text') } },
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/html', body: { data: b64('<p>html</p>') } },
            { mimeType: 'text/plain', body: { data: b64('Hello there.\r\n> quoted\r\n\r\n\r\n\r\nBye.\r\nOn Mon, 1 Jan 2026 at 10:00, Asha wrote:\r\n> old') } },
          ],
        },
      ],
    }
    expect(extractText(toPart(payload))).toBe('Hello there.\n\nBye.')
  })

  it('falls back to stripped html, honours a part charset, and returns empty when there is no text', () => {
    const html = '<style>p{}</style><div>Hi&nbsp;there &amp; &#65;&#x42; &bogus; &#0;</div><p>Line<br>two</p><script>x()</script>'
    expect(extractText(toPart({ mimeType: 'text/html', body: { data: b64(html) } }))).toBe('Hi there & AB &bogus; &#0;\nLine\ntwo')
    const latin = { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-8859-1"' }, { name: 'X' }], body: { data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64url') } }
    expect(extractText(toPart(latin))).toBe('café')
    expect(extractText(toPart({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { data: '' } }] }))).toBe('')
    expect(extractText(toPart(null))).toBe('')
    expect(htmlToText('a<br/>\n\n\n\nb')).toBe('a\n\nb')
  })

  it('toPart keeps only well-typed fields', () => {
    expect(toPart({ mimeType: 5, filename: 'f', headers: 'x', body: 3, parts: {} })).toEqual({
      mimeType: undefined, filename: 'f', headers: undefined, body: { data: undefined }, parts: undefined,
    })
  })
})

describe('buildMessage', () => {
  const decode = (message: string): { headers: string; body: string } => {
    const [headers, body] = message.split('\r\n\r\n') as [string, string]
    return { headers, body: Buffer.from(body.replaceAll('\r\n', ''), 'base64').toString('utf8') }
  }

  it('builds a plain message with a base64 UTF-8 body', () => {
    const { headers, body } = decode(buildMessage({ to: { name: 'Asha Rao', address: 'asha@example.com' }, subject: 'Lunch tomorrow', body: 'See you at noon.\nBring it.' }))
    expect(headers).toBe([
      'To: "Asha Rao" <asha@example.com>',
      'Subject: Lunch tomorrow',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n'))
    expect(body).toBe('See you at noon.\r\nBring it.')
  })

  it('encodes a non-ASCII subject and name as UTF-8 words of bounded length, and removes line breaks', () => {
    const subject = 'Réunion à Zürich — très important pour la semaine prochaine'
    const message = buildMessage({ to: { name: 'Zoë\r\nBcc: x@y.z', address: 'z@example.com' }, subject: `${subject}\nBcc: evil@example.com`, body: 'x'.repeat(200) })
    const head = message.split('\r\n\r\n')[0] as string
    const words = head.match(/=\?UTF-8\?B\?[^?]*\?=/g) as string[]
    expect(words.length).toBeGreaterThan(2)
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75)
    expect(head).not.toContain('\r\nBcc:')
    const decoded = decodeHeader(head.split('\r\n').filter(line => !/^(?:MIME|Content)/.test(line)).join('\r\n').replaceAll('\r\n ', ' ')).replaceAll(/\r\n/g, '|')
    expect(decoded).toContain('Zoë Bcc: x@y.z <z@example.com>')
    expect(decoded).toContain(`Subject: ${subject} Bcc: evil@example.com`.replace(/ {2}/g, ' '))
    expect(message.split('\r\n\r\n')[1]?.split('\r\n').every(line => line.length <= 76)).toBe(true)
  })

  it('omits the name when there is none and refuses a bad address', () => {
    expect(buildMessage({ to: { name: '', address: 'a@b.co' }, subject: 's', body: 'b' }).startsWith('To: a@b.co\r\n')).toBe(true)
    expect(() => buildMessage({ to: { name: '', address: 'a@b.co\r\nBcc: x@y.z' }, subject: 's', body: 'b' })).toThrow('Invalid recipient')
    expect(isAddress('a@b.co')).toBe(true)
    expect(isAddress('a@b')).toBe(false)
    expect(base64url('hi?>')).toBe('aGk_Pg')
  })
})
