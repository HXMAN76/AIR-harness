/**
 * The five `air-mcp` operations over the `mcpTrust` service. Every outcome is
 * an exit code; nothing here exits the process or reads the command line.
 * Text that came from a server or from the lockfile is printed through `clip`,
 * which escapes control characters and cuts long text.
 * @module
 */

import { clip } from '@air/dsh-mcp-trust'
import type { LockEntrySummary, McpTrust, ObservedSurface, ServerRef } from '@air/dsh-mcp-trust'

/** One parsed command. `key` is the review key prefix of a project server's lockfile entry. */
export type TrustCliInvocation =
  | { kind: 'list' }
  | { kind: 'pin'; server: string; key?: string; tools?: string[]; yes: boolean }
  | { kind: 'diff'; server: string; key?: string }
  | { kind: 'verify'; all: boolean; server?: string; key?: string }
  | { kind: 'revoke'; server: string; key?: string; tools?: string[] }

/** Terminal operations; tests substitute them. */
export interface CliIo {
  /**
   * Write one line of results.
   * @param text - line without a trailing newline.
   */
  out(text: string): void
  /**
   * Write one diagnostic line.
   * @param text - line without a trailing newline.
   */
  err(text: string): void
  /**
   * Whether stdin is an interactive terminal.
   * @returns true when a confirmation can be asked.
   */
  isTty(): boolean
  /**
   * Ask a yes/no question.
   * @param question - prompt text.
   * @returns true only for an explicit yes.
   */
  confirm(question: string): Promise<boolean>
}

/** Every named surface is approved, or the write succeeded. */
export const EXIT_OK = 0
/** A surface differs from its pin, or a pin was declined. */
export const EXIT_DRIFT = 1
/**
 * The command line is wrong: a missing argument, an unusable `--key`, or no `--yes` without a terminal.
 * Same value as {@link EXIT_DRIFT}, like commander's usage errors.
 */
export const EXIT_USAGE = 1
/** A server was not observed, or an operation failed. */
export const EXIT_ERROR = 2

/** Command prefix named in every hint; it matches the program name in `--help`. */
const COMMAND = 'pnpm dsh --profile air-mcp'
const TRUSTED: readonly string[] = ['approved', 'tofu']
const NAME_LIMIT = 64
const MESSAGE_LIMIT = 500
const KEY_PREFIX = 12
const MIN_KEY_PREFIX = 8
const DRIFT_LIST_LIMIT = 10

function drifted(surface: ObservedSurface): boolean {
  return !TRUSTED.includes(surface.state)
}

function name(text: string): string {
  return clip(text, NAME_LIMIT)
}

function reasonOf(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), MESSAGE_LIMIT)
}

/** A lockfile entry of a project server. */
type ProjectEntry = LockEntrySummary & { reviewKey: string }

function isProject(entry: LockEntrySummary): entry is ProjectEntry {
  return entry.reviewKey !== undefined
}

function candidates(entries: readonly ProjectEntry[]): string {
  return entries.map(each => `${name(each.serverName)}  key ${name(each.reviewKey.slice(0, KEY_PREFIX))}`).join('; ')
}

/** Lockfile entries, or why they could not be read. */
async function readEntries(trust: McpTrust): Promise<{ entries: readonly LockEntrySummary[] } | { problem: string }> {
  try {
    return { entries: await trust.entries() }
  } catch (error) {
    return { problem: reasonOf(error) }
  }
}

function keyed(named: string | undefined, io: CliIo, key: string): number {
  const label = named === undefined ? 'a server' : `server "${name(named)}"`
  io.err(`air-mcp: ${label} (key ${name(key)}) belongs to a project and is reviewed inside a session in that project; this profile cannot observe it. Only revoke and list accept --key.`)
  return EXIT_USAGE
}

