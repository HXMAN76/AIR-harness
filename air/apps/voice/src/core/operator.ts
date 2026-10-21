/**
 * Local fast path for simple PC commands ("open notepad", "search for X", "volume up").
 * Matching is pure; running spawns PowerShell with a constant script and the one variable value
 * (a whitelisted target) in an environment variable, so user text is never parsed as a command.
 */
import { nodeExec } from '../node-exec.ts'

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

/** Runs an executable with arguments and extra environment variables; rejects when it fails. */
export type ExecLike = (file: string, args: string[], env: Record<string, string>) => Promise<void>

interface AppEntry {
  label: string
  /** Spoken forms (lower case). */
  names: string[]
  /** What `Start-Process` receives: an executable, or a `ms-settings:` / `spotify:` scheme. */
  target: string
  /** Process names `close <app>` may stop; none when the app must not be closed this way. */
  processes: string[]
}

const APPS: AppEntry[] = [
  { label: 'Notepad', names: ['notepad'], target: 'notepad.exe', processes: ['notepad'] },
  { label: 'Calculator', names: ['calculator', 'calc'], target: 'calc.exe', processes: ['CalculatorApp', 'calc'] },
  { label: 'Paint', names: ['paint'], target: 'mspaint.exe', processes: ['mspaint'] },
  { label: 'File Explorer', names: ['file explorer', 'explorer', 'files'], target: 'explorer.exe', processes: [] },
  { label: 'Settings', names: ['settings'], target: 'ms-settings:', processes: ['SystemSettings'] },
  { label: 'Terminal', names: ['terminal'], target: 'wt.exe', processes: ['WindowsTerminal'] },
  { label: 'Command Prompt', names: ['command prompt', 'cmd'], target: 'cmd.exe', processes: ['cmd'] },
  { label: 'Edge', names: ['edge'], target: 'msedge.exe', processes: ['msedge'] },
  { label: 'Chrome', names: ['chrome'], target: 'chrome.exe', processes: ['chrome'] },
  { label: 'Spotify', names: ['spotify'], target: 'spotify:', processes: ['Spotify'] },
  { label: 'VS Code', names: ['vs code', 'code'], target: 'code', processes: ['Code'] },
]

const SITES: Record<string, { label: string; url: string }> = {
  youtube: { label: 'YouTube', url: 'https://www.youtube.com' },
  gmail: { label: 'Gmail', url: 'https://mail.google.com' },
  github: { label: 'GitHub', url: 'https://github.com' },
  google: { label: 'Google', url: 'https://www.google.com' },
}

const GOOGLE_HOME = 'https://www.google.com'
const VOLUME =
  /^(?:turn |put )?(?:the )?volume (up|down)$|^turn (up|down) the volume$|^(increase|raise|decrease|lower|reduce) (?:the )?volume$/
const DOMAIN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|in|io)$/

const URL_TARGET =
  /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s'"`;|<>^]*)?$/i
const SCHEME_TARGETS = new Set(['ms-settings:', 'spotify:'])
const EXECUTABLE_TARGETS = new Set(APPS.map(app => app.target).filter(target => !SCHEME_TARGETS.has(target)))
const PROCESS_NAMES = new Set(APPS.flatMap(app => app.processes))

function isAllowedTarget(target: string): boolean {
  return SCHEME_TARGETS.has(target) || EXECUTABLE_TARGETS.has(target) || URL_TARGET.test(target)
}

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

