/**
 * Human-facing rendering of trust diffs. Server-supplied text (tool names, field names, descriptions,
 * instructions) is untrusted: it is printed with control, escape-sequence, zero-width, bidirectional,
 * and unpaired-surrogate characters made visible, inside quotes with `"` and `\` escaped, and cut to a
 * fixed length, so the text under review cannot add lines, reorder, hide, or flood what the person reads.
 * @module
 */

import type { ToolDigest } from './canonical.ts'
import type { LockServer } from './lockfile.ts'
import type { ObservedSurface, SurfaceDiff } from './types.ts'

/** Longest tool, field, or server name printed in full. */
const NAME_LIMIT = 100
/** Longest quoted description or instruction text printed in full. */
const TEXT_LIMIT = 4000
/** Most names listed per kind of change before the rest is counted. */
const LIST_LIMIT = 20
/** Characters of a review key shown to tell two same-named servers apart. */
const KEY_PREFIX = 12

function hidden(point: number): boolean {
  return point < 0x20
    || (point >= 0x7f && point <= 0x9f)
    || point === 0xad
    || point === 0x61c
    || point === 0x180e
    || (point >= 0x200b && point <= 0x200f)
    || (point >= 0x2028 && point <= 0x202e)
    || (point >= 0x2060 && point <= 0x2069)
    || (point >= 0xd800 && point <= 0xdfff)
    || (point >= 0xfe00 && point <= 0xfe0f)
    || point === 0xfeff
    || (point >= 0xfff9 && point <= 0xfffb)
    || (point >= 0xe0000 && point <= 0xe01ef)
}

/**
 * Replace invisible, terminal-control, and direction-changing characters with `<U+XXXX>`.
 * @param text - untrusted text.
 * @returns printable text.
 */
export function visible(text: string): string {
  let out = ''
  for (const char of text) {
    /* v8 ignore next -- a code point of a `for...of` string is never empty */
    const point = char.codePointAt(0) ?? 0
    out += hidden(point) ? `<U+${point.toString(16).toUpperCase().padStart(4, '0')}>` : char
  }
  return out
}

/**
 * Make untrusted text printable and cut it to a fixed length.
 * @param text - untrusted text.
 * @param limit - most UTF-16 units kept.
 * @returns printable text, ending with how many characters were cut when it was shortened.
 */
export function clip(text: string, limit: number): string {
  if (text.length <= limit) return visible(text)
  const high = text.charCodeAt(limit - 1)
  const end = high >= 0xd800 && high <= 0xdbff ? limit - 1 : limit
  return `${visible(text.slice(0, end))}<truncated ${String(text.length - end)} more characters>`
}

/** Printable list of names, at most `LIST_LIMIT` of them. */
function listed(names: readonly string[]): string {
  const shown = names.slice(0, LIST_LIMIT).map(name => clip(name, NAME_LIMIT)).join(', ')
  return names.length > LIST_LIMIT ? `${shown}, and ${String(names.length - LIST_LIMIT)} more` : shown
}

/** Key suffix that tells two servers with the same name apart; empty without a review key. */
function keyNote(reviewKey: string | undefined): string {
  return reviewKey === undefined ? '' : ` (key ${clip(reviewKey.slice(0, KEY_PREFIX), KEY_PREFIX)})`
}

/**
 * Argument text of a trust command for one server, shared by every denial and prompt that names a command.
 * The caller prepends the configured command prefix. A server with a review key gets `--key` with the first
 * 12 characters of the key, so two servers with the same name stay distinguishable.
 * @param action - the command to run.
 * @param serverName - local server name.
 * @param reviewKey - identity of the server definition, when it has one.
 * @returns for example `pin browser` or `pin browser --key 0123456789ab`.
 */
export function commandHint(action: 'pin' | 'diff' | 'revoke', serverName: string, reviewKey?: string): string {
  const key = reviewKey === undefined ? '' : ` --key ${clip(reviewKey.slice(0, KEY_PREFIX), KEY_PREFIX)}`
  return `${action} ${clip(serverName, NAME_LIMIT)}${key}`
}

