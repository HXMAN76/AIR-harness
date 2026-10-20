/**
 * E2, compaction threshold table (deterministic, no model calls).
 *
 * For each context window, computes the pressure threshold at which compaction-basic starts compacting, under
 * (i) upstream defaults and (ii) the AIR per-model policies that ship in air/bundles/air/cordis.patch.yml (full and lean
 * presets). The numbers come from upstream's own functions (`resolveConfig`, `resolveTargetPolicy`, `resolveCompactSpec`
 * in packages/compaction/compaction-basic/src/config.ts), imported here, not copied. A thrown `TargetPressureConfigError`
 * is what upstream does when the pressure budget is not positive: the engine logs one warning per target and continues
 * the turn without compacting, so the row reads "never compacts".
 *
 * Usage: pnpm -C air exec tsx scripts/research/e2-threshold-table.ts [--reserved 4096] [--fixed-prompt-tokens N] [--no-write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import {
  TargetPressureConfigError,
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
} from '../../../packages/compaction/compaction-basic/src/config.ts'
import type { BasicCompactionConfig } from '../../../packages/compaction/compaction-basic/src/types.ts'
import { MODEL_WINDOWS, PROVIDER, RESERVED_OUTPUT_TOKENS } from '../gen-compaction-policies.ts'
import { baseManifest, repoRoot, runDirectory, toCsv, writeJson } from './manifest.ts'

/** Context windows in the table: 4K, 8K, 16K, 24K, 32K, 64K, 128K, and the 200,000-token window of large hosted models. */
export const WINDOWS: readonly number[] = [4096, 8192, 16384, 24576, 32768, 65536, 131072, 200000]

/** Which configuration a row uses. */
export type Arm = 'upstream-default' | 'air-full' | 'air-lean'

/** Outcome of the pressure trigger for one row. */
export type Outcome = 'compacts' | 'never compacts' | 'compacts every step'

/** One row of the threshold table. */
export interface ThresholdRow {
  readonly window: number
  readonly arm: Arm
  /** Model id used to look up a policy; `(none)` when AIR has no policy for this window. */
  readonly model: string
  /** True when an exact `modelPolicies` entry matched the model. */
  readonly policyMatched: boolean
  readonly reservedOutputTokens: number
  readonly thresholdRatio: number
  readonly headroomTokens: number
  /** `window - reservedOutputTokens - headroomTokens`; upstream refuses to compact when this is not positive. */
  readonly pressureBudgetTokens: number
  /** `floor(min(window x thresholdRatio, pressureBudgetTokens))`, the formula without upstream's guard; may be negative. */
  readonly formulaThresholdTokens: number
  /** Threshold upstream actually uses; undefined when upstream throws and skips pressure compaction. */
  readonly thresholdTokens: number | undefined
  /** Verbatim tail kept after a compaction; undefined when upstream throws. */
  readonly retainTokens: number | undefined
  /** Output cap of the summary request (defaults to headroomTokens upstream). */
  readonly summaryMaxTokens: number
  /** Threshold as a fraction of the window, rounded to 4 places; undefined when upstream throws. */
  readonly thresholdShare: number | undefined
  readonly outcome: Outcome
  /** Upstream's error message when it refused, or a short explanation. */
  readonly note: string
}

/** Options of one table computation. */
export interface TableOptions {
  /** Output tokens one request reserves; the local model rows declare maxTokens 4096. */
  readonly reservedOutputTokens?: number
  /** Measured fixed prompt (system prompt plus tools) in tokens; a threshold at or below it compacts every step. */
  readonly fixedPromptTokens?: number
  /** AIR compaction-basic configs, by preset; defaults to the ones read from the shipped bundle patch. */
  readonly airConfigs?: Readonly<Record<'air-full' | 'air-lean', BasicCompactionConfig>>
}

const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (source: string) => `!!js ${source}` }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPolicyConfig(value: unknown): value is BasicCompactionConfig {
  return isRecord(value) && (value['modelPolicies'] === undefined || Array.isArray(value['modelPolicies']))
}

