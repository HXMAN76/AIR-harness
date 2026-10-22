/** Latency spans, counters and live progress of the voice controller, with a hand-driven clock. */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type VoiceState } from '../src/core/controller.ts'
import { MetricsRecorder, type MetricsRecord } from '../src/core/metrics.ts'
import type { AgentProgress } from '../src/core/progress.ts'
import type { Route } from '../src/core/commands.ts'

interface Clock { t: number }

class Listener extends EventEmitter {
  setLanguage(): void { /* unused */ }
  listen(): void { /* unused */ }
  mute(): void { /* unused */ }
}

class Speaker {
  speaking = false
  lastTiming: { startedAt: number; firstAudioAt?: number } | undefined
  stops = 0
  /** Milliseconds from the start of a speech to its first audio; undefined: no audio is ever produced. */
  firstAudioAfter: number | undefined = 40
  constructor(private readonly clock: Clock) {}
  speak(): Promise<void> {
    const timing: { startedAt: number; firstAudioAt?: number } = { startedAt: this.clock.t }
    if (this.firstAudioAfter !== undefined) timing.firstAudioAt = this.clock.t + this.firstAudioAfter
    this.lastTiming = timing
    this.clock.t += 100
    return Promise.resolve()
  }
  beep(): void { this.clock.t += 3 }
  stop(): void { this.stops++; this.clock.t += 2 }
}

interface Reply {
  reply: string
  tools: string[]
  approval?: { summary: string; digest: string }
  stats?: { firstEventMs?: number; promptTokens: number; outputTokens: number; steps: number }
}

class Agent {
  route: Route = 'local'
  memoryShared = false
  sessionId: string | undefined
  progress: AgentProgress[] = [{ kind: 'thinking' }]
  reply: Reply = { reply: 'It is noon.', tools: ['pwsh', 'open'], stats: { firstEventMs: 30, promptTokens: 900, outputTokens: 40, steps: 2 } }
  failWith: Error | undefined
  keyMissing = false
  onAsk: (() => Promise<void>) | undefined
  constructor(private readonly clock: Clock) {}
  setRoute(route: Route): { ok: true } | { ok: false; reason: 'missing-key' } {
    if (route !== 'local' && this.keyMissing) return { ok: false, reason: 'missing-key' }
    this.route = route
    return { ok: true }
  }
  async ask(_text: string, onProgress?: (progress: AgentProgress) => void): Promise<Reply> {
    this.clock.t += 5
    for (const progress of this.progress) onProgress?.(progress)
    await this.onAsk?.()
    this.clock.t += 700
    if (this.failWith !== undefined) throw this.failWith
    return this.reply
  }
  newConversation(): void { /* unused */ }
  async setMemoryShare(): Promise<void> { /* unused */ }
  async cancel(): Promise<void> { /* unused */ }
}

function rig(options: { runOperator?: () => Promise<{ spoken: string }> } = {}) {
  const clock: Clock = { t: 1000 }
  const listener = new Listener()
  const speaker = new Speaker(clock)
  const agent = new Agent(clock)
  const records: MetricsRecord[] = []
  const states: VoiceState[] = []
  const controller = new VoiceController({
    listener,
    speaker,
    agent,
    metrics: new MetricsRecorder({ now: () => clock.t, wall: () => new Date('2026-10-22T10:00:00.000Z'), sink: record => records.push(record) }),
    runOperator: options.runOperator ?? (() => { clock.t += 20; return Promise.resolve({ spoken: 'Opening Notepad.' }) }),
    onState: state => states.push(state),
  })
  return { clock, listener, speaker, agent, records, states, controller }
}

const heard = (text: string, receivedAt = 1000) => ({ text, decodeMs: 80, audioMs: 1500, receivedAt })

