/**
 * Trust engine: reviews fetched MCP generations against the lockfile, tracks
 * which registered tool carries which approved digest, and owns one-shot
 * acceptance, TTL re-verification, pinning, and revocation. It has no Cordis
 * dependency; the plugin entry wires it to services and effects.
 *
 * A server definition is identified by its local name plus, for project
 * servers, the review key. Every per-server map is keyed by `lockKey`, so two
 * servers with the same name but different keys never share a pin, an
 * observation, a prompt budget, a timer, or a one-shot acceptance.
 * @module
 */

import type { McpToolReview, McpToolReviewRequest, McpToolReviewVerdict } from '@deepseek-ai/dsh-mcp-client'
import { DIGEST_FIELDS, type ToolDigest } from './canonical.ts'
import { lockKey, parseLockKey, readLockfile, updateLockfile, type LockDocument, type LockTool } from './lockfile.ts'
import { commandHint, renderSurfaceDiff, visible } from './render.ts'
import type { LockEntrySummary, McpTool, McpTrust, ObservedSurface, ServerPolicy, ServerRef, SurfaceDiff, TrustAction } from './types.ts'
import { buildEntry, decide, emptyDiff, hasDrift, withTools } from './verdict.ts'

/** Error text for log lines and rendered messages. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reference with the review key present only when the server has one. */
function refOf(serverName: string, reviewKey: string | undefined): ServerRef {
  return reviewKey === undefined ? { serverName } : { serverName, reviewKey }
}

/** Text that tells two servers with the same name apart; empty without a review key. */
function keyNote(reviewKey: string | undefined): string {
  return reviewKey === undefined ? '' : ` (key ${visible(reviewKey.slice(0, 12))})`
}

/**
 * What the person can do next; every denial and prompt ends with it. Contains only the configured command,
 * the server name, and the review key prefix.
 * @param cli - command prefix of the `air-mcp` profile, for example `pnpm dsh --profile air-mcp`.
 * @param server - local server name.
 * @param reviewKey - identity of the server definition, when it has one.
 * @returns two sentences naming the commands: `diff`, `pin`, and `revoke` of the `air-mcp` profile for a profile-level
 *   server, or `/mcp-trust diff` (which prints the approval command) and `/mcp-trust revoke` for a project server.
 */
export function nextSteps(cli: string, server: string, reviewKey?: string): string {
  const command = (action: 'pin' | 'diff' | 'revoke'): string => `\`${commandHint(cli, action, server, reviewKey)}\``
  if (reviewKey !== undefined) {
    return `The person can run ${command('diff')} in this session to see what differs; it prints the command that approves exactly that surface. Running ${command('revoke')} keeps it blocked. An allow rule never approves a server.`
  }
  return `The person can run ${command('diff')} to see what differs, then ${command('pin')} to approve it or ${command('revoke')} to keep it blocked. An allow rule never approves a server.`
}

/**
 * Summarize a difference from the pin using only fixed vocabulary: counts and
 * the names in {@link DIGEST_FIELDS}. No tool name, description, or other
 * server-supplied text appears in the result, so it may reach the model.
 * @param diff - the observed difference.
 * @returns a short clause such as `2 changed tools (fields: description), 1 added tool`.
 */
