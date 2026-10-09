import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileSize, listDirectory, listMarkdownTree, readTextFile, realpathIfPresent } from '../src/index.ts'

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

describe('listDirectory', () => {
  it('lists files and directories sorted by name', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    expect(await listDirectory(dir)).toEqual([
      { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
      { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
    ])
  })

  it.skipIf(process.platform === 'win32')('follows symbolic links and skips broken ones', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    await symlink(join(dir, 'zeta'), join(dir, 'link'))
    await symlink(join(dir, 'nowhere'), join(dir, 'broken'))
    expect(await listDirectory(dir)).toEqual([
      { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
      { name: 'link', path: join(dir, 'link'), kind: 'directory' },
      { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
    ])
  })

  it.skipIf(process.platform === 'win32')('omits special files such as sockets', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'alpha.md'), 'a')
    const server = createServer()
    await new Promise<void>((resolve) => { server.listen(join(dir, 'sock'), resolve) })
    try {
      expect(await listDirectory(dir)).toEqual([{ name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' }])
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('returns an empty list for a missing root and for a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'a')
    expect(await listDirectory(join(dir, 'missing'))).toEqual([])
    expect(await listDirectory(join(dir, 'a.md'))).toEqual([])
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
    expect(await listMarkdownTree(dir, 2)).toEqual([
      { path: join(dir, 'fix.md'), segments: ['fix'] },
      { path: join(dir, 'frontend', 'component.md'), segments: ['frontend', 'component'] },
    ])
    expect(await listMarkdownTree(dir, 1)).toEqual([{ path: join(dir, 'fix.md'), segments: ['fix'] }])
  })

  it('returns an empty list for a missing root', async () => {
    expect(await listMarkdownTree(join(await tempDir(), 'missing'), 4)).toEqual([])
  })
})
