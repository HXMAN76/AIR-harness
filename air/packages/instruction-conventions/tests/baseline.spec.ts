import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
})
