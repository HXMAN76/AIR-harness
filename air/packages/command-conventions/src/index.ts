/**
 * Registers Claude Code command files (`.claude/commands/**` Markdown) as slash commands scoped to
 * the Agent whose project contains them. Running a command substitutes its arguments into the file
 * body and queues the result as a user message with source kind `air-command`, so the prompt the
 * model receives is in the session log.
 *
 * @module @air/dsh-command-conventions
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-working-directory'
import {
  describeSkip,
  describeTruncation,
  errorMessage,
  findProjectRoot,
  listMarkdownTree,
  parseFrontmatter,
  readContained,
  resolveUserHomes,
  stringField,
  stringListField,
  toKebabName,
  type UserHomes,
} from '@air/dsh-convention-core'
import { substituteArguments } from './args.ts'

export { splitArguments, substituteArguments } from './args.ts'

export const name = 'air-command-conventions'
export const inject = ['agents', 'commands', 'workingDirectory']

/** Same grammar the upstream command registry accepts. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u
/** Directory levels walked under a commands root. */
const COMMAND_TREE_DEPTH = 4
const DESCRIPTION_MAX_CHARS = 120

/** Durable source of the user message a command file produces. */
export interface AirCommandSource {
  readonly kind: 'air-command'
  /** Command name without the slash. */
  readonly name: string
  /** The text is instructions read out of a file. */
  readonly form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A command file rendered by `@air/dsh-command-conventions`. */
    'air-command': AirCommandSource
  }
}

/** Plugin configuration. */
export interface Config {
  /** AIR home; its `commands` directory is always scanned. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home, read only with `includeUserRoots`. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Whether `<claudeHome>/commands` is scanned. Defaults to false. */
  includeUserRoots?: boolean
  /** Largest command file in bytes. Defaults to 262144. */
  maxFileBytes?: number
  /** Most directory entries examined per commands root. Defaults to 2000. */
  maxWalkEntries?: number
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
  /** Index of the first argument for `$ARGUMENTS[N]` and `$N`: 0 or 1. Defaults to 0. */
  positionalBase?: number
}

