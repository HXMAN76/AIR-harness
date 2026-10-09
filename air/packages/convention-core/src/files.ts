/** Host-filesystem reads and listings for convention files. Absence is a normal result, not an error. */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import nodePath, { join, resolve, type PlatformPath } from 'node:path'
import { isInside } from './paths.ts'
import { isSensitivePath } from './sensitive.ts'

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch (error: unknown) {
    if (isAbsent(error)) return undefined
    throw error
  }
}

/**
 * Read a UTF-8 text file.
 * @param path - absolute file path.
 * @returns the content, or undefined when the path is absent or not a regular file.
 */
export async function readTextFile(path: string): Promise<string | undefined> {
  const info = await statIfPresent(path)
  if (info === undefined || !info.isFile()) return undefined
  return await readFile(path, 'utf8')
}

/**
 * Read the size of a regular file without reading its content.
 * @param path - absolute file path.
 * @returns the size in bytes, or undefined when the path is absent or not a regular file.
 */
export async function fileSize(path: string): Promise<number | undefined> {
  const info = await statIfPresent(path)
  return info?.isFile() === true ? info.size : undefined
}

/**
 * Resolve symbolic links (and, on Windows, drive and letter case) of an existing path.
 * @param path - absolute path.
 * @returns the canonical path, or undefined when the path is absent.
 */
export async function realpathIfPresent(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch (error: unknown) {
    if (isAbsent(error)) return undefined
    throw error
  }
}

/**
 * Identify a regular file's content version without reading it.
 * @param path - absolute file path.
 * @returns a text that changes when the file is replaced or rewritten, or undefined when the path is absent or not a regular file.
 */
export async function fileSignature(path: string): Promise<string | undefined> {
  const info = await statIfPresent(path)
  return info?.isFile() === true ? `${info.dev}:${info.ino}:${info.mtimeMs}:${info.size}` : undefined
}

/** Why a path was not read or listed. */
export type ContainmentReason = 'not-file' | 'outside-root' | 'sensitive' | 'too-large'

/** Limits for {@link readContained}. */
export interface ContainedReadOptions {
  /** Directories the real path of the file must be inside; the real path of each root is used. */
  readonly roots: readonly string[]
  /** Largest file in bytes; a larger file is rejected without being read. */
  readonly maxBytes: number
  /** Path module; pass `path.win32` to apply Windows containment rules on any host. */
  readonly pathApi?: PlatformPath
}

/** Result of {@link readContained}. */
export type ContainedRead =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: ContainmentReason }

async function realRootsOf(roots: readonly string[]): Promise<string[]> {
  return await Promise.all(roots.map(async root => (await realpathIfPresent(root)) ?? resolve(root)))
}

/**
 * Read a UTF-8 file only when its real path (symbolic links resolved) is inside an allowed root. A link
 * that stays inside a root is followed; a link to a credential file or to a path outside every root is
 * refused. The content is read from the resolved real path.
 * @param path - absolute file path.
 * @param options - allowed roots and the size limit.
 * @returns `ok` with the text; `absent` when nothing is there; otherwise the reason the file was refused.
 */
export async function readContained(path: string, options: ContainedReadOptions): Promise<ContainedRead> {
  const real = await realpathIfPresent(path)
  if (real === undefined) return { kind: 'absent' }
  const roots = await realRootsOf(options.roots)
  if (!roots.some(root => isInside(root, real, options.pathApi))) return { kind: 'outside-root' }
  if (isSensitivePath(path) || isSensitivePath(real)) return { kind: 'sensitive' }
  const info = await statIfPresent(real)
  if (info?.isFile() !== true) return { kind: 'not-file' }
  if (info.size > options.maxBytes) return { kind: 'too-large' }
  return { kind: 'ok', text: await readFile(real, 'utf8') }
}

/** Limits for {@link listDirectory} and {@link listMarkdownTree}. */
export interface WalkOptions {
  /** Directories an entry's real path must be inside. */
  readonly roots: readonly string[]
  /** Most directory entries examined in one walk; the walk stops and reports `truncated` beyond it. */
  readonly maxEntries: number
  /** Path module; pass `path.win32` to apply Windows containment rules on any host. */
  readonly pathApi?: PlatformPath
}

/** An entry or directory skipped because its real path leaves the allowed roots. */
export interface SkippedEntry {
  readonly path: string
  readonly reason: 'outside-root'
}

/** One entry of a listed directory, with symbolic links resolved to their target kind. */
export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/** Result of {@link listDirectory}. */
export interface DirectoryListing {
  readonly entries: DirectoryEntry[]
  readonly skipped: SkippedEntry[]
  /** True when the entry cap stopped the listing early. */
  readonly truncated: boolean
}

interface Walk {
  readonly realRoots: readonly string[]
  readonly pathApi: PlatformPath
  readonly skipped: SkippedEntry[]
  /** Real paths of directories already listed in this walk; a symbolic-link loop ends here. */
  readonly visited: Set<string>
  remaining: number
  truncated: boolean
}

