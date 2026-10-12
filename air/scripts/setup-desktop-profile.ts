/**
 * Make upstream's Desktop app profile (`desktop`) carry the AIR bundle and the AIR desktop variant bundle (Windows and Linux).
 *
 * Upstream's launcher refuses `plugin add` for the Desktop-managed profile, so this script does what that command does
 * to the profile directory: it adds two `link:` dependencies and two names to `dsh.profile.bundles` in `package.json`,
 * then runs the package manager in the profile directory. Running it twice changes nothing.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The two bundles, in layer order: the AIR desktop variant must come after the AIR bundle. */
export const BUNDLES = [
  { name: '@air/dsh-air-bundle', directory: 'air' },
  { name: '@air/dsh-air-desktop-bundle', directory: 'air-desktop' },
] as const

/** Bundles of upstream's `web` profile template, which the Desktop app composes on top of. */
export const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

/** Thrown when a profile file is not in a form this script understands; the message names the file and the problem. */
export class SetupRefusal extends Error {}

/** Result of a pure text transformation. */
export interface TextPlan {
  readonly text: string
  readonly changes: readonly string[]
}

const PATCH_TEMPLATE_BODY = /^(?:\s*(?:#[^\n]*)?\n)*\s*\[\s*\]\s*(?:#[^\n]*)?\s*$/u

/**
 * Resolve the harness home the way upstream's development launcher does.
 * @param env - Process environment; `DSH_HOME` wins.
 * @param repoRoot - Root of this checkout.
 * @returns Absolute harness home directory.
 */
export function resolveDesktopHome(env: NodeJS.ProcessEnv, repoRoot: string): string {
  const configured = env.DSH_HOME
  if (configured !== undefined && configured !== '') return resolve(configured)
  return join(repoRoot, 'apps', 'desktop', '.desktop-build', 'development', 'home')
}

/**
 * Build the backup path for a file that is about to change.
 * @param path - File to back up.
 * @param now - Time of the change.
 * @returns `<path>.bak-<UTC timestamp>` with a name that is valid on Windows.
 */
export function backupPath(path: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z')
  return `${path}.bak-${stamp}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Add the AIR dependencies and bundle names to a profile manifest, keeping every other field and entry.
 * @param text - Current `package.json` text of the profile.
 * @param bundleDirs - Absolute directory of each bundle named in {@link BUNDLES}, by package name.
 * @returns The new text (identical to the input when nothing is missing) and one line per change.
 * @throws SetupRefusal when the manifest is not valid JSON or lacks the expected fields.
 */
export function planManifest(text: string, bundleDirs: Readonly<Record<string, string>>): TextPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new SetupRefusal(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed)) throw new SetupRefusal('package.json is not a JSON object')
  const { dependencies, dsh } = parsed
  if (dependencies !== undefined && !isRecord(dependencies)) throw new SetupRefusal('package.json "dependencies" is not an object')
  if (!isRecord(dsh) || !isRecord(dsh.profile)) {
    throw new SetupRefusal('package.json has no "dsh.profile" object; this is not a dsh profile')
  }
  const bundles = dsh.profile.bundles
  if (!Array.isArray(bundles) || !bundles.every((entry): entry is string => typeof entry === 'string')) {
    throw new SetupRefusal('package.json "dsh.profile.bundles" is not an array of strings')
  }
  const changes: string[] = []
  const nextDependencies: Record<string, unknown> = dependencies ?? {}
  const nextBundles = [...bundles]
  for (const { name } of BUNDLES) {
    const directory = bundleDirs[name]
    if (directory === undefined) throw new SetupRefusal(`no directory given for ${name}`)
    const spec = `link:${directory}`
    if (nextDependencies[name] !== spec) {
      changes.push(nextDependencies[name] === undefined ? `add dependency ${name}` : `repoint dependency ${name}`)
      nextDependencies[name] = spec
    }
    if (!nextBundles.includes(name)) {
      nextBundles.push(name)
      changes.push(`add ${name} to dsh.profile.bundles`)
    }
  }
  const airAt = nextBundles.indexOf(BUNDLES[0].name)
  const desktopAt = nextBundles.indexOf(BUNDLES[1].name)
  if (desktopAt < airAt) throw new SetupRefusal(`${BUNDLES[1].name} is listed before ${BUNDLES[0].name}; reorder the list by hand`)
  if (changes.length === 0) return { text, changes }
  const next = { ...parsed, dependencies: nextDependencies, dsh: { ...dsh, profile: { ...dsh.profile, bundles: nextBundles } } }
  return { text: `${JSON.stringify(next, undefined, 2)}\n`, changes }
}

/**
 * Add `OLLAMA_API_KEY=ollama` to a dotenv file when the variable is not set in it.
 * @param text - Current `.env` text, or undefined when the file does not exist.
 * @returns The new text and a change line, or the unchanged text and no change.
 */
export function planEnv(text: string | undefined): TextPlan {
  const current = text ?? ''
  if (/^\s*(?:export\s+)?OLLAMA_API_KEY\s*=/mu.test(current)) return { text: current, changes: [] }
  const separator = current === '' || current.endsWith('\n') ? '' : '\n'
  return { text: `${current}${separator}OLLAMA_API_KEY=ollama\n`, changes: ['add OLLAMA_API_KEY=ollama'] }
}

/** What to do about the profile patch that carries the Ollama route. */
export type PatchAction = 'write' | 'present' | 'print'

/**
 * Decide how the Ollama route reaches the profile patch.
 * @param text - Current `cordis.patch.yml` text, or undefined when the file does not exist.
 * @returns `write` when no patch exists or it holds only the empty template, `present` when it already declares the route,
 * `print` when it has other content and the lines must be added by hand.
 */
export function planPatch(text: string | undefined): PatchAction {
  if (text === undefined || PATCH_TEMPLATE_BODY.test(text)) return 'write'
  return /id:\s*['"]?llm-pi-ai\b/u.test(text) && /^\s*ollama:/mu.test(text) ? 'present' : 'print'
}

interface Output {
  log(line: string): void
}

function back(path: string, now: Date, out: Output): void {
  if (!existsSync(path)) return
  const target = backupPath(path, now)
  copyFileSync(path, target)
  out.log(`  backup ${target}`)
}

function installBundles(profileDir: string, env: NodeJS.ProcessEnv): number {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.toLowerCase().startsWith('npm_')))
  const windows = process.platform === 'win32'
  const result = spawnSync(windows ? 'pnpm.cmd' : 'pnpm', ['install'], {
    cwd: profileDir, env: clean, stdio: 'inherit', shell: windows,
  })
  return result.status ?? 1
}

/**
 * Run the setup against one harness home.
 * @param home - Harness home directory (the Desktop app's `DSH_HOME`).
 * @param repoRoot - Root of this checkout.
 * @param out - Where progress lines go.
 * @param now - Time stamped into backup names.
 * @returns Process exit code: 0 on success or no change, 1 when a file was refused or the package manager failed.
 */
export function setupDesktopProfile(home: string, repoRoot: string, out: Output = console, now: Date = new Date()): number {
  const profileDir = join(home, 'profiles', 'desktop')
  const manifestPath = join(profileDir, 'package.json')
  const bundleDirs = Object.fromEntries(BUNDLES.map(({ name, directory }) => [name, join(repoRoot, 'air', 'bundles', directory)]))
  out.log(`desktop profile: ${profileDir}`)
  let changed = 0
  const created = !existsSync(manifestPath)
  if (created) {
    mkdirSync(profileDir, { recursive: true })
    const manifest = { name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [...BASE_BUNDLES] } } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    if (!existsSync(workspacePath)) writeFileSync(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    out.log('  created package.json and pnpm-workspace.yaml (the Desktop app had not created the profile yet)')
    changed++
  }
  let manifest: TextPlan
  try {
    manifest = planManifest(readFileSync(manifestPath, 'utf8'), bundleDirs)
  } catch (error) {
    if (!(error instanceof SetupRefusal)) throw error
    out.log(`refused: ${manifestPath}: ${error.message}`)
    return 1
  }
  if (manifest.changes.length > 0) {
    if (!created) back(manifestPath, now, out)
    writeFileSync(manifestPath, manifest.text)
    for (const line of manifest.changes) out.log(`  package.json: ${line}`)
    changed++
  }
  const linked = BUNDLES.every(({ name }) => existsSync(join(profileDir, 'node_modules', ...name.split('/'))))
  if (manifest.changes.length > 0 || !linked) {
    back(join(profileDir, 'pnpm-lock.yaml'), now, out)
    out.log('  pnpm install')
    if (installBundles(profileDir, process.env) !== 0) {
      out.log('refused: pnpm install failed; package.json keeps the change, rerun after fixing the error above')
      return 1
    }
    changed++
  }
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const example = join(repoRoot, 'air', 'examples', 'ollama.profile.cordis.patch.yml')
  const action = planPatch(existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : undefined)
  if (action === 'write') {
    back(patchPath, now, out)
    copyFileSync(example, patchPath)
    out.log('  cordis.patch.yml: wrote the Ollama route')
    changed++
  } else if (action === 'print') {
    out.log(`  cordis.patch.yml has other content and no Ollama route; add the entries from ${example} to ${patchPath}`)
  }
  const envPath = join(home, '.env')
  const env = planEnv(existsSync(envPath) ? readFileSync(envPath, 'utf8') : undefined)
  if (env.changes.length > 0) {
    mkdirSync(home, { recursive: true })
    back(envPath, now, out)
    writeFileSync(envPath, env.text)
    out.log(`  .env: ${env.changes.join(', ')}`)
    changed++
  }
  out.log(changed === 0 ? 'nothing changed' : 'done')
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const repoRoot = resolve(import.meta.dirname, '..', '..')
  process.exitCode = setupDesktopProfile(resolveDesktopHome(process.env, repoRoot), repoRoot)
}
