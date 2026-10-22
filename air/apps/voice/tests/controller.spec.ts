/** Controller tests: fake clock, fake deps, full coverage of the state machine. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Route } from '../src/core/commands.ts'
import type { OperatorIntent } from '../src/core/operator.ts'
import { CONFIRM_WINDOW_MS, DEFAULT_FOLLOWUP_MS, followUpMsFromEnv, greetingFor } from '../src/core/controller.ts'

// ── fakes ──────────────────────────────────────────────────────────────────

class FakeListener extends EventEmitter {
  languages: string[] = []
  setLanguage(lang: string): void {
    this.languages.push(lang)
  }
  listens = 0
  mutes: boolean[] = []
  mute(on: boolean): void {
    this.mutes.push(on)
  }
  windows: Array<number | undefined> = []
  listen(seconds?: number): void {
    this.listens++
    this.windows.push(seconds)
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
  replies: Array<{ reply: string; tools: string[]; approval?: { summary: string; digest: string }; refused?: string }> = [{ reply: 'The time is 3 PM.', tools: [] }]
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
  async ask(text: string): Promise<{ reply: string; tools: string[]; approval?: { summary: string; digest: string }; refused?: string }> {
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

    await controller.handleSpoken({ text: 'volume up' })

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

  describe('confirming destructive commands', () => {
    async function ask(text: string) {
      const intents: OperatorIntent[] = []
      const rig = await makeController(async (intent) => {
        intents.push(intent)
        return { spoken: 'Closing Notepad.' }
      })
      await rig.controller.handleSpoken({ text })
      return { ...rig, intents }
    }

    it('asks first for lock, and does not run yet', async () => {
      const closing = await ask('lock the screen')
      expect(closing.speaker.spoken).toEqual(['Say yes to confirm.'])
      expect(closing.intents).toEqual([])
      expect(closing.listener.listens).toBe(1)
      expect(closing.states.at(-1)).toMatchObject({ phase: 'awake' })
      const locking = await ask('lock screen')
      expect(locking.speaker.spoken).toEqual(['Say yes to confirm.'])
      expect(locking.intents).toEqual([])
    })

    it.each(['yes', 'Yes.', 'confirm', 'Yeah!'])('runs the command on %j without another wake', async (answer) => {
      const { controller, speaker, intents, agent } = await ask('lock the screen')
      await controller.handleSpoken({ text: answer })
      expect(intents).toMatchObject([{ kind: 'lock' }])
      expect(speaker.spoken).toEqual(['Say yes to confirm.', 'Closing Notepad.'])
      expect(agent.asks).toEqual([])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(speaker.spoken).toHaveLength(2)
    })

    it('cancels on any other answer, then treats the next command normally', async () => {
      const { controller, speaker, intents, agent, states } = await ask('lock the screen')
      await controller.handleSpoken({ text: 'no thanks' })
      expect(speaker.spoken).toEqual(['Say yes to confirm.', 'Cancelled.'])
      expect(intents).toEqual([])
      expect(states.at(-1)).toMatchObject({ phase: 'idle' })
      await controller.handleSpoken({ text: 'what is the capital of France' })
      expect(agent.asks).toEqual(['what is the capital of France'])
    })

    it('cancels after six seconds of silence', async () => {
      const { speaker, intents } = await ask('lock the screen')
      await vi.advanceTimersByTimeAsync(5_900)
      expect(speaker.spoken).toEqual(['Say yes to confirm.'])
      await vi.advanceTimersByTimeAsync(200)
      expect(speaker.spoken).toEqual(['Say yes to confirm.', 'Cancelled.'])
      expect(intents).toEqual([])
    })

    it('cancels when the listener times out, and a late yes does nothing special', async () => {
      const { listener, speaker, intents } = await ask('lock the screen')
      listener.emit('timeout')
      await vi.advanceTimersByTimeAsync(0)
      expect(speaker.spoken).toEqual(['Say yes to confirm.', 'Cancelled.'])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(speaker.spoken).toHaveLength(2)
      expect(intents).toEqual([])
    })

    it('closes an app at once, without a confirmation', async () => {
      const { speaker, intents } = await ask('close notepad')
      expect(speaker.spoken).toEqual(['Closing Notepad.'])
      expect(intents).toMatchObject([{ kind: 'close', label: 'Notepad' }])
    })

    it('closes the last opened app on "close it", and asks which app when none was opened', async () => {
      const intents: OperatorIntent[] = []
      const { controller, speaker, states } = await makeController(async (intent) => {
        intents.push(intent)
        return { spoken: 'ok.' }
      })
      await controller.handleSpoken({ text: 'close it' })
      expect(speaker.spoken).toEqual(['Which app should I close?'])
      expect(states.some(state => state.reply === 'Which app should I close?')).toBe(true)
      await controller.handleSpoken({ text: 'open the browser' })
      await controller.handleSpoken({ text: 'close that' })
      expect(speaker.spoken.at(-1)).toBe('Which app should I close?')
      await controller.handleSpoken({ text: 'open notepad' })
      await controller.handleSpoken({ text: 'close the app' })
      expect(intents.map(i => i.kind)).toEqual(['open', 'open', 'close'])
      expect(intents[2]).toMatchObject({ names: ['notepad'], label: 'Notepad' })
      await controller.handleSpoken({ text: 'close it' })
      expect(speaker.spoken.at(-1)).toBe('Which app should I close?')
    })

    it('does not ask for harmless commands', async () => {
      const { speaker, intents } = await ask('volume up')
      expect(speaker.spoken).toEqual(['Closing Notepad.'])
      expect(intents).toEqual([{ kind: 'volume', action: 'up' }])
    })

    it('accepts yes after a wake that cut off the prompt', async () => {
      const rig = await makeController(async () => ({ spoken: 'Closing Notepad.' }))
      rig.speaker.autoResolve = false
      const asking = rig.controller.handleSpoken({ text: 'lock the screen' })
      await vi.advanceTimersByTimeAsync(0)
      rig.listener.emit('wake')
      await asking
      rig.speaker.autoResolve = true
      await rig.controller.handleSpoken({ text: 'yes' })
      expect(rig.speaker.spoken).toEqual(['Say yes to confirm.', 'Closing Notepad.'])
    })
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

describe('confirmation edge paths', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  async function rig(runOperator?: (intent: OperatorIntent) => Promise<{ spoken: string }>) {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    const speaker = new FakeSpeaker()
    const agent = new FakeAgent()
    const states: VoiceState[] = []
    const controller = new VoiceController({ listener, speaker, agent,
      ...runOperator === undefined ? {} : { runOperator }, onState: (s) => { states.push(s) } })
    return { controller, listener, speaker, agent, states }
  }

  it('cancels when the confirmation window passes unanswered', async () => {
    const { controller, speaker } = await rig(async () => ({ spoken: 'Closing Notepad.' }))
    await controller.handleSpoken({ text: 'lock the screen' })
    expect(speaker.spoken).toEqual(['Say yes to confirm.'])
    await vi.advanceTimersByTimeAsync(CONFIRM_WINDOW_MS)
    expect(speaker.spoken).toEqual(['Say yes to confirm.', 'Cancelled.'])
    expect(speaker.spoken).toHaveLength(2)
  })

  it('drops a confirmation prompt that a later answer already settled', async () => {
    const intents: OperatorIntent[] = []
    const { controller, speaker } = await rig(async (intent) => { intents.push(intent); return { spoken: 'Closing Notepad.' } })
    const first = controller.handleSpoken({ text: 'lock the screen' })
    await Promise.resolve()
    await controller.handleSpoken({ text: 'no thanks' })
    await first
    expect(intents).toEqual([])
    expect(speaker.spoken).toEqual(['Say yes to confirm.', 'Cancelled.'])
  })

  it('asks confirmation when the listener cannot arm a follow-up', async () => {
    const { controller, speaker, listener } = await rig(async () => ({ spoken: 'Locked.' }))
    Object.defineProperty(listener, 'listen', { value: undefined, configurable: true })
    await controller.handleSpoken({ text: 'lock screen' })
    expect(speaker.spoken).toEqual(['Say yes to confirm.'])
    expect(listener.listens).toBe(0)
  })
})

describe('email requests and the send gate', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  async function rig() {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    const speaker = new FakeSpeaker()
    const agent = new FakeAgent()
    const states: VoiceState[] = []
    const operated: OperatorIntent[] = []
    const controller = new VoiceController({ listener, speaker, agent,
      runOperator: async (intent) => { operated.push(intent); return { spoken: 'Opened.' } },
      onState: (s) => { states.push(s) } })
    return { controller, listener, speaker, agent, states, operated }
  }

  const DRAFT = 'Draft to Asha saying running late.\nCONFIRM SEND'

  it('opens gmail through the operator with no model, with or without the cloud key', async () => {
    const { controller, speaker, agent, operated } = await rig()
    await controller.handleSpoken({ text: 'open gmail' })
    agent.cloudKeyMissing = true
    await controller.handleSpoken({ text: 'open gmail' })
    expect(agent.routeChanges).toEqual([])
    expect(agent.asks).toEqual([])
    expect(operated).toEqual([{ kind: 'open', target: 'https://mail.google.com', label: 'Gmail' }, { kind: 'open', target: 'https://mail.google.com', label: 'Gmail' }])
    expect(speaker.spoken).toEqual(['Opened.', 'Opened.'])
  })

  it('switches local to cloud for a mail read and asks the read-only instruction', async () => {
    const { controller, speaker, agent } = await rig()
    await controller.handleSpoken({ text: 'read my important mail' })
    expect(agent.routeChanges).toEqual(['cloud'])
    expect(agent.asks[0]).toContain('up to 5 unread messages')
    expect(speaker.spoken).toEqual(['Using the cloud model.', 'The time is 3 PM.'])
  })

  it('stays local and does not ask the model when the cloud key is missing', async () => {
    const { controller, speaker, agent, states } = await rig()
    agent.cloudKeyMissing = true
    await controller.handleSpoken({ text: 'check my mail' })
    expect(speaker.spoken).toEqual(['The cloud key is not set.'])
    expect(agent.route).toBe('local')
    expect(agent.asks).toEqual([])
    expect(states.at(-1)).toMatchObject({ phase: 'idle', route: 'local' })
  })

  it('does not switch or announce when already on a cloud route', async () => {
    const { controller, speaker, agent } = await rig()
    agent.route = 'screen'
    await controller.handleSpoken({ text: 'check my mail' })
    expect(agent.routeChanges).toEqual([])
    expect(speaker.spoken).toEqual(['The time is 3 PM.'])
  })

  it('speaks the draft without the gate line, then asks for a spoken yes and arms the listener', async () => {
    const { controller, speaker, agent, listener, states } = await rig()
    agent.replies = [{ reply: DRAFT, tools: ['browser'] }]
    await controller.handleSpoken({ text: 'send a gmail to Asha saying running late' })
    expect(agent.asks[0]).toContain('exactly CONFIRM SEND')
    expect(speaker.spoken).toEqual(['Using the cloud model.', 'Draft to Asha saying running late.', 'Say yes to send it.'])
    expect(states.find(s => s.reply?.startsWith('Draft'))?.reply).toBe('Draft to Asha saying running late.')
    expect(listener.listens).toBe(1)
    expect(states.at(-1)).toMatchObject({ phase: 'awake' })
  })

  it('presses Send after yes, with no second gate, and speaks the result', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }, { reply: 'Sent to Asha.', tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    await controller.handleSpoken({ text: 'Yes.' })
    expect(agent.asks[1]).toBe('Now press Send and speak one sentence saying who it went to.')
    expect(agent.asks).toHaveLength(2)
    expect(speaker.spoken.at(-1)).toBe('Sent to Asha.')
  })

  it('does not gate the press-Send turn even if its reply repeats the gate line', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }, { reply: 'Sent.\nCONFIRM SEND', tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    await controller.handleSpoken({ text: 'yes' })
    expect(speaker.spoken.filter(text => text === 'Say yes to send it.')).toHaveLength(1)
  })

  it('cancels with "Do not send it." on anything but yes', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    await controller.handleSpoken({ text: 'no change the subject' })
    expect(agent.asks[1]).toBe('Do not send it.')
    expect(speaker.spoken.at(-1)).toBe('Cancelled.')
  })

  it('cancels the same way after the confirmation window passes in silence', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    await vi.advanceTimersByTimeAsync(CONFIRM_WINDOW_MS)
    expect(agent.asks[1]).toBe('Do not send it.')
    expect(speaker.spoken.at(-1)).toBe('Cancelled.')
  })

  it('still says Cancelled when the Do-not-send turn fails', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    agent.ask = async () => { throw new Error('offline') }
    await controller.handleSpoken({ text: 'no' })
    expect(speaker.spoken.at(-1)).toBe('Cancelled.')
  })

  it('speaks only the prompt when the reply is just the gate line', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: 'CONFIRM SEND', tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    expect(speaker.spoken).toEqual(['Using the cloud model.', 'Say yes to send it.'])
  })

  it('does not gate a reply that mentions the phrase mid-sentence, or a failed turn', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: 'I will not say CONFIRM SEND yet.', tools: [] }]
    await controller.handleSpoken({ text: 'check my mail' })
    expect(speaker.spoken).toEqual(['Using the cloud model.', 'I will not say CONFIRM SEND yet.'])
    agent.ask = async () => { throw new Error('browser failed') }
    await controller.handleSpoken({ text: 'check my mail' })
    expect(speaker.spoken.at(-1)).toBe('browser failed')
  })
})

describe('conversation mode', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  async function rig(hour = 9, runOperator?: (intent: OperatorIntent) => Promise<{ spoken: string }>) {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    const speaker = new FakeSpeaker()
    const agent = new FakeAgent()
    const states: VoiceState[] = []
    const controller = new VoiceController({
      listener, speaker, agent, followUpMs: 8000, now: () => new Date(2026, 9, 22, hour, 0),
      runOperator: runOperator ?? (async () => ({ spoken: 'Opening Notepad.' })),
      onState: (s: VoiceState) => { states.push(s) },
    })
    return { controller, listener, speaker, agent, states }
  }

  it('reads the follow-up window from the environment', () => {
    expect(DEFAULT_FOLLOWUP_MS).toBe(8000)
    expect(followUpMsFromEnv({})).toBe(8000)
    expect(followUpMsFromEnv({ AIR_VOICE_FOLLOWUP_MS: ' ' })).toBe(8000)
    expect(followUpMsFromEnv({ AIR_VOICE_FOLLOWUP_MS: 'abc' })).toBe(8000)
    expect(followUpMsFromEnv({ AIR_VOICE_FOLLOWUP_MS: '-5' })).toBe(8000)
    expect(followUpMsFromEnv({ AIR_VOICE_FOLLOWUP_MS: '3000' })).toBe(3000)
    expect(followUpMsFromEnv({ AIR_VOICE_FOLLOWUP_MS: '0' })).toBe(0)
  })

  it.each([[5, 'Good morning.'], [12, 'Good afternoon.'], [16, 'Good afternoon.'], [17, 'Good evening.'], [23, 'Good evening.']])('greets at hour %i with %s', (hour, greeting) => {
    expect(greetingFor(new Date(2026, 9, 22, hour, 30))).toBe(greeting)
  })

  it('greets on a bare wake with suggestions, then listens for 8 s without a wake', async () => {
    const { listener, speaker, states } = await rig(9)
    listener.emit('wake', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(speaker.spoken).toEqual(["Good morning. I can read your important mail, read today's news, or open an app. What would you like?"])
    expect(listener.windows).toEqual([8])
    expect(states.at(-1)).toMatchObject({ phase: 'awake' })
    listener.emit('timeout')
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
    expect(speaker.spoken).toHaveLength(1)
  })

  it('greets by the real clock when none is injected, and a second wake cuts the greeting off', async () => {
    const plain = await makeController()
    plain.listener.emit('wake', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(plain.speaker.spoken[0]).toMatch(/^Good (?:morning|afternoon|evening). I can read/)
    const { listener, speaker, states } = await rig()
    speaker.autoResolve = false
    listener.emit('wake', true)
    await vi.advanceTimersByTimeAsync(0)
    listener.emit('wake')
    await vi.advanceTimersByTimeAsync(0)
    expect(listener.windows).toEqual([])
    expect(states.at(-1)).toMatchObject({ phase: 'awake' })
  })

  it('does not greet when a command follows the wake, or while a turn is running', async () => {
    const { listener, speaker } = await rig()
    listener.emit('wake')
    await vi.advanceTimersByTimeAsync(0)
    expect(speaker.spoken).toEqual([])
    let finish: (() => void) | undefined
    const busy = await rig(9, () => new Promise((resolve) => { finish = () => { resolve({ spoken: 'Done.' }) } }))
    const first = busy.controller.handleSpoken({ text: 'open notepad' })
    await vi.advanceTimersByTimeAsync(0)
    busy.listener.emit('wake', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(busy.speaker.spoken).toEqual([])
    finish?.()
    await first
  })

  it('does not greet while a confirmation is pending', async () => {
    const { controller, listener, speaker } = await rig()
    await controller.handleSpoken({ text: 'lock the screen' })
    listener.emit('wake', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(speaker.spoken).toEqual(['Say yes to confirm.'])
  })

  it('opens the same window after an operator reply and after an agent reply', async () => {
    const { controller, listener, agent, states } = await rig()
    await controller.handleSpoken({ text: 'open notepad' })
    expect(listener.windows).toEqual([8])
    expect(states.at(-1)).toMatchObject({ phase: 'awake' })
    await controller.handleSpoken({ text: 'tell me a joke' })
    expect(agent.asks).toEqual(['tell me a joke'])
    expect(listener.windows).toEqual([8, 8])
  })

  it('does not open a window after an error, or when conversation mode is off', async () => {
    const failing = await rig(9, async () => { throw new Error('x') })
    await failing.controller.handleSpoken({ text: 'open notepad' })
    expect(failing.listener.windows).toEqual([])
    const off = await makeController()
    await off.controller.handleSpoken({ text: 'tell me a joke' })
    expect(off.listener.windows).toEqual([])
    expect(off.states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('goes idle with nothing spoken after 8 s of silence', async () => {
    const { controller, listener, speaker, states } = await rig()
    await controller.handleSpoken({ text: 'open notepad' })
    const spoken = speaker.spoken.length
    listener.emit('timeout')
    expect(speaker.spoken).toHaveLength(spoken)
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it.each(['stop', "that's all", 'Thank you Jarvis.', 'thanks'])('ends the conversation on %j with Okay and no new window', async (said) => {
    const { controller, listener, speaker, states, agent } = await rig()
    await controller.handleSpoken({ text: 'open notepad' })
    await controller.handleSpoken({ text: said })
    expect(speaker.spoken).toEqual(['Opening Notepad.', 'Okay.'])
    expect(listener.windows).toEqual([8])
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
    expect(agent.asks).toEqual([])
  })

  it('answers the news suggestion through the operator, and the mail suggestion through the agent', async () => {
    const { controller, agent } = await rig()
    await controller.handleSpoken({ text: 'open notepad' })
    await controller.handleSpoken({ text: 'the news' })
    await controller.handleSpoken({ text: 'important mail' })
    expect(agent.asks).toHaveLength(1)
    expect(agent.asks[0]).toContain('up to 5 unread messages')
  })

  it('sends anything that is not a suggestion to the agent in the follow-up window', async () => {
    const { controller, agent } = await rig()
    await controller.handleSpoken({ text: 'open notepad' })
    await controller.handleSpoken({ text: 'something else' })
    expect(agent.asks).toEqual(['something else'])
  })
})

describe('send token and voice approval', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  async function rig(withTokens = true) {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    const speaker = new FakeSpeaker()
    const agent = new FakeAgent()
    const states: VoiceState[] = []
    const issued: string[] = []
    const controller = new VoiceController({
      listener, speaker, agent,
      ...withTokens ? {
        issueSendToken: () => { issued.push('send'); return '[AIR-SEND-0123456789abcdef]' },
        issueApprovalToken: (digest: string) => { issued.push(`approve:${digest}`); return '[AIR-APPROVE-fedcba9876543210]' },
      } : {},
      runOperator: async () => ({ spoken: 'ok' }),
      onState: (s: VoiceState) => { states.push(s) },
    })
    agent.route = 'cloud'
    return { controller, listener, speaker, agent, states, issued }
  }
  const DRAFT = 'Draft to Asha saying hi.\nCONFIRM SEND'
  const WANT = { summary: 'run Remove-Item C:/old (Clean up.)', digest: 'abc123' }

  it('puts the send token only in the prompt after the spoken yes', async () => {
    const { controller, agent, issued } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }, { reply: 'Sent to Asha.', tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    expect(agent.asks[0]).not.toMatch(/AIR-SEND/)
    expect(issued).toEqual([])
    await controller.handleSpoken({ text: 'yes' })
    expect(agent.asks[1]).toBe('Now press Send and speak one sentence saying who it went to. [AIR-SEND-0123456789abcdef]')
    expect(issued).toEqual(['send'])
  })

  it('does not issue a send token on no, and sends the plain prompt when none can be issued', async () => {
    const { controller, agent, issued } = await rig()
    agent.replies = [{ reply: DRAFT, tools: [] }]
    await controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    await controller.handleSpoken({ text: 'no' })
    expect(issued).toEqual([])
    expect(agent.asks[1]).toBe('Do not send it.')
    const bare = await rig(false)
    bare.agent.replies = [{ reply: DRAFT, tools: [] }]
    await bare.controller.handleSpoken({ text: 'send an email to Asha saying hi' })
    await bare.controller.handleSpoken({ text: 'yes' })
    expect(bare.agent.asks[1]).toBe('Now press Send and speak one sentence saying who it went to.')
  })

  it('asks the person when a tool was denied for want of approval, instead of speaking the reply', async () => {
    const { controller, speaker, agent, listener, states } = await rig()
    agent.replies = [{ reply: 'I need approval.', tools: ['pwsh'], approval: WANT }]
    await controller.handleSpoken({ text: 'clean up the old folder' })
    expect(speaker.spoken).toEqual(['It wants to run Remove-Item C:/old (Clean up.). Say yes to allow.'])
    expect(listener.listens).toBe(1)
    expect(states.at(-1)).toMatchObject({ phase: 'awake' })
  })

  it('re-prompts with the approval token bound to the digest after yes, and never before', async () => {
    const { controller, agent, issued } = await rig()
    agent.replies = [{ reply: 'I need approval.', tools: [], approval: WANT }, { reply: 'Done.', tools: [] }]
    await controller.handleSpoken({ text: 'clean up the old folder' })
    expect(agent.asks).toEqual(['clean up the old folder'])
    expect(issued).toEqual([])
    await controller.handleSpoken({ text: 'yes' })
    expect(issued).toEqual(['approve:abc123'])
    expect(agent.asks[1]).toBe('Approved. Run exactly that command again now. [AIR-APPROVE-fedcba9876543210]')
  })

  it('speaks what was refused when a request was rejected without a voice flow', async () => {
    const { controller, speaker, agent } = await rig()
    agent.replies = [{ reply: 'Sorry, I could not.', tools: [], refused: 'Install the weather bundle' }]
    await controller.handleSpoken({ text: 'install the weather bundle' })
    expect(speaker.spoken).toEqual(["I can't do that without approval. Install the weather bundle."])
  })

  it('cancels on anything but yes, and on silence, telling the model not to run it', async () => {
    const no = await rig()
    no.agent.replies = [{ reply: 'x', tools: [], approval: WANT }]
    await no.controller.handleSpoken({ text: 'clean up' })
    await no.controller.handleSpoken({ text: 'no way' })
    expect(no.speaker.spoken.at(-1)).toBe('Cancelled.')
    expect(no.agent.asks[1]).toBe('Do not run it.')
    expect(no.issued).toEqual([])
    const silent = await rig()
    silent.agent.replies = [{ reply: 'x', tools: [], approval: WANT }]
    await silent.controller.handleSpoken({ text: 'clean up' })
    await vi.advanceTimersByTimeAsync(CONFIRM_WINDOW_MS)
    expect(silent.speaker.spoken.at(-1)).toBe('Cancelled.')
    expect(silent.agent.asks[1]).toBe('Do not run it.')
  })

  it('swallows a failure of the do-not-run prompt', async () => {
    const { controller, agent, speaker } = await rig()
    agent.replies = [{ reply: 'x', tools: [], approval: WANT }]
    await controller.handleSpoken({ text: 'clean up' })
    agent.ask = async () => { throw new Error('gone') }
    await controller.handleSpoken({ text: 'no' })
    expect(speaker.spoken.at(-1)).toBe('Cancelled.')
  })

  it('cannot approve without a token source: says Cancelled and asks nothing more', async () => {
    const { controller, speaker, agent } = await rig(false)
    agent.replies = [{ reply: 'x', tools: [], approval: WANT }]
    await controller.handleSpoken({ text: 'clean up' })
    await controller.handleSpoken({ text: 'yes' })
    expect(speaker.spoken.at(-1)).toBe('Cancelled.')
    expect(agent.asks).toEqual(['clean up'])
  })
})

describe('default route and screen route', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('starts on the cloud model when the key is present, and says so', async () => {
    const { controller, agent, speaker, states } = await makeController()
    await controller.start()
    expect(agent.route).toBe('cloud')
    expect(speaker.spoken).toEqual(['Using the cloud model.'])
    expect(states.at(-1)).toMatchObject({ route: 'cloud' })
  })

  it('stays local without the key, and says so', async () => {
    const { controller, agent, speaker } = await makeController()
    agent.cloudKeyMissing = true
    await controller.start()
    expect(agent.route).toBe('local')
    expect(speaker.spoken).toEqual(['Using the local model.'])
  })

  it('keeps operator commands model-free on the cloud default, and "use local" still switches', async () => {
    const { controller, agent, speaker } = await makeController()
    await controller.start()
    await controller.handleSpoken({ text: 'what time is it' })
    expect(agent.asks).toEqual([])
    await controller.handleSpoken({ text: 'use local model' })
    expect(agent.route).toBe('local')
    expect(speaker.spoken.at(-1)).toBe('Using local model.')
  })

  it('sends a GUI command to the screen route, once', async () => {
    const { controller, agent, speaker } = await makeController()
    await controller.handleSpoken({ text: 'click the blue button' })
    expect(agent.route).toBe('screen')
    expect(agent.asks).toEqual(['click the blue button'])
    expect(speaker.spoken[0]).toBe('Screen mode on.')
    await controller.handleSpoken({ text: 'scroll down' })
    expect(agent.routeChanges).toEqual(['screen'])
  })

  it('says screen control needs the key, and asks nothing, when the key is missing', async () => {
    const { controller, agent, speaker, states } = await makeController()
    agent.cloudKeyMissing = true
    await controller.handleSpoken({ text: 'click the blue button' })
    expect(speaker.spoken).toEqual(['Screen control needs the cloud key.'])
    expect(agent.asks).toEqual([])
    expect(agent.route).toBe('local')
    expect(states.at(-1)).toMatchObject({ phase: 'idle' })
  })

  it('does not switch when a follow-up prompt happens to contain GUI words', async () => {
    const { controller, agent } = await makeController()
    agent.route = 'cloud'
    agent.replies = [{ reply: 'x', tools: [], approval: { summary: 'click the button', digest: 'd' } }]
    await controller.handleSpoken({ text: 'tell me what the date is' })
    await controller.handleSpoken({ text: 'yes' })
    expect(agent.routeChanges).toEqual([])
  })
})

describe('echo muting', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  async function rig(echoTailMs = 400) {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    const speaker = new FakeSpeaker()
    const agent = new FakeAgent()
    const states: VoiceState[] = []
    const controller = new VoiceController({
      listener, speaker, agent, followUpMs: 8000, echoTailMs,
      runOperator: async () => ({ spoken: 'Opening Notepad.' }),
      onState: (s: VoiceState) => { states.push(s) },
    })
    return { controller, listener, speaker, agent, states }
  }

  it('mutes while speaking and for the 400 ms tail, and opens the follow-up window only after the tail', async () => {
    const { controller, listener, speaker } = await rig()
    speaker.autoResolve = false
    const running = controller.handleSpoken({ text: 'open notepad' })
    await vi.advanceTimersByTimeAsync(0)
    expect(listener.mutes).toEqual([true])
    speaker.finishSpeaking()
    await vi.advanceTimersByTimeAsync(399)
    expect(listener.mutes).toEqual([true])
    expect(listener.windows).toEqual([])
    await vi.advanceTimersByTimeAsync(2)
    await running
    expect(listener.mutes).toEqual([true, false])
    expect(listener.windows).toEqual([8])
  })

  it('mutes once for back-to-back speech and unmutes after the last', async () => {
    const { controller, listener, speaker } = await rig(0)
    speaker.autoResolve = false
    const first = controller.handleSpoken({ text: 'what time is it' })
    await vi.advanceTimersByTimeAsync(0)
    expect(listener.mutes).toEqual([true])
    speaker.finishSpeaking()
    await first
    expect(listener.mutes).toEqual([true, false])
  })

  it('unmutes at once on a wake that cuts the speech off, and the cut-off speech does not unmute again', async () => {
    const { controller, listener, speaker } = await rig()
    speaker.autoResolve = false
    const running = controller.handleSpoken({ text: 'open notepad' })
    await vi.advanceTimersByTimeAsync(0)
    listener.emit('wake')
    expect(listener.mutes).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(1000)
    await running
    expect(listener.mutes).toEqual([true, false])
    speaker.autoResolve = true
    const next = controller.handleSpoken({ text: 'what time is it' })
    await vi.advanceTimersByTimeAsync(1000)
    await next
    expect(listener.mutes).toEqual([true, false, true, false])
  })

  it('stays muted until overlapping speech has all ended', async () => {
    const { controller, listener, speaker } = await rig(0)
    speaker.autoResolve = false
    const first = controller.handleSpoken({ text: 'open notepad' })
    await vi.advanceTimersByTimeAsync(0)
    const second = controller.handleSpoken({ text: 'open paint' })
    await vi.advanceTimersByTimeAsync(0)
    expect(speaker.spoken).toHaveLength(2)
    expect(listener.mutes).toEqual([true])
    speaker.finishSpeaking()
    await Promise.all([first, second])
    expect(listener.mutes).toEqual([true, false])
  })

  it('does not unmute after the tail when a wake came in during it', async () => {
    const { controller, listener } = await rig()
    const running = controller.handleSpoken({ text: 'open notepad' })
    await vi.advanceTimersByTimeAsync(100)
    listener.emit('wake')
    await vi.advanceTimersByTimeAsync(1000)
    await running
    expect(listener.mutes).toEqual([true, false])
  })

  it('unmutes when speech fails, and a wake while nothing speaks changes nothing', async () => {
    const { listener, speaker, controller } = await rig(0)
    listener.emit('wake')
    expect(listener.mutes).toEqual([])
    speaker.speak = () => Promise.reject(new Error('no audio'))
    await controller.setRoute('cloud')
    expect(listener.mutes).toEqual([true, false])
  })

  it('works with a listener that cannot mute', async () => {
    const { VoiceController } = await import('../src/core/controller.ts')
    const listener = new FakeListener()
    Object.defineProperty(listener, 'mute', { value: undefined, configurable: true })
    const speaker = new FakeSpeaker()
    const controller = new VoiceController({ listener, speaker, agent: new FakeAgent(), onState: () => undefined })
    await controller.handleSpoken({ text: 'what time is it' })
    expect(speaker.spoken).toHaveLength(1)
  })
})
