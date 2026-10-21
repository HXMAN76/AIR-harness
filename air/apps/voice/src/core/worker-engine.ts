/**
 * The listener worker's logic with the sherpa-onnx classes injected, so it is testable without models.
 * Wake mode `kws`: a streaming keyword spotter runs on every frame; speech is decoded only after a wake.
 * Wake mode `text` (fallback): every VAD segment is decoded and matched against the wake phrases.
 */
import { join } from 'node:path'
import type { Lang, WorkerMessage } from './frames.ts'
import { SpotterGain } from './gain.ts'
import { matchWake, TEXT_FALLBACK_WAKE_PHRASES } from './wake.ts'

/** A speech segment from the VAD. */
export interface SpeechSegment {
  samples: Float32Array
}

/** The part of sherpa's `Vad` used here. */
export interface Vad {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  isDetected(): boolean
  front(enableExternalBuffer?: boolean): SpeechSegment
  pop(): void
  reset(): void
  flush(): void
}

/** A stream shared by the keyword spotter and recognisers. */
export interface Stream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
}

/** The part of sherpa's `OfflineRecognizer` used here. */
export interface Recognizer {
  createStream(): Stream
  decode(stream: Stream): void
  getResult(stream: Stream): { text: string }
}

/** The part of sherpa's `KeywordSpotter` used here. */
export interface Spotter {
  createStream(): Stream
  isReady(stream: Stream): boolean
  decode(stream: Stream): void
  reset(stream: Stream): void
  getResult(stream: Stream): { keyword: string }
}

/** The sherpa-onnx-node classes the engine builds. */
export interface Sherpa {
  Vad: new (config: object, bufferSizeInSeconds: number) => Vad
  OfflineRecognizer: new (config: object) => Recognizer
  KeywordSpotter: new (config: object) => Spotter
}

/** Where the model files are and how the engine behaves. */
export interface EngineConfig {
  sherpa: Sherpa
  /** `~/.air/voice-models`; the SenseVoice fallback reads its model and tokens from here. */
  modelsRoot: string
  /** Directories of the lock entries `vad`, `kws`, `asr-en`, `asr-ta`. */
  dirs: { vad: string; kws: string; asrEn: string; asrTa: string }
  keywordsFile: string
  wake: 'kws' | 'text'
  asr: 'parakeet' | 'sensevoice'
  send(message: WorkerMessage): void
  /** Milliseconds clock; defaults to `performance.now`. */
  now?: () => number
  /** Keyword boost and trigger threshold applied to keywords without their own. */
  keywordsScore?: number | undefined
  keywordsThreshold?: number | undefined
}

/** Sample rate of all audio. */
export const SAMPLE_RATE = 16_000
/** Silero VAD window in samples. */
const WINDOW = 512
/** Seconds to wait for speech after a wake before giving up. */
export const NO_SPEECH_TIMEOUT_S = 6

/** Builds the offline recognisers lazily and runs the wake and capture loop. */
export class WorkerEngine {
  private readonly c: EngineConfig
  private readonly now: () => number
  private readonly vad: Vad
  private readonly spotter: Spotter | undefined
  private readonly spotterStream: Stream | undefined
  private readonly gain = new SpotterGain()
  private readonly recognizers: Partial<Record<Lang, Recognizer>> = {}
  private lang: Lang = 'en'
  /** kws mode: speech is being captured after a wake. Text mode: always true. */
  private capturing: boolean
  private pending = new Float32Array(0)
  /** Seconds of audio received so far. */
  private clock = 0
  /** Audio second at which a command is no longer awaited; 0 when none is. */
  private deadline = 0

  /** @param config - models, mode and output. Loads the VAD, the spotter (kws mode), and the English recogniser; sends `ready`. */
  constructor(config: EngineConfig) {
    this.c = config
    this.now = config.now ?? (() => performance.now())
    const started = this.now()
    this.vad = new config.sherpa.Vad({
      sileroVad: {
        model: join(config.dirs.vad, 'silero_vad.onnx'),
        threshold: 0.5,
        minSilenceDuration: 0.35,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 10,
        windowSize: WINDOW,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    }, 30)
    if (config.wake === 'kws') {
      this.spotter = new config.sherpa.KeywordSpotter({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: join(config.dirs.kws, 'encoder.int8.onnx'),
            decoder: join(config.dirs.kws, 'decoder.int8.onnx'),
            joiner: join(config.dirs.kws, 'joiner.int8.onnx'),
          },
          tokens: join(config.dirs.kws, 'tokens.txt'),
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        maxActivePaths: 4,
        numTrailingBlanks: 1,
        keywordsScore: config.keywordsScore ?? 2.5,
        keywordsThreshold: config.keywordsThreshold ?? 0.15,
        keywordsFile: config.keywordsFile,
      })
      this.spotterStream = this.spotter.createStream()
    }
    this.recognizers.en = this.load('en')
    this.capturing = config.wake === 'text'
    config.send({ ready: true, loadMs: Math.round(this.now() - started) })
  }

