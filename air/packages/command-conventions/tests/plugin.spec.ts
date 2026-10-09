import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import * as commandConventions from '../src/index.ts'
import { stubAgent, type StubAgent } from './harness.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  home: string
  config: commandConventions.Config
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-commands-'))
  created.push(base)
  const root = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(root, '.git'), { recursive: true })
  return { root, home, config: { airHome: join(home, '.air'), claudeHome: join(home, '.claude') } }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

async function mount(config: commandConventions.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.commands.register({ name: 'compact', description: 'Host command', handler: () => ({ kind: 'success' }) })
  const fiber = await ctx.plugin(commandConventions, config)
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined): Promise<StubAgent> {
  const stub = stubAgent(ctx, cwd)
  await ctx.agents.register(stub.agent)
  return stub
}

function names(ctx: Context, stub: StubAgent): string[] {
  return ctx.commands.list(stub.agent).map(command => command.name)
}

async function command(ctx: Context, stub: StubAgent, line: string) {
  const execution = await ctx.commands.execute(stub.agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
  return execution.result
}

describe('air-command-conventions', () => {
  it('registers project command files for the Agent with description and hint', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/fix-issue.md'), '---\ndescription: Fix a GitHub issue\nargument-hint: "[issue] [priority]"\n---\nFix issue $ARGUMENTS.')
    await write(join(root, '.claude/commands/frontend/component.md'), '# Create a component\nName it $0.')
    await write(join(root, '.claude/commands/terse.md'), '#\nDo the thing.')
    await write(join(root, '.claude/commands/long.md'), 'x'.repeat(200))
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(ctx.commands.list(stub.agent)).toEqual([
      { name: 'compact', description: 'Host command' },
      { name: 'fix-issue', description: 'Fix a GitHub issue', input: { hint: '[issue] [priority]' } },
      { name: 'frontend-component', description: 'Create a component', input: { hint: '[arguments]' } },
      { name: 'long', description: `${'x'.repeat(119)}…`, input: { hint: '[arguments]' } },
      { name: 'terse', description: 'Project command file', input: { hint: '[arguments]' } },
    ])
  })

  it('sends the substituted body to the model as an air-command message', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/fix-issue.md'), '---\narguments: issue priority\n---\nFix issue $issue with priority $priority.\nAll: $ARGUMENTS')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(await command(ctx, stub, '/fix-issue 123 high')).toEqual({ kind: 'success', text: 'Sent /fix-issue to the model.' })
    expect(stub.followups).toHaveLength(1)
    expect(stub.followups[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Fix issue 123 with priority high.\nAll: 123 high' }],
      source: { kind: 'air-command', name: 'fix-issue', form: 'instructions' },
    })
  })

  it('counts positional placeholders from the configured base', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/greet.md'), 'Greet $1.')
    const { ctx } = await mount(Object.assign({}, config, { positionalBase: 1 }))
    const stub = await live(ctx, root)
    await command(ctx, stub, '/greet Ada')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Greet Ada.' }])
  })

  it('reads the latest file content and reports a deleted file', async () => {
    const { root, config } = await world()
    const file = join(root, '.claude/commands/review.md')
    await write(file, 'Review the diff.')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    await write(file, 'Review the diff carefully.')
    await command(ctx, stub, '/review')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Review the diff carefully.' }])
    await rm(file)
    expect(await command(ctx, stub, '/review')).toEqual({ kind: 'error', text: `/review: ${file} can no longer be read.` })
    expect(stub.followups).toHaveLength(1)
  })

  it('prefers project files over the AIR home and reads user files only on request', async () => {
    const { root, home, config } = await world()
    await write(join(root, '.claude/commands/deploy.md'), 'Project deploy.')
    await write(join(home, '.air/commands/deploy.md'), 'AIR home deploy.')
    await write(join(home, '.air/commands/standup.md'), 'AIR home standup.')
    await write(join(home, '.claude/commands/personal.md'), 'Personal command.')
    const first = await mount(config)
    const stub = await live(first.ctx, root)
    expect(names(first.ctx, stub)).toEqual(['compact', 'deploy', 'standup'])
    await command(first.ctx, stub, '/deploy')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Project deploy.' }])
    const second = await mount(Object.assign({}, config, { includeUserRoots: true }))
    expect(names(second.ctx, await live(second.ctx, root))).toEqual(['compact', 'deploy', 'personal', 'standup'])
  })

  it('skips files it cannot register and never shadows an existing command', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/123.md'), 'Starts with a digit.')
    await write(join(root, '.claude/commands/+++.md'), 'No usable name.')
    await write(join(root, '.claude/commands/compact.md'), 'Tries to replace a host command.')
    await write(join(root, '.claude/commands/broken.md'), '---\narguments: [unclosed\n---\nBody')
    await write(join(root, '.claude/commands/empty.md'), '---\ndescription: Nothing here\n---\n\n')
    await write(join(root, '.claude/commands/good.md'), 'Works.')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(names(ctx, stub)).toEqual(['compact', 'good'])
    expect(await command(ctx, stub, '/compact')).toEqual({ kind: 'success' })
  })

  it('does not fail Agent creation when a command folder cannot be read', async () => {
    const { config } = await world()
    const { ctx } = await mount(config)
    const stub = await live(ctx, resolve(sep, 'bad\0cwd'))
    expect(names(ctx, stub)).toEqual(['compact'])
  })

  it('scopes commands to the Agent and removes them on disposal and unload', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/local.md'), 'Local.')
    const other = await world()
    const { ctx, fiber } = await mount(config)
    const here = await live(ctx, root)
    const there = await live(ctx, other.root)
    const detached = await live(ctx, undefined)
    const again = await live(ctx, root)
    expect(names(ctx, here)).toEqual(['compact', 'local'])
    expect(names(ctx, there)).toEqual(['compact'])
    expect(names(ctx, detached)).toEqual(['compact'])
    ctx.emit('agent/disposed', { agent: here.agent })
    ctx.emit('agent/disposed', { agent: there.agent })
    await vi.waitFor(() => { expect(names(ctx, here)).toEqual(['compact']) }, { timeout: 5000 })
    expect(names(ctx, again)).toEqual(['compact', 'local'])
    await fiber.dispose()
    expect(names(ctx, again)).toEqual(['compact'])
  })
})

