/**
 * Renders a sample sentence pair with Kokoro voices and prints load time, real-time factor and time to first audio.
 * `pnpm -C air/apps/voice exec tsx scripts/tts-bench.ts [outDir]` writes `<voice>.wav` per voice into outDir
 * (default `~/.air/voice-ui-shots/voices`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SENSEVOICE_PACKAGE_JSON } from '../src/core/paths.ts'
import { modelDir } from '../src/core/models.ts'
import { encodeWav } from '../src/core/wav.ts'
import { KOKORO_VOICES, kokoroConfig } from '../src/core/tts-engine.ts'

const out = process.argv[2] ?? join(homedir(), '.air', 'voice-ui-shots', 'voices')
mkdirSync(out, { recursive: true })
const dir = modelDir('tts-en')
const sherpa = createRequire(SENSEVOICE_PACKAGE_JSON)('sherpa-onnx-node') as { OfflineTts: new (config: object) => { sampleRate: number; numSpeakers: number; generate(request: object): { samples: Float32Array; sampleRate: number } } }
const SAMPLE = ['Good evening.', 'I can read your important mail, read today\'s news, or open an app.']

let started = performance.now()
const tts = new sherpa.OfflineTts(kokoroConfig(dir, Number(process.env.THREADS ?? 4)))
console.log(`load ${Math.round(performance.now() - started)} ms, ${tts.numSpeakers} speakers, ${tts.sampleRate} Hz`)
tts.generate({ text: 'Warm up.', sid: 3, speed: 1 })
const names = process.env.VOICES?.split(',') ?? ['af_heart', 'af_bella', 'bf_emma', 'am_michael']
const speed = Number(process.env.SPEED ?? 1)
for (const name of names) {
  const sid = KOKORO_VOICES[name] as number
  started = performance.now()
  const parts: Float32Array[] = []
  let first = 0
  let rate = 24_000
  for (const sentence of SAMPLE) {
    const audio = tts.generate({ text: sentence, sid, speed })
    if (first === 0) first = performance.now() - started
    rate = audio.sampleRate
    parts.push(audio.samples, new Float32Array(Math.round(rate * 0.28)))
  }
  const total = performance.now() - started
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Float32Array(length)
  let at = 0
  for (const part of parts) { merged.set(part, at); at += part.length }
  const seconds = length / rate
  writeFileSync(join(out, `${name}${speed === 1 ? '' : `-speed${speed}`}.wav`), encodeWav(merged, rate))
  console.log(`${name} sid ${sid}: first sentence ${Math.round(first)} ms, total ${Math.round(total)} ms for ${seconds.toFixed(2)} s audio, RTF ${(total / 1000 / seconds).toFixed(3)}`)
}
