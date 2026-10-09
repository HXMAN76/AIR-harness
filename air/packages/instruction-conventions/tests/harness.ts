import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-working-directory'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0
const current = new WeakMap<Agent, string>()

/** Directory the stub service reports for an Agent that has no override and whose session has no directory. */
export const NO_PROJECT = '/air-test-no-such-project'

/**
 * Provide a `workingDirectory` stand-in: an Agent's override from `stubAgent`, else the session header directory.
 * @param ctx - context that receives the service.
 */
export function provideWorkingDirectory(ctx: Context): void {
  const get = (agent: Agent): string => current.get(agent) ?? agent.session.header.cwd ?? NO_PROJECT
  ctx.provide('workingDirectory', {
    defaultDirectory: NO_PROJECT,
    get: (session: Session): string => session.header.cwd ?? NO_PROJECT,
    ensure: (agent: Agent): Promise<string> => Promise.resolve(get(agent)),
  })
}

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - original session directory; undefined creates a session without one.
 * @param now - directory the working-directory stand-in reports instead of `cwd`.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined, now?: string): StubAgent {
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
  if (now !== undefined) current.set(agent, now)
  return { agent, followups }
}
