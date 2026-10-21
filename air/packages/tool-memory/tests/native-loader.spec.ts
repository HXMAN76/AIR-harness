import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve from the directory of the cordis.yml, so it must live inside this package.
it('loads the built memory stack through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    '- id: air-memory-store',
    "  name: '@air/dsh-memory-store'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'memory'))}`,
    "    shareWith: ['*']",
    '- id: air-memory-index',
    "  name: '@air/dsh-memory-index'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'index.sqlite'))}`,
    '- id: air-tool-memory',
    "  name: '@air/dsh-tool-memory'",
    '  config:',
    '    searchLimit: 3',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = `${pathToFileURL(packageDir).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  expect(context.tools.schemas().map(schema => schema.name).toSorted()).toEqual(['memory_forget', 'memory_read', 'memory_search', 'memory_write'])
  const result = await context.tools.execute({
    name: 'memory_search',
    arguments: { query: 'anything' },
    callId: ToolCallId('native-call'),
    signal: new AbortController().signal,
  })
  expect(result.content).toEqual([{ type: 'text', text: 'No stored memory matches.' }])
})
