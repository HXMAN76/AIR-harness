/** Controller wiring of the Gmail assistant: routing before the agent, fallbacks, the spoken-yes window. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { VoiceController, CONFIRM_WINDOW_MS } from '../src/core/controller.ts'
import type { Route } from '../src/core/commands.ts'
import { NOT_CONNECTED, SETUP_HINT, type MailModel, type MailReply } from '../src/core/gmail/assistant.ts'
import { parseMailIntent, type MailIntent } from '../src/core/gmail/intent.ts'

class FakeListener extends EventEmitter {
  windows: Array<number | undefined> = []
  setLanguage(): void { /* unused */ }
  listen(seconds?: number): void { this.windows.push(seconds) }
}

class FakeSpeaker {
  spoken: string[] = []
  speaking = false
  async speak(text: string): Promise<void> { this.spoken.push(text) }
  stop(): void { /* unused */ }
  beep(): void { /* unused */ }
}

class FakeAgent {
  route: Route = 'local'
  memoryShared = false
  asks: string[] = []
  setRoute(route: Route): { ok: true } { this.route = route; return { ok: true } }
  async ask(text: string): Promise<{ reply: string; tools: string[] }> { this.asks.push(text); return { reply: 'model reply', tools: [] } }
  newConversation(): void { /* unused */ }
  async setMemoryShare(): Promise<void> { /* unused */ }
  async cancel(): Promise<void> { /* unused */ }
}

/** A scripted assistant: replies come from the queue; `pending` is whatever the script says. */
class FakeMail {
  isConfigured = true
  pending = false
  handled: string[] = []
  models: MailModel[] = []
  replies: Array<MailReply & { pendingAfter?: boolean; ask?: string }> = []
  cancelled = 0
  configured(): boolean { return this.isConfigured }
  match(text: string): MailIntent | null { return parseMailIntent(text, { hasList: false, hasOpen: false }) }
  cancelPending(): void { this.pending = false; this.cancelled++ }
  async handle(text: string, model: MailModel, say: (line: string) => Promise<void>): Promise<MailReply> {
    this.handled.push(text)
    this.models.push(model)
    const reply = this.replies.shift() ?? { spoken: 'ok', followUp: false }
    if (reply.ask !== undefined) {
      await say('saying first')
      await model.ask(reply.ask)
    }
    this.pending = reply.pendingAfter ?? false
    return reply
  }
}