export function describeDiff(diff: SurfaceDiff): string {
  const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`
  const fields = DIGEST_FIELDS.filter(field => diff.changed.some(entry => entry.fields.includes(field)))
  const parts: string[] = []
  if (diff.changed.length > 0) parts.push(`${plural(diff.changed.length, 'changed tool')} (fields: ${fields.join(', ')})`)
  if (diff.instructionsChanged) parts.push('changed server instructions')
  if (diff.added.length > 0) parts.push(plural(diff.added.length, 'added tool'))
  if (diff.removed.length > 0) parts.push(plural(diff.removed.length, 'removed tool'))
  return parts.length === 0 ? 'no difference was recorded' : parts.join(', ')
}

/**
 * Guard reason for a tool of a server that is not approved (the tool never registered).
 * @param server - local server name.
 * @param surface - the latest observed surface of the server.
 * @param cli - command prefix of the `air-mcp` profile.
 * @returns text naming the server, the difference, and the commands to run.
 */
export function blockedReason(server: string, surface: ObservedSurface, cli: string): string {
  const name = `"${visible(server)}"${keyNote(surface.reviewKey)}`
  const what = surface.diff.invalid !== undefined
    ? 'a definition cannot be hashed (it is not valid JSON text), so the server cannot be pinned'
    : surface.state === 'unpinned'
      ? `it has no approved pin yet (${describeDiff(surface.diff)})`
      : `it differs from its pin: ${describeDiff(surface.diff)}`
  const verb = surface.state === 'withheld' ? 'withheld some tools of' : 'blocked'
  return `MCP trust ${verb} server ${name}: ${what}. ${nextSteps(cli, server, surface.reviewKey)}`
}

/**
 * Guard reason for a tool of a server whose review raised an error (no tool registered).
 * @param server - local server name.
 * @param reviewKey - identity of the server definition, when it has one.
 * @param cli - command prefix of the `air-mcp` profile.
 * @returns text naming the server; the cause is in the log and in `diff`, never here.
 */
export function reviewFailedReason(server: string, reviewKey: string | undefined, cli: string): string {
  return `MCP trust blocked server "${visible(server)}"${keyNote(reviewKey)}: its review failed, so none of its tools registered. The cause is in the log. ${nextSteps(cli, server, reviewKey)}`
}

/**
 * Guard reason for a registered tool whose approval changed after it registered.
 * @param server - local server name.
 * @param changedFields - fields whose digest differs from the lockfile, or `undefined` when the lockfile no longer lists the tool.
 * @param cli - command prefix of the `air-mcp` profile.
 * @param reviewKey - identity of the server definition, when it has one.
 * @returns text naming the server, what changed, and the commands to run.
 */
export function revokedReason(server: string, changedFields: readonly string[] | undefined, cli: string, reviewKey?: string): string {
  const what = changedFields === undefined
    ? 'its approval was removed from the lockfile'
    : `its approved definition no longer matches the registered one (fields: ${changedFields.join(', ')})`
  return `MCP trust denied this call to server "${visible(server)}"${keyNote(reviewKey)}: ${what}. ${nextSteps(cli, server, reviewKey)}`
}

/**
 * Guard reason for an `mcp__` tool that no trust review registered.
 * @param server - server segment of the tool name.
 * @param cli - command prefix of the `air-mcp` profile.
 * @returns text naming the server and the commands to run.
 */
export function unreviewedReason(server: string, cli: string): string {
  return `MCP trust denied this call: the tool of server "${visible(server)}" was not registered through trust review. ${nextSteps(cli, server)}`
}

/**
 * Guard reason while the lockfile cannot be read.
 * @param lockfile - lockfile path.
 * @param cli - command prefix of the `air-mcp` profile.
 * @returns text naming the file and how to find the cause.
 */
export function lockProblemReason(lockfile: string, cli: string): string {
  return `MCP trust denied this call: the lockfile ${lockfile} is unreadable, so every MCP tool is blocked. The file was not changed. The person can run \`${cli} verify --all\` for the cause, repair the file or move it aside, and pin the servers again.`
}

/** Resolved engine settings. */
export interface EngineConfig {
  /** Absolute lockfile path. */
  lockfile: string
  /** Longest wait for the lockfile writer lock, in milliseconds. */
  lockWaitMs: number
  /** Deny calls to `mcp__` tools that no review registered. */
  denyUnreviewedMcpTools: boolean
  /** Approval prompts per server for the life of the process. */
  maxPromptsPerServer: number
  /** Lower bound of the TTL re-verification delay, in milliseconds. */
  minReverifyMs: number
  /** Upper bound of the TTL re-verification delay, in milliseconds. */
  maxReverifyMs: number
  /** Command prefix of the `air-mcp` profile, named in every prompt and denial. */
  cliCommand: string
  /** Whether approving a server that has no lock entry also writes its pin. A changed surface is never pinned by a prompt. */
  enrollOnApproval: boolean
  /**
   * Resolved policy of one server.
   * @param serverName - local server name.
   * @returns the server's policy.
   */
  policyOf(serverName: string): ServerPolicy
}

/** Log sink used by the engine. */
export interface EngineLogger {
  /**
   * Report a recoverable condition.
   * @param message - log line.
   */
  warn(message: string): void
  /**
   * Report a failure that rejects reviews.
   * @param message - log line.
   */
  error(message: string): void
}

