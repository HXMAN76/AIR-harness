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
const presetAt = text.search(/id:\s*['"]?preset-air\b/u)
const presetText = presetAt < 0 ? '' : text.slice(presetAt, presetAt + 20_000)
const registryAt = text.search(/id:\s*['"]?agent-preset-registry\b/u)
const checks: readonly (readonly [string, boolean])[] = [
  ['one preset-air row', count(/id:\s*['"]?preset-air\b/gu) === 1],
  ['skill conventions mounted once', count(/@air\/dsh-skill-conventions/gu) === 1],
  ['instruction conventions mounted once', count(/@air\/dsh-instruction-conventions/gu) === 1],
  ['mcp conventions mounted once', count(/@air\/dsh-mcp-conventions/gu) === 1],
  ['command conventions mounted once', count(/@air\/dsh-command-conventions/gu) === 1],
  ['registry default is air', registryAt >= 0 && /default:\s*['"]?air\b/u.test(text.slice(registryAt, registryAt + 400))],
  ['skill-filesystem default roots off', count(/includeDefaultRoots:\s*false/gu) === 1],
  ['clock reading and reminder tools kept', presetText.includes('dsh-time-context') && presetText.includes('dsh-tool-schedule')],
]
let failed = false
for (const [label, passed] of checks) {
  console.log(`${passed ? 'ok' : 'FAILED'}: ${label}`)
  if (!passed) failed = true
}
if (failed) fail('see FAILED lines above; if the dump quotes names differently, adjust the patterns and keep the same eight checks')
console.log(`composition: ok (${home})`)
