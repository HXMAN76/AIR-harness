/**
 * Which model route receives memory text. Memory notes reach the model through the pinned core and
 * through search and read results; both consult the `shareWith` list of provider ids.
 * @module @air/dsh-memory-store/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** The part of an Agent that route resolution reads. */
export interface RouteAgent {
  options: { provider?: string | undefined }
  session: { requestHeader(): { config: { provider: string } } | undefined }
}

/**
 * Resolve the provider id that the agent's next request goes to: the route of its latest request,
 * else the route given at creation, else the configured default model. A model switch between two
 * steps is therefore seen one request late.
 * @param ctx - context that may hold the `agentDefaultModel` service.
 * @param agent - the calling agent, if any.
 * @returns the provider id, or `undefined` when no source names one.
 */
export function activeProvider(ctx: Context, agent: RouteAgent | undefined): string | undefined {
  if (agent === undefined) return undefined
  return agent.session.requestHeader()?.config.provider
    ?? agent.options.provider
    ?? ctx.get('agentDefaultModel')?.currentSelection().provider
}

/**
 * Whether a route may receive memory text.
 * @param shareWith - allowed provider ids; `*` allows every route.
 * @param provider - the resolved provider id, or `undefined` when unknown (never allowed unless `*`).
 * @returns true when the route is allowed.
 */
export function routeAllows(shareWith: readonly string[], provider: string | undefined): boolean {
  return shareWith.includes('*') || (provider !== undefined && shareWith.includes(provider))
}

/**
 * Words for a route in a message to the user or model.
 * @param provider - the resolved provider id, if any.
 * @returns `"<id>"`, or `current` when unknown.
 */
export function routeLabel(provider: string | undefined): string {
  return provider === undefined ? 'current' : `"${provider}"`
}
