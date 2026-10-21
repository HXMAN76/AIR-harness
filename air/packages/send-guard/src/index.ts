/**
 * Send guard: refuses browser tool calls that would send a message (Send click, Ctrl/Cmd+Enter, typing with submit,
 * a script that sends) unless the latest user message carries a one-time token the voice controller issued after the
 * user said yes. It registers a tool guard, the same seam the MCP trust plugin uses for MCP tool calls, so the model
 * cannot talk its way past it: instructions are not the enforcement, this is.
 * @module @air/dsh-send-guard
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import { isSendAttempt, REFUSAL } from './guard.ts'
import { latestUserText, type SessionLike } from './session-text.ts'
import { consumeSendToken } from './token.ts'

export { isSendAttempt, REFUSAL } from './guard.ts'
export { latestUserText } from './session-text.ts'
export type { SessionLike } from './session-text.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'air-send-guard'

/** Tool registry. */
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /** Absolute directory of one-time send tokens (see `token.ts`). */
  tokenDir: string
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  tokenDir: z.string().required().description('Directory of one-time send tokens.'),
})

/** What the guard reads from a tool execution. */
export interface GuardExecution {
  readonly name: string
  readonly arguments: unknown
  readonly agent?: { readonly session: SessionLike } | undefined
}

/**
 * @param tokenDir - token directory.
 * @returns the guard: a refusal for a send attempt without a live token, else undefined.
 */
export function createGuard(tokenDir: string): (execution: GuardExecution) => string | undefined {
  return (execution) => {
    if (!isSendAttempt(execution.name, execution.arguments)) return undefined
    const session = execution.agent?.session
    const said = session === undefined ? undefined : latestUserText(session)
    return said !== undefined && consumeSendToken(tokenDir, said) ? undefined : REFUSAL
  }
}

/**
 * Register the guard.
 * @param ctx - plugin context with `tools`.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.guard(createGuard(config.tokenDir))
}
