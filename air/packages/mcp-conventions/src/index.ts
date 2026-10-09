/**
 * Imports Claude Code project `.mcp.json` files. For every Agent it reads `<project>/.mcp.json`,
 * and for each server a person approved it mounts one upstream `mcp-client` in that Agent's scope,
 * so the server's tools exist before the Agent's first request and disappear with the Agent.
 * Approvals are stored in an AIR-owned file, keyed by project and exact server definition.
 *
 * @module @air/dsh-mcp-conventions
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'
import { describeSkip, errorMessage, findProjectRoot, readContained } from '@air/dsh-convention-core'
import { ApprovalStore, approvalKey, type McpApprovalKey } from './approvals.ts'
import { parseMcpJson, redact, type ServerSpec } from './config.ts'

export const name = 'air-mcp-conventions'
export const inject = ['agents', 'tools', 'commands']

const USAGE = 'Usage: /mcp [approve <server> | revoke <server>]'

/** Service the MCP trust plan provides; an `mcp-client` child that must be reviewed waits for it. */
const REVIEW_SERVICE = 'mcpToolReview'

/** Value of upstream cordis `FiberState.ACTIVE`; the enum is `const` and cannot be imported. A test pins it to a real fiber. */
export const FIBER_ACTIVE = 2

/** Plugin configuration. */
export interface Config {
  /** Approvals file. Defaults to `<DSH_HOME>/air/mcp-approvals.json`. */
  approvalsFile?: string
  /** Milliseconds a server may take to connect and list its tools before it is abandoned. Defaults to 15000. */
  startupTimeoutMs?: number
  /** Milliseconds allowed per tool call or resource request. Defaults to 60000. */
  toolCallTimeoutMs?: number
  /** Largest `.mcp.json` in bytes. Defaults to 262144. */
  maxFileBytes?: number
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
  /**
   * Whether each mounted `mcp-client` child declares `inject: ['mcpToolReview']` and waits for the MCP trust plan's reviewer.
   * Defaults to false.
   */
  reviewTools?: boolean
}