/**
 * Read the `compaction-basic` row config of one AIR preset from the bundle patch text.
 * @param patchText - contents of air/bundles/air/cordis.patch.yml.
 * @param rowId - `preset-air` or `preset-air-lean`.
 * @returns the config object exactly as the preset passes it to the compaction engine.
 */
export function airCompactionConfig(patchText: string, rowId: 'preset-air' | 'preset-air-lean'): BasicCompactionConfig {
  const parsed: unknown = parse(patchText, { customTags: [jsTag] })
  const rows = (Array.isArray(parsed) ? parsed.filter(isRecord) : [])
    .flatMap(patch => (Array.isArray(patch['insert']) ? patch['insert'].filter(isRecord) : []))
  const config = rows.find(row => row['id'] === rowId)?.['config']
  const plugins = isRecord(config) && Array.isArray(config['plugins']) ? config['plugins'].filter(isRecord) : []
  const group = plugins.find(plugin => plugin['id'] === 'compaction')
  const members = group !== undefined && Array.isArray(group['config']) ? group['config'].filter(isRecord) : []
  const basic = members.find(member => member['id'] === 'compaction-basic')?.['config']
  if (!isPolicyConfig(basic)) throw new Error(`e2: no compaction-basic config in ${rowId}`)
  return basic
}

/** The AIR configs that ship in the bundle patch. */
export function shippedAirConfigs(): Record<'air-full' | 'air-lean', BasicCompactionConfig> {
  const text = readFileSync(join(repoRoot, 'air', 'bundles', 'air', 'cordis.patch.yml'), 'utf8')
  return { 'air-full': airCompactionConfig(text, 'preset-air'), 'air-lean': airCompactionConfig(text, 'preset-air-lean') }
}

/** First AIR local model id with this window, in table order, or undefined. */
function modelFor(window: number): string | undefined {
  return Object.entries(MODEL_WINDOWS).find(([, modelWindow]) => modelWindow === window)?.[0]
}

/**
 * Evaluate one configuration at one window through upstream's functions.
 * @param arm - which configuration this is.
 * @param config - compaction-basic config as the plugin receives it.
 * @param window - adapter context window.
 * @param options - reserved output and optional fixed prompt size.
 * @returns the table row.
 */
export function evaluate(arm: Arm, config: BasicCompactionConfig, window: number, options: TableOptions = {}): ThresholdRow {
  const reserved = options.reservedOutputTokens ?? RESERVED_OUTPUT_TOKENS
  // Upstream defaults carry no policies, so the model id only labels the row there.
  const model = modelFor(window) ?? '(none)'
  const resolved = resolveConfig(config)
  const policyMatched = resolved.modelPolicies.some(policy => policy.provider === PROVIDER && policy.model === model)
  const policy = resolveTargetPolicy(resolved, { provider: PROVIDER, model })
  const pressureBudgetTokens = window - reserved - policy.headroomTokens
  const formulaThresholdTokens = Math.floor(Math.min(window * policy.thresholdRatio, pressureBudgetTokens))
  const base = {
    window, arm, model, policyMatched, reservedOutputTokens: reserved, thresholdRatio: policy.thresholdRatio,
    headroomTokens: policy.headroomTokens, pressureBudgetTokens, formulaThresholdTokens, summaryMaxTokens: policy.maxTokens,
  }
  try {
    const spec = resolveCompactSpec(policy, window, reserved)
    const everyStep = options.fixedPromptTokens !== undefined && spec.thresholdTokens <= options.fixedPromptTokens
    return {
      ...base,
      thresholdTokens: spec.thresholdTokens,
      retainTokens: spec.retainTokens,
      thresholdShare: Math.round((spec.thresholdTokens / window) * 10_000) / 10_000,
      outcome: everyStep ? 'compacts every step' : 'compacts',
      note: everyStep
        ? `threshold ${spec.thresholdTokens} is at or below the fixed prompt of ${String(options.fixedPromptTokens)} tokens`
        : policyMatched || arm === 'upstream-default' ? '' : 'no AIR policy for this window; upstream defaults apply',
    }
  } catch (error) {
    if (!(error instanceof TargetPressureConfigError)) throw error
    return {
      ...base,
      thresholdTokens: undefined,
      retainTokens: undefined,
      thresholdShare: undefined,
      outcome: 'never compacts',
      note: error.message,
    }
  }
}

