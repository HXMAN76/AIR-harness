/**
 * Addressing of one server definition by name and review-key prefix, shared by the `air-mcp` command line and the
 * `/mcp-trust` session command so both apply the same matching rule.
 * @module
 */

import { clip } from './render.ts'

/** Fewest hexadecimal characters of a review key that address an entry. */
export const MIN_KEY_PREFIX = 8
/** Characters of a review key printed to tell same-named servers apart. */
export const KEY_PREFIX = 12

/** Result of matching a key prefix against candidates that share a server name. */
export type KeyMatch<T> =
  | { kind: 'one'; match: T }
  | { kind: 'invalid' }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: readonly T[] }

/**
 * Match a review-key prefix against the keyed candidates.
 * @param candidates - references that share one server name; those without a review key never match.
 * @param prefix - text the person typed after `--key`.
 * @returns `invalid` when the prefix has fewer than 8 hexadecimal characters or other characters; otherwise `one` for exactly one
 *   candidate whose key starts with it (case-insensitive), `none` for no candidate, or `ambiguous` with every match.
 */
export function matchKeyPrefix<T extends { reviewKey?: string }>(candidates: readonly T[], prefix: string): KeyMatch<T> {
  if (prefix.length < MIN_KEY_PREFIX || !/^[0-9a-f]+$/i.test(prefix)) return { kind: 'invalid' }
  const lower = prefix.toLowerCase()
  const matches = candidates.filter(each => each.reviewKey?.startsWith(lower) === true)
  const [only] = matches
  if (matches.length === 1 && only !== undefined) return { kind: 'one', match: only }
  return matches.length === 0 ? { kind: 'none' } : { kind: 'ambiguous', matches }
}

/**
 * Printable list of candidates, each as `name  key <first 12 characters>` or `name  key -` without a key.
 * @param refs - server references.
 * @param nameLimit - longest server name printed in full.
 * @returns the entries joined by `; `, with server text made visible.
 */
export function listCandidates(refs: readonly { serverName: string; reviewKey?: string }[], nameLimit: number): string {
  return refs
    .map(each => `${clip(each.serverName, nameLimit)}  key ${each.reviewKey === undefined ? '-' : clip(each.reviewKey.slice(0, KEY_PREFIX), nameLimit)}`)
    .join('; ')
}
