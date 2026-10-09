import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as skillConventions from '../src/index.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  project: string
  home: string
  config: skillConventions.Config
}

async function world(): Promise<World> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'air-skill-')))
  created.push(base)
  const project = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  return {
    project,
    home,
    config: {
      airHome: join(home, '.air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, '.agents'),
      watchIntervalMs: 0,
    },
  }
}

/** Merge test options over a base configuration. */
function configWith(base: skillConventions.Config, extra: skillConventions.Config): skillConventions.Config {
  return Object.assign({}, base, extra)
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

function skillText(description: string, extra = '', body = 'Body.'): string {
  return `---\ndescription: ${description}\n${extra}---\n${body}\n`
}

async function mount(config: skillConventions.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(skillConventions, config)
  return { ctx, fiber }
}

async function names(ctx: Context, cwd: string | undefined): Promise<string[]> {
  return (await ctx.skills.list({ cwd })).map(skill => skill.name).sort()
}

describe('air-skill-conventions provider', () => {
  it('lists project roots and the AIR home and leaves user roots and command files out by default', async () => {
    const { project, home, config } = await world()
    await write(join(project, '.dsh/skills/alpha/SKILL.md'), skillText('Alpha', 'name: alpha\n'))
    await write(join(project, '.agents/skills/beta/SKILL.md'), skillText('Beta'))
    await write(join(project, '.claude/skills/gamma/SKILL.md'), skillText('Gamma'))
    await write(join(project, '.claude/skills/flat.md'), skillText('Flat'))
    await write(join(project, '.claude/skills/README.md'), '# Skills in this project\nNot a skill.')
    await write(join(project, '.claude/skills/notes.txt'), 'not a skill')
    await write(join(project, '.claude/skills/empty-dir/readme.txt'), 'no SKILL.md here')
    await write(join(project, '.claude/commands/frontend/component.md'), 'Create a component named $ARGUMENTS')
    await write(join(home, '.air/skills/delta.md'), skillText('Delta'))
    await write(join(home, '.agents/skills/decoy/SKILL.md'), skillText('Decoy'))
    await write(join(home, '.claude/skills/decoy-two/SKILL.md'), skillText('Decoy two'))
    const { ctx } = await mount(config)
    expect(await names(ctx, project)).toEqual(['alpha', 'beta', 'delta', 'flat', 'gamma'])
    expect(await names(ctx, undefined)).toEqual(['delta'])
  })

  it('includes the user skill roots on request', async () => {
    const { project, home, config } = await world()
    await write(join(home, '.agents/skills/shared/SKILL.md'), skillText('Shared'))
    await write(join(home, '.claude/skills/personal/SKILL.md'), skillText('Personal'))
    await write(join(home, '.claude/commands/standup.md'), 'Write my standup')
    const { ctx } = await mount(configWith(config, { includeUserRoots: true }))
    expect(await names(ctx, project)).toEqual(['personal', 'shared'])
  })

  it('scans extra project roots', async () => {
    const { project, config } = await world()
    await write(join(project, '.opencode/skills/extra/SKILL.md'), skillText('Extra'))
    const { ctx } = await mount(configWith(config, { extraProjectRoots: ['.opencode/skills'] }))
    const [skill] = await ctx.skills.list({ cwd: project })
    expect(skill).toMatchObject({ name: 'extra', source: 'project-extra', provider: 'air-conventions' })
  })

  it('lets the lower rank win a duplicate name', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/same/SKILL.md'), skillText('From claude'))
    await write(join(project, '.dsh/skills/same/SKILL.md'), skillText('From dsh'))
    const { ctx } = await mount(config)
    const [skill] = await ctx.skills.list({ cwd: project })
    expect(skill).toMatchObject({ name: 'same', description: 'From dsh', source: 'project-dsh' })
  })

  it('loads a body with the skill directory substituted and $ARGUMENTS left literal', async () => {
    const { project, config } = await world()
    const directory = join(project, '.claude/skills/tool')
    await write(join(directory, 'SKILL.md'), skillText('Tool', 'allowed-tools: Read\n', 'Run ${CLAUDE_SKILL_DIR}/run.sh with $ARGUMENTS'))
    const { ctx } = await mount(config)
    const definition = await ctx.skills.get('tool', { cwd: project })
    expect(definition).toMatchObject({
      name: 'tool',
      provider: 'air-conventions',
      source: 'project-claude',
      content: `Run ${directory}/run.sh with $ARGUMENTS`,
      resourceBase: { kind: 'directory', path: directory },
      metadata: { claudeCode: { allowedTools: ['Read'] } },
    })
  })

  it('loads a definition that has when_to_use and no metadata', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/plain/SKILL.md'), skillText('Plain', 'when_to_use: Often\n'))
    const { ctx } = await mount(config)
    const definition = await ctx.skills.get('plain', { cwd: project })
    expect(definition).toMatchObject({ whenToUse: 'Often' })
    expect(definition).not.toHaveProperty('metadata')
  })

  it('watches the AIR home for a lookup without a cwd', async () => {
    const { home, config } = await world()
    await write(join(home, '.air/skills/solo.md'), skillText('Solo'))
    const { ctx } = await mount(configWith(config, { watchIntervalMs: 20 }))
    expect(await names(ctx, undefined)).toEqual(['solo'])
  })

  it('drops a file with invalid frontmatter and keeps the rest', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/bad/SKILL.md'), '---\nname: [unclosed\n---\nBody')
    await write(join(project, '.claude/skills/good/SKILL.md'), skillText('Good', 'when_to_use: Always\n'))
    const { ctx } = await mount(config)
    const listed = await ctx.skills.list({ cwd: project })
    expect(listed.map(skill => skill.name)).toEqual(['good'])
    expect(listed[0]?.whenToUse).toBe('Always')
  })

  it('drops a skill that is neither model- nor user-invocable', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/hidden/SKILL.md'), skillText('Hidden', 'disable-model-invocation: true\nuser-invocable: false\n'))
    const { ctx } = await mount(config)
    expect(await names(ctx, project)).toEqual([])
  })

  it('removes its skills when the plugin unloads', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/gone/SKILL.md'), skillText('Gone'))
    const { ctx, fiber } = await mount(configWith(config, { watchIntervalMs: 20 }))
    expect(await names(ctx, project)).toEqual(['gone'])
    await fiber.dispose()
    expect(await names(ctx, project)).toEqual([])
  })

  it('refreshes the catalog when a watched root gains a skill', async () => {
    const { project, config } = await world()
    const { ctx } = await mount(configWith(config, { watchIntervalMs: 20 }))
    expect(await names(ctx, project)).toEqual([])
    await write(join(project, '.claude/skills/late/SKILL.md'), skillText('Late'))
    await vi.waitFor(async () => { expect(await names(ctx, project)).toEqual(['late']) }, { timeout: 5000 })
  })

  it('refreshes the catalog when a listed skill file changes', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/edited/SKILL.md')
    await write(file, skillText('First wording'))
    const { ctx } = await mount(configWith(config, { watchIntervalMs: 20 }))
    expect((await ctx.skills.list({ cwd: project }))[0]?.description).toBe('First wording')
    await write(file, skillText('Second wording, which is longer'))
    await vi.waitFor(async () => { expect((await ctx.skills.list({ cwd: project }))[0]?.description).toBe('Second wording, which is longer') }, { timeout: 5000 })
  })
})

