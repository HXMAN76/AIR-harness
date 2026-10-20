/**
 * One git command through the subprocess capability, with a timeout and bounded output.
 * @module @air/dsh-memory-store/git
 */

import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Milliseconds a git child gets to exit after termination starts; a fixed lifecycle constant. */
const TERMINATE_GRACE_MS = 2_000

/**
 * Run `git <args>` to completion.
 * @param subprocess - the subprocess service.
 * @param executable - git executable path or name.
 * @param args - git arguments; never shell-interpreted.
 * @param options - working directory, timeout in milliseconds, and cancellation.
 * @returns collected stdout.
 * @throws Error when the command exits non-zero, times out, is aborted, or cannot spawn.
 */
export async function runGit(
  subprocess: SubprocessRuntime,
  executable: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; signal: AbortSignal },
): Promise<string> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = AbortSignal.any([options.signal, timeout])
  const handle = subprocess.spawn({
    argv: [executable, ...args],
    cwd: options.cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 16 * 1024 } },
    graceMs: TERMINATE_GRACE_MS,
    signal,
    // The subprocess credential scrub already removes ambient GIT_CONFIG_KEY_n entries.
    env: { GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })
  const outcome = await handle.done
  const command = `git ${args.join(' ')}`
  if (signal.aborted) {
    throw new Error(`${command} ${timeout.aborted ? `timed out after ${String(options.timeoutMs)}ms` : 'was aborted'}`)
  }
  /* v8 ignore start -- collect-mode stdio always yields both readers. */
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  /* v8 ignore stop */
  if (outcome.exitCode !== 0) throw new Error(`${command} failed: ${stderr.trim()}`)
  return stdout
}
