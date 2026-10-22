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

/**
 * Spawn with piped stdio, no console window, and an explicit environment.
 * @param command - executable.
 * @param args - arguments.
 * @param env - the child's whole environment.
 * @returns the child process.
 */
export function nodeSpawnEnv(command: string, args: readonly string[], env: Record<string, string | undefined>): ChildLike {
  return spawn(command, args, { stdio: 'pipe', windowsHide: true, env })
}
