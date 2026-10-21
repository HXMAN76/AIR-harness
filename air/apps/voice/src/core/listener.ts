/** Parent side of the speech listener: streams microphone frames to the VAD + SenseVoice worker and reads its segments. */
import { EventEmitter } from 'node:events'
import { dirname, join } from 'node:path'
import { nodeSpawn } from '../node-spawn.ts'
import { ignoreStdinErrors, lineReader, type ChildLike, type SpawnLike } from './child.ts'
import { modelPaths } from './models.ts'
import { SENSEVOICE_PACKAGE_JSON, VOICE_APP_ROOT } from './paths.ts'

/** One transcribed speech segment. */
export interface Segment {
  text: string
  durationMs: number
}

/** How to start the worker. Defaults run `node src/listener-worker.ts` from this checkout. */
export interface ListenerOptions {
  spawnFn?: SpawnLike
  /** Node executable; the worker loads a native addon built for Node, not Electron. */
  command?: string
  /** Full argument list passed to the command. Overrides workerPath, modelDir, sherpaFrom when set. */
  args?: string[]
  workerPath?: string
  /** Directory holding the three model files. */
  modelDir?: string
  /** `package.json` that `sherpa-onnx-node` is resolved from. */
  sherpaFrom?: string
}

/** A worker that exited this many times is not started again. */
const MAX_STARTS = 2

function isSegment(value: unknown): value is Segment {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.text === 'string' && typeof record.durationMs === 'number'
}

function isReady(value: unknown): value is { ready: true; loadMs: number } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.ready === true && typeof record.loadMs === 'number'
}

/**
 * Emits `'segment'` ({@link Segment}), `'ready'` (model load time in ms), and `'error'` (Error).
 * Protocol: raw Float32 little-endian 16 kHz mono samples on the worker's stdin; one JSON object per line on its stdout.
 */
export class Listener extends EventEmitter {
  private readonly spawnFn: SpawnLike
  private readonly command: string
  private readonly args: string[]
  private child: ChildLike | undefined
  private starts = 0

  /** @param options - worker launch options. */
  constructor(options: ListenerOptions = {}) {
    super()
    this.spawnFn = options.spawnFn ?? nodeSpawn
    this.command = options.command ?? 'node'
    this.args = options.args ?? [
      options.workerPath ?? join(VOICE_APP_ROOT, 'src', 'listener-worker.ts'),
      options.modelDir ?? dirname(modelPaths().model),
      options.sherpaFrom ?? SENSEVOICE_PACKAGE_JSON,
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
    this.child?.stdin.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength))
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
    if (isSegment(value)) this.emit('segment', { text: value.text, durationMs: value.durationMs })
    else if (isReady(value)) this.emit('ready', value.loadMs)
    else this.emit('error', new Error('listener sent a malformed line'))
  }
}
