import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalRootText, projectScopeId, type ScopeOptions } from '../src/scope.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-memory-scope-'))
  created.push(dir)
  return dir
}

const same = (path: string): Promise<string> => Promise.resolve(path)

/** Windows rules on any host; `existing` lists lower-case paths that hold a `.git`. */
function windows(existing: readonly string[]): ScopeOptions {
  return { pathApi: win32, caseInsensitive: true, canonical: same, exists: path => Promise.resolve(existing.includes(path.toLowerCase())) }
}

describe('projectScopeId', () => {
  it('uses the nearest ancestor that contains .git', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'src', 'deep'), { recursive: true })
    const fromRoot = await projectScopeId(root)
    expect(fromRoot).toMatch(/^project:[0-9a-f]{16}$/u)
    expect(await projectScopeId(join(root, 'src', 'deep'))).toBe(fromRoot)
  })

  it('falls back to the directory itself and separates projects', async () => {
    const first = await tempDir()
    const second = await tempDir()
    expect(await projectScopeId(first)).not.toBe(await projectScopeId(second))
    expect(await projectScopeId(first)).toBe(await projectScopeId(first))
  })

  it('gives one id to differently written Windows paths and separates drives', async () => {
    const options = windows(['c:\\users\\me\\proj\\.git'])
    const first = await projectScopeId('C:\\Users\\Me\\Proj\\src\\deep', options)
    expect(await projectScopeId('c:/users/me/proj/', options)).toBe(first)
    expect(await projectScopeId('d:\\users\\me\\proj', windows(['d:\\users\\me\\proj\\.git']))).not.toBe(first)
  })

  it('falls back to the working directory on Windows without a repository', async () => {
    const options = windows([])
    expect(await projectScopeId('C:\\x\\y', options)).toBe(await projectScopeId('c:\\X\\Y\\', options))
  })

  it('keeps POSIX paths case-sensitive', async () => {
    const options: ScopeOptions = { pathApi: posix, caseInsensitive: false, canonical: same, exists: path => Promise.resolve(path === '/a/b/.git') }
    expect(await projectScopeId('/a/b/c', options)).not.toBe(await projectScopeId('/A/b/c', options))
  })

  it('canonicalizes links through the host by default and keeps the input when that fails', async () => {
    const missing = join(await tempDir(), 'does-not-exist')
    expect(await projectScopeId(missing)).toMatch(/^project:[0-9a-f]{16}$/u)
  })
})

describe('canonicalRootText', () => {
  it('keeps roots and trims trailing separators', () => {
    expect(canonicalRootText('C:\\', true)).toBe('c:/')
    expect(canonicalRootText('/', false)).toBe('/')
    expect(canonicalRootText('C:\\Foo\\', true)).toBe('c:/foo')
    expect(canonicalRootText('/Foo//', false)).toBe('/Foo')
  })
})
