/**
 * Opt-in: the real worker with the real models. `AIR_VOICE_LIVE=1 pnpm -C air/apps/voice exec vitest run tests/listener.live.spec.ts`
 * Needs the models (`scripts/fetch-models.ts`) and Windows SAPI. Speech is synthesised with SAPI ("Jarvis, open notepad."
 * as 16 kHz mono 16-bit WAV) and fed to the worker in real time, 100 ms per frame, between stretches of silence.
 * Prints wake latency (audio time from the end of "Jarvis" to the wake event), decode time per command, and real-time factor.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Listener, type Command } from '../src/core/listener.ts'
import { modelDir } from '../src/core/models.ts'
import { SENSEVOICE_PACKAGE_JSON } from '../src/core/paths.ts'

interface Recognizer {
  createStream(): { acceptWaveform(input: object): void }
  decode(stream: object): void
  getResult(stream: object): { text: string }
}

const FRAME = 1600
const LEAD_S = 1.5
const TAIL_S = 2.5

const SAPI = [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  'if ($env:AIR_TTS_VOICE) { $s.SelectVoice($env:AIR_TTS_VOICE) }',
  '$s.SetOutputToWaveFile($env:AIR_TTS_OUT, $f)',
  '$s.Speak($env:AIR_TTS_TEXT)',
  '$s.Dispose()',
].join('; ')

const dir = mkdtempSync(join(tmpdir(), 'air-voice-live-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function synthesize(name: string, text: string): Float32Array {
  const out = join(dir, `${name}.wav`)
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SAPI], { env: { ...process.env, AIR_TTS_OUT: out, AIR_TTS_TEXT: text, AIR_TTS_VOICE: process.env.AIR_VOICE_LIVE_VOICE ?? '' } })
  const file = readFileSync(out)
  let offset = 12
  while (offset < file.length) {
    const id = file.toString('ascii', offset, offset + 4)
    const size = file.readUInt32LE(offset + 4)
    if (id === 'data') {
      const samples = new Float32Array(size / 2)
      for (let index = 0; index < samples.length; index++) samples[index] = file.readInt16LE(offset + 8 + index * 2) / 32768
      return samples
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function feed(listener: Listener, samples: Float32Array, clock: { frames: number }, onFrame?: () => void): Promise<void> {
  for (let offset = 0; offset + FRAME <= samples.length; offset += FRAME) {
    listener.push(samples.slice(offset, offset + FRAME))
    clock.frames++
    onFrame?.()
    await sleep(100)
  }
}

describe.runIf(process.env.AIR_VOICE_LIVE === '1')('Listener (live)', () => {
  async function run(name: string, text: string): Promise<{ wakeAt: number[]; commands: Command[]; wakeLatencyS: number }> {
    const listener = new Listener()
    const wakeAt: number[] = []
    const commands: Command[] = []
    const errors: Error[] = []
    const clock = { frames: 0 }
    listener.on('error', (error: Error) => errors.push(error))
    listener.on('wake', () => wakeAt.push(clock.frames * 0.1))
    listener.on('command', (command: Command) => commands.push(command))
    const ready = new Promise<number>(resolve => listener.once('ready', resolve))
    listener.start()
    const loadMs = await ready
    const word = synthesize('jarvis', 'Jarvis.')
    const jarvisLength = (word.findLastIndex(sample => Math.abs(sample) > 0.02) + 1) / 16_000
    const speech = synthesize(name, text)
    await feed(listener, new Float32Array(LEAD_S * 16_000), clock)
    await feed(listener, speech, clock)
    await feed(listener, new Float32Array(TAIL_S * 16_000), clock)
    await sleep(1500)
    await listener.stop()
    expect(errors).toEqual([])
    const wakeLatencyS = (wakeAt[0] ?? Number.NaN) - (LEAD_S + jarvisLength)
    console.log(`[live] "${text}": load ${loadMs} ms; wake at ${wakeAt[0]?.toFixed(2)} s of audio (speech ends about ${(LEAD_S + jarvisLength).toFixed(2)} s, latency ${wakeLatencyS.toFixed(2)} s); commands ${JSON.stringify(commands)}; RTF ${commands.map(c => (c.decodeMs / c.audioMs).toFixed(3)).join(', ')}`)
    return { wakeAt, commands, wakeLatencyS }
  }

  it('wakes on "Jarvis" and then returns the command text for notepad', async () => {
    const { wakeAt, commands } = await run('notepad', 'Jarvis, open notepad.')
    expect(wakeAt).toHaveLength(1)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.text.toLowerCase()).toContain('notepad')
  }, 120_000)

  it('wakes on "Jarvis" and then returns the command text for the weather search', async () => {
    const { wakeAt, commands } = await run('weather', 'Jarvis, search weather in Chennai.')
    expect(wakeAt).toHaveLength(1)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.text.toLowerCase()).toContain('weather')
  }, 120_000)

  it('does not wake or decode speech without the wake word', async () => {
    const { wakeAt, commands } = await run('nowake', 'Please open notepad and search the weather in Chennai.')
    expect(wakeAt).toEqual([])
    expect(commands).toEqual([])
  }, 120_000)

  it('loads the Tamil model on a language switch and decodes a silent clip', async () => {
    const listener = new Listener()
    const info = new Promise<{ lang: string; loadMs: number }>(resolve => listener.once('language', resolve))
    listener.start()
    listener.setLanguage('ta')
    const switched = await info
    await listener.stop()
    const sherpa = createRequire(SENSEVOICE_PACKAGE_JSON)('sherpa-onnx-node') as {
      OfflineRecognizer: new (config: object) => Recognizer
    }
    const started = performance.now()
    const recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: { nemoCtc: { model: join(modelDir('asr-ta'), 'model.int8.onnx') }, tokens: join(modelDir('asr-ta'), 'tokens.txt'), numThreads: 4, provider: 'cpu', debug: 0 },
    })
    const loadMs = Math.round(performance.now() - started)
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: 16_000, samples: new Float32Array(16_000) })
    const decodeStarted = performance.now()
    recognizer.decode(stream)
    const text = recognizer.getResult(stream).text
    console.log(`[live] Tamil: worker lazy load ${switched.loadMs} ms; direct load ${loadMs} ms; 1 s silent clip decoded in ${Math.round(performance.now() - decodeStarted)} ms to ${JSON.stringify(text)}`)
    expect(switched.lang).toBe('ta')
    expect(typeof text).toBe('string')
  }, 120_000)
})
