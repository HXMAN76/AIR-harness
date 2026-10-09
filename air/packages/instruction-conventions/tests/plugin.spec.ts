import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as instructionConventions from '../src/index.ts'
import { loadClaudeRules } from '../src/rules.ts'
import { provideWorkingDirectory, stubAgent } from './harness.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'air-instructions-')))
  created.push(base)
  await mkdir(join(base, '.git'))
  return base
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

// Test doubles follow the `defineTool` form verified in spike 01; each is written out so the
// parameter names stay literal types.
function registerTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Test double for read.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'File to read' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.resolve('done')
    },
  }))
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Test double for write that always fails.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'File to write' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.reject<string>(new Error('disk full'))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Test double for bash.',
    parameters: {
      command: { type: 'string', required: true, description: 'Command line' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.resolve('done')
    },
  }))
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  provideWorkingDirectory(ctx)
  await ctx.plugin(instructionConventions, { maxBytes: 32768, claudeHome: '/air-test-no-such-home/.claude' })
  registerTools(ctx)
  return ctx
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function preStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
  options: { step?: number; decision?: PreStepDecision; signal?: AbortSignal } = {},
): Promise<PreStepDecision> {
  return ctx.waterfall(
    'agent/pre-step',
    { agent, messages, turn: 1, step: options.step ?? 1, signal: options.signal ?? new AbortController().signal },
    () => Promise.resolve<PreStepDecision>(options.decision ?? { kind: 'enter', messages }),
  )
}

function entered(decision: PreStepDecision): UserMessage[] {
  if (decision.kind !== 'enter') throw new Error('expected the step to enter')
  return decision.messages
}

let calls = 0
function run(ctx: Context, name: string, args: Record<string, string>, agent?: Agent) {
  calls += 1
  return ctx.tools.execute({
    name,
    arguments: args,
    callId: ToolCallId(`air-call-${calls}`),
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
}

describe('baseline injection on agent/pre-step', () => {
  it('reads the baseline from the working directory, not the original session directory', async () => {
    const original = await project()
    const current = await project()
    await write(join(original, '.claude/CLAUDE.md'), 'Original memory.')
    await write(join(current, '.claude/CLAUDE.md'), 'Moved memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, original, current)
    const block = entered(await preStep(ctx, agent, [prompt('hello')]))[1]?.content[0]
    const text = block?.type === 'text' ? block.text : ''
    expect(text).toContain('Moved memory.')
    expect(text).not.toContain('Original memory.')
  })

  it('adds one air-instructions message after the claimed prompt', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const first = prompt('hello')
    const messages = entered(await preStep(ctx, agent, [first]))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBe(first)
    expect(messages[1]?.source).toMatchObject({ kind: 'air-instructions', form: 'instructions', baseline: true })
    const block = messages[1]?.content[0]
    expect(messages[1]?.content).toHaveLength(1)
    expect(block?.type === 'text' ? block.text : '').toContain('Project memory.')
  })

  it('does not repeat a baseline that the session already holds, and repeats it after the files change', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const [, baseline] = entered(await preStep(ctx, agent, [prompt('one')]))
    if (baseline === undefined) throw new Error('expected a baseline message')
    agent.session.append('user/message', baseline, { surfaceOp: 'append' })
    expect(entered(await preStep(ctx, agent, [prompt('two')]))).toHaveLength(1)
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory, revised.')
    const refreshed = entered(await preStep(ctx, agent, [prompt('three')]))
    expect(refreshed).toHaveLength(2)
    expect(refreshed[1]?.source).not.toEqual(baseline.source)
  })

  it('leaves the decision unchanged when there is nothing to add', async () => {
    const root = await project()
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const only = prompt('hello')
    expect(entered(await preStep(ctx, agent, [only]))).toEqual([only])
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    expect(await preStep(ctx, agent, [only], { decision: { kind: 'reject' } })).toEqual({ kind: 'reject' })
    expect(entered(await preStep(ctx, agent, [], { step: 1 }))).toEqual([])
    const { agent: detached } = stubAgent(ctx, undefined)
    expect(entered(await preStep(ctx, detached, [only]))).toEqual([only])
  })

  it('reads the convention files at step 1 only, once per turn', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const later = prompt('later step')
    expect(entered(await preStep(ctx, agent, [later], { step: 2 }))).toEqual([later])
    expect(entered(await preStep(ctx, agent, [later], { step: 1 }))).toHaveLength(2)
  })

  it('lets the turn continue when a convention file cannot be read', async () => {
    const ctx = await mount()
    const { agent } = stubAgent(ctx, resolve(sep, 'bad\0cwd'))
    const only = prompt('hello')
    expect(entered(await preStep(ctx, agent, [only]))).toEqual([only])
  })

  it('stops when the turn was cancelled while files were read', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const controller = new AbortController()
    controller.abort(new Error('turn cancelled'))
    await expect(preStep(ctx, agent, [prompt('hello')], { signal: controller.signal })).rejects.toThrow('turn cancelled')
  })

  it('keeps working when a rule file does not parse', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    await write(join(root, '.claude/rules/good.md'), 'Be concise.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    expect(entered(await preStep(ctx, agent, [prompt('one')]))).toHaveLength(2)
    expect(entered(await preStep(ctx, agent, [prompt('two')]))).toHaveLength(2)
  })
})