/** One review that found a difference. */
export interface DriftRecord extends SurfaceDiff {
  serverName: string
  /** Identity of the server definition, when it has one. */
  reviewKey?: string
  action: TrustAction
}

/** A withheld or rejected surface offered for one-shot approval. */
export interface PendingSurface {
  serverName: string
  /** Identity of the server definition, when it has one. */
  reviewKey?: string
  /** The surface the approval refers to. */
  surface: ObservedSurface
  /** Queue a fresh fetch and review of the server. */
  resync: () => void
}

interface Observation {
  surface: ObservedSurface
  digests: Map<string, ToolDigest>
  /** Why the review raised an error, when it did; no tool of the generation registered. */
  failure?: string
  resync: () => void
}

interface Registration {
  key: string
  serverName: string
  reviewKey: string | undefined
  rawName: string
  digest: string | undefined
  surfaceDigest: string
}

const PROMPTABLE: readonly string[] = ['withheld', 'quarantined', 'unpinned']

/** Reviewer and trust store for every MCP server in one process. */
export class TrustEngine implements McpToolReview, McpTrust {
  private lock: LockDocument | undefined
  /** Why the lockfile could not be read; set exactly while `lock` is `undefined`. */
  private lockProblem: string | undefined
  private disposed = false
  private readonly observations = new Map<string, Observation>()
  private readonly registered = new Map<string, Registration>()
  private readonly acceptedOnce = new Map<string, string>()
  private readonly prompts = new Map<string, number>()
  private readonly prompting = new Set<string>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  /** @param options - resolved settings, log sink, clock, and drift listener. */
  constructor(private readonly options: {
    config: EngineConfig
    logger: EngineLogger
    now: () => Date
    drift: (record: DriftRecord) => void
  }) {}

  async review(request: McpToolReviewRequest): Promise<McpToolReviewVerdict> {
    const { serverName } = request
    const ref = refOf(serverName, request.reviewKey)
    const key = lockKey(serverName, request.reviewKey)
    try {
      return await this.reviewChecked(request, ref, key)
    } catch (error) {
      // Fail closed: nothing of this generation registers, and the cause is reported.
      const cause = reason(error)
      this.options.logger.error(`mcp-trust(${visible(serverName)}${keyNote(request.reviewKey)}): the review failed, so no tool of this server registered: ${cause}`)
      this.unregister(key)
      this.observations.set(key, {
        surface: this.blockedSurface(request, ref),
        digests: new Map(),
        failure: cause,
        resync: () => { request.resync() },
      })
      return { tools: [], instructions: '' }
    }
  }

  private blockedSurface(request: McpToolReviewRequest, ref: ServerRef): ObservedSurface {
    return {
      ...ref,
      surfaceDigest: '',
      instructions: request.instructions,
      tools: request.tools.map(tool => tool.definition),
      diff: emptyDiff(),
      state: 'quarantined',
      action: 'reject-generation',
      withheld: request.tools.map(tool => tool.rawName),
      observedAt: this.options.now().getTime(),
    }
  }

