import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import * as presetByModel from '../src/index.ts'
import { buildWorld, type World, type WorldOptions } from './harness.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(config: presetByModel.Config = {}, options: WorldOptions = {}) {
  const world = await buildWorld(options)
  contexts.push(world.ctx)
  const warn = vi.spyOn(world.ctx.logger, 'warn')
  const select = vi.spyOn(world.ctx.agentPresets, 'select')
  const lookup = vi.spyOn(world.ctx.llm, 'resolveModelInfo')
  const plugin = await world.ctx.plugin(presetByModel, config)
  return { ...world, warn, select, lookup, plugin, ours: () => warn.mock.calls.map(call => String(call[0])).filter(text => text.startsWith('air-preset-by-model')) }
}

/** The preset the registry bound to the agent. */
function composed(world: World, agent: Agent): string | undefined {
  return world.ctx.agentPresets.composedPreset(agent.ctx)
}

/** Select a model the way the Host does: a `model/selection` event on the blank session. */
function pickModel(agent: Agent, provider: string, model: string): void {
  agent.session.append('model/selection', { provider, model })
}

function logged(agent: Agent): string[] {
  return agent.session.snapshotEvents().map(event => event.type)
}

/** Let every queued continuation of the plugin's evaluation run; the stub services settle in microtasks. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 50; tick += 1) await Promise.resolve()
  await new Promise<void>((done) => { setImmediate(done) })
}

describe('new session with the default model', () => {
  it('keeps the lean default for a small window without selecting anything', async () => {
    const world = await setup()
    const agent = await world.open('small')
    await flush()
    expect(world.lookup).toHaveBeenCalledWith('local', 'small')
    expect(composed(world, agent)).toBe('air-lean')
    expect(world.select).not.toHaveBeenCalled()
    expect(logged(agent)).not.toContain('agent-preset/selected')
  })

  it('selects the full preset for a large window and logs the ordinary selection event', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    const agent = await world.open('large')
    await vi.waitFor(() => { expect(composed(world, agent)).toBe('air') })
    expect(logged(agent)).toContain('agent-preset/selected')
    expect(world.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')).toBe('air')
  })

  it('treats a window equal to the threshold as large and a smaller one as small', async () => {
    const exact = await setup({}, { model: { provider: 'local', model: 'exact' } })
    const large = await exact.open('exact')
    await vi.waitFor(() => { expect(composed(exact, large)).toBe('air') })
    const edge = await setup({}, { model: { provider: 'local', model: 'edge' } })
    const small = await edge.open('edge')
    await flush()
    expect(composed(edge, small)).toBe('air-lean')
  })

  it('honours custom threshold and preset ids', async () => {
    const world = await setup(
      { smallWindowTokens: 10000, smallPreset: 'air', largePreset: 'air-lean' },
      { registryDefault: 'air' },
    )
    const agent = await world.open('custom')
    await vi.waitFor(() => { expect(composed(world, agent)).toBe('air-lean') })
  })

  it('leaves the default untouched when the window is unknown', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'unknown' } })
    const agent = await world.open('unknown')
    await flush()
    expect(world.lookup).toHaveBeenCalled()
    expect(world.select).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air-lean')
  })
})

describe('model chosen in the composer', () => {
  it('follows the model while the session is blank, in both directions', async () => {
    const world = await setup()
    const agent = await world.open('follow')
    pickModel(agent, 'cloud', 'big')
    await vi.waitFor(() => { expect(composed(world, agent)).toBe('air') })
    pickModel(agent, 'local', 'small')
    await vi.waitFor(() => { expect(composed(world, agent)).toBe('air-lean') })
  })

  it('applies back-to-back model choices in order', async () => {
    const world = await setup()
    const agent = await world.open('order')
    pickModel(agent, 'cloud', 'big')
    pickModel(agent, 'local', 'small')
    await vi.waitFor(() => { expect(world.select).toHaveBeenCalledTimes(2) })
    await flush()
    expect(composed(world, agent)).toBe('air-lean')
  })

  it('keeps the preset when the new model has no window, the lookup fails, or the provider is unknown', async () => {
    const world = await setup()
    const agent = await world.open('unknown-pick')
    pickModel(agent, 'cloud', 'big')
    await vi.waitFor(() => { expect(composed(world, agent)).toBe('air') })
    pickModel(agent, 'cloud', 'unknown')
    pickModel(agent, 'local', 'broken')
    pickModel(agent, 'nowhere', 'anything')
    await vi.waitFor(() => { expect(world.lookup).toHaveBeenCalledTimes(5) })
    await flush()
    expect(world.select).toHaveBeenCalledTimes(1)
    expect(composed(world, agent)).toBe('air')
    expect(world.warn).not.toHaveBeenCalled()
  })
})

describe('explicit choices win', () => {
  it('stops after the user picks a preset', async () => {
    const world = await setup()
    const agent = await world.open('picked')
    await world.ctx.agentPresets.select(agent, 'air')
    await flush()
    world.select.mockClear()
    world.lookup.mockClear()
    pickModel(agent, 'local', 'small')
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
    expect(world.select).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air')
  })

  it('stops after a pick that arrives while the plugin evaluates', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    const agent = await world.open('race')
    await world.ctx.agentPresets.select(agent, 'air-lean')
    await flush()
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(composed(world, agent)).toBe('air-lean')
  })

  it('does not act on a preset requested at creation that differs from the default', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    const agent = await world.open('explicit', 'air')
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air')
  })

  it('does not act when the user set a default in Settings', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' }, selectedDefault: 'air-lean' })
    const agent = await world.open('settings-default')
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air-lean')
  })

  it('does not act on a session without a recorded preset, a subagent, a fork, or a seeded log', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    const parent = await world.open('parent', 'air')
    const setup2 = async (agentCtx: Context) => { await world.ctx.agentPresets.mount(agentCtx, 'air-lean') }
    await world.ctx.agents.create({ sessionId: SessionId('no-preset'), setup: setup2 })
    await world.ctx.agents.create({
      sessionId: SessionId('child'), parentAgent: parent, setup: setup2, meta: { origin: 'subagent', agentPreset: 'air-lean' },
    })
    await world.ctx.agents.create({
      sessionId: SessionId('fork'), setup: setup2, meta: { parentSession: parent.id, agentPreset: 'air-lean' },
    })
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
  })

  it('keeps following the model across unrelated events', async () => {
    const world = await setup()
    const agent = await world.open('unrelated')
    await flush()
    agent.session.append('session/title', { title: 'Hello', messageSeqs: [], source: { kind: 'fallback' } })
    pickModel(agent, 'cloud', 'big')
    await vi.waitFor(() => { expect(composed(world, agent)).toBe('air') })
  })

  it('does not act on a seeded session', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    await world.ctx.agents.create({
      sessionId: SessionId('seeded'),
      meta: { agentPreset: 'air-lean', isSeeded: true },
      inheritedEventCount: SessionLogOffset(1),
      seed: [{ type: 'model/selection', seq: SessionSeq(0), time: 0, data: { provider: 'local', model: 'small' } }],
      setup: async (agentCtx: Context) => { await world.ctx.agentPresets.mount(agentCtx, 'air-lean') },
    })
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
  })

  it('stops tracking once a turn starts', async () => {
    const world = await setup()
    const agent = await world.open('started')
    await flush()
    agent.session.append('turn/start', { turn: 1 })
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(world.select).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air-lean')
  })

  it('forgets a disposed session', async () => {
    const world = await setup()
    const handle = await world.ctx.agents.create({
      sessionId: SessionId('gone'),
      meta: { agentPreset: 'air-lean' },
      setup: async (agentCtx: Context) => { await world.ctx.agentPresets.mount(agentCtx, 'air-lean') },
    })
    await flush()
    const { session } = handle.agent
    await handle.dispose()
    session.append('model/selection', { provider: 'cloud', model: 'big' })
    await flush()
    expect(world.select).not.toHaveBeenCalled()
  })
})

describe('preset availability', () => {
  it('warns once, names the missing preset, and does nothing', async () => {
    const world = await setup({ largePreset: 'air-full' }, { model: { provider: 'cloud', model: 'big' } })
    const first = await world.open('missing-1')
    const second = await world.open('missing-2')
    pickModel(second, 'cloud', 'big')
    await flush()
    expect(world.warn).toHaveBeenCalledTimes(1)
    expect(String(world.warn.mock.calls[0]?.[0])).toContain('preset "air-full" is not registered')
    expect(composed(world, first)).toBe('air-lean')
    expect(composed(world, second)).toBe('air-lean')
    expect(world.select).not.toHaveBeenCalled()
  })

  it('warns when a configured preset failed to mount', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' }, presets: ['air-lean'] })
    await world.ctx.plugin({
      inject: ['agentPresets'],
      async* apply(child: Context) {
        yield await child.agentPresets.register({ id: 'air', plugins: [{ name: 'missing-preset-plugin-for-test' }] })
      },
    })
    await world.open('broken')
    await flush()
    expect(world.ours()).toHaveLength(1)
    expect(world.ours()[0]).toContain('preset "air" is unusable')
    expect(world.select).not.toHaveBeenCalled()
  })

  it('checks a preset that is already the target without a warning', async () => {
    const world = await setup({ largePreset: 'air-lean' }, { model: { provider: 'cloud', model: 'big' } })
    await world.open('same')
    await flush()
    expect(world.warn).not.toHaveBeenCalled()
    expect(world.select).not.toHaveBeenCalled()
  })

  it('warns with the session and cause when selecting fails, then stops tracking it', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    world.select.mockRejectedValueOnce(new Error('boom'))
    const agent = await world.open('select-fails')
    await vi.waitFor(() => { expect(world.warn).toHaveBeenCalledTimes(1) })
    expect(String(world.warn.mock.calls[0]?.[0])).toContain('could not select preset "air" for session select-fails: boom')
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(world.select).toHaveBeenCalledTimes(1)
  })

  it('warns when an evaluation itself fails', async () => {
    const world = await setup({}, { model: { provider: 'cloud', model: 'big' } })
    vi.spyOn(world.ctx.agentPresets, 'composedPreset').mockImplementationOnce(() => { throw new Error('registry gone') })
    await world.open('eval-fails')
    await vi.waitFor(() => { expect(world.warn).toHaveBeenCalledTimes(1) })
    expect(String(world.warn.mock.calls[0]?.[0])).toContain('preset choice failed for session eval-fails: registry gone')
  })
})

describe('configuration and lifecycle', () => {
  it('does nothing when disabled', async () => {
    const world = await setup({ enabled: false }, { model: { provider: 'cloud', model: 'big' } })
    const agent = await world.open('disabled')
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air-lean')
  })

  it('rejects unusable values with the field name', () => {
    expect(() => presetByModel.resolveConfig({ smallWindowTokens: 0 })).toThrow('smallWindowTokens must be a positive integer')
    expect(() => presetByModel.resolveConfig({ smallWindowTokens: 1.5 })).toThrow('smallWindowTokens')
    expect(() => presetByModel.resolveConfig({ smallPreset: ' ' })).toThrow('smallPreset must not be empty')
    expect(() => presetByModel.resolveConfig({ largePreset: '' })).toThrow('largePreset must not be empty')
    expect(presetByModel.resolveConfig({})).toEqual({
      enabled: true, smallWindowTokens: 65536, smallPreset: 'air-lean', largePreset: 'air',
    })
  })

  it('fails the plugin load on a bad value', async () => {
    const world = await buildWorld()
    contexts.push(world.ctx)
    const failed = vi.spyOn(world.ctx.logger, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(world.ctx.logger, 'error').mockImplementation(() => {})
    await world.ctx.plugin(presetByModel, { smallWindowTokens: -1 }).then(() => {}, () => {})
    const agent = await world.open('bad-config')
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(failed.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0)
    expect(world.ctx.agentPresets.composedPreset(agent.ctx)).toBe('air-lean')
  })

  it('removes its listeners when the plugin is disposed', async () => {
    const world = await setup()
    const agent = await world.open('disposed')
    await flush()
    world.lookup.mockClear()
    await world.plugin.dispose()
    pickModel(agent, 'cloud', 'big')
    await flush()
    expect(world.lookup).not.toHaveBeenCalled()
    expect(composed(world, agent)).toBe('air-lean')
  })
})
