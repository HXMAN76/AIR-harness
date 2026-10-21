/**
 * Offline keyword-spotter diagnosis: stream a WAV through the same sherpa-onnx `KeywordSpotter`
 * config as the listener worker and report where each threshold would fire, with per-frame RMS and
 * peak so the noise floor and clipping are visible.
 *
 * `pnpm -C air/apps/voice exec tsx scripts/score-kws.ts <in.wav> [--asr] [--no-gain]`
 * The spotter is fed through the same quiet-audio boost as the worker (`src/core/gain.ts`); `--no-gain` feeds the raw samples.
 * Env: `AIR_VOICE_KWS_SCORE` (keyword boost, default 2.5, same as the worker),
 * `AIR_KWS_DEBUG=1` (sherpa debug logging on stderr).
 * `--asr` also transcribes the whole clip with the app's English recogniser (Parakeet), which says
 * whether the audio is intelligible at all: a good transcript and no wake means the spotter or the
 * threshold is at fault, a bad transcript means the recording is.
 *
 * Note: sherpa-onnx-node exposes only the detected keyword per decode, not a numeric confidence;
 * "score" here is the detection outcome at each threshold plus the decode count per frame.
 */
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SpotterGain } from '../src/core/gain.ts'
import { modelDir } from '../src/core/models.ts'
import { SENSEVOICE_PACKAGE_JSON, VOICE_APP_ROOT } from '../src/core/paths.ts'
import { SAMPLE_RATE } from '../src/core/worker-engine.ts'
import { readWav } from './record-mic.ts'

/** The part of sherpa's `KeywordSpotter` used here (mirrors `worker-engine.ts`). */
interface SpotterStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
}
interface Spotter {
  createStream(): SpotterStream
  isReady(stream: SpotterStream): boolean
  decode(stream: SpotterStream): void
  reset(stream: SpotterStream): void
  getResult(stream: SpotterStream): { keyword: string }
}

/** Thresholds compared in one run; 0.15 is the worker default. */
export const DIAGNOSIS_THRESHOLDS = [0.05, 0.08, 0.1, 0.15, 0.25]

/** Frame size in samples, 100 ms at 16 kHz, same as the app. */
const FRAME = 1600

/** One threshold's findings over the clip. */
export interface ThresholdReport {
  threshold: number
  decodes: number
  fires: { frame: number; atS: number; keyword: string }[]
}

/** Result of {@link scoreWav}. */
export interface ScoreReport {
  path: string
  seconds: number
  sampleRate: number
  keywordsScore: number
  frames: { rms: number; peak: number }[]
  thresholds: ThresholdReport[]
}

function keywordsScoreFromEnv(): number {
  const value = Number(process.env['AIR_VOICE_KWS_SCORE'])
  return process.env['AIR_VOICE_KWS_SCORE'] === undefined || Number.isNaN(value) ? 2.5 : value
}

function buildSpotter(threshold: number, keywordsScore: number): Spotter {
  const { KeywordSpotter } = createRequire(SENSEVOICE_PACKAGE_JSON)('sherpa-onnx-node') as { KeywordSpotter: new (config: object) => Spotter }
  const kws = modelDir('kws')
  return new KeywordSpotter({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(kws, 'encoder.int8.onnx'),
        decoder: join(kws, 'decoder.int8.onnx'),
        joiner: join(kws, 'joiner.int8.onnx'),
      },
      tokens: join(kws, 'tokens.txt'),
      numThreads: 1,
      provider: 'cpu',
      debug: process.env['AIR_KWS_DEBUG'] === '1' ? 1 : 0,
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore,
    keywordsThreshold: threshold,
    keywordsFile: join(VOICE_APP_ROOT, 'src', 'keywords.txt'),
  })
}

/**
 * Stream a WAV through one spotter per threshold and print the diagnosis.
 * @param path - 16 kHz mono 16-bit WAV file.
 * @returns the collected report.
 */
