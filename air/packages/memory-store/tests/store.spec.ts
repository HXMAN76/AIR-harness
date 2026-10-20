import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import MemoryStore, {
  MemoryId,
  MemoryScopeId,
  USER_SCOPE,
  type Config,
  type MemoryWriteInput,
} from '../src/index.ts'

const BASE: Config = {
  gitPath: 'git',
  commitAuthorName: 'AIR memory',
  commitAuthorEmail: 'air-memory@localhost',
  gitTimeoutMs: 30_000,
  lockWaitMs: 10_000,
  shareWith: ['ollama'],
}
const PROJECT = MemoryScopeId('project:0123456789abcdef')
const signal = new AbortController().signal

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-memory-store-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function mount(config: Partial<Config> = {}) {
  const root = join(await tempDir(), 'memory')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(MemoryStore, { ...BASE, root, ...config })
  return { root, store: ctx.airMemoryStore, warn }
}

function input(patch: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    type: 'user',
    scope: USER_SCOPE,
    description: 'Prefers neovim for quick edits',
    body: 'Said so while editing dotfiles.',
    importance: 3,
    source: { kind: 'user-confirmed', session: 's1', seq: 7 },
    ...patch,
  }
}

function subjects(root: string): string[] {
  return execFileSync('git', ['log', '--format=%s'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/u)
}

describe('MemoryStore.write', () => {
  it('writes an owner-only file, lists it, and commits it', async () => {
    const { root, store } = await mount()
    const record = await store.write(input(), signal)
    expect(record.path).toBe(`user/${record.frontmatter.id}.md`)
    expect(record.frontmatter).toMatchObject({ type: 'user', scope: 'user', trust: 'high', valid_to: null, supersedes: null })
    const text = await readFile(join(root, record.path), 'utf8')
    expect(record.hash).toBe(createHash('sha256').update(text).digest('hex'))
    // Windows has no POSIX modes; the owner-only mode is checked where it exists.
    if (process.platform !== 'win32') expect((await stat(join(root, record.path))).mode & 0o777).toBe(0o600)
    expect(await store.list()).toEqual([record])
    expect(await store.read(record.frontmatter.id)).toEqual(record)
    expect(subjects(root)).toEqual([`air-memory: write ${record.frontmatter.id} (session s1)`])
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.air/\n')
    expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe('* text eol=lf\n')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('')
    expect(store.versioning).toEqual({ state: 'git', reason: null })
  })

  it('commits with the configured identity, whatever the git configuration says', async () => {
    const { root, store } = await mount({ commitAuthorName: 'Someone Else', commitAuthorEmail: 'else@example.test' })
    await store.write(input(), signal)
    expect(execFileSync('git', ['log', '-1', '--format=%an <%ae> / %cn <%ce>'], { cwd: root, encoding: 'utf8' }).trim())
      .toBe('Someone Else <else@example.test> / Someone Else <else@example.test>')
  })

  it('counts writes in its generation', async () => {
    const { store } = await mount()
    expect(store.generation).toBe(0)
    const record = await store.write(input(), signal)
    await store.forget(record.frontmatter.id, 'soft', undefined, signal)
    expect(store.generation).toBe(2)
  })

  it('places project memories under projects/<hash>', async () => {
    const { store } = await mount()
    const record = await store.write(input({ type: 'project', scope: PROJECT, source: { kind: 'agent-inferred' } }), signal)
    expect(record.path).toBe(`projects/0123456789abcdef/project/${record.frontmatter.id}.md`)
    expect(record.frontmatter.trust).toBe('low')
  })

  it('supersedes instead of deleting, in one commit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-10-01T00:00:00.000Z'))
    const { root, store } = await mount()
    const old = await store.write(input(), signal)
    vi.setSystemTime(Date.parse('2026-10-02T00:00:00.000Z'))
    const next = await store.write(input({ description: 'Prefers helix now', supersedes: old.frontmatter.id }), signal)
    expect(next.frontmatter.supersedes).toBe(old.frontmatter.id)
    const stale = await store.read(old.frontmatter.id)
    expect(stale?.frontmatter).toMatchObject({
      superseded_by: next.frontmatter.id,
      valid_to: '2026-10-02T00:00:00.000Z',
      updated: '2026-10-02T00:00:00.000Z',
      created: '2026-10-01T00:00:00.000Z',
    })
    expect((await store.list()).map(record => record.frontmatter.id)).toEqual([next.frontmatter.id])
    expect(await store.list({ includeSuperseded: true })).toHaveLength(2)
    expect(subjects(root)).toHaveLength(2)
  })

  it('refuses to supersede an unknown, already superseded, or other-scope memory', async () => {
    const { store } = await mount()
    await expect(store.write(input({ supersedes: MemoryId('mem_missing0') }), signal)).rejects.toThrow('memory mem_missing0 does not exist')
    const old = await store.write(input(), signal)
    await expect(store.write(input({ scope: PROJECT, supersedes: old.frontmatter.id }), signal)).rejects.toThrow('belongs to another scope')
    await store.write(input({ supersedes: old.frontmatter.id }), signal)
    await expect(store.write(input({ supersedes: old.frontmatter.id }), signal)).rejects.toThrow('is already superseded')
  })

  it('rejects an invalid description before writing anything', async () => {
    const { store } = await mount()
    await expect(store.write(input({ description: 'two\nlines' }), signal)).rejects.toThrow('memory frontmatter is invalid')
    expect(await store.list({ includeSuperseded: true })).toEqual([])
  })

  it('keeps the file and says so when git cannot run, then records it once git works', async () => {
    const { root, store, warn } = await mount({ gitPath: 'air-git-that-does-not-exist' })
    const record = await store.write(input(), signal)
    expect(await store.read(record.frontmatter.id)).toEqual(record)
    expect(store.versioning.state).toBe('files-only')
    expect(store.versioning.reason).not.toBeNull()
    expect(warn.mock.calls.map(call => String(call[0])).some(message => message.startsWith('air-memory: saved as plain files, git did not record it:'))).toBe(true)

    const repaired = await mount({ root, gitPath: 'git' })
    const next = await repaired.store.write(input({ description: 'Drinks green tea' }), signal)
    expect(repaired.store.versioning).toEqual({ state: 'git', reason: null })
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/u).toSorted())
      .toEqual(['.gitattributes', '.gitignore', record.path, next.path].toSorted())
  })

  it('keeps the file when a hook or an unwritable repository makes the commit fail', async () => {
    const { root, store } = await mount()
    await store.write(input(), signal)
    await writeFile(join(root, '.git', 'index.lock'), '')
    const record = await store.write(input({ description: 'Drinks green tea' }), signal)
    expect(store.versioning.state).toBe('files-only')
    expect(await store.read(record.frontmatter.id)).toEqual(record)
  })

  it('reads notes edited by hand with Windows line endings', async () => {
    const { root, store } = await mount()
    const record = await store.write(input(), signal)
    const text = await readFile(join(root, record.path), 'utf8')
    await writeFile(join(root, record.path), `\uFEFF${text.replaceAll('\n', '\r\n')}`)
    expect((await store.read(record.frontmatter.id))?.body).toBe('Said so while editing dotfiles.')
  })
})