describe('projectRootMarkers', () => {
  it('finds the project root by a configured marker instead of .git', async () => {
    const { project, config } = await world()
    await write(join(project, 'package.json'), '{}')
    await write(join(project, '.claude/skills/rooted/SKILL.md'), skillText('Rooted'))
    await mkdir(join(project, 'src/deep'), { recursive: true })
    const control = { signal: new AbortController().signal, invalidate: () => {} }
    const make = (extra: skillConventions.Config) =>
      new skillConventions.ConventionSkillProvider({ warn: () => {} }, control, skillConventions.resolveConfig(configWith(config, extra)))
    const marked = make({ projectRootMarkers: ['package.json'] })
    expect((await marked.list({ cwd: join(project, 'src/deep') })).map(skill => skill.name)).toEqual(['rooted'])
    marked.dispose()
    const missing = make({ projectRootMarkers: ['no-such-marker'] })
    expect(await missing.list({ cwd: join(project, 'src/deep') })).toEqual([])
    missing.dispose()
  })
})

describe('containment', () => {
  const control = { signal: new AbortController().signal, invalidate: () => {} }

  function providerFor(config: skillConventions.Config, warn: (text: string) => void, extra: skillConventions.Config = {}) {
    return new skillConventions.ConventionSkillProvider({ warn }, control, skillConventions.resolveConfig(configWith(config, extra)))
  }

  it.skipIf(process.platform === 'win32')('refuses a SKILL.md linked to a file outside the project and warns once', async () => {
    const { project, config } = await world()
    await write(join(project, '..', 'private.md'), skillText('Private'))
    await mkdir(join(project, '.claude/skills/leak'), { recursive: true })
    await symlink(join(project, '..', 'private.md'), join(project, '.claude/skills/leak/SKILL.md'))
    const warn = vi.fn()
    const provider = providerFor(config, warn)
    expect(await provider.list({ cwd: project })).toEqual([])
    expect(await provider.list({ cwd: project })).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe(`air-skill-conventions: ${join(project, '.claude/skills/leak/SKILL.md')} skipped: its real path is outside the allowed directory`)
    provider.dispose()
  })

  it.skipIf(process.platform === 'win32')('refuses a flat skill file and a skill directory linked outside the project', async () => {
    const { project, config } = await world()
    await write(join(project, '..', 'private.md'), skillText('Private'))
    await write(join(project, '..', 'outside-dir/SKILL.md'), skillText('Outside'))
    await mkdir(join(project, '.claude/skills'), { recursive: true })
    await symlink(join(project, '..', 'private.md'), join(project, '.claude/skills/flat.md'))
    await symlink(join(project, '..', 'outside-dir'), join(project, '.claude/skills/dir'))
    const warn = vi.fn()
    const provider = providerFor(config, warn)
    expect(await provider.list({ cwd: project })).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
    provider.dispose()
  })

  it.skipIf(process.platform === 'win32')('keeps a skill linked to a directory inside the project', async () => {
    const { project, config } = await world()
    await write(join(project, 'shared/real/SKILL.md'), skillText('Real'))
    await mkdir(join(project, '.claude/skills'), { recursive: true })
    await symlink(join(project, 'shared/real'), join(project, '.claude/skills/real'))
    const provider = providerFor(config, () => {})
    expect((await provider.list({ cwd: project })).map(skill => skill.name)).toEqual(['real'])
    provider.dispose()
  })

  it.skipIf(process.platform === 'win32')('refuses a user skill linked outside its user root', async () => {
    const { project, home, config } = await world()
    await write(join(home, 'elsewhere.md'), skillText('Elsewhere'))
    await mkdir(join(home, '.claude/skills'), { recursive: true })
    await symlink(join(home, 'elsewhere.md'), join(home, '.claude/skills/x.md'))
    const warn = vi.fn()
    const provider = providerFor(config, warn, { includeUserRoots: true })
    expect(await provider.list({ cwd: project })).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    provider.dispose()
  })

  it('refuses an oversize skill file with a warning and ignores a SKILL.md directory', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/big/SKILL.md'), skillText('Big', '', 'x'.repeat(400)))
    await write(join(project, '.claude/skills/fine/SKILL.md'), skillText('Fine'))
    await mkdir(join(project, '.claude/skills/dirskill/SKILL.md'), { recursive: true })
    const warn = vi.fn()
    const provider = providerFor(config, warn, { maxFileBytes: 200 })
    expect((await provider.list({ cwd: project })).map(skill => skill.name)).toEqual(['fine'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('larger than 200 bytes')
    provider.dispose()
  })

  it('reports a root that reaches the entry cap', async () => {
    const { project, config } = await world()
    for (const name of ['a', 'b', 'c']) await write(join(project, `.claude/skills/${name}.md`), skillText(name))
    const warn = vi.fn()
    const provider = providerFor(config, warn, { maxWalkEntries: 2 })
    expect(await provider.list({ cwd: project })).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(`air-skill-conventions: ${join(project, '.claude/skills')} listing stopped after 2 entries; later entries were not read`)
    provider.dispose()
  })
})

describe('ConventionSkillProvider.get', () => {
  const control = { signal: new AbortController().signal, invalidate: () => {} }

  it('returns undefined for a candidate it did not create and for a deleted file', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/temp/SKILL.md')
    await write(file, skillText('Temp'))
    const provider = new skillConventions.ConventionSkillProvider({ warn: () => {} }, control, skillConventions.resolveConfig(config))
    const [candidate] = await provider.list({ cwd: project })
    if (candidate === undefined) throw new Error('expected one candidate')
    const foreign: SkillCandidate = { ...candidate, locator: 'not-a-locator' }
    expect(await provider.get(foreign)).toBeUndefined()
    await rm(file)
    expect(await provider.get(candidate)).toBeUndefined()
    provider.dispose()
  })
})

