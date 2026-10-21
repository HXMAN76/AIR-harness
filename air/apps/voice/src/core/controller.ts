/** Orchestrates the voice loop: wake → command → agent → speech. */
import type { EventEmitter } from 'node:events'
import type { Command } from './listener.ts'
import type { Lang } from './frames.ts'
import { CONFIRM_SEND, matchEmailCommand, parseVoiceCommand, rewriteForAgent, type Route } from './commands.ts'
import { REPLY_ON_SCREEN, hasTamilScript, toSpokenText } from './speech-text.ts'
import { matchOperatorIntent, runOperatorIntent, type OperatorIntent, type OperatorResult } from './operator.ts'

/** One frame of the voice state machine, pushed to the UI. */
export interface VoiceState {
  phase: 'idle' | 'awake' | 'thinking' | 'speaking'
  route: Route
  transcript?: string
  reply?: string
  tools?: string[]
  error?: string
  memoryShared: boolean
  /** Language of the active recogniser. */
  lang: Lang
}

/** The part of {@link import('./speaker.ts').Speaker} the controller needs. */
interface SpeakerLike {
  speak(text: string): Promise<void>
  stop(): void
  beep(): void
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
interface ListenerLike extends EventEmitter {
  setLanguage(lang: Lang): void
  /** Listen for one command without a wake word. */
  listen?(): void
}

/** How long a thinking turn may run before the controller says "Still working." */
const WATCHDOG_MS = 120_000

/** Tool name shown in the state for commands the operator handled. */
const OPERATOR_TOOL = 'operator'

/** Operator intents that need a spoken yes before they run. */
const DESTRUCTIVE: ReadonlySet<OperatorIntent['kind']> = new Set(['close', 'lock'])

/** How long a confirmation waits for "yes". */
export const CONFIRM_WINDOW_MS = 6_000

const CONFIRM_PROMPT = 'Say yes to confirm.'
const CONFIRM_SEND_PROMPT = 'Say yes to send it.'
const CANCELLED = 'Cancelled.'
const CLOUD_KEY_MISSING = 'The cloud key is not set.'
const USING_CLOUD = 'Using the cloud model.'
/** The model's reply carries this line on its own when a draft is ready and Send is not yet pressed. */
const CONFIRM_SEND_LINE = new RegExp(`^\s*${CONFIRM_SEND}\s*$`, 'm')
/** Sent to the same session after a spoken yes. */
const PRESS_SEND = 'Now press Send and speak one sentence saying who it went to.'
/** Sent to the same session after anything but a yes, or silence. */
const DO_NOT_SEND = 'Do not send it.'
const CONFIRM_WORDS = /^(?:yes|yeah|yep|confirm|confirmed|yes confirm|yes please|confirm it)$/

/** Spoken when the operator could not do what was asked. */
const OPERATOR_FAILED = "I couldn't do that."

/** Constructor options. */
export interface VoiceControllerDeps {
  listener: ListenerLike
  speaker: SpeakerLike
  agent: AgentLike
  /** Runs a matched operator intent; defaults to {@link runOperatorIntent}. Tests inject a fake. */
  runOperator?: (intent: OperatorIntent) => Promise<OperatorResult>
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
  private readonly runOperator: (intent: OperatorIntent) => Promise<OperatorResult>
  private readonly onState: (state: VoiceState) => void

  private phase: 'idle' | 'awake' | 'thinking' | 'speaking' = 'idle'
  private lang: Lang = 'en'
  private busy = false
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined
  /** A destructive operator command, or (no intent) an email draft, waiting for "yes". */
  private confirming: { text: string; intent: OperatorIntent | undefined; timer: ReturnType<typeof setTimeout> | undefined } | undefined

