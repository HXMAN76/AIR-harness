import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import { describeSkip, describeTruncation, fileSignature, fileSize, listDirectory, listMarkdownTree, readContained, readTextFile, realpathIfPresent } from '../src/index.ts'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-files-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('readTextFile', () => {
  it('reads a regular file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await readTextFile(join(dir, 'a.md'))).toBe('hello')
  })

  it('returns undefined for a missing path, a directory, and a path below a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await readTextFile(join(dir, 'missing.md'))).toBeUndefined()
    expect(await readTextFile(dir)).toBeUndefined()
    expect(await readTextFile(join(dir, 'a.md', 'child'))).toBeUndefined()
  })

  it('rethrows failures other than absence', async () => {
    await expect(readTextFile('bad\0path')).rejects.toThrow()
  })
})

describe('fileSize and realpathIfPresent', () => {
  it('reports the size of a regular file only', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await fileSize(join(dir, 'a.md'))).toBe(5)
    expect(await fileSize(dir)).toBeUndefined()
    expect(await fileSize(join(dir, 'missing.md'))).toBeUndefined()
  })

  it('resolves an existing path and returns undefined for an absent one', async () => {
    const dir = await tempDir()
    expect(await realpathIfPresent(dir)).toBe(await realpath(dir))
    expect(await realpathIfPresent(join(dir, 'missing'))).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('resolves a symbolic link to its target', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'real'))
    await symlink(join(dir, 'real'), join(dir, 'link'))
    expect(await realpathIfPresent(join(dir, 'link'))).toBe(await realpath(join(dir, 'real')))
  })

  it('rethrows failures other than absence', async () => {
    await expect(realpathIfPresent('bad\0path')).rejects.toThrow()
  })
})

const LIMIT = 1000

function walkOptions(...roots: string[]): { roots: string[]; maxEntries: number } {
  return { roots, maxEntries: LIMIT }
}

describe('fileSignature', () => {
  it('changes when the file is rewritten and is undefined for non-files', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'one')
    const first = await fileSignature(join(dir, 'a.md'))
    await writeFile(join(dir, 'a.md'), 'three')
    expect(await fileSignature(join(dir, 'a.md'))).not.toBe(first)
    expect(await fileSignature(dir)).toBeUndefined()
    expect(await fileSignature(join(dir, 'missing'))).toBeUndefined()
  })
})

