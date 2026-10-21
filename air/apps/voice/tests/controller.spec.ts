/** Controller tests: fake clock, fake deps, full coverage of the state machine. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Route } from '../src/core/commands.ts'
import type { OperatorIntent } from '../src/core/operator.ts'

// ── fakes ──────────────────────────────────────────────────────────────────

class FakeListener extends EventEmitter {
  languages: string[] = []
  setLanguage(lang: string): void {
    this.languages.push(lang)
  }
  command(text: string, lang = 'en'): void {
    this.emit('command', { text, lang, audioMs: 500, decodeMs: 50 })
  }
}

class FakeSpeaker {
  speaking = false
  spoken: string[] = []
  stopped = 0
  beeps = 0
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
  beep(): void {
    this.beeps++
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
  lang: 'en' | 'ta'
}

async function makeController(runOperator?: (intent: OperatorIntent) => Promise<{ spoken: string }>) {
  const { VoiceController } = await import('../src/core/controller.ts')
  const listener = new FakeListener()
  const speaker = new FakeSpeaker()
  const agent = new FakeAgent()
  const states: VoiceState[] = []
  const controller = new VoiceController({
    listener,
    speaker,
    agent,
    ...runOperator === undefined ? {} : { runOperator },
    onState: (s: VoiceState) => { states.push(s) },
  })
  return { controller, listener, speaker, agent, states }
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('VoiceController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── wake + command ───────────────────────────────────────────────────────

  it('handles a spoken command', async () => {
    const { controller, agent, speaker, states } = await makeController()

    await controller.handleSpoken({ text: 'tell me a joke' })

    expect(agent.asks).toEqual(['tell me a joke'])
    expect(speaker.spoken.length).toBeGreaterThan(0)
    expect(states.some(s => s.phase === 'idle')).toBe(true)
  })

  // ── barge-in ─────────────────────────────────────────────────────────────

  it('beeps and goes awake on a wake, and idle again on a timeout', async () => {
    const { listener, speaker, states } = await makeController()

    listener.emit('wake')
    expect(speaker.beeps).toBe(1)
    expect(states.at(-1)).toMatchObject({ phase: 'awake', lang: 'en' })

    listener.emit('timeout')
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
    const count = states.length
    listener.emit('timeout')
    expect(states).toHaveLength(count)
  })

  it('runs a command the listener emits', async () => {
    const { listener, agent } = await makeController()

    listener.command('tell me a joke')
    await vi.advanceTimersByTimeAsync(100)

    expect(agent.asks).toEqual(['tell me a joke'])
  })

  it('stops the speaker on a wake while speaking and goes awake', async () => {
    const { controller, listener, speaker, states } = await makeController()
    speaker.autoResolve = false

    const first = controller.handleSpoken({ text: 'tell me a story' })
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)).toMatchObject({ phase: 'speaking' })

    listener.emit('wake')
    expect(speaker.stopped).toBe(1)
    expect(speaker.beeps).toBe(1)
    await first
    expect(states.at(-1)).toMatchObject({ phase: 'awake' })

    speaker.autoResolve = true
    await controller.handleSpoken({ text: 'tell me a joke' })
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('beeps but stays thinking on a wake during a turn', async () => {
    const { controller, listener, agent, speaker, states } = await makeController()
    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })
    const first = controller.handleSpoken({ text: 'what is the weather' })
    await vi.advanceTimersByTimeAsync(10)

    listener.emit('wake')

    expect(speaker.beeps).toBe(1)
    expect(speaker.stopped).toBe(0)
    expect(states.at(-1)).toMatchObject({ phase: 'thinking' })
    resolveAsk?.()
    await first
  })

  it('switches to Tamil and back, telling the listener and confirming aloud', async () => {
    const { controller, listener, speaker, states } = await makeController()

    await controller.handleSpoken({ text: 'switch to Tamil' })
    expect(listener.languages).toEqual(['ta'])
    expect(speaker.spoken).toEqual(['Tamil mode.'])
    expect(states.at(-1)).toMatchObject({ phase: 'idle', lang: 'ta' })

    await controller.handleSpoken({ text: 'English mode' })
    expect(listener.languages).toEqual(['ta', 'en'])
    expect(speaker.spoken).toEqual(['Tamil mode.', 'English mode.'])
    expect(states.at(-1)).toMatchObject({ lang: 'en' })
  })

  it('sends Tamil commands to the agent, not the English operator', async () => {
    let ran = false
    const { controller, listener, agent } = await makeController(async () => {
      ran = true
      return { spoken: 'x' }
    })
    await controller.handleSpoken({ text: 'switch to tamil' })

    listener.command('open notepad', 'ta')
    await vi.advanceTimersByTimeAsync(100)
    await controller.handleSpoken({ text: 'open paint' })

    expect(ran).toBe(false)
    expect(agent.asks).toEqual(['open notepad', 'open paint'])
  })

  it('takes the language of the command when it has one', async () => {
    const { controller, agent } = await makeController(async () => ({ spoken: 'Opening Notepad.' }))

    await controller.handleSpoken({ text: 'open notepad', lang: 'ta' })

    expect(agent.asks).toEqual(['open notepad'])
  })

  it('shows a Tamil reply on screen and speaks a fixed sentence instead', async () => {
    const { controller, agent, speaker, states } = await makeController()
    agent.replies = [{ reply: 'வணக்கம்', tools: [] }]

    await controller.handleSpoken({ text: 'say hello in Tamil' })

    expect(speaker.spoken).toEqual(['Reply is on screen.'])
    expect(states.find(s => s.phase === 'speaking')?.reply).toBe('வணக்கம்')
  })

  // ── busy while thinking ──────────────────────────────────────────────────

  it('speaks "still on the last one" when a non-cancel wake command arrives while thinking', async () => {
    const { controller, speaker, agent } = await makeController()

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    // Start first command (don't await yet)
    const firstPromise = controller.handleSpoken({ text: 'what is the weather' })

    // Give it a tick to reach thinking phase
    await vi.advanceTimersByTimeAsync(10)

    // Send second command while thinking
    const secondPromise = controller.handleSpoken({ text: 'tell me a joke' })
    await vi.advanceTimersByTimeAsync(10)

    expect(speaker.spoken.some(s => s.includes('still on the last one'))).toBe(true)

    // Resolve the first ask
    resolveAsk?.()
    await firstPromise
    await secondPromise
  })

  it('allows cancel while thinking', async () => {
    const { controller, agent } = await makeController()

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    const firstPromise = controller.handleSpoken({ text: 'what is the weather' })
    await vi.advanceTimersByTimeAsync(10)

    const cancelPromise = controller.handleSpoken({ text: 'cancel' })
    await vi.advanceTimersByTimeAsync(10)

    expect(agent.cancelled).toBeGreaterThan(0)

    resolveAsk?.()
    await firstPromise
    await cancelPromise
  })

  // ── route commands ───────────────────────────────────────────────────────

  it('switches to local route and confirms', async () => {
    const { controller, speaker, agent } = await makeController()

    await controller.handleSpoken({ text: 'use local model' })

    expect(agent.routeChanges).toContain('local')
    expect(speaker.spoken).toContain('Using local model.')
  })

  it('switches to cloud route and confirms', async () => {
    const { controller, speaker, agent } = await makeController()

    await controller.handleSpoken({ text: 'use cloud model' })

    expect(agent.routeChanges).toContain('cloud')
    expect(speaker.spoken).toContain('Using the cloud model.')
  })

  it('speaks "The cloud key is not set." when the key is missing', async () => {
    const { controller, speaker, agent } = await makeController()
    agent.cloudKeyMissing = true

    await controller.handleSpoken({ text: 'use cloud model' })

    expect(speaker.spoken).toContain('The cloud key is not set.')
  })

  it('switches to screen mode and confirms', async () => {
    const { controller, speaker, agent } = await makeController()

    await controller.handleSpoken({ text: 'screen mode on' })

    expect(agent.routeChanges).toContain('screen')
    expect(speaker.spoken).toContain('Screen mode on.')
  })

  // ── errors ───────────────────────────────────────────────────────────────

  it('speaks and shows agent errors in one sentence', async () => {
    const { controller, speaker, agent, states } = await makeController()
    agent.ask = async () => { throw new Error('Something broke in the agent') }

    await controller.handleSpoken({ text: 'do something' })

    expect(speaker.spoken.some(s => s.includes('Something broke'))).toBe(true)
    expect(states.some(s => s.error !== undefined && s.error.includes('Something broke'))).toBe(true)
  })

  // ── watchdog ─────────────────────────────────────────────────────────────

  it('speaks "Still working." after 120 seconds of thinking', async () => {
    const { controller, speaker, agent } = await makeController()

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    const handlePromise = controller.handleSpoken({ text: 'complex question' })
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(120_000)
    await vi.advanceTimersByTimeAsync(0)

    expect(speaker.spoken).toContain('Still working.')

    resolveAsk?.()
    await handlePromise
  })

  // ── mid-sentence wake ignored ────────────────────────────────────────────

  // ── other commands ───────────────────────────────────────────────────────

  it('starts a new conversation', async () => {
    const { controller, agent } = await makeController()

    await controller.handleSpoken({ text: 'new conversation' })

    expect(agent.conversations).toBe(1)
  })

  it('cancels the current operation', async () => {
    const { controller, agent } = await makeController()

    await controller.handleSpoken({ text: 'cancel' })

    expect(agent.cancelled).toBeGreaterThan(0)
  })

  it('enables memory sharing', async () => {
    const { controller, agent } = await makeController()

    await controller.handleSpoken({ text: 'share memory with cloud' })

    expect(agent.memoryShares).toContain(true)
  })

  it('disables memory sharing', async () => {
    const { controller, agent } = await makeController()

    await controller.handleSpoken({ text: 'stop sharing memory' })

    expect(agent.memoryShares).toContain(false)
  })

  // ── state tracking ───────────────────────────────────────────────────────

  it('reports route and memoryShared in every state', async () => {
    const { controller, states, agent } = await makeController()
    agent.memoryShared = true

    await controller.handleSpoken({ text: 'tell me a joke' })

    expect(states.every(s => s.route === 'local')).toBe(true)
    expect(states.some(s => s.memoryShared)).toBe(true)
  })

  it('reports transcript and tools through the ask flow', async () => {
    const { controller, states, agent } = await makeController()
    agent.replies = [{ reply: 'The answer is 42.', tools: ['calculator'] }]

    await controller.handleSpoken({ text: 'what is six times seven' })

    expect(states.some(s => s.phase === 'thinking' && s.transcript === 'what is six times seven')).toBe(true)
    expect(states.some(s => s.phase === 'speaking' && s.tools?.includes('calculator'))).toBe(true)
  })

  // ── listener wiring ──────────────────────────────────────────────────────

  // ── edge cases for full coverage ─────────────────────────────────────────

  it('handles non-Error exceptions from agent', async () => {
    const { controller, speaker, agent, states } = await makeController()
    agent.ask = async () => { throw 'string error' }

    await controller.handleSpoken({ text: 'do something' })

    expect(speaker.spoken.some(s => s.includes('string error'))).toBe(true)
    expect(states.some(s => s.error === 'string error')).toBe(true)
  })

  // ── UI-initiated actions ────────────────────────────────────────────────

  it('switches route via setRoute (UI click path)', async () => {
    const { controller, agent, speaker } = await makeController()

    await controller.setRoute('cloud')

    expect(agent.routeChanges).toContain('cloud')
    expect(speaker.spoken).toContain('Using the cloud model.')
  })

  it('ignores setRoute while thinking', async () => {
    const { controller, agent, speaker } = await makeController()

    let resolveAsk: (() => void) | undefined
    agent.askDelay = () => new Promise<void>((r) => { resolveAsk = r })

    // Start an ask so the controller enters 'thinking'
    const askPromise = controller.handleSpoken({ text: 'tell me a joke' })
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
    const { controller, agent, speaker, states } = await makeController(async (intent) => {
      intents.push(intent)
      return { spoken: 'Opening Notepad.' }
    })

    await controller.handleSpoken({ text: 'open notepad' })

    expect(intents).toEqual([{ kind: 'open', target: 'notepad.exe', label: 'Notepad' }])
    expect(agent.asks).toEqual([])
    expect(speaker.spoken).toEqual(['Opening Notepad.'])
    expect(states.find(state => state.phase === 'speaking')).toMatchObject({ reply: 'Opening Notepad.', tools: ['operator'] })
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('says it could not do it when the operator fails, and does not fall back to the agent', async () => {
    const { controller, agent, speaker, states } = await makeController(async () => {
      throw new Error('boom')
    })

    await controller.handleSpoken({ text: 'close notepad' })

    expect(agent.asks).toEqual([])
    expect(speaker.spoken).toEqual(["I couldn't do that."])
    expect(states.some(state => state.error === "I couldn't do that." && state.tools?.[0] === 'operator')).toBe(true)
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('still asks the agent for commands the operator does not match', async () => {
    let ran = false
    const { controller, agent } = await makeController(async () => {
      ran = true
      return { spoken: 'x' }
    })

    await controller.handleSpoken({ text: 'open the pod bay doors' })

    expect(ran).toBe(false)
    expect(agent.asks).toEqual(['open the pod bay doors'])
  })

  it('uses the real operator by default (time answers locally)', async () => {
    const { controller, agent, speaker } = await makeController()

    await controller.handleSpoken({ text: 'what time is it' })

    expect(agent.asks).toEqual([])
    expect(speaker.spoken[0]).toMatch(/^It's \d{1,2}:\d{2}/)
  })

  it('refuses a non-cancel command while the operator is busy', async () => {
    let finish: (() => void) | undefined
    const { controller, speaker } = await makeController(() => new Promise((resolve) => {
      finish = () => {
        resolve({ spoken: 'Opening Notepad.' })
      }
    }))
    const first = controller.handleSpoken({ text: 'open notepad' })
    await vi.advanceTimersByTimeAsync(0)

    await controller.handleSpoken({ text: 'open paint' })
    expect(speaker.spoken).toEqual(["I'm still on the last one."])

    finish?.()
    await first
  })

  it('sends remember commands to the agent as an explicit memory_write instruction, showing the spoken text', async () => {
    const { controller, agent, states } = await makeController()

    await controller.handleSpoken({ text: 'remember that I like short answers' })

    expect(agent.asks).toEqual(['Use the memory_write tool with type user to save this note: I like short answers. Then reply "Noted."'])
    expect(states.find(state => state.phase === 'thinking')?.transcript).toBe('remember that I like short answers')
  })

  it('toggles memory share via setMemoryShare (UI click path)', async () => {
    const { controller, agent, states } = await makeController()

    await controller.setMemoryShare(true)

    expect(agent.memoryShares).toContain(true)
    expect(agent.memoryShared).toBe(true)
    expect(states.some(s => s.memoryShared)).toBe(true)
  })
})
