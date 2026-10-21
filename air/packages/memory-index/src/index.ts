/**
 * Derived keyword index over memory files (`ctx.airMemoryIndex`): SQLite FTS5 ranked by BM25.
 * The database is disposable; `sync()` rebuilds any row whose file content hash changed.
 * `search()` syncs when this process wrote since the last sync or `syncMinIntervalMs` has passed,
 * so files edited by hand are found within that interval.
 * @module @air/dsh-memory-index
 */

import type { DatabaseSync } from 'node:sqlite'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import { MemoryId, MemoryScopeId, type MemoryTrust, type MemoryType } from '@air/dsh-memory-store'
import { ftsMatchExpression, queryTerms } from './query.ts'
import { openIndexDatabase, resetIndexSchema, type JournalMode } from './schema.ts'

export { ftsMatchExpression, queryTerms } from './query.ts'
export {
  AIR_MEMORY_INDEX_APPLICATION_ID,
  AIR_MEMORY_INDEX_SCHEMA_VERSION,
  openIndexDatabase,
  resetIndexSchema,
} from './schema.ts'
export type { JournalMode } from './schema.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    airMemoryIndex: MemoryIndex
  }
}

/** Index configuration. Invalid values fail plugin load. */
export interface Config {
  /** Database path, or `:memory:`. Omit to use `<DSH_HOME>/cache/air/memory-index.sqlite`. */
  path?: string
  /** SQLite journal mode. */
  journalMode: JournalMode
  /** Characters of body text returned as a hit's snippet. */
  snippetChars: number
  /** Milliseconds during which a search skips the file check unless this process wrote a memory. 0 checks before every search. */
  syncMinIntervalMs: number
}

/** One search request. */
export interface MemorySearchOptions {
  /** Free text; only its letters and digits are used. */
  query: string
  /** Scopes the caller may read. A memory in any other scope is never returned. */
  scopes: readonly MemoryScopeId[]
  /** Maximum number of hits. */
  limit: number
  /** Restrict to these memory types; omitted or empty means all. */
  types?: readonly MemoryType[]
  /** Also return superseded and expired memories. */
  includeSuperseded?: boolean
}

/** One ranked memory. */
export interface MemorySearchHit {
  id: MemoryId
  type: MemoryType
  scope: MemoryScopeId
  description: string
  /** Leading body text with whitespace collapsed. */
  snippet: string
  /** `-bm25`; higher is better. */
  score: number
  /** SQLite BM25 value; lower is better. */
  bm25: number
  trust: MemoryTrust
  updated: string
  /** True when the memory is superseded or past `valid_to`. */
  superseded: boolean
}

/** Ranked hits. */
export interface MemorySearchResult {
  hits: MemorySearchHit[]
}

/** What one sync changed. */
export interface MemorySyncReport {
  /** Rows written because a file was new or its content hash changed. */
  indexed: number
  /** Rows deleted because their file is gone. */
  removed: number
}

interface HitRow {
  [column: string]: string | number | null
  id: string
  type: string
  scope: string
  description: string
  body: string
  trust: string
  updated: string
  valid_to: number | null
  superseded_by: string | null
  rank: number
}

/**
 * Resolve the index database path.
 * @param config - index configuration.
 * @returns the configured path, or `<DSH_HOME>/cache/air/memory-index.sqlite`.
 */
export function resolveIndexPath(config: Config): string {
  return config.path ?? dshCachePath('air', 'memory-index.sqlite')
}

