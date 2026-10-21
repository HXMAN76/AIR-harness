/** Speaks text through a long-lived PowerShell child that drives Windows SAPI (`speaker.ps1`). */
import { fileURLToPath } from 'node:url'
import { nodeSpawn } from '../node-spawn.ts'
import { ignoreStdinErrors, lineReader, type ChildLike, type SpawnLike } from './child.ts'

/** Default location of the SAPI script next to `src/core` (the Electron main passes its own path). */
export const DEFAULT_SPEAKER_SCRIPT = fileURLToPath(new URL('../speaker.ps1', import.meta.url))

/** A child that exited this many times is not started again. */
const MAX_STARTS = 2

interface Pending {
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * Line protocol to the child: `SAY <base64 UTF-8>` queues an utterance, `STOP` cancels all, `BEEP` plays a beep;
 * the child writes `DONE` once per utterance when it finishes or is cancelled.
 */
export class Speaker {
  private child: ChildLike | undefined
  private starts = 0
  private pending: Pending[] = []
  /** `DONE` lines still owed for utterances that `stop()` already settled. */
  private owedDone = 0
  private disposed = false

  /**
   * @param spawnFn - starts the child; defaults to Node's `spawn`.
   * @param scriptPath - path of `speaker.ps1`.
   */
  constructor(private readonly spawnFn: SpawnLike = nodeSpawn, private readonly scriptPath = DEFAULT_SPEAKER_SCRIPT) {}

  /** Whether an utterance is queued or playing. */
  get speaking(): boolean {
    return this.pending.length > 0
  }

  /**
   * Speak one utterance.
   * @param text - plain text to say.
   * @returns settles when it finished or was stopped; rejects when the child exits or cannot start.
   */
  speak(text: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('speaker disposed'))
    const child = this.ensureChild()
    if (child === undefined) return Promise.reject(new Error('speaker unavailable'))
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject })
      child.stdin.write(`SAY ${Buffer.from(text, 'utf8').toString('base64')}\n`)
    })
  }

  /** Start the child now so the first beep or utterance does not wait for PowerShell to load. */
  warm(): void {
    this.ensureChild()
  }

  /** Play a short beep (the wake cue) without queueing; ignored when the child cannot start. */
  beep(): void {
    this.ensureChild()?.stdin.write('BEEP\n')
  }

  /** Cancel all queued and playing speech; pending `speak` calls resolve now. */
  stop(): void {
    if (this.child === undefined || this.pending.length === 0) return
    this.child.stdin.write('STOP\n')
    this.owedDone += this.pending.length
    const settled = this.pending
    this.pending = []
    for (const entry of settled) entry.resolve()
  }

  /** Stop the child for good. */
  async dispose(): Promise<void> {
    this.disposed = true
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
    if (this.starts >= MAX_STARTS) return undefined
    this.starts++
    const child = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath])
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
      this.owedDone = 0
      const failed = this.pending
      this.pending = []
      for (const entry of failed) entry.reject(new Error('speaker exited'))
    }
    child.on('exit', onGone)
    child.on('error', onGone)
    return child
  }

  private onLine(line: string): void {
    if (line.trim() !== 'DONE') return
    if (this.owedDone > 0) {
      this.owedDone--
      return
    }
    this.pending.shift()?.resolve()
  }
}
