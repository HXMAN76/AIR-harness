/** Live progress text for an agent turn: a human label per tool call, and the elapsed-seconds suffix. Pure. */
import { findApp } from '@air/dsh-tool-open/whitelist'

/** Progress notifications the agent bridge reports while a turn runs. */
export type AgentProgress =
  | { kind: 'thinking' }
  | { kind: 'tool'; name: string; args?: Record<string, unknown> }

/** The line shown before any tool is known. */
export const THINKING_LINE = 'Thinking…'

/** After this many seconds a turn shows how long it has been running. */
export const ELAPSED_AFTER_S = 3

function text(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function openLabel(args: Record<string, unknown> | undefined): string {
  const kind = text(args, 'kind')
  const value = text(args, 'value')
  if (kind === 'app' && value !== undefined) return `Opening ${findApp(value)?.label ?? 'an app'}…`
  if (kind === 'search') return 'Searching Google…'
  if (kind === 'url') return 'Opening a web page…'
  return 'Opening…'
}

/**
 * @param name - the tool's name.
 * @param args - the call's arguments, when known. Only the `open` tool's app name is read, and only to pick a label.
 * @returns a short present-tense label, never containing a path, URL, or command text.
 */
export function toolLabel(name: string, args?: Record<string, unknown>): string {
  if (name === 'pwsh' || name === 'bash') return 'Running PowerShell…'
  if (name === 'open') return openLabel(args)
  if (name === 'web_fetch') return 'Reading a web page…'
  if (name === 'web_search') return 'Searching the web…'
  if (name.startsWith('memory_')) return 'Searching memory…'
  if (name.startsWith('mcp__browser__')) return 'Using the browser…'
  return `Working: ${name}…`
}

/**
 * @param progress - the latest progress notification.
 * @returns the base label.
 */
export function progressLabel(progress: AgentProgress): string {
  return progress.kind === 'thinking' ? THINKING_LINE : toolLabel(progress.name, progress.args)
}

/**
 * @param label - the base label, which ends with an ellipsis.
 * @param elapsedMs - time since the turn began.
 * @returns the label, with ` <n> s` appended once the turn has run for {@link ELAPSED_AFTER_S} seconds.
 */
export function withElapsed(label: string, elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000)
  return seconds >= ELAPSED_AFTER_S ? `${label} ${seconds} s` : label
}
