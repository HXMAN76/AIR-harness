import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-command-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude', 'commands'), { recursive: true })
  await writeFile(join(project, '.claude', 'commands', 'fix-issue.md'), 'Fix issue $ARGUMENTS.')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-working-directory'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-agent'",
    '- id: air-command-conventions',
    "  name: '@air/dsh-command-conventions'",
    '  config:',
    `    airHome: ${JSON.stringify(join(root, 'home', '.air'))}`,
    `    claudeHome: ${JSON.stringify(join(root, 'home', '.claude'))}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent, followups } = stubAgent(context, project)
  await context.agents.register(agent)
  const execution = await context.commands.execute(agent, '/fix-issue 123', [], new AbortController().signal)
  expect(execution?.result).toEqual({ kind: 'success', text: 'Sent /fix-issue to the model.' })
  expect(followups[0]).toMatchObject({
    content: [{ type: 'text', text: 'Fix issue 123.' }],
    source: { kind: 'air-command', name: 'fix-issue', form: 'instructions' },
  })
  expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(expect.arrayContaining(['command/run', 'command/done']))
})