async function missing(server: string, trust: McpTrust, io: CliIo): Promise<number> {
  const found = await readEntries(trust)
  if ('problem' in found) {
    io.err(`air-mcp: server "${name(server)}" was not observed. This profile connects only the mcp-client rows in its own profile patch, each with inject: [mcpToolReview]; a server that a project's .mcp.json adds is not connected here. The lockfile cannot be read: ${found.problem}`)
    return EXIT_ERROR
  }
  const projects = found.entries.filter(each => each.serverName === server).filter(isProject)
  if (projects.length > 0) {
    io.err(`air-mcp: no profile-level server "${name(server)}" was observed, but the lockfile has entries for project servers with that name: ${candidates(projects)}. Those servers belong to a project and are reviewed inside a session in that project.`)
    return EXIT_ERROR
  }
  io.err(`air-mcp: server "${name(server)}" was not observed. This profile connects only the mcp-client rows in its own profile patch, each with inject: [mcpToolReview]; a server that a project's .mcp.json adds is not connected here. Check that the row exists and that the server starts.`)
  return EXIT_ERROR
}

async function diff(trust: McpTrust, invocation: { server: string; key?: string }, io: CliIo): Promise<number> {
  const { server } = invocation
  if (invocation.key !== undefined) return keyed(server, io, invocation.key)
  const ref: ServerRef = { serverName: server }
  const surface = trust.observed(ref)
  if (surface === undefined) return missing(server, trust, io)
  io.out(trust.describe(ref))
  if (!drifted(surface)) return EXIT_OK
  io.err(`air-mcp: server "${name(server)}" differs from its pin (${surface.state}). Run \`${COMMAND} pin ${name(server)}\` to approve it or \`${COMMAND} revoke ${name(server)}\` to keep it blocked.`)
  return EXIT_DRIFT
}

async function verify(trust: McpTrust, invocation: { all: boolean; server?: string; key?: string }, io: CliIo): Promise<number> {
  if (invocation.key !== undefined) return keyed(invocation.server, io, invocation.key)
  if (!invocation.all && invocation.server === undefined) {
    io.err(`air-mcp: verify needs a server name or --all. Run \`${COMMAND} verify --all\` to check every server.`)
    return EXIT_USAGE
  }
  const refs: readonly ServerRef[] = invocation.server === undefined ? trust.servers() : [{ serverName: invocation.server }]
  if (refs.length === 0) io.out('no MCP servers were observed')
  let code = EXIT_OK
  const differing: string[] = []
  for (const ref of refs) {
    const surface = trust.observed(ref)
    if (surface === undefined) {
      code = await missing(ref.serverName, trust, io)
      continue
    }
    io.out(`${name(ref.serverName)}: ${surface.state}`)
    if (!drifted(surface)) continue
    io.out(trust.describe(ref))
    differing.push(`${name(ref.serverName)} (${surface.state})`)
    code = Math.max(code, EXIT_DRIFT)
  }
  if (differing.length > 0) {
    const count = differing.length
    const shown = differing.slice(0, DRIFT_LIST_LIMIT).join(', ')
    const more = count > DRIFT_LIST_LIMIT ? `, and ${String(count - DRIFT_LIST_LIMIT)} more` : ''
    io.err(`air-mcp: ${String(count)} ${count === 1 ? 'server differs from its pin' : 'servers differ from their pins'}: ${shown}${more}. Run \`${COMMAND} diff <server>\` to see why.`)
  }
  return code
}

async function pin(
  trust: McpTrust,
  invocation: { server: string; key?: string; tools?: string[]; yes: boolean },
  io: CliIo,
): Promise<number> {
  const { server } = invocation
  if (invocation.key !== undefined) return keyed(server, io, invocation.key)
  const ref: ServerRef = { serverName: server }
  if (trust.observed(ref) === undefined) return missing(server, trust, io)
  io.out(trust.describe(ref))
  if (!invocation.yes) {
    if (!io.isTty()) {
      io.err('air-mcp: refusing to pin without --yes because stdin is not a terminal. Pass --yes to approve without a question.')
      return EXIT_USAGE
    }
    if (!await io.confirm(`Pin this surface for "${name(server)}"? [y/N] `)) {
      io.err('air-mcp: not pinned. Run the command again and answer y, or pass --yes.')
      return EXIT_DRIFT
    }
  }
  await trust.pin(ref, { ...invocation.tools === undefined ? {} : { tools: invocation.tools }, approvedBy: 'cli' })
  io.out(`pinned ${name(server)}`)
  return EXIT_OK
}