describe('readContained', () => {
  const limits = (...roots: string[]): { roots: string[]; maxBytes: number } => ({ roots, maxBytes: 100 })

  it('reads a file inside a root and reports absent, directory, oversize, and sensitive files', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    await writeFile(join(dir, 'big.md'), 'x'.repeat(101))
    await writeFile(join(dir, '.env'), 'SECRET=1')
    await mkdir(join(dir, 'sub'))
    expect(await readContained(join(dir, 'a.md'), limits(dir))).toEqual({ kind: 'ok', text: 'hello' })
    expect(await readContained(join(dir, 'missing.md'), limits(dir))).toEqual({ kind: 'absent' })
    expect(await readContained(join(dir, 'sub'), limits(dir))).toEqual({ kind: 'not-file' })
    expect(await readContained(join(dir, 'big.md'), limits(dir))).toEqual({ kind: 'too-large' })
    expect(await readContained(join(dir, '.env'), limits(dir))).toEqual({ kind: 'sensitive' })
  })

  it('reads a project that sits under a directory with a sensitive name and still refuses sensitive files inside it', async () => {
    const parent = join(await tempDir(), '.docker')
    const project = join(parent, 'work')
    await mkdir(join(project, '.aws'), { recursive: true })
    await writeFile(join(project, 'a.md'), 'hello')
    await writeFile(join(project, '.env'), 'SECRET=1')
    await writeFile(join(project, '.aws', 'notes.md'), 'key')
    expect(await readContained(join(project, 'a.md'), limits(project))).toEqual({ kind: 'ok', text: 'hello' })
    expect(await readContained(join(project, '.env'), limits(project))).toEqual({ kind: 'sensitive' })
    expect(await readContained(join(project, '.aws', 'notes.md'), limits(project))).toEqual({ kind: 'sensitive' })
  })

  it.skipIf(process.platform === 'win32')('refuses a link inside the project to an in-root sensitive file, and a link from outside to one', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(dir, '.env'), 'SECRET=1')
    await symlink(join(dir, '.env'), join(dir, 'link.md'))
    await symlink(join(dir, '.env'), join(outside, 'link.md'))
    expect(await readContained(join(dir, 'link.md'), limits(dir))).toEqual({ kind: 'sensitive' })
    expect(await readContained(join(outside, 'link.md'), limits(dir))).toEqual({ kind: 'sensitive' })
  })

  it('refuses a file outside every root and accepts any listed root', async () => {
    const dir = await tempDir()
    const other = await tempDir()
    await writeFile(join(other, 'a.md'), 'elsewhere')
    expect(await readContained(join(other, 'a.md'), limits(dir))).toEqual({ kind: 'outside-root' })
    expect(await readContained(join(other, 'a.md'), limits(dir, other))).toEqual({ kind: 'ok', text: 'elsewhere' })
  })

  it('compares paths with the supplied path module', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    const shouted = [dir.toUpperCase()]
    expect(await readContained(join(dir, 'a.md'), { roots: shouted, maxBytes: 100 })).toEqual({ kind: 'outside-root' })
    expect(await readContained(join(dir, 'a.md'), { roots: shouted, maxBytes: 100, pathApi: win32 })).toEqual({ kind: 'ok', text: 'hello' })
  })

  it.skipIf(process.platform === 'win32')('refuses a link to a file outside the root', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'secret.md'), 'private')
    await symlink(join(outside, 'secret.md'), join(dir, 'link.md'))
    expect(await readContained(join(dir, 'link.md'), limits(dir))).toEqual({ kind: 'outside-root' })
  })

  it.skipIf(process.platform === 'win32')('refuses a link inside the root that points at a credential file', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.ssh'))
    await writeFile(join(dir, '.ssh', 'id_rsa'), 'key')
    await symlink(join(dir, '.ssh', 'id_rsa'), join(dir, 'link.md'))
    expect(await readContained(join(dir, 'link.md'), limits(dir))).toEqual({ kind: 'sensitive' })
  })

  it.skipIf(process.platform === 'win32')('follows a link whose target stays inside the root', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'AGENTS.md'), 'shared')
    await symlink(join(dir, 'AGENTS.md'), join(dir, 'CLAUDE.md'))
    expect(await readContained(join(dir, 'CLAUDE.md'), limits(dir))).toEqual({ kind: 'ok', text: 'shared' })
  })

  it('treats a root that does not exist as containing nothing', async () => {
    const dir = await tempDir()
    expect(await readContained(join(dir, 'missing'), limits(join(dir, 'also-missing')))).toEqual({ kind: 'absent' })
  })
})

describe('listDirectory', () => {
  it('lists files and directories sorted by name', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    expect(await listDirectory(dir, walkOptions(dir))).toEqual({
      entries: [
        { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
        { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
      ],
      skipped: [],
      truncated: false,
    })
  })

  it.skipIf(process.platform === 'win32')('follows links inside the roots and skips broken ones', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    await symlink(join(dir, 'zeta'), join(dir, 'link'))
    await symlink(join(dir, 'nowhere'), join(dir, 'broken'))
    expect((await listDirectory(dir, walkOptions(dir))).entries).toEqual([
      { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
      { name: 'link', path: join(dir, 'link'), kind: 'directory' },
      { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
    ])
  })

  it.skipIf(process.platform === 'win32')('skips entries whose real path leaves the roots and reports them', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'secret.md'), 's')
    await mkdir(join(outside, 'docs'))
    await writeFile(join(dir, 'ok.md'), 'a')
    await symlink(join(outside, 'secret.md'), join(dir, 'file-link.md'))
    await symlink(join(outside, 'docs'), join(dir, 'dir-link'))
    const listing = await listDirectory(dir, walkOptions(dir))
    expect(listing.entries).toEqual([{ name: 'ok.md', path: join(dir, 'ok.md'), kind: 'file' }])
    expect(listing.skipped).toEqual([
      { path: join(dir, 'dir-link'), reason: 'outside-root' },
      { path: join(dir, 'file-link.md'), reason: 'outside-root' },
    ])
  })

  it.skipIf(process.platform === 'win32')('refuses to list a root that is a link leaving the allowed roots', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'a.md'), 'a')
    await symlink(outside, join(dir, 'rules'))
    expect(await listDirectory(join(dir, 'rules'), walkOptions(dir))).toEqual({
      entries: [],
      skipped: [{ path: join(dir, 'rules'), reason: 'outside-root' }],
      truncated: false,
    })
  })

  it.skipIf(process.platform === 'win32')('omits special files such as sockets', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'alpha.md'), 'a')
    const server = createServer()
    await new Promise<void>((resolve) => { server.listen(join(dir, 'sock'), resolve) })
    try {
      expect((await listDirectory(dir, walkOptions(dir))).entries).toEqual([{ name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' }])
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it.skipIf(process.platform === 'win32')('compares paths with the supplied path module', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'a')
    const listing = await listDirectory(dir, { roots: [dir.toUpperCase()], maxEntries: LIMIT, pathApi: win32 })
    expect(listing.entries).toHaveLength(1)
  })

  it('returns an empty listing for a missing root and for a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'a')
    const empty = { entries: [], skipped: [], truncated: false }
    expect(await listDirectory(join(dir, 'missing'), walkOptions(dir))).toEqual(empty)
    expect(await listDirectory(join(dir, 'a.md'), walkOptions(dir))).toEqual(empty)
  })

  it('stops at the entry cap and reports truncation', async () => {
    const dir = await tempDir()
    for (const name of ['a.md', 'b.md', 'c.md']) await writeFile(join(dir, name), 'x')
    const listing = await listDirectory(dir, { roots: [dir], maxEntries: 2 })
    expect(listing.entries.map(entry => entry.name)).toEqual(['a.md', 'b.md'])
    expect(listing.truncated).toBe(true)
  })
})

