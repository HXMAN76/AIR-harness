/**
 * The `/mcp-trust` session command: review, approve, and revoke MCP servers from inside a session, backed by what
 * the trust engine observed in this process. A project server (one with a review key) exists only inside a session,
 * so the `air-mcp` command line cannot observe it; this command is where its surface is reviewed and pinned.
 *
 * Approval is bound to what the person reviewed: `pin` needs the first hex characters of the surface digest that
 * `diff` printed, and refuses when the server's surface has changed since.
 * Server-derived text goes through `clip` and `visible`, so it cannot add lines or terminal escapes to a result.
 * @module
 */

import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { describeDiff } from './engine.ts'
import { lockKey } from './lockfile.ts'
import { clip } from './render.ts'
import { KEY_PREFIX, listCandidates, matchKeyPrefix, MIN_KEY_PREFIX } from './resolve.ts'
import type { LockEntrySummary, McpTrust, ServerRef, ServerTrustState } from './types.ts'

/** What the command needs from the engine: the public service plus the reason a review failed. */
export interface CommandTrust extends McpTrust {
  /**
   * Why the latest review of a server raised an error.
   * @param server - local server name and optional review key.
   * @returns the error text, or `undefined` when the review did not fail or the server was never reviewed.
   */
  reviewFailure(server: ServerRef): string | undefined
}

const NAME_LIMIT = 64
const MESSAGE_LIMIT = 500
const SURFACE_PREFIX = 12
const USAGE = 'Usage: /mcp-trust [status] | diff <server> [--key <prefix>] | pin <server> [--key <prefix>] --surface <prefix> | revoke <server> [--key <prefix>]'

const STATE_LABEL: Record<ServerTrustState, string> = {
  approved: 'approved',
  tofu: 'first-use pinned',
  'accepted-once': 'accepted once, not pinned',
  unpinned: 'unpinned',
  withheld: 'blocked pending review',
  quarantined: 'blocked pending review',
}

type Subcommand = 'status' | 'diff' | 'pin' | 'revoke'

interface Parsed {
  sub: Subcommand
  server?: string
  key?: string
  surface?: string
}

/** One server the command can address: seen in this process, listed in the lockfile, or both. */
interface Candidate {
  ref: ServerRef
  observed: boolean
  entry?: LockEntrySummary
}

interface Known {
  candidates: readonly Candidate[]
  /** Why the lockfile could not be read. */
  problem?: string
}

type Resolved = { candidate: Candidate } | { error: string }

const fail = (text: string): CommandResult => ({ kind: 'error', text })

function reasonOf(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), MESSAGE_LIMIT)
}

