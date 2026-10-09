/**
 * MCP tool-surface trust plugin. Provides `mcpToolReview` (consumed by
 * `dsh-mcp-client` rows that declare it in `inject`) and `mcpTrust`
 * (inspection and approval), registers the call-time digest guard, and
 * watches the lockfile so a revocation written by another process applies
 * to this one.
 *
 * Function plugin: named exports only.
 * @module @air/dsh-mcp-trust
 */

import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tools'
import { TrustEngine, type EngineConfig } from './engine.ts'
import { watchLockfile } from './lockfile.ts'
import type { McpTrust } from './types.ts'
import { resolvePolicy } from './verdict.ts'

export type {
  McpTrust, ObservedSurface, ServerPolicy, ServerRef, ServerTrustState, SurfaceDiff, TrustAction, TrustMode,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** MCP trust inspection and approval; provided by `@air/dsh-mcp-trust`. */
    mcpTrust?: McpTrust
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'air-mcp-trust'

/** Services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration; no field has a hidden default except `servers`. */
export interface Config {
  /** Absolute path of the lockfile shared by every profile that must see the same pins. */
  lockfile: string
  /** Absolute directory for the JSONL audit files. */
  auditDir: string
  /** Policy for every server: `mode`, `onAdded`, `onChanged`, `onRemoved`, `instructions`, and optional `allow`, `deny`, `override`. */
  defaults: Record<string, unknown>
  /** Per-server policy overrides keyed by the local `serverName`. */
  servers: Record<string, Record<string, unknown>>
  /** Deny calls to `mcp__` tools that no review registered. */
  denyUnreviewedMcpTools: boolean
  /** Approval prompts per server for the life of the process. */
  maxPromptsPerServer: number
  /** Lower bound of the TTL re-verification delay, in milliseconds. */
  minReverifyMs: number
  /** Upper bound of the TTL re-verification delay, in milliseconds. */
  maxReverifyMs: number
  /** Longest wait for the lockfile writer lock, in milliseconds. */
  lockWaitMs: number
  /** Quiet time after a lockfile change before it is re-read, in milliseconds. */
  watchDebounceMs: number
  /** Command prefix of the `air-mcp` profile, named in every prompt and denial, for example `pnpm dsh --profile air-mcp`. */
  cliCommand: string
  /** Approving a server that has no lock entry also writes its pin; a changed surface is never pinned by a prompt. */
  enrollOnApproval: boolean
}

export const Config: z<Config> = z.object({
  lockfile: z.string().required().description('Absolute path of the MCP trust lockfile.'),
  auditDir: z.string().required().description('Absolute directory for JSONL audit files.'),
  defaults: z.any().required().description('Trust policy applied to every server.'),
  servers: z.dict(z.any()).default({}).description('Per-server trust policy overrides by serverName.'),
  denyUnreviewedMcpTools: z.boolean().required().description('Deny calls to mcp__ tools that no review registered.'),
  maxPromptsPerServer: z.number().required().description('Approval prompts per server per process.'),
  minReverifyMs: z.number().required().description('Lower bound of the TTL re-verification delay.'),
  maxReverifyMs: z.number().required().description('Upper bound of the TTL re-verification delay.'),
  lockWaitMs: z.number().required().description('Longest wait for the lockfile writer lock.'),
  watchDebounceMs: z.number().required().description('Quiet time after a lockfile change before it is re-read.'),
  cliCommand: z.string().required().description('Command prefix of the air-mcp profile, named in every prompt and denial.'),
  enrollOnApproval: z.boolean().required().description('Pin a server that has no lock entry when the person approves it.'),
})

/** Validated configuration with every server policy resolved. */
export interface ResolvedConfig extends EngineConfig {
  auditDir: string
  watchDebounceMs: number
}

/**
 * Validate the configuration and resolve every policy. This is the one place
 * defaults are merged; nothing later falls back to an implicit value.
 * @param config - Schemastery-normalized plugin configuration.
 * @returns the resolved configuration.
 * @throws naming the first invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!isAbsolute(config.lockfile)) throw new Error('mcp-trust: lockfile must be an absolute path')
  if (!isAbsolute(config.auditDir)) throw new Error('mcp-trust: auditDir must be an absolute path')
  if (!Number.isInteger(config.maxPromptsPerServer) || config.maxPromptsPerServer < 0) {
    throw new Error('mcp-trust: maxPromptsPerServer must be a non-negative integer')
  }
  if (!(config.minReverifyMs > 0)) throw new Error('mcp-trust: minReverifyMs must be a positive number')
  if (!(config.maxReverifyMs >= config.minReverifyMs)) throw new Error('mcp-trust: maxReverifyMs must be at least minReverifyMs')
  if (!(config.lockWaitMs > 0)) throw new Error('mcp-trust: lockWaitMs must be a positive number')
  if (!(config.watchDebounceMs >= 0)) throw new Error('mcp-trust: watchDebounceMs must not be negative')
  if (config.cliCommand.trim() === '') throw new Error('mcp-trust: cliCommand must name the air-mcp command, for example "pnpm dsh --profile air-mcp"')
  const defaults = resolvePolicy(config.defaults, undefined, 'mcp-trust: defaults')
  const servers = new Map(Object.entries(config.servers).map(([serverName, override]) =>
    [serverName, resolvePolicy(config.defaults, override, `mcp-trust: servers.${serverName}`)] as const))
  return {
    lockfile: config.lockfile,
    auditDir: config.auditDir,
    denyUnreviewedMcpTools: config.denyUnreviewedMcpTools,
    maxPromptsPerServer: config.maxPromptsPerServer,
    minReverifyMs: config.minReverifyMs,
    maxReverifyMs: config.maxReverifyMs,
    lockWaitMs: config.lockWaitMs,
    watchDebounceMs: config.watchDebounceMs,
    cliCommand: config.cliCommand,
    enrollOnApproval: config.enrollOnApproval,
    policyOf: serverName => servers.get(serverName) ?? defaults,
  }
}

/**
 * Provide the reviewer and trust services and register the call-time guard.
 * @param ctx - plugin context with the `tools` service injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  // The directory watch and the writer lock both need the lockfile's directory.
  mkdirSync(dirname(resolved.lockfile), { recursive: true, mode: 0o700 })
  const engine = new TrustEngine({
    config: resolved,
    logger: {
      warn: (message) => { ctx.logger.warn(message) },
      error: (message) => { ctx.logger.error(message) },
    },
    now: () => new Date(),
    drift: () => {},
  })
  ctx.effect(() => () => { engine.dispose() }, 'air-mcp-trust.state')
  ctx.effect(() => watchLockfile(
    resolved.lockfile,
    () => { void engine.lockChanged() },
    resolved.watchDebounceMs,
    engine.watchFailed,
  ), 'air-mcp-trust.watch')
  ctx.tools.guard(execution => engine.guard(execution.name))
  ctx.provide('mcpToolReview', engine)
  ctx.provide('mcpTrust', engine)
}
