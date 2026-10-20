/**
 * Listener child process: Silero VAD + SenseVoice through `sherpa-onnx-node`.
 * Run with Node (type stripping): `node listener-worker.ts <modelDir> <sensevoice package.json>`.
 * stdin: raw Float32 little-endian 16 kHz mono samples. stdout: one JSON object per line,
 * `{"ready":true,"loadMs":n}` once, then `{"text":"...","durationMs":n}` per speech segment.
 * Audio and transcripts are never written anywhere else.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

interface SpeechSegment {
  samples: Float32Array
}

interface Vad {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  front(enableExternalBuffer?: boolean): SpeechSegment
  pop(): void
  flush(): void
}

interface OfflineStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
}

interface OfflineRecognizer {
  createStream(): OfflineStream
  decode(stream: OfflineStream): void
  getResult(stream: OfflineStream): { text: string }
}

interface Sherpa {
  Vad: new (config: object, bufferSizeInSeconds: number) => Vad
  OfflineRecognizer: new (config: object) => OfflineRecognizer
}

const SAMPLE_RATE = 16_000
const WINDOW = 512

const [modelDir, sherpaFrom] = process.argv.slice(2)
if (modelDir === undefined || sherpaFrom === undefined) {
  process.stderr.write('usage: listener-worker.ts <modelDir> <sensevoice package.json>\n')
  process.exit(2)
}

const sherpa = createRequire(sherpaFrom)('sherpa-onnx-node') as Sherpa
const startedAt = performance.now()
const vad = new sherpa.Vad({
  sileroVad: {
    model: join(modelDir, 'silero_vad.onnx'),
    threshold: 0.5,
    minSilenceDuration: 0.5,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 15,
    windowSize: WINDOW,
  },
  sampleRate: SAMPLE_RATE,
  numThreads: 1,
  provider: 'cpu',
  debug: 0,
}, 30)
const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: join(modelDir, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
    tokens: join(modelDir, 'tokens.txt'),
    numThreads: 4,
    provider: 'cpu',
    debug: 0,
  },
})

function send(value: object): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

send({ ready: true, loadMs: Math.round(performance.now() - startedAt) })

function drain(): void {
  while (!vad.isEmpty()) {
    const samples = vad.front(false).samples
    vad.pop()
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    recognizer.decode(stream)
    const text = recognizer.getResult(stream).text.trim()
    if (text !== '') send({ text, durationMs: Math.round(samples.length / (SAMPLE_RATE / 1000)) })
  }
}

let bytes = Buffer.alloc(0)
let samples = new Float32Array(0)

process.stdin.on('data', (chunk: Buffer) => {
  bytes = Buffer.concat([bytes, chunk])
  const usable = bytes.length - (bytes.length % 4)
  const incoming = new Float32Array(usable / 4)
  for (let index = 0; index < incoming.length; index++) incoming[index] = bytes.readFloatLE(index * 4)
  bytes = bytes.subarray(usable)
  const joined = new Float32Array(samples.length + incoming.length)
  joined.set(samples)
  joined.set(incoming, samples.length)
  let offset = 0
  while (joined.length - offset >= WINDOW) {
    vad.acceptWaveform(joined.subarray(offset, offset + WINDOW))
    offset += WINDOW
  }
  samples = joined.slice(offset)
  drain()
})

process.stdin.on('end', () => {
  vad.flush()
  drain()
  process.exit(0)
})
