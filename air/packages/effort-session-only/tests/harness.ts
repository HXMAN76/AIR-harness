import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** One profile write the fake editor received. */
export interface Written {
  readonly entryId: string
  readonly config: unknown
}

export interface World {
  readonly ctx: Context
  readonly written: Written[]
  /** Reject every following profile write with this error. */
  failWith: (error: Error) => void
  readonly close: () => Promise<void>
}

/**
 * Boot upstream's real `agent-default-model` row through the Loader, with a recording editor in place of
 * the profile editor. `reasoningEffort` is omitted from the row when undefined.
 * @param effort - configured reasoning effort of the row.
 * @returns the live context, the recorded writes, and a teardown.
 */
export async function buildWorld(effort: string | undefined): Promise<World> {
  const root = await realpath(await mkdtemp(join(import.meta.dirname, '.world-')))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: ollama',
    '    model: qwen3-8b-32k',
    ...effort === undefined ? [] : [`    reasoningEffort: ${effort}`],
    '',
  ].join('\n'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const written: Written[] = []
  let failure: Error | undefined
  ctx.provide('configEditor', {
    edit: (entry: { id: string }, change: () => unknown): Promise<void> => {
      if (failure !== undefined) return Promise.reject(failure)
      written.push({ entryId: entry.id.split(':').pop() ?? entry.id, config: change() })
      return Promise.resolve()
    },
  })
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return {
    ctx, written,
    failWith: (error) => { failure = error },
    close: async () => {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
