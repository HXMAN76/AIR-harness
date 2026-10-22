/** The sherpa-onnx pieces the benchmarks load: the Parakeet recogniser and Kokoro, built like the app builds them. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { modelDir } from '../../src/core/models.ts'
import { SENSEVOICE_PACKAGE_JSON } from '../../src/core/paths.ts'
import { kokoroConfig, type TtsLike, type TtsSherpa } from '../../src/core/tts-engine.ts'
import type { Recognizer, Sherpa } from '../../src/core/worker-engine.ts'

/** The classes of `sherpa-onnx-node` the benchmarks use. */
export type BenchSherpa = Sherpa & TtsSherpa

/** @returns the `sherpa-onnx-node` module, resolved from the SenseVoice package like the app does. */
export function loadSherpa(): BenchSherpa {
  return createRequire(SENSEVOICE_PACKAGE_JSON)('sherpa-onnx-node') as BenchSherpa
}

/** The English Parakeet recogniser, as `WorkerEngine` configures it. */
export function createParakeet(sherpa: BenchSherpa = loadSherpa()): Recognizer {
  const dir = modelDir('asr-en')
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(dir, 'encoder.int8.onnx'), decoder: join(dir, 'decoder.int8.onnx'), joiner: join(dir, 'joiner.int8.onnx') },
      tokens: join(dir, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
    },
  })
}

/** Decode 16 kHz samples; returns the text and how long the decode took (stream creation to result), in ms. */
export function decode(recognizer: Recognizer, samples: Float32Array): { text: string; ms: number } {
  const started = performance.now()
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: 16_000, samples })
  recognizer.decode(stream)
  const text = recognizer.getResult(stream).text.trim()
  return { text, ms: performance.now() - started }
}

/** Kokoro through sherpa; also returns how long loading the model took. */
export function createKokoro(sherpa: BenchSherpa = loadSherpa(), threads = 4): { tts: TtsLike; loadMs: number } {
  const started = performance.now()
  const tts = new sherpa.OfflineTts(kokoroConfig(modelDir('tts-en'), threads))
  return { tts, loadMs: performance.now() - started }
}
