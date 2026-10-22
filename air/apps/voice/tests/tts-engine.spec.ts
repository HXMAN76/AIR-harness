import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { KOKORO_VOICES, TtsWorkerEngine, chooseTts, kokoroConfig, kokoroFiles, resolveTtsOptions, type TtsSherpa } from '../src/core/tts-engine.ts'
import { encodeWav } from '../src/core/wav.ts'

const say = (text: string): string => `SAY ${Buffer.from(text).toString('base64')}`

/** A fake sherpa that records requests and returns 0.1 s of a ramp at 1000 Hz. */
type Request = { text: string; sid: number; speed: number }
function fakeSherpa(fail: (text: string) => boolean = () => false): { sherpa: TtsSherpa; configs: object[]; requests: Request[] } {
  const configs: object[] = []
  const requests: { text: string; sid: number; speed: number }[] = []
  class FakeTts {
    constructor(config: object) {
      configs.push(config)
    }

    generate(request: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number } {
      requests.push(request)
      if (fail(request.text)) throw new Error('boom')
      return { samples: Float32Array.from({ length: 100 }, (_, i) => i / 100), sampleRate: 1000 }
    }
  }
  return { sherpa: { OfflineTts: FakeTts }, configs, requests }
}

/** A deferral queue the test runs by hand. */
function manualDefer(): { defer: (fn: () => void) => void; run: () => boolean } {
  const tasks: (() => void)[] = []
  return {
    defer: (fn) => { tasks.push(fn) },
    run: () => {
      const task = tasks.shift()
      task?.()
      return task !== undefined
    },
  }
}

describe('resolveTtsOptions', () => {
  it.each([
    [{}, 'am_michael', 16, 1],
    [{ AIR_VOICE_TTS_VOICE: 'bf_emma' }, 'bf_emma', 21, 1],
    [{ AIR_VOICE_TTS_VOICE: ' am_michael ' }, 'am_michael', 16, 1],
    [{ AIR_VOICE_TTS_VOICE: '2' }, 'af_bella', 2, 1],
    [{ AIR_VOICE_TTS_VOICE: '19' }, 'am_michael', 16, 1],
    [{ AIR_VOICE_TTS_VOICE: 'nobody' }, 'am_michael', 16, 1],
    [{ AIR_VOICE_TTS_SPEED: '1.05' }, 'am_michael', 16, 1.05],
    [{ AIR_VOICE_TTS_SPEED: '5' }, 'am_michael', 16, 1.3],
    [{ AIR_VOICE_TTS_SPEED: '0.1' }, 'am_michael', 16, 0.7],
    [{ AIR_VOICE_TTS_SPEED: 'fast' }, 'am_michael', 16, 1],
  ])('%j', (env, voice, sid, speed) => {
    expect(resolveTtsOptions(env)).toEqual({ voice, sid, speed })
  })

  it('has unique speaker ids', () => {
    const ids = Object.values(KOKORO_VOICES)
    expect(new Set(ids).size).toBe(ids.length)
    expect(KOKORO_VOICES['af_heart']).toBe(3)
  })
})

