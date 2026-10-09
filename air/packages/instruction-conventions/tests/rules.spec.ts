import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadClaudeRules as load, matchingRules, type RuleCache, type RuleLimits } from '../src/rules.ts'

const LIMITS: RuleLimits = { maxFileBytes: 4096, maxEntries: 500 }

function loadClaudeRules(root: string, limits: RuleLimits = LIMITS, cache?: RuleCache): ReturnType<typeof load> {
  return load(root, limits, cache)
}

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-rules-'))
  created.push(dir)
  return dir
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('loadClaudeRules', () => {
  it('loads always rules and path-scoped rules from nested directories', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/general.md'), 'Be concise.\n')
    await write(join(root, '.claude/rules/frontend/ts.md'), '---\npaths:\n  - "**/*.ts"\n  - "web/**"\n---\nUse strict TypeScript.\n')
    await write(join(root, '.claude/rules/py.md'), '---\npaths: "**/*.py"\n---\nUse type hints.\n')
    const { rules, problems } = await loadClaudeRules(root)
    expect(problems).toEqual([])
    expect(rules.map(rule => ({ relativePath: rule.relativePath, globs: rule.globs, content: rule.content }))).toEqual([
      { relativePath: '.claude/rules/frontend/ts.md', globs: ['**/*.ts', 'web/**'], content: 'Use strict TypeScript.' },
      { relativePath: '.claude/rules/general.md', globs: [], content: 'Be concise.' },
      { relativePath: '.claude/rules/py.md', globs: ['**/*.py'], content: 'Use type hints.' },
    ])
    expect(rules[0]?.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect(rules[0]?.path).toBe(join(root, '.claude/rules/frontend/ts.md'))
  })

  it('reports an unparsable rule file and skips an empty one', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    await write(join(root, '.claude/rules/empty.md'), '---\npaths: "**/*.md"\n---\n\n')
    const { rules, problems } = await loadClaudeRules(root)
    expect(rules).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(join(root, '.claude/rules/bad.md'))
  })

  it('returns nothing for a project without rules', async () => {
    expect(await loadClaudeRules(await project())).toEqual({ rules: [], problems: [] })
  })
})

