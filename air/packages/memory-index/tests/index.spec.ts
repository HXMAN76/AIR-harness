import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryId, MemoryScopeId, USER_SCOPE, type MemoryFrontmatter, type MemoryRecord } from '@air/dsh-memory-store'
import MemoryIndex, { resolveIndexPath, type Config, type MemorySearchOptions } from '../src/index.ts'

const BASE: Config = {
  path: ':memory:',
  journalMode: 'delete',
  snippetChars: 24,
  syncMinIntervalMs: 0,
}
const PROJECT_A = MemoryScopeId('project:aaaaaaaaaaaaaaaa')
const PROJECT_B = MemoryScopeId('project:bbbbbbbbbbbbbbbb')
const signal = new AbortController().signal
const cleanups: Array<() => Promise<unknown>> = []

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function record(id: string, description: string, body: string, patch: Partial<MemoryFrontmatter> = {}): MemoryRecord {
  const frontmatter: MemoryFrontmatter = {
    id: MemoryId(id),
    type: 'user',
    scope: USER_SCOPE,
    description,
    created: '2026-09-29T10:00:00.000Z',
    updated: '2026-09-29T10:00:00.000Z',
    valid_from: '2026-09-29T10:00:00.000Z',
    valid_to: null,
    supersedes: null,
    superseded_by: null,
    importance: 3,
    source: { kind: 'user-confirmed' },
    trust: 'high',
    last_recalled: null,
    ...patch,
  }
  return { frontmatter, body, path: `user/${id}.md`, hash: JSON.stringify([frontmatter, body]) }
}

function corpus(): MemoryRecord[] {
  return [
    record('mem_editor00', 'Prefers neovim for quick edits', 'Uses neovim in the terminal for small changes to dotfiles.'),
    record('mem_drink000', 'Drinks green tea', 'Green tea in the morning, no coffee after noon.'),
    record('mem_oldedit0', 'Prefers emacs for quick edits', 'Earlier editor preference.', { superseded_by: MemoryId('mem_editor00'), valid_to: '2026-09-30T00:00:00.000Z' }),
    record('mem_projecta', 'Project uses pnpm for neovim plugins', 'Run pnpm install first.', { type: 'project', scope: PROJECT_A }),
  ]
}

async function mount(records: MemoryRecord[], config: Partial<Config> = {}) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const store = { generation: 0, list: () => Promise.resolve([...records]) }
  ctx.provide('airMemoryStore', store)
  await ctx.plugin(MemoryIndex, { ...BASE, ...config })
  const search = (patch: Partial<MemorySearchOptions> & { query: string }) =>
    ctx.airMemoryIndex.search({ scopes: [USER_SCOPE], limit: 8, ...patch }, signal)
  return { ctx, index: ctx.airMemoryIndex, search, store }
}

describe('keyword search', () => {
  it('ranks by BM25 and truncates the snippet', async () => {
    const { search } = await mount(corpus())
    const result = await search({ query: 'Which editor: neovim?' })
    expect(result.hits.map(hit => hit.id)).toEqual(['mem_editor00'])
    expect(result.hits[0]).toMatchObject({
      type: 'user', scope: 'user', description: 'Prefers neovim for quick edits', snippet: 'Uses neovim in the termi',
      trust: 'high', updated: '2026-09-29T10:00:00.000Z', superseded: false,
    })
    expect(result.hits[0]?.bm25).toBeLessThan(0)
    expect(result.hits[0]?.score).toBe(-(result.hits[0]?.bm25 ?? 0))
  })

  it('puts the note that matches more often first', async () => {
    const { search } = await mount(corpus())
    const result = await search({ query: 'neovim', scopes: [USER_SCOPE, PROJECT_A] })
    expect(result.hits.map(hit => hit.id)).toEqual(['mem_editor00', 'mem_projecta'])
    expect(result.hits[0]?.score).toBeGreaterThan(result.hits[1]?.score ?? 0)
  })

  it('returns nothing for a query without terms, without scopes, or without a match', async () => {
    const { search } = await mount(corpus())
    expect((await search({ query: '?? --' })).hits).toEqual([])
    expect(await search({ query: 'neovim', scopes: [] })).toEqual({ hits: [] })
    expect((await search({ query: 'kubernetes' })).hits).toEqual([])
  })

  it('excludes superseded memories unless asked', async () => {
    const { search } = await mount(corpus())
    expect((await search({ query: 'emacs' })).hits).toEqual([])
    const all = await search({ query: 'emacs', includeSuperseded: true })
    expect(all.hits.map(hit => [hit.id, hit.superseded])).toEqual([['mem_oldedit0', true]])
  })

  it('marks a forgotten memory as superseded when asked for it', async () => {
    const forgotten = record('mem_forgot00', 'Used to like emacs', 'Forgotten on request.', { valid_to: '2026-09-30T00:00:00.000Z' })
    const { search } = await mount([...corpus(), forgotten])
    expect((await search({ query: 'forgotten', includeSuperseded: true })).hits.map(hit => [hit.id, hit.superseded])).toEqual([['mem_forgot00', true]])
  })

  it('never returns a project memory outside its scope and filters by type', async () => {
    const { search } = await mount(corpus())
    expect((await search({ query: 'pnpm', scopes: [USER_SCOPE, PROJECT_B] })).hits).toEqual([])
    expect((await search({ query: 'pnpm', scopes: [USER_SCOPE, PROJECT_A] })).hits.map(hit => hit.id)).toEqual(['mem_projecta'])
    const typed = await search({ query: 'neovim', scopes: [USER_SCOPE, PROJECT_A], types: ['project'] })
    expect(typed.hits.map(hit => hit.id)).toEqual(['mem_projecta'])
    expect((await search({ query: 'neovim', scopes: [USER_SCOPE, PROJECT_A], types: [], limit: 1 })).hits).toHaveLength(1)
  })
})

