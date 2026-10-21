/** Installs the packages the voice patches load into the voice home's `sdk` profile, where the runtime resolves them. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExecLike } from '@air/dsh-tool-open/exec'

/** A package a voice patch row loads. */
export interface VoicePlugin {
  /** Package name, as written in the patch rows. */
  name: string
  /** Package directory relative to the repository root. */
  dir: string
}

/** Every package named by `profile/*.cordis.patch.yml`. */
export const VOICE_PLUGINS: readonly VoicePlugin[] = [
  { name: '@air/dsh-tool-open', dir: 'air/packages/tool-open' },
  { name: '@air/dsh-memory-store', dir: 'air/packages/memory-store' },
  { name: '@air/dsh-memory-index', dir: 'air/packages/memory-index' },
  { name: '@air/dsh-tool-memory', dir: 'air/packages/tool-memory' },
  { name: '@air/dsh-memory-context', dir: 'air/packages/memory-context' },
  { name: '@deepseek-ai/dsh-browser-use', dir: 'packages/browser-use/browser-use' },
  { name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp', dir: 'packages/experimental/browser-use-playwright-mcp' },
]

/** Time allowed for one `plugin add` (it runs the package manager). */
const ADD_TIMEOUT_MS = 300_000

function installedNames(home: string): Set<string> {
  const file = join(home, 'profiles', 'sdk', 'package.json')
  if (!existsSync(file)) return new Set()
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string> }
  return new Set(Object.keys(manifest.dependencies ?? {}))
}

/**
 * Add each missing package to the `sdk` profile with `dsh plugin --profile sdk add <path>`.
 * @param options - voice home, repository root, and the process runner (no shell is involved).
 * @returns the names installed now and the names that were already there.
 * @throws when a `plugin add` fails; packages before it stay installed.
 */
export async function installVoicePlugins(options: {
  home: string
  repoRoot: string
  exec: ExecLike
  plugins?: readonly VoicePlugin[]
}): Promise<{ installed: string[]; skipped: string[] }> {
  const present = installedNames(options.home)
  const bin = join(options.repoRoot, 'apps', 'cli', 'lib', 'bin.js')
  const installed: string[] = []
  const skipped: string[] = []
  for (const plugin of options.plugins ?? VOICE_PLUGINS) {
    if (present.has(plugin.name)) {
      skipped.push(plugin.name)
      continue
    }
    const args = [bin, 'plugin', '--profile', 'sdk', 'add', join(options.repoRoot, plugin.dir)]
    await options.exec(process.execPath, args, { DSH_HOME: options.home }, ADD_TIMEOUT_MS)
    installed.push(plugin.name)
  }
  return { installed, skipped }
}
