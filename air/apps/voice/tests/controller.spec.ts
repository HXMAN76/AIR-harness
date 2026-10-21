/** Controller tests: fake clock, fake deps, full coverage of the state machine. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Route } from '../src/core/commands.ts'
import type { OperatorIntent } from '../src/core/operator.ts'

// ── fakes ──────────────────────────────────────────────────────────────────

class FakeListener extends EventEmitter {
  pushSegment(text: string, durationMs = 500): void {
    this.emit('segment', { text, durationMs })
  }
}

class FakeSpeaker {
  speaking = false
  spoken: string[] = []
  stopped = 0
  /** When true, speak() resolves immediately. When false, call finishSpeaking() to resolve. */
  autoResolve = true
  private resolvers: Array<() => void> = []

  speak(text: string): Promise<void> {
    this.spoken.push(text)
    this.speaking = true
    if (this.autoResolve) {
      this.speaking = false
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.resolvers.push(() => {
        this.speaking = false
        resolve()
      })
    })
  }
  finishSpeaking(): void {
    const resolvers = this.resolvers.splice(0)
    for (const r of resolvers) r()
  }
  stop(): void {
    this.stopped++
    this.finishSpeaking()
  }
}

class FakeAgent {
  route: Route = 'local'
  memoryShared = false
  asks: string[] = []
  replies: Array<{ reply: string; tools: string[] }> = [{ reply: 'The time is 3 PM.', tools: [] }]
  cancelled = 0
  conversations = 0
  memoryShares: boolean[] = []
  routeChanges: Route[] = []
  /** When true, setRoute returns missing-key. */
  cloudKeyMissing = false
  /** Set to a function to make ask() delay. */
  askDelay: (() => Promise<void>) | undefined

  setRoute(route: Route): { ok: true } | { ok: false; reason: 'missing-key' } {
    if ((route === 'cloud' || route === 'screen') && this.cloudKeyMissing) {
      return { ok: false, reason: 'missing-key' }
    }
    this.route = route
    this.routeChanges.push(route)
    return { ok: true }
  }
  async ask(text: string): Promise<{ reply: string; tools: string[] }> {
    this.asks.push(text)
    if (this.askDelay) await this.askDelay()
    return this.replies[Math.min(this.asks.length - 1, this.replies.length - 1)] ?? { reply: 'Done.', tools: [] }
  }
  newConversation(): void {
    this.conversations++
  }
  async setMemoryShare(on: boolean): Promise<void> {
    this.memoryShared = on
    this.memoryShares.push(on)
  }
  async cancel(): Promise<void> {
    this.cancelled++
  }
  async dispose(): Promise<void> { /* no-op */ }
}

// ── helpers ────────────────────────────────────────────────────────────────

interface VoiceState {
  phase: 'idle' | 'awake' | 'thinking' | 'speaking'
  route: Route
  transcript?: string
  reply?: string
  tools?: string[]
  error?: string
  memoryShared: boolean
}

