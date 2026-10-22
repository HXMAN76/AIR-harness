/** Turns an agent reply into English text that sounds right when spoken. Pure. */

/** Spoken instead of a reply in Tamil script, which the English voice cannot read. */
export const REPLY_ON_SCREEN = 'Reply is on screen.'

/** Spoken when nothing speakable is left after cleaning. */
export const NOTHING_TO_SAY = 'Done. The details are on screen.'

/** Spoken after a reply that was cut to fit the word budget. */
export const MORE_ON_SCREEN = "There's more on screen."

/** A spoken reply takes whole sentences up to this many words (after expansion). */
const MAX_SPOKEN_WORDS = 40
/** A sentence longer than this many words is split near its middle. */
const LONG_SENTENCE_WORDS = 30
/** At most this many list items are spoken. */
const MAX_LIST_ITEMS = 3

const FENCED_CODE = /```[\s\S]*?(?:```|$)/g
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g
const BARE_URL = /\bhttps?:\/\/\S+/g
const RULE_LINE = /^\s*[-*_]{3,}\s*$/
const HEADING = /^\s*#{1,6}\s+/
const QUOTE = /^\s*>\s?/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

// ---------------------------------------------------------------------------------------------- numbers

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ORDINAL_IRREGULAR: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' }

function below100(n: number): string {
  if (n < 20) return ONES[n] as string
  const unit = n % 10
  return unit === 0 ? TENS[n / 10] as string : `${TENS[Math.floor(n / 10)] as string}-${ONES[unit] as string}`
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds === 0) return below100(rest)
  return rest === 0 ? `${ONES[hundreds] as string} hundred` : `${ONES[hundreds] as string} hundred ${below100(rest)}`
}

/**
 * @param n - a whole number from 0 to 999,999,999,999.
 * @returns it in English words ("one thousand two hundred thirty-four").
 */
