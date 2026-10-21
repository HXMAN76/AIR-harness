import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolOpen from '../src/index.ts'
import type { ExecLike } from '../src/exec.ts'

const cleanups: (() => Promise<unknown>)[] = []
let calls = 0

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function mount(fake?: ExecLike): Promise<{ ctx: Context; targets: string[] }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const targets: string[] = []
  if (fake === undefined) {
    ctx.tools.register(toolOpen.openTool(async (_file, _args, env) => void targets.push(env.AIR_OP_TARGET ?? '')))
  } else {
    ctx.tools.register(toolOpen.openTool(fake))
  }
  return { ctx, targets }
}

function call(ctx: Context, args: unknown): Promise<{ isError?: boolean; content: unknown }> {
  calls += 1
  return ctx.tools.execute({ name: 'open', arguments: args, callId: ToolCallId(`call-${calls}`), signal: new AbortController().signal })
}

describe('open tool', () => {
  it('registers one tool with a one-line description and the app, url, search schema', async () => {
    const { ctx } = await mount()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'open')
    expect(schema?.description).toBe('Open an app, website, or Google search on the PC. Prefer this to pwsh for opening.')
    expect(schema?.parameters).toMatchObject({
      required: ['kind', 'value'],
      properties: { kind: { enum: ['app', 'url', 'search'] }, value: { type: 'string' } },
    })
  })

  it('opens a whitelisted app', async () => {
    const { ctx, targets } = await mount()
    const result = await call(ctx, { kind: 'app', value: ' Notepad ' })
    expect(result.content).toEqual([{ type: 'text', text: 'Opened Notepad.' }])
    expect(targets).toEqual(['notepad.exe'])
  })

  it('opens a site by name, by domain, or by https URL', async () => {
    const { ctx, targets } = await mount()
    await call(ctx, { kind: 'url', value: 'youtube' })
    await call(ctx, { kind: 'url', value: 'example.org' })
    const result = await call(ctx, { kind: 'url', value: 'https://news.ycombinator.com/item?id=1' })
    expect(result.content).toEqual([{ type: 'text', text: 'Opened https://news.ycombinator.com/item?id=1.' }])
    expect(targets).toEqual(['https://www.youtube.com', 'https://example.org', 'https://news.ycombinator.com/item?id=1'])
  })

  it('searches Google with an encoded query', async () => {
    const { ctx, targets } = await mount()
    const result = await call(ctx, { kind: 'search', value: "x'; Remove-Item C:\\" })
    expect(result.content).toEqual([{ type: 'text', text: "Opened a Google search for x'; Remove-Item C:\\." }])
    expect(targets).toEqual(['https://www.google.com/search?q=x%27%3B%20Remove-Item%20C%3A%5C'])
  })

  it.each([
    [{ kind: 'app', value: 'powershell' }, /Unknown app .{1,6}powershell.{1,6} Known apps: notepad, calculator/],
    [{ kind: 'url', value: 'http://example.com' }, /Cannot open .{1,6}http:\/\/example\.com/],
    [{ kind: 'url', value: "https://a.com/'x" }, /Cannot open/],
    [{ kind: 'url', value: 'notepad.exe' }, /Cannot open/],
  ])('refuses %j without running anything', async (args, message) => {
    const { ctx, targets } = await mount()
    const result = await call(ctx, args)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(message)
    expect(targets).toEqual([])
  })

  it('rejects invalid arguments', async () => {
    const { ctx } = await mount()
    expect((await call(ctx, { kind: 'file', value: 'x' })).isError).toBe(true)
    expect((await call(ctx, { kind: 'app' })).isError).toBe(true)
  })

  it('reports a failed start as an error result', async () => {
    const { ctx } = await mount(async () => {
      throw new Error('boom')
    })
    const result = await call(ctx, { kind: 'app', value: 'notepad' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('boom')
  })

  it('registers nothing when disabled', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(toolOpen, { enabled: false })
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('open')
  })

  it('registers the tool through the plugin with the default runner', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(toolOpen, { enabled: true })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('open')
  })
})
