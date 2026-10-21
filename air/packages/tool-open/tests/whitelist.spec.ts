import { describe, expect, it } from 'vitest'
import {
  APPS, encodeQuery, findApp, findSite, googleSearchUrl, isAllowedProcessList, isAllowedTarget, youtubeSearchUrl,
} from '../src/whitelist.ts'

describe('findApp', () => {
  it('matches spoken names in any case, with an optional app suffix', () => {
    expect(findApp('Notepad')?.target).toBe('notepad.exe')
    expect(findApp(' file explorer ')?.target).toBe('explorer.exe')
    expect(findApp('terminal app')?.target).toBe('wt.exe')
    expect(findApp('VS Code Application')?.target).toBe('code')
  })

  it('knows no other names', () => {
    expect(findApp('powershell')).toBeUndefined()
    expect(findApp('notepad.exe')).toBeUndefined()
    expect(findApp('')).toBeUndefined()
  })

  it('gives every app a unique spoken name and target', () => {
    const names = APPS.flatMap(app => app.names)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(APPS.map(app => app.target)).size).toBe(APPS.length)
  })
})

describe('findSite', () => {
  it('maps well-known names and plain domains', () => {
    expect(findSite('YouTube')).toEqual({ label: 'YouTube', url: 'https://www.youtube.com' })
    expect(findSite('example.org')).toEqual({ label: 'example.org', url: 'https://example.org' })
    expect(findSite('openai dot com')).toEqual({ label: 'openai.com', url: 'https://openai.com' })
    expect(findSite('www.site.in')).toEqual({ label: 'www.site.in', url: 'https://www.site.in' })
  })

  it.each(['evil.com/path', 'malware.exe', 'a.com b', 'x.net', 'javascript:alert(1)', '', 'notepad'])('rejects %j', (name) => {
    expect(findSite(name)).toBeNull()
  })
})

describe('isAllowedTarget', () => {
  it.each(['notepad.exe', 'code', 'ms-settings:', 'spotify:', 'https://github.com', 'https://a.io:8080/x?y=1#z'])('allows %s', (target) => {
    expect(isAllowedTarget(target)).toBe(true)
  })

  it.each(['powershell.exe', 'cmd.exe /c dir', 'http://a.com', 'file:///C:/x', "https://a.com/'x", 'https://a b.com', 'ms-settings:privacy', ''])(
    'refuses %j',
    (target) => {
      expect(isAllowedTarget(target)).toBe(false)
    },
  )
})

describe('isAllowedProcessList', () => {
  it('needs at least one name and every name on the list', () => {
    expect(isAllowedProcessList(['notepad'])).toBe(true)
    expect(isAllowedProcessList(['CalculatorApp', 'calc'])).toBe(true)
    expect(isAllowedProcessList([])).toBe(false)
    expect(isAllowedProcessList(['explorer'])).toBe(false)
    expect(isAllowedProcessList(['notepad', 'lsass'])).toBe(false)
  })
})

describe('query encoding', () => {
  it('encodes the characters encodeURIComponent keeps', () => {
    expect(encodeQuery("a b'(c)*!~")).toBe('a%20b%27%28c%29%2A%21~')
  })

  it('builds search URLs', () => {
    expect(googleSearchUrl('rust & go')).toBe('https://www.google.com/search?q=rust%20%26%20go')
    expect(youtubeSearchUrl('lo-fi')).toBe('https://www.youtube.com/results?search_query=lo-fi')
  })

  it('produces URLs that pass the target check even for hostile text', () => {
    expect(isAllowedTarget(googleSearchUrl("x'; Remove-Item C:\\ -Recurse"))).toBe(true)
  })
})
