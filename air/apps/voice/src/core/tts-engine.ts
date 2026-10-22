/**
 * Kokoro speech through sherpa-onnx, with the classes injected so it is testable without the model.
 * The TTS worker process speaks the same line protocol as `speaker.ps1`: `SAY <base64 UTF-8>` queues a sentence,
 * `STOP` drops the queue; each sentence is answered with `WAV <base64>` or `DONE`.
 */
import { join } from 'node:path'
import { encodeWav } from './wav.ts'

/** Kokoro v1.0 multi-lang voices, verified against the model's own `id2speaker` metadata. */
export const KOKORO_VOICES: Record<string, number> = {
  af_alloy: 0, af_aoede: 1, af_bella: 2, af_heart: 3, af_jessica: 4, af_kore: 5, af_nicole: 6, af_nova: 7, af_river: 8,
  af_sarah: 9, af_sky: 10,
  am_adam: 11, am_echo: 12, am_eric: 13, am_fenrir: 14, am_liam: 15, am_michael: 16, am_onyx: 17, am_puck: 18,
  bf_alice: 20, bf_emma: 21, bf_isabella: 22, bf_lily: 23, bm_daniel: 24, bm_fable: 25, bm_george: 26, bm_lewis: 27,
}

/** The default voice (highest graded in the Kokoro voice table). */
export const DEFAULT_VOICE = 'am_michael'
const DEFAULT_SPEED = 1
const MIN_SPEED = 0.7
const MAX_SPEED = 1.3
/** Silence added after each sentence so sentences do not run together. */
const PAUSE_SECONDS = 0.15

/** Voice and speed from the environment. */
export interface TtsOptions {
  voice: string
  sid: number
  speed: number
}

/**
 * Read `AIR_VOICE_TTS_VOICE` (a voice name such as `bf_emma`, or a speaker number) and `AIR_VOICE_TTS_SPEED`
 * (0.7 to 1.3). Unknown values fall back to `am_michael` at 1.0.
 * @param env - process environment.
 * @returns the voice name, its speaker id, and the speed.
 */
export function resolveTtsOptions(env: Record<string, string | undefined>): TtsOptions {
  const wanted = env['AIR_VOICE_TTS_VOICE']?.trim() ?? ''
  const byName = KOKORO_VOICES[wanted]
  const number = /^\d+$/.test(wanted) ? Number(wanted) : undefined
  const named = Object.entries(KOKORO_VOICES).find(([, sid]) => sid === number)
  const voice = byName !== undefined ? wanted : named !== undefined ? named[0] : DEFAULT_VOICE
  const speed = Number(env['AIR_VOICE_TTS_SPEED'])
  const valid = env['AIR_VOICE_TTS_SPEED'] !== undefined && Number.isFinite(speed)
  return { voice, sid: KOKORO_VOICES[voice] as number, speed: valid ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) : DEFAULT_SPEED }
}

/** Files that must exist for Kokoro to run. */
export function kokoroFiles(dir: string): string[] {
  return [join(dir, 'model.onnx'), join(dir, 'voices.bin'), join(dir, 'tokens.txt'), join(dir, 'lexicon-us-en.txt'), join(dir, 'espeak-ng-data', 'phontab')]
}

/**
 * Pick the speech engine: `AIR_VOICE_TTS=sapi` forces SAPI, `kokoro` or unset uses Kokoro when its files exist.
 * @param env - process environment.
 * @param dir - the `tts-en` model folder.
 * @param exists - whether a file exists.
 * @returns `kokoro` or `sapi`.
 */
export function chooseTts(env: Record<string, string | undefined>, dir: string, exists: (path: string) => boolean): 'kokoro' | 'sapi' {
  if (env['AIR_VOICE_TTS'] === 'sapi') return 'sapi'
  return kokoroFiles(dir).every(exists) ? 'kokoro' : 'sapi'
}

/**
 * @param dir - the `tts-en` model folder.
 * @param threads - ONNX threads.
 * @returns the sherpa `OfflineTts` configuration for Kokoro (US English lexicon, espeak data for other words).
 */
export function kokoroConfig(dir: string, threads: number): object {
  return {
    model: {
      kokoro: {
        model: join(dir, 'model.onnx'),
        voices: join(dir, 'voices.bin'),
        tokens: join(dir, 'tokens.txt'),
        dataDir: join(dir, 'espeak-ng-data'),
        lexicon: join(dir, 'lexicon-us-en.txt'),
      },
      numThreads: threads,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  }
}

/** The part of sherpa's `OfflineTts` used here. */
export interface TtsLike {
  generate(request: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number }
}

/** The sherpa-onnx-node class the engine builds. */
export interface TtsSherpa {
  OfflineTts: new (config: object) => TtsLike
}

/** Everything the engine needs. */
export interface TtsEngineConfig {
  sherpa: TtsSherpa
  dir: string
  sid: number
  speed: number
  /** One output line (without the newline). */
  write: (line: string) => void
  /** Run a function soon, after pending input events; defaults to `setImmediate`. */
  defer?: (fn: () => void) => void
  /** Report a synthesis failure. */
  onError?: (error: Error) => void
  threads?: number
}

/** Renders queued sentences one at a time, leaving the event loop free between sentences so `STOP` gets through. */
export class TtsWorkerEngine {
  private readonly tts: TtsLike
  private readonly queue: string[] = []
  private running = false
  private readonly defer: (fn: () => void) => void

  constructor(private readonly config: TtsEngineConfig) {
    this.tts = new config.sherpa.OfflineTts(kokoroConfig(config.dir, config.threads ?? 4))
    this.defer = config.defer ?? ((fn) => { setImmediate(fn) })
  }

  /** Warm the model with a short sentence so the first real one is not slow. */
  warm(): void {
    this.tts.generate({ text: 'Ready.', sid: this.config.sid, speed: this.config.speed })
  }

  /** @param line - one protocol line from stdin. */
  handleLine(line: string): void {
    if (line.startsWith('SAY ')) {
      this.queue.push(Buffer.from(line.slice(4).trim(), 'base64').toString('utf8'))
      this.pump()
    } else if (line.trim() === 'STOP') {
      for (let dropped = this.queue.splice(0).length; dropped > 0; dropped--) this.config.write('DONE')
    }
  }

  private pump(): void {
    if (this.running) return
    this.running = true
    this.defer(() => {
      this.step()
    })
  }

  private step(): void {
    const text = this.queue.shift()
    if (text === undefined) {
      this.running = false
      return
    }
    try {
      const audio = this.tts.generate({ text, sid: this.config.sid, speed: this.config.speed })
      const padded = new Float32Array(audio.samples.length + Math.round(audio.sampleRate * PAUSE_SECONDS))
      padded.set(audio.samples)
      this.config.write(`WAV ${encodeWav(padded, audio.sampleRate).toString('base64')}`)
    } catch (error) {
      this.config.write('DONE')
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
    this.defer(() => {
      this.step()
    })
  }
}
