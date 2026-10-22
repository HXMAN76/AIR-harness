import { describe, expect, it } from 'vitest'
import { DEFAULT_NEWS_FEED, NEWS_FAILED, newsFeedUrl, parseHeadlines, readNews, type FetchLike } from '../src/core/news.ts'

const FEED = `<?xml version="1.0"?><rss><channel><title>Top stories - Google News</title>
<item><title>Rain &amp; floods hit Chennai - The Hindu</title><link>https://x</link></item>
<item><title><![CDATA[Markets rally <b>again</b> - Mint]]></title></item>
<item><title>Budget &#8211; what changes &#x27;today&#x27; &unknown; - NDTV</title></item>
<item><description>no title</description></item>
<item><title>   </title></item>
<item><title>Plain headline without source</title></item>
<item><title>Fourth - A</title></item><item><title>Fifth - B</title></item><item><title>Sixth - C</title></item>
</channel></rss>`

function fake(body: string, ok = true, seen: string[] = []): FetchLike {
  return async (url) => {
    seen.push(url)
    return { ok, text: async () => body }
  }
}

describe('news feed url', () => {
  it('uses the India feed, a topic search, or the override', () => {
    expect(newsFeedUrl(undefined)).toBe(DEFAULT_NEWS_FEED)
    expect(newsFeedUrl('space & tech')).toBe('https://news.google.com/rss/search?q=space%20%26%20tech&hl=en-IN&gl=IN&ceid=IN:en')
    expect(newsFeedUrl('x', { AIR_VOICE_NEWS_FEED: ' https://example.org/feed ' })).toBe('https://example.org/feed')
    expect(newsFeedUrl(undefined, { AIR_VOICE_NEWS_FEED: '  ' })).toBe(DEFAULT_NEWS_FEED)
  })
})

describe('parseHeadlines', () => {
  it('takes item titles only, decodes entities, strips markup and the source suffix, and stops at the limit', () => {
    expect(parseHeadlines(FEED)).toEqual([
      'Rain & floods hit Chennai',
      'Markets rally again',
      "Budget – what changes 'today' &unknown;",
      'Plain headline without source',
      'Fourth',
    ])
    expect(parseHeadlines(FEED, 2)).toHaveLength(2)
    expect(parseHeadlines('<item><title>&#0; bad &#x110000;</title></item>')).toEqual(['&#0; bad &#x110000;'])
    expect(parseHeadlines('not xml')).toEqual([])
  })
})

describe('readNews', () => {
  it('speaks the top five numbered', async () => {
    const seen: string[] = []
    const spoken = await readNews({ fetchFn: fake(FEED, true, seen), env: {} })
    expect(spoken).toBe("Top headlines. 1. Rain & floods hit Chennai. 2. Markets rally again. 3. Budget – what changes 'today' &unknown;. 4. Plain headline without source. 5. Fourth.")
    expect(seen).toEqual([DEFAULT_NEWS_FEED])
  })

  it('searches the topic', async () => {
    const seen: string[] = []
    const spoken = await readNews({ fetchFn: fake(FEED, true, seen), topic: 'cricket' })
    expect(spoken.startsWith('Top headlines about cricket. 1.')).toBe(true)
    expect(seen[0]).toContain('/rss/search?q=cricket&')
  })

  it.each([
    ['an error response', fake(FEED, false)],
    ['an empty feed', fake('<rss></rss>')],
    ['a thrown error', async () => { throw new Error('offline') }],
  ])('says it could not get the news on %s', async (_name, fetchFn) => {
    expect(await readNews({ fetchFn })).toBe(NEWS_FAILED)
  })

  it('refuses a non-https feed override', async () => {
    const seen: string[] = []
    expect(await readNews({ fetchFn: fake(FEED, true, seen), env: { AIR_VOICE_NEWS_FEED: 'http://example.org/feed' } })).toBe(NEWS_FAILED)
    expect(seen).toEqual([])
  })
})
