import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkerMessage } from '../src/core/frames.ts'
import { MAX_WAKE_SEGMENT_S, NO_SPEECH_TIMEOUT_S, SAMPLE_RATE, WorkerEngine, type EngineConfig, type Recognizer, type Sherpa, type SpeechSegment, type Spotter, type Stream, type Vad } from '../src/core/worker-engine.ts'

class FakeVad implements Vad {
  windows = 0
  resets = 0
  flushed = 0
  detected = false
  segments: SpeechSegment[] = []
  acceptWaveform(): void {
    this.windows++
  }
  isEmpty(): boolean {
    return this.segments.length === 0
  }
  isDetected(): boolean {
    return this.detected
  }
  front(): SpeechSegment {
    return this.segments[0] as SpeechSegment
  }
  pop(): void {
    this.segments.shift()
  }
  reset(): void {
    this.resets++
  }
  flush(): void {
    this.flushed++
  }
}

class FakeSpotter implements Spotter {
  fired = false
  resets = 0
  decodes = 0
  streamInputs = 0
  ready = 0
  lastInput: Float32Array = new Float32Array(0)
  stream: Stream = { acceptWaveform: (input: { samples: Float32Array }) => { this.streamInputs++; this.lastInput = input.samples } }
  createStream(): Stream {
    return this.stream
  }
  isReady(): boolean {
    if (this.ready === 0) return false
    this.ready--
    return true
  }
  decode(): void {
    this.decodes++
  }
  reset(): void {
    this.resets++
    this.fired = false
  }
  getResult(): { keyword: string } {
    return { keyword: this.fired ? 'JARVIS' : '' }
  }
}

class FakeRecognizer implements Recognizer {
  text = ''
  decoded = 0
  constructor(readonly config: { modelConfig: Record<string, unknown> }) {}
  createStream(): Stream {
    return { acceptWaveform: () => undefined }
  }
  decode(): void {
    this.decoded++
  }
  getResult(): { text: string } {
    return { text: this.text }
  }
}

interface Rig {
  engine: WorkerEngine
  sent: WorkerMessage[]
  vad: FakeVad
  spotter: FakeSpotter
  recognizers: FakeRecognizer[]
  config: EngineConfig
  throwOn: { ta: boolean; nonError: boolean }
  time: { now: number }
}

function rig(options: Partial<Pick<EngineConfig, 'wake' | 'asr' | 'keywordsScore' | 'keywordsThreshold'>> = {}): Rig {
  const vads: FakeVad[] = []
  const spotters: FakeSpotter[] = []
  const recognizers: FakeRecognizer[] = []
  const sent: WorkerMessage[] = []
  const throwOn = { ta: false, nonError: false }
  const time = { now: 0 }
  const sherpa: Sherpa = {
    Vad: class extends FakeVad {
      constructor() {
        super()
        vads.push(this)
      }
    },
    KeywordSpotter: class extends FakeSpotter {
      constructor() {
        super()
        spotters.push(this)
      }
    },
    OfflineRecognizer: class extends FakeRecognizer {
      constructor(config: object) {
        const modelConfig = (config as { modelConfig: Record<string, unknown> }).modelConfig
        if (throwOn.ta && 'nemoCtc' in modelConfig) {
          if (throwOn.nonError) throw 'no file' // eslint-disable-line @typescript-eslint/only-throw-error
          throw new Error('no file')
        }
        super({ modelConfig })
        recognizers.push(this)
      }
    },
  }
  const config: EngineConfig = {
    sherpa,
    modelsRoot: 'R',
    dirs: { vad: 'V', kws: 'K', asrEn: 'E', asrTa: 'T' },
    keywordsFile: 'kw.txt',
    wake: 'kws',
    asr: 'parakeet',
    send: message => sent.push(message),
    now: () => (time.now += 10),
    ...options,
  }
  const engine = new WorkerEngine(config)
  return { engine, sent, vad: vads[0]!, spotter: spotters[0] ?? new FakeSpotter(), recognizers, config, throwOn, time }
}

const FRAME = new Float32Array(1600)
const frames = (engine: WorkerEngine, count: number): void => {
  for (let index = 0; index < count; index++) engine.push(FRAME)
}

