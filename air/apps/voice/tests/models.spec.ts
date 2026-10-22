import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileMatches, loadModelAssets, loadModelLock, modelDir, modelPaths, modelRoot, verifyEntry, verifyModels, type ModelAssets } from '../src/core/models.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

describe('modelPaths', () => {
  it('defaults to ~/.air/voice-models', () => {
    const dir = join(homedir(), '.air', 'voice-models')
    expect(modelPaths()).toEqual({
      model: join(dir, 'model.int8.onnx'),
      tokens: join(dir, 'tokens.txt'),
      vad: join(dir, 'silero_vad.onnx'),
    })
  })

  it('uses the given home', () => {
    expect(modelPaths('/h').vad).toBe(join('/h', '.air', 'voice-models', 'silero_vad.onnx'))
  })
})

describe('loadModelAssets', () => {
  it('reads the pinned int8 model, tokens, and VAD from upstream assets.json', () => {
    const assets = loadModelAssets()
    expect(assets.model.name).toBe('model.int8.onnx')
    expect(assets.model.bytes).toBe(239233841)
    expect(assets.tokens.sha256).toBe('f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc')
    expect(assets.vad.url).toMatch(/silero_vad\.onnx$/)
  })
})

describe('verifyModels', () => {
  function setup(): { paths: ReturnType<typeof modelPaths>; assets: ModelAssets } {
    const home = mkdtempSync(join(tmpdir(), 'voice-models-'))
    dirs.push(home)
    const paths = { model: join(home, 'model'), tokens: join(home, 'tokens'), vad: join(home, 'vad') }
    const entry = (name: string, text: string): ModelAssets['model'] => ({ name, url: `https://example.invalid/${name}`, bytes: text.length, sha256: sha(text) })
    return { paths, assets: { model: entry('model', 'model-bytes'), tokens: entry('tokens', 'tok'), vad: entry('vad', 'vad!') } }
  }

  it('is ok when every file has the pinned size and hash', async () => {
    const { paths, assets } = setup()
    writeFileSync(paths.model, 'model-bytes')
    writeFileSync(paths.tokens, 'tok')
    writeFileSync(paths.vad, 'vad!')
    await expect(verifyModels(paths, assets)).resolves.toEqual({ ok: true })
  })

  it('reports missing files, wrong sizes, and wrong hashes', async () => {
    const { paths, assets } = setup()
    writeFileSync(paths.tokens, 'toolong')
    writeFileSync(paths.vad, 'vad?')
    await expect(verifyModels(paths, assets)).resolves.toEqual({ ok: false, missing: [paths.model, paths.tokens, paths.vad] })
  })
})

describe('model lock', () => {
  it('pins the four voice models with hashes, sizes, and licences', () => {
    const lock = loadModelLock()
    expect(Object.keys(lock.models)).toEqual(['kws', 'asr-en', 'asr-ta', 'vad', 'tts-en'])
    for (const [name, entry] of Object.entries(lock.models)) {
      expect(entry.license, name).not.toBe('')
      for (const file of entry.files) {
        expect(file.sha256, `${name}/${file.path}`).toMatch(/^[0-9a-f]{64}$/)
        expect(file.bytes).toBeGreaterThan(0)
        expect(file.url ?? entry.archive?.url, `${name}/${file.path}`).toMatch(/^https:\/\//)
      }
    }
    expect(lock.models.kws!.archive!.url).toContain('kws-models')
    expect(lock.models['asr-en']!.archive!.url).toContain('parakeet-tdt-0.6b-v2-int8')
    expect(lock.models['asr-ta']!.files[0]!.url).toContain('/ta/model.int8.onnx')
  })

  it('puts each model in its own folder under ~/.air/voice-models', () => {
    expect(modelRoot()).toBe(join(homedir(), '.air', 'voice-models'))
    expect(modelDir('kws', '/h')).toBe(join('/h', '.air', 'voice-models', 'kws'))
  })

  it('verifyEntry checks every file of an entry; fileMatches checks one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-entry-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'a.bin'), 'aaa')
    writeFileSync(join(dir, 'b.bin'), 'bbbb')
    const entry = { title: 't', license: 'l', files: [{ path: 'a.bin', bytes: 3, sha256: sha('aaa') }, { path: 'b.bin', bytes: 4, sha256: sha('xxxx') }, { path: 'c.bin', bytes: 1, sha256: sha('c') }] }
    await expect(verifyEntry(dir, entry)).resolves.toEqual({ ok: false, missing: [join(dir, 'b.bin'), join(dir, 'c.bin')] })
    await expect(verifyEntry(dir, { ...entry, files: [entry.files[0]!] })).resolves.toEqual({ ok: true })
    await expect(fileMatches(join(dir, 'a.bin'), { bytes: 3, sha256: sha('aaa') })).resolves.toBe(true)
  })
})
