/**
 * Convenience check: record the default microphone — optionally with Windows SAPI speaking through the
 * speakers while it records — then score the recording through the keyword spotter at every diagnosis
 * threshold. One command for "why does Jarvis not wake?".
 *
 * `pnpm -C air/apps/voice exec tsx scripts/mic-check.ts [seconds] [out.wav] [--say "<text>"] [--volume <0-100>]`
 * Say the wake word ("Jarvis") during the recording, or pass `--say` to have SAPI say it for you; the
 * output shows the noise floor, clipping, and whether each threshold fired.
 * Options: `--say <text>` speaks through SAPI while recording (Windows only), `--volume <0-100>` its
 * loudness (default 100), `--delay <seconds>` how long after the capture starts it speaks (default 2),
 * `--no-score` records without scoring. Env: `AIR_RECORD_RAW=1` disables echo cancellation and noise
 * suppression in the capture.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recordMic } from './record-mic.ts'
import { scoreWav, type ScoreReport } from './score-kws.ts'

/** What one run does. */
export interface MicCheckOptions {
  seconds: number
  out: string
  /** Text for SAPI to speak through the speakers while recording; `undefined` records only. */
  say: string | undefined
  /** SAPI volume, 0-100. */
  volume: number
  /** Seconds after the capture starts before SAPI speaks. */
  delay: number
  score: boolean
}

/** Defaults matching the command line's own defaults. */
export const MIC_CHECK_DEFAULTS: MicCheckOptions = { seconds: 6, out: 'mic.wav', say: undefined, volume: 100, delay: 2, score: true }

/**
 * Parse `mic-check.ts` arguments.
 * @param args - the arguments after the script name.
 * @returns the options for one run.
 * @throws when an option is malformed.
 */
export function parseMicCheckArgs(args: string[]): MicCheckOptions {
  const options: MicCheckOptions = { ...MIC_CHECK_DEFAULTS }
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string
    if (arg === '--no-score') {
      options.score = false
      continue
    }
    const flag = arg === '--say' || arg === '--volume' || arg === '--delay' ? arg : undefined
    if (flag === undefined) {
      positional.push(arg)
      continue
    }
    const value = args[index + 1]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    index++
    if (flag === '--say') options.say = value
    else options[flag === '--volume' ? 'volume' : 'delay'] = Number(value)
  }
  if (positional[0] !== undefined) options.seconds = Number(positional[0])
  if (positional[1] !== undefined) options.out = positional[1]
  if (positional.length > 2) throw new Error(`unexpected argument ${positional[2] as string}`)
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) throw new Error('seconds must be a positive number')
  if (!Number.isFinite(options.volume) || options.volume < 0 || options.volume > 100) throw new Error('--volume must be between 0 and 100')
  if (!Number.isFinite(options.delay) || options.delay < 0) throw new Error('--delay must be zero or more')
  return options
}

/** PowerShell that speaks one base64-encoded utterance at a volume, with the app's voice hints. */
function sapiCommand(textBase64: string, volume: number): string {
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::Adult, 0, [System.Globalization.CultureInfo]::GetCultureInfo("en-US")) } catch { }',
    `$synth.Volume = ${Math.round(volume)}`,
    '$synth.SetOutputToDefaultAudioDevice()',
    `$synth.Speak([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${textBase64}")))`,
    '$synth.Dispose()',
  ].join('\n')
}

/**
 * Speak one utterance through Windows SAPI.
 * @param text - plain text to say.
 * @param volume - SAPI volume, 0-100.
 * @returns resolves when the utterance finished.
 */
export function speak(text: string, volume: number): Promise<void> {
  if (process.platform !== 'win32') return Promise.reject(new Error('--say needs Windows SAPI'))
  return new Promise<void>((resolveSpeak, rejectSpeak) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', sapiCommand(Buffer.from(text, 'utf8').toString('base64'), volume)], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectSpeak)
    child.on('exit', (code) => {
      if (code === 0) resolveSpeak()
      else rejectSpeak(new Error(`SAPI exited with code ${String(code)}: ${stderr.trim()}`))
    })
  })
}

const sleep = (ms: number): Promise<void> => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

/**
 * Record the microphone, speak while recording when asked, and score the result.
 * @param options - what to record and how.
 * @returns the score report, or `undefined` with `--no-score`.
 */
export async function micCheck(options: MicCheckOptions = MIC_CHECK_DEFAULTS): Promise<ScoreReport | undefined> {
  let speaking: Promise<void> | undefined
  if (options.say !== undefined) {
    const text = options.say
    speaking = sleep(options.delay * 1000)
      .then(() => speak(text, options.volume))
      .catch((error: unknown) => {
        console.error(`mic-check: could not speak: ${error instanceof Error ? error.message : String(error)}`)
      })
  }
  const out = await recordMic(options.seconds, options.out)
  await speaking
  if (!options.score) return undefined
  return scoreWav(out)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options: MicCheckOptions
  try {
    options = parseMicCheckArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`mic-check: ${error instanceof Error ? error.message : String(error)}`)
    console.error('usage: mic-check.ts [seconds] [out.wav] [--say "<text>"] [--volume <0-100>] [--delay <s>] [--no-score]')
    process.exit(2)
  }
  micCheck(options).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