describe('path-scoped rules on tools/post-execute', () => {
  async function scoped(): Promise<{ ctx: Context; root: string }> {
    const root = await project()
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nUse strict TypeScript.')
    return { ctx: await mount(), root }
  }

  it('matches rules from the working directory, not the original session directory', async () => {
    const original = await project()
    const { ctx, root: current } = await scoped()
    const { agent } = stubAgent(ctx, original, current)
    const result = await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)
    expect(result.additionalContexts).toHaveLength(1)
    const block = result.additionalContexts?.[0]?.content[0]
    expect(block?.type === 'text' ? block.text : '').toContain('Use strict TypeScript.')
  })

  it('attaches a matching rule once per session', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const first = await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)
    expect(first.isError).toBe(false)
    expect(first.additionalContexts).toHaveLength(1)
    const context = first.additionalContexts?.[0]
    expect(context?.source).toMatchObject({ kind: 'air-instructions', form: 'instructions', rule: '.claude/rules/ts.md' })
    expect(context?.content).toEqual([{
      type: 'text',
      text: '<air_rule path=".claude/rules/ts.md">\nUse strict TypeScript.\n</air_rule>',
    }])
    const second = await run(ctx, 'read', { file_path: join(root, 'src/b.ts') }, agent)
    expect(second.additionalContexts).toBeUndefined()
  })

  it('does not attach a rule the resumed session already holds', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const [rule] = (await loadClaudeRules(root, { maxFileBytes: 4096, maxEntries: 500 })).rules
    if (rule === undefined) throw new Error('expected one rule')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'earlier rule text' }],
      source: { kind: 'air-instructions', form: 'instructions', rule: rule.relativePath, digest: rule.digest },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', prompt('unrelated'), { surfaceOp: 'append' })
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)).additionalContexts).toBeUndefined()
  })

  it('attaches nothing for other tools, other files, failures, and calls without a workspace', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const { agent: detached } = stubAgent(ctx, undefined)
    expect((await run(ctx, 'bash', { command: 'ls src/a.ts' }, agent)).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'README.md' }, agent)).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: resolve(root, '..', 'air-outside', 'a.ts') }, agent)).additionalContexts).toBeUndefined()
    const failed = await run(ctx, 'write', { file_path: 'src/a.ts' }, agent)
    expect(failed.isError).toBe(true)
    expect(failed.additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' })).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' }, detached)).additionalContexts).toBeUndefined()
  })
})

describe('resolveConfig', () => {
  it('applies defaults and expands allowed import roots', () => {
    const claudeHome = resolve(sep, 'c')
    const shared = resolve(sep, 'shared')
    const resolved = instructionConventions.resolveConfig({ maxBytes: 100, claudeHome, allowedImportRoots: [shared] })
    expect(resolved).toMatchObject({
      maxBytes: 100,
      claudeHome,
      includeUserRoots: false,
      allowedImportRoots: [shared],
      projectRootMarkers: ['.git'],
      maxFileBytes: 262144,
      maxWalkEntries: 2000,
      maxImportsPerFile: 32,
    })
    expect(instructionConventions.resolveConfig({ maxBytes: 1, allowedImportRoots: ['~/notes'] }).allowedImportRoots).toEqual([join(homedir(), 'notes')])
  })

  it('rejects invalid values', () => {
    expect(() => instructionConventions.resolveConfig({ maxBytes: 0 })).toThrow('maxBytes must be a positive integer')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, maxFileBytes: 0 })).toThrow('maxFileBytes must be a positive integer')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, maxWalkEntries: 1.5 })).toThrow('maxWalkEntries must be a positive integer')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, maxImportsPerFile: -1 })).toThrow('maxImportsPerFile must be a positive integer')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, allowedImportRoots: ['relative/dir'] })).toThrow('must be an absolute path or start with ~/')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
