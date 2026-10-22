/**
 * One-time approval tokens bound to one exact tool call. The voice controller issues a token after the user said yes:
 * a file named by the token holds the digest of the call it approves, and the token goes in the prompt that follows. The
 * plugin allows a call only when its digest matches that file, and deletes the file on the allow, so a token approves one
 * command once and nothing else.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Matches an approval token inside a message; group 1 is the 16 hex digits. */
export const APPROVE_TOKEN = /\[AIR-APPROVE-([0-9a-f]{16})\]/g

/**
 * @param dir - token directory, created when missing.
 * @param digest - digest of the call being approved (see `approvalDigest`).
 * @param bytes - random source; tests pass a fixed one.
 * @returns the token text `[AIR-APPROVE-<16 hex>]`.
 */
export function issueApprovalToken(dir: string, digest: string, bytes: () => Buffer = () => randomBytes(8)): string {
  const hex = bytes().toString('hex')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, hex), digest)
  return `[AIR-APPROVE-${hex}]`
}

/**
 * Look for a live token in a message whose bound digest is this one. Nothing is consumed.
 * @param dir - token directory.
 * @param text - the user message.
 * @param digest - digest of the call asking to run.
 * @returns the token's 16 hex digits, or undefined.
 */
export function findApprovalToken(dir: string, text: string, digest: string): string | undefined {
  for (const match of text.matchAll(APPROVE_TOKEN)) {
    const hex = match[1] as string
    const file = join(dir, hex)
    if (existsSync(file) && readFileSync(file, 'utf8') === digest) return hex
  }
  return undefined
}

/**
 * @param dir - token directory.
 * @param hex - a token found by {@link findApprovalToken}.
 * @returns whether the token was still live (it is deleted either way).
 */
export function consumeApprovalToken(dir: string, hex: string): boolean {
  const file = join(dir, hex)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}
