/** Compose and boot the AIR bundle in a throwaway profile under an isolated DSH_HOME (Windows and Linux). */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const home = process.env.DSH_HOME ?? mkdtempSync(join(tmpdir(), 'air-smoke-'))
const port = process.env.AIR_SMOKE_PORT ?? '3187'
const timeoutMs = Number(process.env.AIR_SMOKE_SECONDS ?? '90') * 1000
const profile = 'air-smoke'
const env = { ...process.env, DSH_HOME: home }
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]
const PROBLEM = /unmatched|incompatible|failed|disabling profile plugin row|did not activate|pending/i

function fail(message: string, detail = ''): never {
  console.error(`smoke: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

function dsh(args: readonly string[]): { stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], { cwd: repoRoot, env, encoding: 'utf8' })
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
if (PROBLEM.test(dump.stderr)) fail('composition problems:', dump.stderr)
if (!dump.stdout.includes('patched by @air/dsh-air-bundle')) fail('AIR bundle layer missing from the composed tree')

const child = spawn(process.execPath, [...launcher, '--profile', profile, '--no-open', '--port', port], { cwd: repoRoot, env })
let out = ''
let err = ''
child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString() })
const ready = `dsh web: http://127.0.0.1:${port}/`
const started = Date.now()
const timer = setInterval(() => {
  if (out.includes(ready)) {
    clearInterval(timer)
    child.kill()
    if (PROBLEM.test(err)) fail('boot problems:', err)
    console.log(`smoke: ok (${home})`)
    process.exit(0)
  }
  if (child.exitCode !== null) {
    clearInterval(timer)
    fail(`boot exited early with code ${String(child.exitCode)}`, err)
  }
  if (Date.now() - started > timeoutMs) {
    clearInterval(timer)
    child.kill()
    fail(`no ready line within ${String(timeoutMs / 1000)} s`, err)
  }
}, 250)