/** Run `work` in one transaction; any throw rolls the whole change back. */
function inTransaction(db: DatabaseSync, work: () => void): void {
  db.exec('BEGIN')
  try {
    work()
    db.exec('COMMIT')
  } catch (error: unknown) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** SQLite-backed memory index, registered as `ctx.airMemoryIndex`. */
export class MemoryIndex extends Service {
  static Config: z<Config> = z.object({
    path: z.string().description('Database path or :memory:; omit to use <DSH_HOME>/cache/air/memory-index.sqlite.'),
    journalMode: z.union(['wal', 'delete']).default('wal').description('SQLite journal mode.'),
    snippetChars: z.natural().min(1).default(240).description('Characters of body text returned as a snippet.'),
    syncMinIntervalMs: z.natural().default(2_000).description('Milliseconds a search trusts the last file check; 0 checks every time.'),
  })

  static inject = ['airMemoryStore']

  private opened: Promise<DatabaseSync> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private syncedAt = Number.NEGATIVE_INFINITY
  private syncedGeneration = -1

  constructor(ctx: Context, private readonly options: Config) {
    super(ctx, 'airMemoryIndex')
    ctx.effect(() => async () => {
      const db = await this.opened?.catch(() => undefined)
      db?.close()
    }, 'airMemoryIndex.close')
  }

  /**
   * Reconcile the index with the memory files. Calls are serialized.
   * @param _signal - reserved for cancellation; a sync is one local transaction.
   * @returns counts of indexed and removed rows.
   */
  sync(_signal: AbortSignal): Promise<MemorySyncReport> {
    const run = this.queue.then(() => this.syncNow())
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Drop every row and rebuild from the files.
   * @param signal - passed to {@link sync}.
   * @returns the sync report of the rebuild.
   */
  async rebuild(signal: AbortSignal): Promise<MemorySyncReport> {
    resetIndexSchema(await this.database())
    return this.sync(signal)
  }

  /**
   * Search memories in the allowed scopes by keyword.
   * @param options - query, allowed scopes, limit, and optional type and supersession filters.
   * @param signal - passed to the sync that may run first.
   * @returns hits ordered by BM25 (ties by id).
   */
  async search(options: MemorySearchOptions, signal: AbortSignal): Promise<MemorySearchResult> {
    if (options.scopes.length === 0) return { hits: [] }
    if (this.ctx.airMemoryStore.generation !== this.syncedGeneration || Date.now() - this.syncedAt >= this.options.syncMinIntervalMs) {
      await this.sync(signal)
    }
    const terms = queryTerms(options.query)
    if (terms.length === 0) return { hits: [] }
    const db = await this.database()
    const now = Date.now()
    const clauses = [`m.scope IN (${options.scopes.map(() => '?').join(', ')})`]
    const params: Array<string | number> = [...options.scopes]
    if (options.types !== undefined && options.types.length > 0) {
      clauses.push(`m.type IN (${options.types.map(() => '?').join(', ')})`)
      params.push(...options.types)
    }
    if (options.includeSuperseded !== true) {
      clauses.push('m.superseded_by IS NULL AND (m.valid_to IS NULL OR m.valid_to > ?)')
      params.push(now)
    }
    const rows = db.prepare(
      `SELECT m.id AS id, m.type AS type, m.scope AS scope, m.description AS description, m.body AS body, m.trust AS trust,
         m.updated AS updated, m.valid_to AS valid_to, m.superseded_by AS superseded_by, bm25(memories_fts) AS rank
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? AND ${clauses.join(' AND ')} ORDER BY rank, m.id LIMIT ?`,
    ).all(ftsMatchExpression(terms), ...params, options.limit) as HitRow[]
    return {
      hits: rows.map((row): MemorySearchHit => ({
        id: MemoryId(row.id),
        type: row.type as MemoryType,
        scope: MemoryScopeId(row.scope),
        description: row.description,
        snippet: row.body.replace(/\s+/gu, ' ').slice(0, this.options.snippetChars),
        score: -row.rank,
        bm25: row.rank,
        trust: row.trust as MemoryTrust,
        updated: row.updated,
        superseded: row.superseded_by !== null || (row.valid_to !== null && row.valid_to <= now),
      })),
    }
  }

  private database(): Promise<DatabaseSync> {
    this.opened ??= openIndexDatabase(resolveIndexPath(this.options), this.options.journalMode)
    return this.opened
  }

  private async syncNow(): Promise<MemorySyncReport> {
    const db = await this.database()
    const generation = this.ctx.airMemoryStore.generation
    const records = await this.ctx.airMemoryStore.list({ includeSuperseded: true })
    const known = new Map(
      (db.prepare('SELECT id, content_hash FROM memories').all() as Array<{ id: string; content_hash: string }>)
        .map(row => [row.id, row.content_hash]),
    )
    const present = new Set<string>(records.map(record => record.frontmatter.id))
    const removed = [...known.keys()].filter(id => !present.has(id))
    const changed = records.filter(record => known.get(record.frontmatter.id) !== record.hash)
    // One transaction: a sync of thousands of rows is one disk commit, and an interrupted sync leaves the old rows.
    // FTS rows share the rowid of their `memories` row, so deleting one never scans the FTS table.
    const rowidOf = db.prepare('SELECT rowid AS rowid FROM memories WHERE id = ?')
    const deleteFts = db.prepare('DELETE FROM memories_fts WHERE rowid = ?')
    const deleteMemory = db.prepare('DELETE FROM memories WHERE rowid = ?')
    const insertFts = db.prepare('INSERT INTO memories_fts (rowid, description, body) VALUES (?, ?, ?)')
    const insertMemory = db.prepare(
      `INSERT INTO memories (id, path, scope, type, description, body, trust, importance, updated, valid_to, superseded_by, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const updateMemory = db.prepare(
      `UPDATE memories SET path = ?, scope = ?, type = ?, description = ?, body = ?, trust = ?, importance = ?, updated = ?,
       valid_to = ?, superseded_by = ?, content_hash = ? WHERE rowid = ?`,
    )
    inTransaction(db, () => {
      for (const id of removed) {
        const row = rowidOf.get(id) as { rowid: number }
        deleteFts.run(row.rowid)
        deleteMemory.run(row.rowid)
      }
      for (const { frontmatter, body, path, hash } of changed) {
        const validTo = frontmatter.valid_to === null ? null : Date.parse(frontmatter.valid_to)
        const existing = rowidOf.get(frontmatter.id) as { rowid: number } | undefined
        let rowid: number | bigint
        if (existing === undefined) {
          rowid = insertMemory.run(
            frontmatter.id, path, frontmatter.scope, frontmatter.type, frontmatter.description, body, frontmatter.trust,
            frontmatter.importance, frontmatter.updated, validTo, frontmatter.superseded_by, hash,
          ).lastInsertRowid
        } else {
          rowid = existing.rowid
          deleteFts.run(rowid)
          updateMemory.run(
            path, frontmatter.scope, frontmatter.type, frontmatter.description, body, frontmatter.trust, frontmatter.importance,
            frontmatter.updated, validTo, frontmatter.superseded_by, hash, rowid,
          )
        }
        insertFts.run(rowid, frontmatter.description, body)
      }
    })
    this.syncedAt = Date.now()
    this.syncedGeneration = generation
    return { indexed: changed.length, removed: removed.length }
  }
}

export default MemoryIndex
