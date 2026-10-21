import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AIR_MEMORY_INDEX_APPLICATION_ID, AIR_MEMORY_INDEX_SCHEMA_VERSION, openIndexDatabase } from '../src/schema.ts'

const created: string[] = []
afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-memory-index-'))
  created.push(dir)
  return join(dir, 'cache', 'memory-index.sqlite')
}

function pragma(db: DatabaseSync, name: string): unknown {
  return Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0]
}

describe('openIndexDatabase', () => {
  it('creates an owner-only file with the AIR application id and schema version', async () => {
    const path = await tempPath()
    const db = await openIndexDatabase(path, 'wal')
    expect(pragma(db, 'application_id')).toBe(AIR_MEMORY_INDEX_APPLICATION_ID)
    expect(pragma(db, 'user_version')).toBe(AIR_MEMORY_INDEX_SCHEMA_VERSION)
    expect(pragma(db, 'journal_mode')).toBe('wal')
    db.prepare('INSERT INTO memories_fts (description, body) VALUES (?, ?)').run('d', 'b')
    db.close()
    // Windows has no POSIX modes; the owner-only mode is checked where it exists.
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    const reopened = await openIndexDatabase(path, 'wal')
    expect(reopened.prepare('SELECT count(*) AS n FROM memories_fts').get()).toEqual({ n: 1 })
    reopened.close()
  })

  it('holds no vector table', async () => {
    const db = await openIndexDatabase(':memory:', 'delete')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vectors'").all()
    expect(tables).toEqual([])
    db.close()
  })

  it('drops derived tables when the schema version differs', async () => {
    const path = await tempPath()
    const db = await openIndexDatabase(path, 'delete')
    db.prepare('INSERT INTO memories_fts (description, body) VALUES (?, ?)').run('d', 'b')
    db.exec('PRAGMA user_version = 99')
    db.close()
    const reopened = await openIndexDatabase(path, 'delete')
    expect(reopened.prepare('SELECT count(*) AS n FROM memories_fts').get()).toEqual({ n: 0 })
    expect(pragma(reopened, 'user_version')).toBe(AIR_MEMORY_INDEX_SCHEMA_VERSION)
    reopened.close()
  })

  it.each([
    ['another application id', 'PRAGMA application_id = 7'],
    ['unrecognized tables without an application id', 'CREATE TABLE notes (x TEXT)'],
  ])('refuses a database with %s', async (_label, sql) => {
    const path = await tempPath()
    ;(await openIndexDatabase(path, 'delete')).close()
    const foreign = new DatabaseSync(path)
    foreign.exec('DROP TABLE memories_fts; DROP TABLE memories; PRAGMA application_id = 0; PRAGMA user_version = 0')
    foreign.exec(sql)
    foreign.close()
    await expect(openIndexDatabase(path, 'delete')).rejects.toThrow('belongs to another application')
  })
})
