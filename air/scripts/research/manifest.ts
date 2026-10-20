/** Shared helpers for the research scripts: run directory, run manifest, and CSV writing (Windows and Linux). */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { arch, platform, release, version } from 'node:os'
import { join, resolve } from 'node:path'

/** Repository root of this checkout. */
export const repoRoot = resolve(import.meta.dirname, '..', '..', '..')

/** Facts about the checkout and the machine a run used. Commit hashes are left out on purpose (repository text gates). */
export interface BaseManifest {
  readonly experiment: string
  readonly startedAt: string
  readonly gitBranch: string
  /** Nearest upstream release tag reachable from HEAD. */
  readonly upstreamTag: string
  /** Commits on HEAD after that tag (AIR commits and merges). */
  readonly commitsSinceTag: number
  /** True when tracked files had uncommitted changes at run time. */
  readonly workingTreeDirty: boolean
  readonly os: { readonly platform: string; readonly release: string; readonly version: string; readonly arch: string }
  readonly node: string
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

/**
 * Collect the checkout and machine facts for a manifest.
 * @param experiment - experiment id, such as `e1-token-census`.
 * @param startedAt - ISO time the run started.
 * @returns the base manifest.
 */
export function baseManifest(experiment: string, startedAt: string): BaseManifest {
  const upstreamTag = git(['describe', '--tags', '--abbrev=0', '--match', 'dsh-v*'])
  return {
    experiment,
    startedAt,
    gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    upstreamTag,
    commitsSinceTag: Number(git(['rev-list', '--count', `${upstreamTag}..HEAD`])),
    workingTreeDirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    os: { platform: platform(), release: release(), version: version(), arch: arch() },
    node: process.version,
  }
}

/**
 * Create `research/data/<experiment>/<timestamp>/` under the repository root.
 * @param experiment - short directory name, such as `e1`.
 * @param startedAt - ISO time the run started; colons and dots become dashes.
 * @returns the absolute run directory.
 */
export function runDirectory(experiment: string, startedAt: string): string {
  const dir = join(repoRoot, 'research', 'data', experiment, startedAt.replaceAll(/[:.]/gu, '-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** One CSV cell value. */
export type Cell = string | number | boolean | undefined

function csvCell(value: Cell): string {
  if (value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Render rows as CSV with a header line and LF line ends.
 * @param columns - column names, in order.
 * @param rows - one record per row, keyed by column name.
 * @returns the CSV text.
 */
export function toCsv(columns: readonly string[], rows: readonly Readonly<Record<string, Cell>>[]): string {
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map(column => csvCell(row[column])).join(','))
  return `${lines.join('\n')}\n`
}

/**
 * Write a JSON file with two-space indentation and a final newline.
 * @param file - absolute path.
 * @param value - JSON-compatible value.
 */
export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