describe('ConventionSkillProvider change notification', () => {
  it('logs a failing invalidate callback', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/temp/SKILL.md')
    await write(file, skillText('Temp'))
    const warn = vi.fn()
    const invalidate = (): void => { throw new Error('boom') }
    const control = { signal: new AbortController().signal, invalidate }
    const resolved = skillConventions.resolveConfig(configWith(config, { watchIntervalMs: 20 }))
    const provider = new skillConventions.ConventionSkillProvider({ warn }, control, resolved)
    await provider.list({ cwd: project })
    await write(file, skillText('Temp with a longer description'))
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom')) }, { timeout: 5000 })
    provider.dispose()
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    const homes = { airHome: resolve(sep, 'a'), claudeHome: resolve(sep, 'c'), agentsHome: resolve(sep, 'g') }
    expect(skillConventions.resolveConfig(homes)).toEqual({
      providerName: 'air-conventions',
      homes,
      includeUserRoots: false,
      extraProjectRoots: [],
      projectRootMarkers: ['.git'],
      maxFileBytes: 262144,
      maxWalkEntries: 2000,
      descriptionMaxChars: 1500,
      watchIntervalMs: 3000,
      watchMaxProjects: 32,
    })
  })

  it('rejects invalid values', () => {
    expect(() => skillConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
    expect(() => skillConventions.resolveConfig({ descriptionMaxChars: 0 })).toThrow('descriptionMaxChars must be a positive integer')
    expect(() => skillConventions.resolveConfig({ maxFileBytes: 0 })).toThrow('maxFileBytes must be a positive integer')
    expect(() => skillConventions.resolveConfig({ maxWalkEntries: 0.5 })).toThrow('maxWalkEntries must be a positive integer')
    expect(() => skillConventions.resolveConfig({ watchIntervalMs: -1 })).toThrow('watchIntervalMs must be a non-negative integer')
    expect(() => skillConventions.resolveConfig({ watchMaxProjects: 0.5 })).toThrow('watchMaxProjects must be a positive integer')
    for (const root of ['/abs', 'C:\\abs', 'a/../../b', 'a\\..\\..\\b']) {
      expect(() => skillConventions.resolveConfig({ extraProjectRoots: [root] })).toThrow('must be a relative path inside the project')
    }
  })
})