function make(followUpMs = 0) {
  const listener = new FakeListener()
  const speaker = new FakeSpeaker()
  const agent = new FakeAgent()
  const mail = new FakeMail()
  const states: Array<{ phase: string; reply?: string; tools?: string[] }> = []
  const controller = new VoiceController({ listener, speaker, agent, mail, followUpMs, onState: (state) => { states.push(state) } })
  return { controller, listener, speaker, agent, mail, states }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('mail by API', () => {
  it('answers a mail request itself: no agent turn, spoken and shown, then a follow-up window', async () => {
    const { controller, speaker, agent, mail, listener, states } = make(8_000)
    mail.replies.push({ spoken: 'You have 2 unread mails.', screen: '1. a\n2. b', followUp: true })
    await controller.handleSpoken({ text: 'read my important mails' })
    expect(agent.asks).toEqual([])
    expect(speaker.spoken).toEqual(['You have 2 unread mails.'])
    expect(states.find(state => state.tools?.includes('gmail'))?.reply).toBe('1. a\n2. b')
    expect(listener.windows).toEqual([8])
    expect(mail.models[0]?.route).toBe('local')
  })

  it('does not open a window for a reply that wants none, and skips mail for Tamil and other text', async () => {
    const { controller, speaker, agent, mail, listener } = make(8_000)
    mail.replies.push({ spoken: 'Gmail is connected.', followUp: false })
    await controller.handleSpoken({ text: 'connect gmail' })
    expect(listener.windows).toEqual([])
    await controller.handleSpoken({ text: 'read my mail', lang: 'ta' })
    expect(mail.handled).toEqual(['connect gmail'])
    expect(agent.asks).toHaveLength(1)
    await controller.handleSpoken({ text: 'what is two plus two' })
    expect(mail.handled).toHaveLength(1)
    expect(speaker.spoken[0]).toBe('Gmail is connected.')
  })

  it('lets the assistant ask the active route (rewrite, summary) and speak a line first', async () => {
    const { controller, speaker, agent, mail } = make()
    mail.replies.push({ spoken: 'done', followUp: false, ask: 'rewrite this' })
    await controller.handleSpoken({ text: 'send a mail to asha saying hi' })
    expect(agent.asks).toEqual(['rewrite this'])
    expect(speaker.spoken).toEqual(['saying first', 'done'])
  })

  it('without the credentials file: reading says so and uses the browser tools; sending keeps the browser flow', async () => {
    const { controller, speaker, agent, mail } = make()
    mail.isConfigured = false
    await controller.handleSpoken({ text: 'read my important mails' })
    expect(speaker.spoken[0]).toBe(NOT_CONNECTED)
    expect(agent.asks[0]).toContain('https://mail.google.com')
    expect(agent.route).toBe('cloud')
    agent.asks.length = 0
    await controller.handleSpoken({ text: 'send a mail to asha saying hi' })
    expect(mail.handled).toEqual([])
    expect(agent.asks[0]).toContain('do NOT press Send')
  })

  it('without the credentials file, connecting explains the setup', async () => {
    const { controller, speaker, agent, mail } = make()
    mail.isConfigured = false
    await controller.handleSpoken({ text: 'connect gmail' })
    expect(speaker.spoken).toEqual([SETUP_HINT])
    expect(agent.asks).toEqual([])
  })

  it('leaves non-mail text, and a controller without a mail assistant, alone', async () => {
    const { controller, agent } = make()
    await controller.handleSpoken({ text: 'tell me a joke' })
    expect(agent.asks).toHaveLength(1)
    const bareAgent = new FakeAgent()
    const bare = new VoiceController({
      listener: new FakeListener(),
      speaker: new FakeSpeaker(),
      agent: bareAgent,
      onState: () => undefined,
    })
    await bare.handleSpoken({ text: 'read my mail' })
    expect(bareAgent.asks).toHaveLength(1)
  })

  it('keeps a question open for a short window; the answer goes back to the assistant', async () => {
    const { controller, listener, mail, speaker } = make()
    mail.replies.push({ spoken: 'To Asha: hi. Say yes to send.', followUp: true, pendingAfter: true })
    await controller.handleSpoken({ text: 'send a mail to asha saying hi' })
    expect(listener.windows).toEqual([CONFIRM_WINDOW_MS / 1000])
    mail.replies.push({ spoken: 'Sent to Asha.', followUp: false })
    await controller.handleSpoken({ text: 'yes' })
    expect(mail.handled).toEqual(['send a mail to asha saying hi', 'yes'])
    expect(speaker.spoken.at(-1)).toBe('Sent to Asha.')
    // The window timer was cleared by the answer: nothing more is spoken later.
    await vi.advanceTimersByTimeAsync(CONFIRM_WINDOW_MS + 100)
    expect(speaker.spoken.at(-1)).toBe('Sent to Asha.')
    expect(mail.cancelled).toBe(0)
  })

  it('cancels the question when the window passes in silence (timer, or the listener timeout)', async () => {
    const first = make()
    first.mail.replies.push({ spoken: 'Say yes to send.', followUp: true, pendingAfter: true })
    await first.controller.handleSpoken({ text: 'send a mail to asha saying hi' })
    await vi.advanceTimersByTimeAsync(CONFIRM_WINDOW_MS + 100)
    expect(first.mail.cancelled).toBe(1)
    expect(first.speaker.spoken.at(-1)).toBe('Cancelled.')

    const second = make()
    second.mail.replies.push({ spoken: 'Say yes to send.', followUp: true, pendingAfter: true })
    await second.controller.handleSpoken({ text: 'send a mail to asha saying hi' })
    second.listener.emit('timeout')
    await vi.advanceTimersByTimeAsync(0)
    expect(second.mail.cancelled).toBe(1)
    expect(second.speaker.spoken.at(-1)).toBe('Cancelled.')
    await vi.advanceTimersByTimeAsync(CONFIRM_WINDOW_MS + 100)
    expect(second.mail.cancelled).toBe(1)
  })

  it('does not open a window when a wake cut the reply off', async () => {
    const { controller, listener, mail, speaker } = make(8_000)
    mail.replies.push({ spoken: 'Long list.', followUp: true, pendingAfter: true })
    speaker.speak = async (text: string): Promise<void> => {
      speaker.spoken.push(text)
      listener.emit('wake')
    }
    await controller.handleSpoken({ text: 'read my mail' })
    expect(listener.windows).toEqual([])
    expect(mail.cancelled).toBe(0)
  })
})