export function scoreWav(path: string, useGain = true): ScoreReport {
  const { samples, sampleRate } = readWav(path)
  if (sampleRate !== SAMPLE_RATE) throw new Error(`${path}: expected ${SAMPLE_RATE}Hz, got ${sampleRate}Hz`)
  const keywordsScore = keywordsScoreFromEnv()
  const frameCount = Math.floor(samples.length / FRAME)
  const frames: { rms: number; peak: number }[] = []
  for (let index = 0; index < frameCount; index++) {
    const frame = samples.subarray(index * FRAME, (index + 1) * FRAME)
    let squares = 0
    let peak = 0
    for (const sample of frame) {
      squares += sample * sample
      peak = Math.max(peak, Math.abs(sample))
    }
    frames.push({ rms: Math.sqrt(squares / frame.length), peak })
  }

  const reports: ThresholdReport[] = []
  for (const threshold of DIAGNOSIS_THRESHOLDS) {
    const spotter = buildSpotter(threshold, keywordsScore)
    const stream = spotter.createStream()
    const gain = new SpotterGain()
    const report: ThresholdReport = { threshold, decodes: 0, fires: [] }
    for (let index = 0; index < frameCount; index++) {
      const chunk = samples.subarray(index * FRAME, (index + 1) * FRAME)
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: useGain ? gain.apply(chunk) : chunk })
      while (spotter.isReady(stream)) {
        spotter.decode(stream)
        report.decodes++
      }
      const result = spotter.getResult(stream)
      if (result.keyword !== '') {
        report.fires.push({ frame: index, atS: (index + 1) * 0.1, keyword: result.keyword })
        spotter.reset(stream)
      }
    }
    reports.push(report)
  }

  console.log(`${path}: ${(samples.length / sampleRate).toFixed(1)}s @${sampleRate}Hz, keywordsScore ${keywordsScore}, gain ${useGain ? 'on' : 'off'}, ${frameCount} frames of 100ms`)
  console.log('frame-level audio (rms | peak, `*` = peak at or above 0.99):')
  for (let index = 0; index < frameCount; index++) {
    const { rms, peak } = frames[index] as { rms: number; peak: number }
    const fired = reports.map(report => (report.fires.some(fire => fire.frame === index) ? `T${report.threshold}` : '')).filter(entry => entry !== '')
    console.log(`  ${String(index).padStart(3)} t=${((index + 1) * 0.1).toFixed(1)}s rms=${rms.toFixed(4)} peak=${peak.toFixed(3)}${peak >= 0.99 ? '*' : ' '}${fired.length > 0 ? `  WAKE ${fired.join(' ')}` : ''}`)
  }
  console.log('threshold summary:')
  for (const report of reports) {
    const fires = report.fires.map(fire => `${fire.keyword} at ${fire.atS.toFixed(1)}s`).join(', ')
    console.log(`  threshold ${report.threshold.toFixed(2)}: ${report.decodes} decodes, ${report.fires.length} fire(s)${fires === '' ? '' : ` — ${fires}`}`)
  }
  return { path, seconds: samples.length / sampleRate, sampleRate, keywordsScore, frames, thresholds: reports }
}

/** The part of sherpa's `OfflineRecognizer` used by {@link transcribeWav}. */
interface Asr {
  createStream(): SpotterStream
  decode(stream: SpotterStream): void
  getResult(stream: SpotterStream): { text: string }
}

/**
 * Transcribe a whole clip with the app's English Parakeet recogniser.
 * @param path - 16 kHz mono 16-bit WAV file.
 * @returns the recognised text, trimmed.
 */
export function transcribeWav(path: string): string {
  const { samples, sampleRate } = readWav(path)
  if (sampleRate !== SAMPLE_RATE) throw new Error(`${path}: expected ${SAMPLE_RATE}Hz, got ${sampleRate}Hz`)
  const { OfflineRecognizer } = createRequire(SENSEVOICE_PACKAGE_JSON)('sherpa-onnx-node') as { OfflineRecognizer: new (config: object) => Asr }
  const dir = modelDir('asr-en')
  const recognizer = new OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(dir, 'encoder.int8.onnx'), decoder: join(dir, 'decoder.int8.onnx'), joiner: join(dir, 'joiner.int8.onnx') },
      tokens: join(dir, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
    },
  })
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
  recognizer.decode(stream)
  return recognizer.getResult(stream).text.trim()
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg): arg is string => arg !== undefined)
  const withAsr = args.includes('--asr')
  const input = args.find(arg => !arg.startsWith('--'))
  if (input === undefined) {
    console.error('usage: score-kws.ts <in.wav> [--asr] [--no-gain]')
    process.exit(2)
  }
  scoreWav(input, !args.includes('--no-gain'))
  if (withAsr) console.log(`asr (parakeet-en, whole clip): "${transcribeWav(input)}"`)
}
