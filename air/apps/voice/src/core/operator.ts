/**
 * Local fast path for simple PC commands ("open notepad", "search for X", "volume up").
 * Matching is pure; running spawns PowerShell with a constant script and the one variable value
 * (a whitelisted target) in an environment variable, so user text is never parsed as a command.
 * The app and site whitelist and the URL rules live in `@air/dsh-tool-open`, shared with the agent's `open` tool.
 */
import { readNews, type FetchLike } from './news.ts'
import { nodeExec, runPowerShell, startTarget, TARGET_ENV, type ExecLike } from '@air/dsh-tool-open/exec'
import {
  findApp, findSite, GOOGLE_HOME, googleSearchUrl, isAllowedProcessList, youtubeSearchUrl,
} from '@air/dsh-tool-open/whitelist'

export type { ExecLike }

/** Result of running an intent. */
export interface OperatorResult {
  spoken: string
}

/** What the operator can do. */
export type OperatorIntent =
  | { kind: 'open'; target: string; label: string }
  | { kind: 'search'; query: string; url: string }
  | { kind: 'youtube'; query: string; url: string }
  | { kind: 'close'; names: string[]; label: string }
  | { kind: 'volume'; action: 'up' | 'down' | 'mute' }
  | { kind: 'lock' }
  | { kind: 'time' }
  | { kind: 'date' }
  | { kind: 'news'; topic?: string }

const VOLUME =
  /^(?:turn |put )?(?:the )?volume (up|down)$|^turn (up|down) the volume$|^(increase|raise|decrease|lower|reduce) (?:the )?volume$/

function clean(command: string): string {
  let text = command.trim().replaceAll(/\s+/g, ' ').replace(/[.!?,\s]+$/, '')
  // Lead-in politeness, then trailing politeness; either may repeat.
  for (let changed = true; changed;) {
    const next = text
      .replace(/^(?:please|hey|ok|okay)\s+/i, '')
      .replace(/^(?:can|could|would|will) you\s+/i, '')
      .replace(/\s+(?:for me|please)$/i, '')
    changed = next !== text
    text = next
  }
  return text
}

/** The text of the one capture group that took part in a match. */
function captured(match: RegExpExecArray): string {
  return match.slice(1).join('')
}

const NEWS_TOPIC = /^(?:(?:read|tell|give) me )?(?:the |todays |today s )?(?:latest )?(?:news|headlines) (?:about|on|for|of) (.+)$/
const NEWS_ALL = /^(?:(?:read|tell|give) me )?(?:what is |whats )?(?:the |todays |today s )?(?:latest |top )?(?:news|headlines)(?: today)?$|^(?:read|tell me) (?:the |todays )?(?:latest |top )?(?:news|headlines)$/

function matchNews(lower: string): OperatorIntent | null {
  const topic = NEWS_TOPIC.exec(lower)
  if (topic !== null) return { kind: 'news', topic: captured(topic).trim() }
  return NEWS_ALL.test(lower) ? { kind: 'news' } : null
}

function matchOpen(name: string): OperatorIntent | null {
  const lower = name.toLowerCase()
  if (/^(?:my )?(?:default |web )?browser$/.test(lower)) return { kind: 'open', target: GOOGLE_HOME, label: 'the browser' }
  if (/^(?:my )?(?:e-?mail|mail|inbox)$/.test(lower)) return { kind: 'open', target: 'https://mail.google.com', label: 'Gmail' }
  const app = findApp(lower)
  if (app !== undefined) return { kind: 'open', target: app.target, label: app.label }
  const site = findSite(lower)
  return site === null ? null : { kind: 'open', target: site.url, label: site.label }
}

function matchClose(name: string): OperatorIntent | null {
  const app = findApp(name)
  return app === undefined || app.processes.length === 0 ? null : { kind: 'close', names: app.processes, label: app.label }
}

/** "close it", "close that", "close the app": a close with no app named. */
export function isCloseReference(command: string): boolean {
  return /^(?:close|quit|exit) (?:it|that|this|(?:the|that|this) (?:app|application|program|window))$/i.test(clean(command))
}

/**
 * The close intent for an app AIR opened earlier.
 * @param label - the label of an `open` intent.
 * @returns the close intent, or null when the label is not a closable whitelisted app.
 */
export function closeIntentForLabel(label: string): OperatorIntent | null {
  return matchClose(label.toLowerCase())
}

/**
 * Match a command (the text after the wake phrase) to a local action.
 * @param command - spoken command.
 * @returns the intent, or null when the agent should handle the command.
 */