describe('loadClaudeRules containment', () => {
  async function outsideFile(root: string, name = 'secret.md'): Promise<string> {
    const outside = join(root, '..', `${name}-outside`)
    await write(outside, 'PRIVATE CONTENT')
    return outside
  }

  it.skipIf(process.platform === 'win32')('refuses a rule file linked to a file outside the project', async () => {
    const root = join(await project(), 'proj')
    await mkdir(join(root, '.claude/rules'), { recursive: true })
    await symlink(await outsideFile(root), join(root, '.claude/rules/x.md'))
    const { rules, problems } = await loadClaudeRules(root)
    expect(rules).toEqual([])
    expect(problems).toEqual([`${join(root, '.claude/rules/x.md')} skipped: its real path is outside the allowed directory`])
    expect(problems.join()).not.toContain('PRIVATE')
  })

  it.skipIf(process.platform === 'win32')('does not walk a rules directory linked outside the project', async () => {
    const root = join(await project(), 'proj')
    await mkdir(join(root, '.claude/rules'), { recursive: true })
    const outside = join(root, '..', 'docs-outside')
    await write(join(outside, 'a.md'), 'PRIVATE CONTENT')
    await symlink(outside, join(root, '.claude/rules/d'))
    const { rules, problems } = await loadClaudeRules(root)
    expect(rules).toEqual([])
    expect(problems).toEqual([`${join(root, '.claude/rules/d')} skipped: its real path is outside the allowed directory`])
  })

  it.skipIf(process.platform === 'win32')('reads a rule linked to a file inside the project', async () => {
    const root = await project()
    await write(join(root, 'docs/shared.md'), 'Shared rule.')
    await mkdir(join(root, '.claude/rules'), { recursive: true })
    await symlink(join(root, 'docs/shared.md'), join(root, '.claude/rules/shared.md'))
    const { rules, problems } = await loadClaudeRules(root)
    expect(problems).toEqual([])
    expect(rules.map(rule => rule.content)).toEqual(['Shared rule.'])
  })

  it.skipIf(process.platform === 'win32')('terminates on a link loop', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/a.md'), 'Rule A.')
    await symlink('.', join(root, '.claude/rules/loop'))
    const { rules, problems } = await loadClaudeRules(root)
    expect(problems).toEqual([])
    expect(rules.map(rule => rule.content)).toEqual(['Rule A.'])
  })

  it.skipIf(process.platform === 'win32')('refuses an in-project link to a credential file', async () => {
    const root = await project()
    await write(join(root, '.env'), 'TOKEN=1')
    await mkdir(join(root, '.claude/rules'), { recursive: true })
    await symlink(join(root, '.env'), join(root, '.claude/rules/env.md'))
    const { rules, problems } = await loadClaudeRules(root)
    expect(rules).toEqual([])
    expect(problems).toEqual([`${join(root, '.claude/rules/env.md')} skipped: it looks like a credential file`])
  })

  it('refuses an oversize rule file', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/big.md'), 'x'.repeat(100))
    const { rules, problems } = await loadClaudeRules(root, { maxFileBytes: 50, maxEntries: 500 })
    expect(rules).toEqual([])
    expect(problems).toEqual([`${join(root, '.claude/rules/big.md')} skipped: it is larger than 50 bytes`])
  })

  it('reports a walk that reaches the entry cap', async () => {
    const root = await project()
    for (const name of ['a', 'b', 'c']) await write(join(root, `.claude/rules/${name}.md`), name)
    const { rules, problems } = await loadClaudeRules(root, { maxFileBytes: 4096, maxEntries: 2 })
    expect(rules.map(rule => rule.content)).toEqual(['a', 'b'])
    expect(problems).toEqual([`${join(root, '.claude/rules')} listing stopped after 2 entries; later entries were not read`])
  })

  it('drops the cache entry of a deleted rule file', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/a.md'), 'A')
    const cache: RuleCache = new Map()
    expect((await loadClaudeRules(root, LIMITS, cache)).rules).toHaveLength(1)
    await rm(join(root, '.claude/rules/a.md'))
    expect((await loadClaudeRules(root, LIMITS, cache)).rules).toEqual([])
    expect(cache.size).toBe(0)
  })
})

describe('loadClaudeRules cache', () => {
  it('reuses the parsed rule of an unchanged file and picks up an edit', async () => {
    const root = await project()
    const file = join(root, '.claude/rules/a.md')
    await write(file, 'First.')
    const cache: RuleCache = new Map()
    const first = (await loadClaudeRules(root, LIMITS, cache)).rules[0]
    const again = (await loadClaudeRules(root, LIMITS, cache)).rules[0]
    expect(again).toBe(first)
    await write(file, 'Second text.')
    await utimes(file, new Date(), new Date(Date.now() + 5000))
    const edited = (await loadClaudeRules(root, LIMITS, cache)).rules[0]
    expect(edited?.content).toBe('Second text.')
  })

  it('keeps reporting a cached problem without reading the file again', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    const cache: RuleCache = new Map()
    const first = await loadClaudeRules(root, LIMITS, cache)
    const second = await loadClaudeRules(root, LIMITS, cache)
    expect(second.problems).toEqual(first.problems)
    expect(second.problems).toHaveLength(1)
  })
})


describe('matchingRules', () => {
  it('returns path-scoped rules whose globs match the project-relative path', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/general.md'), 'Always.')
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nTypeScript.')
    await write(join(root, '.claude/rules/dot.md'), '---\npaths: ".github/**"\n---\nWorkflows.')
    const { rules } = await loadClaudeRules(root)
    expect(matchingRules(rules, 'src/deep/a.ts').map(rule => rule.content)).toEqual(['TypeScript.'])
    expect(matchingRules(rules, '.github/workflows/ci.yml').map(rule => rule.content)).toEqual(['Workflows.'])
    expect(matchingRules(rules, 'README.md')).toEqual([])
  })
})
