/**
 * The one list of things AIR may open or close by name, and the rules for URLs. Pure; shared by the
 * `open` tool and the voice app's local operator.
 */

/** An app that can be opened (and, when `processes` is not empty, closed) by name. */
export interface AppEntry {
  label: string
  /** Spoken forms (lower case). */
  names: string[]
  /** What `Start-Process` receives: an executable, or a `ms-settings:` / `spotify:` scheme. */
  target: string
  /** Process names `close <app>` may stop; none when the app must not be closed this way. */
  processes: string[]
}

/** Apps by spoken name. */
export const APPS: readonly AppEntry[] = [
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

/** Well-known sites by spoken name. */
export const SITES: Readonly<Record<string, { label: string; url: string }>> = {
  youtube: { label: 'YouTube', url: 'https://www.youtube.com' },
  gmail: { label: 'Gmail', url: 'https://mail.google.com' },
  github: { label: 'GitHub', url: 'https://github.com' },
  google: { label: 'Google', url: 'https://www.google.com' },
}

/** Where "open the browser" goes (the default browser would otherwise open about:blank). */
export const GOOGLE_HOME = 'https://www.google.com'

const DOMAIN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|in|io)$/
const URL_TARGET = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s'"`;|<>^]*)?$/i
const SCHEME_TARGETS = new Set(['ms-settings:', 'spotify:'])
const EXECUTABLE_TARGETS = new Set(APPS.map(app => app.target).filter(target => !SCHEME_TARGETS.has(target)))
const PROCESS_NAMES = new Set(APPS.flatMap(app => app.processes))

/**
 * @param name - spoken app name, any case, with an optional trailing "app" or "application".
 * @returns the whitelisted app, or undefined.
 */
export function findApp(name: string): AppEntry | undefined {
  const spoken = name.trim().toLowerCase().replace(/ (?:app|application)$/, '')
  return APPS.find(app => app.names.includes(spoken))
}

/**
 * @param name - spoken site name ("youtube") or a domain ending in .com, .org, .in, or .io ("example.org", "openai dot com").
 * @returns where to go and how to call it, or null.
 */
export function findSite(name: string): { label: string; url: string } | null {
  const lower = name.trim().toLowerCase()
  const site = SITES[lower]
  if (site !== undefined) return site
  const domain = lower.replaceAll(/\s+dot\s+/g, '.').replaceAll(/\s+/g, '-')
  return DOMAIN.test(domain) ? { label: domain, url: `https://${domain}` } : null
}

/**
 * @param target - what `Start-Process` would receive.
 * @returns whether it is a whitelisted executable, a `ms-settings:` or `spotify:` scheme, or a plain https URL.
 */
export function isAllowedTarget(target: string): boolean {
  return SCHEME_TARGETS.has(target) || EXECUTABLE_TARGETS.has(target) || URL_TARGET.test(target)
}

/**
 * @param names - process names to stop.
 * @returns whether there is at least one and all are whitelisted.
 */
export function isAllowedProcessList(names: readonly string[]): boolean {
  return names.length > 0 && names.every(name => PROCESS_NAMES.has(name))
}

/**
 * Percent-encode everything except unreserved characters (also `'()*!`, which encodeURIComponent leaves).
 * @param query - free text.
 * @returns the encoded text.
 */
export function encodeQuery(query: string): string {
  return encodeURIComponent(query).replaceAll(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * @param query - search words.
 * @returns a Google results URL.
 */
export function googleSearchUrl(query: string): string {
  return `${GOOGLE_HOME}/search?q=${encodeQuery(query)}`
}

/**
 * @param query - search words.
 * @returns a YouTube results URL.
 */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeQuery(query)}`
}
