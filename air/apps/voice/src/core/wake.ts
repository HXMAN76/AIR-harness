/** Wake-phrase matching for speech transcripts. Pure; no state. */

/** Phrases that start a command. With the keyword spotter (the default) only these three are spotted. */
export const DEFAULT_WAKE_PHRASES: readonly string[] = ['jarvis', 'hey jarvis', 'ok jarvis']

/** Result of {@link matchWake}. */
export interface WakeMatch {
  /** Whether the transcript starts with a wake phrase. */
  wake: boolean
  /** The text after the wake phrase in its original casing, punctuation trimmed at both ends; `''` when none. */
  command: string
}

interface Word {
  /** Lower-case word. */
  word: string
  /** Offset just after the word in the original text. */
  end: number
}

/** Lower case, anything but `a-z0-9` treated as a separator. */
function words(text: string): Word[] {
  return Array.from(text.matchAll(/[a-z0-9']+/gi), match => ({ word: match[0].toLowerCase().replaceAll("'", ''), end: match.index + match[0].length }))
}

function trimPunctuation(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')
}

/**
 * Find a wake phrase at the start of a transcript.
 * Only a phrase at the very start counts, so "I said hey jarvis yesterday" does not wake.
 * @param transcript - text from the speech recogniser.
 * @param phrases - phrases to accept; the longest matching phrase wins.
 * @returns whether it woke and the command after the phrase.
 */
export function matchWake(transcript: string, phrases: readonly string[] = DEFAULT_WAKE_PHRASES): WakeMatch {
  const spoken = words(transcript)
  let bestLength = 0
  let cut = 0
  for (const phrase of phrases) {
    const phraseWords = words(phrase)
    if (phraseWords.length <= bestLength) continue
    let end = 0
    const matched = phraseWords.every(({ word }, index) => {
      const heard = spoken[index]
      if (heard?.word !== word) return false
      end = heard.end
      return true
    })
    if (matched) {
      bestLength = phraseWords.length
      cut = end
    }
  }
  if (bestLength === 0) return { wake: false, command: '' }
  return { wake: true, command: trimPunctuation(transcript.slice(cut)) }
}

/** Words that may come before the name in text wake ("hey", "ok", and their mis-hearings). */
const FILLERS: ReadonlySet<string> = new Set(['hey', 'hi', 'hay', 'a', 'ok', 'okay', 'so'])
const NAME = 'jarvis'
const MAX_NAME_DISTANCE = 2

/** Optimal string alignment distance (insert, delete, substitute, swap of neighbours). */
export function editDistance(a: string, b: string): number {
  const width = b.length + 1
  const table = new Int32Array((a.length + 1) * width)
  const at = (i: number, j: number): number => table[i * width + j] as number
  for (let i = 0; i <= a.length; i++) table[i * width] = i
  for (let j = 0; j <= b.length; j++) table[j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1)
      table[i * width + j] = best
    }
  }
  return at(a.length, b.length)
}

function nameLike(word: string, maxLength: number): boolean {
  return word.length >= 4 && word.length <= maxLength && editDistance(word, NAME) <= MAX_NAME_DISTANCE
}

/**
 * Text wake (the default): find a fuzzy "Jarvis" at the start of a transcript, optionally after one filler word.
 * The name is the next word when it is 4 to 8 letters and within edit distance 2 of "jarvis" (javis, jarves, jervis,
 * charvis, travis, davis, jarvis's), or two words whose join is 4 to 7 letters and within distance 2 ("jar vis").
 * Only the start of the segment counts. The command is the rest of the transcript.
 * @param transcript - text from the speech recogniser.
 * @returns whether it woke and the command after the name.
 */
export function matchTextWake(transcript: string): WakeMatch {
  const spoken = words(transcript)
  const start = FILLERS.has(spoken[0]?.word ?? '') && spoken.length > 1 ? 1 : 0
  const first = spoken[start]
  if (first === undefined) return { wake: false, command: '' }
  let last = first
  let used = 1
  if (!nameLike(first.word, 8)) {
    const second = spoken[start + 1]
    if (second === undefined || !nameLike(first.word + second.word, 7)) return { wake: false, command: '' }
    last = second
    used = 2
  }
  // "Jarvis is ..." is how the recogniser sometimes writes "Jarvis, ...".
  const next = spoken[start + used]
  if (next?.word === 'is' && spoken.length > start + used + 1) last = next
  return { wake: true, command: trimPunctuation(transcript.slice(last.end)) }
}
