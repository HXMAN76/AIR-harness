/** Drives dsh sessions through upstream's TypeScript SDK: one runtime per route, one session per conversation. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findApprovalDenial, type ApprovalDenial } from '@air/dsh-voice-approval/denial'
import { sdkHarness } from '../sdk-harness.ts'
import type { Route } from './commands.ts'
import { cloudKeyPresent, cloudKeyValue } from './home.ts'
import { REPO_ROOT, VOICE_APP_ROOT } from './paths.ts'

/** Launch options handed to the harness factory (a subset of the SDK's `DeepSeekHarnessOptions`). */
export interface HarnessOptions {
  dshBin: string
  profile: string
  patches: string[]
  dshHome: string
  cwd: string
  provider: string
  model: string
  initializeTimeoutMs: number
  env?: Record<string, string | undefined>
}

/** One session event as far as the bridge reads it. */
export interface EventLike {
  type: string
  data?: unknown
}

/** The part of `DeepSeekHarness` the bridge uses. */
export interface HarnessLike {
  session(sessionId?: string): { id: string; run(text: string): Promise<{ finalResponse: string; events: readonly EventLike[] }> }
  close(): Promise<void>
}

/** Creates a harness; the default creates an SDK `DeepSeekHarness`. */
export type HarnessFactory = (options: HarnessOptions) => HarnessLike

/** Model route table. Cloud routes call https://ollama.com/v1 (provider `ollama-cloud`) with a bearer key from the home `.env`, injected as `OLLAMA_API_KEY` for those launches. */
export const ROUTES: Record<Route, { provider: string; model: string; patches: string[]; cloud: boolean }> = {
  local: { provider: 'ollama', model: 'qwen3-8b-32k', patches: ['voice.cordis.patch.yml'], cloud: false },
  // Cloud and screen carry the Playwright browser tools (browser.cordis.patch.yml); the local route never
  // loads them, because their ~3,700 prompt tokens would crowd the 8B model's 32K context.
  cloud: { provider: 'ollama-cloud', model: 'minimax-m3.1-flash', patches: ['voice.cordis.patch.yml', 'browser.cordis.patch.yml'], cloud: true },
  screen: { provider: 'ollama-cloud', model: 'minimax-m3.1-flash', patches: ['voice.cordis.patch.yml', 'browser.cordis.patch.yml', 'screen.cordis.patch.yml'], cloud: true },
}

/** Extra per-launch patch when memory is shared with the cloud (written by the memory track). */
const MEMORY_SHARE_PATCH = 'memory-share.cordis.patch.yml'

/**
 * @param env - environment to read `AIR_VOICE_DSH_BIN` from.
 * @returns the dsh CLI entry: `AIR_VOICE_DSH_BIN` when set, else `apps/cli/lib/bin.js` under the repository root.
 */
export function defaultDshBin(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.AIR_VOICE_DSH_BIN
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
}

/** Options of {@link AgentBridge}. */
export interface AgentBridgeOptions {
  dshHome: string
  cwd: string
  dshBin?: string
  /** Directory holding the voice profile patches. */
  profileDir?: string
  /** Environment for the key presence check, passed to the runtime when given. Default: the process environment, inherited. */
  env?: Record<string, string | undefined>
  harnessFactory?: HarnessFactory
}

/** Routes voice commands to the agent runtime. */
export class AgentBridge {
  private currentRoute: Route = 'local'
  private shared = false
  private readonly harnesses = new Map<Route, HarnessLike>()
  private readonly sessions = new Map<Route, string>()
  private readonly dshBin: string
  private readonly profileDir: string
  private readonly factory: HarnessFactory

  /** @param options - runtime home, workspace, and launch overrides. */
  constructor(private readonly options: AgentBridgeOptions) {
    this.dshBin = options.dshBin ?? defaultDshBin()
    this.profileDir = options.profileDir ?? join(VOICE_APP_ROOT, 'profile')
    this.factory = options.harnessFactory ?? sdkHarness
  }

  /** The active route. */
  get route(): Route {
    return this.currentRoute
  }

  /** Whether memory is shared with the cloud model on the next launch. */
  get memoryShared(): boolean {
    return this.shared
  }

  /**
   * Switch route. A cloud route needs `OLLAMA_CLOUD_KEY` in the environment or the voice home's `.env`.
   * @param route - target route.
   * @returns ok, or `missing-key` (the route stays as it was).
   */
  setRoute(route: Route): { ok: true } | { ok: false; reason: 'missing-key' } {
    if (ROUTES[route].cloud && !this.hasCloudKey()) return { ok: false, reason: 'missing-key' }
    this.currentRoute = route
    return { ok: true }
  }

  /**
   * Run one prompt on the active route's conversation.
   * @param text - the command.
   * @returns the final response, the names of the tools called, and, when a tool was denied for lack of a spoken approval, what it wanted.
   */
  async ask(text: string): Promise<{ reply: string; tools: string[]; approval?: ApprovalDenial }> {
    const route = this.currentRoute
    const session = this.harnessFor(route).session(this.sessions.get(route))
    this.sessions.set(route, session.id)
    const result = await session.run(text)
    const tools = result.events
      .filter(event => event.type === 'tool/call')
      .map(event => (event.data as { name?: unknown } | undefined)?.name)
      .filter((name): name is string => typeof name === 'string')
    const approval = findApprovalDenial(result.events)
    return { reply: result.finalResponse, tools, ...approval === undefined ? {} : { approval } }
  }

  /** Forget the sessions; the next prompt starts a new conversation. */
  newConversation(): void {
    this.sessions.clear()
  }

  /**
   * Record whether memory is shared with the cloud; the runtimes restart so the next launch picks it up.
   * @param on - share or not.
   */
  async setMemoryShare(on: boolean): Promise<void> {
    this.shared = on
    await this.closeAll()
  }

  /** Close every runtime (the SDK has no mid-turn cancel) and start new conversations. */
  async cancel(): Promise<void> {
    await this.closeAll()
    this.sessions.clear()
  }

  /** Close every runtime. */
  async dispose(): Promise<void> {
    await this.closeAll()
  }

  private hasCloudKey(): boolean {
    return cloudKeyPresent(this.options.env ?? process.env, this.options.dshHome)
  }

  private harnessFor(route: Route): HarnessLike {
    const existing = this.harnesses.get(route)
    if (existing !== undefined) return existing
    const { provider, model, patches } = ROUTES[route]
    const files = patches.map(name => join(this.profileDir, name))
    const share = join(this.profileDir, MEMORY_SHARE_PATCH)
    if (this.shared && existsSync(share)) files.push(share)
    const cloudKey = route !== 'local' ? cloudKeyValue(this.options.env ?? process.env, this.options.dshHome) : undefined
    const harnessEnv = cloudKey === undefined ? this.options.env : {
      ...this.options.env,
      OLLAMA_API_KEY: cloudKey,
    }
    const harness = this.factory({
      dshBin: this.dshBin,
      profile: 'sdk',
      patches: files,
      dshHome: this.options.dshHome,
      cwd: this.options.cwd,
      provider,
      model,
      initializeTimeoutMs: 300_000,
      ...harnessEnv === undefined ? {} : { env: harnessEnv },
    })
    this.harnesses.set(route, harness)
    return harness
  }

  private async closeAll(): Promise<void> {
    const all = [...this.harnesses.values()]
    this.harnesses.clear()
    await Promise.all(all.map(harness => harness.close()))
  }
}
