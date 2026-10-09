/** AIR bundle and example patches: the trust row exists, and every mcp-client row is reviewed. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { resolvePolicy } from '../src/verdict.ts'

const air = join(import.meta.dirname, '..', '..', '..')

interface Row {
  id?: string
  name?: string
  inject?: string[]
  disabled?: boolean
  config?: Record<string, unknown>
  insert?: Row[]
}

function rows(file: string): Row[] {
  const parsed = yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema }) as Row[]
  return parsed.flatMap(row => row.insert ?? [row])
}

const patches = [
  join(air, 'bundles', 'air', 'cordis.patch.yml'),
  join(air, 'bundles', 'mcp-servers', 'cordis.patch.yml'),
  join(air, 'bundles', 'air-mcp', 'cordis.patch.yml'),
  ...readdirSync(join(air, 'examples')).filter(file => file.endsWith('.yml')).map(file => join(air, 'examples', file)),
]

describe('AIR MCP composition', () => {
  it('ships the trust row with a complete fail-closed default policy', () => {
    const manifest = JSON.parse(readFileSync(join(air, 'bundles', 'mcp-servers', 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
      dsh: { bundle: { patch: string } }
    }
    expect(manifest.name).toBe('@air/dsh-air-mcp-servers')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies['@air/dsh-mcp-trust']).toBe('workspace:*')

    const trust = rows(join(air, 'bundles', 'mcp-servers', 'cordis.patch.yml')).find(row => row.id === 'air-mcp-trust')
    expect(trust?.name).toBe('@air/dsh-mcp-trust')
    expect(resolvePolicy(trust?.config?.['defaults'], undefined, 'defaults')).toEqual({
      mode: 'enforce', onAdded: 'withhold', onChanged: 'reject-generation', onRemoved: 'accept',
      instructions: 'pin', deny: [], override: {},
    })
    expect(trust?.config?.['denyUnreviewedMcpTools']).toBe(true)
    expect(trust?.config?.['cliCommand']).toBe('pnpm dsh --profile air-mcp')
    expect(trust?.config?.['enrollOnApproval']).toBe(true)
  })

  it('gives the air bundle the same trust row and holds every .mcp.json server until the reviewer exists', () => {
    const airRows = rows(join(air, 'bundles', 'air', 'cordis.patch.yml'))
    const shared = rows(join(air, 'bundles', 'mcp-servers', 'cordis.patch.yml')).find(row => row.id === 'air-mcp-trust')
    expect(airRows.find(row => row.id === 'air-mcp-trust')).toEqual(shared)
    const conventions = airRows.find(row => row.id === 'air-mcp-conventions')
    expect(conventions?.name).toBe('@air/dsh-mcp-conventions')
    expect(conventions?.config).toEqual({ reviewTools: true })
  })

  it('declares inject: [mcpToolReview] on every mcp-client row (scenario 23)', () => {
    const clients = patches.flatMap(file => rows(file)
      .filter(row => row.name === '@deepseek-ai/dsh-mcp-client')
      .map(row => ({ file, id: row.id, inject: row.inject ?? [] })))
    expect(clients.length).toBeGreaterThan(0)
    expect(clients.filter(row => !row.inject.includes('mcpToolReview'))).toEqual([])
  })

  it('turns off the headless rows and inserts the command line in the air-mcp bundle', () => {
    const patch = rows(join(air, 'bundles', 'air-mcp', 'cordis.patch.yml'))
    expect(patch.filter(row => row.disabled === true).map(row => row.id)).toEqual(expect.arrayContaining(['headless-startup', 'headless-runner']))
    expect(patch.find(row => row.id === 'air-mcp-trust-cli')?.name).toBe('@air/dsh-mcp-trust-cli')
  })
})
