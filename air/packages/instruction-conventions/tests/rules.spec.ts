import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadClaudeRules, matchingRules } from '../src/rules.ts'

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