export function numberToWords(n: number): string {
  if (n < 1000) return below1000(n)
  const parts: string[] = []
  let rest = n
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${below1000(Math.floor(rest / size))} ${name}`)
      rest %= size
    }
  }
  if (rest > 0) parts.push(below1000(rest))
  return parts.join(' ')
}

function ordinalWords(n: number): string {
  const words = numberToWords(n)
  const cut = Math.max(words.lastIndexOf(' '), words.lastIndexOf('-')) + 1
  const last = words.slice(cut)
  const ordinal = ORDINAL_IRREGULAR[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
  return words.slice(0, cut) + ordinal
}

function spellDigits(digits: string): string {
  return Array.from(digits, digit => ONES[Number(digit)] as string).join(' ')
}

/** A year read the way people say it: "twenty twenty-six", "nineteen oh five", "two thousand". */
function yearWords(year: number): string {
  if (year === 2000) return 'two thousand'
  if (year > 2000 && year < 2010) return `two thousand ${ONES[year - 2000] as string}`
  const high = Math.floor(year / 100)
  const low = year % 100
  if (low === 0) return `${below100(high)} hundred`
  return `${below100(high)} ${low < 10 ? `oh ${ONES[low] as string}` : below100(low)}`
}

function timeWords(hour: number, minute: number, suffix: string | undefined): string {
  const marker = suffix === undefined ? (hour >= 12 ? 'PM' : 'AM') : suffix.replaceAll('.', '').toUpperCase()
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  const minutes = minute === 0 ? '' : minute < 10 ? ` oh ${ONES[minute] as string}` : ` ${below100(minute)}`
  return `${below100(twelve)}${minutes} ${marker}`
}

function dateWords(month: number, day: number, year: number | undefined, now: Date): string {
  const text = `${MONTHS[month - 1] as string} ${ordinalWords(day)}`
  return year === undefined || year === now.getFullYear() ? text : `${text}, ${yearWords(year)}`
}

// ---------------------------------------------------------------------------------------------- expansion

const UNITS: Record<string, [string, string]> = {
  'km/h': ['kilometre per hour', 'kilometres per hour'],
  kmph: ['kilometre per hour', 'kilometres per hour'],
  mph: ['mile per hour', 'miles per hour'],
  km: ['kilometre', 'kilometres'],
  cm: ['centimetre', 'centimetres'],
  mm: ['millimetre', 'millimetres'],
  kg: ['kilogram', 'kilograms'],
  gb: ['gigabyte', 'gigabytes'],
  mb: ['megabyte', 'megabytes'],
  kb: ['kilobyte', 'kilobytes'],
  tb: ['terabyte', 'terabytes'],
  ms: ['millisecond', 'milliseconds'],
  m: ['metre', 'metres'],
}

const SPELLED_EXTENSIONS: Record<string, string> = { pdf: 'P D F', docx: 'dock X', doc: 'doc', xlsx: 'X L S X', pptx: 'P P T X', txt: 'text', json: 'jason', exe: 'E X E', zip: 'zip', png: 'P N G', jpg: 'J P G', jpeg: 'J P E G', csv: 'C S V', md: 'M D' }

const ABBREVIATIONS: [RegExp, string][] = [
  [/\be\.g\./gi, 'for example'],
  [/\bi\.e\./gi, 'that is'],
  [/\betc\./gi, 'and so on'],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\bapprox\./gi, 'about'],
  [/\bDr\./g, 'Doctor'],
  [/\bMr\./g, 'Mister'],
  [/\bMrs\./g, 'Missus'],
  [/\bMs\./g, 'Miss'],
]


/** The plain-number part: not glued to letters, thousands commas allowed, optional decimals. */
const NUMBER = /(?<![\p{L}\d.])(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?(?![\p{L}\d])/gu

function plural(count: number, forms: [string, string]): string {
  return count === 1 ? forms[0] : forms[1]
}

function expand(input: string, now: Date): string {
  let text = input
  // Dates: ISO and Indian day-first, then "22nd".
  const date = (all: string, d: string, m: string, y: string): string =>
    Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? dateWords(Number(m), Number(d), Number(y), now) : all
  text = text.replaceAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y: string, m: string, d: string) => date(all, d, m, y))
  text = text.replaceAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, date)
  text = text.replaceAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, (_all, d: string) => ordinalWords(Number(d)))
  // Times and durations.
  text = text.replaceAll(
    /\b(\d{1,2}):(\d{2})(?:\s?([ap]\.?m)(?![\p{L}]))?(?!\d)/giu,
    (all, h: string, m: string, suffix: string | undefined) =>
      Number(h) < 24 && Number(m) < 60 ? timeWords(Number(h), Number(m), suffix) : all,
  )
  text = text.replaceAll(/\b(\d+)\s?h\s(\d+)\s?m\b/gi, (_all, h: string, m: string) => `${h} ${plural(Number(h), ['hour', 'hours'])} ${m} ${plural(Number(m), ['minute', 'minutes'])}`)
  text = text.replaceAll(/\b(\d{1,2})\s?([ap])\.?m(?![\p{L}])/giu, (_all, h: string, suffix: string) => timeWords(Number(h), 0, `${suffix}m`))
  // Money, percent, degrees.
  text = text.replaceAll(/(?:₹|\bRs\.?\s?|\bINR\s?)(\d[\d,]*(?:\.\d+)?)(?:\s?(lakh|crore))?/gi, (_all, n: string, scale: string | undefined) => `${n}${scale === undefined ? '' : ` ${scale.toLowerCase()}`} rupees`)
  const dollars = /\$(\d[\d,]*(?:\.\d+)?)(?:\s?(million|billion|thousand|k|m|b)\b)?/gi
  text = text.replaceAll(dollars, (_all, n: string, scale: string | undefined) => {
    const named: Record<string, string> = { k: 'thousand', m: 'million', b: 'billion' }
    const word = scale === undefined ? '' : ` ${named[scale.toLowerCase()] ?? scale.toLowerCase()}`
    return `${n}${word} dollars`
  })
  text = text.replaceAll(/(\d)\s?%/g, '$1 percent')
  text = text.replaceAll(/(\d)\s?°\s?([CF])\b/g, (_all, n: string, scale: string) => `${n} degrees ${scale === 'C' ? 'Celsius' : 'Fahrenheit'}`)
  text = text.replaceAll(/(\d)\s?°/g, '$1 degrees')
  // Units after a number.
  text = text.replaceAll(/(\d+(?:\.\d+)?)\s?(km\/h|kmph|mph|km|cm|mm|kg|gb|mb|kb|tb|ms|m)\b(?!\.\w)/gi, (_all, n: string, unit: string) => `${n} ${plural(Number(n), UNITS[unit.toLowerCase()] as [string, string])}`)
  // Phone numbers and long identifiers.
  text = text.replaceAll(/(?<![\d.])(?:\+91[\s-]?)?(\d{5})[\s-]?(\d{5})(?!\d)/g, (_all, a: string, b: string) => `${spellDigits(a)}, ${spellDigits(b)}`)
  text = text.replaceAll(/\b\d{10,}\b/g, 'a long number on screen')
  // Plain numbers.
  text = text.replaceAll(/#(?=\d)/g, 'number ')
  text = text.replaceAll(/(?<=\d)\s?[x×]\s?(?=\d)/g, ' times ')
  text = text.replaceAll(/\b(in|since|of|by|until|from|before|after|year)\s(19\d\d|20\d\d)\b/gi, (_all, word: string, year: string) => `${word} ${yearWords(Number(year))}`)
  text = text.replaceAll(new RegExp(`\\b(${MONTHS.join('|')})\\s(19\\d\\d|20\\d\\d)\\b`, 'g'), (_all, month: string, year: string) => `${month} ${yearWords(Number(year))}`)
  text = text.replaceAll(NUMBER, (_all, whole: string, fraction: string | undefined) => {
    const digits = whole.replaceAll(',', '')
    if (digits.length > 12) return 'a long number on screen'
    const words = numberToWords(Number(digits))
    return fraction === undefined ? words : `${words} point ${spellDigits(fraction)}`
  })
  // Symbols.
  text = text.replaceAll(/~\s?(?=\w)/g, 'about ')
  text = text.replaceAll(/\s&\s/g, ' and ')
  text = text.replaceAll(/\s=\s/g, ' equals ')
  text = text.replaceAll(/(?<=[\p{L}\d])\s?\+\s?(?=[\p{L}\d])/gu, ' plus ')
  text = text.replaceAll(/(?<=[\p{L}])\/(?=[\p{L}])/gu, ' slash ')
  text = text.replaceAll(/>=/g, ' at least ')
  // Abbreviations and file extensions.
  for (const [pattern, spoken] of ABBREVIATIONS) text = text.replaceAll(pattern, spoken)
  text = text.replaceAll(/(?<=[\p{L}\d])\.(pdf|docx|doc|xlsx|pptx|txt|json|exe|zip|png|jpg|jpeg|csv|md)\b/giu, (_all, ext: string) => ` dot ${SPELLED_EXTENSIONS[ext.toLowerCase()] as string}`)
  return text
}

// ---------------------------------------------------------------------------------------------- cleaning

function strip(text: string): string {
  return text
    .replaceAll(/<\/?[a-z][^>]*>/gi, ' ')
    .replaceAll(/\[\d+\]/g, '')
    .replaceAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'an email address')
    .replaceAll(/\b[A-Za-z]:\\[^\s]*/g, 'a file path on screen')
    .replaceAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|in|dev|ai|co|app|gov|edu)(?:\/\S*)?/gi, 'the link on screen')
    .replaceAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'a long ID')
    .replaceAll(/\b[0-9a-f]{16,}\b/gi, 'a long ID')
    .replaceAll(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, '')
    .replaceAll(/[→←↑↓★☆•✓✔✗✘©®™▪◦]/g, ' ')
    .replaceAll(/\|/g, ' ')
}

function inline(text: string): string {
  return text
    .replaceAll(/`([^`]*)`/g, '$1')
    .replaceAll(/(\*\*|__)(.*?)\1/g, '$2')
    .replaceAll(/\*([^*]+)\*/g, '$1')
    .replaceAll(/\b_([^_]+)_\b/g, '$1')
    .trim()
}

/** End a spoken paragraph with a full stop unless it already ends a sentence. */
function finish(paragraph: string): string {
  if (/[.!?]$/.test(paragraph)) return paragraph
  return `${paragraph.replace(/[:;,\s]+$/, '')}.`
}

function paragraphs(text: string): string[] {
  const result: string[] = []
  let current = ''
  let lastWasItem = false
  let items = 0
  let skipped = 0
  const flush = (): void => {
    if (skipped > 0) current = `${current}, and ${skipped} more on screen`
    if (current !== '') result.push(finish(current))
    current = ''
    lastWasItem = false
    items = 0
    skipped = 0
  }
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') {
      flush()
      continue
    }
    if (RULE_LINE.test(rawLine)) continue
    const isItem = LIST_ITEM.test(rawLine)
    const line = inline(rawLine.replace(HEADING, '').replace(QUOTE, '').replace(LIST_ITEM, '').replace(/^(?:step\s)?(\d+)[:.]\s/i, ''))
    if (line === '') continue
    if (isItem) {
      items++
      if (items > MAX_LIST_ITEMS) {
        skipped++
        continue
      }
    }
    if (current === '') current = line
    else current = `${current}${isItem && lastWasItem ? ', ' : ' '}${line}`
    lastWasItem = isItem
  }
  flush()
  return result
}