describe('containment', () => {
  it.skipIf(process.platform === 'win32')('refuses a command file linked to a file outside the project', async () => {
    const { root, config } = await world()
    await write(join(root, '..', 'private.md'), 'PRIVATE CONTENT')
    await mkdir(join(root, '.claude/commands'), { recursive: true })
    await symlink(join(root, '..', 'private.md'), join(root, '.claude/commands/leak.md'))
    await write(join(root, '.claude/commands/ok.md'), 'Fine.')
    const { ctx } = await mount(config)
    const warn = vi.spyOn(ctx.logger, 'warn')
    const stub = await live(ctx, root)
    expect(names(ctx, stub)).toEqual(['compact', 'ok'])
    expect(warn).toHaveBeenCalledWith(`air-command-conventions: ${join(root, '.claude/commands/leak.md')} skipped: its real path is outside the allowed directory`)
  })

  it.skipIf(process.platform === 'win32')('does not walk a commands directory linked outside the project', async () => {
    const { root, config } = await world()
    await write(join(root, '..', 'outside/secret.md'), 'PRIVATE CONTENT')
    await mkdir(join(root, '.claude/commands'), { recursive: true })
    await symlink(join(root, '..', 'outside'), join(root, '.claude/commands/team'))
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(names(ctx, stub)).toEqual(['compact'])
  })

  it.skipIf(process.platform === 'win32')('keeps a command linked to a file inside the project and ends link loops', async () => {
    const { root, config } = await world()
    await write(join(root, 'docs/review.md'), 'Review it.')
    await mkdir(join(root, '.claude/commands'), { recursive: true })
    await symlink(join(root, 'docs/review.md'), join(root, '.claude/commands/review.md'))
    await symlink('.', join(root, '.claude/commands/loop'))
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(names(ctx, stub)).toEqual(['compact', 'review'])
  })

  it.skipIf(process.platform === 'win32')('refuses a user command linked outside the Claude home', async () => {
    const { root, home, config } = await world()
    await write(join(home, 'elsewhere.md'), 'PRIVATE CONTENT')
    await mkdir(join(home, '.claude/commands'), { recursive: true })
    await symlink(join(home, 'elsewhere.md'), join(home, '.claude/commands/x.md'))
    const { ctx } = await mount(Object.assign({}, config, { includeUserRoots: true }))
    expect(names(ctx, await live(ctx, root))).toEqual(['compact'])
  })

  it('refuses an oversize command file and reports a walk that reaches the entry cap', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/big.md'), 'x'.repeat(100))
    await write(join(root, '.claude/commands/small.md'), 'ok')
    await write(join(root, '.claude/commands/z.md'), 'never listed')
    const { ctx } = await mount(Object.assign({}, config, { maxFileBytes: 50, maxWalkEntries: 2 }))
    const warn = vi.spyOn(ctx.logger, 'warn')
    expect(names(ctx, await live(ctx, root))).toEqual(['compact', 'small'])
    expect(warn).toHaveBeenCalledWith(`air-command-conventions: ${join(root, '.claude/commands/big.md')} skipped: it is larger than 50 bytes`)
    expect(warn).toHaveBeenCalledWith(`air-command-conventions: ${join(root, '.claude/commands')} listing stopped after 2 entries; later entries were not read`)
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    expect(commandConventions.resolveConfig({ airHome: resolve(sep, 'a'), claudeHome: resolve(sep, 'c') })).toMatchObject({
      homes: { airHome: resolve(sep, 'a'), claudeHome: resolve(sep, 'c') },
      includeUserRoots: false,
      projectRootMarkers: ['.git'],
      maxFileBytes: 262144,
      maxWalkEntries: 2000,
      positionalBase: 0,
    })
  })

  it('rejects invalid values', () => {
    expect(() => commandConventions.resolveConfig({ positionalBase: 2 })).toThrow('positionalBase must be 0 or 1')
    expect(() => commandConventions.resolveConfig({ maxFileBytes: 0 })).toThrow('maxFileBytes must be a positive integer')
    expect(() => commandConventions.resolveConfig({ maxWalkEntries: 1.5 })).toThrow('maxWalkEntries must be a positive integer')
    expect(() => commandConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
