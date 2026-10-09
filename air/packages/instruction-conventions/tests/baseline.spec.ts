import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeBaseline, type BaselineInput } from '../src/baseline.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function world(): Promise<BaselineInput> {
  const base = await mkdtemp(join(tmpdir(), 'air-baseline-'))
  created.push(base)
  const projectRoot = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(projectRoot, 'pkg'), { recursive: true })
  return {
    cwd: join(projectRoot, 'pkg'),
    projectRoot,
    claudeHome: join(home, '.claude'),
    home,
    includeUserRoots: false,
    allowedImportRoots: [],
    maxBytes: 32768,
    maxFileBytes: 32768,
    maxEntries: 500,
    maxImportsPerFile: 32,
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('composeBaseline', () => {
  it('returns nothing when the workspace has no convention files', async () => {
    expect(await composeBaseline(await world())).toEqual({ baseline: undefined, problems: [] })
  })

  it('assembles .claude/CLAUDE.md, imports from the instruction chain, and always rules', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory. @../docs/style.md')
    await write(join(root, 'docs/style.md'), 'Style guide.')
    await write(join(root, 'CLAUDE.md'), 'Root file, injected upstream. @docs/build.md')
    await write(join(root, 'docs/build.md'), 'Build steps.')
    await write(join(root, 'pkg/AGENTS.local.md'), 'Local file, injected upstream. @notes.md')
    await write(join(root, 'pkg/notes.md'), 'Package notes.')
    await write(join(root, '.claude/rules/general.md'), 'Be concise.')
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nScoped rule.')
    const { baseline, problems } = await composeBaseline(input)
    expect(problems).toEqual([])
    expect(baseline?.text).toBe([
      '<air_instructions>',
      'These project convention files apply to this workspace. Follow them together with the other workspace instructions.',
      `<file path="${join(root, '.claude/CLAUDE.md')}">`,
      'Project memory. @../docs/style.md',
      '</file>',
      `<file path="${join(root, 'docs/style.md')}">`,
      'Style guide.',
      '</file>',
      `<file path="${join(root, 'docs/build.md')}">`,
      'Build steps.',
      '</file>',
      `<file path="${join(root, 'pkg/notes.md')}">`,
      'Package notes.',
      '</file>',
      `<file path="${join(root, '.claude/rules/general.md')}">`,
      'Be concise.',
      '</file>',
      '</air_instructions>',
    ].join('\n'))
    expect(baseline?.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect((await composeBaseline(input)).baseline?.digest).toBe(baseline?.digest)
  })

  it('reads the user CLAUDE.md and its imports only on request', async () => {
    const input = await world()
    await write(join(input.claudeHome, 'CLAUDE.md'), 'User memory. @~/.claude/extra.md')
    await write(join(input.claudeHome, 'extra.md'), 'User extra.')
    expect((await composeBaseline(input)).baseline).toBeUndefined()
    const { baseline } = await composeBaseline({ ...input, includeUserRoots: true })
    expect(baseline?.text).toContain('User memory.')
    expect(baseline?.text).toContain('User extra.')
  })

  it('includes identical or empty content once and notes skipped imports', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Same text. @../../air-outside.md')
    await write(join(root, '.claude/rules/dup.md'), 'Same text. @../../air-outside.md')
    await write(join(root, '.claude/rules/blank.md'), '   \n')
    const { baseline } = await composeBaseline(input)
    expect(baseline?.text.match(/Same text\./gu)).toHaveLength(1)
    expect(baseline?.text).toContain(`<skipped path="${join(dirname(root), 'air-outside.md')}" reason="outside-project"/>`)
  })

  it('leaves out a file that exceeds the byte budget and names it', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Short.')
    await write(join(root, '.claude/rules/we&ird.md'), 'x'.repeat(400))
    const { baseline } = await composeBaseline({ ...input, maxBytes: 200 })
    expect(baseline?.text).toContain('Short.')
    expect(baseline?.text).not.toContain('xxxx')
    expect(baseline?.text).toContain(`<skipped path="${join(root, '.claude/rules/we&amp;ird.md')}" reason="budget"/>`)
  })

  it('does not import a credential file named in a convention file', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory. @../.env')
    await write(join(root, '.env'), 'API_TOKEN=do-not-send')
    const { baseline } = await composeBaseline(input)
    expect(baseline?.text).not.toContain('do-not-send')
    expect(baseline?.text).toContain(`<skipped path="${join(root, '.env')}" reason="sensitive"/>`)
  })

  it('returns rule problems', async () => {
    const input = await world()
    await write(join(input.projectRoot, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    const { baseline, problems } = await composeBaseline(input)
    expect(baseline).toBeUndefined()
    expect(problems).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('refuses a seed file linked to a file outside the project', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '..', 'elsewhere.md'), 'PRIVATE CONTENT')
    await symlink(join(root, '..', 'elsewhere.md'), join(root, 'CLAUDE.md'))
    const { baseline, problems } = await composeBaseline(input)
    expect(baseline).toBeUndefined()
    expect(problems).toEqual([`${join(root, 'CLAUDE.md')} skipped: its real path is outside the allowed directory`])
  })

  it.skipIf(process.platform === 'win32')('refuses a user CLAUDE.md linked outside the Claude home', async () => {
    const input = await world()
    await write(join(input.home, 'secrets.md'), 'PRIVATE CONTENT')
    await mkdir(input.claudeHome, { recursive: true })
    await symlink(join(input.home, 'secrets.md'), join(input.claudeHome, 'CLAUDE.md'))
    const { baseline, problems } = await composeBaseline({ ...input, includeUserRoots: true })
    expect(baseline).toBeUndefined()
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('outside the allowed directory')
  })

  it.skipIf(process.platform === 'win32')('reads .claude/CLAUDE.md linked to AGENTS.md in the same project', async () => {
    const input = await world()
    await write(join(input.projectRoot, 'AGENTS.md'), 'Shared instructions.')
    await mkdir(join(input.projectRoot, '.claude'), { recursive: true })
    await symlink(join(input.projectRoot, 'AGENTS.md'), join(input.projectRoot, '.claude', 'CLAUDE.md'))
    const { baseline, problems } = await composeBaseline(input)
    expect(problems).toEqual([])
    expect(baseline?.text).toContain('Shared instructions.')
  })

  it('refuses an oversize seed file and a seed that is a directory', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, 'AGENTS.md'), 'x'.repeat(100))
    await mkdir(join(root, 'CLAUDE.md'))
    const { baseline, problems } = await composeBaseline({ ...input, maxFileBytes: 50 })
    expect(baseline).toBeUndefined()
    expect(problems).toEqual([
      `${join(root, 'AGENTS.md')} skipped: it is larger than 50 bytes`,
      `${join(root, 'CLAUDE.md')} skipped: it is not a regular file`,
    ])
  })

  it('counts skipped-import notes against the byte budget and summarises the omitted ones', async () => {
    const input = await world()
    const root = input.projectRoot
    const imports = Array.from({ length: 12 }, (_, index) => `@/outside-${index}.md`).join(' ')
    await write(join(root, 'CLAUDE.md'), `Hi. ${imports}`)
    const { baseline } = await composeBaseline({ ...input, maxBytes: 400, maxImportsPerFile: 12 })
    const text = baseline?.text ?? ''
    expect(text.match(/<skipped path=/gu)?.length).toBeLessThan(12)
    expect(text).toMatch(/<skipped reason="notes-omitted" count="\d+"\/>/u)
    const kept = text.split('\n').filter(line => line.startsWith('<skipped path=')).join('\n') + (text.includes('<file') ? text.slice(text.indexOf('<file'), text.indexOf('</file>') + 7) : '')
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(400)
  })

  it('caps the imports followed in one file', async () => {
    const input = await world()
    const root = input.projectRoot
    for (const name of ['a', 'b', 'c']) await write(join(root, `${name}.md`), `Imported ${name}.`)
    await write(join(root, 'CLAUDE.md'), 'Main. @a.md @b.md @c.md')
    const { baseline } = await composeBaseline({ ...input, maxImportsPerFile: 1 })
    expect(baseline?.text).toContain('Imported a.')
    expect(baseline?.text).not.toContain('Imported b.')
    expect(baseline?.text).toContain(`<skipped path="${join(root, 'CLAUDE.md')}" reason="import-limit"/>`)
  })
})
