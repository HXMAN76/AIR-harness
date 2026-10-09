import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
// lives inside this package; `@air/dsh-instruction-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude'), { recursive: true })
  await writeFile(join(project, '.claude', 'CLAUDE.md'), 'Loader project memory. @notes.md')
  await writeFile(join(project, '.claude', 'notes.md'), 'Imported notes.')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-working-directory'",
    '- id: air-instruction-conventions',
    "  name: '@air/dsh-instruction-conventions'",
    '  config:',
    '    maxBytes: 4096',
    `    claudeHome: ${JSON.stringify(join(root, 'home', '.claude'))}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent } = stubAgent(context, project)
  const first = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  const decision = await context.waterfall(
    'agent/pre-step',
    { agent, messages: [first], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [first] }),
  )
  if (decision.kind !== 'enter') throw new Error('expected the step to enter')
  expect(decision.messages).toHaveLength(2)
  expect(decision.messages[1]?.source).toMatchObject({ kind: 'air-instructions', baseline: true })
  const [block] = decision.messages[1]?.content ?? []
  expect(block?.type).toBe('text')
  expect(block?.type === 'text' ? block.text : '').toContain('Imported notes.')
})
