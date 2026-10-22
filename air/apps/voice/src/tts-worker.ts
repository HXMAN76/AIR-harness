/**
 * Speech child process: Kokoro text-to-speech through `sherpa-onnx-node`, one sentence at a time, off the UI thread.
 * Run with Node: `node tts-worker.cjs <tts-en folder> <sherpa package.json>`; env `AIR_VOICE_TTS_VOICE`, `AIR_VOICE_TTS_SPEED`.
 * stdin/stdout: the line protocol of `speaker.ps1` (`SAY <base64>`, `STOP`; answers `WAV <base64>` or `DONE`).
 */
import { createRequire } from 'node:module'
import { lineReader } from './core/child.ts'
import { TtsWorkerEngine, resolveTtsOptions, type TtsSherpa } from './core/tts-engine.ts'

const [dir, sherpaFrom] = process.argv.slice(2)
if (dir === undefined || sherpaFrom === undefined) {
  process.stderr.write('usage: tts-worker <tts-en folder> <sherpa package.json>\n')
  process.exit(2)
}

const options = resolveTtsOptions(process.env)
const engine = new TtsWorkerEngine({
  sherpa: createRequire(sherpaFrom)('sherpa-onnx-node') as TtsSherpa,
  dir,
  sid: options.sid,
  speed: options.speed,
  write: (line) => {
    process.stdout.write(`${line}\n`)
  },
  onError: (error) => {
    process.stderr.write(`tts error: ${error.message}\n`)
  },
})
engine.warm()
process.stdout.write('READY\n')
process.stdin.on('data', lineReader((line) => {
  engine.handleLine(line)
}))
process.stdin.on('end', () => process.exit(0))
