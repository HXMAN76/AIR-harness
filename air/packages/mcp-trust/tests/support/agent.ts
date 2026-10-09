/** Minimal `Agent` over a session, for tests that drive `agent/pre-step` without the agent loop. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'

/**
 * Wrap a session in an inert agent.
 * @param session - the session the agent owns.
 * @returns an agent whose control methods do nothing.
 */
export function sessionAgent(session: Session): Agent {
  return {
    id: SessionId('agent'),
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}
