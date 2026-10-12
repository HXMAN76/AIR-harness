import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { PRESETS, StubAdapter } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config lives
// inside this package; `@air/dsh-preset-by-model` self-resolves to lib/. The
// registry, the agent services, and the model catalogue are upstream's own.
it('loads the built package through the real Loader and switches a blank session to the full preset', async () => {
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
    "- name: '@deepseek-ai/dsh-agent-preset-registry'",
    '  config:',
    '    default: air-lean',
    "- name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: cloud',
    '    model: big',
    ...PRESETS.flatMap(id => [
      `- id: preset-${id}`,
      "  name: '@deepseek-ai/dsh-agent-preset'",
      '  config:',
      `    id: ${id}`,
      '    plugins: []',
    ]),
    '- id: air-preset-by-model',
    "  name: '@air/dsh-preset-by-model'",
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.builtins.group = Group
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  const live = context
  live.llm.registerAdapter(['cloud'], new StubAdapter())

  const chosen = live.agentPresets.defaultId
  expect(chosen).toBe('air-lean')
  const handle = await live.agents.create({
    sessionId: SessionId('loader-session'),
    meta: { agentPreset: chosen },
    setup: async (agentCtx: Context) => { await live.agentPresets.mount(agentCtx, chosen) },
  })
  await vi.waitFor(() => { expect(live.agentPresets.composedPreset(handle.agent.ctx)).toBe('air') })
  expect(handle.agent.session.snapshotEvents().map(event => event.type)).toContain('agent-preset/selected')
})
