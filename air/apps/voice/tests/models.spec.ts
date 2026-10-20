import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadModelAssets, modelPaths, verifyModels, type ModelAssets } from '../src/core/models.ts'

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