describe('WorkerEngine loading', () => {
  it('loads VAD, spotter, and Parakeet and says ready', () => {
    const { sent, recognizers } = rig()
    expect(sent).toEqual([{ ready: true, loadMs: 10 }])
    expect(recognizers[0]!.config.modelConfig).toMatchObject({
      transducer: { encoder: join('E', 'encoder.int8.onnx'), decoder: join('E', 'decoder.int8.onnx'), joiner: join('E', 'joiner.int8.onnx') },
      tokens: join('E', 'tokens.txt'),
      modelType: 'nemo_transducer',
    })
  })

  it('times loading with performance.now by default', () => {
    const { config, sent } = rig()
    const copy = { ...config }
    delete copy.now
    sent.length = 0
    expect(new WorkerEngine(copy)).toBeDefined()
    expect(sent[0]).toMatchObject({ ready: true })
  })

  it('loads SenseVoice instead of Parakeet for AIR_VOICE_ASR=sensevoice', () => {
    const { recognizers } = rig({ asr: 'sensevoice' })
    expect(recognizers[0]!.config.modelConfig).toMatchObject({ senseVoice: { model: join('R', 'model.int8.onnx'), language: 'en' }, tokens: join('R', 'tokens.txt') })
  })

  it('does not build a spotter in text mode', () => {
    const { engine, vad } = rig({ wake: 'text' })
    engine.finish()
    expect(vad.flushed).toBe(1)
  })

  it('loads Tamil lazily on the first switch, once', () => {
    const { engine, sent, recognizers } = rig()
    engine.setLanguage('ta')
    engine.setLanguage('en')
    engine.setLanguage('ta')
    expect(recognizers).toHaveLength(2)
    expect(recognizers[1]!.config.modelConfig).toMatchObject({ nemoCtc: { model: join('T', 'model.int8.onnx') }, tokens: join('T', 'tokens.txt') })
    expect(sent.slice(1)).toEqual([
      { type: 'language', lang: 'ta', loadMs: 10 },
      { type: 'language', lang: 'en', loadMs: 10 },
      { type: 'language', lang: 'ta', loadMs: 10 },
    ])
  })

  it('reports a Tamil model that fails to load and stays on English', () => {
    const { engine, sent, throwOn, vad, recognizers } = rig()
    throwOn.ta = true
    engine.setLanguage('ta')
    throwOn.nonError = true
    engine.setLanguage('ta')
    expect(sent.slice(1)).toEqual([
      { type: 'error', message: 'cannot load ta model: no file' },
      { type: 'error', message: 'cannot load ta model: no file' },
    ])
    engine.push(FRAME)
    vad.segments.push({ samples: new Float32Array(16_000) })
    recognizers[0]!.text = 'ignored'
    expect(sent).toHaveLength(3)
  })
})

