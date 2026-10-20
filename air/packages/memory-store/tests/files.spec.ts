import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryPath, scanMemoryFiles, type ScanCache } from '../src/files.ts'
import { renderMemoryFile } from '../src/frontmatter.ts'
import { MEMORY_TYPES, MemoryId, MemoryScopeId, USER_SCOPE, type MemoryFrontmatter } from '../src/types.ts'

const created: string[] = []
afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-memory-files-'))
  created.push(dir)
  return dir
}

function frontmatter(id: string): MemoryFrontmatter {
  return {
    id: MemoryId(id),
    type: 'user',
    scope: USER_SCOPE,
    description: 'Prefers neovim',
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
  }
}

async function put(root: string, path: string, text: string): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), text)
}

const ignore = (): void => {}

describe('memoryPath', () => {
  it('builds relative paths from closed segments only', () => {
    const project = MemoryScopeId('project:0123456789abcdef')
    expect(memoryPath(USER_SCOPE, 'user', MemoryId('mem_aaaaaaaa'))).toBe('user/mem_aaaaaaaa.md')
    expect(memoryPath(project, 'project', MemoryId('mem_aaaaaaaa'))).toBe('projects/0123456789abcdef/project/mem_aaaaaaaa.md')
  })

  it('never produces a character, name, or case collision that Windows rejects', () => {
    const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
    for (const scope of [USER_SCOPE, MemoryScopeId('project:0123456789abcdef')]) {
      for (const type of MEMORY_TYPES) {
        const path = memoryPath(scope, type, MemoryId('mem_zz09aaaa'))
        expect(path).toMatch(/^[a-z0-9_/]+\.md$/u)
        for (const segment of path.split('/')) expect(segment).not.toMatch(reserved)
      }
    }
  })
})

describe('scanMemoryFiles', () => {
  it('reuses unchanged files and reads changed ones again', async () => {
    const root = await tempRoot()
    const cache: ScanCache = new Map()
    await put(root, 'user/mem_aaaaaaaa.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'first'))
    const first = await scanMemoryFiles(root, cache, ignore)
    const second = await scanMemoryFiles(root, cache, ignore)
    expect(second[0]).toBe(first[0])
    await put(root, 'user/mem_aaaaaaaa.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'second, longer'))
    const third = await scanMemoryFiles(root, cache, ignore)
    expect(third[0]).not.toBe(first[0])
    expect(third[0]?.body).toBe('second, longer')
  })

  it('notices a same-size edit by its modification time and forgets deleted files', async () => {
    const root = await tempRoot()
    const cache: ScanCache = new Map()
    await put(root, 'user/mem_aaaaaaaa.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'aaaa'))
    await scanMemoryFiles(root, cache, ignore)
    await put(root, 'user/mem_aaaaaaaa.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'bbbb'))
    await utimes(join(root, 'user/mem_aaaaaaaa.md'), new Date(), new Date(Date.now() + 5_000))
    expect((await scanMemoryFiles(root, cache, ignore))[0]?.body).toBe('bbbb')
    await rm(join(root, 'user/mem_aaaaaaaa.md'))
    expect(await scanMemoryFiles(root, cache, ignore)).toEqual([])
    expect(cache.size).toBe(0)
  })

  it('reports an invalid, misnamed, or duplicate file once and skips it', async () => {
    const root = await tempRoot()
    const cache: ScanCache = new Map()
    const warn = vi.fn()
    await put(root, 'user/mem_aaaaaaaa.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'kept'))
    await put(root, 'user/broken.md', 'no frontmatter')
    await put(root, 'user/mem_bbbbbbbb.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'misnamed'))
    await put(root, 'reference/mem_aaaaaaaa.md', renderMemoryFile(frontmatter('mem_aaaaaaaa'), 'copy'))
    expect((await scanMemoryFiles(root, cache, warn)).map(record => record.path)).toEqual(['reference/mem_aaaaaaaa.md'])
    await scanMemoryFiles(root, cache, warn)
    expect(warn.mock.calls.map(call => String(call[0])).toSorted()).toEqual([
      'air-memory: skipping user/broken.md: Error: memory file has no frontmatter block',
      'air-memory: skipping user/mem_aaaaaaaa.md: another file already uses the id mem_aaaaaaaa',
      'air-memory: skipping user/mem_bbbbbbbb.md: Error: file name does not match the id',
    ])
  })

  it('skips symbolic links, dot directories, MEMORY.md, and other extensions', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await put(outside, 'mem_cccccccc.md', renderMemoryFile(frontmatter('mem_cccccccc'), 'outside'))
    await put(root, '.quarantine/mem_cccccccc.md', renderMemoryFile(frontmatter('mem_cccccccc'), 'hidden'))
    await put(root, 'MEMORY.md', '# index\n')
    await put(root, 'user/notes.txt', 'not a memory')
    await mkdir(join(root, 'user'), { recursive: true })
    // Creating links needs a privilege on Windows; the other cases above still run there.
    const linked = await Promise.all([
      symlink(join(outside, 'mem_cccccccc.md'), join(root, 'user', 'mem_cccccccc.md')),
      symlink(outside, join(root, 'linked'), 'junction'),
    ]).then(() => true, () => false)
    expect(linked || process.platform === 'win32').toBe(true)
    expect(await scanMemoryFiles(root, new Map(), ignore)).toEqual([])
  })

  it('returns nothing for a root that does not exist', async () => {
    expect(await scanMemoryFiles(join(await tempRoot(), 'missing'), new Map(), ignore)).toEqual([])
  })
})
