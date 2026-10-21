import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanMemoryFiles } from '../src/files.ts'
import { renderMemoryFile } from '../src/frontmatter.ts'
import { exportMemories, importMemories } from '../src/transfer.ts'
import { MemoryId, USER_SCOPE, type MemoryFrontmatter } from '../src/types.ts'
import { mkdir } from 'node:fs/promises'

const created: string[] = []
afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-memory-transfer-'))
  created.push(dir)
  return dir
}

function frontmatter(id: string, kind = 'user-confirmed'): MemoryFrontmatter {
  return {
    id: MemoryId(id),
    type: 'user',
    scope: USER_SCOPE,
    description: `Note ${id}`,
    created: '2026-09-29T10:00:00.000Z',
    updated: '2026-09-29T10:00:00.000Z',
    valid_from: '2026-09-29T10:00:00.000Z',
    valid_to: null,
    supersedes: null,
    superseded_by: null,
    importance: 3,
    source: { kind },
    trust: kind === 'user-confirmed' ? 'high' : 'untrusted',
    last_recalled: null,
  }
}

async function seed(root: string, id: string, kind?: string): Promise<void> {
  await mkdir(join(root, 'user'), { recursive: true })
  await writeFile(join(root, 'user', `${id}.md`), renderMemoryFile(frontmatter(id, kind), `body of ${id}`))
}

const lockWaitMs = 1_000

describe('exportMemories and importMemories', () => {
  it('round-trips every note into an empty store, lowering trust unless asked to keep it', async () => {
    const from = await tempDir()
    const archive = join(await tempDir(), 'out', 'memories.json')
    await seed(from, 'mem_aaaaaaaa')
    await seed(from, 'mem_bbbbbbbb', 'tool-derived:web')
    expect(await exportMemories(from, archive, new Date('2026-10-08T00:00:00.000Z'))).toEqual({ files: 2 })
    expect(JSON.parse(await readFile(archive, 'utf8'))).toMatchObject({ format: 'air-memory-export', version: 1, exportedAt: '2026-10-08T00:00:00.000Z' })

    const lowered = await tempDir()
    expect(await importMemories(lowered, archive, { lockWaitMs })).toEqual({ imported: 2, skippedExisting: 0, invalid: [] })
    const records = await scanMemoryFiles(lowered, new Map())
    expect(records.map(record => [record.frontmatter.id, record.frontmatter.trust])).toEqual([['mem_aaaaaaaa', 'low'], ['mem_bbbbbbbb', 'untrusted']])

    const kept = await tempDir()
    await importMemories(kept, archive, { lockWaitMs, keepTrust: true })
    expect((await scanMemoryFiles(kept, new Map()))[0]?.frontmatter.trust).toBe('high')
  })

  it('never overwrites an existing id and imports again as a no-op', async () => {
    const from = await tempDir()
    const archive = join(await tempDir(), 'memories.json')
    await seed(from, 'mem_aaaaaaaa')
    await exportMemories(from, archive)
    expect(await importMemories(from, archive, { lockWaitMs })).toEqual({ imported: 0, skippedExisting: 1, invalid: [] })
    const target = await tempDir()
    await importMemories(target, archive, { lockWaitMs })
    expect(await importMemories(target, archive, { lockWaitMs })).toMatchObject({ imported: 0, skippedExisting: 1 })
  })

  it('reports invalid entries and entries whose path does not match, writing nothing for them', async () => {
    const target = await tempDir()
    const archive = join(await tempDir(), 'memories.json')
    const good = renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'ok')
    await writeFile(archive, JSON.stringify({
      format: 'air-memory-export',
      version: 1,
      exportedAt: 'x',
      memories: [
        { path: 'user/mem_aaaaaaaa.md', text: good },
        { path: '../../escape.md', text: renderMemoryFile(frontmatter('mem_bbbbbbbb'), 'escape') },
        { path: 'user/mem_cccccccc.md', text: 'no frontmatter' },
      ],
    }))
    const report = await importMemories(target, archive, { lockWaitMs })
    expect(report.imported).toBe(1)
    expect(report.invalid).toEqual([
      "../../escape.md: path does not match the file's scope, type, and id",
      'user/mem_cccccccc.md: Error: memory file has no frontmatter block',
    ])
    expect((await scanMemoryFiles(target, new Map())).map(record => record.frontmatter.id)).toEqual(['mem_aaaaaaaa'])
  })

  it('refuses files that are not memory exports', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.json'), '{"format":"other"}')
    await writeFile(join(dir, 'b.json'), 'not json')
    await expect(importMemories(dir, join(dir, 'a.json'), { lockWaitMs })).rejects.toThrow('is not an AIR memory export')
    await expect(importMemories(dir, join(dir, 'b.json'), { lockWaitMs })).rejects.toThrow('is not an AIR memory export')
    await expect(importMemories(dir, join(dir, 'missing.json'), { lockWaitMs })).rejects.toThrow('is not an AIR memory export')
  })
})
