import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloudKeyValue, prepareVoiceHome, voiceHome, voiceWorkspace } from '../src/core/home.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voice-setup-'))
  dirs.push(dir)
  return dir
}

describe('voice locations', () => {
  it('puts the runtime home under ~/.air and the workspace under Documents', () => {
    expect(voiceHome()).toBe(join(homedir(), '.air', 'voice-home'))
    expect(voiceWorkspace('/u')).toBe(join('/u', 'Documents', 'AIR Voice'))
    expect(voiceWorkspace()).toBe(join(homedir(), 'Documents', 'AIR Voice'))
  })
})

describe('prepareVoiceHome', () => {
  it('creates both directories and writes the Ollama placeholder key', () => {
    const root = temp()
    const home = join(root, 'home')
    const workspace = join(root, 'ws')
    const report = prepareVoiceHome({ home, workspace, env: {}, now: () => 1 })
    expect(existsSync(workspace)).toBe(true)
    expect(readFileSync(join(home, '.env'), 'utf8')).toBe('OLLAMA_API_KEY=ollama\n')
    expect(report).toEqual({ home, workspace, envUpdated: true, backup: undefined, cloudKey: false })
  })

  it('appends to an existing .env after backing it up, and leaves it alone the next time', () => {
    const home = temp()
    writeFileSync(join(home, '.env'), 'OLLAMA_CLOUD_KEY=test-value')
    const first = prepareVoiceHome({ home, workspace: join(home, 'ws'), env: {}, now: () => 42 })
    expect(first.backup).toBe(join(home, '.env.bak-42'))
    expect(readFileSync(join(home, '.env.bak-42'), 'utf8')).toBe('OLLAMA_CLOUD_KEY=test-value')
    expect(readFileSync(join(home, '.env'), 'utf8')).toBe('OLLAMA_CLOUD_KEY=test-value\nOLLAMA_API_KEY=ollama\n')
    expect(first.cloudKey).toBe(true)
    const second = prepareVoiceHome({ home, workspace: join(home, 'ws'), env: {}, now: () => 43 })
    expect(second.envUpdated).toBe(false)
    expect(second.backup).toBeUndefined()
    expect(readdirSync(home).filter(name => name.startsWith('.env.bak'))).toEqual(['.env.bak-42'])
  })

  it('reports the cloud key present in the environment', () => {
    const home = temp()
    mkdirSync(join(home, 'ws'))
    const report = prepareVoiceHome({ home, workspace: join(home, 'ws'), env: { OLLAMA_CLOUD_KEY: 'test-value' }, now: () => 1 })
    expect(report.cloudKey).toBe(true)
  })

  it('has defaults', () => {
    const home = temp()
    expect(prepareVoiceHome({ home, workspace: join(home, 'ws') }).envUpdated).toBe(true)
  })
})

describe('cloudKeyValue', () => {
  it('prefers the environment, then a later line of the home .env, else undefined', () => {
    const home = temp()
    expect(cloudKeyValue({}, home)).toBeUndefined()
    expect(cloudKeyValue({ OLLAMA_CLOUD_KEY: 'from-env' }, home)).toBe('from-env')
    writeFileSync(join(home, '.env'), ['OLLAMA_API_KEY=ollama', 'OLLAMA_CLOUD_KEY = "from-file"', ''].join('\r\n'))
    expect(cloudKeyValue({ OLLAMA_CLOUD_KEY: '' }, home)).toBe('from-file')
    writeFileSync(join(home, '.env'), '# OLLAMA_CLOUD_KEY=x\n')
    expect(cloudKeyValue({}, home)).toBeUndefined()
  })
})
