/** Premise of spike 03 §1.1: a row-level `inject` holds mcp-client pending and restarts it. */
import { afterEach, expect, it, vi } from 'vitest'
import { boot, PUBLIC, type Booted } from './support/boot.ts'

const ECHO = { name: 'echo', description: 'Echo the input.', inputSchema: { type: 'object' } }

/** Reviewer that accepts the fetched generation unchanged. */
const passThrough = {
  review: (request: { tools: readonly { definition: object }[]; instructions: string }) => Promise.resolve({
    tools: request.tools.map(tool => tool.definition),
    instructions: request.instructions,
  }),
}

// A plain string selects the untyped `provide` overload, so this file compiles
// both before and after Task 1 adds `Context.mcpToolReview`.
const SERVICE: string = 'mcpToolReview'

let booted: Booted | undefined

afterEach(async () => {
  await booted?.dispose()
  booted = undefined
})

it('keeps the mcp-client row pending until the injected service exists', async () => {
  booted = await boot({ surface: { tools: [ECHO] } })
  const { ctx } = booted
  expect(ctx.tools.get(PUBLIC('echo'))).toBeUndefined()

  const withdraw = ctx.provide(SERVICE, passThrough)
  await vi.waitFor(() => { expect(ctx.tools.get(PUBLIC('echo'))).toBeDefined() }, { timeout: 10_000 })

  withdraw()
  await vi.waitFor(() => { expect(ctx.tools.get(PUBLIC('echo'))).toBeUndefined() }, { timeout: 10_000 })

  ctx.provide(SERVICE, passThrough)
  await vi.waitFor(() => { expect(ctx.tools.get(PUBLIC('echo'))).toBeDefined() }, { timeout: 10_000 })
})

it('connects at once when the row declares no inject', async () => {
  booted = await boot({ surface: { tools: [ECHO] }, reviewed: false })
  expect(booted.ctx.tools.get(PUBLIC('echo'))).toBeDefined()
})