describe('listMarkdownTree', () => {
  it('lists Markdown files with path segments up to the depth limit', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'frontend', 'deep'), { recursive: true })
    await writeFile(join(dir, 'fix.md'), 'x')
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(dir, 'frontend', 'component.md'), 'x')
    await writeFile(join(dir, 'frontend', 'deep', 'too-deep.md'), 'x')
    expect((await listMarkdownTree(dir, 2, walkOptions(dir))).entries).toEqual([
      { path: join(dir, 'fix.md'), segments: ['fix'] },
      { path: join(dir, 'frontend', 'component.md'), segments: ['frontend', 'component'] },
    ])
    expect((await listMarkdownTree(dir, 1, walkOptions(dir))).entries).toEqual([{ path: join(dir, 'fix.md'), segments: ['fix'] }])
  })

  it('returns an empty tree for a missing root', async () => {
    const dir = await tempDir()
    expect(await listMarkdownTree(join(dir, 'missing'), 4, walkOptions(dir))).toEqual({ entries: [], skipped: [], truncated: false })
  })

  it.skipIf(process.platform === 'win32')('does not walk a linked directory outside the roots', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'secret.md'), 's')
    await mkdir(join(dir, 'rules'))
    await symlink(outside, join(dir, 'rules', 'docs'))
    const tree = await listMarkdownTree(join(dir, 'rules'), 4, walkOptions(dir))
    expect(tree.entries).toEqual([])
    expect(tree.skipped).toEqual([{ path: join(dir, 'rules', 'docs'), reason: 'outside-root' }])
  })

  it.skipIf(process.platform === 'win32')('walks a directory linked inside the roots once and ends link loops', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'real'))
    await writeFile(join(dir, 'real', 'a.md'), 'x')
    await symlink(join(dir, 'real'), join(dir, 'again'))
    await symlink(dir, join(dir, 'real', 'loop'))
    const tree = await listMarkdownTree(dir, 50, walkOptions(dir))
    expect(tree.entries).toEqual([{ path: join(dir, 'again', 'a.md'), segments: ['again', 'a'] }])
    expect(tree.truncated).toBe(false)
  })

  it('shares the entry cap across the whole walk', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'a'))
    await mkdir(join(dir, 'b'))
    for (const sub of ['a', 'b']) await writeFile(join(dir, sub, 'x.md'), 'x')
    const tree = await listMarkdownTree(dir, 4, { roots: [dir], maxEntries: 3 })
    expect(tree.entries).toEqual([{ path: join(dir, 'a', 'x.md'), segments: ['a', 'x'] }])
    expect(tree.truncated).toBe(true)
  })
})

describe('describeSkip and describeTruncation', () => {
  it('name the path and the reason', () => {
    expect(describeSkip('/p/a.md', 'outside-root', 10)).toContain('/p/a.md skipped: its real path is outside')
    expect(describeSkip('/p/a.md', 'sensitive', 10)).toContain('credential')
    expect(describeSkip('/p/a.md', 'too-large', 10)).toBe('/p/a.md skipped: it is larger than 10 bytes')
    expect(describeSkip('/p/a.md', 'not-file', 10)).toContain('not a regular file')
    expect(describeTruncation('/p/rules', 5)).toBe('/p/rules listing stopped after 5 entries; later entries were not read')
  })
})
