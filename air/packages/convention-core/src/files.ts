/** Host-filesystem reads and listings for convention files. Absence is a normal result, not an error. */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

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

/** One entry of a listed directory, with symbolic links resolved to their target kind. */
export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/**
 * List the files and directories directly under `root`.
 * @param root - directory to list.
 * @returns entries sorted by name; empty when `root` is absent or not a directory. Broken links and special files are omitted.
 */
export async function listDirectory(root: string): Promise<DirectoryEntry[]> {
  const rootInfo = await statIfPresent(root)
  if (rootInfo === undefined || !rootInfo.isDirectory()) return []
  const entries: DirectoryEntry[] = []
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name)
    const info = await statIfPresent(path)
    if (info === undefined) continue
    if (info.isDirectory()) entries.push({ name, path, kind: 'directory' })
    else if (info.isFile()) entries.push({ name, path, kind: 'file' })
  }
  return entries
}

/** A Markdown file found under a root, with its relative path split into segments. */
export interface MarkdownEntry {
  readonly path: string
  /** Relative path segments; the last one has no `.md` suffix. */
  readonly segments: readonly string[]
}

/**
 * List `.md` files under `root`, descending at most `maxDepth` directory levels.
 * @param root - directory to walk.
 * @param maxDepth - number of directory levels including `root`; 1 lists only the root.
 * @returns entries in directory order, each directory sorted by name.
 */
export async function listMarkdownTree(root: string, maxDepth: number): Promise<MarkdownEntry[]> {
  const found: MarkdownEntry[] = []
  const walk = async (directory: string, prefix: readonly string[]): Promise<void> => {
    for (const entry of await listDirectory(directory)) {
      if (entry.kind === 'directory') {
        if (prefix.length + 1 < maxDepth) await walk(entry.path, [...prefix, entry.name])
      } else if (entry.name.endsWith('.md')) {
        found.push({ path: entry.path, segments: [...prefix, entry.name.slice(0, -3)] })
      }
    }
  }
  await walk(root, [])
  return found
}