/** The entry `revoke` addresses, or the exit code after the explanation was written. */
async function target(
  trust: McpTrust,
  invocation: { server: string; key?: string },
  io: CliIo,
): Promise<ServerRef | number> {
  const found = await readEntries(trust)
  if ('problem' in found) {
    io.err(`air-mcp: the lockfile cannot be read: ${found.problem}`)
    return EXIT_ERROR
  }
  const { server, key } = invocation
  const named = found.entries.filter(each => each.serverName === server)
  const projects = named.filter(isProject)
  if (key !== undefined) {
    if (key.length < MIN_KEY_PREFIX || !/^[0-9a-f]+$/i.test(key)) {
      io.err(`air-mcp: --key needs at least ${String(MIN_KEY_PREFIX)} hexadecimal characters of the entry's key. Run \`${COMMAND} list\` to see the keys.`)
      return EXIT_USAGE
    }
    const prefix = key.toLowerCase()
    const matches = projects.filter(each => each.reviewKey.startsWith(prefix))
    const [only] = matches
    if (matches.length === 1 && only !== undefined) return { serverName: server, reviewKey: only.reviewKey }
    if (matches.length === 0) {
      const rest = projects.length > 0
        ? `Project entries named "${name(server)}": ${candidates(projects)}.`
        : `The lockfile has no project entries named "${name(server)}".`
      io.err(`air-mcp: no entry named "${name(server)}" has a key starting with ${name(key)}. ${rest}`)
    } else {
      io.err(`air-mcp: key prefix ${name(key)} matches ${String(matches.length)} entries named "${name(server)}": ${candidates(matches)}. Use a longer prefix.`)
    }
    return EXIT_USAGE
  }
  if (named.some(each => each.reviewKey === undefined)) return { serverName: server }
  if (projects.length > 0) {
    io.err(`air-mcp: "${name(server)}" has only project entries: ${candidates(projects)}. Pass --key <prefix> to choose one.`)
    return EXIT_USAGE
  }
  io.err(`air-mcp: the lockfile has no entry named "${name(server)}". Run \`${COMMAND} list\` to see the entries.`)
  return EXIT_ERROR
}

async function revoke(trust: McpTrust, invocation: { server: string; key?: string; tools?: string[] }, io: CliIo): Promise<number> {
  const ref = await target(trust, invocation, io)
  if (typeof ref === 'number') return ref
  await trust.revoke(ref, invocation.tools === undefined ? {} : { tools: invocation.tools })
  const label = `${name(ref.serverName)}${ref.reviewKey === undefined ? '' : ` (key ${name(ref.reviewKey.slice(0, KEY_PREFIX))})`}`
  io.out(invocation.tools === undefined ? `revoked ${label}` : `revoked ${label}: ${invocation.tools.map(name).join(', ')}`)
  return EXIT_OK
}

async function list(trust: McpTrust, io: CliIo): Promise<number> {
  const found = await readEntries(trust)
  if ('problem' in found) {
    io.err(`air-mcp: the lockfile cannot be read: ${found.problem}`)
    return EXIT_ERROR
  }
  if (found.entries.length === 0) io.out('the lockfile has no entries')
  for (const each of found.entries) {
    const key = each.reviewKey === undefined ? '-' : name(each.reviewKey.slice(0, KEY_PREFIX))
    io.out(`${name(each.serverName)}  ${key}  ${String(each.tools)} ${each.tools === 1 ? 'tool' : 'tools'}  ${each.approvedAt === '' ? '-' : name(each.approvedAt)}`)
  }
  return EXIT_OK
}

/**
 * Run one command.
 * @param trust - the trust service of the booted tree.
 * @param invocation - parsed command.
 * @param io - terminal operations.
 * @returns the process exit code; failures are reported through `io.err` and never thrown.
 */
export async function runTrustCli(trust: McpTrust, invocation: TrustCliInvocation, io: CliIo): Promise<number> {
  try {
    switch (invocation.kind) {
      case 'list': return await list(trust, io)
      case 'diff': return await diff(trust, invocation, io)
      case 'verify': return await verify(trust, invocation, io)
      case 'pin': return await pin(trust, invocation, io)
      case 'revoke': return await revoke(trust, invocation, io)
    }
  } catch (error) {
    io.err(`air-mcp: ${reasonOf(error)}`)
    return EXIT_ERROR
  }
}
