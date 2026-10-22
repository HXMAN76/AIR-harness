/** Orchestrates the voice loop: wake → command → agent → speech. */
import type { EventEmitter } from 'node:events'
import type { Command } from './listener.ts'
import type { Lang } from './frames.ts'
import { CONFIRM_SEND, matchEmailCommand, parseVoiceCommand, rewriteForAgent, suggestionFor, needsScreen, type Route } from './commands.ts'
import { REPLY_ON_SCREEN, hasTamilScript, toSpokenText } from './speech-text.ts'
import { MetricsRecorder, type Trace } from './metrics.ts'
import { progressLabel, withElapsed, type AgentProgress } from './progress.ts'
import type { SpeechTiming } from './speaker.ts'
import { closeIntentForLabel, isCloseReference, matchOperatorIntent, runOperatorIntent, type OperatorIntent, type OperatorResult } from './operator.ts'

/** What a tool was denied for lack of: one line to speak, and the digest its approval token is bound to. */
interface ApprovalWant {
  summary: string
  digest: string
}

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
  /** While an agent turn runs: what it is doing now, such as "Running PowerShell… 12 s". */
  progress?: string
  /** The active route's conversation, once it has one; the UI offers "Open in AIR" while it is set. */
  sessionId?: string
}

/** The part of {@link import('./speaker.ts').Speaker} the controller needs. */
interface SpeakerLike {
  speak(text: string): Promise<void>
  stop(): void
  beep(): void
  readonly speaking: boolean
  /** Timing of the latest `speak` call (for latency metrics). */
  readonly lastTiming?: SpeechTiming | undefined
}

/** The part of {@link import('./agent.ts').AgentBridge} the controller needs. */
interface AgentLike {
  route: Route
  memoryShared: boolean
  sessionId?: string | undefined
  setRoute(route: Route): { ok: true } | { ok: false; reason: 'missing-key' }
  ask(text: string, onProgress?: (progress: AgentProgress) => void): Promise<{
    reply: string
    tools: string[]
    approval?: ApprovalWant
    refused?: string
    stats?: { firstEventMs?: number; promptTokens: number; outputTokens: number; steps: number }
  }>
  newConversation(): void
  setMemoryShare(on: boolean): Promise<void>
  cancel(): Promise<void>
}

/** The part of {@link import('./listener.ts').Listener} the controller needs. */
interface ListenerLike extends EventEmitter {
  setLanguage(lang: Lang): void
  /** Listen for one command without a wake word, waiting up to `seconds` for speech to start. */
  listen?(seconds?: number): void
  /** Mute while the app speaks; only a wake phrase gets through (barge-in). */
  mute?(on: boolean): void
}

/** How long a thinking turn may run before the controller says "Still working." */
const WATCHDOG_MS = 120_000

/** Tool name shown in the state for commands the operator handled. */
const OPERATOR_TOOL = 'operator'

/** Operator intents that need a spoken yes before they run. Closing an app is graceful (it asks to save), so only the lock does. */
const DESTRUCTIVE: ReadonlySet<OperatorIntent['kind']> = new Set(['lock'])

const WHICH_APP = 'Which app should I close?'

/** How long a confirmation waits for "yes". */
export const CONFIRM_WINDOW_MS = 6_000

const CONFIRM_PROMPT = 'Say yes to confirm.'
const CONFIRM_SEND_PROMPT = 'Say yes to send it.'
const ALLOW_PROMPT = 'Say yes to allow.'
const NEEDS_APPROVAL = "I can't do that without approval."
const CANCELLED = 'Cancelled.'
const CLOUD_KEY_MISSING = 'The cloud key is not set.'
const USING_CLOUD = 'Using the cloud model.'
const USING_LOCAL = 'Using the local model.'
const SCREEN_KEY_MISSING = 'Screen control needs the cloud key.'
const SCREEN_ON = 'Screen mode on.'
/** The model's reply carries this line on its own when a draft is ready and Send is not yet pressed. */
const CONFIRM_SEND_LINE = new RegExp(`^\s*${CONFIRM_SEND}\s*$`, 'm')
/** Sent to the same session after a spoken yes. */
const PRESS_SEND = 'Now press Send and speak one sentence saying who it went to.'
const DO_NOT_RUN = 'Do not run it.'
/** Sent to the same session after anything but a yes, or silence. */
const DO_NOT_SEND = 'Do not send it.'
const CONFIRM_WORDS = /^(?:yes|yeah|yep|confirm|confirmed|yes confirm|yes please|confirm it)$/

