/** Wake-phrase matching for speech transcripts. Pure; no state. */

/** Phrases that start a command. With the keyword spotter (the default) only these three are spotted. */
export const DEFAULT_WAKE_PHRASES: readonly string[] = ['jarvis', 'hey jarvis', 'ok jarvis']

/** Spellings the recogniser produces for "Jarvis" (Parakeet wrote "Javis" for the owner's mic on 2026-10-22). */
const TEXT_NAMES: readonly string[] = [
  'jarvis', 'javis', 'jervis', 'jarvas', 'travis', 'jrvis', 'jvis', 'davis', 'charvis', 'jarviss',
]

/**
 * Phrases for `AIR_VOICE_WAKE=text` (the default), where every short segment is decoded: each name alone and after
 * "hey" or "ok". Matched at the start of a segment only. Loose on purpose; the keyword spotter never uses them.
 */
export const TEXT_WAKE_PHRASES: readonly string[] = [
  ...DEFAULT_WAKE_PHRASES,
  ...TEXT_NAMES.flatMap(name => [name, `hey ${name}`, `ok ${name}`]),
  'jarvis is',
].filter((phrase, index, all) => all.indexOf(phrase) === index)

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
  return Array.from(text.matchAll(/[a-z0-9]+/gi), match => ({ word: match[0].toLowerCase(), end: match.index + match[0].length }))
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
