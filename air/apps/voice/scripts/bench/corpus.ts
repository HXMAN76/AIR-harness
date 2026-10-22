/**
 * The synthetic speech corpus: 30 command phrases rendered with Kokoro (am_michael) and the two Windows SAPI voices
 * (David, Zira) at 16 kHz mono, each plain, with a "Jarvis, " prefix, plus negative phrases without the wake word.
 * Rendered once into a cache folder outside the repository and reused.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeWav } from '../../src/core/wav.ts'
import { KOKORO_VOICES } from '../../src/core/tts-engine.ts'
import { resample } from './audio.ts'
import { createKokoro } from './sherpa.ts'

/** The 30 spoken commands (what follows the wake word). */
export const COMMANDS: readonly string[] = [
  'open notepad', 'open calculator', 'open the browser', 'open youtube', 'open gmail', 'open file explorer',
  'open settings', 'close notepad', 'close the calculator', 'what time is it', 'what is the date today', 'volume up',
  'volume down', 'mute the volume', 'search for weather in Chennai', 'play lo-fi music on youtube', 'read the news',
  'lock the screen', 'what is the capital of France', 'tell me a joke', 'what is the weather like today',
  'set a timer for five minutes', 'remind me to call my mother', 'how many days until Christmas',
  'translate hello into Spanish', 'read my important mail', 'write a note to buy milk', 'what is twelve times fifteen',
  'open spotify', 'name three primary colors',
]

/** A phrase without the wake word. `hard` marks words and names that sound like it. */
export interface Negative {
  text: string
  hard: boolean
}

/** Phrases that must not wake the assistant. */
export const NEGATIVES: readonly Negative[] = [
  { text: 'I need to go to the market this afternoon', hard: false },
  { text: 'the weather is nice today', hard: false },
  { text: 'please remember to buy some milk', hard: false },
  { text: 'what are you doing this weekend', hard: false },
  { text: 'she sells sea shells by the sea shore', hard: false },
  { text: 'turn the music down a little', hard: false },
  { text: 'let us meet at the cafe at noon', hard: false },
  { text: 'he said the meeting is at four', hard: false },
  { text: 'I think it is going to rain', hard: false },
  { text: 'can you pass me the salt', hard: false },
  { text: 'service', hard: true },
  { text: 'the service desk is closed today', hard: true },
  { text: 'nervous', hard: true },
  { text: 'I feel nervous about the exam', hard: true },
  { text: 'Harvey is coming over tonight', hard: true },
  { text: 'Marvin is a robot', hard: true },
  { text: 'Davis called me yesterday', hard: true },
  { text: 'Travis is late again', hard: true },
  { text: 'the harsh noise of the train', hard: true },
  { text: 'I will serve dinner at seven', hard: true },
]

/** The voices of the corpus. */
export const VOICES = [
  { id: 'kokoro-am_michael', engine: 'kokoro' as const, name: 'am_michael' },
  { id: 'sapi-david', engine: 'sapi' as const, name: 'Microsoft David Desktop' },
  { id: 'sapi-zira', engine: 'sapi' as const, name: 'Microsoft Zira Desktop' },
]

/** One rendered clip. */
export interface Clip {
  id: string
  voice: string
  /** `command` is the plain phrase, `wake` has the "Jarvis, " prefix, `negative` has none and is not a command. */
  kind: 'command' | 'wake' | 'negative'
  /** What was spoken. */
  text: string
  /** The command part of the spoken text (empty for a negative). */
  command: string
  hard: boolean
  path: string
}

const CACHE = join(homedir(), '.air', 'voice-bench', 'corpus-v3')
const SAPI_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'render-sapi.ps1')

interface Spec {
  id: string
  kind: Clip['kind']
  text: string
  command: string
  hard: boolean
  /** SSML the SAPI voices render instead of the plain text (see {@link ssmlFor}). */
  ssml?: string
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * SAPI renders "Jarvis open notepad" from plain text with a prosodic pause of about 0.8 s after the name, long enough
 * for the VAD to split the wake phrase from the command; SSML with a zero break keeps the clip in one segment.
 * @returns the SSML for a SAPI wake clip, or undefined when the voice renders the plain text.
 */
function ssmlFor(spec: Spec, voice: typeof VOICES[number]): string | undefined {
  return voice.engine === 'sapi' && spec.kind === 'wake'
    ? `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">Jarvis<break time="0ms"/>${escapeXml(spec.command)}</speak>`
    : undefined
}

function specs(voice: typeof VOICES[number]): Spec[] {
  return [
    ...COMMANDS.map((command, index) => ({ id: `command-${String(index).padStart(2, '0')}`, kind: 'command' as const, text: command, command, hard: false })),
    ...COMMANDS.map((command, index) => ({ id: `wake-${String(index).padStart(2, '0')}`, kind: 'wake' as const, text: `Jarvis, ${command}`, command, hard: false })),
    ...NEGATIVES.map((negative, index) => ({ id: `negative-${String(index).padStart(2, '0')}`, kind: 'negative' as const, text: negative.text, command: '', hard: negative.hard })),
  ].map(spec => {
    const ssml = ssmlFor(spec, voice)
    return ssml === undefined ? spec : { ...spec, ssml }
  })
}

/**
 * Render any clips that are not cached yet and list them all.
 * @param log - progress sink.
 * @returns every clip of the corpus (3 voices x (30 + 30 + 20)).
 */
export function ensureCorpus(log: (line: string) => void = () => undefined): Clip[] {
  const clips: Clip[] = []
  let kokoro: ReturnType<typeof createKokoro> | undefined
  for (const voice of VOICES) {
    const dir = join(CACHE, voice.id)
    mkdirSync(dir, { recursive: true })
    const wanted = specs(voice).map(spec => ({ ...spec, path: join(dir, `${spec.id}.wav`) }))
    const missing = wanted.filter(item => !existsSync(item.path))
    if (missing.length > 0) {
      log(`rendering ${missing.length} clips with ${voice.id}`)
      if (voice.engine === 'kokoro') {
        kokoro ??= createKokoro()
        const sid = KOKORO_VOICES[voice.name] as number
        for (const item of missing) {
          const audio = kokoro.tts.generate({ text: item.text, sid, speed: 1 })
          const pcm = resample({ samples: audio.samples, sampleRate: audio.sampleRate }, 16_000)
          writeFileSync(item.path, encodeWav(pcm, 16_000))
        }
      } else {
        const list = join(dir, 'pending.json')
        writeFileSync(list, JSON.stringify(missing.map(item => ({ path: item.path, text: item.text, ...item.ssml === undefined ? {} : { ssml: item.ssml } }))))
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SAPI_SCRIPT, '-Voice', voice.name, '-List', list], { windowsHide: true, timeout: 300_000 })
      }
    }
    for (const item of wanted) clips.push({ id: `${voice.id}-${item.id}`, voice: voice.id, kind: item.kind, text: item.text, command: item.command, hard: item.hard, path: item.path })
  }
  return clips
}
