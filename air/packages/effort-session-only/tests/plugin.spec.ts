import { afterEach, expect, it } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as effortSessionOnly from '../src/index.ts'
import { buildWorld, type World } from './harness.ts'

let world: World | undefined

afterEach(async () => {
  await world?.close()
  world = undefined
})

const high = ReasoningEffortId('high')
const medium = ReasoningEffortId('medium')

/** Mount the plugin the way a bundle row does. */
async function mount(live: World, config: effortSessionOnly.Config = {}): Promise<{ dispose: () => Promise<void> }> {
  const fiber = live.ctx.plugin(effortSessionOnly, config)
  await fiber.await()
  return { dispose: async () => { await fiber.dispose() } }
}

it('saves the picked model but keeps the configured effort', async () => {
  world = await buildWorld('none')
  await mount(world, { enabled: true })
  await world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'other', reasoningEffort: high })
  expect(world.written).toEqual([{ entryId: 'default-model', config: { provider: 'ollama', model: 'other', reasoningEffort: 'none' } }])
})

it('saves no effort change when only the effort was picked on the current model', async () => {
  world = await buildWorld('none')
  await mount(world)
  await world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'qwen3-8b-32k', reasoningEffort: medium })
  expect(world.written).toEqual([
    { entryId: 'default-model', config: { provider: 'ollama', model: 'qwen3-8b-32k', reasoningEffort: 'none' } },
  ])
})

it('writes no effort key when none is configured', async () => {
  world = await buildWorld(undefined)
  await mount(world)
  await world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'other', reasoningEffort: high })
  const config = world.written[0]?.config
  expect(config).toEqual({ provider: 'ollama', model: 'other' })
  expect(Object.keys(config as object)).not.toContain('reasoningEffort')
})

it('passes a selection through unchanged when disabled', async () => {
  world = await buildWorld('none')
  await mount(world, { enabled: false })
  await world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'other', reasoningEffort: high })
  expect(world.written[0]?.config).toEqual({ provider: 'ollama', model: 'other', reasoningEffort: 'high' })
})

it('restores the original method on dispose', async () => {
  world = await buildWorld('none')
  const handle = await mount(world)
  await handle.dispose()
  await world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'other', reasoningEffort: high })
  expect(world.written[0]?.config).toEqual({ provider: 'ollama', model: 'other', reasoningEffort: 'high' })
})

it('keeps the configured effort across two picks in a row', async () => {
  world = await buildWorld('none')
  await mount(world)
  const consumer = world.ctx.agentDefaultModel
  await consumer.saveSelection({ provider: 'ollama', model: 'a', reasoningEffort: high })
  await consumer.saveSelection({ provider: 'ollama', model: 'b', reasoningEffort: medium })
  expect(world.written.map(entry => entry.config)).toEqual([
    { provider: 'ollama', model: 'a', reasoningEffort: 'none' },
    { provider: 'ollama', model: 'b', reasoningEffort: 'none' },
  ])
})

it('rejects with the original failure when the profile write fails', async () => {
  world = await buildWorld('none')
  await mount(world)
  world.failWith(new Error('read-only document'))
  await expect(world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'other' })).rejects.toThrow('read-only document')
})

it('rejects a non-boolean enabled in the schema and defaults it to true', () => {
  expect(() => {
    const bad: unknown = JSON.parse('{"enabled":"yes"}')
    Reflect.apply(effortSessionOnly.Config, undefined, [bad])
  }).toThrow()
  expect(effortSessionOnly.Config({})).toEqual({ enabled: true })
})

it('wraps and then restores a method another plugin already set on the instance', async () => {
  world = await buildWorld('none')
  const calls: ModelSelection[] = []
  const service = world.ctx.agentDefaultModel
  const earlier = (next: ModelSelection): Promise<void> => {
    calls.push(next)
    return Promise.resolve()
  }
  service.saveSelection = earlier
  const handle = await mount(world)
  await service.saveSelection({ provider: 'ollama', model: 'other', reasoningEffort: high })
  expect(calls).toEqual([{ provider: 'ollama', model: 'other', reasoningEffort: 'none' }])
  await handle.dispose()
  expect(Object.getOwnPropertyDescriptor(service, 'saveSelection')?.value).toBe(earlier)
})

it('mounts with no configuration object', async () => {
  world = await buildWorld('none')
  const fiber = world.ctx.plugin(effortSessionOnly)
  await fiber.await()
  await world.ctx.agentDefaultModel.saveSelection({ provider: 'ollama', model: 'other', reasoningEffort: high })
  expect(world.written[0]?.config).toEqual({ provider: 'ollama', model: 'other', reasoningEffort: 'none' })
})
