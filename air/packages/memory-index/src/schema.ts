/**
 * Derived index database: open, refuse foreign files, and reset on a schema version change.
 * Nothing here is migrated; the memory files rebuild every row.
 * @module @air/dsh-memory-index/schema
 */

import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** Stored in `PRAGMA user_version`; a different stored value drops and recreates the tables. */
export const AIR_MEMORY_INDEX_SCHEMA_VERSION = 1

/** Stored in `PRAGMA application_id` ('AIR1'); protects unrelated SQLite files. */
export const AIR_MEMORY_INDEX_APPLICATION_ID = 0x41495231

/** SQLite journal modes the index accepts. */
export type JournalMode = 'wal' | 'delete'

/**
 * Drop and recreate every index table, then stamp the application id and schema version.
 * @param db - open index database.
 */
export function resetIndexSchema(db: DatabaseSync): void {
  db.exec(`
    DROP TABLE IF EXISTS memories_fts;
    DROP TABLE IF EXISTS memories;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, scope TEXT NOT NULL, type TEXT NOT NULL,
      description TEXT NOT NULL, body TEXT NOT NULL, trust TEXT NOT NULL, importance INTEGER NOT NULL,
      updated TEXT NOT NULL, valid_to INTEGER, superseded_by TEXT, content_hash TEXT NOT NULL
    ) STRICT;
    -- The FTS rowid equals the rowid of the matching memories row.
    CREATE VIRTUAL TABLE memories_fts USING fts5(description, body, tokenize = 'unicode61');
    PRAGMA application_id = ${String(AIR_MEMORY_INDEX_APPLICATION_ID)};
    PRAGMA user_version = ${String(AIR_MEMORY_INDEX_SCHEMA_VERSION)};
  `)
}

/**
 * Open the index database, creating an owner-only file when missing.
 * @param path - database path or `:memory:`.
 * @param journalMode - validated journal mode.
 * @returns an open database with the current schema.
 * @throws Error when the file carries another application id, or has tables but no application id.
 */
export async function openIndexDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await (await open(actual, 'a', 0o600)).close()
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const { n: tables } = db.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'",
    ).get() as { n: number }
    const foreign = applicationId === 0 ? tables > 0 : applicationId !== AIR_MEMORY_INDEX_APPLICATION_ID
    if (foreign) throw new Error(`memory index database at "${actual}" belongs to another application`)
    if (version !== AIR_MEMORY_INDEX_SCHEMA_VERSION) resetIndexSchema(db)
    // journalMode is a validated closed union, not caller-controlled SQL.
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}
