/** Message text helpers for the Gmail client: RFC 2047 header decoding, address lists, body extraction, and RFC 2822 building. Pure. */

/** A parsed mailbox. `name` is empty when the header had none. */
export interface Mailbox {
  name: string
  address: string
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

function decodeQ(text: string): Buffer {
  const bytes: number[] = []
  const spaced = text.replaceAll('_', ' ')
  for (let index = 0; index < spaced.length; index++) {
    const char = spaced.charAt(index)
    const hex = spaced.slice(index + 1, index + 3)
    if (char === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
    } else bytes.push(...Buffer.from(char, 'utf8'))
  }
  return Buffer.from(bytes)
}

/**
 * Decode RFC 2047 encoded-words (`=?UTF-8?B?...?=`, `=?iso-8859-1?Q?...?=`) in a header value.
 * Whitespace between two adjacent encoded-words is dropped, as the RFC says.
 * @param value - raw header value.
 * @returns the readable text.
 */
export function decodeHeader(value: string): string {
  return value
    .replaceAll(/(\?=)\s+(?==\?)/g, '$1')
    .replaceAll(/=\?([^?\s]+)\?([bq])\?([^?]*)\?=/gi, (_whole, charset: string, encoding: string, text: string) => {
      const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(text, 'base64') : decodeQ(text)
      return decodeBytes(bytes, charset.split('*')[0] as string)
    })
}

/** Split on commas that are outside quotes and angle brackets. */
function splitList(header: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angle = false
  for (const char of header) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '<') angle = true
    else if (!quoted && char === '>') angle = false
    if (char === ',' && !quoted && !angle) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

/**
 * Parse an address header (`From`, `To`): `Name <a@b>`, `"Name, Jr" <a@b>`, or a bare address; comma separated.
 * @param header - raw header value; encoded-words in names are decoded.
 * @returns the mailboxes with a plausible address, in order.
 */
export function parseAddressList(header: string): Mailbox[] {
  const boxes: Mailbox[] = []
  for (const part of splitList(header)) {
    const angled = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(part)
    if (angled !== null) {
      const raw = (angled[1] as string).replace(/^"(.*)"$/, '$1').replaceAll(/\\(.)/g, '$1')
      boxes.push({ name: decodeHeader(raw).trim(), address: angled[2] as string })
      continue
    }
    const bare = /^\s*([^\s<>@,]+@[^\s<>@,]+)\s*$/.exec(part)
    if (bare !== null) boxes.push({ name: '', address: bare[1] as string })
  }
  return boxes
}

/**
 * @param box - a mailbox.
 * @returns the name to speak: the display name, else the part of the address before the at sign.
 */
export function spokenName(box: Mailbox): string {
  return box.name !== '' ? box.name : (box.address.split('@')[0] as string)
}

/** One MIME part of a Gmail `payload`. */
export interface Part {
  mimeType?: string | undefined
  filename?: string | undefined
  headers?: { name?: string | undefined; value?: string | undefined }[] | undefined
  body?: { data?: string | undefined } | undefined
  parts?: Part[] | undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
}

/**
 * @param value - a parsed JSON `payload` of unknown shape.
 * @returns it as a {@link Part}, keeping only the fields of the right type.
 */
export function toPart(value: unknown): Part {
  const raw = fields(value)
  return {
    mimeType: str(raw.mimeType),
    filename: str(raw.filename),
    headers: Array.isArray(raw.headers)
      ? raw.headers.map((header: unknown) => ({ name: str(fields(header).name), value: str(fields(header).value) }))
      : undefined,
    body: { data: str(fields(raw.body).data) },
    parts: Array.isArray(raw.parts) ? raw.parts.map(toPart) : undefined,
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * @param html - an HTML mail body.
 * @returns plain text: scripts and styles dropped, block tags as line breaks, other tags and links removed (no link is ever followed).
 */
export function htmlToText(html: string): string {
  return html
    .replaceAll(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replaceAll(/<\s*(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith('#')) {
        const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/ ?\n ?/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

function partText(part: Part): string | undefined {
  const data = part.body?.data
  if (data === undefined || data === '') return undefined
  const type = part.headers?.find(header => header.name?.toLowerCase() === 'content-type')?.value ?? ''
  const charset = /charset="?([\w.:-]+)"?/i.exec(type)?.[1] ?? 'utf-8'
  return decodeBytes(Buffer.from(data, 'base64url'), charset)
}

function find(part: Part, mime: string): string | undefined {
  if ((part.filename === undefined || part.filename === '') && part.mimeType === mime) {
    const text = partText(part)
    if (text !== undefined) return text
  }
  for (const child of part.parts ?? []) {
    const found = find(child, mime)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Plain text of a message: the first `text/plain` part that is not an attachment, else the first `text/html` part stripped.
 * Quoted reply lines (starting with `>`) and an "On ... wrote:" tail are removed.
 * @param payload - the `payload` of a `format=full` message.
 * @returns the text; empty when the message has no text part.
 */
export function extractText(payload: Part): string {
  const plain = find(payload, 'text/plain')
  const html = plain === undefined ? find(payload, 'text/html') : undefined
  const text = plain ?? (html === undefined ? '' : htmlToText(html))
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const cut = lines.findIndex(line => /^On .{5,200} wrote:\s*$/.test(line.trim()))
  return (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter(line => !line.startsWith('>'))
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

function oneLine(text: string): string {
  return text.replaceAll(/[\r\n]+/g, ' ').trim()
}

/** Encode a header phrase as RFC 2047 UTF-8 words of at most 75 characters each, when it is not plain ASCII. */
function encodeWords(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const words: string[] = []
  let chunk = ''
  for (const char of text) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += char
  }
  words.push(chunk)
  return words.map(word => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ')
}

/** Mailbox syntax accepted for a recipient: no whitespace, angle brackets, quotes, or commas. */
const ADDRESS = /^[^\s<>"',;@]+@[^\s<>"',;@]+\.[^\s<>"',;@.]+$/

/**
 * @param text - a candidate address.
 * @returns whether it is a plain `local@domain.tld` address.
 */
export function isAddress(text: string): boolean {
  return ADDRESS.test(text)
}

/**
 * Build the RFC 2822 message Gmail's `messages.send` takes (the caller base64url-encodes it).
 * The subject and a non-ASCII display name are UTF-8 encoded-words; the body is UTF-8 base64. Line breaks in any field are removed.
 * @param message - recipient, subject, and body.
 * @returns the message text with CRLF line ends.
 * @throws when the address is not a plain address.
 */
export function buildMessage(message: { to: Mailbox; subject: string; body: string }): string {
  if (!isAddress(message.to.address)) throw new Error('Invalid recipient address.')
  const name = oneLine(message.to.name).replaceAll(/["\\]/g, '')
  const encoded = encodeWords(name)
  const to = name === '' ? message.to.address : `${encoded === name ? `"${name}"` : encoded} <${message.to.address}>`
  const body = Buffer.from(message.body.replaceAll(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replaceAll(/(.{76})/g, '$1\r\n')
  return [
    `To: ${to}`,
    `Subject: ${encodeWords(oneLine(message.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

/**
 * @param text - text to encode.
 * @returns base64url without padding.
 */
export function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}