/**
 * One-line summary of a diff for an approval prompt.
 * @param serverName - local server name.
 * @param diff - difference to summarize.
 * @param reviewKey - identity of the server definition; its first 12 characters are shown when present.
 * @returns the summary; it names tools and fields but never quotes definitions.
 */
export function renderDiffSummary(serverName: string, diff: SurfaceDiff, reviewKey?: string): string {
  const parts: string[] = []
  if (diff.invalid !== undefined) parts.push(`not canonicalizable (${clip(diff.invalid, NAME_LIMIT)})`)
  if (diff.added.length > 0) parts.push(`added ${listed(diff.added)}`)
  if (diff.removed.length > 0) parts.push(`removed ${listed(diff.removed)}`)
  if (diff.changed.length > 0) {
    const changes = diff.changed.map(change => `${clip(change.tool, NAME_LIMIT)} (${change.fields.map(field => clip(field, NAME_LIMIT)).join(', ')})`)
    parts.push(`changed ${changes.slice(0, LIST_LIMIT).join(', ')}${changes.length > LIST_LIMIT ? `, and ${String(changes.length - LIST_LIMIT)} more` : ''}`)
  }
  if (diff.instructionsChanged) parts.push('instructions changed')
  const summary = parts.length > 0 ? parts.join('; ') : 'no differences'
  return `MCP server "${clip(serverName, NAME_LIMIT)}"${keyNote(reviewKey)} changed its tool surface: ${summary}. Approve to use this surface until the process exits.`
}

function quoted(value: unknown): string {
  return typeof value === 'string' ? `"${clip(value, TEXT_LIMIT).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : '(absent)'
}

/**
 * Multi-line field-level difference between an observed surface and its pin.
 * @param surface - latest observed surface.
 * @param pinned - lock entry the surface was compared with, when one exists.
 * @param digests - digests of the observed tools by raw name.
 * @returns printable text.
 */
export function renderSurfaceDiff(
  surface: ObservedSurface,
  pinned: LockServer | undefined,
  digests: ReadonlyMap<string, ToolDigest>,
): string {
  const { diff } = surface
  const lines = [
    `server ${clip(surface.serverName, NAME_LIMIT)}${keyNote(surface.reviewKey)}: ${surface.state}`,
    `  observed surface ${surface.surfaceDigest === '' ? `(not canonicalizable: ${clip(diff.invalid ?? 'unknown', NAME_LIMIT)})` : surface.surfaceDigest}`,
    `  pinned surface   ${pinned?.surfaceDigest ?? '(none)'}`,
  ]
  const count = lines.length
  const more = (items: readonly unknown[], noun: string): void => {
    if (items.length > LIST_LIMIT) lines.push(`  ... and ${String(items.length - LIST_LIMIT)} more ${noun}`)
  }
  for (const name of diff.added.slice(0, LIST_LIMIT)) lines.push(`  + added   ${clip(name, NAME_LIMIT)}`)
  more(diff.added, 'added')
  for (const name of diff.removed.slice(0, LIST_LIMIT)) lines.push(`  - removed ${clip(name, NAME_LIMIT)}`)
  more(diff.removed, 'removed')
  for (const change of diff.changed.slice(0, LIST_LIMIT)) {
    lines.push(`  ~ changed ${clip(change.tool, NAME_LIMIT)} (${change.fields.map(field => clip(field, NAME_LIMIT)).join(', ')})`)
    if (!change.fields.includes('description')) continue
    const pinnedTool = pinned !== undefined && Object.hasOwn(pinned.tools, change.tool) ? pinned.tools[change.tool] : undefined
    lines.push(`      description pinned:   ${quoted(pinnedTool?.definition['description'])}`)
    lines.push(`      description observed: ${quoted(digests.get(change.tool)?.definition['description'])}`)
  }
  more(diff.changed, 'changed')
  if (diff.instructionsChanged) {
    lines.push('  ~ instructions changed')
    lines.push(`      pinned:   ${quoted(pinned?.instructions?.text)}`)
    lines.push(`      observed: ${quoted(surface.instructions === '' ? undefined : surface.instructions)}`)
  }
  if (lines.length === count && surface.surfaceDigest !== '' && pinned !== undefined) lines.push('  no differences')
  return lines.join('\n')
}
