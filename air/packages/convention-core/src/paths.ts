/** Home directories, project-root lookup, and path containment for the AIR convention plugins. */
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import nodePath, { type PlatformPath } from 'node:path'

/** Environment variable that overrides the AIR home directory (default `~/.air`). */
export const AIR_HOME_ENV = 'AIR_HOME'

/** Environment variable upstream `skill-filesystem` reads for the shared agents home. */
export const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

/** Optional overrides for the user-level directories the convention plugins read. */
export interface UserHomeConfig {
  /** AIR-owned home. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Shared agents home. Defaults to `$DSH_AGENTS_HOME`, then `~/.agents`. */
  agentsHome?: string
}

/** Absolute user-level directories after defaulting. */
export interface UserHomes {
  readonly airHome: string
  readonly claudeHome: string
  readonly agentsHome: string
}

/**
 * Expand a leading `~`, `~/`, or (for Windows paths) `~\` against a home directory.
 * @param path - configured path.
 * @param home - home directory; defaults to the operating-system home.
 * @param pathApi - path module used to join; pass `path.win32` to apply Windows rules on any host.
 * @returns the expanded path, or the input when it has no supported prefix.
 */
export function expandHome(path: string, home: string = homedir(), pathApi: PlatformPath = nodePath): string {
  if (path === '~') return home
  if (path.startsWith('~/') || (pathApi.sep === '\\' && path.startsWith('~\\'))) return pathApi.join(home, path.slice(2))
  return path
}

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

/**
 * Resolve the user-level directories. Precedence: explicit configuration, environment, default.
 * @param config - explicit overrides.
 * @param env - environment mapping read for `AIR_HOME` and `DSH_AGENTS_HOME`.
 * @param home - operating-system home used for defaults and `~` expansion.
 * @returns absolute directories.
 */
export function resolveUserHomes(
  config: UserHomeConfig = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): UserHomes {
  const absolute = (path: string): string => nodePath.resolve(expandHome(path, home))
  return {
    airHome: absolute(config.airHome ?? nonBlank(env[AIR_HOME_ENV]) ?? nodePath.join(home, '.air')),
    claudeHome: absolute(config.claudeHome ?? nodePath.join(home, '.claude')),
    agentsHome: absolute(config.agentsHome ?? nonBlank(env[AGENTS_HOME_ENV]) ?? nodePath.join(home, '.agents')),
  }
}

/**
 * Test whether a host path exists.
 * @param path - path to probe.
 * @returns true when the path is reachable.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Any access failure means this caller cannot use the path.
    return false
  }
}

/**
 * Find the nearest ancestor of `cwd` that contains one of the markers. The walk ends at the file
 * system root (`/`, or a drive root such as `C:\`).
 * @param cwd - directory to start from.
 * @param markers - entry names that identify a project root.
 * @returns the project root, or the resolved `cwd` when no ancestor has a marker.
 */
export async function findProjectRoot(cwd: string, markers: readonly string[] = ['.git']): Promise<string> {
  const start = nodePath.resolve(cwd)
  let current = start
  while (true) {
    for (const marker of markers) {
      if (await pathExists(nodePath.join(current, marker))) return current
    }
    const parent = nodePath.dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/**
 * Test whether `candidate` is `root` or a path below it, after normalisation. Symbolic links are not
 * resolved; use `realpathIfPresent` first when a link could leave the root. Windows paths compare
 * without regard to case, and a path on another drive is outside.
 * @param root - containing directory.
 * @param candidate - path to test.
 * @param pathApi - path module; pass `path.win32` to apply Windows rules on any host.
 * @returns true when the candidate does not leave the root.
 */
export function isInside(root: string, candidate: string, pathApi: PlatformPath = nodePath): boolean {
  const rel = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel))
}

/**
 * List every directory from `root` down to `cwd`.
 * @param root - project root.
 * @param cwd - working directory.
 * @param pathApi - path module; pass `path.win32` to apply Windows rules on any host.
 * @returns directories ordered root first; only `cwd` when it lies outside `root`.
 */
export function directoriesBetween(root: string, cwd: string, pathApi: PlatformPath = nodePath): string[] {
  const top = pathApi.resolve(root)
  const bottom = pathApi.resolve(cwd)
  if (!isInside(top, bottom, pathApi)) return [bottom]
  const directories = [top]
  let current = top
  for (const segment of pathApi.relative(top, bottom).split(pathApi.sep).filter(part => part.length > 0)) {
    current = pathApi.join(current, segment)
    directories.push(current)
  }
  return directories
}

/**
 * Express `candidate` relative to `root` with forward slashes, the form glob matching expects.
 * @param root - containing directory.
 * @param candidate - path below the root.
 * @param pathApi - path module; pass `path.win32` to apply Windows rules on any host.
 * @returns the relative path, for example `src/a.ts`.
 */
export function toPosixRelative(root: string, candidate: string, pathApi: PlatformPath = nodePath): string {
  return pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate)).split(pathApi.sep).join('/')
}