describe('sync', () => {
  it('follows file changes and removals by content hash', async () => {
    const records = corpus()
    const { index, search } = await mount(records)
    expect(await index.sync(signal)).toEqual({ indexed: 4, removed: 0 })
    expect(await index.sync(signal)).toEqual({ indexed: 0, removed: 0 })
    records[1] = record('mem_drink000', 'Drinks oolong tea', 'Switched from green tea.')
    records.splice(0, 1)
    expect(await index.sync(signal)).toEqual({ indexed: 1, removed: 1 })
    expect((await search({ query: 'oolong' })).hits.map(hit => hit.id)).toEqual(['mem_drink000'])
    expect((await search({ query: 'dotfiles' })).hits).toEqual([])
  })

  it('gives identical rankings after the index is rebuilt from the files', async () => {
    const { index, search } = await mount(corpus())
    const before = await search({ query: 'tea in the morning or neovim', includeSuperseded: true })
    expect(before.hits.length).toBeGreaterThan(1)
    expect(await index.rebuild(signal)).toEqual({ indexed: 4, removed: 0 })
    expect(await search({ query: 'tea in the morning or neovim', includeSuperseded: true })).toEqual(before)
  })

  it('opens the database under the dsh cache directory by default and closes it on dispose', async () => {
    const home = await mkdtemp(join(tmpdir(), 'air-memory-index-home-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', home)
    expect(resolveIndexPath({ ...BASE, path: '/x/y.sqlite' })).toBe('/x/y.sqlite')
    const ctx = new Context()
    ctx.provide('airMemoryStore', { list: () => Promise.resolve(corpus()) })
    const fiber = await ctx.plugin(MemoryIndex)
    expect(await ctx.airMemoryIndex.sync(signal)).toMatchObject({ indexed: 4 })
    await fiber.dispose()
    const unused = await ctx.plugin(MemoryIndex, BASE)
    await unused.dispose()
    await ctx.fiber.dispose()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(home, 'cache', 'air', 'memory-index.sqlite'))
    expect(db.prepare('SELECT count(*) AS n FROM memories').get()).toEqual({ n: 4 })
    db.close()
  })
})

describe('cost of keeping the index current', () => {
  it('checks the files before every search by default and only after the interval otherwise', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const records = corpus()
    const { search, store } = await mount(records, { syncMinIntervalMs: 2_000 })
    expect((await search({ query: 'oolong' })).hits).toEqual([])
    records.push(record('mem_oolong00', 'Drinks oolong tea', 'Switched from green tea.'))
    vi.setSystemTime(1_000)
    expect((await search({ query: 'oolong' })).hits).toEqual([])
    vi.setSystemTime(2_000)
    expect((await search({ query: 'oolong' })).hits.map(hit => hit.id)).toEqual(['mem_oolong00'])
    records.push(record('mem_matcha00', 'Drinks matcha', 'Switched from oolong.'))
    vi.setSystemTime(2_500)
    store.generation += 1
    expect((await search({ query: 'matcha' })).hits.map(hit => hit.id)).toEqual(['mem_matcha00'])
  })
})

describe('failures', () => {
  it('lets a failed sync reject and the next one run', async () => {
    const { index, store } = await mount(corpus())
    const list = vi.spyOn(store, 'list').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(index.sync(signal)).rejects.toThrow('disk unavailable')
    expect(await index.sync(signal)).toMatchObject({ indexed: 4 })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('rolls a failed sync back as a whole', async () => {
    const records = corpus()
    const { index, search } = await mount(records, { syncMinIntervalMs: 60_000 })
    await index.sync(signal)
    records.push(record('mem_broken00', 'Cannot be indexed', 'importance is not a number', { importance: Number.NaN }))
    records[0] = record('mem_editor00', 'Prefers helix now', 'Changed before the failure.')
    await expect(index.sync(signal)).rejects.toThrow()
    expect((await search({ query: 'neovim' })).hits.map(hit => hit.id)).toEqual(['mem_editor00'])
    expect((await search({ query: 'helix' })).hits).toEqual([])
  })

  it('disposes cleanly when the database could not be opened', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'air-memory-index-dir-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const { ctx, index } = await mount(corpus(), { path: directory })
    await expect(index.sync(signal)).rejects.toThrow()
    await expect(ctx.fiber.dispose()).resolves.not.toThrow()
  })
})
