import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
