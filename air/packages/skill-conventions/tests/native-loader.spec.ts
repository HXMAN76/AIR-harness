import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-skill'

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
// lives inside this package; `@air/dsh-skill-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude', 'skills', 'hello'), { recursive: true })
  await writeFile(join(project, '.claude', 'skills', 'hello', 'SKILL.md'), '---\ndescription: Say hello\n---\nGreet the user.\n')
  await mkdir(join(home, '.agents', 'skills', 'decoy'), { recursive: true })
  await writeFile(join(home, '.agents', 'skills', 'decoy', 'SKILL.md'), '---\ndescription: Decoy\n---\nUnrelated.\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    '- id: air-skill-conventions',
    "  name: '@air/dsh-skill-conventions'",
    '  config:',
    `    airHome: ${JSON.stringify(join(home, '.air'))}`,
    `    claudeHome: ${JSON.stringify(join(home, '.claude'))}`,
    `    agentsHome: ${JSON.stringify(join(home, '.agents'))}`,
    '    watchIntervalMs: 0',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const skills = await context.skills.list({ cwd: project })
  expect(skills.map(skill => skill.name)).toEqual(['hello'])
  expect(skills[0]).toMatchObject({ provider: 'air-conventions', source: 'project-claude' })
  expect((await context.skills.get('hello', { cwd: project }))?.content).toBe('Greet the user.')
})
