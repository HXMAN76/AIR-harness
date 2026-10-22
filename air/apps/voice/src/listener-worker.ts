/**
 * Listener child process: keyword spotter + Silero VAD + offline recognisers through `sherpa-onnx-node`.
 * Run with Node (type stripping): `node listener-worker.ts <modelsRoot> <sherpa package.json> <keywords.txt>`.
 * Env: `AIR_VOICE_WAKE=kws` (opt-in keyword spotter; the default is text wake through the recogniser),
 * `AIR_VOICE_ASR=sensevoice` (old English recogniser),
 * `AIR_VOICE_KWS_SCORE` and `AIR_VOICE_KWS_THRESHOLD` (keyword tuning).
 * stdin: frames, see `core/frames.ts` (audio: Float32 LE 16 kHz mono; control: JSON). stdout: one JSON object per line
 * (`WorkerMessage`). Audio and transcripts are never written anywhere else. In kws mode speech without a wake is never
 * decoded; in text mode a transcript without a wake phrase is dropped.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { FRAME_AUDIO, FRAME_CONTROL, FrameDecoder, parseControl, samplesOf, type WorkerMessage } from './core/frames.ts'
import { WorkerEngine, type Sherpa } from './core/worker-engine.ts'

const [modelsRoot, sherpaFrom, keywordsFile] = process.argv.slice(2)
if (modelsRoot === undefined || sherpaFrom === undefined || keywordsFile === undefined) {
  process.stderr.write('usage: listener-worker.ts <modelsRoot> <sherpa package.json> <keywords.txt>\n')
  process.exit(2)
}

function send(message: WorkerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function number(name: string): number | undefined {
  const value = Number(process.env[name])
  return process.env[name] === undefined || Number.isNaN(value) ? undefined : value
}

const engine = new WorkerEngine({
  sherpa: createRequire(sherpaFrom)('sherpa-onnx-node') as Sherpa,
  modelsRoot,
  dirs: { vad: join(modelsRoot, 'vad'), kws: join(modelsRoot, 'kws'), asrEn: join(modelsRoot, 'asr-en'), asrTa: join(modelsRoot, 'asr-ta') },
  keywordsFile,
  wake: process.env.AIR_VOICE_WAKE === 'kws' ? 'kws' : 'text',
  asr: process.env.AIR_VOICE_ASR === 'sensevoice' ? 'sensevoice' : 'parakeet',
  send,
  debugText: process.env.AIR_VOICE_DEBUG === '2',
  keywordsScore: number('AIR_VOICE_KWS_SCORE'),
  keywordsThreshold: number('AIR_VOICE_KWS_THRESHOLD'),
})

const decoder = new FrameDecoder()
process.stdin.on('data', (chunk: Buffer) => {
  for (const frame of decoder.push(chunk)) {
    if (frame.kind === FRAME_AUDIO) engine.push(samplesOf(frame.payload))
    else if (frame.kind === FRAME_CONTROL) {
      const message = parseControl(frame.payload)
      if (message?.type === 'language') engine.setLanguage(message.lang)
      else if (message?.type === 'listen') engine.arm(message.seconds)
      else if (message?.type === 'mute') engine.setMuted(message.on)
    }
  }
})

process.stdin.on('end', () => {
  engine.finish()
  process.exit(0)
})
