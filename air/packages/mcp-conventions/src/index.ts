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
import { describeSkip, findProjectRoot, readContained } from '@air/dsh-convention-core'
import { ApprovalStore, approvalKey } from './approvals.ts'
import { parseMcpJson, type ServerSpec } from './config.ts'

export const name = 'air-mcp-conventions'
export const inject = ['agents', 'tools', 'commands']

const USAGE = 'Usage: /mcp [approve <server> | revoke <server>]'

/** Service the MCP trust plan provides; an `mcp-client` child that must be reviewed waits for it. */
const REVIEW_SERVICE = 'mcpToolReview'

/** Value of upstream cordis `FiberState.ACTIVE`; the enum is `const` and cannot be imported. */
const FIBER_ACTIVE = 2

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

interface AgentState {
  readonly projectRoot: string
  readonly servers: readonly ServerSpec[]
  /** File problems and approvals-file problems, shown by `/mcp`. */
  readonly problems: string[]
  /** Running servers by name; each scope owns one `mcp-client` child. */
  readonly mounted: Map<string, Scope>
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
      const problem = `the approvals file could not be read: ${(error as Error).message}`
      if (!state.problems.includes(problem)) state.problems.push(problem)
      return false
    }
  }

  /** Start one server in the Agent's scope. Returns the failure text, or undefined on success. */
  const mount = async (agent: Agent, state: AgentState, spec: ServerSpec): Promise<string | undefined> => {
    const scope = createScope(ctx, agent)
    const common = { toolCallTimeoutMs: resolved.toolCallTimeoutMs, failOnStartupError: true }
    const clientConfig = spec.transport === 'stdio'
      ? McpClient.Config({ transport: 'stdio', serverName: spec.serverName, command: spec.command, args: spec.args, env: spec.env, cwd: spec.cwd, ...common })
      : McpClient.Config({ transport: 'streamable-http', serverName: spec.serverName, url: spec.url, headers: spec.headers, ...common })
    const start = async (): Promise<void> => {
      const fiber = await scope.ctx.plugin(client, clientConfig)
      // A child that waits for the reviewer service resolves while still pending; it has mounted nothing,
      // so report it through the startup timeout instead of as a started server.
      const state: number = fiber.state
      if (state !== FIBER_ACTIVE) await new Promise<never>(() => {})
    }
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        start(),
        new Promise<never>((_resolve, reject) => {
          const reason = resolved.reviewTools ? '; the MCP tool reviewer is required and is not loaded' : ''
          timer = setTimeout(() => { reject(new Error(`did not start within ${resolved.startupTimeoutMs} ms${reason}`)) }, resolved.startupTimeoutMs)
        }),
      ])
      state.mounted.set(spec.serverName, scope)
      return undefined
    } catch (error: unknown) {
      await scope.dispose()
      return (error as Error).message
    } finally {
      clearTimeout(timer)
    }
  }

  const release = async (agent: Agent): Promise<void> => {
    const state = states.get(agent)
    if (state === undefined) return
    states.delete(agent)
    await Promise.all([...state.mounted.values()].map(scope => scope.dispose()))
  }

  const describeServers = async (state: AgentState): Promise<string> => {
    const lines: string[] = []
    for (const spec of state.servers) {
      const target = spec.transport === 'stdio' ? [spec.command, ...spec.args].join(' ') : spec.url
      let status = 'not approved'
      if (state.mounted.has(spec.serverName)) status = 'running'
      else if (await isApproved(state, spec)) status = 'approved, not running'
      lines.push(`${spec.serverName} (${spec.transport}: ${target}): ${status}`)
    }
    if (lines.length === 0) lines.push(`No servers are declared in ${join(state.projectRoot, '.mcp.json')}.`)
    for (const problem of state.problems) lines.push(`Problem: ${problem}`)
    lines.push('Use /mcp approve <server> to start a server from this project, or /mcp revoke <server> to stop trusting it. Approve before your first message so the tools exist for the first request.')
    return lines.join('\n')
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
      await approvals.remove(key)
      const scope = state.mounted.get(spec.serverName)
      state.mounted.delete(spec.serverName)
      await scope?.dispose()
      return { kind: 'success', text: `Revoked "${spec.serverName}"; its tools are removed from this session.` }
    }
    await approvals.add(key, { projectRoot: state.projectRoot, server: spec.serverName, approvedAt: new Date().toISOString() })
    if (state.mounted.has(spec.serverName)) return { kind: 'success', text: `"${spec.serverName}" is already running.` }
    const failure = await mount(invocation.agent, state, spec)
    return failure === undefined
      ? { kind: 'success', text: `Approved and started "${spec.serverName}".` }
      : { kind: 'error', text: `Approved "${spec.serverName}", but it did not start: ${failure}` }
  }

  /** Read `.mcp.json` and start the approved servers. A failure is logged and never fails Agent creation. */
  const attach = async (agent: Agent, cwd: string): Promise<void> => {
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const file = join(projectRoot, '.mcp.json')
    const read = await readContained(file, { roots: [projectRoot], maxBytes: resolved.maxFileBytes })
    let parsed: ReturnType<typeof parseMcpJson> = { servers: [], problems: [] }
    if (read.kind === 'ok') parsed = parseMcpJson(read.text, { cwd, env: process.env })
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
      if (failure !== undefined) ctx.logger.warn(`air-mcp-conventions: server "${spec.serverName}" did not start: ${failure}`)
    }))
    if (pending > 0) ctx.logger.info(`air-mcp-conventions: ${pending} server(s) in ${join(projectRoot, '.mcp.json')} await approval; run /mcp in the session`)
  }

  ctx.on('agent/created', async ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    try {
      await attach(agent, cwd)
    } catch (error: unknown) {
      ctx.logger.warn(`air-mcp-conventions: ${(error as Error).message}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void release(agent)
  })

  ctx.effect(() => async () => {
    await Promise.all([...states.keys()].map(agent => release(agent)))
  }, 'air-mcp-conventions.servers')

  ctx.commands.register({
    name: 'mcp',
    description: 'List, approve, or revoke MCP servers declared in this project\'s .mcp.json',
    input: { hint: '[approve <server> | revoke <server>]' },
    handler: runCommand,
  })
}
