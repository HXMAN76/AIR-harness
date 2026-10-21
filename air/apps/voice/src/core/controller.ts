/** Orchestrates the voice loop: wake → command → agent → speech. */
import type { EventEmitter } from 'node:events'
import { matchWake } from './wake.ts'
import { parseVoiceCommand, type Route } from './commands.ts'
import { toSpokenText } from './speech-text.ts'

/** One frame of the voice state machine, pushed to the UI. */
export interface VoiceState {
  phase: 'idle' | 'awake' | 'thinking' | 'speaking'
  route: Route
  transcript?: string
  reply?: string
  tools?: string[]
  error?: string
  memoryShared: boolean
}

/** The part of {@link import('./speaker.ts').Speaker} the controller needs. */
interface SpeakerLike {
  speak(text: string): Promise<void>
  stop(): void
  readonly speaking: boolean
}

/** The part of {@link import('./agent.ts').AgentBridge} the controller needs. */
interface AgentLike {
  route: Route
  memoryShared: boolean
  setRoute(route: Route): { ok: true } | { ok: false; reason: 'missing-key' }
  ask(text: string): Promise<{ reply: string; tools: string[] }>
  newConversation(): void
  setMemoryShare(on: boolean): Promise<void>
  cancel(): Promise<void>
}

/** The part of {@link import('./listener.ts').Listener} the controller needs. */
interface ListenerLike extends EventEmitter {}

/** How long the controller waits for a follow-up command after a bare wake phrase. */
const FOLLOW_UP_WINDOW_MS = 8_000

/** How long a thinking turn may run before the controller says "Still working." */
const WATCHDOG_MS = 120_000

/** Constructor options. */
export interface VoiceControllerDeps {
  listener: ListenerLike
  speaker: SpeakerLike
  agent: AgentLike
  /** Wall-clock source; defaults to `Date.now`. Tests inject a fake. */
  now?: () => number
  /** Called on every state change. */
  onState: (state: VoiceState) => void
}

/**
 * The voice state machine.
 * Wires the listener's segments to the agent through the command parser,
 * speaking replies and tracking the active route.
 */
export class VoiceController {
  private readonly listener: ListenerLike
  private readonly speaker: SpeakerLike
  private readonly agent: AgentLike
  private readonly now: () => number
  private readonly onState: (state: VoiceState) => void

  private phase: 'idle' | 'awake' | 'thinking' | 'speaking' = 'idle'
  private wokeAt = 0
  private busy = false
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: VoiceControllerDeps) {
    this.listener = deps.listener
    this.speaker = deps.speaker
    this.agent = deps.agent
    this.now = deps.now ?? (() => Date.now())
    this.onState = deps.onState

    this.listener.on('segment', (seg: { text: string; durationMs: number }) => {
      void this.handleSegment(seg)
    })

    this.emit()
  }

  /**
   * Process one speech segment.
   * Called by the listener's segment handler and exposed for direct testing.
   */
  async handleSegment(seg: { text: string }): Promise<void> {
    const match = matchWake(seg.text)
    if (!match.wake) {
      // Not a wake phrase — check if we're in the awake follow-up window
      if (this.phase === 'awake' && this.now() - this.wokeAt <= FOLLOW_UP_WINDOW_MS) {
        await this.handleCommand(seg.text)
      }
      // Otherwise ignore (mid-sentence or random speech)
      return
    }

    // Wake phrase detected
    if (this.phase === 'speaking') {
      this.speaker.stop()
      this.clearWatchdog()
    }

    if (this.phase === 'thinking' || this.busy) {
      // While thinking, only cancel gets through
      const command = parseVoiceCommand(match.command)
      if (command.kind === 'cancel') {
        await this.handleCancel()
      } else if (match.command !== '') {
        await this.speak("I'm still on the last one.")
      }
      return
    }

    if (match.command === '') {
      // Bare wake — go awake and wait for the command
      this.phase = 'awake'
      this.wokeAt = this.now()
      this.emit()
      return
    }

    // Wake with command — handle it
    await this.handleCommand(match.command)
  }

  private async handleCommand(text: string): Promise<void> {
    const command = parseVoiceCommand(text)
    switch (command.kind) {
      case 'route':
        await this.handleRoute(command.route)
        break
      case 'new-conversation':
        this.agent.newConversation()
        this.phase = 'idle'
        this.emit()
        break
      case 'cancel':
        await this.handleCancel()
        break
      case 'memory-share':
        await this.agent.setMemoryShare(command.on)
        this.phase = 'idle'
        this.emit()
        break
      case 'ask':
        await this.handleAsk(command.text)
        break
    }
  }

  private async handleRoute(route: Route): Promise<void> {
    const result = this.agent.setRoute(route)
    if (!result.ok) {
      await this.speak('The cloud key is not set.')
      this.phase = 'idle'
      this.emit()
      return
    }
    const messages: Record<Route, string> = {
      local: 'Using local model.',
      cloud: 'Using the cloud model.',
      screen: 'Screen mode on.',
    }
    await this.speak(messages[route])
    this.phase = 'idle'
    this.emit()
  }

  private async handleCancel(): Promise<void> {
    this.clearWatchdog()
    this.speaker.stop()
    await this.agent.cancel()
    this.phase = 'idle'
    this.busy = false
    this.emit()
  }

  private async handleAsk(text: string): Promise<void> {
    this.phase = 'thinking'
    this.busy = true
    this.emit({ transcript: text })

    this.startWatchdog()

    try {
      const result = await this.agent.ask(text)
      this.clearWatchdog()

      const spoken = toSpokenText(result.reply)
      this.phase = 'speaking'
      this.emit({ transcript: text, reply: result.reply, tools: result.tools })

      await this.speaker.speak(spoken)
    } catch (error) {
      this.clearWatchdog()
      const message = error instanceof Error ? error.message : String(error)
      this.phase = 'idle'
      this.emit({ transcript: text, error: message })
      await this.speak(message)
    } finally {
      this.busy = false
      if (this.phase !== 'idle') {
        this.phase = 'idle'
        this.emit()
      }
    }
  }

  private startWatchdog(): void {
    this.clearWatchdog()
    this.watchdogTimer = setTimeout(() => {
      void this.speak('Still working.')
    }, WATCHDOG_MS)
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== undefined) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = undefined
    }
  }

  private async speak(text: string): Promise<void> {
    try {
      await this.speaker.speak(text)
    } catch {
      // Swallow speech errors — the UI already has the state.
    }
  }

  private emit(extra?: Partial<VoiceState>): void {
    const state: VoiceState = {
      phase: this.phase,
      route: this.agent.route,
      memoryShared: this.agent.memoryShared,
      ...extra,
    }
    this.onState(state)
  }
}