  private async reviewChecked(request: McpToolReviewRequest, ref: ServerRef, key: string): Promise<McpToolReviewVerdict> {
    const { serverName } = request
    const { config, logger } = this.options
    const policy = config.policyOf(serverName)
    // Mode off behaves as if the reviewer were absent, so it neither reads nor depends on the lockfile.
    if (policy.mode !== 'off') await this.reload()
    const lock = this.lock
    if (policy.mode !== 'off' && lock === undefined) {
      // Record the server so a repaired lockfile re-syncs it and `verify` reports it as blocked.
      this.unregister(key)
      this.observations.set(key, {
        surface: this.blockedSurface(request, ref),
        digests: new Map(),
        resync: () => { request.resync() },
      })
      return { tools: [], instructions: '' }
    }
    const entry = lock?.servers[key]
    const decision = decide<McpTool>({
      policy,
      entry,
      tools: request.tools.map(tool => tool.definition),
      instructions: request.instructions,
      acceptedOnce: this.acceptedOnce.get(key),
      now: this.options.now().toISOString(),
      ...request.reviewKey === undefined ? {} : { reviewKey: request.reviewKey },
    })
    if (decision.tofu !== undefined) {
      const first = decision.tofu
      this.lock = await updateLockfile(config.lockfile, (doc) => { doc.servers[key] ??= first }, config.lockWaitMs)
      logger.warn(`mcp-trust(${visible(serverName)}${keyNote(request.reviewKey)}): no pin existed, so the first surface was pinned on first use; review it with \`${commandHint(config.cliCommand, 'diff', serverName, request.reviewKey)}\``)
    }

    this.unregister(key)
    const accepted = new Set(decision.accepted.map(tool => tool.name))
    for (const tool of request.tools) {
      if (!accepted.has(tool.rawName)) continue
      this.registered.set(tool.publicName, {
        key,
        serverName,
        reviewKey: request.reviewKey,
        rawName: tool.rawName,
        digest: decision.digests.get(tool.rawName)?.digest,
        surfaceDigest: decision.surfaceDigest,
      })
    }
    this.observations.set(key, {
      surface: {
        ...ref,
        surfaceDigest: decision.surfaceDigest,
        instructions: request.instructions,
        tools: request.tools.map(tool => tool.definition),
        diff: decision.diff,
        state: decision.state,
        action: decision.action,
        withheld: decision.withheld,
        ...entry === undefined ? {} : { pinnedDigest: entry.surfaceDigest },
        observedAt: this.options.now().getTime(),
      },
      digests: decision.digests,
      resync: () => { request.resync() },
    })
    this.arm(key, request)
    if (hasDrift(decision.diff)) {
      const { added, removed, changed } = decision.diff
      logger.warn(`mcp-trust(${visible(serverName)}${keyNote(request.reviewKey)}): tool surface differs from its pin (${String(added.length)} added, ${String(removed.length)} removed, ${String(changed.length)} changed); action ${decision.action}. Run \`${commandHint(config.cliCommand, 'diff', serverName, request.reviewKey)}\` to review it.`)
      this.options.drift({ ...ref, ...decision.diff, action: decision.action })
    }
    return { tools: decision.accepted, instructions: decision.instructions }
  }

  /**
   * Call-time check for one ToolRuntime execution.
   * @param name - public tool name being executed.
   * @returns a denial reason, or `undefined` to leave the call unchanged.
   */
  guard(name: string): string | undefined {
    const { config } = this.options
    const entry = this.registered.get(name)
    if (entry === undefined) {
      if (!config.denyUnreviewedMcpTools || !name.startsWith('mcp__')) return undefined
      /* v8 ignore next -- split always yields a first element */
      const server = name.slice('mcp__'.length).split('__')[0] ?? ''
      if (config.policyOf(server).mode === 'off') return undefined
      if (this.lockProblem !== undefined) return lockProblemReason(config.lockfile, config.cliCommand)
      const known = [...this.observations.values()].filter(observation => observation.surface.serverName === server)
      const failed = known.find(observation => observation.failure !== undefined)
      if (failed !== undefined) return reviewFailedReason(server, failed.surface.reviewKey, config.cliCommand)
      const blocked = known.find(observation => PROMPTABLE.includes(observation.surface.state))
      return blocked !== undefined
        ? blockedReason(server, blocked.surface, config.cliCommand)
        : unreviewedReason(server, config.cliCommand)
    }
    if (config.policyOf(entry.serverName).mode === 'off') return undefined
    if (this.acceptedOnce.get(entry.key) === entry.surfaceDigest) return undefined
    const approved = this.lock?.servers[entry.key]?.tools[entry.rawName]
    if (approved?.digest === entry.digest) return undefined
    if (this.lockProblem !== undefined) return lockProblemReason(config.lockfile, config.cliCommand)
    const registered = this.observations.get(entry.key)?.digests.get(entry.rawName)?.fields
    const changed = approved === undefined ? undefined : DIGEST_FIELDS.filter(field => registered?.[field] !== approved.fields[field])
    return revokedReason(entry.serverName, changed, config.cliCommand, entry.reviewKey)
  }

  /** Re-read the lockfile after it changed on disk, then re-sync every observed server. */
  async lockChanged(): Promise<void> {
    if (this.disposed) return
    await this.reload()
    for (const observation of this.observations.values()) observation.resync()
  }

