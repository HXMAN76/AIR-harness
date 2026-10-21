/** Spoken headlines from an RSS feed: one HTTPS fetch, a small safe parser, no model and no tokens. */

/** Default feed: Google News, India edition. */
export const DEFAULT_NEWS_FEED = 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en'

/** Headlines spoken. */
export const NEWS_COUNT = 5
/** Spoken when the feed cannot be fetched or has no headlines. */
export const NEWS_FAILED = "I couldn't get the news."

const MAX_BYTES = 2_000_000
const TIMEOUT_MS = 8_000

/** The part of `fetch` used here. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>

/**
 * @param topic - optional topic to search for.
 * @param env - environment to read `AIR_VOICE_NEWS_FEED` from; it overrides the default feed (topic ignored).
 * @returns the feed URL.
 */
export function newsFeedUrl(topic: string | undefined, env: Record<string, string | undefined> = {}): string {
  const override = env.AIR_VOICE_NEWS_FEED
  if (override !== undefined && override.trim() !== '') return override.trim()
  if (topic === undefined) return DEFAULT_NEWS_FEED
  return `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text: string): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

/**
 * Titles of the `<item>` elements of an RSS document, without markup, with the trailing " - Source" removed.
 * A small regex parser: it never evaluates anything and ignores everything but item titles.
 * @param xml - the feed text.
 * @param limit - how many titles at most.
 * @returns the cleaned titles.
 */
export function parseHeadlines(xml: string, limit = NEWS_COUNT): string[] {
  const titles: string[] = []
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(item[1] ?? '')?.[1]
    if (raw === undefined) continue
    const unwrapped = raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    const title = decode(unwrapped.replaceAll(/<[^>]*>/g, '')).replaceAll(/\s+/g, ' ').trim()
    const cut = title.lastIndexOf(' - ')
    const headline = cut > 0 ? title.slice(0, cut).trim() : title
    if (headline !== '') titles.push(headline)
    if (titles.length >= limit) break
  }
  return titles
}

/**
 * Fetch the feed and build the sentence to speak.
 * @param options - the fetch function, the optional topic, and the environment.
 * @returns "Top headlines. 1. ... 2. ..." or {@link NEWS_FAILED}; never throws.
 */
export async function readNews(options: { fetchFn: FetchLike; topic?: string; env?: Record<string, string | undefined> }): Promise<string> {
  try {
    const url = newsFeedUrl(options.topic, options.env)
    if (!url.startsWith('https://')) return NEWS_FAILED
    const response = await options.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return NEWS_FAILED
    const headlines = parseHeadlines((await response.text()).slice(0, MAX_BYTES))
    if (headlines.length === 0) return NEWS_FAILED
    const lead = options.topic === undefined ? 'Top headlines.' : `Top headlines about ${options.topic}.`
    return `${lead} ${headlines.map((headline, index) => `${index + 1}. ${headline.replace(/[.!?]+$/, '')}.`).join(' ')}`
  } catch {
    return NEWS_FAILED
  }
}