/** Spoken when the operator could not do what was asked. */
const OPERATOR_FAILED = "I couldn't do that."

/** Default follow-up window: how long the app listens without a wake word after it spoke. */
export const DEFAULT_FOLLOWUP_MS = 8_000

/**
 * @param env - environment to read `AIR_VOICE_FOLLOWUP_MS` from.
 * @returns the follow-up window in ms: the variable when it is a number of 0 or more (0 turns the mode off),
 *   else {@link DEFAULT_FOLLOWUP_MS}.
 */
export function followUpMsFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.AIR_VOICE_FOLLOWUP_MS
  const value = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_FOLLOWUP_MS
}

const OKAY = 'Okay.'
const SUGGESTIONS = "I can read your important mail, read today's news, or open an app. What would you like?"

/** @returns "Good morning.", "Good afternoon." or "Good evening." for the hour of the day. */
export function greetingFor(now: Date): string {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.'
}

/** Constructor options. */
export interface VoiceControllerDeps {
  listener: ListenerLike
  speaker: SpeakerLike
  agent: AgentLike
  /** Runs a matched operator intent; defaults to {@link runOperatorIntent}. Tests inject a fake. */
  runOperator?: (intent: OperatorIntent) => Promise<OperatorResult>
  /** Issues the one-time token that lets the next Send through; its file is what the send guard consumes. Without it Send stays locked. */
  issueSendToken?: () => string
  /** Issues the one-time token bound to a denied command's digest. Without it nothing can be approved by voice. */
  issueApprovalToken?: (digest: string) => string
  /** Milliseconds the microphone stays muted after playback ends, for the room's echo to die away; 0 for none. */
  echoTailMs?: number
  /** Follow-up window in ms (see {@link followUpMsFromEnv}); 0 or omitted turns conversation mode off. */
  followUpMs?: number
  /** Clock for the time-of-day greeting. */
  now?: () => Date
  /** Records latency spans per turn; without it nothing is persisted. */
  metrics?: MetricsRecorder
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
  private readonly followUpMs: number
  private readonly echoTailMs: number
  /** Speeches in progress, and the generation a wake bumps so that a cut-off speech does not unmute a later one. */
  private speaking = 0
  private muteEpoch = 0
  private readonly issueSendToken: (() => string) | undefined
  private readonly issueApprovalToken: ((digest: string) => string) | undefined
  private readonly now: () => Date
  private readonly metrics: MetricsRecorder
  /** The latest wake: when it was heard and when the cue was dispatched. Consumed by the next turn. */
  private wake: { at: number; ackAt: number } | undefined
  /** The latest decoded command's timing, consumed when its turn starts. */
  private heard: { receivedAt: number; decodeMs: number; audioMs: number | undefined } | undefined

  private phase: 'idle' | 'awake' | 'thinking' | 'speaking' = 'idle'
  private lang: Lang = 'en'
  private busy = false
  /** A follow-up window is open: the next speech needs no wake word. */
  private following = false
  /** The app AIR opened last this session, for "close it". */
  private lastOpened: OperatorIntent | undefined
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined
  /** A destructive operator command, or (no intent) an email draft, waiting for "yes". */
  private confirming: {
    text: string
    intent: OperatorIntent | undefined
    approval: ApprovalWant | undefined
    timer: ReturnType<typeof setTimeout> | undefined
  } | undefined

