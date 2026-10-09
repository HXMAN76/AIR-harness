/** Types shared by the trust engine, the plugin entry, and the command-line provider. @module */

import type { McpReviewedTool } from '@deepseek-ai/dsh-mcp-client'

/** MCP tool definition as the client SDK returns it. */
export type McpTool = McpReviewedTool['definition']

/** `off` reviews nothing, `tofu` pins the first surface it sees, `enforce` requires a pin. */
export type TrustMode = 'off' | 'tofu' | 'enforce'

/** Resolved trust policy for one server. */
export interface ServerPolicy {
  mode: TrustMode
  /** A tool absent from the lock entry. */
  onAdded: 'withhold' | 'reject-generation'
  /** A pinned tool or pinned instructions whose digest differs. */
  onChanged: 'reject-generation' | 'withhold'
  /** A pinned tool the server no longer lists. */
  onRemoved: 'accept' | 'reject-generation'
  /** `pin` compares instructions with the lock entry, `drop` never publishes them, `accept` publishes without comparison. */
  instructions: 'pin' | 'drop' | 'accept'
  /** When present, raw names outside this list never register. */
  allow?: readonly string[]
  /** Raw names that never register and never prompt. */
  deny: readonly string[]
  /** Model-visible description replacements by raw name; digests still cover the server's text. */
  override: Readonly<Record<string, { description: string }>>
}

/** Difference between a fetched surface and its lock entry. */
export interface SurfaceDiff {
  added: string[]
  removed: string[]
  changed: { tool: string; fields: string[] }[]
  instructionsChanged: boolean
  /** Why the surface could not be canonicalized. */
  invalid?: string
}

/** Trust state of a server's latest fetched surface. */
export type ServerTrustState = 'approved' | 'tofu' | 'accepted-once' | 'withheld' | 'quarantined' | 'unpinned'

/** What the review did with the generation. */
export type TrustAction = 'accept' | 'withhold' | 'reject-generation'

/** Identifies one server definition: its local name and, for project servers, the opaque identity of the exact definition. */
export interface ServerRef {
  /** Local server name. */
  serverName: string
  /** 64-hex approval key of the exact server definition; absent for profile-level servers. */
  reviewKey?: string
}

/** The latest surface a server presented, including tools that were not registered. */
export interface ObservedSurface {
  serverName: string
  /** Identity of the server definition, when it has one; pins are kept apart by it. */
  reviewKey?: string
  /** Empty when the surface could not be canonicalized. */
  surfaceDigest: string
  instructions: string
  tools: readonly McpTool[]
  diff: SurfaceDiff
  state: ServerTrustState
  action: TrustAction
  /** Raw names fetched but not registered because of the review. */
  withheld: readonly string[]
  /** `surfaceDigest` of the lock entry the review compared against. */
  pinnedDigest?: string
  /** Milliseconds since the epoch. */
  observedAt: number
}

/** Service `mcpTrust`: inspection and approval of observed surfaces. Servers are addressed by `ServerRef`. */
export interface McpTrust {
  /**
   * Latest observed surface of one server definition.
   * @param server - local server name and optional review key.
   * @returns the surface, or `undefined` when the server was never reviewed in this process.
   */
  observed(server: ServerRef): ObservedSurface | undefined
  /**
   * Every server definition reviewed in this process.
   * @returns the references in first-review order.
   */
  servers(): readonly ServerRef[]
  /**
   * Field-level difference between a server's observed surface and its pin, safe to print.
   * @param server - local server name and optional review key.
   * @returns the rendered text.
   * @throws when the server was never reviewed in this process.
   */
  describe(server: ServerRef): string
  /**
   * Approve the observed surface, or selected tools of it, in the lockfile and re-sync the server.
   * @param server - local server name and optional review key.
   * @param options - raw tool names to approve (default: the whole surface) and who approves.
   * @throws when the server is unobserved, its surface is not canonicalizable, or a named tool is not listed.
   */
  pin(server: ServerRef, options: { tools?: readonly string[]; approvedBy: 'cli' | 'command' | 'prompt' }): Promise<void>
  /**
   * Remove approvals from the lockfile and re-sync the server.
   * @param server - local server name and optional review key.
   * @param options - raw tool names to revoke (default: every tool and the instructions).
   */
  revoke(server: ServerRef, options: { tools?: readonly string[] }): Promise<void>
  /**
   * Observed surfaces for reporting; writes nothing.
   * @param server - one server definition, or every reviewed server when omitted.
   * @returns the surfaces; a named server that was never reviewed is omitted.
   */
  verify(server?: ServerRef): readonly ObservedSurface[]
}