  constructor(deps: VoiceControllerDeps) {
    this.listener = deps.listener
    this.speaker = deps.speaker
    this.agent = deps.agent
    this.runOperator = deps.runOperator ?? (intent => runOperatorIntent(intent))
    this.onState = deps.onState

    this.listener.on('wake', () => {
      this.handleWake()
    })
    this.listener.on('command', (command: Command) => {
      void this.handleSpoken(command)
    })
    this.listener.on('timeout', () => {
      if (this.confirming !== undefined) void this.cancelConfirmation()
      else if (this.phase === 'awake') {
        this.phase = 'idle'
        this.emit()
      }
    })

    this.emit()
  }

  /**
   * The wake word was heard: cue the user, cut off speech (barge-in), and wait for the command.
   * A running turn keeps going; only a cancel gets through while it runs.
   */
  handleWake(): void {
    this.speaker.beep()
    if (this.phase === 'speaking') {
      this.speaker.stop()
      this.clearWatchdog()
      this.busy = false
    } else if (this.phase === 'thinking' || this.busy) return
    this.phase = 'awake'
    this.emit()
  }

  /**
   * Process the command spoken after a wake.
   * Called by the listener's command handler and exposed for direct testing.
   */
  async handleSpoken(command: { text: string; lang?: Lang }): Promise<void> {
    if (this.confirming !== undefined) {
      await this.answerConfirmation(command.text)
      return
    }
    if (this.phase === 'thinking' || this.busy) {
      // While thinking, only cancel gets through
      if (parseVoiceCommand(command.text).kind === 'cancel') await this.handleCancel()
      else await this.speak("I'm still on the last one.")
      return
    }
    await this.handleCommand(command.text, command.lang ?? this.lang)
  }

  /**
   * Switch the active route from a UI click (not voice).
   * Speaks the confirmation and returns to idle.
   * Ignored while the agent is mid-turn (thinking).
   */
  async setRoute(route: Route): Promise<void> {
    if (this.phase === 'thinking') return
    await this.handleRoute(route)
  }

  /**
   * Toggle memory sharing from a UI click (not voice).
   */
  async setMemoryShare(on: boolean): Promise<void> {
    await this.agent.setMemoryShare(on)
    this.emit()
  }

  private async handleCommand(text: string, lang: Lang): Promise<void> {
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
      case 'language':
        await this.handleLanguage(command.lang)
        break
      case 'memory-share':
        await this.agent.setMemoryShare(command.on)
        this.phase = 'idle'
        this.emit()
        break
      case 'ask': {
        // The operator's patterns are English; Tamil goes to the agent.
        // Email requests go to the browser tools, so they skip the operator's "open gmail" fast path.
        const browser = matchEmailCommand(command.text) !== null
        const intent = lang === 'en' && !browser ? matchOperatorIntent(command.text) : null
        if (intent === null) await this.handleAsk(command.text, browser)
        else if (DESTRUCTIVE.has(intent.kind)) await this.askConfirmation(command.text, intent)
        else await this.handleOperator(command.text, intent)
        break
      }
    }
  }