  constructor(deps: VoiceControllerDeps) {
    this.listener = deps.listener
    this.speaker = deps.speaker
    this.agent = deps.agent
    this.runOperator = deps.runOperator ?? (intent => runOperatorIntent(intent))
    this.onState = deps.onState
    this.followUpMs = deps.followUpMs ?? 0
    this.echoTailMs = deps.echoTailMs ?? 0
    this.issueSendToken = deps.issueSendToken
    this.issueApprovalToken = deps.issueApprovalToken
    this.now = deps.now ?? (() => new Date())
    this.metrics = deps.metrics ?? new MetricsRecorder()

    this.listener.on('wake', (bare?: boolean) => {
      this.handleWake()
      if (bare === true) void this.greet()
    })
    this.listener.on('command', (command: Command) => {
      void this.handleSpoken(command)
    })
    this.listener.on('timeout', () => {
      this.following = false
      this.wake = undefined
      if (this.confirming !== undefined) void this.cancelConfirmation()
      else if (this.phase === 'awake') {
        this.phase = 'idle'
        this.emit()
      }
    })

    this.emit()
  }

  /**
   * Choose the starting route and say which one: the cloud model when the cloud key is present, else the local one.
   * Operator commands (open, close, time, news) never use a model either way.
   */
  async start(): Promise<void> {
    const cloud = this.agent.setRoute('cloud')
    this.emit()
    await this.speak(cloud.ok ? USING_CLOUD : USING_LOCAL)
  }

