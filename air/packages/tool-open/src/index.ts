/**
 * The `open` tool: start an app, a site, or a Google search from a whitelist, so a small local model
 * does not have to write PowerShell for simple opens. Targets are checked against the whitelist
 * (`@air/dsh-tool-open/whitelist`) before anything runs.
 * @module @air/dsh-tool-open
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { nodeExec, startTarget, type ExecLike } from './exec.ts'
import { APPS, findApp, findSite, googleSearchUrl, isAllowedTarget } from './whitelist.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'air-tool-open'

/** Tool registry. */
export const inject = ['tools']

/** Tool configuration. */
export interface Config {
  /** `false` registers no tool. */
  enabled: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true).description('Register the open tool.'),
})

const KINDS = ['app', 'url', 'search'] as const

function knownApps(): string {
  return APPS.map(app => app.names[0]).join(', ')
}

/**
 * Resolve the tool arguments to a checked target and a sentence for the model.
 * @throws Error naming what is allowed when the value is not on the whitelist.
 */
function resolve(kind: typeof KINDS[number], value: string): { target: string; done: string } {
  if (kind === 'search') return { target: googleSearchUrl(value), done: `Opened a Google search for ${value}.` }
  if (kind === 'app') {
    const app = findApp(value)
    if (app === undefined) throw new Error(`Unknown app "${value}". Known apps: ${knownApps()}.`)
    return { target: app.target, done: `Opened ${app.label}.` }
  }
  const site = findSite(value)
  if (site !== null) return { target: site.url, done: `Opened ${site.label}.` }
  if (isAllowedTarget(value) && value.startsWith('https://')) return { target: value, done: `Opened ${value}.` }
  throw new Error(`Cannot open "${value}": give a site name such as youtube, a domain ending in .com, .org, .in, or .io, or an https URL.`)
}

/**
 * @param exec - process runner; tests pass a fake.
 * @returns the `open` tool definition.
 */
export function openTool(exec: ExecLike = nodeExec): ToolDefinition {
  return defineTool({
    name: 'open',
    description: 'Open an app, website, or Google search on the PC. Prefer this to pwsh for opening.',
    parameters: {
      kind: { type: 'string', enum: [...KINDS], required: true, description: 'app, url, or search.' },
      value: { type: 'string', required: true, description: 'App name, site name or https URL, or search words.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { message: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const { target, done } = resolve(args.kind, args.value.trim())
      await startTarget(exec, target)
      return { message: done }
    },
  })
}

/**
 * Register the `open` tool for the lifetime of `ctx`.
 * @param ctx - plugin context with `tools` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  ctx.tools.register(openTool())
}