describe('turn metrics', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('records an operator turn: stt, cue, operator, tts and end-to-end spans, with labels and no text', async () => {
    const { controller, listener, records } = rig()
    listener.emit('wake')
    await controller.handleSpoken(heard('open notepad'))
    expect(records).toHaveLength(1)
    // Speech ended at 920 (decoded at 1000 after an 80 ms decode); the cue went out at 1000 and took 3 ms.
    const record = records[0]!
    expect(record).toMatchObject({
      kind: 'turn',
      spans: { stt: 80, wake_to_ack: 3, speech_end_to_ack: 83, operator: 23, tts_first_audio: 40, e2e: 143 },
      counters: { audio_ms: 1500 },
      labels: { path: 'operator', route: 'local', outcome: 'ok' },
    })
    expect(JSON.stringify(record)).not.toContain('notepad')
  })

  it('labels news turns and records an operator failure', async () => {
    const news = rig()
    await news.controller.handleSpoken(heard('read the news'))
    expect(news.records[0]!.labels).toMatchObject({ path: 'news', outcome: 'ok' })
    const failing = rig({ runOperator: () => Promise.reject(new Error('boom')) })
    await failing.controller.handleSpoken(heard('open notepad'))
    expect(failing.records[0]!.labels).toMatchObject({ path: 'operator', outcome: 'error' })
    expect(failing.records[0]!.spans['e2e']).toBeUndefined()
  })

  it('records an agent turn with first event, turn time, tokens and tool calls', async () => {
    const { controller, records, agent } = rig()
    agent.sessionId = 'session-1'
    await controller.handleSpoken(heard('what is the time in Tokyo'))
    expect(records[0]).toMatchObject({
      spans: { stt: 80, agent_first_event: 30, agent_turn: 705, tts_first_audio: 40, e2e: 825 },
      counters: { prompt_tokens: 900, output_tokens: 40, model_calls: 2, tool_calls: 2 },
      labels: { path: 'agent', route: 'local', outcome: 'ok' },
    })
  })

  it('works without usage stats, without a decode time, and without a wake', async () => {
    const { controller, records, agent } = rig()
    agent.reply = { reply: 'Done.', tools: [] }
    await controller.handleSpoken({ text: 'what is the time in Tokyo' })
    const record = records[0]!
    expect(record.spans['stt']).toBeUndefined()
    expect(record.spans['agent_first_event']).toBeUndefined()
    expect(record.spans['wake_to_ack']).toBeUndefined()
    expect(record.counters).toEqual({ prompt_tokens: 0, output_tokens: 0, model_calls: 0, tool_calls: 0 })
    // Without a report from the listener the command counts as decoded now, and the clock is the controller's.
    expect(record.spans['e2e']).toBe(745)
  })

  it('reads the clock itself when the listener gave no receive time', async () => {
    const { controller, records } = rig()
    await controller.handleSpoken({ text: 'open notepad', decodeMs: 50 })
    expect(records[0]!.spans).toMatchObject({ stt: 50, operator: 20 })
    expect(records[0]!.counters['audio_ms']).toBeUndefined()
  })

  it('records the mail path, and a gated draft and an approval request as their own outcomes', async () => {
    const mail = rig()
    mail.agent.keyMissing = false
    await mail.controller.handleSpoken(heard('read my important mail'))
    expect(mail.records[0]!.labels).toMatchObject({ path: 'mail', route: 'cloud', outcome: 'ok' })

    const gated = rig()
    gated.agent.reply = { reply: 'Draft to Asha.\nCONFIRM SEND', tools: [] }
    await gated.controller.handleSpoken(heard('send an email to Asha'))
    expect(gated.records[0]!.labels['outcome']).toBe('confirm')

    const approval = rig()
    approval.agent.reply = { reply: 'I need approval.', tools: ['pwsh'], approval: { summary: 'run a command', digest: 'd' } }
    await approval.controller.handleSpoken(heard('clean up the downloads'))
    expect(approval.records[0]!.labels['outcome']).toBe('approval')
  })

  it('records an agent error and a missing cloud key', async () => {
    const failing = rig()
    failing.agent.failWith = new Error('model unavailable')
    await failing.controller.handleSpoken(heard('what is the time in Tokyo'))
    expect(failing.records[0]!.labels).toMatchObject({ path: 'agent', outcome: 'error' })

    const noKey = rig()
    noKey.agent.keyMissing = true
    await noKey.controller.handleSpoken(heard('read my important mail'))
    expect(noKey.records[0]!.labels).toMatchObject({ path: 'mail', outcome: 'no_key' })

    const screen = rig()
    screen.agent.keyMissing = true
    await screen.controller.handleSpoken(heard('click the button'))
    expect(screen.records[0]!.labels).toMatchObject({ outcome: 'no_key' })
  })

  it('leaves out the audio spans when nothing reached the player', async () => {
    const { controller, records, speaker } = rig()
    speaker.firstAudioAfter = undefined
    await controller.handleSpoken(heard('open notepad'))
    expect(records[0]!.spans['e2e']).toBeUndefined()
    expect(records[0]!.labels['outcome']).toBe('ok')
  })

  it('ignores audio timing that belongs to an earlier speech', async () => {
    const { controller, records, speaker } = rig()
    speaker.speak = () => {
      speaker.lastTiming = { startedAt: 1, firstAudioAt: 2 }
      return Promise.resolve()
    }
    await controller.handleSpoken(heard('open notepad'))
    expect(records[0]!.spans['e2e']).toBeUndefined()
  })

  it('drops a stale wake: a timeout clears it, and a follow-up needs none', async () => {
    const { controller, listener, records } = rig()
    listener.emit('wake')
    listener.emit('timeout')
    await controller.handleSpoken(heard('open notepad'))
    expect(records[0]!.spans['wake_to_ack']).toBeUndefined()
  })

  it('does not attach a greeting wake to the next turn', async () => {
    const { controller, listener, records, clock } = rig()
    listener.emit('wake', true)
    await vi.advanceTimersByTimeAsync(0)
    clock.t += 10
    await controller.handleSpoken(heard('open notepad'))
    expect(records[0]!.spans['wake_to_ack']).toBeUndefined()
  })

  it('records a barge-in: the wake to the speaker stopping', async () => {
    const { controller, listener, records, speaker } = rig()
    let release: (() => void) | undefined
    speaker.speak = () => new Promise<void>((resolve) => { release = resolve })
    const turn = controller.handleSpoken(heard('open notepad'))
    await vi.advanceTimersByTimeAsync(0)
    listener.emit('wake')
    release?.()
    await turn
    const barge = records.find(record => record.kind === 'barge_in')!
    expect(barge.spans['barge_in']).toBe(5)
    expect(barge.labels).toEqual({ route: 'local' })
  })
})

