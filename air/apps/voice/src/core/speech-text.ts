/** Turns an agent reply into text that sounds right when spoken. Pure. */

/** Spoken when nothing speakable is left after cleaning. */
export const NOTHING_TO_SAY = 'Done. The details are on screen.'

/** Replies longer than this many words are cut to their first two sentences. */
const MAX_SPOKEN_WORDS = 60

const FENCED_CODE = /```[\s\S]*?(?:```|$)/g
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g
const BARE_URL = /\bhttps?:\/\/\S+/g
const RULE_LINE = /^\s*[-*_]{3,}\s*$/
const HEADING = /^\s*#{1,6}\s+/
const QUOTE = /^\s*>\s?/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

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
  const flush = (): void => {
    if (current !== '') result.push(finish(current))
    current = ''
    lastWasItem = false
  }
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') {
      flush()
      continue
    }
    if (RULE_LINE.test(rawLine)) continue
    const isItem = LIST_ITEM.test(rawLine)
    const line = inline(rawLine.replace(HEADING, '').replace(QUOTE, '').replace(LIST_ITEM, ''))
    if (line === '') continue
    if (current === '') current = line
    else current = `${current}${isItem && lastWasItem ? ', ' : ' '}${line}`
    lastWasItem = isItem
  }
  flush()
  return result
}

/**
 * Clean a reply for speech: Markdown and code blocks removed, links read as their text,
 * bare URLs replaced by "the link on screen", list items joined with commas.
 * A cleaned reply over 60 words is cut to its first two sentences; an empty one becomes {@link NOTHING_TO_SAY}.
 * @param reply - the agent's final response.
 * @returns the text to speak; never empty.
 */
export function toSpokenText(reply: string): string {
  const prepared = reply
    .replaceAll('\r\n', '\n')
    .replaceAll(FENCED_CODE, '\n')
    .replaceAll(MARKDOWN_LINK, '$1')
    .replaceAll(BARE_URL, 'the link on screen')
  const text = paragraphs(prepared).join(' ').replaceAll(/\s+/g, ' ').trim()
  if (!/[\p{L}\p{N}]/u.test(text)) return NOTHING_TO_SAY
  if (text.split(' ').length <= MAX_SPOKEN_WORDS) return text
  return Array.from(text.matchAll(/[^.!?]+[.!?]+/g), match => match[0].trim()).slice(0, 2).join(' ')
}
