/**
 * Compose the AIR headless bundle on upstream's headless template and boot one task under an isolated DSH_HOME
 * (Windows and Linux). The model route points at a closed local port, so no model is called: the run reaches its first
 * model request, fails with a transport error, and by then every row has either activated or been reported by the launcher.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LAUNCHER_PROBLEM } from './launcher-problems.ts'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const home = process.env.DSH_HOME ?? mkdtempSync(join(tmpdir(), 'air-headless-smoke-'))
const timeoutMs = Number(process.env.AIR_SMOKE_SECONDS ?? '120') * 1000
const profile = 'air-headless-smoke'
const env = { ...process.env, DSH_HOME: home }
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]

function fail(message: string, detail = ''): never {
  console.error(`smoke-headless: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

/** Ask the OS for a free TCP port; the listener is closed before the port is returned, so nothing answers on it. */
function closedPort(): Promise<string> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const chosen = typeof address === 'object' && address !== null ? String(address.port) : ''
      server.close(() => { resolvePort(chosen) })
    })
  })
}

function dsh(args: readonly string[]): { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) fail(`dsh ${args.join(' ')} exited ${String(result.status)}`, result.stderr)
  return { stdout: result.stdout, stderr: result.stderr }
}

dsh(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
dsh(['plugin', '--profile', profile, 'add', join(repoRoot, 'air', 'bundles', 'air-headless')])
const route = readFileSync(join(repoRoot, 'air', 'examples', 'ollama.profile.cordis.patch.yml'), 'utf8')
if (!route.includes('127.0.0.1:11434')) fail('the Ollama example no longer names 127.0.0.1:11434; update this smoke')
writeFileSync(join(home, 'profiles', profile, 'cordis.patch.yml'), route.replaceAll('127.0.0.1:11434', `127.0.0.1:${await closedPort()}`))
writeFileSync(join(home, '.env'), 'OLLAMA_API_KEY=ollama\n')

const dump = dsh(['--profile', profile, '--dump-config'])
if (LAUNCHER_PROBLEM.test(dump.stderr)) fail('composition problems:', dump.stderr)
if (!dump.stdout.includes('patched by @air/dsh-air-headless-bundle')) fail('headless bundle layer missing from the composed tree')

const child = spawn(process.execPath, [...launcher, '--profile', profile, 'smoke check, no model is reachable'], { cwd: repoRoot, env })
let err = ''
let finished = false
child.stdout.on('data', () => undefined)
child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString() })

function finish(): void {
  if (finished) return
  finished = true
  clearInterval(timer)
  child.kill()
  if (LAUNCHER_PROBLEM.test(err)) fail('rows failed or stayed pending:', err)
  if (!err.includes('TRANSPORT')) fail('the run ended before it reached its first model request:', err)
  console.log(`smoke-headless: ok (${home})`)
  process.exit(0)
}

const started = Date.now()
const timer = setInterval(() => {
  // A transport error is the first model request failing: every row has been activated or reported by now.
  if (LAUNCHER_PROBLEM.test(err) || err.includes('TRANSPORT') || child.exitCode !== null) finish()
  else if (Date.now() - started > timeoutMs) fail(`no model request within ${String(timeoutMs / 1000)} s`, err)
}, 250)
