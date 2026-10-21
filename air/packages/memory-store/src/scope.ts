/**
 * Project scope ids derived from a session working directory.
 * @module @air/dsh-memory-store/scope
 */

import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve, type PlatformPath } from 'node:path'
import { MemoryScopeId } from './types.ts'

/** File system and path-flavor hooks of {@link projectScopeId}; tests inject Windows rules on any host. */
export interface ScopeOptions {
  /** Path rules; defaults to the host's `node:path`. */
  pathApi?: Pick<PlatformPath, 'resolve' | 'dirname' | 'join'>
  /** Treat paths as case-insensitive: the root is folded to lower case before hashing. Defaults to true on Windows. */
  caseInsensitive?: boolean
  /** True when the path exists, as a file or a directory. */
  exists?: (path: string) => Promise<boolean>
  /** Canonical path with links and short (8.3) names resolved; a failure keeps the input. */
  canonical?: (path: string) => Promise<string>
}

/**
 * Text that is hashed for a project root: forward slashes, no trailing separator, and lower case
 * on case-insensitive platforms, so `C:\Users\Me\Proj\` and `c:/users/me/proj` give one scope.
 * @param root - absolute project root.
 * @param caseInsensitive - whether to fold case.
 * @returns the canonical text.
 */
export function canonicalRootText(root: string, caseInsensitive: boolean): string {
  const slashed = root.replaceAll('\\', '/')
  const trimmed = /^(?:[A-Za-z]:)?\/$/u.test(slashed) ? slashed : slashed.replace(/\/+$/u, '')
  return caseInsensitive ? trimmed.toLowerCase() : trimmed
}

/**
 * Scope id for the project that contains `cwd`: the nearest ancestor holding `.git` (a directory,
 * or the file that worktrees and submodules use), else `cwd` itself.
 * @param cwd - session working directory.
 * @param options - path rules and file system hooks; the defaults use the host.
 * @returns `project:<first 16 hex of SHA-256(canonical project root)>`.
 */
export async function projectScopeId(cwd: string, options: ScopeOptions = {}): Promise<MemoryScopeId> {
  const api = options.pathApi ?? { resolve, dirname, join }
  const caseInsensitive = options.caseInsensitive ?? process.platform === 'win32'
  const exists = options.exists ?? ((path: string) => stat(path).then(() => true, () => false))
  const canonical = options.canonical ?? ((path: string) => realpath(path).catch(() => path))
  const start = await canonical(api.resolve(cwd))
  let root = start
  for (let dir = start; ; dir = api.dirname(dir)) {
    if (await exists(api.join(dir, '.git'))) {
      root = dir
      break
    }
    if (api.dirname(dir) === dir) break
  }
  const digest = createHash('sha256').update(canonicalRootText(root, caseInsensitive)).digest('hex').slice(0, 16)
  return MemoryScopeId(`project:${digest}`)
}
