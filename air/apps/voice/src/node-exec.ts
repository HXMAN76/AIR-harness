import { execFile } from 'node:child_process'

/**
 * Run an executable without a console window and wait for it to exit.
 * @param file - executable.
 * @param args - arguments (passed as an argument vector, never through a shell).
 * @param env - variables added to the process environment.
 * @returns resolves on exit code 0, rejects with the error otherwise.
 */
export function nodeExec(file: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 15_000 }, (error) => {
      if (error === null) resolve()
      else reject(new Error(`${file} failed: ${error.message}`))
    })
  })
}
