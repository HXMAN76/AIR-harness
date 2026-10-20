/**
 * Memory file layout and scanning. Every path segment comes from a closed pattern (lower-case
 * ASCII letters, digits, and underscores), so a path holds no character that Windows rejects, no
 * reserved device name, and no two paths that differ only in case.
 * @module @air/dsh-memory-store/files
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseMemoryFile } from './frontmatter.ts'
import { USER_SCOPE, type MemoryId, type MemoryRecord, type MemoryScopeId, type MemoryType } from './types.ts'

/**
 * Default memory root.
 * @returns `<DSH_HOME>/air/memory`.
 */
export function defaultMemoryRoot(): string {
  return dshHomePath('air', 'memory')
}

/** SHA-256 hex of a text. */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Path of one memory file relative to the memory root, with `/` separators.
 * @param scope - the memory's scope.
 * @param type - the memory's type.
 * @param id - the memory's id.
 * @returns `<type>/<id>.md` for the user scope, else `projects/<16 hex>/<type>/<id>.md`.
 */
export function memoryPath(scope: MemoryScopeId, type: MemoryType, id: MemoryId): string {
  const prefix = scope === USER_SCOPE ? '' : `projects/${scope.slice('project:'.length)}/`
  return `${prefix}${type}/${id}.md`
}

/** One parsed file, reused while its size and modification time are unchanged. */
export interface ScanCacheEntry {
  size: number
  mtimeMs: number
  /** The parsed file, or `undefined` when it failed validation (the failure was reported once). */
  record: MemoryRecord | undefined
  /** True once a duplicate-id report was made for this file. */
  duplicateReported?: boolean
}

/** Parsed files by relative path; a scan updates it in place. */
export type ScanCache = Map<string, ScanCacheEntry>

/** Walk directories in name order, yielding relative paths of `.md` files. Symlinks and dot entries are skipped. */
async function* markdownFiles(root: string, relative: string): AsyncGenerator<string> {
  const entries = await readdir(join(root, relative), { withFileTypes: true }).catch(() => [])
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      yield* markdownFiles(root, path)
    } else if (entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
      yield path
    }
  }
}

/**
 * Read every valid memory file under `root`. Files whose size and modification time match the
 * cache are not read again, so a scan of an unchanged store costs one directory listing and one
 * `stat` per file. A file that fails validation, is named differently from its id, or repeats an
 * id already seen is skipped and reported once through `warn`.
 * @param root - memory root directory; a missing root yields no records.
 * @param cache - parsed files by relative path, updated in place.
 * @param warn - receives one message per newly seen invalid file; omit to skip reporting.
 * @returns valid records in path order.
 */
export async function scanMemoryFiles(root: string, cache: ScanCache, warn?: (message: string) => void): Promise<MemoryRecord[]> {
  const seen = new Set<string>()
  const ids = new Set<string>()
  const records: MemoryRecord[] = []
  for await (const path of markdownFiles(root, '')) {
    /* v8 ignore start -- the file was removed after the directory listing */
    const info = await stat(join(root, path)).catch(() => undefined)
    if (info === undefined || !info.isFile()) continue
    /* v8 ignore stop */
    seen.add(path)
    let entry = cache.get(path)
    if (entry?.size !== info.size || entry.mtimeMs !== info.mtimeMs) {
      entry = { size: info.size, mtimeMs: info.mtimeMs, record: undefined }
      /* v8 ignore next -- the file may be removed after stat */
      const text = await readFile(join(root, path), 'utf8').catch(() => undefined)
      /* v8 ignore next -- same race */
      if (text !== undefined) {
        try {
          const parsed = parseMemoryFile(text)
          if (path.slice(path.lastIndexOf('/') + 1) !== `${parsed.frontmatter.id}.md`) throw new Error('file name does not match the id')
          entry.record = { ...parsed, path, hash: sha256(text) }
        } catch (error: unknown) {
          warn?.(`air-memory: skipping ${path}: ${String(error)}`)
        }
      }
      cache.set(path, entry)
    }
    const record = entry.record
    if (record === undefined) continue
    if (ids.has(record.frontmatter.id)) {
      if (entry.duplicateReported !== true) warn?.(`air-memory: skipping ${path}: another file already uses the id ${record.frontmatter.id}`)
      entry.duplicateReported = true
      continue
    }
    ids.add(record.frontmatter.id)
    records.push(record)
  }
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return records
}