describe('MemoryStore.forget', () => {
  it('expires on soft forget and removes the file on delete', async () => {
    const { root, store } = await mount()
    const soft = await store.write(input(), signal)
    const hard = await store.write(input({ description: 'Drinks green tea' }), signal)
    expect(await store.forget(soft.frontmatter.id, 'soft', 's2', signal)).toBe(true)
    expect(await store.forget(hard.frontmatter.id, 'delete', undefined, signal)).toBe(true)
    expect(await store.forget(MemoryId('mem_missing0'), 'delete', undefined, signal)).toBe(false)
    expect(await store.list()).toEqual([])
    const remaining = await store.list({ includeSuperseded: true })
    expect(remaining.map(record => record.frontmatter.id)).toEqual([soft.frontmatter.id])
    expect(remaining[0]?.frontmatter.valid_to).not.toBeNull()
    expect(subjects(root).slice(0, 2)).toEqual([
      `air-memory: forget-delete ${hard.frontmatter.id}`,
      `air-memory: forget-soft ${soft.frontmatter.id} (session s2)`,
    ])
  })
})

describe('MemoryStore.list', () => {
  it('returns nothing for a root that does not exist', async () => {
    const { store } = await mount()
    expect(await store.list()).toEqual([])
  })

  it('reports an invalid file once, however often the store is listed', async () => {
    const { root, store, warn } = await mount()
    const kept = await store.write(input(), signal)
    await writeFile(join(root, 'user', 'broken.md'), 'no frontmatter')
    expect((await store.list()).map(record => record.frontmatter.id)).toEqual([kept.frontmatter.id])
    await store.list()
    expect(warn.mock.calls.map(call => String(call[0]))).toEqual(['air-memory: skipping user/broken.md: Error: memory file has no frontmatter block'])
  })
})

describe('MemoryStore export and import', () => {
  it('moves notes between stores as one commit and does not repeat an import', async () => {
    const source = await mount()
    const note = await source.store.write(input(), signal)
    const archive = join(await tempDir(), 'memories.json')
    expect(await source.store.exportTo(archive)).toEqual({ files: 1 })
    const target = await mount()
    expect(await target.store.importFrom(archive, { keepTrust: true }, signal)).toEqual({ imported: 1, skippedExisting: 0, invalid: [] })
    expect((await target.store.read(note.frontmatter.id))?.frontmatter.trust).toBe('high')
    expect(subjects(target.root)).toEqual(['air-memory: import 1 memories'])
    expect(target.store.generation).toBe(1)
    expect(await target.store.importFrom(archive, {}, signal)).toMatchObject({ imported: 0, skippedExisting: 1 })
    expect(subjects(target.root)).toHaveLength(1)
  })
})

describe('MemoryStore root', () => {
  it('defaults to <DSH_HOME>/air/memory', async () => {
    const home = await tempDir()
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(MemoryStore)
    expect(ctx.airMemoryStore.root).toBe(join(home, 'air', 'memory'))
    expect(ctx.airMemoryStore.shareWith).toEqual(['ollama'])
  })
})
