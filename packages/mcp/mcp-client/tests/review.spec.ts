/**
 * Optional `mcpToolReview` service: the reviewer sees each fetched generation
 * between fetch and swap, and its verdict decides which tools and instructions
 * register. Isolated file so vi.mock of the MCP SDK does not affect other suites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config, McpToolReview, McpToolReviewRequest } from '@deepseek-ai/dsh-mcp-client'

const { mockConnect, mockClose, mockListTools, MockClient } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  class MockClient {
    transport: object | undefined = {}
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    getServerCapabilities = () => ({ tools: {} })
    getInstructions(): string | undefined { return 'Use carefully.  ' }
    listTools = mockListTools
    callTool = vi.fn()
  }
  return { mockConnect, mockClose, mockListTools, MockClient }
})

vi.mock('@modelcontextprotocol/client', async importOriginal => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  Client: MockClient,
  StreamableHTTPClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(function () { return { close: () => Promise.resolve() } }),
}))

import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'
import { syncTools, type ToolBridgeOptions } from '@deepseek-ai/dsh-mcp-client/src/tools.ts'

interface ListedTool { name: string; description?: string; inputSchema: { type: 'object' } }

const tool = (name: string, description = `${name} tool`): ListedTool => ({ name, description, inputSchema: { type: 'object' } })

function clientListing(tools: ListedTool[], extra: Record<string, unknown> = {}) {
  return {
    listTools: vi.fn(() => Promise.resolve({ tools, nextCursor: undefined, ...extra })),
    callTool: vi.fn(),
    getServerCapabilities: (): object => ({ tools: {} }),
  }
}

const opts: ToolBridgeOptions = { registrationFailure: 'contain', serverName: 'srv', toolCallTimeoutMs: 60_000 }

const stdioConfig: Config = {
  transport: 'stdio',
  serverName: 'srv',
  command: 'echo',
  args: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function described(ctx: Context, name: string): string | undefined {
  return ctx.tools.schemas().find(schema => schema.name === name)?.description
}

describe('syncTools with a tool reviewer', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await mountRegistry()
  })

  it('registers every fetched tool and publishes raw instructions when no reviewer exists', async () => {
    const published: string[] = []
    await syncTools(clientListing([tool('a')]) as never, ctx, {
      ...opts, instructions: 'Server text.', publishInstructions: text => published.push(text),
    }, new Map())
    expect(ctx.tools.get('mcp__srv__a')).toBeDefined()
    expect(published).toEqual(['Server text.'])
    await ctx.fiber.dispose()
  })

  it('offers the fetched generation, its instructions, and page-1 ttlMs to the reviewer', async () => {
    const requests: McpToolReviewRequest[] = []
    const reviewer: McpToolReview = {
      review(request) {
        requests.push(request)
        return Promise.resolve({ tools: request.tools.map(entry => entry.definition), instructions: request.instructions })
      },
    }
    ctx.provide('mcpToolReview', reviewer)
    await syncTools(clientListing([tool('a'), tool('admin.reset')], { ttlMs: 5000 }) as never, ctx, {
      ...opts, instructions: 'Server text.',
    }, new Map())
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.serverName).toBe('srv')
    expect(request.instructions).toBe('Server text.')
    expect(request.ttlMs).toBe(5000)
    expect(request.tools.map(entry => entry.rawName)).toEqual(['a', 'admin.reset'])
    expect(request.tools[0]!.publicName).toBe('mcp__srv__a')
    expect(request.tools[1]!.publicName).toMatch(/^mcp__srv__admin_reset_[0-9a-f]{12}$/)
    expect(request.tools[0]!.definition).toEqual(tool('a'))
    await ctx.fiber.dispose()
  })

  it('omits ttlMs and defaults instructions to empty text when the server sent neither', async () => {
    const requests: McpToolReviewRequest[] = []
    ctx.provide('mcpToolReview', {
      review(request) {
        requests.push(request)
        return Promise.resolve({ tools: [], instructions: request.instructions })
      },
    } satisfies McpToolReview)
    await syncTools(clientListing([tool('a')]) as never, ctx, opts, new Map())
    expect(Object.hasOwn(requests[0]!, 'ttlMs')).toBe(false)
    expect(requests[0]!.instructions).toBe('')
    // No resync callback was supplied, so the handle is a no-op.
    expect(() => { requests[0]!.resync() }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('registers only the accepted subset and applies a replaced description', async () => {
    ctx.provide('mcpToolReview', {
      review: request => Promise.resolve({
        tools: request.tools
          .filter(entry => entry.rawName !== 'b')
          .map(entry => ({ ...entry.definition, description: 'Reviewed description.' })),
        instructions: '',
      }),
    } satisfies McpToolReview)
    const published: string[] = []
    const previous = await syncTools(clientListing([tool('old')]) as never, ctx, opts, new Map())
    await syncTools(clientListing([tool('a'), tool('b')]) as never, ctx, {
      ...opts, instructions: 'Server text.', publishInstructions: text => published.push(text),
    }, previous)
    expect(ctx.tools.get('mcp__srv__old')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__b')).toBeUndefined()
    expect(described(ctx, 'mcp__srv__a')).toBe('Reviewed description.')
    expect(published).toEqual([''])
    await ctx.fiber.dispose()
  })

  it('registers nothing and withdraws instructions when the reviewer rejects', async () => {
    const errors: string[] = []
    ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
    const previous = await syncTools(clientListing([tool('old')]) as never, ctx, opts, new Map())
    ctx.provide('mcpToolReview', {
      review: () => Promise.reject(new Error('lockfile unreadable')),
    } satisfies McpToolReview)
    const published: string[] = []
    const next = await syncTools(clientListing([tool('a')]) as never, ctx, {
      ...opts, instructions: 'Server text.', publishInstructions: text => published.push(text),
    }, previous)
    expect(next.size).toBe(0)
    expect(ctx.tools.get('mcp__srv__old')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__a')).toBeUndefined()
    expect(published).toEqual([''])
    expect(errors.some(line => line.includes('tool review failed, no tools registered'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('rejects a duplicate raw name before review and keeps the previous generation', async () => {
    const review = vi.fn<McpToolReview['review']>(request => Promise.resolve({
      tools: request.tools.map(entry => entry.definition), instructions: request.instructions,
    }))
    ctx.provide('mcpToolReview', { review })
    const previous = await syncTools(clientListing([tool('old')]) as never, ctx, opts, new Map())
    review.mockClear()
    await expect(syncTools(clientListing([tool('a'), tool('a')]) as never, ctx, opts, previous))
      .rejects.toThrow('more than once')
    expect(review).not.toHaveBeenCalled()
    expect(ctx.tools.get('mcp__srv__old')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('forwards the reviewer re-sync request to the bridge option', async () => {
    const requests: McpToolReviewRequest[] = []
    ctx.provide('mcpToolReview', {
      review(request) {
        requests.push(request)
        return Promise.resolve({ tools: [], instructions: '' })
      },
    } satisfies McpToolReview)
    const resync = vi.fn()
    await syncTools(clientListing([tool('a')]) as never, ctx, { ...opts, resync }, new Map())
    requests[0]!.resync()
    expect(resync).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })
})

describe('connection supervisor with a tool reviewer', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue({ tools: [tool('remote')], nextCursor: undefined })
    ctx = await mountRegistry()
  })

  it('publishes attributed reviewed instructions, withdraws them on rejection, and restores them on re-sync', async () => {
    const requests: McpToolReviewRequest[] = []
    let accept = false
    ctx.provide('mcpToolReview', {
      review(request) {
        requests.push(request)
        return Promise.resolve(accept
          ? { tools: request.tools.map(entry => entry.definition), instructions: request.instructions }
          : { tools: [], instructions: '' })
      },
    } satisfies McpToolReview)
    const handle = startConnection(ctx, stdioConfig, resolveReconnectPolicy(undefined, 'reconnect'))
    try {
      await handle.ready
      expect(requests[0]!.instructions).toBe('Use carefully.')
      expect(handle.instructions()).toBe('')
      expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()

      accept = true
      requests[0]!.resync()
      await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
      expect(handle.instructions()).toBe('### MCP server: srv\n\nUse carefully.')
      expect(requests).toHaveLength(2)
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('ignores a re-sync request after the supervisor was disposed', async () => {
    const requests: McpToolReviewRequest[] = []
    ctx.provide('mcpToolReview', {
      review(request) {
        requests.push(request)
        return Promise.resolve({ tools: [], instructions: '' })
      },
    } satisfies McpToolReview)
    const handle = startConnection(ctx, stdioConfig, resolveReconnectPolicy(undefined, 'reconnect'))
    await handle.ready
    await handle.dispose()
    const calls = mockListTools.mock.calls.length
    requests[0]!.resync()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mockListTools.mock.calls.length).toBe(calls)
    await ctx.fiber.dispose()
  })
})
