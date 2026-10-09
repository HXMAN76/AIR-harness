import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_IMPORT_HOPS, findImportPaths, resolveImports } from '../src/imports.ts'

const created: string[] = []
const MAX_FILE_BYTES = 1_000_000
const MAX_IMPORTS = 50

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function world(): Promise<{ project: string; home: string; outside: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'air-imports-')))
  created.push(base)
  return { project: join(base, 'project'), home: join(base, 'home'), outside: join(base, 'outside') }
}

async function write(path: string, text: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

describe('findImportPaths', () => {
  it('finds @path tokens at the start of a line and after whitespace', () => {
    expect(findImportPaths('@README\nSee @docs/style.md, then @~/notes.md. Also @./a/b.md)')).toEqual([
      'README',
      'docs/style.md',
      '~/notes.md',
      './a/b.md',
    ])
  })

  it('accepts CRLF line endings', () => {
    expect(findImportPaths('@a.md\r\nText @b.md\r\n')).toEqual(['a.md', 'b.md'])
  })

  it('ignores code spans, fenced blocks, addresses, and a bare @', () => {
    const text = [
      'Mail me at someone@example.com or ping @ later.',
      'Inline `@not/imported.md` is code.',
      '```',
      '@inside/fence.md',
      '```',
      '~~~',
      '@inside/tilde.md',
      '~~~',
      '@real.md',
    ].join('\n')
    expect(findImportPaths(text)).toEqual(['real.md'])
  })
})

describe('resolveImports', () => {
  it('follows imports relative to the importing file, in document order', async () => {
    const { project, home } = await world()
    const seed = await write(join(project, 'CLAUDE.md'), 'Read @docs/a.md and @docs/b.md')
    await write(join(project, 'docs/a.md'), 'A imports @nested/c.md')
    await write(join(project, 'docs/nested/c.md'), 'C')
    await write(join(project, 'docs/b.md'), 'B')
    const result = await resolveImports([{ path: seed, content: 'Read @docs/a.md and @docs/b.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS })
    expect(result.files.map(file => file.content)).toEqual(['A imports @nested/c.md', 'C', 'B'])
    expect(result.skipped).toEqual([])
  })

  it('includes each file once, does not re-include a seed, and ignores missing files and directories', async () => {
    const { project, home } = await world()
    const seed = await write(join(project, 'CLAUDE.md'), '@a.md @a.md @AGENTS.md @missing.md @docs')
    const agents = await write(join(project, 'AGENTS.md'), 'Agents imports @a.md')
    await write(join(project, 'a.md'), 'A imports @CLAUDE.md')
    await mkdir(join(project, 'docs'), { recursive: true })
    const result = await resolveImports([
      { path: seed, content: '@a.md @a.md @AGENTS.md @missing.md @docs' },
      { path: agents, content: 'Agents imports @a.md' },
    ], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS })
    expect(result.files).toEqual([{ path: join(project, 'a.md'), content: 'A imports @CLAUDE.md' }])
    expect(result.skipped).toEqual([])
  })

  it('stops after the hop limit', async () => {
    const { project, home } = await world()
    expect(MAX_IMPORT_HOPS).toBe(4)
    for (let hop = 1; hop <= 5; hop += 1) await write(join(project, `h${hop}.md`), `hop ${hop} @h${hop + 1}.md`)
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@h1.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS })
    expect(result.files.map(file => file.path)).toEqual([1, 2, 3, 4].map(hop => join(project, `h${hop}.md`)))
    expect(result.skipped).toEqual([{ path: join(project, 'h5.md'), reason: 'max-hops' }])
  })

  it('skips imports outside the project unless an allowed root contains them', async () => {
    const { project, home, outside } = await world()
    await write(join(outside, 'shared.md'), 'Shared')
    await write(join(home, 'notes.md'), 'Notes')
    await mkdir(project, { recursive: true })
    const seed = { path: join(project, 'CLAUDE.md'), content: '@../outside/shared.md @~/notes.md' }
    const options = { projectRoot: project, home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS }
    const denied = await resolveImports([seed], { ...options, allowedRoots: [] })
    expect(denied.files).toEqual([])
    expect(denied.skipped).toEqual([
      { path: join(outside, 'shared.md'), reason: 'outside-project' },
      { path: join(home, 'notes.md'), reason: 'outside-project' },
    ])
    const allowed = await resolveImports([seed], { ...options, allowedRoots: [outside, home] })
    expect(allowed.files.map(file => file.content)).toEqual(['Shared', 'Notes'])
    expect(allowed.skipped).toEqual([])
  })

  it('reports an outside path that does not exist without reading it', async () => {
    const { project, home } = await world()
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@../nowhere.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS })
    expect(result).toEqual({ files: [], skipped: [{ path: join(dirname(project), 'nowhere.md'), reason: 'outside-project' }] })
  })

  it.skipIf(process.platform === 'win32')('does not follow a link inside the project to a file outside it', async () => {
    const { project, home, outside } = await world()
    await write(join(outside, 'secret.md'), 'Secret')
    await mkdir(project, { recursive: true })
    await symlink(join(outside, 'secret.md'), join(project, 'link.md'))
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@link.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS })
    expect(result).toEqual({ files: [], skipped: [{ path: join(project, 'link.md'), reason: 'outside-project' }] })
  })

  it('compares visited paths case-insensitively on win32', async () => {
    const { project, home } = await world()
    await write(join(project, 'a.md'), 'A')
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@a.md @A.MD' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: MAX_IMPORTS })
    vi.unstubAllGlobals()
    expect(result.files).toEqual([{ path: join(project, 'a.md'), content: 'A' }])
  })

  it('skips credential-like files and files over the size limit', async () => {
    const { project, home } = await world()
    await write(join(project, '.env'), 'TOKEN=abc')
    await write(join(project, '.ssh/config'), 'Host *')
    await write(join(project, 'big.md'), 'x'.repeat(50))
    await write(join(project, 'small.md'), 'ok')
    const content = '@.env @.ssh/config @big.md @small.md'
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: 10, maxImportsPerFile: MAX_IMPORTS })
    expect(result.files).toEqual([{ path: join(project, 'small.md'), content: 'ok' }])
    expect(result.skipped).toEqual([
      { path: join(project, '.env'), reason: 'sensitive' },
      { path: join(project, '.ssh', 'config'), reason: 'sensitive' },
      { path: join(project, 'big.md'), reason: 'too-large' },
    ])
  })
})

describe('resolveImports import limit', () => {
  it('follows at most maxImportsPerFile tokens of one file and records one import-limit entry', async () => {
    const { project, home } = await world()
    const content = '@a.md @b.md @c.md'
    for (const name of ['a', 'b', 'c']) await write(join(project, `${name}.md`), name)
    const seed = join(project, 'CLAUDE.md')
    const options = { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES, maxImportsPerFile: 2 }
    const result = await resolveImports([{ path: seed, content }], options)
    expect(result.files.map(file => file.content)).toEqual(['a', 'b'])
    expect(result.skipped).toEqual([{ path: seed, reason: 'import-limit' }])
  })
})