  /**
   * Switch the recogniser used for the next command; the Tamil model loads on first use.
   * @param lang - `en` or `ta`.
   */
  setLanguage(lang: Lang): void {
    const started = this.now()
    try {
      this.recognizers[lang] ??= this.load(lang)
    } catch (error) {
      this.c.send({ type: 'error', message: `cannot load ${lang} model: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
    this.lang = lang
    this.c.send({ type: 'language', lang, loadMs: Math.round(this.now() - started) })
  }

  /**
   * Feed 16 kHz mono samples.
   * @param samples - any number of samples.
   */
  push(samples: Float32Array): void {
    this.clock += samples.length / SAMPLE_RATE
    if (this.capturing) this.capture(samples)
    else this.listen(samples)
  }

  /**
   * Listen for one command without a wake word (the follow-up window after a spoken question).
   * It ends like a normal capture: a command, or a timeout after {@link NO_SPEECH_TIMEOUT_S}.
   */
  arm(): void {
    this.capturing = true
    this.deadline = this.clock + NO_SPEECH_TIMEOUT_S
    this.pending = new Float32Array(0)
    this.vad.reset()
  }

  /** The input ended: finish a speech segment in progress. */
  finish(): void {
    if (!this.capturing) return
    this.vad.flush()
    this.drain()
  }

  private load(lang: Lang): Recognizer {
    const { sherpa, dirs, modelsRoot } = this.c
    const common = { numThreads: 4, provider: 'cpu', debug: 0 }
    const featConfig = { sampleRate: SAMPLE_RATE, featureDim: 80 }
    if (lang === 'ta') {
      return new sherpa.OfflineRecognizer({
        featConfig,
        modelConfig: { nemoCtc: { model: join(dirs.asrTa, 'model.int8.onnx') }, tokens: join(dirs.asrTa, 'tokens.txt'), ...common },
      })
    }
    if (this.c.asr === 'sensevoice') {
      return new sherpa.OfflineRecognizer({
        featConfig,
        modelConfig: { senseVoice: { model: join(modelsRoot, 'model.int8.onnx'), language: 'en', useInverseTextNormalization: 1 }, tokens: join(modelsRoot, 'tokens.txt'), ...common },
      })
    }
    return new sherpa.OfflineRecognizer({
      featConfig,
      modelConfig: {
        transducer: { encoder: join(dirs.asrEn, 'encoder.int8.onnx'), decoder: join(dirs.asrEn, 'decoder.int8.onnx'), joiner: join(dirs.asrEn, 'joiner.int8.onnx') },
        tokens: join(dirs.asrEn, 'tokens.txt'),
        modelType: 'nemo_transducer',
        ...common,
      },
    })
  }

  /** kws mode, idle: only the keyword spotter sees the audio. */
  private listen(samples: Float32Array): void {
    const spotter = this.spotter as Spotter
    const stream = this.spotterStream as Stream
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: this.gain.apply(samples) })
    while (spotter.isReady(stream)) spotter.decode(stream)
    if (spotter.getResult(stream).keyword === '') return
    spotter.reset(stream)
    this.c.send({ type: 'wake' })
    this.capturing = true
    this.deadline = this.clock + NO_SPEECH_TIMEOUT_S
    this.pending = new Float32Array(0)
    this.vad.reset()
  }

  /** Stop capturing: back to the spotter in kws mode. */
  private endCapture(): void {
    this.deadline = 0
    this.vad.reset()
    this.pending = new Float32Array(0)
    if (this.c.wake === 'kws') this.capturing = false
  }

  private capture(samples: Float32Array): void {
    const joined = new Float32Array(this.pending.length + samples.length)
    joined.set(this.pending)
    joined.set(samples, this.pending.length)
    let offset = 0
    while (joined.length - offset >= WINDOW) {
      this.vad.acceptWaveform(joined.subarray(offset, offset + WINDOW))
      offset += WINDOW
    }
    this.pending = joined.slice(offset)
    this.drain()
    if (this.capturing && this.deadline > 0 && this.clock > this.deadline && !this.vad.isDetected()) {
      this.c.send({ type: 'timeout' })
      this.endCapture()
    }
  }

  private drain(): void {
    while (!this.vad.isEmpty()) {
      const samples = this.vad.front(false).samples
      this.vad.pop()
      const audioMs = Math.round(samples.length / (SAMPLE_RATE / 1000))
      const started = this.now()
      const text = this.decode(samples)
      const decodeMs = Math.round(this.now() - started)
      if (this.c.wake === 'kws') {
        // The spotter fires inside "Jarvis", so the first segment is often the rest of the wake word
        // or noise; keep waiting for the command until the deadline instead of ending the capture.
        const command = text.replace(/^\W*((hey|ok)\s+)?jarvis\W*/i, '').trim()
        if (command === '') continue
        this.c.send({ type: 'command', text: command, lang: this.lang, audioMs, decodeMs })
        this.endCapture()
        return
      }
      this.textWake(text, audioMs, decodeMs)
    }
  }

  /** Fallback wake: a segment is a command when it starts with a wake phrase or follows a bare wake phrase. */
  private textWake(text: string, audioMs: number, decodeMs: number): void {
    const awaiting = this.deadline > 0 && this.clock <= this.deadline
    this.deadline = 0
    const match = matchWake(text, TEXT_FALLBACK_WAKE_PHRASES)
    if (!match.wake) {
      if (awaiting) this.c.send({ type: 'command', text, lang: this.lang, audioMs, decodeMs })
      return
    }
    this.c.send({ type: 'wake' })
    if (match.command === '') this.deadline = this.clock + NO_SPEECH_TIMEOUT_S
    else this.c.send({ type: 'command', text: match.command, lang: this.lang, audioMs, decodeMs })
  }

  private decode(samples: Float32Array): string {
    const recognizer = this.recognizers[this.lang] as Recognizer
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    recognizer.decode(stream)
    return recognizer.getResult(stream).text.trim()
  }
}