describe('live progress', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows Thinking, then a label per tool, then elapsed seconds, and clears when the turn ends', async () => {
    const { controller, agent, states } = rig()
    // Use the fake-timer clock so elapsed time follows advanceTimers.
    const origin = Date.now()
    const slow = new MetricsRecorder({ now: () => Date.now() - origin })
    const fresh = new VoiceController({ listener: new Listener(), speaker: new Speaker({ t: 0 }), agent, metrics: slow, onState: state => states.push(state) })
    void controller
    agent.progress = [{ kind: 'thinking' }, { kind: 'tool', name: 'open', args: { kind: 'app', value: 'notepad' } }]
    let release: (() => void) | undefined
    agent.onAsk = () => new Promise<void>((resolve) => { release = resolve })
    const turn = fresh.handleSpoken({ text: 'what is the time in Tokyo' })
    await vi.advanceTimersByTimeAsync(0)
    const progress = (): (string | undefined)[] => states.filter(state => state.phase === 'thinking').map(state => state.progress)
    expect(progress()).toEqual([undefined, 'Thinking…', 'Opening Notepad…'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(progress().at(-1)).toBe('Opening Notepad… 3 s')
    await vi.advanceTimersByTimeAsync(9000)
    expect(progress().at(-1)).toBe('Opening Notepad… 12 s')
    release?.()
    await turn
    const count = states.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(states).toHaveLength(count)
    expect(states.at(-1)!.progress).toBeUndefined()
  })

  it('does not report progress once the turn is no longer thinking, and adds the session id when there is one', async () => {
    const { controller, agent, states } = rig()
    agent.sessionId = 'session-9'
    let emitLate: ((progress: AgentProgress) => void) | undefined
    agent.ask = async (_text, onProgress) => {
      emitLate = onProgress
      return agent.reply
    }
    await controller.handleSpoken(heard('what is the time in Tokyo'))
    const count = states.length
    emitLate?.({ kind: 'tool', name: 'pwsh' })
    expect(states).toHaveLength(count)
    expect(states.at(-1)!.sessionId).toBe('session-9')
  })
})
