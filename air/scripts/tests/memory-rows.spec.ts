import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const bundleDir = join(import.meta.dirname, '..', '..', 'bundles', 'air')

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : []
}

// Upstream-style patch files use `!!js <expression>`; keep the expression as text.
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (source: string) => `!!js ${source}` }
const patches = rows(parse(readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8'), { customTags: [jsTag] }))
const hostRows = patches.flatMap(patch => rows(patch['insert']))
const presetConfig = hostRows.find(row => row['id'] === 'preset-air')?.['config']
const presetRows = isRow(presetConfig) ? rows(presetConfig['plugins']) : []
const byId = (list: Row[], id: string): Row | undefined => list.find(row => row['id'] === id)

describe('AIR memory rows', () => {
  it('mounts the store and index once at host level (FTS5 only, no embedding)', () => {
    expect(byId(hostRows, 'air-memory-store')).toEqual({ id: 'air-memory-store', name: '@air/dsh-memory-store' })
    expect(byId(hostRows, 'air-memory-index')).toEqual({ id: 'air-memory-index', name: '@air/dsh-memory-index' })
    expect(byId(hostRows, 'air-embedding')).toBeUndefined()
  })

  it('mounts the tools and the pinned core inside preset-air, the core directly after the clock reading', () => {
    expect(byId(presetRows, 'air-tool-memory')).toEqual({ id: 'air-tool-memory', name: '@air/dsh-tool-memory' })
    expect(byId(presetRows, 'air-memory-context')).toEqual({ id: 'air-memory-context', name: '@air/dsh-memory-context' })
    const ids = presetRows.map(row => row['id'])
    expect(ids[ids.indexOf('time-context') + 1]).toBe('air-memory-context')
    expect(ids.at(-1)).toBe('air-tool-memory')
  })

  it('declares every memory package as a bundle dependency (4 packages, no embedding)', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
    const dependencies = isRow(manifest) && isRow(manifest['dependencies']) ? manifest['dependencies'] : {}
    for (const packageName of ['@air/dsh-memory-store', '@air/dsh-memory-index', '@air/dsh-tool-memory', '@air/dsh-memory-context']) {
      expect(dependencies).toHaveProperty([packageName], 'workspace:*')
    }
    expect(dependencies).not.toHaveProperty('@air/dsh-embedding')
  })
})
