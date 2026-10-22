/**
 * Speech output: Kokoro load time, and for replies of one, two and three sentences the time to first audio and the
 * real-time factor, through the app's own `Speaker` (child process, base64 WAV, sentence streaming), with Windows SAPI
 * as the comparison. Playback is a recording player, so no sound is made and the numbers exclude the audio device.
 * `pnpm -C air/apps/voice exec tsx scripts/bench/tts.ts [--quick]`
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { lineReader } from '../../src/core/child.ts'
import { modelDir } from '../../src/core/models.ts'
import { SENSEVOICE_PACKAGE_JSON, VOICE_APP_ROOT } from '../../src/core/paths.ts'
import { Speaker, type AudioPlayer } from '../../src/core/speaker.ts'
import { type BenchContext, type BenchResult, contextFromArgs, isMain, repoRelative, runDir, statsTable, writeCsv, writeManifest } from './lib.ts'
import { createKokoro } from './sherpa.ts'
import { nodeSpawn } from '../../src/node-spawn.ts'

/** Replies of one, two and three sentences (five of each; runs rotate through them). */
export const REPLIES: Record<1 | 2 | 3, readonly string[]> = {
  1: [
    'The time in Tokyo is nine fifteen in the evening.',
    'Done. I opened the calculator for you.',
    'The capital of Australia is Canberra, not Sydney.',
    'It is twenty two degrees and mostly sunny right now.',
    'You have three unread messages in your important folder.',
  ],
  2: [
    'The time in Tokyo is nine fifteen in the evening. That is three and a half hours ahead of you.',
    'Done. I opened the calculator for you. Tell me if you need anything else.',
    'The capital of Australia is Canberra. Sydney is the largest city, but not the capital.',
    'It is twenty two degrees and mostly sunny right now. Rain is not expected before the weekend.',
    'You have three unread messages in your important folder. The newest one is from your bank.',
  ],
  3: [
    'The time in Tokyo is nine fifteen in the evening. That is three and a half hours ahead of you. It is already tomorrow there.',
    'Done. I opened the calculator for you. Tell me if you need anything else. I am listening.',
    'The capital of Australia is Canberra. Sydney is the largest city, but not the capital. Melbourne held the title for a time.',
    'It is twenty two degrees and mostly sunny right now. Rain is not expected before the weekend. The evening will be cooler.',
    'You have three unread messages in your important folder. The newest one is from your bank. The other two are newsletters.',
  ],
}

/** Seconds of audio in a base64 WAV (16-bit mono PCM header). */
function wavSeconds(wavBase64: string): number {
  const header = Buffer.from(wavBase64.slice(0, 120), 'base64')
  const rate = header.readUInt32LE(24)
  const byteRate = rate * header.readUInt16LE(22) * (header.readUInt16LE(34) / 8)
  const full = Buffer.from(wavBase64, 'base64')
  return (full.length - 44) / byteRate
}

/** A player that records seconds of audio and ends at once. */
class RecordingPlayer implements AudioPlayer {
  seconds = 0
  play(wavBase64: string): Promise<void> {
    this.seconds += wavSeconds(wavBase64)
    return Promise.resolve()
  }
  stop(): void { /* nothing plays */ }
  beep(): void { /* nothing plays */ }
}

/** Time from starting the TTS worker process to its `READY` line (model load plus one warm-up sentence). */
function workerReadyMs(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn('node', args, { stdio: 'pipe', windowsHide: true })
    child.stdout.on('data', lineReader((line) => {
      if (line === 'READY') {
        resolve(performance.now() - started)
        child.stdin.end()
        child.kill()
      }
    }))
    child.on('error', reject)
    child.on('exit', () => reject(new Error('tts worker exited before READY')))
  })
}

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const runs = ctx.quick ? 4 : 20
  const dir = modelDir('tts-en')
  const workerArgs = [join(VOICE_APP_ROOT, 'lib', 'tts-worker.cjs'), dir, SENSEVOICE_PACKAGE_JSON]
  const inProcessLoad = createKokoro().loadMs
  const workerReady = await workerReadyMs(workerArgs)
  log(`kokoro load ${Math.round(inProcessLoad)} ms in process, ${Math.round(workerReady)} ms to a ready worker`)

  const engines = [
    { name: 'kokoro am_michael', speaker: (player: AudioPlayer) => new Speaker(nodeSpawn, undefined, player, { command: 'node', args: workerArgs }) },
    { name: 'sapi', speaker: (player: AudioPlayer) => new Speaker(nodeSpawn, undefined, player) },
  ]
  const rows: (string | number)[][] = []
  const ttfa: [string, number[]][] = []
  const rtf: [string, number[]][] = []
  const total: [string, number[]][] = []
  for (const engine of engines) {
    const player = new RecordingPlayer()
    const speaker = engine.speaker(player)
    speaker.warm()
    await speaker.speak('Warm up. The first sentence loads the voice.')
    for (const sentences of [1, 2, 3] as const) {
      const first: number[] = []
      const ratio: number[] = []
      const elapsed: number[] = []
      for (let index = 0; index < runs; index++) {
        const text = REPLIES[sentences][index % REPLIES[sentences].length] as string
        player.seconds = 0
        const started = performance.now()
        await speaker.speak(text)
        const totalMs = performance.now() - started
        const timing = speaker.lastTiming
        const firstMs = (timing?.firstAudioAt ?? Number.NaN) - (timing?.startedAt ?? 0)
        first.push(firstMs)
        elapsed.push(totalMs)
        ratio.push(totalMs / 1000 / player.seconds)
        rows.push([engine.name, sentences, index, firstMs, totalMs, player.seconds * 1000, totalMs / 1000 / player.seconds])
      }
      const label = `${engine.name}, ${sentences} sentence${sentences === 1 ? '' : 's'}`
      ttfa.push([label, first])
      total.push([label, elapsed])
      rtf.push([label, ratio])
    }
    await speaker.dispose()
  }

  const out = runDir(ctx, 'tts')
  writeCsv(join(out, 'data.csv'), ['engine', 'sentences', 'run', 'first_audio_ms', 'total_ms', 'audio_ms', 'rtf'], rows)
  await writeManifest(out, 'tts', rows.length, { runsPerCell: runs, sentenceCounts: [1, 2, 3], engines: engines.map(engine => engine.name), kokoroLoadInProcessMs: Math.round(inProcessLoad), kokoroWorkerReadyMs: Math.round(workerReady) })
  return {
    bench: 'tts',
    dir: repoRelative(out),
    n: rows.length,
    tables: [
      { title: 'Kokoro load time (cold process; model files are in the OS cache after the first run)', columns: ['measure', 'ms'], rows: [['OfflineTts constructed in this process', Math.round(inProcessLoad)], ['TTS worker process start to READY (load plus one warm-up sentence)', Math.round(workerReady)]] },
      statsTable('Time to first audio (ms): speak() call to the first WAV handed to the player', 'engine, reply length', ttfa),
      statsTable('Time to render and hand over the whole reply (ms)', 'engine, reply length', total),
      statsTable('Real-time factor (render time / audio time; below 1 is faster than real time)', 'engine, reply length', rtf, 3),
    ],
    notes: [
      `${runs} replies per cell, rotating through five fixed texts per length; one warm-up reply per engine is excluded.`,
      'Kokoro threads: 4, CPU. Both engines run in a child process and return base64 WAV through a pipe, as in the app.',
      'Time to first audio ends when the first sentence is handed to the player; the renderer adds a few milliseconds to decode and start it, which is not measured here.',
    ],
  }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
