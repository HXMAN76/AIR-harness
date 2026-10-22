/** Parent side of the speech listener: streams microphone frames to the worker (keyword spotter, VAD, recognisers) and reads its events. */
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { nodeSpawn } from '../node-spawn.ts'
import { ignoreStdinErrors, lineReader, type ChildLike, type SpawnLike } from './child.ts'
import { audioFrame, controlFrame, type Lang, type WorkerMessage } from './frames.ts'
import { modelRoot } from './models.ts'
import { SENSEVOICE_PACKAGE_JSON, VOICE_APP_ROOT } from './paths.ts'

/** A command the user spoke after the wake word. */
export interface Command {
  text: string
  lang: Lang
  /** Length of the speech, ms. */
  audioMs: number
  /** Time the recogniser took, ms. */
  decodeMs: number
}

/** How to start the worker. Defaults run `node src/listener-worker.ts` from this checkout. */
export interface ListenerOptions {
  spawnFn?: SpawnLike
  /** Node executable; the worker loads a native addon built for Node, not Electron. */
  command?: string
  /** Full argument list passed to the command. Overrides workerPath, modelsRoot, sherpaFrom, keywordsFile when set. */
  args?: string[]
  workerPath?: string
  /** Directory holding the model folders (`kws`, `asr-en`, `asr-ta`, `vad`). */
  modelsRoot?: string
  /** `package.json` that `sherpa-onnx-node` is resolved from. */
  sherpaFrom?: string
  /** BPE keyword file for the wake words. */
  keywordsFile?: string
}

/** A worker that exited this many times is not started again. */
const MAX_STARTS = 2

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ta'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/** Narrow a parsed line to a {@link WorkerMessage}; undefined when it is none. */
function toMessage(value: unknown): WorkerMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const r = value as Record<string, unknown>
  if (r.ready === true && isNumber(r.loadMs)) return { ready: true, loadMs: r.loadMs }
  if (r.type === 'wake') return r.bare === true ? { type: 'wake', bare: true } : { type: 'wake' }
  if (r.type === 'timeout') return { type: 'timeout' }
  if (r.type === 'heard') return typeof r.text === 'string' ? { type: 'heard', text: r.text } : { type: 'heard' }
  if (r.type === 'command' && typeof r.text === 'string' && isLang(r.lang) && isNumber(r.audioMs) && isNumber(r.decodeMs)) {
    return { type: 'command', text: r.text, lang: r.lang, audioMs: r.audioMs, decodeMs: r.decodeMs }
  }
  if (r.type === 'language' && isLang(r.lang) && isNumber(r.loadMs)) return { type: 'language', lang: r.lang, loadMs: r.loadMs }
  if (r.type === 'error' && typeof r.message === 'string') return { type: 'error', message: r.message }
  return undefined
}

/**
 * Emits `'wake'` (argument `true` for a bare wake phrase in text mode), `'command'` ({@link Command}),
 * `'timeout'` (no speech after a wake), `'heard'` (text wake: speech without a wake phrase, no text), `'language'` ({ lang, loadMs }),
 * `'ready'` (model load time in ms), and `'error'` (Error).
 * Protocol: frames on the worker's stdin (audio and control, see `frames.ts`); one JSON object per line on its stdout.
 */
export class Listener extends EventEmitter {
  private readonly spawnFn: SpawnLike
  private readonly command: string
  private readonly args: string[]
  private child: ChildLike | undefined
  private starts = 0
  private lang: Lang = 'en'
  private muted = false

  /** @param options - worker launch options. */
  constructor(options: ListenerOptions = {}) {
    super()
    this.spawnFn = options.spawnFn ?? nodeSpawn
    this.command = options.command ?? 'node'
    this.args = options.args ?? [
      options.workerPath ?? join(VOICE_APP_ROOT, 'src', 'listener-worker.ts'),
      options.modelsRoot ?? modelRoot(),
      options.sherpaFrom ?? SENSEVOICE_PACKAGE_JSON,
      options.keywordsFile ?? join(VOICE_APP_ROOT, 'src', 'keywords.txt'),
    ]
  }

  /** Start the worker if it is not running and may still be started. */
  start(): void {
    if (this.child !== undefined || this.starts >= MAX_STARTS) return
    this.starts++
    const child = this.spawnFn(this.command, this.args)
    this.child = child
    ignoreStdinErrors(child)
    child.stdout.on('data', lineReader((line) => {
      this.onLine(line)
    }))
    if (this.lang !== 'en') child.stdin.write(controlFrame({ type: 'language', lang: this.lang }))
    if (this.muted) child.stdin.write(controlFrame({ type: 'mute', on: true }))
    let gone = false
    const onGone = (): void => {
      if (gone) return
      gone = true
      if (this.child !== child) return
      this.child = undefined
      this.emit('error', new Error('listener exited'))
      if (this.starts >= MAX_STARTS) this.emit('error', new Error('listener unavailable'))
      else this.start()
    }
    child.on('exit', onGone)
    child.on('error', onGone)
  }

  /**
   * Send one frame of samples; ignored while the worker is not running.
   * @param frame - 16 kHz mono samples.
   */
  push(frame: Float32Array): void {
    this.child?.stdin.write(audioFrame(frame))
  }

  /**
   * Choose the language the worker decodes the next commands in; the worker loads its model on first use and answers with `'language'`.
   * @param lang - `en` or `ta`.
   */
  setLanguage(lang: Lang): void {
    this.lang = lang
    this.child?.stdin.write(controlFrame({ type: 'language', lang }))
  }

  /**
   * Listen for one command without a wake word; the worker answers with a `'command'` or a `'timeout'`.
   * @param seconds - how long to wait for speech to start; the worker's default when omitted.
   */
  listen(seconds?: number): void {
    this.child?.stdin.write(controlFrame(seconds === undefined ? { type: 'listen' } : { type: 'listen', seconds }))
  }

  /**
   * Mute or unmute the worker while the app speaks, so its own voice is not taken as a command. While muted, only a
   * segment that starts with a wake phrase counts (barge-in).
   * @param on - muted or not. The setting is sent again to a restarted worker.
   */
  mute(on: boolean): void {
    this.muted = on
    this.child?.stdin.write(controlFrame({ type: 'mute', on }))
  }

  /** Stop the worker; no restart follows. */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.child = undefined
    const exited = new Promise<void>((resolve) => {
      child.on('exit', () => {
        resolve()
      })
    })
    child.stdin.end()
    child.kill()
    await exited
  }

  private onLine(line: string): void {
    if (line.trim() === '') return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      value = undefined
    }
    const message = toMessage(value)
    if (message === undefined) {
      this.emit('error', new Error('listener sent a malformed line'))
      return
    }
    if ('ready' in message) this.emit('ready', message.loadMs)
    else if (message.type === 'wake') this.emit('wake', message.bare === true ? true : undefined)
    else if (message.type === 'timeout') this.emit('timeout')
    else if (message.type === 'heard') this.emit('heard', message.text)
    else if (message.type === 'command') this.emit('command', { text: message.text, lang: message.lang, audioMs: message.audioMs, decodeMs: message.decodeMs } satisfies Command)
    else if (message.type === 'language') this.emit('language', { lang: message.lang, loadMs: message.loadMs })
    else this.emit('error', new Error(message.message))
  }
}
