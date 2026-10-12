import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One profile write the fake editor received. */
interface Written {
  readonly entryId: string
  readonly config: unknown
}

// The session controller reaches the service as `this.ctx.agentDefaultModel.saveSelection(selected)`, and
// upstream's own saveSelection writes through `ctx.get('configEditor')`. The editor here only records what
// the row would receive; everything else (Loader entry, real service, traceable proxy) is upstream's.
it('loads the built package through the real Loader and the session controller call path reaches the wrapper', async () => {
  root = await realpath(await mkdtemp(join(packageDir, '.loader-')))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: ollama',
    '    model: qwen3-8b-32k',
    '    reasoningEffort: none',
    '- id: effort-session-only',
    "  name: '@air/dsh-effort-session-only'",
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  const written: Written[] = []
  context.provide('configEditor', {
    edit: (entry: { id: string }, change: () => unknown): Promise<void> => {
      written.push({ entryId: entry.id.split(':').pop() ?? entry.id, config: change() })
      return Promise.resolve()
    },
  })
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  // Same expression the Host's selectModel and the settings Remote use.
  const consumer = context.agentDefaultModel
  const picked: ModelSelection = { provider: 'ollama', model: 'other', reasoningEffort: ReasoningEffortId('high') }
  await consumer.saveSelection(picked)

  expect(written).toHaveLength(1)
  expect(written[0]?.entryId).toBe('default-model')
  expect(written[0]?.config).toEqual({ provider: 'ollama', model: 'other', reasoningEffort: 'none' })
})