async function startWalk(options: WalkOptions): Promise<Walk> {
  return {
    realRoots: await realRootsOf(options.roots),
    pathApi: options.pathApi ?? nodePath,
    skipped: [],
    visited: new Set(),
    remaining: options.maxEntries,
    truncated: false,
  }
}

async function listInto(root: string, walk: Walk): Promise<DirectoryEntry[]> {
  const real = await realpathIfPresent(root)
  if (real === undefined) return []
  if (!walk.realRoots.some(allowed => isInside(allowed, real, walk.pathApi))) {
    walk.skipped.push({ path: root, reason: 'outside-root' })
    return []
  }
  const rootInfo = await statIfPresent(real)
  if (rootInfo === undefined || !rootInfo.isDirectory() || walk.visited.has(real)) return []
  walk.visited.add(real)
  const entries: DirectoryEntry[] = []
  for (const name of (await readdir(root)).sort()) {
    if (walk.remaining <= 0) {
      walk.truncated = true
      break
    }
    walk.remaining -= 1
    const path = join(root, name)
    const target = await realpathIfPresent(path)
    if (target === undefined) continue
    if (!walk.realRoots.some(allowed => isInside(allowed, target, walk.pathApi))) {
      walk.skipped.push({ path, reason: 'outside-root' })
      continue
    }
    const info = await statIfPresent(target)
    /* v8 ignore next -- the target was resolved a moment ago; only a concurrent delete reaches this. */
    if (info === undefined) continue
    if (info.isDirectory()) entries.push({ name, path, kind: 'directory' })
    else if (info.isFile()) entries.push({ name, path, kind: 'file' })
  }
  return entries
}

/**
 * List the files and directories directly under `root`, skipping entries whose real path leaves the
 * allowed roots.
 * @param root - directory to list.
 * @param options - allowed roots and the entry cap.
 * @returns entries sorted by name (empty when `root` is absent, not a directory, or outside the roots),
 *   the entries skipped for leaving the roots, and whether the cap stopped the listing. Broken links and
 *   special files are omitted.
 */
export async function listDirectory(root: string, options: WalkOptions): Promise<DirectoryListing> {
  const walk = await startWalk(options)
  const entries = await listInto(root, walk)
  return { entries, skipped: walk.skipped, truncated: walk.truncated }
}

/** A Markdown file found under a root, with its relative path split into segments. */
export interface MarkdownEntry {
  readonly path: string
  /** Relative path segments; the last one has no `.md` suffix. */
  readonly segments: readonly string[]
}

/** Result of {@link listMarkdownTree}. */
export interface MarkdownTree {
  readonly entries: MarkdownEntry[]
  readonly skipped: SkippedEntry[]
  /** True when the entry cap stopped the walk early. */
  readonly truncated: boolean
}

/**
 * List `.md` files under `root`, descending at most `maxDepth` directory levels. A directory reached
 * through several symbolic links is entered once, and entries whose real path leaves the allowed roots
 * are skipped.
 * @param root - directory to walk.
 * @param maxDepth - number of directory levels including `root`; 1 lists only the root.
 * @param options - allowed roots and the entry cap for the whole walk.
 * @returns entries in directory order, each directory sorted by name; the skipped entries; and whether the cap stopped the walk.
 */
export async function listMarkdownTree(root: string, maxDepth: number, options: WalkOptions): Promise<MarkdownTree> {
  const walk = await startWalk(options)
  const found: MarkdownEntry[] = []
  const descend = async (directory: string, prefix: readonly string[]): Promise<void> => {
    for (const entry of await listInto(directory, walk)) {
      if (entry.kind === 'directory') {
        if (prefix.length + 1 < maxDepth) await descend(entry.path, [...prefix, entry.name])
      } else if (entry.name.endsWith('.md')) {
        found.push({ path: entry.path, segments: [...prefix, entry.name.slice(0, -3)] })
      }
    }
  }
  await descend(root, [])
  return { entries: found, skipped: walk.skipped, truncated: walk.truncated }
}

/**
 * Word a refused file for a log or problem list. The text names the path and the reason, never content.
 * @param path - the refused file or directory.
 * @param reason - why it was refused.
 * @param maxBytes - the size limit, named in the `too-large` text.
 * @returns one line, for example `/p/.claude/rules/x.md skipped: its real path is outside the project`.
 */
export function describeSkip(path: string, reason: ContainmentReason, maxBytes: number): string {
  switch (reason) {
    case 'outside-root': return `${path} skipped: its real path is outside the allowed directory`
    case 'sensitive': return `${path} skipped: it looks like a credential file`
    case 'too-large': return `${path} skipped: it is larger than ${maxBytes} bytes`
    case 'not-file': return `${path} skipped: it is not a regular file`
  }
}

/**
 * Word a walk that stopped at its entry cap.
 * @param root - directory that was walked.
 * @param maxEntries - the cap that was reached.
 * @returns one line naming the directory and the cap.
 */
export function describeTruncation(root: string, maxEntries: number): string {
  return `${root} listing stopped after ${maxEntries} entries; later entries were not read`
}