export function matchOperatorIntent(command: string): OperatorIntent | null {
  const text = clean(command)
  const lower = text.toLowerCase().replaceAll(/['’]/g, '')
  if (/^(?:what time is it(?: now| right now)?|(?:whats|what is) the time(?: now)?|tell me the time)$/.test(lower)) return { kind: 'time' }
  if (/^(?:(?:whats|what is) (?:the |todays )?date(?: today)?|what day is it(?: today)?)$/.test(lower)) return { kind: 'date' }
  const news = matchNews(lower)
  if (news !== null) return news
  if (/^lock (?:the |my )?(?:screen|computer|pc|laptop)$/.test(lower)) return { kind: 'lock' }
  const volume = VOLUME.exec(lower)
  if (volume !== null) {
    const word = captured(volume)
    return { kind: 'volume', action: word === 'up' || word === 'increase' || word === 'raise' ? 'up' : 'down' }
  }
  if (/^(?:mute|unmute)(?: the)?(?: volume| sound| audio)?$/.test(lower)) return { kind: 'volume', action: 'mute' }

  const open = /^(?:open|launch|start|run)(?: up)? (?:the )?(.+)$/i.exec(text)
  if (open !== null) return matchOpen(captured(open))
  const close = /^(?:close|quit|exit|kill) (?:the )?(.+)$/i.exec(text)
  if (close !== null) return matchClose(captured(close))

  const playOn = /^play (.+?) on youtube$/i.exec(text) ?? /^(?:search )?youtube (?:for )?(.+)$/i.exec(text)
  if (playOn !== null) {
    const query = captured(playOn)
    return { kind: 'youtube', query, url: youtubeSearchUrl(query) }
  }
  const search = /^(?:search(?: google| the web| online)?(?: for)?|google|look up) (.+)$/i.exec(text)
  if (search !== null) {
    const query = captured(search)
    return { kind: 'search', query, url: googleSearchUrl(query) }
  }
  return null
}

/** Graceful close: ask each main window to close, so an app with unsaved work shows its own save prompt. */
const CLOSE_SCRIPT = `Get-Process -Name ($env:${TARGET_ENV} -split ',') -ErrorAction Stop | ForEach-Object { $_.CloseMainWindow() | Out-Null }`
const KEYS = '$s = New-Object -ComObject WScript.Shell; '
const VOLUME_SCRIPTS = {
  up: `${KEYS}1..5 | ForEach-Object { $s.SendKeys([char]175) }`,
  down: `${KEYS}1..5 | ForEach-Object { $s.SendKeys([char]174) }`,
  mute: `${KEYS}$s.SendKeys([char]173)`,
}
const VOLUME_SPEECH = { up: 'Volume up.', down: 'Volume down.', mute: 'Muted.' }

/**
 * Run an intent.
 * @param intent - from {@link matchOperatorIntent}; targets are checked again before anything runs.
 * @param exec - process runner; the default spawns for real.
 * @param now - clock for time and date answers.
 * @param fetchFn - HTTP client for the news feed.
 * @returns the short sentence to speak.
 * @throws when the target is not allowed or the process fails.
 */
export async function runOperatorIntent(
  intent: OperatorIntent,
  exec: ExecLike = nodeExec,
  now: () => Date = () => new Date(),
  fetchFn: FetchLike = fetch,
): Promise<OperatorResult> {
  switch (intent.kind) {
    case 'open':
      await startTarget(exec, intent.target)
      return { spoken: `Opening ${intent.label}.` }
    case 'search':
      await startTarget(exec, intent.url)
      return { spoken: `Searching Google for ${intent.query}.` }
    case 'youtube':
      await startTarget(exec, intent.url)
      return { spoken: `Playing ${intent.query} on YouTube.` }
    case 'close': {
      if (!isAllowedProcessList(intent.names)) throw new Error('That process is not allowed.')
      await runPowerShell(exec, CLOSE_SCRIPT, intent.names.join(','))
      return { spoken: `Closing ${intent.label}.` }
    }
    case 'volume':
      await runPowerShell(exec, VOLUME_SCRIPTS[intent.action])
      return { spoken: VOLUME_SPEECH[intent.action] }
    case 'lock':
      await runPowerShell(exec, 'rundll32.exe user32.dll,LockWorkStation')
      return { spoken: 'Locking the screen.' }
    case 'time':
      return { spoken: `It's ${now().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` }
    case 'news':
      return { spoken: await readNews({ fetchFn, ...intent.topic === undefined ? {} : { topic: intent.topic }, env: process.env }) }
    case 'date':
      return { spoken: `Today is ${now().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` }
  }
}
