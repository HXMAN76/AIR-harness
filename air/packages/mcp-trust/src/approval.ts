/**
 * `agent/pre-step` listener: on the first step of a turn, offer withheld MCP
 * surfaces for one-shot approval and record which surfaces the turn runs
 * against. It never rejects a step and always delegates.
 *
 * Whether anyone can answer is not detected in advance. The approval service
 * reports `rejected` when the session's policy is `never` (the Full access
 * preset), `unavailable` when no answerer is composed or the answerer throws,
 * and `cancelled` when the turn's signal aborts; only `allowed-once` accepts
 * a surface, so every session that cannot ask keeps the server blocked.
 * @module
 */

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { Audit } from './audit.ts'
import { nextSteps, type PendingSurface, type TrustEngine } from './engine.ts'
import { clip, commandHint, renderDiffSummary, visible } from './render.ts'

/** The one approval operation this listener uses. */
export interface ApprovalAsker {
  /**
   * Put one question to the composed answerers.
   * @param req - the question; the turn must be open.
   * @returns the outcome; anything but `allowed-once` leaves the server withheld.
   */
  request(req: ApprovalRequest): Promise<ApprovalOutcome>
}

/** Collaborators of the pre-step listener. */
export interface PreStepDeps {
  engine: Pick<TrustEngine, 'takePromptable' | 'settlePrompt' | 'surfaces'>
  audit: Pick<Audit, 'recordTurn'>
  /**
   * Read the optional approval service.
   * @returns the service, or `undefined` when the composition has none.
   */
  approval(): ApprovalAsker | undefined
  logger: { warn(message: string): void }
  /** Command prefix of the `air-mcp` profile, named in the prompt. */
  cli: string
  /** Whether approving a server without a lock entry also pins it (the engine's `enrollOnApproval`). */
  enrolls: boolean
}

/** Longest tool-name list shown in a first-use prompt. */
const NAMES_SHOWN = 8
/** Longest tool name shown in full. */
const NAME_LIMIT = 100
/** Characters of a review key shown to tell two same-named servers apart. */
const KEY_PREFIX = 12

/**
 * Text of the approval prompt. It goes to the person, not the model; server-supplied
 * names pass through `visible` and `clip`, which make control and bidirectional
 * characters visible and bound the length.
 * @param pending - the surface being asked about.
 * @param cli - command prefix of the `air-mcp` profile.
 * @param enrolls - whether approving a server without a lock entry also saves the pin.
 * @returns the server (name and start of its key), what differs, what approving does, and the commands to read or save the approval.
 */
export function promptReason(pending: PendingSurface, cli: string, enrolls: boolean): string {
  const { surface, serverName, reviewKey } = pending
  const command = (action: 'pin' | 'diff'): string => `\`${commandHint(cli, action, serverName, reviewKey)}\``
  if (surface.state === 'unpinned') {
    const names = surface.tools.map(tool => clip(tool.name, NAME_LIMIT))
    const extra = names.length > NAMES_SHOWN ? `, and ${String(names.length - NAMES_SHOWN)} more` : ''
    const offered = `It offers ${String(names.length)} tool${names.length === 1 ? '' : 's'}: ${names.slice(0, NAMES_SHOWN).join(', ')}${extra}.`
    const effect = enrolls
      ? 'Approve to use it and remember the approval in the trust lockfile.'
      : reviewKey === undefined
        ? `Approve to use it until the process exits, or run ${command('pin')} to save the approval.`
        : 'Approve to use it until the process exits.'
    const key = reviewKey === undefined ? '' : ` (key ${visible(reviewKey.slice(0, KEY_PREFIX))})`
    return `MCP server "${clip(serverName, NAME_LIMIT)}"${key} has not been approved yet. ${offered} ${effect} `
      + (reviewKey === undefined
        ? `To read the definitions first, decline and run ${command('diff')}.`
        : `To read the definitions first and get the command that saves the approval, decline and run ${command('diff')}.`)
  }
  return `${renderDiffSummary(serverName, surface.diff, reviewKey)} The lockfile is not changed. ${nextSteps(cli, serverName, reviewKey)}`
}

/** Message of a caught value; the approval service and the engine only throw `Error` instances. */
function reason(error: unknown): string {
  /* v8 ignore next -- the calls above never throw a non-Error */
  return error instanceof Error ? error.message : String(error)
}

/** Ask for one surface; a failed request counts as not accepted. */
async function allowedOnce(
  approval: ApprovalAsker,
  request: ApprovalRequest,
  pending: PendingSurface,
  logger: PreStepDeps['logger'],
): Promise<boolean> {
  try {
    return await approval.request(request) === 'allowed-once'
  } catch (error) {
    logger.warn(`mcp-trust(${visible(pending.serverName)}): approval request failed: ${reason(error)}`)
    return false
  }
}

/**
 * Build the pre-step listener.
 * @param deps - engine, audit writer, approval accessor, and log sink.
 * @returns the waterfall listener; it resolves to whatever `next()` resolves to and calls `next()` on every path.
 */
export function createPreStep(deps: PreStepDeps) {
  const firstStep = async (payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> => {
    const approval = deps.approval()
    // Without an approval service nothing is claimed, so the prompt cap is not spent.
    if (approval !== undefined) {
      for (const pending of deps.engine.takePromptable()) {
        const accepted = await allowedOnce(approval, {
          agent: payload.agent,
          toolName: `mcp__${pending.serverName}__*`,
          reason: promptReason(pending, deps.cli, deps.enrolls),
          signal: payload.signal,
        }, pending, deps.logger)
        try {
          await deps.engine.settlePrompt(pending, accepted)
        } catch (error) {
          deps.logger.warn(`mcp-trust(${visible(pending.serverName)}): could not settle the approval: ${reason(error)}`)
        }
      }
    }
    await deps.audit.recordTurn(String(payload.agent.session.id), payload.turn, deps.engine.surfaces())
  }
  return async (
    payload: { agent: Agent; turn: number; step: number; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    if (payload.step === 1) {
      try {
        await firstStep(payload)
      } catch (error) {
        deps.logger.warn(`mcp-trust: pre-step review failed: ${reason(error)}`)
      }
    }
    return next()
  }
}
