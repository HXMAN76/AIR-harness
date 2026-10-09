/**
 * Optional tool reviewer consulted by the tool bridge between the fetch and
 * swap phases of every synchronization. A composition that requires review
 * declares `mcpToolReview` in the `inject` of its mcp-client rows, so those
 * rows stay pending until a reviewer exists and restart when it is replaced.
 *
 * @module
 */

import type { Tool } from '@modelcontextprotocol/client'

/** One fetched tool, with the public name the bridge will register it under. */
export interface McpReviewedTool {
  /** Server-owned raw name. */
  readonly rawName: string
  /** `publicToolName(serverName, rawName)`: the ToolRuntime name a guard sees. */
  readonly publicName: string
  /** Definition exactly as `listTools` returned it. */
  readonly definition: Tool
}

/** One complete fetched generation offered for review before registration. */
export interface McpToolReviewRequest {
  /** Local namespace from configuration; never the server's self-reported name. */
  readonly serverName: string
  /** Every fetched tool; duplicate raw names were already rejected. */
  readonly tools: readonly McpReviewedTool[]
  /** Raw server instructions of the connection generation without attribution; empty when absent. */
  readonly instructions: string
  /** Page-1 `ttlMs` of the aggregated `tools/list` result, when the server sent a number. */
  readonly ttlMs?: number
  /** Queue a fresh fetch and review for the live generation; does nothing once that generation is gone. */
  resync(): void
}

/** The registration decision for one generation. */
export interface McpToolReviewVerdict {
  /** Tools to register; a changed `description` replaces the model-visible one, and `outputSchema` must stay as fetched. */
  readonly tools: readonly Tool[]
  /** Raw instructions to publish with this generation; an empty string withdraws the prompt section. */
  readonly instructions: string
}

/** Reviewer of fetched MCP tool generations. */
export interface McpToolReview {
  /**
   * Decide which fetched tools and instructions register.
   * @param request - the fetched generation and its re-sync handle.
   * @returns the verdict; a rejection registers zero tools and withdraws instructions.
   */
  review(request: McpToolReviewRequest): Promise<McpToolReviewVerdict>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional MCP tool reviewer; rows that must be reviewed declare it in `inject`. */
    mcpToolReview?: McpToolReview
  }
}