export const Config: Schema<Config> = Schema.object({
  airHome: Schema.string().description('AIR home; defaults to $AIR_HOME, then ~/.air.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  includeUserRoots: Schema.boolean().default(false).description('Scan ~/.claude/commands.'),
  maxFileBytes: Schema.number().default(262144).description('Largest command file, in bytes.'),
  maxWalkEntries: Schema.number().default(2000).description('Most directory entries examined per commands root.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
  positionalBase: Schema.number().default(0).description('Index of the first argument for $ARGUMENTS[N] and $N: 0 or 1.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly homes: UserHomes
  readonly includeUserRoots: boolean
  readonly maxFileBytes: number
  readonly maxWalkEntries: number
  readonly projectRootMarkers: readonly string[]
  readonly positionalBase: number
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    homes: resolveUserHomes(config),
    includeUserRoots: config.includeUserRoots ?? false,
    maxFileBytes: config.maxFileBytes ?? 262144,
    maxWalkEntries: config.maxWalkEntries ?? 2000,
    projectRootMarkers: config.projectRootMarkers ?? ['.git'],
    positionalBase: config.positionalBase ?? 0,
  }
  if (resolved.positionalBase !== 0 && resolved.positionalBase !== 1) {
    throw new TypeError('air-command-conventions: positionalBase must be 0 or 1')
  }
  if (!Number.isInteger(resolved.maxFileBytes) || resolved.maxFileBytes < 1) {
    throw new TypeError('air-command-conventions: maxFileBytes must be a positive integer')
  }
  if (!Number.isInteger(resolved.maxWalkEntries) || resolved.maxWalkEntries < 1) {
    throw new TypeError('air-command-conventions: maxWalkEntries must be a positive integer')
  }
  if (resolved.projectRootMarkers.length === 0) {
    throw new TypeError('air-command-conventions: projectRootMarkers must not be empty')
  }
  return resolved
}

interface LoadedCommand {
  readonly description: string
  readonly hint: string
  readonly argumentNames: readonly string[]
  readonly body: string
}

interface CommandFile extends LoadedCommand {
  readonly name: string
  readonly path: string
  /** Directory the file's real path must stay inside. */
  readonly confine: string
}

function firstLine(text: string): string {
  const end = text.indexOf('\n')
  const line = (end < 0 ? text : text.slice(0, end)).replace(/^#+\s*/u, '').trim()
  if (line.length === 0) return 'Project command file'
  return line.length <= DESCRIPTION_MAX_CHARS ? line : `${line.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
}

/**
 * Register command files per Agent.
 * @param ctx - host-level plugin context with `agents`, `commands`, and `workingDirectory` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  /** One entry per Agent from the first moment its discovery starts; `scope` is set once commands are registered. */
  const scopes = new Map<Agent, { released: boolean; scope?: Scope }>()

  /** Read and parse one command file; undefined when it is gone, refused, empty, or does not parse. */
  const load = async (path: string, confine: string): Promise<LoadedCommand | undefined> => {
    const read = await readContained(path, { roots: [confine], maxBytes: resolved.maxFileBytes })
    if (read.kind === 'absent') return undefined
    if (read.kind !== 'ok') {
      ctx.logger.warn(`air-command-conventions: ${describeSkip(path, read.kind, resolved.maxFileBytes)}`)
      return undefined
    }
    try {
      const { data, body } = parseFrontmatter(read.text)
      const text = body.trim()
      if (text.length === 0) return undefined
      return {
        description: stringField(data, 'description') ?? firstLine(text),
        hint: stringField(data, 'argument-hint') ?? '[arguments]',
        argumentNames: stringListField(data, 'arguments') ?? [],
        body: text,
      }
    } catch (error: unknown) {
      ctx.logger.warn(`air-command-conventions: ${path} ignored: ${errorMessage(error)}`)
      return undefined
    }
  }

  const discover = async (agent: Agent, cwd: string): Promise<CommandFile[]> => {
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const roots = [
      { path: join(projectRoot, '.claude', 'commands'), confine: projectRoot },
      { path: join(resolved.homes.airHome, 'commands'), confine: resolved.homes.airHome },
      ...resolved.includeUserRoots ? [{ path: join(resolved.homes.claudeHome, 'commands'), confine: resolved.homes.claudeHome }] : [],
    ]
    const found = new Map<string, CommandFile>()
    for (const root of roots) {
      const tree = await listMarkdownTree(root.path, COMMAND_TREE_DEPTH, { roots: [root.confine], maxEntries: resolved.maxWalkEntries })
      for (const skipped of tree.skipped) ctx.logger.warn(`air-command-conventions: ${describeSkip(skipped.path, skipped.reason, resolved.maxFileBytes)}`)
      if (tree.truncated) ctx.logger.warn(`air-command-conventions: ${describeTruncation(root.path, resolved.maxWalkEntries)}`)
      for (const entry of tree.entries) {
        const commandName = toKebabName(entry.segments.join('-'))
        if (commandName === undefined || !COMMAND_NAME.test(commandName)) {
          ctx.logger.warn(`air-command-conventions: ${entry.path} skipped: its path does not form a command name`)
          continue
        }
        if (found.has(commandName)) continue
        // A repository file must not replace a command the host or the preset already provides.
        if (ctx.commands.find(agent, commandName) !== undefined) {
          ctx.logger.warn(`air-command-conventions: ${entry.path} skipped: /${commandName} is already a command`)
          continue
        }
        const loaded = await load(entry.path, root.confine)
        if (loaded === undefined) continue
        found.set(commandName, Object.assign({}, loaded, { name: commandName, path: entry.path, confine: root.confine }))
      }
    }
    return [...found.values()]
  }

  const run = async (file: CommandFile, invocation: CommandInvocation): Promise<CommandResult> => {
    const loaded = await load(file.path, file.confine)
    if (loaded === undefined) return { kind: 'error', text: `/${file.name}: ${file.path} can no longer be read.` }
    const text = substituteArguments(loaded.body, invocation.rawInput, loaded.argumentNames, resolved.positionalBase)
    const source: AirCommandSource = { kind: 'air-command', name: file.name, form: 'instructions' }
    invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source }))
    return { kind: 'success', text: `Sent /${file.name} to the model.` }
  }

  const release = async (agent: Agent): Promise<void> => {
    const entry = scopes.get(agent)
    if (entry === undefined) return
    scopes.delete(agent)
    entry.released = true
    await entry.scope?.dispose()
  }

  /** Release an Agent from a listener, where a rejection would be unhandled. */
  const releaseLogged = (agent: Agent): Promise<void> => release(agent).catch((error: unknown) => {
    ctx.logger.warn(`air-command-conventions: removing commands failed: ${errorMessage(error)}`)
  })

  ctx.on('agent/created', async ({ agent }) => {
    // Registered before the first await so a disposal during discovery finds the entry and marks it released.
    const entry: { released: boolean; scope?: Scope } = { released: false }
    scopes.set(agent, entry)
    let files: CommandFile[]
    try {
      files = await discover(agent, await ctx.workingDirectory.ensure(agent))
    } catch (error: unknown) {
      // A command folder that cannot be read costs the Agent its commands, never its creation.
      ctx.logger.warn(`air-command-conventions: command files could not be read: ${errorMessage(error)}`)
      if (scopes.get(agent) === entry) scopes.delete(agent)
      return
    }
    if (entry.released) return
    if (files.length === 0) {
      scopes.delete(agent)
      return
    }
    const scope = createScope(ctx, agent)
    entry.scope = scope
    for (const file of files) {
      scope.ctx.commands.register({
        name: file.name,
        description: file.description,
        input: { hint: file.hint },
        handler: invocation => run(file, invocation),
      })
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void releaseLogged(agent)
  })

  ctx.effect(() => async () => {
    await Promise.all([...scopes.keys()].map(agent => releaseLogged(agent)))
  }, 'air-command-conventions.scopes')
}
