/**
 * Export and import of the memory files as one JSON archive. The archive is plain text: it holds
 * every note (including forgotten ones), so keep it as private as the memory directory itself.
 * @module @air/dsh-memory-store/transfer
 */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { memoryPath, scanMemoryFiles } from './files.ts'
import { parseMemoryFile, renderMemoryFile } from './frontmatter.ts'
import { trustOf } from './types.ts'

const FILE_MODES = { mode: 0o600, dirMode: 0o700 } as const

const archiveSchema = z.strictObject({
  format: z.literal('air-memory-export'),
  version: z.literal(1),
  exportedAt: z.string(),
  memories: z.array(z.strictObject({ path: z.string(), text: z.string() })),
})

/** Result of {@link exportMemories}. */
export interface ExportReport {
  /** Memory files written to the archive, forgotten and superseded ones included. */
  files: number
}

/** Options of {@link importMemories}. */
export interface ImportOptions {
  /** Keep `user-stated` and `user-confirmed` sources. Off by default: imported notes become `agent-inferred`. */
  keepTrust?: boolean
  /** Milliseconds to wait for the write lock of another writer. */
  lockWaitMs: number
}

/** Result of {@link importMemories}. */
export interface ImportReport {
  /** Files created. */
  imported: number
  /** Archive entries whose id already exists in the store; they are left untouched. */
  skippedExisting: number
  /** Archive entries that failed validation, as `<path>: <reason>`. */
  invalid: string[]
}

/**
 * Write every memory file under `root` into one archive.
 * @param root - memory root directory.
 * @param destination - archive file path; replaced atomically.
 * @param now - time stored as `exportedAt`.
 * @returns the number of files exported.
 */
export async function exportMemories(root: string, destination: string, now: Date = new Date()): Promise<ExportReport> {
  const records = await scanMemoryFiles(root, new Map())
  const archive = {
    format: 'air-memory-export',
    version: 1,
    exportedAt: now.toISOString(),
    memories: records.map(record => ({ path: record.path, text: renderMemoryFile(record.frontmatter, record.body) })),
  }
  await writeFileAtomic(destination, `${JSON.stringify(archive, undefined, 2)}\n`, FILE_MODES)
  return { files: records.length }
}

/**
 * Add the memories of an archive that the store does not have yet. Paths come from each file's
 * validated frontmatter, never from the archive entry, and existing ids are never overwritten.
 * @param root - memory root directory; created when missing.
 * @param source - archive file written by {@link exportMemories}.
 * @param options - trust handling and lock wait.
 * @returns counts of imported, skipped, and invalid entries.
 * @throws Error when the file is not an AIR memory export.
 */
export async function importMemories(root: string, source: string, options: ImportOptions): Promise<ImportReport> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await readFile(source, 'utf8'))
  } catch (error: unknown) {
    throw new Error(`${source} is not an AIR memory export: ${String(error)}`, { cause: error })
  }
  const archive = archiveSchema.safeParse(parsedJson)
  if (!archive.success) throw new Error(`${source} is not an AIR memory export: ${archive.error.message}`)
  await mkdir(join(root, '.air'), { recursive: true, mode: 0o700 })
  return withFileLock(join(root, '.air', 'write'), async () => {
    const existing = new Set((await scanMemoryFiles(root, new Map())).map(record => record.frontmatter.id))
    const report: ImportReport = { imported: 0, skippedExisting: 0, invalid: [] }
    for (const entry of archive.data.memories) {
      let parsed: ReturnType<typeof parseMemoryFile>
      try {
        parsed = parseMemoryFile(entry.text)
      } catch (error: unknown) {
        report.invalid.push(`${entry.path}: ${String(error)}`)
        continue
      }
      const { frontmatter, body } = parsed
      const path = memoryPath(frontmatter.scope, frontmatter.type, frontmatter.id)
      if (path !== entry.path) {
        report.invalid.push(`${entry.path}: path does not match the file's scope, type, and id`)
      } else if (existing.has(frontmatter.id)) {
        report.skippedExisting += 1
      } else {
        const downgrade = options.keepTrust !== true && trustOf(frontmatter.source.kind) === 'high'
        const stored = downgrade ? { ...frontmatter, source: { kind: 'agent-inferred' } } : frontmatter
        await writeFileAtomic(join(root, path), renderMemoryFile(stored, body), FILE_MODES)
        existing.add(frontmatter.id)
        report.imported += 1
      }
    }
    return report
  }, { waitMs: options.lockWaitMs })
}
