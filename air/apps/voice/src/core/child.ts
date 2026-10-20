/** The part of a Node child process the voice app's children use; lets tests pass a fake. */
export interface ChildLike {
  readonly stdin: { write(chunk: string | Uint8Array): boolean; end(): void; on(event: 'error', listener: (error: Error) => void): unknown }
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown }
  on(event: 'exit' | 'error', listener: (...args: unknown[]) => void): unknown
  kill(): boolean
}

/** Starts a child process with piped stdio. */
export type SpawnLike = (command: string, args: readonly string[]) => ChildLike

/**
 * Split a byte stream into lines; `\r` before `\n` is dropped.
 * @param onLine - receives each complete line.
 * @returns a function to feed chunks to.
 */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let rest = ''
  return (chunk) => {
    const parts = (rest + chunk.toString('utf8')).split('\n')
    rest = parts.splice(-1, 1).join('')
    for (const part of parts) onLine(part.replace(/\r$/, ''))
  }
}

/** Ignore write errors on a child's stdin (EPIPE/EOF after it died); its exit handler reports the failure. */
export function ignoreStdinErrors(child: ChildLike): void {
  child.stdin.on('error', () => undefined)
}
