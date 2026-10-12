/**
 * Keeps a reasoning-effort pick in the session. Upstream's Host saves every model pick with
 * `agentDefaultModel.saveSelection`, which rewrites the whole `agent-default-model` row with the picked
 * provider, model, and effort, so a one-off effort pick would become the default of every new session.
 * This plugin replaces that method on the service instance with a wrapper that saves the picked provider
 * and model but keeps the effort configured in the row. The session still records the pick in its own
 * `model/selection` event and uses it for its requests.
 *
 * @module @air/dsh-effort-session-only
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'

export const name = 'air-effort-session-only'
export const inject = ['agentDefaultModel']

/** Plugin configuration. */
export interface Config {
  /** Turns the plugin off without removing its row. */
  enabled?: boolean
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true).description('Keep a reasoning-effort pick out of the saved default; false restores upstream behavior.'),
})

/** The service method that the wrapper replaces. */
type SaveSelection = (next: ModelSelection) => Promise<void>

/** The service as seen by the wrapper: the method being replaced and the read of the configured default. */
interface DefaultModelService {
  saveSelection: SaveSelection
  currentSelection: () => ModelSelection
}

/** Whether a property value is a callable `saveSelection` implementation. */
function isSaveSelection(value: unknown): value is SaveSelection {
  return typeof value === 'function'
}

/**
 * Replace `saveSelection` on the `agentDefaultModel` service instance for the lifetime of this plugin.
 * Cordis hands out the service through a per-context proxy; an assignment through it lands on the shared
 * instance, so the Host's later call from its own context reaches the wrapper.
 * @param ctx - Host context that provides `agentDefaultModel`.
 * @param config - raw plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const service: DefaultModelService = ctx.agentDefaultModel
  ctx.effect(() => {
    // The own property, if another plugin set one; otherwise the prototype method the class declares.
    const ownDescriptor = Object.getOwnPropertyDescriptor(service, 'saveSelection')
    const earlier = ownDescriptor !== undefined && isSaveSelection(ownDescriptor.value) ? ownDescriptor.value : undefined
    service.saveSelection = function (this: DefaultModelService, next: ModelSelection): Promise<void> {
      const { reasoningEffort } = this.currentSelection()
      const kept: ModelSelection = {
        provider: next.provider,
        model: next.model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
      return earlier === undefined
        ? AgentDefaultModelConfig.prototype.saveSelection.call(this, kept)
        : earlier.call(this, kept)
    }
    return () => {
      if (ownDescriptor === undefined) Reflect.deleteProperty(service, 'saveSelection')
      else Object.defineProperty(service, 'saveSelection', ownDescriptor)
    }
  })
}