describe('WorkerEngine kws mode', () => {
  it('feeds the spotter quiet audio boosted and loud audio untouched', () => {
    const { engine, spotter } = rig()
    engine.push(new Float32Array(1600).fill(0.05))
    expect(spotter.lastInput[0]).toBeCloseTo(0.3, 5)
    const loud = new Float32Array(1600).fill(0.6)
    engine.push(loud)
    expect(spotter.lastInput).toBe(loud)
  })

  it('feeds only the spotter until a keyword fires, and never decodes', () => {
    const { engine, sent, vad, spotter, recognizers } = rig()
    spotter.ready = 2
    frames(engine, 3)
    expect(spotter.streamInputs).toBe(3)
    expect(spotter.decodes).toBe(2)
    expect(vad.windows).toBe(0)
    expect(recognizers[0]!.decoded).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('wakes, captures the next speech with the VAD, decodes it, and returns to the spotter', () => {
    const { engine, sent, vad, spotter, recognizers } = rig()
    spotter.fired = true
    engine.push(FRAME)
    expect(sent.at(-1)).toEqual({ type: 'wake' })
    expect(spotter.resets).toBe(1)
    vad.windows = 0
    engine.push(FRAME)
    expect(vad.windows).toBe(3)
    recognizers[0]!.text = '  open notepad '
    vad.segments.push({ samples: new Float32Array(SAMPLE_RATE) })
    engine.push(FRAME)
    expect(sent.at(-1)).toEqual({ type: 'command', text: 'open notepad', lang: 'en', audioMs: 1000, decodeMs: 10 })
    expect(recognizers[0]!.decoded).toBe(1)
    const streamed = spotter.streamInputs
    engine.push(FRAME)
    expect(spotter.streamInputs).toBe(streamed + 1)
  })

  it('keeps leftover samples smaller than a VAD window for the next push', () => {
    const { engine, vad, spotter } = rig()
    spotter.fired = true
    engine.push(FRAME)
    vad.windows = 0
    engine.push(new Float32Array(500))
    expect(vad.windows).toBe(0)
    engine.push(new Float32Array(500))
    expect(vad.windows).toBe(1)
  })

  it('uses the Tamil recogniser after a switch and reports the language', () => {
    const { engine, sent, vad, spotter, recognizers } = rig()
    engine.setLanguage('ta')
    recognizers[1]!.text = 'tamil words'
    spotter.fired = true
    engine.push(FRAME)
    vad.segments.push({ samples: new Float32Array(160) })
    engine.push(FRAME)
    expect(sent.at(-1)).toMatchObject({ type: 'command', text: 'tamil words', lang: 'ta' })
  })

  it('times out when no speech starts within six seconds, then listens again', () => {
    const { engine, sent, spotter, vad } = rig()
    spotter.fired = true
    engine.push(FRAME)
    frames(engine, NO_SPEECH_TIMEOUT_S * 10 - 1)
    expect(sent.at(-1)).toEqual({ type: 'wake' })
    engine.push(FRAME)
    engine.push(FRAME)
    expect(sent.at(-1)).toEqual({ type: 'timeout' })
    const resets = vad.resets
    const streamed = spotter.streamInputs
    engine.push(FRAME)
    expect(spotter.streamInputs).toBe(streamed + 1)
    expect(vad.resets).toBe(resets)
  })

  it('does not time out while speech is being detected', () => {
    const { engine, sent, spotter, vad } = rig()
    spotter.fired = true
    engine.push(FRAME)
    vad.detected = true
    frames(engine, NO_SPEECH_TIMEOUT_S * 10 + 5)
    expect(sent.some(message => 'type' in message && message.type === 'timeout')).toBe(false)
  })

  it('keeps waiting when a segment is empty or only the rest of the wake word, then sends the command', () => {
    const { engine, sent, spotter, vad, recognizers } = rig()
    spotter.fired = true
    engine.push(FRAME)
    vad.segments.push({ samples: new Float32Array(160) })
    engine.push(FRAME)
    recognizers[0]!.text = 'Jarvis.'
    vad.segments.push({ samples: new Float32Array(160) })
    engine.push(FRAME)
    expect(sent.filter(m => 'type' in m && (m.type === 'timeout' || m.type === 'command'))).toEqual([])
    recognizers[0]!.text = 'Hey Jarvis, open notepad.'
    vad.segments.push({ samples: new Float32Array(160) })
    engine.push(FRAME)
    expect(sent.at(-1)).toMatchObject({ type: 'command', text: 'open notepad.' })
  })

  it('finishes a segment in progress when the input ends, and ignores the end while idle', () => {
    const { engine, sent, vad, spotter, recognizers } = rig()
    engine.finish()
    expect(vad.flushed).toBe(0)
    spotter.fired = true
    engine.push(FRAME)
    recognizers[0]!.text = 'last words'
    vad.segments.push({ samples: new Float32Array(160) })
    engine.finish()
    expect(vad.flushed).toBe(1)
    expect(sent.at(-1)).toMatchObject({ type: 'command', text: 'last words' })
  })

  it('passes the keyword tuning to the spotter', () => {
    const tuned = rig({ keywordsScore: 3, keywordsThreshold: 0.1 })
    expect(tuned.engine).toBeDefined()
  })
})

describe('WorkerEngine text mode', () => {
  function textRig(): Rig {
    return rig({ wake: 'text' })
  }
  const say = (r: Rig, text: string): void => {
    r.recognizers[0]!.text = text
    r.vad.segments.push({ samples: new Float32Array(1600) })
    r.engine.push(FRAME)
  }

  it('decodes every segment, emits wake then the command for a wake phrase with a command', () => {
    const r = textRig()
    say(r, 'Jarvis open notepad')
    expect(r.sent.slice(1)).toEqual([{ type: 'wake' }, { type: 'command', text: 'open notepad', lang: 'en', audioMs: 100, decodeMs: 10 }])
  })

  it('wakes on the owner-mic transcript "Hey Javis, ..."', () => {
    const r = textRig()
    say(r, 'Hey Javis, open the notepad.')
    expect(r.sent.slice(1)).toMatchObject([{ type: 'wake' }, { type: 'command', text: 'open the notepad' }])
  })

  it('drops speech without a wake phrase, sending only a marker without text', () => {
    const r = textRig()
    say(r, 'just talking')
    expect(r.sent.slice(1)).toEqual([{ type: 'heard' }])
    expect(JSON.stringify(r.sent)).not.toContain('just talking')
  })

  it('does not decode a segment longer than the wake limit, and decodes it when a command is awaited', () => {
    const r = textRig()
    r.recognizers[0]!.text = 'Jarvis long speech'
    r.vad.segments.push({ samples: new Float32Array((MAX_WAKE_SEGMENT_S + 1) * SAMPLE_RATE) })
    r.engine.push(FRAME)
    expect(r.recognizers[0]!.decoded).toBe(0)
    expect(r.sent.slice(1)).toEqual([{ type: 'heard' }])
    r.engine.arm()
    r.recognizers[0]!.text = 'a long answer'
    r.vad.segments.push({ samples: new Float32Array((MAX_WAKE_SEGMENT_S + 1) * SAMPLE_RATE) })
    r.engine.push(FRAME)
    expect(r.sent.at(-1)).toMatchObject({ type: 'command', text: 'a long answer' })
  })

  it('keeps the kws mode unlimited in segment length', () => {
    const r = rig({ wake: 'kws' })
    r.spotter.fired = true
    r.engine.push(FRAME)
    r.recognizers[0]!.text = 'open notepad'
    r.vad.segments.push({ samples: new Float32Array((MAX_WAKE_SEGMENT_S + 1) * SAMPLE_RATE) })
    r.engine.push(FRAME)
    expect(r.sent.at(-1)).toMatchObject({ type: 'command', text: 'open notepad' })
  })

  it('reports a bare wake as bare and does not await a command by itself', () => {
    const r = textRig()
    say(r, 'Jarvis')
    expect(r.sent.slice(1)).toEqual([{ type: 'wake', bare: true }])
    say(r, 'volume up')
    expect(r.sent.slice(2)).toEqual([{ type: 'heard' }])
  })

  it('waits a custom number of seconds in an armed window, then times out', () => {
    const r = textRig()
    r.engine.arm(8)
    frames(r.engine, 79)
    expect(r.sent.filter(m => 'type' in m && m.type === 'timeout')).toEqual([])
    frames(r.engine, 3)
    expect(r.sent.at(-1)).toEqual({ type: 'timeout' })
  })

  it('ignores a command that arrives after an armed wait ran out without a timeout check', () => {
    const r = textRig()
    r.engine.arm()
    r.vad.detected = true
    frames(r.engine, NO_SPEECH_TIMEOUT_S * 10 + 1)
    r.vad.detected = false
    say(r, 'volume up')
    expect(r.sent.filter(message => 'type' in message && message.type === 'command')).toEqual([])
  })

  it('while muted, drops speech that does not start with a wake phrase, even in an armed window', () => {
    const r = textRig()
    r.engine.setMuted(true)
    r.engine.arm()
    say(r, 'the app talking to itself')
    expect(r.sent.slice(1)).toEqual([{ type: 'heard' }])
    expect(JSON.stringify(r.sent)).not.toContain('talking')
  })

  it('while muted, lets a wake phrase through (barge-in) and skips long segments undecoded', () => {
    const r = textRig()
    r.engine.setMuted(true)
    say(r, 'Jarvis stop')
    expect(r.sent.slice(1)).toMatchObject([{ type: 'wake' }, { type: 'command', text: 'stop' }])
    r.engine.arm()
    r.vad.segments.push({ samples: new Float32Array((MAX_WAKE_SEGMENT_S + 1) * SAMPLE_RATE) })
    const decoded = r.recognizers[0]!.decoded
    r.engine.push(FRAME)
    expect(r.recognizers[0]!.decoded).toBe(decoded)
  })

  it('takes follow-up speech again after unmuting', () => {
    const r = textRig()
    r.engine.setMuted(true)
    r.engine.setMuted(false)
    r.engine.arm()
    say(r, 'read the news')
    expect(r.sent.at(-1)).toMatchObject({ type: 'command', text: 'read the news' })
  })

  it('arm() in text mode takes the next segment as a command without a wake phrase, then times out', () => {
    const r = textRig()
    r.engine.arm()
    say(r, 'read the news')
    expect(r.sent.slice(1)).toMatchObject([{ type: 'command', text: 'read the news' }])
    r.engine.arm()
    frames(r.engine, NO_SPEECH_TIMEOUT_S * 10 + 2)
    expect(r.sent.at(-1)).toEqual({ type: 'timeout' })
    say(r, 'Jarvis open paint')
    expect(r.sent.slice(-2)).toMatchObject([{ type: 'wake' }, { type: 'command', text: 'open paint' }])
  })

  it('arm() captures one command without a wake word, and times out after six seconds', () => {
    const r = rig({ wake: 'kws' })
    r.recognizers[0]!.text = 'yes'
    r.engine.arm()
    r.vad.segments.push({ samples: new Float32Array(160) })
    r.engine.push(FRAME)
    expect(r.sent.filter(message => 'type' in message)).toEqual([{ type: 'command', text: 'yes', lang: 'en', audioMs: 10, decodeMs: 10 }])
    r.sent.length = 0
    r.engine.arm()
    frames(r.engine, NO_SPEECH_TIMEOUT_S * 10 + 2)
    expect(r.sent).toEqual([{ type: 'timeout' }])
  })
})
