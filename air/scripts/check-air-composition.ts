/** Compose the AIR bundle in a throwaway profile and check the rows the file-conventions plan adds (Windows and Linux). */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LAUNCHER_PROBLEM } from './launcher-problems.ts'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const home = mkdtempSync(join(tmpdir(), 'air-check-'))
const profile = 'air-check'
const env = { ...process.env, DSH_HOME: home }
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]

function fail(message: string, detail = ''): never {
  console.error(`composition: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

function dsh(args: readonly string[]): { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) fail(`dsh ${args.join(' ')} exited ${String(result.status)}`, result.stderr)
  return { stdout: result.stdout, stderr: result.stderr }
}

dsh(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
dsh(['plugin', '--profile', profile, 'add', join(repoRoot, 'air', 'bundles', 'air')])
copyFileSync(
  join(repoRoot, 'air', 'examples', 'ollama.profile.cordis.patch.yml'),
  join(home, 'profiles', profile, 'cordis.patch.yml'),
)
writeFileSync(join(home, '.env'), 'OLLAMA_API_KEY=ollama\n')

const dump = dsh(['--profile', profile, '--dump-config'])
if (LAUNCHER_PROBLEM.test(dump.stderr)) fail('problems while composing:', dump.stderr)

const text = dump.stdout
const count = (pattern: RegExp): number => text.match(pattern)?.length ?? 0
const presetAt = text.search(/id:\s*['"]?preset-air(?![-\w])/u)
const presetText = presetAt < 0 ? '' : text.slice(presetAt, presetAt + 20_000)
const leanAt = text.search(/id:\s*['"]?preset-air-lean\b/u)
// The lean preset is the last preset row before the host rows, so its text runs to the next top-level row.
const leanText = leanAt < 0 ? '' : text.slice(leanAt, leanAt + 20_000)
const registryAt = text.search(/id:\s*['"]?agent-preset-registry\b/u)
/** Package names of the rows the lean preset omits; they mirror REMOVED_ROW_IDS in gen-preset-air-lean.ts. */
const removedPackages = [
  'dsh-tool-schedule',
  'dsh-command-goal',
  'dsh-tool-goal',
  'dsh-tool-subagent-control',
  'dsh-tool-subagent-control/list-agents',
  'dsh-tool-subagent',
  'dsh-workflow-ptc',
  'dsh-tool-workflow',
]
/** Checks that the lean preset text lacks every removed row while the full preset text keeps them. */
function presetChecks(prefix: string, lean: string, full: string): readonly (readonly [string, boolean])[] {
  const leanBody = lean.slice(0, lean.search(/\n- id:|\n    - id: air-mcp/u) < 0 ? undefined : lean.search(/\n- id:|\n    - id: air-mcp/u))
  const fullBody = full.slice(0, full.indexOf('id: preset-air-lean') < 0 ? undefined : full.indexOf('id: preset-air-lean'))
  return [
    [`${prefix}lean preset has the kept tools`, leanBody.includes('dsh-tool-fs') && leanBody.includes('dsh-tool-todo')],
    ...removedPackages.map((name): readonly [string, boolean] => [
      `${prefix}lean lacks ${name}, full keeps it`,
      !new RegExp(`${name}['"]?\\s*$`, 'mu').test(leanBody) && new RegExp(`${name}['"]?\\s*$`, 'mu').test(fullBody),
    ]),
  ]
}
/** Whether the text after a `dsh-compaction-basic` row carries the qwen3-8b-32k policy with the given headroom. */
function hasPolicy(section: string, headroomTokens: number): boolean {
  const basicAt = section.indexOf('dsh-compaction-basic')
  const found = /model:\s*['"]?qwen3-8b-32k['"]?\s*\n\s*headroomTokens:\s*(\d+)/u.exec(basicAt < 0 ? '' : section.slice(basicAt))
  return found?.[1] === String(headroomTokens)
}
const checks: readonly (readonly [string, boolean])[] = [
  ['one preset-air row', count(/id:\s*['"]?preset-air(?![-\w])/gu) === 1],
  ['skill conventions mounted in both presets', count(/@air\/dsh-skill-conventions/gu) === 2],
  ['instruction conventions mounted in both presets', count(/@air\/dsh-instruction-conventions/gu) === 2],
  ['mcp conventions mounted once', count(/@air\/dsh-mcp-conventions/gu) === 1],
  ['command conventions mounted once', count(/@air\/dsh-command-conventions/gu) === 1],
  ['preset by model mounted once, with the lean and full preset ids', count(/@air\/dsh-preset-by-model/gu) === 1
    && /smallPreset:\s*['"]?air-lean\b/u.test(text) && /largePreset:\s*['"]?air['"]?\s*$/mu.test(text)],
  ['one preset-air-lean row', count(/id:\s*['"]?preset-air-lean\b/gu) === 1],
  ['registry default is air-lean', registryAt >= 0 && /default:\s*['"]?air-lean\b/u.test(text.slice(registryAt, registryAt + 400))],
  ['skill-filesystem default roots off in both presets', count(/includeDefaultRoots:\s*false/gu) === 2],
  ['clock reading and reminder tools kept', presetText.includes('dsh-time-context') && presetText.includes('dsh-tool-schedule')],
  ['full preset has the qwen3-8b-32k compaction policy (headroom 6672)', hasPolicy(presetText, 6672)],
  ['lean preset has its own qwen3-8b-32k compaction policy (headroom 8672)', hasPolicy(leanText, 8672)],
  ...presetChecks('', leanText, presetText),
]
let failed = false
for (const [label, passed] of checks) {
  console.log(`${passed ? 'ok' : 'FAILED'}: ${label}`)
  if (!passed) failed = true
}
if (failed) fail('see FAILED lines above; if the dump quotes names differently, adjust the patterns and keep the same checks')

// The desktop profile layers the desktop variant after the AIR bundle; the account rows it needs must be back, the rest stay off.
const desktopProfile = 'air-desktop-check'
dsh(['--profile', desktopProfile, '--from-default-profile', 'web', '--dump-config'])
dsh(['plugin', '--profile', desktopProfile, 'add', join(repoRoot, 'air', 'bundles', 'air')])
dsh(['plugin', '--profile', desktopProfile, 'add', join(repoRoot, 'air', 'bundles', 'air-desktop')])
const desktopDump = dsh(['--profile', desktopProfile, '--dump-config'])
if (LAUNCHER_PROBLEM.test(desktopDump.stderr)) fail('problems while composing the desktop variant:', desktopDump.stderr)
/** Read the `disabled` flag the dump prints for a top-level row; undefined when the row has none. */
function rowDisabled(id: string): boolean | undefined {
  const found = new RegExp(`^- id:\\s*['"]?${id}['"]?\\n(?:  [^\\n]*\\n)*?  disabled:\\s*(true|false)`, 'mu').exec(desktopDump.stdout)
  return found === null ? undefined : found[1] === 'true'
}
const presetRows = desktopDump.stdout.match(/id:\s*['"]?preset-air(?![-\w])/gu)?.length ?? 0
const desktopFullAt = desktopDump.stdout.search(/id:\s*['"]?preset-air(?![-\w])/u)
const desktopFull = desktopFullAt < 0 ? '' : desktopDump.stdout.slice(desktopFullAt, desktopFullAt + 20_000)
const desktopLeanAt = desktopDump.stdout.search(/id:\s*['"]?preset-air-lean\b/u)
const desktopLean = desktopLeanAt < 0 ? '' : desktopDump.stdout.slice(desktopLeanAt, desktopLeanAt + 20_000)
const desktopChecks: readonly (readonly [string, boolean])[] = [
  ['desktop: deepseek-account enabled', rowDisabled('deepseek-account') === false],
  ['desktop: account-controller enabled', rowDisabled('account-controller') === false],
  ['desktop: llm-deepseek-account disabled', rowDisabled('llm-deepseek-account') === true],
  ['desktop: ui-settings-account disabled', rowDisabled('ui-settings-account') === true],
  ['desktop: preset-air present once', presetRows === 1],
  ['desktop: preset-air-lean present once', desktopDump.stdout.match(/id:\s*['"]?preset-air-lean\b/gu)?.length === 1],
  ['desktop: registry default is air-lean', /default:\s*['"]?air-lean\b/u.test(desktopDump.stdout)],
  ['desktop: full preset has the qwen3-8b-32k compaction policy', hasPolicy(desktopFull, 6672)],
  ['desktop: lean preset has its own qwen3-8b-32k compaction policy', hasPolicy(desktopLean, 8672)],
  ...presetChecks('desktop: ', desktopLean, desktopFull),
]
for (const [label, passed] of desktopChecks) {
  console.log(`${passed ? 'ok' : 'FAILED'}: ${label}`)
  if (!passed) failed = true
}
if (failed) fail('see FAILED lines above')

// The headless profile starts from upstream's headless template and lists the headless bundle INSTEAD of the AIR bundle.
const headlessProfile = 'air-headless-check'
dsh(['--profile', headlessProfile, '--from-default-profile', 'headless', '--dump-config'])
dsh(['plugin', '--profile', headlessProfile, 'add', join(repoRoot, 'air', 'bundles', 'air-headless')])
copyFileSync(
  join(repoRoot, 'air', 'examples', 'ollama.profile.cordis.patch.yml'),
  join(home, 'profiles', headlessProfile, 'cordis.patch.yml'),
)
const headlessDump = dsh(['--profile', headlessProfile, '--dump-config'])
if (LAUNCHER_PROBLEM.test(headlessDump.stderr)) fail('problems while composing the headless profile:', headlessDump.stderr)
/** Text of the top-level row with this id in the headless dump, or undefined when the dump has no such row. */
function headlessRow(id: string): string | undefined {
  const found = new RegExp(`^- id:\\s*['"]?${id}['"]?\\n(?:(?!- id:|# ==)[^\\n]*\\n?)*`, 'mu').exec(headlessDump.stdout)
  return found?.[0]
}
/** Whether the headless dump has the row and it is not disabled. */
function headlessEnabled(id: string): boolean {
  const row = headlessRow(id)
  return row !== undefined && !/^ {2}disabled:\s*true/mu.test(row)
}
/** Whether the headless dump has the row and it is disabled. */
function headlessDisabled(id: string): boolean {
  const row = headlessRow(id)
  return row !== undefined && /^ {2}disabled:\s*true/mu.test(row)
}
const headlessChecks: readonly (readonly [string, boolean])[] = [
  ['headless: AIR bundle layer present', headlessDump.stdout.includes('patched by @air/dsh-air-headless-bundle')],
  ['headless: no preset or preset registry row', !/id:\s*['"]?(preset-air|agent-preset-registry)/u.test(headlessDump.stdout)],
  ['headless: the headless runner is enabled', headlessEnabled('headless-runner')],
  ...['air-instruction-conventions', 'air-skill-conventions', 'air-command-conventions', 'air-mcp-conventions', 'air-mcp-trust']
    .map((id): readonly [string, boolean] => [`headless: ${id} present and enabled`, headlessEnabled(id)]),
  ...['session-log-deepseek', 'plugin-package-inventory-deepseek', 'session-telemetry-otel', 'deepseek-account',
    'llm-deepseek-account', 'web-search-deepseek', 'command-goal', 'tool-goal', 'tool-subagent-control',
    'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'workflow-ptc', 'tool-workflow']
    .map((id): readonly [string, boolean] => [`headless: ${id} present and disabled`, headlessDisabled(id)]),
  ...['tool-fs', 'tool-fs-search', 'tool-todo', 'tool-skill', 'compaction-basic', 'commands', 'approval', 'working-directory']
    .map((id): readonly [string, boolean] => [`headless: ${id} kept enabled`, headlessEnabled(id)]),
  ['headless: default model is ollama qwen3-8b-32k', /provider:\s*ollama\s*\n\s*model:\s*['"]?qwen3-8b-32k/u.test(headlessRow('agent-default-model') ?? '')],
  ['headless: user skill roots off', /includeDefaultRoots:\s*false/u.test(headlessRow('skill-filesystem') ?? '')],
  ['headless: lean qwen3-8b-32k compaction policy (headroom 8672)', hasPolicy(headlessRow('compaction-basic') ?? '', 8672)],
]
for (const [label, passed] of headlessChecks) {
  console.log(`${passed ? 'ok' : 'FAILED'}: ${label}`)
  if (!passed) failed = true
}
if (failed) fail('see FAILED lines above')
console.log(`composition: ok (${home})`)
