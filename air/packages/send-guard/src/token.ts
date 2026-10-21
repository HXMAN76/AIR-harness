/**
 * One-time send tokens. The voice controller issues a token after the user said yes to a draft: it writes an empty
 * file named by the token into the token directory and puts `[AIR-SEND-<16 hex>]` in the prompt that follows. The guard
 * consumes (deletes) the file on the one send it allows, so a token cannot be reused, invented, or replayed.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Matches a send token inside a message; group 1 is the 16 hex digits. */
export const SEND_TOKEN = /\[AIR-SEND-([0-9a-f]{16})\]/g

/**
 * @param dir - token directory, created when missing.
 * @param bytes - random source; tests pass a fixed one.
 * @returns the token text `[AIR-SEND-<16 hex>]`, whose file now exists in `dir`.
 */
export function issueSendToken(dir: string, bytes: () => Buffer = () => randomBytes(8)): string {
  const hex = bytes().toString('hex')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, hex), '')
  return `[AIR-SEND-${hex}]`
}

/**
 * Consume the first live token in a message.
 * @param dir - token directory.
 * @param text - the user message to search.
 * @returns whether a token was found whose file existed (and now no longer does).
 */
export function consumeSendToken(dir: string, text: string): boolean {
  for (const match of text.matchAll(SEND_TOKEN)) {
    const file = join(dir, match[1] as string)
    if (!existsSync(file)) continue
    unlinkSync(file)
    return true
  }
  return false
}