  /**
   * The wake word was heard: cue the user, cut off speech (barge-in), and wait for the command.
   * A running turn keeps going; only a cancel gets through while it runs.
   */
  handleWake(): void {
    const wakeAt = this.metrics.now()
    this.speaker.beep()
    this.wake = { at: wakeAt, ackAt: this.metrics.now() }
    this.following = false
    // A wake cut in on the speech: listen at once and ignore the cut-off speech's own unmute.
    if (this.speaking > 0) {
      this.speaking = 0
      this.muteEpoch++
      this.listener.mute?.(false)
    }
    if (this.phase === 'speaking') {
      const bargeIn = this.metrics.begin('barge_in')
      this.speaker.stop()
      bargeIn.setSpan('barge_in', this.metrics.now() - wakeAt)
      bargeIn.label('route', this.agent.route)
      bargeIn.finish()
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
  async handleSpoken(command: { text: string; lang?: Lang; decodeMs?: number; audioMs?: number; receivedAt?: number }): Promise<void> {
    this.heard = command.decodeMs === undefined
      ? undefined
      : { receivedAt: command.receivedAt ?? this.metrics.now(), decodeMs: command.decodeMs, audioMs: command.audioMs }
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
    const followUp = this.following
    this.following = false
    await this.handleCommand(command.text, command.lang ?? this.lang, followUp)
  }

  /** A bare wake phrase: greet by the time of day, suggest what AIR can do, then listen without a wake. */
  private async greet(): Promise<void> {
    if (this.busy || this.confirming !== undefined) return
    this.wake = undefined
    const text = `${greetingFor(this.now())} ${SUGGESTIONS}`
    this.phase = 'speaking'
    this.emit({ reply: text })
    await this.speak(text)
    if (this.isSpeaking()) this.openFollowUp()
  }

  /** After a spoken reply: listen for the next request without a wake word until the window passes in silence. */
  private openFollowUp(): void {
    this.wake = undefined
    if (this.followUpMs <= 0 || this.listener.listen === undefined) {
      this.phase = 'idle'
      this.emit()
      return
    }
    this.following = true
    this.phase = 'awake'
    this.emit()
    this.listener.listen(this.followUpMs / 1000)
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

  private async handleCommand(spoken: string, lang: Lang, followUp = false): Promise<void> {
    const text = followUp && lang === 'en' ? suggestionFor(spoken) ?? spoken : spoken
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
      case 'end':
        this.phase = 'idle'
        this.emit({ transcript: spoken, reply: OKAY })
        await this.speak(OKAY)
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
        if (lang === 'en' && !browser && isCloseReference(command.text)) {
          await this.closeReference(command.text)
          break
        }
        const intent = lang === 'en' && !browser ? matchOperatorIntent(command.text) : null
        if (intent === null) await this.handleAsk(command.text, browser)
        else if (DESTRUCTIVE.has(intent.kind)) await this.askConfirmation(command.text, intent)
        else await this.handleOperator(command.text, intent)
        break
      }
    }
  }

  /** "Close it": the last app AIR opened, or a question when there is none. */
  private async closeReference(text: string): Promise<void> {
    if (this.lastOpened === undefined) {
      this.phase = 'idle'
      this.emit({ transcript: text, reply: WHICH_APP, tools: [OPERATOR_TOOL] })
      await this.speak(WHICH_APP)
      this.openFollowUp()
      return
    }
    await this.handleOperator(text, this.lastOpened)
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
  private async askConfirmation(text: string, intent: OperatorIntent | undefined, approval?: ApprovalWant): Promise<void> {
    const prompt = approval !== undefined ? `It wants to ${approval.summary}. ${ALLOW_PROMPT}` : intent === undefined ? CONFIRM_SEND_PROMPT : CONFIRM_PROMPT
    const pending: NonNullable<VoiceController['confirming']> = { text, intent, approval, timer: undefined }
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
      if (pending.approval !== undefined) {
        const token = this.issueApprovalToken?.(pending.approval.digest)
        // Without a token source nothing can be approved: say so instead of running a prompt that cannot work.
        if (token === undefined) await this.speak(CANCELLED)
        else await this.handleAsk(`Approved. Run exactly that command again now. ${token}`, false, true)
      } else if (pending.intent === undefined) {
        const token = this.issueSendToken?.()
        await this.handleAsk(token === undefined ? PRESS_SEND : `${PRESS_SEND} ${token}`, false, true)
      } else await this.handleOperator(pending.text, pending.intent)
    } else {
      await this.cancelConfirmation()
    }
  }

  private async cancelConfirmation(): Promise<void> {
    /* v8 ignore next -- a confirmation timer or answer always clears the field first; this guards re-entrant calls. */
    if (this.confirming === undefined) return
    const { text, intent, approval } = this.confirming
    this.dropConfirmation()
    this.phase = 'idle'
    this.emit({ transcript: text, reply: CANCELLED, tools: [OPERATOR_TOOL] })
    await this.speak(CANCELLED)
    if (approval !== undefined) await this.agent.ask(DO_NOT_RUN).catch(() => undefined)
    else if (intent === undefined) await this.agent.ask(DO_NOT_SEND).catch(() => undefined)
  }

  private dropConfirmation(): void {
    if (this.confirming?.timer !== undefined) clearTimeout(this.confirming.timer)
    this.confirming = undefined
  }

  /** Local fast path: no agent call; a failure is spoken and not retried through the agent. */
  private async handleOperator(text: string, intent: OperatorIntent): Promise<void> {
    const trace = this.beginTrace(intent.kind === 'news' ? 'news' : 'operator')
    let outcome = 'error'
    this.phase = 'thinking'
    this.busy = true
    let spokeReply = false
    this.emit({ transcript: text })
    try {
      const result = await this.runOperator(intent)
      trace.mark('operator_done')
      trace.between('operator', 'command_decoded', 'operator_done')
      if (intent.kind === 'open') this.lastOpened = closeIntentForLabel(intent.label) ?? this.lastOpened
      else if (intent.kind === 'close') this.lastOpened = undefined
      this.phase = 'speaking'
      this.emit({ transcript: text, reply: result.spoken, tools: [OPERATOR_TOOL] })
      trace.mark('reply')
      await this.speak(result.spoken)
      outcome = 'ok'
      // A wake that cut the reply off already made the state 'awake'; do not open a window over it.
      spokeReply = this.isSpeaking()
    } catch {
      this.phase = 'idle'
      this.emit({ transcript: text, reply: OPERATOR_FAILED, tools: [OPERATOR_TOOL], error: OPERATOR_FAILED })
      await this.speak(OPERATOR_FAILED)
    } finally {
      this.busy = false
      this.finishTrace(trace, outcome)
      if (this.phase === 'speaking') {
        this.phase = 'idle'
        this.emit()
      }
    }
    if (spokeReply) this.openFollowUp()
  }

  /**
   * Start the metrics trace of a turn: the speech-end and decode marks come from the listener's report of the command,
   * and the cue span from the wake that preceded it. Nothing here reads text.
   * @param path - which way the turn is handled: operator, news, agent, or mail.
   */
  private beginTrace(path: string): Trace {
    const trace = this.metrics.begin()
    const heard = this.heard
    this.heard = undefined
    const decodedAt = heard?.receivedAt ?? this.metrics.now()
    trace.mark('command_decoded', decodedAt)
    trace.mark('speech_end', decodedAt - (heard?.decodeMs ?? 0))
    if (heard !== undefined) {
      trace.setSpan('stt', heard.decodeMs)
      if (heard.audioMs !== undefined) trace.count('audio_ms', heard.audioMs)
    }
    const wake = this.wake
    this.wake = undefined
    if (wake !== undefined) {
      trace.setSpan('wake_to_ack', wake.ackAt - wake.at)
      trace.mark('ack', wake.ackAt)
      trace.between('speech_end_to_ack', 'speech_end', 'ack')
    }
    trace.label('path', path)
    return trace
  }

  /** Close a turn's trace: derive the reply-to-audio spans from the speaker's timing and hand it to the recorder. */
  private finishTrace(trace: Trace, outcome: string): void {
    const timing = this.speaker.lastTiming
    const replyAt = trace.at('reply')
    if (replyAt !== undefined && timing?.firstAudioAt !== undefined && timing.startedAt >= replyAt) {
      trace.mark('first_audio', timing.firstAudioAt)
      trace.between('tts_first_audio', 'reply', 'first_audio')
      trace.between('e2e', 'speech_end', 'first_audio')
    }
    trace.label('route', this.agent.route)
    trace.label('outcome', outcome)
    trace.finish()
  }

  /**
   * Run one agent turn. `browser` marks a request that needs the browser tools, which only the cloud
   * routes carry; `followUp` sends the text as written and skips the send gate.
   */
  private async handleAsk(text: string, browser = false, followUp = false): Promise<void> {
    const trace = this.beginTrace(browser ? 'mail' : 'agent')
    if (browser && this.agent.route === 'local') {
      const switched = this.agent.setRoute('cloud')
      await this.speak(switched.ok ? USING_CLOUD : CLOUD_KEY_MISSING)
      if (!switched.ok) {
        this.finishTrace(trace, 'no_key')
        this.phase = 'idle'
        this.emit()
        return
      }
    }
    // Commands that need GUI control go to the screen route, which stays active until the user switches.
    if (!followUp && !browser && this.agent.route !== 'screen' && needsScreen(text)) {
      const switched = this.agent.setRoute('screen')
      await this.speak(switched.ok ? SCREEN_ON : SCREEN_KEY_MISSING)
      if (!switched.ok) {
        this.finishTrace(trace, 'no_key')
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
    let spokeReply = false
    let approval: ApprovalWant | undefined
    let outcome = 'error'
    const startedAt = this.metrics.now()
    let current: AgentProgress = { kind: 'thinking' }
    const showProgress = (): void => {
      if (this.phase === 'thinking') this.emit({ transcript: text, progress: withElapsed(progressLabel(current), this.metrics.now() - startedAt) })
    }
    const ticker = setInterval(showProgress, 1000)

    try {
      trace.mark('agent_start')
      const result = await this.agent.ask(followUp ? text : rewriteForAgent(text), (progress) => {
        current = progress
        showProgress()
      })
      this.clearWatchdog()
      trace.mark('agent_reply')
      trace.between('agent_turn', 'command_decoded', 'agent_reply')
      const first = result.stats?.firstEventMs
      const agentStart = trace.at('agent_start')
      const decodedAt = trace.at('command_decoded')
      if (first !== undefined && agentStart !== undefined && decodedAt !== undefined) trace.setSpan('agent_first_event', agentStart - decodedAt + first)
      trace.count('prompt_tokens', result.stats?.promptTokens ?? 0)
      trace.count('output_tokens', result.stats?.outputTokens ?? 0)
      trace.count('model_calls', result.stats?.steps ?? 0)
      trace.count('tool_calls', result.tools.length)

      // A tool was denied for want of a spoken approval: ask for it instead of speaking the model's reply.
      approval = result.approval
      gated = !followUp && approval === undefined && CONFIRM_SEND_LINE.test(result.reply)
      // A request the voice profile rejected outright: say so, with what it was, instead of the model's guess.
      const refused = approval === undefined ? result.refused : undefined
      const reply = refused !== undefined
        ? `${NEEDS_APPROVAL} ${refused}.`
        : gated ? result.reply.replace(CONFIRM_SEND_LINE, '').trim() : result.reply
      const spoken = hasTamilScript(reply) ? REPLY_ON_SCREEN : toSpokenText(reply)
      this.phase = 'speaking'
      this.emit({ transcript: text, reply, tools: result.tools })

      trace.mark('reply')
      if (approval === undefined && (!gated || reply !== '')) await this.speakMuted(spoken)
      outcome = approval !== undefined ? 'approval' : gated ? 'confirm' : 'ok'
      spokeReply = !gated && approval === undefined && this.isSpeaking()
    } catch (error) {
      this.clearWatchdog()
      gated = false
      approval = undefined
      const message = error instanceof Error ? error.message : String(error)
      this.phase = 'idle'
      this.emit({ transcript: text, error: message })
      await this.speak(message)
    } finally {
      clearInterval(ticker)
      this.busy = false
      this.finishTrace(trace, outcome)
      if (this.phase === 'speaking') {
        this.phase = 'idle'
        this.emit()
      }
    }
    if (approval !== undefined) await this.askConfirmation(text, undefined, approval)
    else if (gated) await this.askConfirmation(text, undefined)
    else if (spokeReply) this.openFollowUp()
  }

  /** Whether the reply is still being spoken (a wake that cut it off changes the phase). */
  private isSpeaking(): boolean {
    return this.phase === 'speaking'
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
      await this.speakMuted(text)
    } catch {
      // Swallow speech errors — the UI already has the state.
    }
  }

  /**
   * Speak with the microphone muted (only a wake phrase gets through) until the playback and a short tail have ended,
   * so the follow-up window opens after the room's echo and never hears the app's own voice.
   */
  private async speakMuted(text: string): Promise<void> {
    const epoch = this.muteEpoch
    if (this.speaking++ === 0) this.listener.mute?.(true)
    try {
      await this.speaker.speak(text)
    } finally {
      if (epoch === this.muteEpoch) {
        if (this.echoTailMs > 0) await new Promise<void>((resolve) => { setTimeout(resolve, this.echoTailMs) })
        if (epoch === this.muteEpoch && --this.speaking === 0) this.listener.mute?.(false)
      }
    }
  }

  private emit(extra?: Partial<VoiceState>): void {
    const state: VoiceState = {
      phase: this.phase,
      route: this.agent.route,
      memoryShared: this.agent.memoryShared,
      lang: this.lang,
      ...this.agent.sessionId === undefined ? {} : { sessionId: this.agent.sessionId },
      ...extra,
    }
    this.onState(state)
  }
}
