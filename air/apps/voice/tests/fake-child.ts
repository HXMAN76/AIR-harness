import { EventEmitter } from 'node:events'

/** A child process stand-in: records stdin writes, lets tests push stdout and exit. */
export class FakeChild extends EventEmitter {
  readonly written: (string | Buffer)[] = []
  ended = false
  killed = false
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = {
    write: (chunk: string | Buffer): boolean => {
      this.written.push(chunk)
      this.emit('stdin', chunk)
      return true
    },
    end: (): void => {
      this.ended = true
    },
  }

  /** Text written to stdin, joined. */
  get text(): string {
    return this.written.map(chunk => chunk.toString()).join('')
  }

  /** Emit one stdout chunk. */
  out(text: string): void {
    this.stdout.emit('data', Buffer.from(text))
  }

  kill(): boolean {
    this.killed = true
    this.emit('exit', null, 'SIGTERM')
    return true
  }

  exit(code = 1): void {
    this.emit('exit', code, null)
  }
}

/** A spawn function that hands out fresh fake children and remembers each call. */
export function fakeSpawn(onChild?: (child: FakeChild) => void): {
  spawn: (command: string, args: readonly string[]) => FakeChild
  children: FakeChild[]
  calls: { command: string; args: readonly string[] }[]
} {
  const children: FakeChild[] = []
  const calls: { command: string; args: readonly string[] }[] = []
  return {
    children,
    calls,
    spawn: (command, args) => {
      const child = new FakeChild()
      children.push(child)
      calls.push({ command, args })
      onChild?.(child)
      return child
    },
  }
}
