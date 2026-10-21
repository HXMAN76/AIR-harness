import { describe, expect, it } from 'vitest'
import { closeIntentForLabel, isCloseReference, matchOperatorIntent, runOperatorIntent, type ExecLike, type OperatorIntent } from '../src/core/operator.ts'

const GOOGLE = 'https://www.google.com'


describe('close references', () => {
  it('recognises pronoun closes only', () => {
    expect(['close it', 'Close that.', 'quit the app', 'close this window'].map(isCloseReference)).toEqual([true, true, true, true])
    expect(['close notepad', 'open it'].map(isCloseReference)).toEqual([false, false])
  })
  it('maps an opened label to a close intent, or null', () => {
    expect(closeIntentForLabel('Notepad')).toEqual({ kind: 'close', names: ['notepad'], label: 'Notepad' })
    expect(closeIntentForLabel('the browser')).toBeNull()
  })
})

describe('matchOperatorIntent', () => {
  const table: [string, OperatorIntent | null][] = [
    ['open browser', { kind: 'open', target: GOOGLE, label: 'the browser' }],
    ['Open the default browser.', { kind: 'open', target: GOOGLE, label: 'the browser' }],
    ['open notepad', { kind: 'open', target: 'notepad.exe', label: 'Notepad' }],
    ['please open Notepad for me', { kind: 'open', target: 'notepad.exe', label: 'Notepad' }],
    ['can you open the calculator?', { kind: 'open', target: 'calc.exe', label: 'Calculator' }],
    ['could you please launch paint', { kind: 'open', target: 'mspaint.exe', label: 'Paint' }],
    ['open file explorer', { kind: 'open', target: 'explorer.exe', label: 'File Explorer' }],
    ['open files', { kind: 'open', target: 'explorer.exe', label: 'File Explorer' }],
    ['open settings', { kind: 'open', target: 'ms-settings:', label: 'Settings' }],
    ['start the terminal app', { kind: 'open', target: 'wt.exe', label: 'Terminal' }],
    ['open command prompt', { kind: 'open', target: 'cmd.exe', label: 'Command Prompt' }],
    ['open cmd', { kind: 'open', target: 'cmd.exe', label: 'Command Prompt' }],
    ['open edge', { kind: 'open', target: 'msedge.exe', label: 'Edge' }],
    ['open chrome', { kind: 'open', target: 'chrome.exe', label: 'Chrome' }],
    ['open spotify', { kind: 'open', target: 'spotify:', label: 'Spotify' }],
    ['open VS Code', { kind: 'open', target: 'code', label: 'VS Code' }],
    ['open code', { kind: 'open', target: 'code', label: 'VS Code' }],
    ['open youtube', { kind: 'open', target: 'https://www.youtube.com', label: 'YouTube' }],
    ['read the news', { kind: 'news' }],
    ["what's today's news", { kind: 'news' }],
    ['headlines', { kind: 'news' }],
    ['tell me the latest headlines please', { kind: 'news' }],
    ['news about the cricket world cup', { kind: 'news', topic: 'the cricket world cup' }],
    ['read me the news on Chennai', { kind: 'news', topic: 'chennai' }],
    ['open my email', { kind: 'open', target: 'https://mail.google.com', label: 'Gmail' }],
    ['open inbox', { kind: 'open', target: 'https://mail.google.com', label: 'Gmail' }],
    ['open gmail', { kind: 'open', target: 'https://mail.google.com', label: 'Gmail' }],
    ['open github', { kind: 'open', target: 'https://github.com', label: 'GitHub' }],
    ['open google', { kind: 'open', target: GOOGLE, label: 'Google' }],
    ['open example.org', { kind: 'open', target: 'https://example.org', label: 'example.org' }],
    ['open www.Site.in', { kind: 'open', target: 'https://www.site.in', label: 'www.site.in' }],
    ['open openai dot com', { kind: 'open', target: 'https://openai.com', label: 'openai.com' }],
    ['search weather in Chennai', { kind: 'search', url: `${GOOGLE}/search?q=weather%20in%20Chennai`, query: 'weather in Chennai' }],
    ['search for cats on google', { kind: 'search', url: `${GOOGLE}/search?q=cats%20on%20google`, query: 'cats on google' }],
    ['Google best pizza near me', { kind: 'search', url: `${GOOGLE}/search?q=best%20pizza%20near%20me`, query: 'best pizza near me' }],
    ['look up rust lifetimes please', { kind: 'search', url: `${GOOGLE}/search?q=rust%20lifetimes`, query: 'rust lifetimes' }],
    ['play lo-fi beats on youtube', { kind: 'youtube', url: 'https://www.youtube.com/results?search_query=lo-fi%20beats', query: 'lo-fi beats' }],
    ['search youtube for cat videos', { kind: 'youtube', url: 'https://www.youtube.com/results?search_query=cat%20videos', query: 'cat videos' }],
    ['close notepad', { kind: 'close', names: ['notepad'], label: 'Notepad' }],
    ['please close the calculator', { kind: 'close', names: ['CalculatorApp', 'calc'], label: 'Calculator' }],
    ['close chrome for me', { kind: 'close', names: ['chrome'], label: 'Chrome' }],
    ['close vs code', { kind: 'close', names: ['Code'], label: 'VS Code' }],
    ['volume up', { kind: 'volume', action: 'up' }],
    ['turn the volume down', { kind: 'volume', action: 'down' }],
    ['turn up the volume', { kind: 'volume', action: 'up' }],
    ['mute', { kind: 'volume', action: 'mute' }],
    ['mute the sound', { kind: 'volume', action: 'mute' }],
    ['lock screen', { kind: 'lock' }],
    ['can you lock the computer', { kind: 'lock' }],
    ['what time is it', { kind: 'time' }],
    ["What's the time?", { kind: 'time' }],
    ["what's the date", { kind: 'date' }],
    ['what day is it today', { kind: 'date' }],
    // Negatives: left to the agent.
    ['open the pod bay doors', null],
    ['open', null],
    ['close everything', null],
    ['close', null],
    ['close file explorer', null],
    ['search', null],
    ['google', null],
    ['play some music', null],
    ['open malware.exe', null],
    ['open evil.com/path', null],
    ['open notepad and write my todo list', null],
    ['tell me a joke', null],
    ['', null],
  ]

  it.each(table)('%s', (input, expected) => {
    expect(matchOperatorIntent(input)).toEqual(expected)
  })

  it('url-encodes an injection attempt into the query and adds no command', () => {
    const intent = matchOperatorIntent("search x'; Remove-Item C:\\ -Recurse")
    expect(intent).toEqual({
      kind: 'search',
      query: "x'; Remove-Item C:\\ -Recurse",
      url: `${GOOGLE}/search?q=x%27%3B%20Remove-Item%20C%3A%5C%20-Recurse`,
    })
    if (intent?.kind !== 'search') throw new Error('expected a search')
    expect(intent.url).not.toMatch(/['\s;\\]/)
  })

  it('encodes query characters that encodeURIComponent leaves alone', () => {
    expect(matchOperatorIntent('search (a)*!~')).toMatchObject({ url: `${GOOGLE}/search?q=%28a%29%2A%21~` })
  })
})

describe('runOperatorIntent', () => {
  const noExec = async (): Promise<void> => {
    throw new Error('exec must not run')
  }

  interface Call { file: string; args: string[]; env: Record<string, string> }

  function recorder(): { calls: Call[]; exec: ExecLike } {
    const calls: Call[] = []
    return { calls, exec: async (file, args, env) => void calls.push({ file, args, env }) }
  }

  const PREFIX = ['-NoProfile', '-NonInteractive', '-Command']

  it('opens an app with a constant script and the target in the environment', async () => {
    const { calls, exec } = recorder()
    await expect(runOperatorIntent({ kind: 'open', target: 'notepad.exe', label: 'Notepad' }, exec)).resolves.toEqual({ spoken: 'Opening Notepad.' })
    expect(calls).toEqual([{ file: 'powershell.exe', args: [...PREFIX, 'Start-Process -FilePath $env:AIR_OP_TARGET'], env: { AIR_OP_TARGET: 'notepad.exe' } }])
  })

  it.each(['https://www.google.com', 'https://github.com/x?y=1#z', 'ms-settings:', 'spotify:', 'calc.exe', 'code'])('allows the target %s', async (target) => {
    const { calls, exec } = recorder()
    await runOperatorIntent({ kind: 'open', target, label: 'X' }, exec)
    expect(calls[0]!.env).toEqual({ AIR_OP_TARGET: target })
  })

  it.each(['cmd.exe /c del x', 'http://example.com', 'file:///C:/x', "https://a.com/'; calc", 'https://a b.com', 'powershell.exe', 'javascript:alert(1)', ''])('refuses the target %j', async (target) => {
    await expect(runOperatorIntent({ kind: 'open', target, label: 'X' }, noExec)).rejects.toThrow('not allowed')
  })

  it('searches Google and YouTube through a URL', async () => {
    const { calls, exec } = recorder()
    await expect(runOperatorIntent({ kind: 'search', query: 'cats', url: `${GOOGLE}/search?q=cats` }, exec)).resolves.toEqual({ spoken: 'Searching Google for cats.' })
    await expect(runOperatorIntent({ kind: 'youtube', query: 'lo-fi', url: 'https://www.youtube.com/results?search_query=lo-fi' }, exec)).resolves.toEqual({ spoken: 'Playing lo-fi on YouTube.' })
    expect(calls.map(call => call.env.AIR_OP_TARGET)).toEqual([`${GOOGLE}/search?q=cats`, 'https://www.youtube.com/results?search_query=lo-fi'])
  })

  it('refuses a search URL outside https', async () => {
    await expect(runOperatorIntent({ kind: 'search', query: 'x', url: 'ftp://x' }, noExec)).rejects.toThrow('not allowed')
  })

  it('closes whitelisted process names only', async () => {
    const { calls, exec } = recorder()
    await expect(runOperatorIntent({ kind: 'close', names: ['CalculatorApp', 'calc'], label: 'Calculator' }, exec)).resolves.toEqual({ spoken: 'Closing Calculator.' })
    expect(calls).toEqual([{ file: 'powershell.exe', args: [...PREFIX, "Get-Process -Name ($env:AIR_OP_TARGET -split ',') -ErrorAction Stop | ForEach-Object { $_.CloseMainWindow() | Out-Null }"], env: { AIR_OP_TARGET: 'CalculatorApp,calc' } }])
    await expect(runOperatorIntent({ kind: 'close', names: ['explorer'], label: 'File Explorer' }, noExec)).rejects.toThrow('not allowed')
    await expect(runOperatorIntent({ kind: 'close', names: [], label: 'Nothing' }, noExec)).rejects.toThrow('not allowed')
  })

  it('speaks news from the injected fetch, and falls back on failure', async () => {
    const feed = '<rss><item><title>One - A</title></item></rss>'
    const ok = async () => ({ ok: true, text: async () => feed })
    await expect(runOperatorIntent({ kind: 'news' }, noExec, () => new Date(), ok)).resolves.toEqual({ spoken: 'Top headlines. 1. One.' })
    await expect(runOperatorIntent({ kind: 'news', topic: 'x' }, noExec, () => new Date(), ok)).resolves.toEqual({ spoken: 'Top headlines about x. 1. One.' })
    await expect(runOperatorIntent({ kind: 'news' }, noExec, () => new Date(), async () => { throw new Error('offline') })).resolves.toEqual({ spoken: "I couldn't get the news." })
  })

  it('sends volume keys with constant scripts', async () => {
    const { calls, exec } = recorder()
    await expect(runOperatorIntent({ kind: 'volume', action: 'up' }, exec)).resolves.toEqual({ spoken: 'Volume up.' })
    await expect(runOperatorIntent({ kind: 'volume', action: 'down' }, exec)).resolves.toEqual({ spoken: 'Volume down.' })
    await expect(runOperatorIntent({ kind: 'volume', action: 'mute' }, exec)).resolves.toEqual({ spoken: 'Muted.' })
    expect(calls.map(call => call.args[3])).toEqual([
      '$s = New-Object -ComObject WScript.Shell; 1..5 | ForEach-Object { $s.SendKeys([char]175) }',
      '$s = New-Object -ComObject WScript.Shell; 1..5 | ForEach-Object { $s.SendKeys([char]174) }',
      '$s = New-Object -ComObject WScript.Shell; $s.SendKeys([char]173)',
    ])
    expect(calls.every(call => Object.keys(call.env).length === 0)).toBe(true)
  })

  it('locks the screen', async () => {
    const { calls, exec } = recorder()
    await expect(runOperatorIntent({ kind: 'lock' }, exec)).resolves.toEqual({ spoken: 'Locking the screen.' })
    expect(calls[0]!.args).toEqual([...PREFIX, 'rundll32.exe user32.dll,LockWorkStation'])
  })

  it('answers time and date locally without exec', async () => {
    const at = (): Date => new Date(2026, 9, 21, 21, 5)
    await expect(runOperatorIntent({ kind: 'time' }, noExec, at)).resolves.toMatchObject({ spoken: expect.stringMatching(/^It's 9:05\s?PM\.$/) as string })
    await expect(runOperatorIntent({ kind: 'date' }, noExec, at)).resolves.toEqual({ spoken: 'Today is Wednesday, October 21.' })
  })

  it('uses the real clock by default', async () => {
    await expect(runOperatorIntent({ kind: 'time' }, noExec)).resolves.toMatchObject({ spoken: expect.stringMatching(/^It's \d{1,2}:\d{2}/) as string })
  })

  it('propagates an exec failure', async () => {
    await expect(runOperatorIntent({ kind: 'lock' }, async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
  })
})
