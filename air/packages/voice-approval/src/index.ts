/**
 * Voice approval: the approval answerer for the voice profile. It is default-deny. A tool call that asks for a wider
 * sandbox (`sandbox_permissions`) is refused up front with "Needs voice approval: <summary>."; the voice app speaks the
 * summary, and only after the user says yes does it put a one-time `[AIR-APPROVE-<16 hex>]` token, bound by SHA-256 to
 * that exact tool call, in the next prompt. The guard lets exactly that call through and the answerer then allows the
 * one approval request it raises, deleting the token. Every other approval request is rejected; nothing is approved
 * automatically except calls to tools listed in `trustedToolPrefixes`.
 * @module @air/dsh-voice-approval
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { approvalDigest } from './digest.ts'
import { latestUserText, type SessionLike } from './session-text.ts'
import { escalationSummary, isEscalation } from './summary.ts'
import { consumeApprovalToken, findApprovalToken } from './token.ts'
import { DENIAL_PREFIX } from './denial.ts'

export { DENIAL_PREFIX, findApprovalDenial } from './denial.ts'
export { approvalDigest } from './digest.ts'
export { escalationSummary, isEscalation } from './summary.ts'
export { latestUserText } from './session-text.ts'
export type { SessionLike } from './session-text.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'air-voice-approval'

/** Tool registry. */
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /** Absolute directory of one-time approval tokens. */
  tokenDir: string
  /** Tools whose own approval requests are allowed without asking (the browser tools; the send guard protects Send). */
  trustedToolPrefixes: string[]
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  tokenDir: z.string().required().description('Directory of one-time approval tokens.'),
  trustedToolPrefixes: z.array(String).default([]).description('Tool name prefixes whose approval requests are allowed.'),
})

/** What the guard reads from a tool execution. */
export interface GuardExecution {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: { readonly session: SessionLike } | undefined
}

/** What the answerer reads from an approval request. */
export interface AnswerRequest {
  readonly callId?: string | undefined
  readonly toolName: string
}

/**
 * @param config - the plugin configuration.
 * @returns the tool guard and the approval answerer, which share the set of calls the guard let through.
 */
export function createVoiceApproval(config: Config): {
  guard(execution: GuardExecution): string | undefined
  answer(request: AnswerRequest): ApprovalOutcome
} {
  /** callId to the token that approved the call, from the guard to the answerer. */
  const pending = new Map<string, string>()
  return {
    guard(execution) {
      if (!isEscalation(execution.arguments)) return undefined
      const session = execution.agent?.session
      const said = session === undefined ? undefined : latestUserText(session)
      const digest = approvalDigest(execution.name, execution.arguments)
      const token = said === undefined ? undefined : findApprovalToken(config.tokenDir, said, digest)
      if (token === undefined) return `${DENIAL_PREFIX}${escalationSummary(execution.arguments)}.`
      pending.set(execution.callId, token)
      return undefined
    },
    answer(request) {
      if (config.trustedToolPrefixes.some(prefix => request.toolName.startsWith(prefix))) return 'allowed-once'
      const token = request.callId === undefined ? undefined : pending.get(request.callId)
      if (request.callId !== undefined) pending.delete(request.callId)
      return token !== undefined && consumeApprovalToken(config.tokenDir, token) ? 'allowed-once' : 'rejected'
    },
  }
}

/**
 * Register the guard and the answerer.
 * @param ctx - plugin context with `tools`.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const approval = createVoiceApproval(config)
  ctx.tools.guard(execution => approval.guard(execution))
  ctx.on('approval/request', request => Promise.resolve(approval.answer(request)))
}