/** Tidy punctuation for the voice: no colons or semicolons mid-text, parentheses become commas, no repeated marks. */
function prosody(text: string): string {
  return text
    .replaceAll(/\s*\(([^)]*)\)/g, ', $1,')
    .replaceAll(/[:;]\s/g, ', ')
    .replaceAll(/[.…]{2,}|…/g, '.')
    .replaceAll(/([!?])[!?]+/g, '$1')
    .replaceAll(/,\s*(?=[.!?])/g, '')
    .replaceAll(/,(\s*,)+/g, ',')
    .replaceAll(/\s+([,.!?])/g, '$1')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/(^|[.!?]\s)([a-z])/g, (_all, lead: string, letter: string) => lead + letter.toUpperCase())
    .trim()
}

// ---------------------------------------------------------------------------------------------- sentences

const NON_ENDING = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'no', 'fig', 'inc', 'ltd'])

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Split an over-long sentence at the comma (or conjunction) nearest its middle; repeats until every part is short enough. */
function splitLong(sentence: string): string[] {
  if (wordCount(sentence) <= LONG_SENTENCE_WORDS) return [sentence]
  const words = sentence.split(/\s+/)
  const middle = words.length / 2
  let best = -1
  for (let i = 2; i < words.length - 2; i++) {
    const word = words[i - 1] as string
    const breaks = /[,;:]$/.test(word) || /^(?:and|but|or)$/i.test(words[i] as string)
    if (breaks && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i
  }
  if (best < 0) return [sentence]
  const head = words.slice(0, best).join(' ').replace(/[,;:]$/, '') + '.'
  const tail = words.slice(best).join(' ')
  return [...splitLong(head), ...splitLong(tail.charAt(0).toUpperCase() + tail.slice(1))]
}

/**
 * Split text into sentences for streaming speech. Breaks after `.`, `!` and `?` that end a word, and at newlines;
 * keeps abbreviations ("Dr."), initials, decimals and a full stop before a lowercase word together; merges
 * fragments of under three words into a neighbour; splits sentences over 30 words near their middle.
 * @param text - cleaned reply text.
 * @returns the sentences in order; empty when the text has no words.
 */
export function splitSentences(text: string): string[] {
  const raw: string[] = []
  for (const line of text.split('\n')) {
    let start = 0
    for (const match of line.matchAll(/[.!?]+["')\]]*(?=\s|$)/g)) {
      const end = match.index + match[0].length
      const before = line.slice(start, match.index)
      const token = before.toLowerCase().split(/\s+/).pop() as string
      const after = line.slice(end).trimStart()
      const initial = /^[A-Za-z]$/.test(token)
      const lowerNext = /^[a-z]/.test(after)
      if (NON_ENDING.has(token) || initial || (lowerNext && match[0] === '.')) continue
      raw.push(line.slice(start, end).trim())
      start = end
    }
    const rest = line.slice(start).trim()
    if (rest !== '') raw.push(rest)
  }
  const merged: string[] = []
  let carry = ''
  for (const sentence of raw) {
    const joined = carry === '' ? sentence : `${carry} ${sentence}`
    if (wordCount(joined) < 3) carry = joined
    else {
      merged.push(joined)
      carry = ''
    }
  }
  if (carry !== '') {
    if (merged.length > 0) merged[merged.length - 1] = `${merged[merged.length - 1] as string} ${carry}`
    else merged.push(carry)
  }
  return merged.flatMap(splitLong).filter(sentence => /[\p{L}\p{N}]/u.test(sentence))
}

/**
 * Clean a reply for speech: Markdown, code, emoji, URLs, e-mail addresses and paths removed; links read as their
 * text; lists cut to three items; symbols, units, money, times, dates and numbers written out as words; punctuation
 * tidied. Whole sentences are kept up to 40 words, then "There's more on screen." An empty result becomes
 * {@link NOTHING_TO_SAY}.
 * @param reply - the agent's final response.
 * @param now - the current date; dates in this year are spoken without it.
 * @returns the text to speak; never empty.
 */
export function toSpokenText(reply: string, now: Date = new Date()): string {
  const prepared = strip(reply
    .replaceAll('\r\n', '\n')
    .replaceAll(FENCED_CODE, '\n')
    .replaceAll(MARKDOWN_LINK, '$1')
    .replaceAll(BARE_URL, 'the link on screen'))
  const joined = paragraphs(prepared).join(' ').replaceAll(/\s+/g, ' ').trim()
  if (!/[\p{L}\p{N}]/u.test(joined)) return NOTHING_TO_SAY
  const sentences = splitSentences(prosody(expand(joined, now)))
  const kept: string[] = []
  let words = 0
  for (const sentence of sentences) {
    const count = wordCount(sentence)
    if (kept.length > 0 && words + count > MAX_SPOKEN_WORDS) break
    kept.push(sentence)
    words += count
  }
  return kept.length < sentences.length ? `${kept.join(' ')} ${MORE_ON_SCREEN}` : kept.join(' ')
}

/**
 * @param text - a reply.
 * @returns whether it contains Tamil script (U+0B80 to U+0BFF).
 */
export function hasTamilScript(text: string): boolean {
  return /[஀-௿]/u.test(text)
}
