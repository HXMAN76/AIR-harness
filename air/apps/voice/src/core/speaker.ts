/**
 * Speaks text: a long-lived PowerShell child renders each utterance with Windows SAPI to a WAV (`speaker.ps1`),
 * and an {@link AudioPlayer} (the Electron renderer) plays it, so all audio comes from one place.
 */
import { fileURLToPath } from 'node:url'
import { nodeSpawn } from '../node-spawn.ts'
import { ignoreStdinErrors, lineReader, type ChildLike, type SpawnLike } from './child.ts'
import { splitSentences } from './speech-text.ts'

/** Default location of the SAPI script next to `src/core` (the Electron main passes its own path). */
export const DEFAULT_SPEAKER_SCRIPT = fileURLToPath(new URL('../speaker.ps1', import.meta.url))

/** A child that exited this many times is not started again. */
const MAX_STARTS = 2

/** A command that renders speech with the same line protocol as `speaker.ps1`. */
export interface SpeechEngine {
  command: string
  args: readonly string[]
}

/** Plays rendered speech; the Electron main implements it over IPC to the renderer. */
export interface AudioPlayer {
  /** Play one base64 WAV after the ones already queued; settles when it finished or was stopped. */
  play(wavBase64: string): Promise<void>
  /** Stop everything playing or queued now. */
  stop(): void
  /** Play the short wake cue. */
  beep(): void
}

/** A player that plays nothing; used when no renderer is attached. */
const SILENT: AudioPlayer = { play: () => Promise.resolve(), stop: () => undefined, beep: () => undefined }

interface Pending {
  resolve: () => void
  reject: (error: Error) => void
  /** Whether the child already answered this utterance (it may still be playing). */
  answered: boolean
}

/**
 * Line protocol to the child: `SAY <base64 UTF-8>` queues an utterance, `STOP` cancels all rendering;
 * the child answers each utterance with `WAV <base64>` (play it) or `DONE` (cancelled or empty).
 */
export class Speaker {
  private child: ChildLike | undefined
  private starts = 0
  /** Whether the preferred engine gave up and SAPI is in use. */
  private fellBack = false
  private pending: Pending[] = []
  /** Answers still owed for utterances that `stop()` already settled. */
  private owedAnswers = 0
  private disposed = false

  /**
   * @param spawnFn - starts the child; defaults to Node's `spawn`.
   * @param scriptPath - path of `speaker.ps1`.
   * @param player - plays the rendered WAVs; defaults to a silent one.
   * @param engine - a better voice (Kokoro) tried first; once it fails twice, SAPI through `scriptPath` takes over.
   */
  constructor(
    private readonly spawnFn: SpawnLike = nodeSpawn,
    private readonly scriptPath = DEFAULT_SPEAKER_SCRIPT,
    private readonly player: AudioPlayer = SILENT,
    private readonly engine?: SpeechEngine,
  ) {}

  /** Whether an utterance is queued or playing. */
  get speaking(): boolean {
    return this.pending.length > 0
  }

  /**
   * Speak one utterance sentence by sentence: the first sentence plays as soon as it is rendered while the
   * next ones render.
   * @param text - plain text to say.
   * @returns settles when it finished playing or was stopped; rejects when the child exits or cannot start.
   */
  speak(text: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('speaker disposed'))
    const child = this.ensureChild()
    if (child === undefined) return Promise.reject(new Error('speaker unavailable'))
    const sentences = splitSentences(text)
    const parts = sentences.length > 0 ? sentences : [text]
    return Promise.all(parts.map(part => new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject, answered: false })
      child.stdin.write(`SAY ${Buffer.from(part, 'utf8').toString('base64')}\n`)
    }))).then(() => undefined)
  }

  /** Start the child now so the first utterance does not wait for PowerShell to load. */
  warm(): void {
    this.ensureChild()
  }

  /** Play the wake cue through the player. */
  beep(): void {
    this.player.beep()
  }

  /** Cancel all queued, rendering and playing speech; pending `speak` calls resolve now. */
  stop(): void {
    if (this.child === undefined || this.pending.length === 0) return
    this.child.stdin.write('STOP\n')
    this.player.stop()
    this.owedAnswers += this.pending.filter(entry => !entry.answered).length
    const settled = this.pending
    this.pending = []
    for (const entry of settled) entry.resolve()
  }

  /** Stop the child for good. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.player.stop()
    const child = this.child
    if (child === undefined) return
    const exited = new Promise<void>((resolve) => {
      child.on('exit', () => {
        resolve()
      })
    })
    child.stdin.end()
    child.kill()
    await exited
  }

  private ensureChild(): ChildLike | undefined {
    if (this.child !== undefined) return this.child
    if (this.starts >= MAX_STARTS) {
      if (this.engine === undefined || this.fellBack) return undefined
      this.fellBack = true
      this.starts = 0
    }
    this.starts++
    const child = this.engine !== undefined && !this.fellBack
      ? this.spawnFn(this.engine.command, this.engine.args)
      : this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath])
    this.child = child
    ignoreStdinErrors(child)
    child.stdout.on('data', lineReader((line) => {
      this.onLine(line)
    }))
    let gone = false
    const onGone = (): void => {
      if (gone) return
      gone = true
      this.child = undefined
      this.owedAnswers = 0
      const failed = this.pending
      this.pending = []
      for (const entry of failed) entry.reject(new Error('speaker exited'))
    }
    child.on('exit', onGone)
    child.on('error', onGone)
    return child
  }

  private onLine(line: string): void {
    const text = line.trim()
    const wav = text.startsWith('WAV ') ? text.slice(4) : undefined
    if (wav === undefined && text !== 'DONE') return
    if (this.owedAnswers > 0) {
      this.owedAnswers--
      return
    }
    const entry = this.pending.find(candidate => !candidate.answered)
    if (entry === undefined) return
    entry.answered = true
    if (wav === undefined) {
      this.settle(entry)
      return
    }
    this.player.play(wav).then(() => {
      this.settle(entry)
    }, () => {
      this.settle(entry)
    })
  }

  private settle(entry: Pending): void {
    const index = this.pending.indexOf(entry)
    if (index < 0) return
    this.pending.splice(index, 1)
    entry.resolve()
  }
}