function name(text: string): string {
  return clip(text, NAME_LIMIT)
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

function isSubcommand(word: string): word is Subcommand {
  return word === 'status' || word === 'diff' || word === 'pin' || word === 'revoke'
}

/** Split the arguments; `undefined` means the usage text applies. */
function parse(rawInput: string): Parsed | undefined {
  const tokens = rawInput.trim().split(/\s+/u).filter(token => token.length > 0)
  const sub = tokens.shift() ?? 'status'
  if (!isSubcommand(sub)) return undefined
  const flags: Record<string, string> = {}
  const positional: string[] = []
  for (let token = tokens.shift(); token !== undefined; token = tokens.shift()) {
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const flag = equals < 0 ? token.slice(2) : token.slice(2, equals)
    const value = equals < 0 ? tokens.shift() : token.slice(equals + 1)
    const allowed = flag === 'key' ? sub !== 'status' : flag === 'surface' && sub === 'pin'
    if (!allowed || value === undefined || value === '') return undefined
    flags[flag] = value
  }
  const [server, ...extra] = positional
  if (extra.length > 0 || (sub === 'status') !== (server === undefined)) return undefined
  return {
    sub,
    ...server === undefined ? {} : { server },
    ...flags['key'] === undefined ? {} : { key: flags['key'] },
    ...flags['surface'] === undefined ? {} : { surface: flags['surface'] },
  }
}

/** Observed servers first, then lockfile-only entries; a definition in both appears once. */
async function gather(trust: CommandTrust): Promise<Known> {
  const byKey = new Map<string, Candidate>()
  for (const ref of trust.servers()) byKey.set(lockKey(ref.serverName, ref.reviewKey), { ref, observed: true })
  try {
    for (const entry of await trust.entries()) {
      const { serverName, reviewKey } = entry
      const ref: ServerRef = reviewKey === undefined ? { serverName } : { serverName, reviewKey }
      const key = lockKey(ref.serverName, ref.reviewKey)
      byKey.set(key, { ref, observed: byKey.get(key)?.observed === true, entry })
    }
  } catch (error) {
    return { candidates: [...byKey.values()], problem: reasonOf(error) }
  }
  return { candidates: [...byKey.values()] }
}

function unknown(server: string, known: Known): string {
  const list = known.candidates.length === 0
    ? 'No servers are known yet: none was observed in this process and the lockfile lists none. Check that the MCP servers are configured and connected.'
    : `Known servers: ${listCandidates(known.candidates.map(each => each.ref), NAME_LIMIT)}.`
  return `no server named "${name(server)}" is known. ${list} Run /mcp-trust status to see them.`
}

/** Pick the one candidate the person named, or explain what to type instead. */
function resolve(parsed: Parsed, known: Known): Resolved {
  const server = parsed.server as string
  const named = known.candidates.filter(each => each.ref.serverName === server)
  const refs = named.map(each => each.ref)
  const [only] = named
  if (parsed.key === undefined) {
    if (only === undefined) return { error: unknown(server, known) }
    if (named.length === 1) return { candidate: only }
    return { error: `${String(named.length)} servers are named "${name(server)}": ${listCandidates(refs, NAME_LIMIT)}. Run the command again with --key <prefix>; --key - selects the one without a key.` }
  }
  if (parsed.key === '-') {
    const keyless = named.find(each => each.ref.reviewKey === undefined)
    if (keyless !== undefined) return { candidate: keyless }
    return { error: only === undefined ? unknown(server, known) : `no server named "${name(server)}" is without a key. Candidates: ${listCandidates(refs, NAME_LIMIT)}.` }
  }
  const match = matchKeyPrefix(refs, parsed.key)
  switch (match.kind) {
    case 'one': {
      const candidate = named.find(each => each.ref === match.match) as Candidate
      return { candidate }
    }
    case 'invalid':
      return { error: `--key needs at least ${String(MIN_KEY_PREFIX)} hexadecimal characters of the server's key, or - for the server without a key. Run /mcp-trust status to see the keys.` }
    case 'none':
      return { error: `no server named "${name(server)}" has a key starting with ${name(parsed.key)}. ${only === undefined ? unknown(server, known) : `Candidates: ${listCandidates(refs, NAME_LIMIT)}.`}` }
    case 'ambiguous':
      return { error: `key prefix ${name(parsed.key)} matches ${String(match.matches.length)} servers named "${name(server)}": ${listCandidates(match.matches, NAME_LIMIT)}. Use a longer prefix.` }
  }
}

/** Server name and key prefix as the person types them in a command. */
function target(ref: ServerRef): string {
  return `${name(ref.serverName)}${ref.reviewKey === undefined ? '' : ` --key ${clip(ref.reviewKey.slice(0, KEY_PREFIX), KEY_PREFIX)}`}`
}

function label(ref: ServerRef): string {
  return `"${name(ref.serverName)}"${ref.reviewKey === undefined ? '' : ` (key ${clip(ref.reviewKey.slice(0, KEY_PREFIX), KEY_PREFIX)})`}`
}

function hexOf(digest: string): string {
  return digest.replace(/^sha256:/u, '')
}

function status(trust: CommandTrust, known: Known): CommandResult {
  const lines: string[] = []
  if (known.problem !== undefined) {
    lines.push(`The lockfile is unreadable (lockfile unreadable: ${known.problem}). Every MCP server is blocked until it is repaired or moved aside; /mcp-trust pin and revoke refuse until then.`)
  }
  for (const { ref, observed, entry } of known.candidates) {
    const key = ref.reviewKey === undefined ? '-' : clip(ref.reviewKey.slice(0, KEY_PREFIX), KEY_PREFIX)
    const surface = observed ? trust.observed(ref) : undefined
    let state = 'pinned, not observed in this process'
    let tools = entry?.tools ?? 0
    let note = ''
    if (surface !== undefined) {
      tools = surface.tools.length
      if (known.problem !== undefined) state = 'lockfile unreadable'
      else if (trust.reviewFailure(ref) !== undefined) state = 'review failed'
      else {
        state = STATE_LABEL[surface.state]
        if (surface.state === 'withheld' || surface.state === 'quarantined') note = `  (${describeDiff(surface.diff)})`
      }
    }
    lines.push(`${name(ref.serverName)}  ${key}  ${state}  ${plural(tools, 'tool')}${note}`)
  }
  if (lines.length === 0) return { kind: 'success', text: 'no MCP servers were observed and the lockfile has no entries' }
  return { kind: 'success', text: lines.join('\n') }
}

function diff(trust: CommandTrust, candidate: Candidate, known: Known): CommandResult {
  const { ref } = candidate
  const surface = candidate.observed ? trust.observed(ref) : undefined
  if (surface === undefined) {
    return fail(`server ${label(ref)} is not observed in this process, so there is no surface to compare. It is listed in the lockfile only; connect it in this session first.`)
  }
  const text = trust.describe(ref)
  if (known.problem !== undefined) {
    return { kind: 'success', text: `${text}\nThe lockfile is unreadable, so this surface cannot be pinned until it is repaired or moved aside.` }
  }
  if (trust.reviewFailure(ref) !== undefined || surface.surfaceDigest === '') {
    return { kind: 'success', text: `${text}\nThis surface cannot be pinned.` }
  }
  if (surface.state === 'approved' || surface.state === 'tofu') {
    return { kind: 'success', text: `${text}\nThis surface is already approved; there is nothing to pin.` }
  }
  const pin = `/mcp-trust pin ${target(ref)} --surface ${hexOf(surface.surfaceDigest).slice(0, SURFACE_PREFIX)}`
  return { kind: 'success', text: `${text}\nTo approve exactly this surface, run:\n${pin}` }
}

async function pin(trust: CommandTrust, candidate: Candidate, surfaceArg: string | undefined, known: Known): Promise<CommandResult> {
  const { ref } = candidate
  const again = `Run /mcp-trust diff ${target(ref)} to review the current surface and get the command that approves it.`
  if (surfaceArg === undefined) return fail(`pin needs --surface <prefix>, the start of the surface digest that diff printed, so the approval covers what you reviewed. ${again}`)
  if (surfaceArg.length < MIN_KEY_PREFIX || !/^[0-9a-f]+$/iu.test(surfaceArg)) {
    return fail(`--surface needs at least ${String(MIN_KEY_PREFIX)} hexadecimal characters of the surface digest. ${again}`)
  }
  if (known.problem !== undefined) {
    return fail(`the lockfile is unreadable, so nothing was pinned: ${known.problem}. Repair the file or move it aside, then run /mcp-trust diff ${target(ref)} again.`)
  }
  const surface = candidate.observed ? trust.observed(ref) : undefined
  if (surface === undefined) return fail(`server ${label(ref)} is not observed in this process, so nothing was pinned. Connect it in this session first.`)
  const failure = trust.reviewFailure(ref)
  if (failure !== undefined || surface.surfaceDigest === '') {
    return fail(`server ${label(ref)} cannot be pinned: ${failure === undefined ? 'its surface cannot be canonicalized' : `its review failed (${clip(failure, MESSAGE_LIMIT)})`}. Run /mcp-trust diff ${target(ref)} for details.`)
  }
  if (!hexOf(surface.surfaceDigest).startsWith(surfaceArg.toLowerCase())) {
    return fail(`the surface of ${label(ref)} changed since the digest you gave (${name(surfaceArg)}), so nothing was pinned: the surface changed after you reviewed it. ${again}`)
  }
  try {
    await trust.pin(ref, { approvedBy: 'command' })
    const pinned = (await trust.entries()).find(each => each.serverName === ref.serverName && each.reviewKey === ref.reviewKey)
    return { kind: 'success', text: `Pinned ${label(ref)}: ${plural(pinned?.tools ?? 0, 'tool')} pinned. The server is re-syncing, so its tools register now.` }
  } catch (error) {
    return fail(`could not pin ${label(ref)}: ${reasonOf(error)}`)
  }
}

async function revoke(trust: CommandTrust, candidate: Candidate, known: Known): Promise<CommandResult> {
  const { ref } = candidate
  if (known.problem !== undefined) {
    return fail(`the lockfile is unreadable, so nothing was revoked: ${known.problem}. Repair the file or move it aside first.`)
  }
  if (candidate.entry === undefined || candidate.entry.tools === 0) {
    return fail(`server ${label(ref)} has no pin in the lockfile, so there is nothing to revoke. Run /mcp-trust status to see the pins.`)
  }
  try {
    await trust.revoke(ref, {})
    return { kind: 'success', text: `Revoked ${label(ref)}: its pin is removed and its tools unregister. Run /mcp-trust diff ${target(ref)} to review and pin it again.` }
  } catch (error) {
    return fail(`could not revoke ${label(ref)}: ${reasonOf(error)}`)
  }
}

/**
 * Build the `/mcp-trust` handler.
 * @param trust - the trust engine of this process.
 * @returns a command handler that never throws: every failure becomes an `error` result with the next step.
 */
export function createTrustCommand(trust: CommandTrust): (invocation: Pick<CommandInvocation, 'rawInput'>) => Promise<CommandResult> {
  return async (invocation) => {
    try {
      const parsed = parse(invocation.rawInput)
      if (parsed === undefined) return fail(USAGE)
      const known = await gather(trust)
      if (parsed.sub === 'status') return status(trust, known)
      const resolved = resolve(parsed, known)
      if ('error' in resolved) return fail(resolved.error)
      switch (parsed.sub) {
        case 'diff': return diff(trust, resolved.candidate, known)
        case 'pin': return await pin(trust, resolved.candidate, parsed.surface, known)
        case 'revoke': return await revoke(trust, resolved.candidate, known)
      }
    } catch (error) {
      return fail(`/mcp-trust failed: ${reasonOf(error)}`)
    }
  }
}