/** Percent-encode everything except unreserved characters (also `'()*!`, which encodeURIComponent leaves). */
function encodeQuery(query: string): string {
  return encodeURIComponent(query).replaceAll(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** The text of the one capture group that took part in a match. */
function captured(match: RegExpExecArray): string {
  return match.slice(1).join('')
}

function findApp(name: string): AppEntry | undefined {
  const spoken = name.toLowerCase().replace(/ (?:app|application)$/, '')
  return APPS.find(app => app.names.includes(spoken))
}

function matchOpen(name: string): OperatorIntent | null {
  const lower = name.toLowerCase()
  if (/^(?:my )?(?:default |web )?browser$/.test(lower)) return { kind: 'open', target: GOOGLE_HOME, label: 'the browser' }
  const app = findApp(lower)
  if (app !== undefined) return { kind: 'open', target: app.target, label: app.label }
  const site = SITES[lower]
  if (site !== undefined) return { kind: 'open', target: site.url, label: site.label }
  const domain = lower.replaceAll(/\s+dot\s+/g, '.').replaceAll(/\s+/g, '-')
  if (DOMAIN.test(domain)) return { kind: 'open', target: `https://${domain}`, label: domain }
  return null
}

function matchClose(name: string): OperatorIntent | null {
  const app = findApp(name)
  return app === undefined || app.processes.length === 0 ? null : { kind: 'close', names: app.processes, label: app.label }
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
    return { kind: 'youtube', query, url: `https://www.youtube.com/results?search_query=${encodeQuery(query)}` }
  }
  const search = /^(?:search(?: google| the web| online)?(?: for)?|google|look up) (.+)$/i.exec(text)
  if (search !== null) {
    const query = captured(search)
    return { kind: 'search', query, url: `${GOOGLE_HOME}/search?q=${encodeQuery(query)}` }
  }
  return null
}

const POWERSHELL = 'powershell.exe'
const PREFIX = ['-NoProfile', '-NonInteractive', '-Command']
const OPEN_SCRIPT = 'Start-Process -FilePath $env:AIR_OP_TARGET'
const CLOSE_SCRIPT = "Stop-Process -Name ($env:AIR_OP_TARGET -split ',') -ErrorAction Stop"
const KEYS = '$s = New-Object -ComObject WScript.Shell; '
const VOLUME_SCRIPTS = {
  up: `${KEYS}1..5 | ForEach-Object { $s.SendKeys([char]175) }`,
  down: `${KEYS}1..5 | ForEach-Object { $s.SendKeys([char]174) }`,
  mute: `${KEYS}$s.SendKeys([char]173)`,
}
const VOLUME_SPEECH = { up: 'Volume up.', down: 'Volume down.', mute: 'Muted.' }

function script(exec: ExecLike, body: string, target?: string): Promise<void> {
  return exec(POWERSHELL, [...PREFIX, body], target === undefined ? {} : { AIR_OP_TARGET: target })
}

function checkedTarget(target: string): string {
  if (!isAllowedTarget(target)) throw new Error('That target is not allowed.')
  return target
}

/**
 * Run an intent.
 * @param intent - from {@link matchOperatorIntent}; targets are checked again before anything runs.
 * @param exec - process runner; the default spawns for real.
 * @param now - clock for time and date answers.
 * @returns the short sentence to speak.
 * @throws when the target is not allowed or the process fails.
 */
export async function runOperatorIntent(
  intent: OperatorIntent,
  exec: ExecLike = nodeExec,
  now: () => Date = () => new Date(),
): Promise<OperatorResult> {
  switch (intent.kind) {
    case 'open':
      await script(exec, OPEN_SCRIPT, checkedTarget(intent.target))
      return { spoken: `Opening ${intent.label}.` }
    case 'search':
      await script(exec, OPEN_SCRIPT, checkedTarget(intent.url))
      return { spoken: `Searching Google for ${intent.query}.` }
    case 'youtube':
      await script(exec, OPEN_SCRIPT, checkedTarget(intent.url))
      return { spoken: `Playing ${intent.query} on YouTube.` }
    case 'close': {
      if (intent.names.length === 0 || !intent.names.every(name => PROCESS_NAMES.has(name))) throw new Error('That process is not allowed.')
      await script(exec, CLOSE_SCRIPT, intent.names.join(','))
      return { spoken: `Closing ${intent.label}.` }
    }
    case 'volume':
      await script(exec, VOLUME_SCRIPTS[intent.action])
      return { spoken: VOLUME_SPEECH[intent.action] }
    case 'lock':
      await script(exec, 'rundll32.exe user32.dll,LockWorkStation')
      return { spoken: 'Locking the screen.' }
    case 'time':
      return { spoken: `It's ${now().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` }
    case 'date':
      return { spoken: `Today is ${now().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` }
  }
}