  /**
   * Report a lockfile watcher failure.
   * @param error - the watcher's error.
   */
  readonly watchFailed = (error: Error): void => {
    this.options.logger.warn(`mcp-trust: lockfile watch failed; revocations apply at the next sync: ${error.message}`)
  }

  /**
   * Claim the surfaces that may be offered for one-shot approval now. Each
   * claimed surface counts against its server's prompt cap and is not offered
   * again until {@link settlePrompt} releases it.
   * @returns the claimed surfaces.
   */
  takePromptable(): PendingSurface[] {
    const pending: PendingSurface[] = []
    // An unreadable lockfile is repaired by a person; accepting one surface would not repair it.
    if (this.lockProblem !== undefined) return pending
    for (const [key, observation] of this.observations) {
      const { surface } = observation
      if (!PROMPTABLE.includes(surface.state) || surface.surfaceDigest === '') continue
      if (this.prompting.has(key)) continue
      const asked = this.prompts.get(key) ?? 0
      if (asked >= this.options.config.maxPromptsPerServer) continue
      this.prompts.set(key, asked + 1)
      this.prompting.add(key)
      pending.push({
        serverName: surface.serverName,
        ...surface.reviewKey === undefined ? {} : { reviewKey: surface.reviewKey },
        surface,
        resync: observation.resync,
      })
    }
    return pending
  }

  /**
   * Record the answer to one claimed surface.
   * @param pending - surface returned by {@link takePromptable}.
   * @param accepted - whether the user allowed it. A server with no lock entry is pinned (approved by `prompt`) when
   *   `enrollOnApproval` is set. Every other acceptance lasts until the process exits and is never written to the lockfile.
   * @returns once the pin is written and the server queued for a fresh review.
   */
  async settlePrompt(pending: PendingSurface, accepted: boolean): Promise<void> {
    const ref = refOf(pending.serverName, pending.reviewKey)
    const key = lockKey(ref.serverName, ref.reviewKey)
    this.prompting.delete(key)
    if (!accepted) return
    if (this.options.config.enrollOnApproval && pending.surface.state === 'unpinned') {
      try {
        await this.pin(ref, { approvedBy: 'prompt' })
        return
      } catch (error) {
        // The pin did not persist, so fall back to acceptance for this process and say why.
        this.options.logger.warn(`mcp-trust(${visible(ref.serverName)}${keyNote(ref.reviewKey)}): the approval could not be saved, so it applies to this process only: ${reason(error)}`)
      }
    }
    this.acceptedOnce.set(key, pending.surface.surfaceDigest)
    pending.resync()
  }

  /**
   * Latest observed surface of every reviewed server.
   * @returns the surfaces in first-review order.
   */
  surfaces(): readonly ObservedSurface[] {
    return [...this.observations.values()].map(observation => observation.surface)
  }

  observed(server: ServerRef): ObservedSurface | undefined {
    return this.observations.get(lockKey(server.serverName, server.reviewKey))?.surface
  }

  servers(): readonly ServerRef[] {
    return [...this.observations.values()].map(observation => refOf(observation.surface.serverName, observation.surface.reviewKey))
  }

  reviewFailure(server: ServerRef): string | undefined {
    return this.observations.get(lockKey(server.serverName, server.reviewKey))?.failure
  }

  describe(server: ServerRef): string {
    const observation = this.require(server)
    const label = `${visible(server.serverName)}${keyNote(server.reviewKey)}`
    if (this.lockProblem !== undefined) {
      return `server ${label}: quarantined\n  the lockfile ${this.options.config.lockfile} is unreadable: ${visible(this.lockProblem)}`
    }
    if (observation.failure !== undefined) {
      return `server ${label}: quarantined\n  its review failed: ${visible(observation.failure)}`
    }
    return renderSurfaceDiff(observation.surface, this.lock?.servers[lockKey(server.serverName, server.reviewKey)], observation.digests)
  }

