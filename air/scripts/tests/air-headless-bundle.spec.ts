import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { REMOVED_ROW_IDS } from '../gen-preset-air-lean.ts'

const airDir = join(import.meta.dirname, '..', '..')
const repoDir = join(airDir, '..')
const bundleDir = join(airDir, 'bundles', 'air-headless')

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Keep `!!js <expression>` as text so rows from different files compare equal.
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (source: string) => `!!js ${source}` }

function patches(file: string): Row[] {
  const parsed: unknown = parse(readFileSync(file, 'utf8'), { customTags: [jsTag] })
  if (!Array.isArray(parsed) || !parsed.every(isRow)) throw new Error(`${file}: expected a list of patch objects`)
  return parsed
}

function insertedRows(file: string): Row[] {
  return patches(file).flatMap((patch) => {
    const inserted = patch['insert']
    return Array.isArray(inserted) ? inserted.filter(isRow) : []
  })
}

/** Ids of the rows the patch changes in place (a patch object that is not an `insert`). */
function patchedIds(file: string): string[] {
  return patches(file).filter(patch => patch['insert'] === undefined).map(patch => String(patch['id']))
}

const headlessPatch = join(bundleDir, 'cordis.patch.yml')
const composition = [
  join(repoDir, 'packages', 'bundle', 'base', 'cordis.patch.yml'),
  join(repoDir, 'packages', 'bundle', 'headless', 'cordis.patch.yml'),
]
const compositionIds = new Set(composition.flatMap(file => insertedRows(file).map(row => String(row['id']))))

describe('air-headless bundle', () => {
  it('patches only rows that exist in the base and headless bundles', () => {
    const missing = patchedIds(headlessPatch).filter(id => !compositionIds.has(id))
    expect(missing).toEqual([])
  })

  it('omits the rows the lean preset omits, wherever the headless composition has them', () => {
    const preset = insertedRows(join(airDir, 'bundles', 'air', 'cordis.patch.yml')).find(row => row['id'] === 'preset-air')
    const config = preset?.['config']
    const plugins = isRow(config) && Array.isArray(config['plugins']) ? config['plugins'].filter(isRow) : []
    const omitted = REMOVED_ROW_IDS.flatMap((id) => {
      const entry = plugins.find(plugin => plugin['id'] === id)
      const members = entry !== undefined && Array.isArray(entry['config']) ? entry['config'].filter(isRow) : []
      return members.length > 0 ? members.map(member => String(member['id'])) : [id]
    })
    const disabled = patches(headlessPatch).filter(patch => patch['disabled'] === true).map(patch => String(patch['id']))
    const expected = omitted.filter(id => compositionIds.has(id))
    // The headless composition has no schedule tool, so the lean row set minus tool-schedule must all be disabled.
    expect(expected.length).toBeGreaterThan(0)
    for (const id of expected) expect(disabled).toContain(id)
    // Nothing else of the lean set may be disabled beyond the vendor-account rows and the replaced compaction row.
    const vendorRows = [
      'session-log-deepseek', 'plugin-package-inventory-deepseek', 'session-telemetry-otel',
      'deepseek-account', 'llm-deepseek-account', 'web-search-deepseek',
      'compaction-basic',
    ]
    expect([...disabled].sort()).toEqual([...expected, ...vendorRows].sort())
  })

  it('carries the same MCP trust row as the air and mcp-servers bundles', () => {
    const trust = (file: string): Row | undefined => insertedRows(file).find(row => row['id'] === 'air-mcp-trust')
    const shared = trust(join(airDir, 'bundles', 'mcp-servers', 'cordis.patch.yml'))
    expect(shared).toBeDefined()
    expect(trust(headlessPatch)).toEqual(shared)
    expect(trust(join(airDir, 'bundles', 'air', 'cordis.patch.yml'))).toEqual(shared)
  })

  it('turns the stock compaction row off and inserts the log engine with the lean policies', () => {
    expect(patches(headlessPatch).find(patch => patch['id'] === 'compaction-basic')).toEqual({ id: 'compaction-basic', disabled: true })
    const row = insertedRows(headlessPatch).find(candidate => candidate['id'] === 'air-compaction-log')
    expect(row?.['name']).toBe('@air/dsh-compaction-log')
    const config = row?.['config']
    expect(isRow(config) && Array.isArray(config['modelPolicies']) && config['modelPolicies'].length > 0).toBe(true)
  })

  it('sets the same default model as the air bundle', () => {
    const model = (file: string): unknown => patches(file).find(patch => patch['id'] === 'agent-default-model')?.['config']
    expect(model(headlessPatch)).toEqual(model(join(airDir, 'bundles', 'air', 'cordis.patch.yml')))
  })

  it('declares every AIR row package as a bundle dependency and mounts no preset-only plugin', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
    const dependencies = isRow(manifest) && isRow(manifest['dependencies']) ? manifest['dependencies'] : {}
    const rowPackages = [...readFileSync(headlessPatch, 'utf8').matchAll(/name: '(@air\/[^']+)'/gu)].map(match => String(match[1]))
    expect(rowPackages.sort()).toEqual([
      '@air/dsh-command-conventions', '@air/dsh-compaction-log', '@air/dsh-instruction-conventions',
      '@air/dsh-mcp-conventions', '@air/dsh-mcp-trust', '@air/dsh-skill-conventions',
    ])
    for (const packageName of rowPackages) expect(dependencies).toHaveProperty([packageName], 'workspace:*')
  })
})