describe('chooseTts', () => {
  it('uses Kokoro when every file exists and SAPI otherwise or when forced', () => {
    const present = new Set(kokoroFiles('/m'))
    expect(chooseTts({}, '/m', path => present.has(path))).toBe('kokoro')
    expect(chooseTts({ AIR_VOICE_TTS: 'kokoro' }, '/m', path => present.has(path))).toBe('kokoro')
    expect(chooseTts({ AIR_VOICE_TTS: 'sapi' }, '/m', path => present.has(path))).toBe('sapi')
    expect(chooseTts({}, '/m', path => present.has(path) && !path.endsWith('voices.bin'))).toBe('sapi')
  })

  it('builds the sherpa configuration from the folder', () => {
    expect(kokoroConfig('/m', 3)).toEqual({
      model: {
        kokoro: {
          model: join('/m', 'model.onnx'),
          voices: join('/m', 'voices.bin'),
          tokens: join('/m', 'tokens.txt'),
          dataDir: join('/m', 'espeak-ng-data'),
          lexicon: join('/m', 'lexicon-us-en.txt'),
        },
        numThreads: 3,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    })
  })
})

describe('TtsWorkerEngine', () => {
  it('renders each sentence to a padded WAV, one per tick, in order', () => {
    const fake = fakeSherpa()
    const lines: string[] = []
    const later = manualDefer()
    const engine = new TtsWorkerEngine({ sherpa: fake.sherpa, dir: '/m', sid: 3, speed: 1.05, write: line => lines.push(line), defer: later.defer })
    expect(fake.configs).toEqual([kokoroConfig('/m', 4)])
    engine.handleLine(say('One.'))
    engine.handleLine(`${say('Two.')}\r`)
    expect(lines).toEqual([])
    while (later.run()) { /* drain */ }
    expect(fake.requests).toEqual([{ text: 'One.', sid: 3, speed: 1.05 }, { text: 'Two.', sid: 3, speed: 1.05 }])
    expect(lines).toHaveLength(2)
    const wav = Buffer.from((lines[0] as string).slice(4), 'base64')
    expect(wav.length).toBe(44 + (100 + 150) * 2)
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(1000)
    engine.handleLine(say('Three.'))
    while (later.run()) { /* drain */ }
    expect(lines).toHaveLength(3)
  })

  it('STOP drops queued sentences and answers DONE for each', () => {
    const fake = fakeSherpa()
    const lines: string[] = []
    const later = manualDefer()
    const engine = new TtsWorkerEngine({ sherpa: fake.sherpa, dir: '/m', sid: 3, speed: 1, write: line => lines.push(line), defer: later.defer, threads: 2 })
    expect(fake.configs).toEqual([kokoroConfig('/m', 2)])
    engine.handleLine(say('One.'))
    engine.handleLine(say('Two.'))
    engine.handleLine('STOP')
    expect(lines).toEqual(['DONE', 'DONE'])
    while (later.run()) { /* drain */ }
    expect(fake.requests).toEqual([])
    engine.handleLine('STOP')
    engine.handleLine('nonsense')
    expect(lines).toEqual(['DONE', 'DONE'])
  })

  it('answers DONE and reports when synthesis fails, then carries on', () => {
    const fake = fakeSherpa(text => text === 'Bad.')
    const lines: string[] = []
    const errors: string[] = []
    const later = manualDefer()
    const engine = new TtsWorkerEngine({ sherpa: fake.sherpa, dir: '/m', sid: 3, speed: 1, write: line => lines.push(line), defer: later.defer, onError: error => errors.push(error.message) })
    engine.handleLine(say('Bad.'))
    engine.handleLine(say('Good.'))
    while (later.run()) { /* drain */ }
    expect(lines[0]).toBe('DONE')
    expect(lines[1]).toMatch(/^WAV /)
    expect(errors).toEqual(['boom'])
  })

  it('tolerates failures without an error handler and non-Error throws', () => {
    const lines: string[] = []
    const later = manualDefer()
    class Throws {
      generate(): { samples: Float32Array; sampleRate: number } {
        throw 'plain'
      }
    }
    const engine = new TtsWorkerEngine({ sherpa: { OfflineTts: Throws }, dir: '/m', sid: 3, speed: 1, write: line => lines.push(line), defer: later.defer, onError: error => lines.push(error.message) })
    engine.handleLine(say('x y z'))
    while (later.run()) { /* drain */ }
    expect(lines).toEqual(['DONE', 'plain'])
  })

  it('warm() renders a short sentence and the default defer is setImmediate', async () => {
    const fake = fakeSherpa()
    const lines: string[] = []
    const engine = new TtsWorkerEngine({ sherpa: fake.sherpa, dir: '/m', sid: 3, speed: 1, write: line => lines.push(line) })
    engine.warm()
    expect(fake.requests).toEqual([{ text: 'Ready.', sid: 3, speed: 1 }])
    engine.handleLine(say('Hello there.'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lines).toHaveLength(1)
  })
})

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clipped samples', () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -0.5, 2, -2]), 24_000)
    expect(wav.length).toBe(44 + 10)
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(wav.readUInt16LE(20)).toBe(1)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(24_000)
    expect(wav.readUInt32LE(28)).toBe(48_000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(10)
    expect([0, 1, 2, 3, 4].map(i => wav.readInt16LE(44 + i * 2))).toEqual([0, 16_384, -16_383, 32_767, -32_767])
  })
})