/**
 * Compute the whole table.
 * @param options - reserved output, fixed prompt, and AIR configs.
 * @returns rows ordered by window, then upstream default, AIR full, AIR lean.
 */
export function thresholdTable(options: TableOptions = {}): ThresholdRow[] {
  const air = options.airConfigs ?? shippedAirConfigs()
  return WINDOWS.flatMap(window => [
    evaluate('upstream-default', {}, window, options),
    evaluate('air-full', air['air-full'], window, options),
    evaluate('air-lean', air['air-lean'], window, options),
  ])
}

/** CSV column order; README.md in this directory explains each column. */
export const COLUMNS: readonly (keyof ThresholdRow)[] = [
  'window', 'arm', 'model', 'policyMatched', 'reservedOutputTokens', 'thresholdRatio', 'headroomTokens',
  'pressureBudgetTokens', 'formulaThresholdTokens', 'thresholdTokens', 'thresholdShare', 'retainTokens',
  'summaryMaxTokens', 'outcome', 'note',
]

function numberFlag(argv: readonly string[], name: string): number | undefined {
  const at = argv.indexOf(name)
  if (at < 0) return undefined
  const value = Number(argv[at + 1])
  if (!Number.isInteger(value) || value < 0) throw new Error(`e2: ${name} needs a non-negative integer`)
  return value
}

function markdown(rows: readonly ThresholdRow[]): string {
  const head = '| window | arm | model | headroom | budget | formula | threshold | share | retain | summary max | outcome |'
  const lines = [head, '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|']
  for (const row of rows) {
    lines.push(`| ${row.window} | ${row.arm} | ${row.model} | ${row.headroomTokens} | ${row.pressureBudgetTokens} | `
      + `${row.formulaThresholdTokens} | ${row.thresholdTokens ?? '-'} | ${row.thresholdShare ?? '-'} | ${row.retainTokens ?? '-'} | `
      + `${row.summaryMaxTokens} | ${row.outcome} |`)
  }
  return lines.join('\n')
}

function main(argv: readonly string[]): void {
  const startedAt = new Date().toISOString()
  const reservedOutputTokens = numberFlag(argv, '--reserved') ?? RESERVED_OUTPUT_TOKENS
  const fixedPromptTokens = numberFlag(argv, '--fixed-prompt-tokens')
  const options: TableOptions = fixedPromptTokens === undefined ? { reservedOutputTokens } : { reservedOutputTokens, fixedPromptTokens }
  const rows = thresholdTable(options)
  console.log(markdown(rows))
  if (argv.includes('--no-write')) return
  const dir = runDirectory('e2', startedAt)
  writeFileSync(join(dir, 'thresholds.csv'), toCsv(COLUMNS, rows.map(row => ({ ...row }))))
  writeJson(join(dir, 'manifest.json'), {
    ...baseManifest('e2-threshold-table', startedAt),
    source: 'packages/compaction/compaction-basic/src/config.ts (resolveConfig, resolveTargetPolicy, resolveCompactSpec)',
    airPolicySource: 'air/bundles/air/cordis.patch.yml (preset-air and preset-air-lean compaction-basic rows)',
    provider: PROVIDER,
    windows: WINDOWS,
    reservedOutputTokens,
    fixedPromptTokens: fixedPromptTokens ?? null,
    upstreamDefaults: { thresholdRatio: 0.8, headroomTokens: 65536, retainRatio: 0.16, maxTokens: 'headroomTokens' },
    files: ['thresholds.csv'],
  })
  console.log(`\ne2: wrote ${dir}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
