import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const bundles = join(import.meta.dirname, '..', '..', 'bundles')

function rows(bundle: string): Record<string, unknown>[] {
  const parsed: unknown = parse(readFileSync(join(bundles, bundle, 'cordis.patch.yml'), 'utf8'), { logLevel: 'error' })
  if (!Array.isArray(parsed)) throw new Error(`${bundle}: expected a list of patch objects`)
  return parsed.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
}

describe('air-desktop bundle', () => {
  const disabledByAir = rows('air').filter(row => row['disabled'] === true).map(row => row['id'])

  it('re-enables only rows that the AIR bundle disables, and only the two the desktop app needs at boot', () => {
    const reenabled = rows('air-desktop')
    expect(reenabled.map(row => row['id'])).toEqual(['deepseek-account', 'account-controller'])
    for (const row of reenabled) {
      expect(row['disabled']).toBe(false)
      expect(Object.keys(row).sort()).toEqual(['disabled', 'id'])
      expect(disabledByAir).toContain(row['id'])
    }
  })

  it('leaves the vendor inference route, the account settings page, uploads, and telemetry disabled', () => {
    const reenabled = rows('air-desktop').map(row => row['id'])
    const stayOff = ['llm-deepseek-account', 'ui-settings-account', 'web-search-deepseek', 'session-log-deepseek', 'session-telemetry-otel']
    for (const id of stayOff) {
      expect(disabledByAir).toContain(id)
      expect(reenabled).not.toContain(id)
    }
  })
})
