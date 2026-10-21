/** Running PowerShell with constant scripts; the one variable value travels in an environment variable. */
import { execFile } from 'node:child_process'
import { isAllowedTarget } from './whitelist.ts'

/** Runs an executable with arguments and extra environment variables; rejects when it fails. */
export type ExecLike = (file: string, args: string[], env: Record<string, string>, timeoutMs?: number) => Promise<void>

/** The variable that carries the target (or process names) into a script. */
export const TARGET_ENV = 'AIR_OP_TARGET'

/** The script that opens a target. */
export const START_SCRIPT = `Start-Process -FilePath $env:${TARGET_ENV}`

/**
 * Run an executable without a console window and wait for it to exit.
 * @param file - executable.
 * @param args - arguments (passed as an argument vector, never through a shell).
 * @param env - variables added to the process environment.
 * @param timeoutMs - kill the process after this long; default 15 seconds.
 * @returns resolves on exit code 0, rejects with the error otherwise.
 */
export function nodeExec(file: string, args: string[], env: Record<string, string>, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: timeoutMs }, (error) => {
      if (error === null) resolve()
      else reject(new Error(`${file} failed: ${error.message}`))
    })
  })
}

/**
 * Run a constant PowerShell script.
 * @param exec - process runner.
 * @param script - script text; never built from user text.
 * @param target - value for `$env:AIR_OP_TARGET`, when the script reads it.
 */
export async function runPowerShell(exec: ExecLike, script: string, target?: string): Promise<void> {
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], target === undefined ? {} : { [TARGET_ENV]: target })
}

/**
 * Open a whitelisted app, scheme, or https URL with `Start-Process`.
 * @param exec - process runner.
 * @param target - checked with {@link isAllowedTarget} before anything runs.
 * @throws when the target is not allowed or the process fails.
 */
export async function startTarget(exec: ExecLike, target: string): Promise<void> {
  if (!isAllowedTarget(target)) throw new Error('That target is not allowed.')
  await runPowerShell(exec, START_SCRIPT, target)
}
