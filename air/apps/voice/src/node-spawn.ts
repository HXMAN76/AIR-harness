import { spawn } from 'node:child_process'
import type { ChildLike } from './core/child.ts'

/**
 * Spawn with piped stdio and no console window.
 * @param command - executable.
 * @param args - arguments.
 * @returns the child process.
 */
export function nodeSpawn(command: string, args: readonly string[]): ChildLike {
  return spawn(command, args, { stdio: 'pipe', windowsHide: true })
}
