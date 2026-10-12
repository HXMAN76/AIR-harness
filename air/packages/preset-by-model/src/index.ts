/**
 * Chooses the agent preset of a new, blank session from the context window of the model selected for it.
 * A model below `smallWindowTokens` gets `smallPreset`, any other known window gets `largePreset`, and an
 * unknown window leaves upstream's default alone. The change goes through the registry's own `select`, so
 * the session log records the ordinary `agent-preset/selected` event and a resumed session rebuilds the
 * same composition. A preset the user picked, a default the user set in Settings, an explicit preset at
 * creation, and a session that already started a turn are never touched.
 *
 * @module @air/dsh-preset-by-model
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-llm'
import { errorMessage } from '@air/dsh-convention-core'

export const name = 'air-preset-by-model'
export const inject = ['agents', 'agentPresets', 'agentDefaultModel', 'llm']

/** Plugin configuration; every field is optional in YAML and resolved by {@link resolveConfig}. */
export interface Config {
  /** Turns the plugin off without removing its row. */
  enabled?: boolean
  /** A model whose context window is below this many tokens is small. */
  smallWindowTokens?: number
  /** Preset id for a small model. */
  smallPreset?: string
  /** Preset id for a model with a window at or above `smallWindowTokens`. */
  largePreset?: string
}

/** Configuration with every default applied. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly smallWindowTokens: number
  readonly smallPreset: string
  readonly largePreset: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true).description('Choose the preset from the model; false leaves upstream default selection untouched.'),
  smallWindowTokens: Schema.number().default(65536).description('A model with a context window below this many tokens is small.'),
  smallPreset: Schema.string().default('air-lean').description('Preset id used for a small model.'),
  largePreset: Schema.string().default('air').description('Preset id used for a model whose window is not small.'),
})

/**
 * Apply defaults and reject values the plugin cannot act on.
 * @param config - raw plugin configuration.
 * @returns the complete configuration.
 * @throws Error naming the offending field when a value is not usable.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? true,
    smallWindowTokens: config.smallWindowTokens ?? 65536,
    smallPreset: config.smallPreset ?? 'air-lean',
    largePreset: config.largePreset ?? 'air',
  }
  if (!Number.isSafeInteger(resolved.smallWindowTokens) || resolved.smallWindowTokens <= 0) {
    throw new Error(`${name}: smallWindowTokens must be a positive integer, got ${String(resolved.smallWindowTokens)}`)
  }
  for (const field of ['smallPreset', 'largePreset'] as const) {
    if (resolved[field].trim() === '') throw new Error(`${name}: ${field} must not be empty`)
  }
  return resolved
}

/** Provider route and model id of a selection; the reasoning effort does not change the window. */
interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** A blank session this plugin may still re-select. Membership means no explicit choice has been seen. */
interface Tracked {
  readonly agent: Agent
  /** Preset id of this plugin's own pending `select`, so its event is not mistaken for a user choice. */
  expected: string | undefined
  /** Preset the user selected while this plugin's own selection was pending; restored after that selection lands. */
  userChoice?: string
  /** Evaluations run one at a time so a later model choice cannot be overtaken by an earlier one. */
  chain: Promise<void>
}

/**
 * Register the listeners that pick the preset.
 * @param ctx - Host context that provides the agent registry, the preset registry, and the model catalogue.
 * @param config - raw plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  const tracked = new Map<string, Tracked>()
  /** True once both configured presets were found usable; false after the one warning. */
  let presetsUsable: boolean | undefined

  async function checkPresets(): Promise<boolean> {
    if (presetsUsable !== undefined) return presetsUsable
    for (const id of new Set([resolved.smallPreset, resolved.largePreset])) {
      const problem = await presetProblem(id)
      if (problem === undefined) continue
      ctx.logger.warn(`${name}: preset "${id}" is ${problem}; the preset is not chosen from the model`)
      presetsUsable = false
      return false
    }
    presetsUsable = true
    return true
  }

  async function presetProblem(id: string): Promise<string | undefined> {
    try {
      const row = await ctx.agentPresets.resolve(id)
      return row.broken === undefined ? undefined : `unusable (${row.broken})`
    } catch (error) {
      return `not registered (${errorMessage(error)})`
    }
  }

  async function windowOf(selection: ModelRoute): Promise<number | undefined> {
    try {
      return (await ctx.llm.resolveModelInfo(selection.provider, selection.model)).context?.contextWindow
    } catch (error) {
      ctx.logger.debug(`${name}: no context window for ${selection.provider}/${selection.model}: ${errorMessage(error)}`)
      return undefined
    }
  }

  async function evaluate(entry: Tracked, selection: ModelRoute): Promise<void> {
    const { agent } = entry
    const window = await windowOf(selection)
    if (window === undefined || tracked.get(agent.id) !== entry) return
    const target = window < resolved.smallWindowTokens ? resolved.smallPreset : resolved.largePreset
    if (ctx.agentPresets.composedPreset(agent.ctx) === target) return
    if (!await checkPresets() || tracked.get(agent.id) !== entry) return
    entry.expected = target
    try {
      await ctx.agentPresets.select(agent, target)
    } catch (error) {
      tracked.delete(agent.id)
      ctx.logger.warn(`${name}: could not select preset "${target}" for session ${agent.id}: ${errorMessage(error)}`)
    } finally {
      entry.expected = undefined
    }
    // The user picked while this selection was queued behind theirs; their choice must be the last one logged.
    if (entry.userChoice !== undefined) await ctx.agentPresets.select(agent, entry.userChoice)
  }

  function schedule(entry: Tracked, selection: ModelRoute): void {
    entry.chain = entry.chain.then(() => evaluate(entry, selection)).catch((error: unknown) => {
      ctx.logger.warn(`${name}: preset choice failed for session ${entry.agent.id}: ${errorMessage(error)}`)
    })
  }

  ctx.on('agent/created', ({ agent, source }) => {
    const header = agent.session.header
    // A resumed, forked, or child session carries a recorded choice; only a fresh top-level session is eligible.
    if (source !== 'startup' || header.origin !== undefined || header.parentSession !== undefined || header.isSeeded) return
    // An explicit preset at creation, or a default the user set in Settings, is the user's choice.
    if (header.agentPreset === undefined || header.agentPreset !== ctx.agentPresets.defaultId) return
    if (ctx.agentPresets.config.selectedDefault.get() !== undefined) return
    const entry: Tracked = { agent, expected: undefined, chain: Promise.resolve() }
    tracked.set(agent.id, entry)
    schedule(entry, ctx.agentDefaultModel.currentSelection())
  })

  ctx.on('session/event', (session, event) => {
    const entry = tracked.get(session.id)
    if (entry === undefined) return
    if (event.type === 'agent-preset/selected') {
      if (entry.expected === event.data.agentPreset) entry.expected = undefined
      else {
        entry.userChoice = event.data.agentPreset
        tracked.delete(session.id)
      }
    } else if (event.type === 'turn/start') {
      tracked.delete(session.id)
    } else if (event.type === 'model/selection') {
      schedule(entry, event.data)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    tracked.delete(agent.id)
  })

  ctx.effect(() => () => { tracked.clear() }, `${name}: forget tracked sessions`)
}
