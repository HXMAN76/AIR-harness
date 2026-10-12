/** Compose the air-mcp profile under an isolated DSH_HOME and check the exit codes of its commands (Windows and Linux). */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LAUNCHER_PROBLEM } from './launcher-problems.ts'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const home = process.env.DSH_HOME ?? realpathSync(mkdtempSync(join(tmpdir(), 'air-smoke-mcp-')))
const timeoutMs = Number(process.env.AIR_SMOKE_SECONDS ?? '120') * 1000
const profile = 'air-mcp'
const env = { ...process.env, DSH_HOME: home }
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]

function fail(message: string, detail = ''): never {
  console.error(`smoke-air-mcp: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

/** Run the launcher and return its exit code and text; a timeout reports status `null`. */
function dsh(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], {
    cwd: repoRoot, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Run one command of the profile and require its exit code and a clean boot. */
function expectExit(want: number, args: readonly string[]): { stdout: string; stderr: string } {
  const result = dsh(['--profile', profile, ...args])
  if (result.status !== want) fail(`'${args.join(' ')}' exited ${String(result.status)}, expected ${String(want)}`, result.stderr)
  if (LAUNCHER_PROBLEM.test(result.stderr)) fail(`'${args.join(' ')}' booted with problems:`, result.stderr)
  return result
}

const created = dsh(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
if (created.status !== 0) fail('profile creation failed', created.stderr)
for (const bundle of ['mcp-servers', 'air-mcp']) {
  const added = dsh(['plugin', '--profile', profile, 'add', join(repoRoot, 'air', 'bundles', bundle)])
  if (added.status !== 0) fail(`adding bundle ${bundle} failed`, added.stderr)
}

const dump = expectExit(0, ['--dump-config'])
if (!dump.stdout.includes('air-mcp-trust-cli')) fail('command-line row missing')
if (!dump.stdout.includes('@air/dsh-mcp-trust\n') && !/name:\s*['"]?@air\/dsh-mcp-trust['"]?\s/u.test(dump.stdout)) fail('trust row missing')

expectExit(0, ['list'])
if (!expectExit(0, ['verify', '--all']).stdout.includes('no MCP servers were observed')) fail('verify output missing')
if (!expectExit(2, ['diff', 'ghost']).stderr.includes('was not observed')) fail('diff diagnostic missing')
expectExit(2, ['pin', 'ghost', '--yes'])

if (existsSync(join(home, 'air', 'mcp-lock.json'))) fail('a read-only command wrote the lockfile')
console.log(`smoke-air-mcp: ok (${home})`)
