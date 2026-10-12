import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-compaction'
import { lastText, RecordingAdapter } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// The row keeps upstream's id and config; only the package name differs. The model has a 100K window in
// the stub adapter, so the policy's lean 32K headroom is what makes a long history cross the threshold.
it('loads in place of upstream, keeps the policy from the row, and compacts with the appended section', async () => {
  root = await realpath(await mkdtemp(join(packageDir, '.loader-')))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    '  config:',
    "    personaPrefix: ''",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    "- name: '@deepseek-ai/dsh-token-meter'",
    '- id: compaction-basic',
    "  name: '@air/dsh-compaction-log'",
    '  config:',
    '    logMaxEntries: 25',
    '    modelPolicies:',
    '      - provider: mock',
    '        model: mock',
    '        headroomTokens: 6672',
    '        maxTokens: 2048',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  const live = context
  const adapter = new RecordingAdapter()
  adapter.contextWindow = 32_768
  live.llm.registerAdapter(['mock'], adapter)

  const agent = await live.agentLoop.create(SessionId('loader-compaction'), { provider: 'mock', model: 'mock' })
  for (const file of ['f1', 'f2', 'f3', 'f4']) {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `read file ${file} and report what it holds. `.repeat(1200) }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  }

  // The pre-step pressure check of a later turn runs the engine; no call is made by hand.
  expect(adapter.compactionRequests()).toHaveLength(1)
  const request = adapter.compactionRequests().at(0)
  expect(request?.maxTokens).toBe(2048)
  const text = request === undefined ? '' : lastText(request)
  expect(text).toContain('## Chronological Log')
  expect(text).toContain('at most 25 entries')
})