  async pin(server: ServerRef, options: { tools?: readonly string[]; approvedBy: 'cli' | 'command' | 'prompt' }): Promise<void> {
    const { config } = this.options
    const { serverName, reviewKey } = server
    const key = lockKey(serverName, reviewKey)
    const observation = this.require(server)
    if (observation.failure !== undefined) {
      throw new Error(`mcp-trust: the review of server "${serverName}" failed, so it cannot be pinned: ${observation.failure}`)
    }
    if (observation.surface.surfaceDigest === '') {
      throw new Error(`mcp-trust: server "${serverName}" presented a surface that cannot be canonicalized, so it cannot be pinned`)
    }
    const selected = options.tools
    const unknown = (selected ?? []).filter(name => !observation.digests.has(name))
    if (unknown.length > 0) {
      throw new Error(`mcp-trust: server "${serverName}" does not list ${unknown.map(visible).join(', ')}`)
    }
    const fresh = buildEntry(
      observation.digests,
      observation.surface.instructions,
      config.policyOf(serverName).instructions === 'pin',
      options.approvedBy,
      this.options.now().toISOString(),
      reviewKey,
    )
    this.lock = await updateLockfile(config.lockfile, (doc) => {
      if (selected === undefined) {
        doc.servers[key] = fresh
        return
      }
      const previous = doc.servers[key]
      const picked = Object.entries(fresh.tools).filter(([name]) => selected.includes(name))
      const tools = Object.assign(Object.create(null) as Record<string, LockTool>, previous?.tools, Object.fromEntries(picked))
      doc.servers[key] = withTools(previous?.instructions, tools, reviewKey)
    }, config.lockWaitMs)
    observation.resync()
  }

  async revoke(server: ServerRef, options: { tools?: readonly string[] }): Promise<void> {
    const { config } = this.options
    const key = lockKey(server.serverName, server.reviewKey)
    const selected = options.tools
    this.lock = await updateLockfile(config.lockfile, (doc) => {
      const entry = doc.servers[key]
      if (entry === undefined) return
      // A whole-server revoke leaves an empty entry, so tofu mode cannot pin the server again.
      const kept = selected === undefined
        ? {}
        : Object.fromEntries(Object.entries(entry.tools).filter(([name]) => !selected.includes(name)))
      doc.servers[key] = withTools(selected === undefined ? undefined : entry.instructions, kept, server.reviewKey)
    }, config.lockWaitMs)
    this.observations.get(key)?.resync()
  }

  verify(server?: ServerRef): readonly ObservedSurface[] {
    if (server === undefined) return this.surfaces()
    const surface = this.observed(server)
    return surface === undefined ? [] : [surface]
  }

  async entries(): Promise<readonly LockEntrySummary[]> {
    const doc = await readLockfile(this.options.config.lockfile)
    return Object.entries(doc.servers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]): LockEntrySummary => {
        const { serverName, reviewKey } = parseLockKey(key)
        const times = Object.values(entry.tools).map(tool => tool.approvedAt).sort()
        return { serverName, ...reviewKey === undefined ? {} : { reviewKey }, tools: times.length, approvedAt: times.at(-1) ?? '' }
      })
  }

  /** Cancel every pending TTL re-verification and release every per-server record. */
  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.observations.clear()
    this.registered.clear()
    this.acceptedOnce.clear()
    this.prompts.clear()
    this.prompting.clear()
    this.lock = undefined
  }

  private require(server: ServerRef): Observation {
    const observation = this.observations.get(lockKey(server.serverName, server.reviewKey))
    if (observation === undefined) {
      throw new Error(`mcp-trust: server "${server.serverName}"${keyNote(server.reviewKey)} has no observed surface; check that it is configured and connected`)
    }
    return observation
  }

  private unregister(key: string): void {
    for (const [name, entry] of this.registered) {
      if (entry.key === key) this.registered.delete(name)
    }
  }

  private async reload(): Promise<void> {
    try {
      this.lock = await readLockfile(this.options.config.lockfile)
      this.lockProblem = undefined
    } catch (error) {
      this.lock = undefined
      this.lockProblem = reason(error)
      this.options.logger.error(`mcp-trust: lockfile unusable, every MCP server is blocked until it is repaired: ${this.lockProblem}`)
    }
  }

  /** The SDK never re-lists when a server TTL expires, so the engine schedules the re-sync. */
  private arm(key: string, request: McpToolReviewRequest): void {
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
    if (request.ttlMs === undefined || request.ttlMs <= 0) return
    const { minReverifyMs, maxReverifyMs } = this.options.config
    const timer = setTimeout(() => { request.resync() }, Math.min(Math.max(request.ttlMs, minReverifyMs), maxReverifyMs))
    timer.unref()
    this.timers.set(key, timer)
  }
}