export const Config: Schema<Config> = Schema.object({
  approvalsFile: Schema.string().description('Approvals file; defaults to <DSH_HOME>/air/mcp-approvals.json.'),
  startupTimeoutMs: Schema.number().default(15000).description('Milliseconds a server may take to start.'),
  toolCallTimeoutMs: Schema.number().default(60000).description('Milliseconds allowed per tool call.'),
  maxFileBytes: Schema.number().default(262144).description('Largest .mcp.json, in bytes.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
  reviewTools: Schema.boolean().default(false).description('Hold each server until the MCP tool reviewer service exists, so its tools are reviewed before they register.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly approvalsFile: string
  readonly startupTimeoutMs: number
  readonly toolCallTimeoutMs: number
  readonly maxFileBytes: number
  readonly projectRootMarkers: readonly string[]
  readonly reviewTools: boolean
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    approvalsFile: config.approvalsFile ?? dshHomePath('air', 'mcp-approvals.json'),
    startupTimeoutMs: config.startupTimeoutMs ?? 15000,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60000,
    maxFileBytes: config.maxFileBytes ?? 262144,
    projectRootMarkers: config.projectRootMarkers ?? ['.git'],
    reviewTools: config.reviewTools ?? false,
  }
  if (!Number.isInteger(resolved.startupTimeoutMs) || resolved.startupTimeoutMs < 1) {
    throw new TypeError('air-mcp-conventions: startupTimeoutMs must be a positive integer')
  }
  if (!Number.isInteger(resolved.toolCallTimeoutMs) || resolved.toolCallTimeoutMs < 1) {
    throw new TypeError('air-mcp-conventions: toolCallTimeoutMs must be a positive integer')
  }
  if (!Number.isInteger(resolved.maxFileBytes) || resolved.maxFileBytes < 1) {
    throw new TypeError('air-mcp-conventions: maxFileBytes must be a positive integer')
  }
  if (resolved.projectRootMarkers.length === 0) {
    throw new TypeError('air-mcp-conventions: projectRootMarkers must not be empty')
  }
  return resolved
}

/** One server's mount, registered under its name before the first await so concurrent callers join it. */
interface Mount {
  readonly scope: Scope
  status: 'starting' | 'running'
  /** Set by revoke or release; a mount that finishes starting afterwards disposes itself. */
  cancelled: boolean
  /** Settles with the failure text, or undefined once the server runs. Never rejects. */
  readonly done: Promise<string | undefined>
}

interface AgentState {
  readonly projectRoot: string
  readonly servers: readonly ServerSpec[]
  /** File problems and approvals-file problems, shown by `/mcp`. */
  readonly problems: string[]
  /** Starting and running servers by name; each scope owns one `mcp-client` child. */
  readonly mounted: Map<string, Mount>
}

/**
 * Mount project MCP servers per Agent and register `/mcp`.
 * @param ctx - host-level plugin context with `agents`, `tools`, and `commands` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const approvals = new ApprovalStore(resolved.approvalsFile)
  const states = new Map<Agent, AgentState>()
  // Agents whose release began. An attach or mount that resumes after an await checks this and discards what it built.
  const released = new WeakSet<Agent>()
  let closed = false
  const isGone = (agent: Agent): boolean => closed || released.has(agent)
  // Declaring the reviewer service in `inject` keeps the child pending until the service exists. The
  // object repeats the merge the Loader performs for a row-level `inject`.
  const client = resolved.reviewTools
    ? { name: 'mcp-client-reviewed', inject: [...McpClient.inject, REVIEW_SERVICE], apply: McpClient.apply }
    : McpClient

  /** An unreadable approvals file approves nothing and is shown by `/mcp`; it never fails Agent creation. */
  const isApproved = async (state: AgentState, spec: ServerSpec): Promise<boolean> => {
    try {
      return await approvals.has(approvalKey(state.projectRoot, spec))
    } catch (error: unknown) {
      const problem = `the approvals file could not be read: ${errorMessage(error)}`
      if (!state.problems.includes(problem)) state.problems.push(problem)
      return false
    }
  }

  /**
   * Start one server in the Agent's scope. The mount is registered before any await, so a second caller
   * for the same server joins it. Returns the failure text, or undefined on success.
   */
  const mount = (agent: Agent, state: AgentState, spec: ServerSpec): Promise<string | undefined> => {
    const existing = state.mounted.get(spec.serverName)
    if (existing !== undefined) return existing.done
    if (isGone(agent)) return Promise.resolve('the session ended before the server started')
    const scope = createScope(ctx, agent)
    const common = { toolCallTimeoutMs: resolved.toolCallTimeoutMs, failOnStartupError: true }
    const clientConfig = spec.transport === 'stdio'
      ? McpClient.Config({ transport: 'stdio', serverName: spec.serverName, command: spec.command, args: spec.args, env: spec.env, cwd: spec.cwd, ...common })
      : McpClient.Config({ transport: 'streamable-http', serverName: spec.serverName, url: spec.url, headers: spec.headers, ...common })
    const start = async (): Promise<void> => {
      const fiber = await scope.ctx.plugin(client, clientConfig)
      // A child that waits for the reviewer service resolves while still pending; it has mounted nothing.
      const fiberState: number = fiber.state
      if (fiberState !== FIBER_ACTIVE) {
        throw new Error(resolved.reviewTools
          ? 'the MCP tool reviewer service (mcpToolReview) is required and is not loaded; load the reviewer plugin or set reviewTools to false'
          : 'the server plugin did not become active')
      }
    }
    const run = async (): Promise<string | undefined> => {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          start(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { reject(new Error(`did not start within ${resolved.startupTimeoutMs} ms`)) }, resolved.startupTimeoutMs)
          }),
        ])
        if (record.cancelled || isGone(agent)) {
          record.cancelled = true
          await scope.dispose()
          return 'it was stopped before it finished starting'
        }
        record.status = 'running'
        return undefined
      } catch (error: unknown) {
        // Upstream messages can quote the spawned command line, so expanded values are scrubbed.
        const text = redact(errorMessage(error), spec.secrets)
        await scope.dispose()
        return text
      } finally {
        clearTimeout(timer)
        if (record.status !== 'running' && state.mounted.get(spec.serverName) === record) state.mounted.delete(spec.serverName)
      }
    }
    const record: Mount = { scope, status: 'starting', cancelled: false, done: run() }
    state.mounted.set(spec.serverName, record)
    return record.done
  }

  /** Stop one mount, starting or running, and wait until its scope is gone. */
  const stop = async (state: AgentState, name: string): Promise<void> => {
    const record = state.mounted.get(name)
    if (record === undefined) return
    record.cancelled = true
    state.mounted.delete(name)
    await Promise.all([record.scope.dispose(), record.done])
  }

  const release = async (agent: Agent): Promise<void> => {
    released.add(agent)
    const state = states.get(agent)
    if (state === undefined) return
    states.delete(agent)
    await Promise.all([...state.mounted.keys()].map(serverName => stop(state, serverName)))
  }

  /** Release an Agent from a listener, where a rejection would be unhandled. */
  const releaseLogged = (agent: Agent): Promise<void> => release(agent).catch((error: unknown) => {
    ctx.logger.warn(`air-mcp-conventions: stopping servers failed: ${errorMessage(error)}`)
  })

  const describeServers = async (state: AgentState): Promise<string> => {
    const lines: string[] = []
    for (const spec of state.servers) {
      // Only unexpanded text and variable names are shown; expanded values may be secrets.
      const names = spec.transport === 'stdio' ? Object.keys(spec.env) : Object.keys(spec.headers)
      const label = spec.transport === 'stdio' ? 'env' : 'headers'
      const details = [spec.display]
      if (names.length > 0) details.push(`${label}: ${names.join(', ')}`)
      if (spec.transport === 'stdio') details.push(`cwd: ${spec.cwd}`)
      let status = 'not approved'
      if (state.mounted.get(spec.serverName)?.status === 'running') status = 'running'
      else if (await isApproved(state, spec)) status = 'approved, not running'
      lines.push(`${spec.serverName} (${spec.transport}: ${details.join('; ')}): ${status}`)
    }
    if (lines.length === 0) lines.push(`No servers are declared in ${join(state.projectRoot, '.mcp.json')}.`)
    for (const problem of state.problems) lines.push(`Problem: ${problem}`)
    lines.push('Use /mcp approve <server> to start a server from this project, or /mcp revoke <server> to stop trusting it. Approve before your first message so the tools exist for the first request.')
    return lines.join('\n')
  }

  // Approve and revoke for one server run in the order they were issued, so the later command wins.
  const chains = new Map<McpApprovalKey, Promise<unknown>>()
  const ordered = <T>(key: McpApprovalKey, task: () => Promise<T>): Promise<T> => {
    const run = (chains.get(key) ?? Promise.resolve()).then(task)
    const tail = Promise.allSettled([run])
    chains.set(key, tail)
    void tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
    return run
  }

  const runCommand = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const state = states.get(invocation.agent)
    if (state === undefined) {
      return { kind: 'error', text: 'This session has no working directory, so no .mcp.json was read.' }
    }
    const parts = invocation.rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
    const action = parts[0]
    if (action === undefined) return { kind: 'success', text: await describeServers(state) }
    if ((action !== 'approve' && action !== 'revoke') || parts.length !== 2) return { kind: 'error', text: USAGE }
    const spec = state.servers.find(server => server.serverName === parts[1])
    if (spec === undefined) {
      return { kind: 'error', text: `No server named "${String(parts[1])}" is declared in ${join(state.projectRoot, '.mcp.json')}. ${USAGE}` }
    }
    const key = approvalKey(state.projectRoot, spec)
    if (action === 'revoke') {
      return ordered(key, async (): Promise<CommandResult> => {
        // Stop the server first so an unwritable approvals file cannot leave a revoked server running.
        await stop(state, spec.serverName)
        try {
          await approvals.remove(key)
        } catch (error: unknown) {
          return { kind: 'error', text: `Stopped "${spec.serverName}", but the approval could not be removed: ${errorMessage(error)}` }
        }
        return { kind: 'success', text: `Revoked "${spec.serverName}"; its tools are removed from this session.` }
      })
    }
    const record = { projectRoot: state.projectRoot, server: spec.serverName, approvedAt: new Date().toISOString() }
    // Only the approval write and the mount registration are ordered; waiting for the server to start is not,
    // so a later revoke does not queue behind a slow start and cancels it instead.
    const started = await ordered(key, async () => {
      await approvals.add(key, spec.transport === 'stdio' ? Object.assign({ cwd: spec.cwd }, record) : record)
      if (state.mounted.get(spec.serverName)?.status === 'running') return { running: true as const }
      return { running: false as const, failure: mount(invocation.agent, state, spec) }
    })
    if (started.running) return { kind: 'success', text: `"${spec.serverName}" is already running.` }
    const failure = await started.failure
    return failure === undefined
      ? { kind: 'success', text: `Approved and started "${spec.serverName}".` }
      : { kind: 'error', text: `Approved "${spec.serverName}", but it did not start: ${failure}` }
  }

  /** Read `.mcp.json` and start the approved servers. A failure is logged and never fails Agent creation. */
  const attach = async (agent: Agent, cwd: string): Promise<void> => {
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const file = join(projectRoot, '.mcp.json')
    if (isGone(agent)) return
    const read = await readContained(file, { roots: [projectRoot], maxBytes: resolved.maxFileBytes })
    if (isGone(agent)) return
    let parsed: ReturnType<typeof parseMcpJson> = { servers: [], problems: [] }
    if (read.kind === 'ok') parsed = parseMcpJson(read.text, { file, cwd, env: process.env })
    else if (read.kind !== 'absent') parsed = { servers: [], problems: [describeSkip(file, read.kind, resolved.maxFileBytes)] }
    const state: AgentState = { projectRoot, servers: parsed.servers, problems: parsed.problems, mounted: new Map() }
    states.set(agent, state)
    for (const problem of state.problems) ctx.logger.warn(`air-mcp-conventions: ${problem}`)
    let pending = 0
    // Servers start in parallel.
    await Promise.all(state.servers.map(async (spec) => {
      if (!await isApproved(state, spec)) {
        pending += 1
        return
      }
      const failure = await mount(agent, state, spec)
      if (failure !== undefined && !isGone(agent)) ctx.logger.warn(`air-mcp-conventions: server "${spec.serverName}" did not start: ${failure}`)
    }))
    if (pending > 0) ctx.logger.info(`air-mcp-conventions: ${pending} server(s) in ${join(projectRoot, '.mcp.json')} await approval; run /mcp in the session`)
  }

  ctx.on('agent/created', async ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    try {
      await attach(agent, cwd)
    } catch (error: unknown) {
      ctx.logger.warn(`air-mcp-conventions: ${errorMessage(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void releaseLogged(agent)
  })

  ctx.effect(() => async () => {
    closed = true
    await Promise.all([...states.keys()].map(agent => releaseLogged(agent)))
  }, 'air-mcp-conventions.servers')

  ctx.commands.register({
    name: 'mcp',
    description: 'List, approve, or revoke MCP servers declared in this project\'s .mcp.json',
    input: { hint: '[approve <server> | revoke <server>]' },
    handler: runCommand,
  })
}