async function makeController(clock: { now: number }, runOperator?: (intent: OperatorIntent) => Promise<{ spoken: string }>) {
  const { VoiceController } = await import('../src/core/controller.ts')
  const listener = new FakeListener()
  const speaker = new FakeSpeaker()
  const agent = new FakeAgent()
  const states: VoiceState[] = []
  const controller = new VoiceController({
    listener,
    speaker,
    agent,
    now: () => clock.now,
    ...runOperator === undefined ? {} : { runOperator },
    onState: (s: VoiceState) => { states.push(s) },
  })
  return { controller, listener, speaker, agent, states }
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('VoiceController', () => {
  let clock: { now: number }

  beforeEach(() => {
    clock = { now: 0 }
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── wake + command ───────────────────────────────────────────────────────

  it('handles a wake phrase with a command in one segment', async () => {
    const { controller, agent, speaker, states } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis tell me a joke' })

    expect(agent.asks).toEqual(['tell me a joke'])
    expect(speaker.spoken.length).toBeGreaterThan(0)
    expect(states.some(s => s.phase === 'idle')).toBe(true)
  })

  it('goes awake on wake without command, then handles the next segment as a command within 8 s', async () => {
    const { controller, agent, states } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis' })
    expect(states.some(s => s.phase === 'awake')).toBe(true)
    expect(agent.asks).toEqual([])

    clock.now = 5_000
    await controller.handleSegment({ text: 'tell me a joke' })

    expect(agent.asks).toEqual(['tell me a joke'])
  })

  it('ignores a follow-up command after the 8-second awake window', async () => {
    const { controller, agent, states } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis' })
    expect(states.some(s => s.phase === 'awake')).toBe(true)

    clock.now = 9_000
    await controller.handleSegment({ text: 'tell me a joke' })

    expect(agent.asks).toEqual([])
  })

  it('ignores a non-wake segment when idle', async () => {
    const { controller, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'just talking to myself' })

    expect(agent.asks).toEqual([])
  })

  // ── barge-in ─────────────────────────────────────────────────────────────

  it('stops the speaker when a wake command arrives while speaking', async () => {
    const { controller, speaker } = await makeController(clock)
    speaker.autoResolve = false

    // Start a command that will speak
    const first = controller.handleSegment({ text: 'Jarvis tell me a story' })
    // Let the ask resolve and reach speaking phase
    await vi.advanceTimersByTimeAsync(0)

    // Now we're in speaking phase, barge in
    const barge = controller.handleSegment({ text: 'Jarvis cancel' })
    await vi.advanceTimersByTimeAsync(0)

    expect(speaker.stopped).toBeGreaterThan(0)

    // Clean up
    speaker.finishSpeaking()
    await first
    await barge
  })

  // ── busy while thinking ──────────────────────────────────────────────────

  it('speaks "still on the last one" when a non-cancel wake command arrives while thinking', async () => {
    const { controller, speaker, agent } = await makeController(clock)

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    // Start first command (don't await yet)
    const firstPromise = controller.handleSegment({ text: 'Jarvis what is the weather' })

    // Give it a tick to reach thinking phase
    await vi.advanceTimersByTimeAsync(10)

    // Send second command while thinking
    const secondPromise = controller.handleSegment({ text: 'Jarvis tell me a joke' })
    await vi.advanceTimersByTimeAsync(10)

    expect(speaker.spoken.some(s => s.includes('still on the last one'))).toBe(true)

    // Resolve the first ask
    resolveAsk?.()
    await firstPromise
    await secondPromise
  })

  it('allows cancel while thinking', async () => {
    const { controller, agent } = await makeController(clock)

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    const firstPromise = controller.handleSegment({ text: 'Jarvis what is the weather' })
    await vi.advanceTimersByTimeAsync(10)

    const cancelPromise = controller.handleSegment({ text: 'Jarvis cancel' })
    await vi.advanceTimersByTimeAsync(10)

    expect(agent.cancelled).toBeGreaterThan(0)

    resolveAsk?.()
    await firstPromise
    await cancelPromise
  })

  // ── route commands ───────────────────────────────────────────────────────

  it('switches to local route and confirms', async () => {
    const { controller, speaker, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis use local model' })

    expect(agent.routeChanges).toContain('local')
    expect(speaker.spoken).toContain('Using local model.')
  })

  it('switches to cloud route and confirms', async () => {
    const { controller, speaker, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis use cloud model' })

    expect(agent.routeChanges).toContain('cloud')
    expect(speaker.spoken).toContain('Using the cloud model.')
  })

  it('speaks "The cloud key is not set." when the key is missing', async () => {
    const { controller, speaker, agent } = await makeController(clock)
    agent.cloudKeyMissing = true

    await controller.handleSegment({ text: 'Jarvis use cloud model' })

    expect(speaker.spoken).toContain('The cloud key is not set.')
  })

  it('switches to screen mode and confirms', async () => {
    const { controller, speaker, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis screen mode on' })

    expect(agent.routeChanges).toContain('screen')
    expect(speaker.spoken).toContain('Screen mode on.')
  })

  // ── errors ───────────────────────────────────────────────────────────────

  it('speaks and shows agent errors in one sentence', async () => {
    const { controller, speaker, agent, states } = await makeController(clock)
    agent.ask = async () => { throw new Error('Something broke in the agent') }

    await controller.handleSegment({ text: 'Jarvis do something' })

    expect(speaker.spoken.some(s => s.includes('Something broke'))).toBe(true)
    expect(states.some(s => s.error !== undefined && s.error.includes('Something broke'))).toBe(true)
  })

  // ── watchdog ─────────────────────────────────────────────────────────────

  it('speaks "Still working." after 120 seconds of thinking', async () => {
    const { controller, speaker, agent } = await makeController(clock)

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    const handlePromise = controller.handleSegment({ text: 'Jarvis complex question' })
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(120_000)
    await vi.advanceTimersByTimeAsync(0)

    expect(speaker.spoken).toContain('Still working.')

    resolveAsk?.()
    await handlePromise
  })

  // ── mid-sentence wake ignored ────────────────────────────────────────────

  it('ignores wake phrases that are not at the start of the transcript', async () => {
    const { controller, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'I told Jarvis to stop yesterday' })

    expect(agent.asks).toEqual([])
  })

  // ── other commands ───────────────────────────────────────────────────────

  it('starts a new conversation', async () => {
    const { controller, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis new conversation' })

    expect(agent.conversations).toBe(1)
  })

  it('cancels the current operation', async () => {
    const { controller, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis cancel' })

    expect(agent.cancelled).toBeGreaterThan(0)
  })

  it('enables memory sharing', async () => {
    const { controller, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis share memory with cloud' })

    expect(agent.memoryShares).toContain(true)
  })

  it('disables memory sharing', async () => {
    const { controller, agent } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis stop sharing memory' })

    expect(agent.memoryShares).toContain(false)
  })

  // ── state tracking ───────────────────────────────────────────────────────

  it('reports route and memoryShared in every state', async () => {
    const { controller, states, agent } = await makeController(clock)
    agent.memoryShared = true

    await controller.handleSegment({ text: 'Jarvis tell me a joke' })

    expect(states.every(s => s.route === 'local')).toBe(true)
    expect(states.some(s => s.memoryShared)).toBe(true)
  })

  it('reports transcript and tools through the ask flow', async () => {
    const { controller, states, agent } = await makeController(clock)
    agent.replies = [{ reply: 'The answer is 42.', tools: ['calculator'] }]

    await controller.handleSegment({ text: 'Jarvis what is six times seven' })

    expect(states.some(s => s.phase === 'thinking' && s.transcript === 'what is six times seven')).toBe(true)
    expect(states.some(s => s.phase === 'speaking' && s.tools?.includes('calculator'))).toBe(true)
  })

  // ── listener wiring ──────────────────────────────────────────────────────

  it('listens for segments from the listener', async () => {
    const { listener, agent } = await makeController(clock)

    listener.pushSegment('Jarvis tell me a joke')
    // Give async handlers time to run
    await vi.advanceTimersByTimeAsync(100)

    expect(agent.asks).toEqual(['tell me a joke'])
  })

  // ── edge cases for full coverage ─────────────────────────────────────────

  it('uses Date.now when now is not provided', async () => {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    const speaker = new FakeSpeaker()
    const agent = new FakeAgent()
    const states: VoiceState[] = []

    // Create without now function - should use Date.now
    const controller = new VoiceController({
      listener,
      speaker,
      agent,
      onState: (s: VoiceState) => { states.push(s) },
    })

    // Exercise the awake window which uses now()
    await controller.handleSegment({ text: 'Jarvis' })
    expect(states.some(s => s.phase === 'awake')).toBe(true)

    // Follow up with command
    await controller.handleSegment({ text: 'tell me a joke' })
    expect(agent.asks).toEqual(['tell me a joke'])
  })

  it('ignores bare wake while thinking (empty command)', async () => {
    const { controller, speaker, agent } = await makeController(clock)

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    const firstPromise = controller.handleSegment({ text: 'Jarvis what is the weather' })
    await vi.advanceTimersByTimeAsync(10)

    // Send bare wake while thinking
    await controller.handleSegment({ text: 'Jarvis' })
    await vi.advanceTimersByTimeAsync(10)

    // Should not speak "still on the last one" for bare wake
    expect(speaker.spoken.some(s => s.includes('still on the last one'))).toBe(false)

    resolveAsk?.()
    await firstPromise
  })

  it('handles non-Error exceptions from agent', async () => {
    const { controller, speaker, agent, states } = await makeController(clock)
    agent.ask = async () => { throw 'string error' }

    await controller.handleSegment({ text: 'Jarvis do something' })

    expect(speaker.spoken.some(s => s.includes('string error'))).toBe(true)
    expect(states.some(s => s.error === 'string error')).toBe(true)
  })

  // ── UI-initiated actions ────────────────────────────────────────────────

  it('switches route via setRoute (UI click path)', async () => {
    const { controller, agent, speaker } = await makeController(clock)

    await controller.setRoute('cloud')

    expect(agent.routeChanges).toContain('cloud')
    expect(speaker.spoken).toContain('Using the cloud model.')
  })

  it('ignores setRoute while thinking', async () => {
    const { controller, agent, speaker } = await makeController(clock)

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    // Start an ask so the controller enters 'thinking'
    const askPromise = controller.handleSegment({ text: 'Jarvis tell me a joke' })
    await vi.advanceTimersByTimeAsync(10)

    // Try to change route while thinking
    await controller.setRoute('cloud')

    // Route should not have changed
    expect(agent.routeChanges).not.toContain('cloud')
    expect(speaker.spoken).not.toContain('Using the cloud model.')

    // Finish the ask
    resolveAsk?.()
    await askPromise
  })

  // ── operator fast path ───────────────────────────────────────────────────

  it('runs a matched command through the operator, speaks its reply, and skips the agent', async () => {
    const intents: OperatorIntent[] = []
    const { controller, agent, speaker, states } = await makeController(clock, async (intent) => {
      intents.push(intent)
      return { spoken: 'Opening Notepad.' }
    })

    await controller.handleSegment({ text: 'Jarvis open notepad' })

    expect(intents).toEqual([{ kind: 'open', target: 'notepad.exe', label: 'Notepad' }])
    expect(agent.asks).toEqual([])
    expect(speaker.spoken).toEqual(['Opening Notepad.'])
    expect(states.find(state => state.phase === 'speaking')).toMatchObject({ reply: 'Opening Notepad.', tools: ['operator'] })
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('handles a follow-up command after a bare wake through the operator too', async () => {
    const { controller, agent, speaker } = await makeController(clock, async () => ({ spoken: 'Volume up.' }))

    await controller.handleSegment({ text: 'Jarvis' })
    await controller.handleSegment({ text: 'volume up' })

    expect(agent.asks).toEqual([])
    expect(speaker.spoken).toEqual(['Volume up.'])
  })

  it('says it could not do it when the operator fails, and does not fall back to the agent', async () => {
    const { controller, agent, speaker, states } = await makeController(clock, async () => {
      throw new Error('boom')
    })

    await controller.handleSegment({ text: 'Jarvis close notepad' })

    expect(agent.asks).toEqual([])
    expect(speaker.spoken).toEqual(["I couldn't do that."])
    expect(states.some(state => state.error === "I couldn't do that." && state.tools?.[0] === 'operator')).toBe(true)
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('still asks the agent for commands the operator does not match', async () => {
    let ran = false
    const { controller, agent } = await makeController(clock, async () => {
      ran = true
      return { spoken: 'x' }
    })

    await controller.handleSegment({ text: 'Jarvis open the pod bay doors' })

    expect(ran).toBe(false)
    expect(agent.asks).toEqual(['open the pod bay doors'])
  })

  it('uses the real operator by default (time answers locally)', async () => {
    const { controller, agent, speaker } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis what time is it' })

    expect(agent.asks).toEqual([])
    expect(speaker.spoken[0]).toMatch(/^It's \d{1,2}:\d{2}/)
  })

  it('refuses a non-cancel command while the operator is busy', async () => {
    let finish: (() => void) | undefined
    const { controller, speaker } = await makeController(clock, () => new Promise((resolve) => {
      finish = () => {
        resolve({ spoken: 'Opening Notepad.' })
      }
    }))
    const first = controller.handleSegment({ text: 'Jarvis open notepad' })
    await vi.advanceTimersByTimeAsync(0)

    await controller.handleSegment({ text: 'Jarvis open paint' })
    expect(speaker.spoken).toEqual(["I'm still on the last one."])

    finish?.()
    await first
  })

  it('sends remember commands to the agent as an explicit memory_write instruction, showing the spoken text', async () => {
    const { controller, agent, states } = await makeController(clock)

    await controller.handleSegment({ text: 'Jarvis remember that I like short answers' })

    expect(agent.asks).toEqual(['Use the memory_write tool with type user to save this note: I like short answers. Then reply "Noted."'])
    expect(states.find(state => state.phase === 'thinking')?.transcript).toBe('remember that I like short answers')
  })

  it('toggles memory share via setMemoryShare (UI click path)', async () => {
    const { controller, agent, states } = await makeController(clock)

    await controller.setMemoryShare(true)

    expect(agent.memoryShares).toContain(true)
    expect(agent.memoryShared).toBe(true)
    expect(states.some(s => s.memoryShared)).toBe(true)
  })
})
