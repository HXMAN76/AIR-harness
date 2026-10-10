import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pathOf = (value: unknown): string => (typeof value === 'string' ? value : '')

// Windows reports ENOENT, not ENOTDIR, when the parent of a path is a regular file; this simulates it on every platform.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      if (pathOf(args[0]).includes('windows-enoent')) {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      }
      return actual.readFile(...args)
    }) as typeof actual.readFile,
    stat: (async (...args: Parameters<typeof actual.stat>) => {
      if (pathOf(args[0]).endsWith('windows-eacces')) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
      return actual.stat(...args)
    }) as typeof actual.stat,
  }
})

const { emptyLock, LockfileError, readLockfile } = await import('../src/lockfile.ts')

let dir: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'mcp-trust-enoent-')))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readLockfile when the read reports ENOENT', () => {
  it('fails closed when the parent of the lockfile path is a file', async () => {
    const parent = join(dir, 'windows-enoent')
    await writeFile(parent, 'x')
    const path = join(parent, 'mcp-lock.json')
    await expect(readLockfile(path)).rejects.toThrow(LockfileError)
    await expect(readLockfile(path)).rejects.toThrow(/directory path .*windows-enoent is occupied by a file/)
  })

  it('fails closed when the parent cannot be inspected', async () => {
    await expect(readLockfile(join(dir, 'windows-enoent', 'windows-eacces', 'mcp-lock.json'))).rejects.toThrow(/EACCES/)
  })

  it('reads as empty when the parent directory does not exist', async () => {
    expect(await readLockfile(join(dir, 'windows-enoent', 'missing', 'mcp-lock.json'))).toEqual(emptyLock())
  })

  it('reads as empty when the parent is a directory without the lockfile', async () => {
    await mkdir(join(dir, 'windows-enoent'))
    expect(await readLockfile(join(dir, 'windows-enoent', 'mcp-lock.json'))).toEqual(emptyLock())
  })
})
