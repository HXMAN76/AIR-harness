import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath, { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  directoriesBetween,
  expandHome,
  findProjectRoot,
  isInside,
  pathExists,
  resolveUserHomes,
  toPosixRelative,
} from '../src/index.ts'

const { win32 } = nodePath
const created: string[] = []

/** An absolute path on the current platform's current drive, so expectations hold on Windows and Linux. */
function abs(...segments: string[]): string {
  return resolve(sep, ...segments)
}

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'air-core-paths-')))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('expandHome', () => {
  const home = abs('home', 'u')

  it('expands a bare tilde and a tilde prefix', () => {
    expect(expandHome('~', home)).toBe(home)
    expect(expandHome('~/x/y', home)).toBe(join(home, 'x', 'y'))
  })

  it('leaves other paths unchanged', () => {
    expect(expandHome('/abs/x', home)).toBe('/abs/x')
    expect(expandHome('~other/x', home)).toBe('~other/x')
  })

  it('accepts a backslash after the tilde only for Windows paths', () => {
    expect(expandHome('~\\notes\\a.md', 'C:\\Users\\u', win32)).toBe('C:\\Users\\u\\notes\\a.md')
    expect(expandHome('~\\notes', home, nodePath.posix)).toBe('~\\notes')
  })
})

describe('resolveUserHomes', () => {
  const home = abs('home', 'u')

  it('uses defaults under the operating-system home', () => {
    expect(resolveUserHomes({}, {}, home)).toEqual({
      airHome: join(home, '.air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, '.agents'),
    })
  })

  it('reads AIR_HOME and DSH_AGENTS_HOME and ignores blank values', () => {
    expect(resolveUserHomes({}, { AIR_HOME: abs('data', 'air'), DSH_AGENTS_HOME: '~/shared' }, home)).toEqual({
      airHome: abs('data', 'air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, 'shared'),
    })
    expect(resolveUserHomes({}, { AIR_HOME: '  ', DSH_AGENTS_HOME: '' }, home).airHome).toBe(join(home, '.air'))
  })

  it('prefers explicit configuration over the environment', () => {
    const homes = resolveUserHomes(
      { airHome: '~/a', claudeHome: abs('c'), agentsHome: abs('g') },
      { AIR_HOME: abs('ignored'), DSH_AGENTS_HOME: abs('ignored') },
      home,
    )
    expect(homes).toEqual({ airHome: join(home, 'a'), claudeHome: abs('c'), agentsHome: abs('g') })
  })

  it('falls back to process.env and the real home', () => {
    expect(resolveUserHomes().claudeHome.endsWith('.claude')).toBe(true)
  })
})

describe('findProjectRoot', () => {
  it('returns the nearest ancestor that contains a marker', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    expect(await findProjectRoot(join(root, 'a', 'b'))).toBe(root)
    expect(await pathExists(join(root, '.git'))).toBe(true)
    expect(await pathExists(join(root, 'missing'))).toBe(false)
  })

  it('accepts custom markers', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'pkg', 'src'), { recursive: true })
    await mkdir(join(root, 'pkg', '.hg'))
    expect(await findProjectRoot(join(root, 'pkg', 'src'), ['.hg'])).toBe(join(root, 'pkg'))
  })

  it('falls back to the resolved cwd when no ancestor has a marker', async () => {
    const root = await tempDir()
    expect(await findProjectRoot(root, ['.air-marker-that-does-not-exist'])).toBe(resolve(root))
  })
})

describe('isInside', () => {
  const project = abs('p')

  it('accepts the root and its descendants only', () => {
    expect(isInside(project, project)).toBe(true)
    expect(isInside(project, join(project, 'a', 'b'))).toBe(true)
    expect(isInside(project, join(project, '..', 'q'))).toBe(false)
    expect(isInside(project, abs())).toBe(false)
    expect(isInside(project, `${project}q`)).toBe(false)
  })

  it('compares Windows paths without regard to case and rejects another drive', () => {
    expect(isInside('C:\\p', 'c:\\P\\a', win32)).toBe(true)
    expect(isInside('C:\\p', 'D:\\p\\a', win32)).toBe(false)
    expect(isInside('C:\\p', 'C:\\pq', win32)).toBe(false)
    expect(isInside('C:\\p', 'C:\\p\\..\\q', win32)).toBe(false)
  })
})

describe('directoriesBetween', () => {
  const project = abs('p')

  it('lists directories from the root down to the cwd', () => {
    expect(directoriesBetween(project, join(project, 'a', 'b'))).toEqual([project, join(project, 'a'), join(project, 'a', 'b')])
    expect(directoriesBetween(project, project)).toEqual([project])
    expect(directoriesBetween('C:\\p', 'C:\\p\\a\\b', win32)).toEqual(['C:\\p', 'C:\\p\\a', 'C:\\p\\a\\b'])
  })

  it('returns only the cwd when it is outside the root', () => {
    expect(directoriesBetween(project, abs('q', 'r'))).toEqual([abs('q', 'r')])
  })
})

describe('toPosixRelative', () => {
  it('joins the relative path with forward slashes on every platform', () => {
    expect(toPosixRelative(abs('p'), join(abs('p'), 'src', 'a.ts'))).toBe('src/a.ts')
    expect(toPosixRelative('C:\\p', 'C:\\p\\src\\a.ts', win32)).toBe('src/a.ts')
  })
})