  private async handleRoute(route: Route): Promise<void> {
    const result = this.agent.setRoute(route)
    if (!result.ok) {
      await this.speak(CLOUD_KEY_MISSING)
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

  private async handleLanguage(lang: Lang): Promise<void> {
    this.lang = lang
    this.listener.setLanguage(lang)
    await this.speak(lang === 'ta' ? 'Tamil mode.' : 'English mode.')
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

  /** Ask for a spoken yes before a destructive command; the follow-up needs no wake word. */
  private async askConfirmation(text: string, intent: OperatorIntent | undefined): Promise<void> {
    const prompt = intent === undefined ? CONFIRM_SEND_PROMPT : CONFIRM_PROMPT
    const pending: NonNullable<VoiceController['confirming']> = { text, intent, timer: undefined }
    this.confirming = pending
    this.phase = 'speaking'
    this.emit({ transcript: text, reply: prompt, tools: [OPERATOR_TOOL] })
    await this.speak(prompt)
    if (this.confirming !== pending) return
    this.phase = 'awake'
    this.emit({ transcript: text })
    pending.timer = setTimeout(() => {
      void this.cancelConfirmation()
    }, CONFIRM_WINDOW_MS)
    this.listener.listen?.()
  }

  private async answerConfirmation(spoken: string): Promise<void> {
    const pending = this.confirming
    /* v8 ignore next -- handleSpoken only routes here while a confirmation is pending; a concurrent drop cannot interleave. */
    if (pending === undefined) return
    const answer = spoken.toLowerCase().replaceAll(/[^a-z ]/g, '').trim()
    if (CONFIRM_WORDS.test(answer)) {
      this.dropConfirmation()
      if (pending.intent === undefined) await this.handleAsk(PRESS_SEND, false, true)
      else await this.handleOperator(pending.text, pending.intent)
    } else {
      await this.cancelConfirmation()
    }
  }

  private async cancelConfirmation(): Promise<void> {
    /* v8 ignore next -- a confirmation timer or answer always clears the field first; this guards re-entrant calls. */
    if (this.confirming === undefined) return
    const { text, intent } = this.confirming
    this.dropConfirmation()
    this.phase = 'idle'
    this.emit({ transcript: text, reply: CANCELLED, tools: [OPERATOR_TOOL] })
    await this.speak(CANCELLED)
    if (intent === undefined) await this.agent.ask(DO_NOT_SEND).catch(() => undefined)
  }

  private dropConfirmation(): void {
    if (this.confirming?.timer !== undefined) clearTimeout(this.confirming.timer)
    this.confirming = undefined
  }

  /** Local fast path: no agent call; a failure is spoken and not retried through the agent. */
  private async handleOperator(text: string, intent: OperatorIntent): Promise<void> {
    this.phase = 'thinking'
    this.busy = true
    this.emit({ transcript: text })
    try {
      const result = await this.runOperator(intent)
      this.phase = 'speaking'
      this.emit({ transcript: text, reply: result.spoken, tools: [OPERATOR_TOOL] })
      await this.speak(result.spoken)
    } catch {
      this.phase = 'idle'
      this.emit({ transcript: text, reply: OPERATOR_FAILED, tools: [OPERATOR_TOOL], error: OPERATOR_FAILED })
      await this.speak(OPERATOR_FAILED)
    } finally {
      this.busy = false
      if (this.phase === 'speaking') {
        this.phase = 'idle'
        this.emit()
      }
    }
  }

  /**
   * Run one agent turn. `browser` marks a request that needs the browser tools, which only the cloud
   * routes carry; `followUp` sends the text as written and skips the send gate.
   */
  private async handleAsk(text: string, browser = false, followUp = false): Promise<void> {
    if (browser && this.agent.route === 'local') {
      const switched = this.agent.setRoute('cloud')
      await this.speak(switched.ok ? USING_CLOUD : CLOUD_KEY_MISSING)
      if (!switched.ok) {
        this.phase = 'idle'
        this.emit()
        return
      }
    }
    this.phase = 'thinking'
    this.busy = true
    this.emit({ transcript: text })

    this.startWatchdog()
    let gated = false

    try {
      const result = await this.agent.ask(followUp ? text : rewriteForAgent(text))
      this.clearWatchdog()

      gated = !followUp && CONFIRM_SEND_LINE.test(result.reply)
      const reply = gated ? result.reply.replace(CONFIRM_SEND_LINE, '').trim() : result.reply
      const spoken = hasTamilScript(reply) ? REPLY_ON_SCREEN : toSpokenText(reply)
      this.phase = 'speaking'
      this.emit({ transcript: text, reply, tools: result.tools })

      if (!gated || reply !== '') await this.speaker.speak(spoken)
    } catch (error) {
      this.clearWatchdog()
      gated = false
      const message = error instanceof Error ? error.message : String(error)
      this.phase = 'idle'
      this.emit({ transcript: text, error: message })
      await this.speak(message)
    } finally {
      this.busy = false
      if (this.phase === 'speaking') {
        this.phase = 'idle'
        this.emit()
      }
    }
    if (gated) await this.askConfirmation(text, undefined)
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
      lang: this.lang,
      ...extra,
    }
    this.onState(state)
  }
}
