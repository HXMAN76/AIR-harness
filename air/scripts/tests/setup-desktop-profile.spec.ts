import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backupPath,
  BASE_BUNDLES,
  planEnv,
  planManifest,
  planPatch,
  resolveDesktopHome,
  SetupRefusal,
  setupDesktopProfile,
} from '../setup-desktop-profile.ts'

const dirs = { '@air/dsh-air-bundle': '/r/air/bundles/air', '@air/dsh-air-desktop-bundle': '/r/air/bundles/air-desktop' }
const fresh = JSON.stringify({
  name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [...BASE_BUNDLES] } },
})

describe('planManifest', () => {
  it('adds both dependencies and bundle names after the existing ones', () => {
    const plan = planManifest(fresh, dirs)
    const next = JSON.parse(plan.text) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    expect(next.dependencies).toEqual({
      '@air/dsh-air-bundle': 'link:/r/air/bundles/air',
      '@air/dsh-air-desktop-bundle': 'link:/r/air/bundles/air-desktop',
    })
    expect(next.dsh.profile.bundles).toEqual([...BASE_BUNDLES, '@air/dsh-air-bundle', '@air/dsh-air-desktop-bundle'])
    expect(plan.changes).toHaveLength(4)
    expect(plan.text.endsWith('}\n')).toBe(true)
  })

  it('is idempotent and returns the input text untouched when nothing is missing', () => {
    const once = planManifest(fresh, dirs)
    const twice = planManifest(once.text, dirs)
    expect(twice.changes).toEqual([])
    expect(twice.text).toBe(once.text)
  })

  it('keeps unrelated fields, dependencies, and bundles, including user additions', () => {
    const text = JSON.stringify({
      name: 'dsh-profile-desktop', private: true, custom: { a: 1 },
      dependencies: { 'left-pad': '1.3.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'user-bundle'] }, other: true },
    })
    const next = JSON.parse(planManifest(text, dirs).text) as Record<string, unknown> & {
      dependencies: Record<string, string>
      dsh: { other: boolean; profile: { bundles: string[] } }
    }
    expect(next.custom).toEqual({ a: 1 })
    expect(next.dependencies['left-pad']).toBe('1.3.0')
    expect(next.dsh.other).toBe(true)
    expect(next.dsh.profile.bundles.slice(0, 2)).toEqual(['@deepseek-ai/dsh-base', 'user-bundle'])
  })

  it('repoints a dependency that links another checkout and reports it', () => {
    const moved = JSON.stringify({
      dependencies: { '@air/dsh-air-bundle': 'link:/old/air/bundles/air' },
      dsh: { profile: { bundles: ['@air/dsh-air-bundle'] } },
    })
    const plan = planManifest(moved, dirs)
    expect(plan.changes).toContain('repoint dependency @air/dsh-air-bundle')
  })

  it('creates the dependencies object when the manifest has none', () => {
    const plan = planManifest(JSON.stringify({ dsh: { profile: { bundles: [] } } }), dirs)
    expect(Object.keys((JSON.parse(plan.text) as { dependencies: object }).dependencies)).toHaveLength(2)
  })

  it.each([
    ['invalid JSON', '{', /not valid JSON/u],
    ['an array', '[]', /not a JSON object/u],
    ['no dsh.profile', '{"name":"x"}', /no "dsh.profile"/u],
    ['dependencies of the wrong type', '{"dependencies":[],"dsh":{"profile":{"bundles":[]}}}', /"dependencies" is not an object/u],
    ['bundles missing', '{"dsh":{"profile":{}}}', /not an array of strings/u],
    ['bundles with a non-string entry', '{"dsh":{"profile":{"bundles":[1]}}}', /not an array of strings/u],
    [
      'the desktop variant before the AIR bundle',
      '{"dsh":{"profile":{"bundles":["@air/dsh-air-desktop-bundle","@air/dsh-air-bundle"]}}}',
      /listed before/u,
    ],
  ])('refuses %s', (_label, text, message) => {
    expect(() => planManifest(text, dirs)).toThrow(SetupRefusal)
    expect(() => planManifest(text, dirs)).toThrow(message)
  })

  it('refuses a missing bundle directory', () => {
    expect(() => planManifest(fresh, {})).toThrow(/no directory given/u)
  })
})

describe('planEnv', () => {
  it('creates the file content when absent', () => {
    expect(planEnv(undefined)).toEqual({ text: 'OLLAMA_API_KEY=ollama\n', changes: ['add OLLAMA_API_KEY=ollama'] })
  })

  it('appends on its own line without touching existing lines', () => {
    expect(planEnv('A=1').text).toBe('A=1\nOLLAMA_API_KEY=ollama\n')
    expect(planEnv('A=1\n').text).toBe('A=1\nOLLAMA_API_KEY=ollama\n')
  })

  it.each(['OLLAMA_API_KEY=other\n', 'export OLLAMA_API_KEY=x\n', 'A=1\n  OLLAMA_API_KEY = y\n'])('keeps %j', (text) => {
    expect(planEnv(text)).toEqual({ text, changes: [] })
  })

  it('does not treat a longer variable name as the key', () => {
    expect(planEnv('XOLLAMA_API_KEY=1\n').changes).toHaveLength(1)
  })
})

describe('planPatch', () => {
  it('writes when the file is absent or holds only the empty template', () => {
    expect(planPatch(undefined)).toBe('write')
    expect(planPatch('# Your patch layer\n# more\n[]\n')).toBe('write')
  })

  it('recognizes an existing Ollama route', () => {
    expect(planPatch('- id: llm-pi-ai\n  config:\n    providers:\n      ollama:\n        displayName: x\n')).toBe('present')
  })

  it('asks for a manual edit when the file has other content', () => {
    expect(planPatch('- id: ui-chat\n  config:\n    a: 1\n')).toBe('print')
  })
})

describe('backupPath and resolveDesktopHome', () => {
  it('stamps backups with a Windows-safe UTC time', () => {
    expect(backupPath('/h/package.json', new Date('2026-10-12T10:30:05.123Z'))).toBe('/h/package.json.bak-20261012T103005Z')
  })

  it('prefers DSH_HOME and otherwise uses the development launcher home', () => {
    expect(resolveDesktopHome({ DSH_HOME: '/x/home' }, '/r')).toBe(resolve('/x/home'))
    expect(resolveDesktopHome({}, '/r')).toBe(join('/r', 'apps', 'desktop', '.desktop-build', 'development', 'home'))
    expect(resolveDesktopHome({ DSH_HOME: '' }, '/r')).toBe(join('/r', 'apps', 'desktop', '.desktop-build', 'development', 'home'))
  })
})

describe('setupDesktopProfile refusal', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  it('refuses a profile manifest it does not understand and changes no file', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'air-setup-')))
    roots.push(home)
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), '{"name":"x"}\n')
    const lines: string[] = []
    const code = setupDesktopProfile(home, '/r', { log: line => lines.push(line) })
    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/refused: .*package\.json: package\.json has no "dsh\.profile"/u)
    expect(readdirSync(profile)).toEqual(['package.json'])
    expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe('{"name":"x"}\n')
  })
})
