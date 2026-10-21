import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { activeProvider, routeAllows, routeLabel, type RouteAgent } from '../src/route.ts'

function agent(options: { header?: string; created?: string }): RouteAgent {
  return {
    options: options.created === undefined ? {} : { provider: options.created },
    session: { requestHeader: () => (options.header === undefined ? undefined : { config: { provider: options.header } }) },
  }
}

describe('activeProvider', () => {
  it('prefers the latest request, then the creation options, then the default model', () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'from-default', model: 'm' }) })
    expect(activeProvider(ctx, agent({ header: 'from-header', created: 'from-options' }))).toBe('from-header')
    expect(activeProvider(ctx, agent({ created: 'from-options' }))).toBe('from-options')
    expect(activeProvider(ctx, agent({}))).toBe('from-default')
  })

  it('is unknown without an agent or any source', () => {
    const ctx = new Context()
    expect(activeProvider(ctx, undefined)).toBeUndefined()
    expect(activeProvider(ctx, agent({}))).toBeUndefined()
  })
})

describe('routeAllows and routeLabel', () => {
  it('allows listed providers and everything for *, never an unknown route otherwise', () => {
    expect(routeAllows(['ollama'], 'ollama')).toBe(true)
    expect(routeAllows(['ollama'], 'deepseek')).toBe(false)
    expect(routeAllows(['ollama'], undefined)).toBe(false)
    expect(routeAllows([], 'ollama')).toBe(false)
    expect(routeAllows(['*'], undefined)).toBe(true)
  })

  it('names the route', () => {
    expect(routeLabel('deepseek')).toBe('"deepseek"')
    expect(routeLabel(undefined)).toBe('current')
  })
})
