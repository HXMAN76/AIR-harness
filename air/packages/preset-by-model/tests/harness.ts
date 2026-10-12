import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import LlmRuntime, {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'

/** Context windows by `provider/model`; a missing entry makes the stub adapter report no window. */
export const WINDOWS: Readonly<Record<string, number | undefined>> = {
  'local/small': 32768,
  'local/edge': 65535,
  'local/exact': 65536,
  'cloud/big': 200000,
  'cloud/unknown': undefined,
}

/** Adapter that answers model-information lookups from {@link WINDOWS} and never streams. */
export class StubAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (model === 'broken') return Promise.reject(new Error('lookup failed'))
    const contextWindow = WINDOWS[`${provider}/${model}`]
    return Promise.resolve({
      provider, id: model, name: model, ...contextWindow === undefined ? {} : { context: { contextWindow } },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('the stub adapter does not stream')
  }
}

/** Two stub presets with no child plugins, enough for the registry to select between them. */
export const PRESETS = ['air-lean', 'air'] as const

export interface World {
  readonly ctx: Context
  /** Create a blank top-level session the way the Host does, composed from `preset` (default: the registry default). */
  readonly open: (id: string, preset?: string) => Promise<Agent>
}

export interface WorldOptions {
  /** Preset ids to register; default {@link PRESETS}. */
  readonly presets?: readonly string[]
  /** Registry `default`; default `air-lean`. */
  readonly registryDefault?: string
  /** User-chosen default from Settings (`selectedDefault`). */
  readonly selectedDefault?: string
  /** Default model route. */
  readonly model?: { provider: string; model: string }
}

/**
 * Build the upstream services the plugin consumes, without mounting the plugin.
 * @param options - presets, registry default, and default model.
 * @returns the context and a session opener.
 */
export async function buildWorld(options: WorldOptions = {}): Promise<World> {
  const ctx = new Context()
  ctx.baseUrl = new URL('./', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['local', 'cloud'], new StubAdapter())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, {
    default: options.registryDefault ?? 'air-lean',
    ...options.selectedDefault === undefined ? {} : { selectedDefault: options.selectedDefault },
  })
  await ctx.plugin(AgentDefaultModel, options.model ?? { provider: 'local', model: 'small' })
  for (const id of options.presets ?? PRESETS) {
    await ctx.plugin({
      inject: ['agentPresets'],
      async* apply(child: Context) { yield await child.agentPresets.register({ id, plugins: [] }) },
    })
  }
  const open = async (id: string, preset?: string): Promise<Agent> => {
    const chosen = preset ?? ctx.agentPresets.defaultId
    const handle = await ctx.agents.create({
      sessionId: SessionId(id),
      meta: { agentPreset: chosen },
      setup: async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, chosen) },
    })
    return handle.agent
  }
  return { ctx, open }
}
