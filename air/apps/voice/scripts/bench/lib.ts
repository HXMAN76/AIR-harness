/**
 * Shared pieces of the voice benchmarks: output folders, CSV, the run manifest, summary tables.
 * Every benchmark writes `research/data/voice/<bench>/<timestamp>/{data.csv,manifest.json}` and returns a
 * {@link BenchResult} that `run-all.ts` folds into `research/data/voice/SUMMARY.md`.
 * Nothing here reads a key; the cloud key is only checked for presence.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir, totalmem, version as osVersion } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from '../../src/core/paths.ts'
import { DEFAULT_VOICE } from '../../src/core/tts-engine.ts'
import { summarize } from '../../src/core/metrics.ts'

/** Where the benchmark data is committed. */
export const DATA_ROOT = join(REPO_ROOT, 'research', 'data', 'voice')

/** Settings shared by the benchmarks of one run. */
export interface BenchContext {
  /** Time stamp of the run, used for the folder names (`2026-10-22T10-00-00-000Z`). */
  stamp: string
  /** Small counts for a quick check of the harness; never used for the committed run. */
  quick: boolean
}

/** One summary table. */
export interface SummaryTable {
  title: string
  columns: string[]
  rows: (string | number)[][]
}

/** What a benchmark hands back. */
export interface BenchResult {
  bench: string
  /** Folder holding the data, relative to the repository root with forward slashes. */
  dir: string
  /** Number of measurements behind the main table. */
  n: number
  tables: SummaryTable[]
  notes: string[]
}

/** A benchmark that cannot run here (missing model, no key) reports why instead of failing the whole run. */
export class BenchSkipped extends Error {}

/**
 * @param argv - command line arguments after the script name.
 * @returns the context: `--quick` shrinks the counts.
 */
export function contextFromArgs(argv: readonly string[]): BenchContext {
  return { stamp: new Date().toISOString().replaceAll(/[:.]/g, '-'), quick: argv.includes('--quick') }
}

/**
 * @param ctx - the run context.
 * @param bench - benchmark name, also the folder name.
 * @returns the absolute output folder, created (a temporary folder for `--quick`, so smoke runs never reach the repository).
 */
export function runDir(ctx: BenchContext, bench: string): string {
  const dir = join(ctx.quick ? join(tmpdir(), 'air-bench-quick') : DATA_ROOT, bench, ctx.stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** @returns the path relative to the repository root, with forward slashes. */
export function repoRelative(path: string): string {
  const slashed = path.replaceAll('\\', '/')
  const root = REPO_ROOT.replaceAll('\\', '/')
  return slashed.startsWith(root) ? slashed.slice(root.length).replace(/^\//, '') : slashed
}

type Cell = string | number | boolean | undefined

function csvCell(cell: Cell): string {
  if (cell === undefined) return ''
  const text = typeof cell === 'number' ? (Number.isInteger(cell) ? String(cell) : String(Math.round(cell * 1000) / 1000)) : String(cell)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Write a CSV file.
 * @param path - destination.
 * @param header - column names.
 * @param rows - rows of cells; numbers are rounded to three decimals.
 */
export function writeCsv(path: string, header: readonly string[], rows: readonly (readonly Cell[])[]): void {
  writeFileSync(path, `${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`)
}

function command(file: string, args: string[]): string | undefined {
  try {
    return execFileSync(file, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true, cwd: REPO_ROOT }).trim()
  } catch {
    return undefined
  }
}

/** Ollama's version and the short digests of the named models; empty values when Ollama is not running. */
async function ollamaFacts(models: readonly string[]): Promise<{ version: string; digests: Record<string, string> }> {
  try {
    const version = await (await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(3000) })).json() as { version?: string }
    const tags = await (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })).json() as { models?: { name: string; digest: string }[] }
    const digests: Record<string, string> = {}
    for (const model of tags.models ?? []) {
      if (models.some(name => model.name === name || model.name === `${name}:latest`)) digests[model.name] = model.digest.slice(0, 12)
    }
    return { version: version.version ?? 'unknown', digests }
  } catch {
    return { version: 'not running', digests: {} }
  }
}

/** The machine and software facts every manifest carries. */
export async function machineFacts(models: readonly string[] = []): Promise<Record<string, unknown>> {
  const ollama = await ollamaFacts(models)
  const gpu = command('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'])?.split('\n')[0]?.trim()
  return {
    branch: command('git', ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    upstreamTag: command('git', ['describe', '--tags', '--abbrev=0', '--match', 'dsh-v*']) ?? 'unknown',
    os: `${osVersion()} ${release()}`,
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    logicalCores: cpus().length,
    ramGiB: Math.round(totalmem() / 2 ** 30 * 10) / 10,
    gpu: gpu ?? 'none detected',
    node: process.version,
    ollama: ollama.version,
    modelDigests: ollama.digests,
    kokoroVoice: process.env['AIR_VOICE_TTS_VOICE'] ?? DEFAULT_VOICE,
  }
}

/**
 * Write `manifest.json` into a run folder.
 * @param dir - the run folder.
 * @param bench - benchmark name.
 * @param n - number of measurements.
 * @param extra - benchmark-specific fields (repeat counts, voices, models).
 * @param models - Ollama model names whose digests are recorded.
 */
export async function writeManifest(
  dir: string,
  bench: string,
  n: number,
  extra: Record<string, unknown> = {},
  models: readonly string[] = [],
): Promise<void> {
  const manifest = { bench, at: new Date().toISOString(), n, ...await machineFacts(models), ...extra }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The columns of {@link statsRow}. */
export const STATS_COLUMNS = ['n', 'mean', 'p50', 'p90', 'p95', 'p99', 'min', 'max'] as const

function digits(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * @param label - row label.
 * @param values - measurements.
 * @param places - decimals to keep.
 * @returns `[label, n, mean, p50, p90, p95, p99, min, max]`, with dashes for no data.
 */
export function statsRow(label: string, values: readonly number[], places = 1): (string | number)[] {
  const stats = summarize(values)
  if (stats === undefined) return [label, 0, '-', '-', '-', '-', '-', '-', '-']
  const summary = [stats.mean, stats.p50, stats.p90, stats.p95, stats.p99, stats.min, stats.max]
  return [label, stats.n, ...summary.map(value => digits(value, places))]
}

/** A table of {@link statsRow}s with a first column named `first`. */
export function statsTable(
  title: string,
  first: string,
  groups: readonly (readonly [string, readonly number[]])[],
  places = 1,
): SummaryTable {
  return { title, columns: [first, ...STATS_COLUMNS], rows: groups.map(([label, values]) => statsRow(label, values, places)) }
}

/** @returns a table as GitHub Markdown. */
export function markdownTable(table: SummaryTable): string {
  const line = (cells: readonly (string | number)[]): string => `| ${cells.join(' | ')} |`
  return [line(table.columns), line(table.columns.map(() => '---')), ...table.rows.map(line)].join('\n')
}

/** @returns a rounded ratio as a percentage string. */
export function percent(part: number, whole: number): string {
  return whole === 0 ? '-' : `${(100 * part / whole).toFixed(1)}%`
}

/** Whether the file is the program entry, so it can run standalone and also be imported by `run-all.ts`. */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry).toLowerCase() === resolve(fileURLToPath(metaUrl)).toLowerCase()
}
