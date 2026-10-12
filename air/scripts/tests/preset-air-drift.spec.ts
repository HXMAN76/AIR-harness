import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { REMOVED_ROW_IDS, regenerate } from '../gen-preset-air-lean.ts'

const airDir = join(import.meta.dirname, '..', '..')
const bundleDir = join(airDir, 'bundles', 'air')
const airPatch = join(bundleDir, 'cordis.patch.yml')
const standardPatch = join(airDir, '..', 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Upstream patch files use `!!js <expression>`; keep the expression as text so both files compare equal.
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

function presetPlugins(file: string, rowId: string): Row[] {
  const row = insertedRows(file).find(candidate => candidate['id'] === rowId)
  const config = row?.['config']
  if (!isRow(config)) throw new Error(`${file}: no preset row ${rowId}`)
  const plugins = config['plugins']
  if (!Array.isArray(plugins) || !plugins.every(isRow)) throw new Error(`${file}: ${rowId} has no plugin list`)
  return plugins
}

/** Copy a value without any `modelPolicies` key, and without a config left empty by that removal. */
function withoutPolicies(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPolicies)
  if (!isRow(value)) return value
  const entries: [string, unknown][] = []
  for (const [key, item] of Object.entries(value)) {
    if (key === 'modelPolicies') continue
    const copy = withoutPolicies(item)
    const emptied = isRow(item) && Object.keys(item).length > 0 && isRow(copy) && Object.keys(copy).length === 0
    if (!emptied) entries.push([key, copy])
  }
  return Object.fromEntries(entries)
}

function isAirRow(row: Row): boolean {
  const id = row['id']
  return typeof id === 'string' && id.startsWith('air-')
}

describe('AIR bundle composition', () => {
  it('keeps preset-air equal to the upstream standard preset plus the declared changes', () => {
    const standard = presetPlugins(standardPatch, 'preset-standard')
    const air = presetPlugins(airPatch, 'preset-air')
    expect(air.filter(isAirRow)).toEqual([
      { id: 'air-instruction-conventions', name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } },
      { id: 'air-skill-conventions', name: '@air/dsh-skill-conventions' },
    ])
    const expected = standard.map(row => (row['id'] === 'skill-filesystem' ? Object.assign({}, row, { config: { includeDefaultRoots: false } }) : row))
    expect(withoutPolicies(air.filter(row => !isAirRow(row)))).toEqual(expected)
  })

  it('places each AIR preset row directly after its upstream counterpart', () => {
    const ids = presetPlugins(airPatch, 'preset-air').map(row => row['id'])
    expect(ids[ids.indexOf('agent-instructions') + 1]).toBe('air-instruction-conventions')
    expect(ids[ids.indexOf('skill-filesystem') + 1]).toBe('air-skill-conventions')
  })

  it('keeps the clock reading and the reminder tools', () => {
    const ids = presetPlugins(airPatch, 'preset-air').map(row => row['id'])
    expect(ids).toEqual(expect.arrayContaining(['time-context', 'tool-schedule']))
  })

  it('keeps preset-air-lean equal to preset-air minus exactly the declared removed rows', () => {
    const full = presetPlugins(airPatch, 'preset-air')
    const lean = presetPlugins(airPatch, 'preset-air-lean')
    expect(REMOVED_ROW_IDS.every(id => full.some(row => row['id'] === id))).toBe(true)
    expect(lean.some(row => REMOVED_ROW_IDS.includes(String(row['id'])))).toBe(false)
    expect(withoutPolicies(lean)).toEqual(withoutPolicies(full.filter(row => !REMOVED_ROW_IDS.includes(String(row['id'])))))
  })

  it('keeps the generated lean block current', () => {
    const text = readFileSync(airPatch, 'utf8')
    expect(regenerate(text)).toBe(text)
  })

  it('lists the lean preset first and the full preset second', () => {
    const order = (rowId: string): unknown => {
      const config = insertedRows(airPatch).find(row => row['id'] === rowId)?.['config']
      return isRow(config) ? config['order'] : undefined
    }
    expect(order('preset-air-lean')).toBe(-1)
    expect(order('preset-air')).toBe(0)
  })

  it('makes the lean AIR preset the default and mounts the host rows', () => {
    expect(patches(airPatch)).toContainEqual({ id: 'agent-preset-registry', config: { default: 'air-lean' } })
    const hostRows = insertedRows(airPatch).filter(isAirRow)
    expect(hostRows.map(row => [row.id, row.name])).toEqual([
      ['air-mcp-conventions', '@air/dsh-mcp-conventions'],
      ['air-mcp-trust', '@air/dsh-mcp-trust'],
      ['air-command-conventions', '@air/dsh-command-conventions'],
      ['air-preset-by-model', '@air/dsh-preset-by-model'],
      ['air-effort-session-only', '@air/dsh-effort-session-only'],
    ])
  })

  it('declares every AIR row package as a bundle dependency', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
    const dependencies = isRow(manifest) && isRow(manifest['dependencies']) ? manifest['dependencies'] : {}
    const rowPackages = [...readFileSync(airPatch, 'utf8').matchAll(/name: '(@air\/[^']+)'/gu)].map(match => match[1])
    expect(rowPackages).toHaveLength(9)
    for (const packageName of rowPackages) expect(dependencies).toHaveProperty([String(packageName)], 'workspace:*')
  })
})
