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
import type {} from '@deepseek-ai/dsh-tools'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-mcp-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  const approvalsFile = join(root, 'state', 'mcp-approvals.json')
  await mkdir(join(project, '.git'), { recursive: true })
  const mcpJson = JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [echoServer] } } })
  await writeFile(join(project, '.mcp.json'), mcpJson)
  const [spec] = parseMcpJson(mcpJson, { cwd: project, env: process.env }).servers
  if (spec === undefined) throw new Error('expected one server')
  await new ApprovalStore(approvalsFile).add(approvalKey(project, spec), {
    projectRoot: project,
    server: 'demo',
    approvedAt: '2026-10-01T00:00:00.000Z',
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-agent'",
    '- id: air-mcp-conventions',
    "  name: '@air/dsh-mcp-conventions'",
    '  config:',
    `    approvalsFile: ${JSON.stringify(approvalsFile)}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent } = stubAgent(context, project)
  await context.agents.register(agent)
  expect(context.tools.schemas(agent).map(schema => schema.name)).toEqual(['mcp__demo__echo'])
  const listed = await context.commands.execute(agent, '/mcp', [], new AbortController().signal)
  expect(listed?.result.text).toContain('): running')
})
