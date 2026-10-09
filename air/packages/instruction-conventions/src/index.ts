/**
 * Companion to upstream `agent-instructions`. It injects the convention files upstream does not read:
 * `.claude/CLAUDE.md`, the user's `~/.claude/CLAUDE.md` (opt-in), files reached through `@path`
 * imports, and `.claude/rules`. Rules without `paths:` enter with the baseline, which is composed once per
 * turn at step 1; rules with `paths:` are attached to the result of the first `read`, `write`, or `edit`
 * call on a matching file.
 * Every injected text is a user message with source kind `air-instructions`, so it is in the session log.
 *
 * @module @air/dsh-instruction-conventions
 */
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { expandHome, findProjectRoot, isInside, resolveUserHomes, toPosixRelative } from '@air/dsh-convention-core'
import { composeBaseline } from './baseline.ts'
import { loadClaudeRules, matchingRules, type Rule, type RuleCache } from './rules.ts'

export const name = 'air-instruction-conventions'

/** Durable source of every message this plugin injects. */
export interface AirInstructionSource {
  readonly kind: 'air-instructions'
  /** The text is instructions read out of files. */
  readonly form: 'instructions'
  /** Present on the message that carries the baseline files. */
  readonly baseline?: true
  /** Project-relative path of the rule file, on a path-scoped rule message. */
  readonly rule?: string
  /** Identity of the injected text; a different digest means different text. */
  readonly digest: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Convention files injected by `@air/dsh-instruction-conventions`. */
    'air-instructions': AirInstructionSource
  }
}

/** Plugin configuration. */
export interface Config {
  /** UTF-8 byte budget for the baseline file blocks. Required. */
  maxBytes: number
  /** Largest single file read (seed files, imports, rules) in bytes. Defaults to 262144. */
  maxFileBytes?: number
  /** Most directory entries examined while walking `.claude/rules`. Defaults to 2000. */
  maxWalkEntries?: number
  /** Most `@path` imports followed in one file. Defaults to 32. */
  maxImportsPerFile?: number
  /** Claude Code home. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Whether `<claudeHome>/CLAUDE.md` is read and may import files under `claudeHome`. Defaults to false. */
  includeUserRoots?: boolean
  /** Directories outside the project whose files `@path` imports may read; absolute or starting with `~/`. */
  allowedImportRoots?: string[]
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
}

export const Config: Schema<Config> = Schema.object({
  maxBytes: Schema.number().required().description('UTF-8 byte budget for the baseline file blocks.'),
  maxFileBytes: Schema.number().default(262144).description('Largest single file read, in bytes.'),
  maxWalkEntries: Schema.number().default(2000).description('Most directory entries examined while walking .claude/rules.'),
  maxImportsPerFile: Schema.number().default(32).description('Most @path imports followed in one file.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  includeUserRoots: Schema.boolean().default(false).description('Read ~/.claude/CLAUDE.md and allow imports under ~/.claude.'),
  allowedImportRoots: Schema.array(Schema.string()).default([]).description('Directories outside the project that @path imports may read.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly maxBytes: number
  readonly maxFileBytes: number
  readonly maxWalkEntries: number
  readonly maxImportsPerFile: number
  readonly claudeHome: string
  readonly home: string
  readonly includeUserRoots: boolean
  readonly allowedImportRoots: readonly string[]
  readonly projectRootMarkers: readonly string[]
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!Number.isInteger(config.maxBytes) || config.maxBytes < 1) {
    throw new TypeError('air-instruction-conventions: maxBytes must be a positive integer')
  }
  const limits = {
    maxFileBytes: config.maxFileBytes ?? 262144,
    maxWalkEntries: config.maxWalkEntries ?? 2000,
    maxImportsPerFile: config.maxImportsPerFile ?? 32,
  }
  for (const [field, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`air-instruction-conventions: ${field} must be a positive integer`)
  }
  const home = homedir()
  const allowedImportRoots = (config.allowedImportRoots ?? []).map((root) => {
    const expanded = expandHome(root, home)
    if (!isAbsolute(expanded)) {
      throw new TypeError(`air-instruction-conventions: allowedImportRoots entry "${root}" must be an absolute path or start with ~/`)
    }
    return resolve(expanded)
  })
  const projectRootMarkers = config.projectRootMarkers ?? ['.git']
  if (projectRootMarkers.length === 0) {
    throw new TypeError('air-instruction-conventions: projectRootMarkers must not be empty')
  }
  return {
    maxBytes: config.maxBytes,
    ...limits,
    claudeHome: resolveUserHomes(config).claudeHome,
    home,
    includeUserRoots: config.includeUserRoots ?? false,
    allowedImportRoots,
    projectRootMarkers,
  }
}

const FILE_TOOLS = new Set(['read', 'write', 'edit'])

function touchedPath(exec: ToolExecution): string | undefined {
  const args = exec.arguments
  if (FILE_TOOLS.has(exec.name) && typeof args === 'object' && args !== null && 'file_path' in args && typeof args.file_path === 'string') {
    return args.file_path
  }
  return undefined
}

function latestBaselineDigest(history: readonly Message[]): string | undefined {
  for (const message of history.toReversed()) {
    if (message.source.kind === 'air-instructions' && message.source.baseline === true) return message.source.digest
  }
  return undefined
}

function ruleKey(relativePath: string, digest: string): string {
  return `${relativePath}:${digest}`
}

/**
 * Register the baseline and path-scoped rule injection.
 * @param ctx - plugin context; in a preset its listeners receive only that preset's Agents.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const reported = new Set<string>()
  const ruleCache: RuleCache = new Map()
  const delivered = new WeakMap<Agent['session'], Set<string>>()

  const report = (problems: readonly string[]): void => {
    for (const problem of problems) {
      if (reported.has(problem)) continue
      reported.add(problem)
      ctx.logger.warn(`air-instruction-conventions: ${problem}`)
    }
  }

  const deliveredRules = (session: Agent['session']): Set<string> => {
    let keys = delivered.get(session)
    if (keys === undefined) {
      keys = new Set()
      for (const message of session.deriveMessages()) {
        if (message.source.kind === 'air-instructions' && message.source.rule !== undefined) {
          keys.add(ruleKey(message.source.rule, message.source.digest))
        }
      }
      delivered.set(session, keys)
    }
    return keys
  }

  const ruleMessage = (rule: Rule) => {
    const source: AirInstructionSource = { kind: 'air-instructions', form: 'instructions', rule: rule.relativePath, digest: rule.digest }
    return createUserMessage({
      content: [{ type: 'text', text: `<air_rule path="${rule.relativePath}">\n${rule.content}\n</air_rule>` }],
      source,
    })
  }

  /** Compose the baseline; a read failure is reported and the turn continues without it. */
  const compose = async (cwd: string): Promise<Awaited<ReturnType<typeof composeBaseline>> | undefined> => {
    try {
      const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
      return await composeBaseline({
        cwd,
        projectRoot,
        claudeHome: resolved.claudeHome,
        home: resolved.home,
        includeUserRoots: resolved.includeUserRoots,
        allowedImportRoots: resolved.allowedImportRoots,
        maxBytes: resolved.maxBytes,
        maxFileBytes: resolved.maxFileBytes,
        maxEntries: resolved.maxWalkEntries,
        maxImportsPerFile: resolved.maxImportsPerFile,
        ruleCache,
      })
    } catch (error: unknown) {
      report([`convention files could not be read: ${(error as Error).message}`])
      return undefined
    }
  }

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    // Compose once per turn: later steps of the turn keep the files they started with, and the provider's
    // prompt cache survives an edit made mid-turn. An empty first step owns a no-step turn; adding context
    // would turn it into a request.
    if (step !== 1 || decision.kind === 'reject' || decision.messages.length === 0) return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const composed = await compose(cwd)
    signal.throwIfAborted()
    if (composed === undefined) return decision
    const { baseline, problems } = composed
    report(problems)
    if (baseline === undefined) return decision
    if (latestBaselineDigest([...agent.session.deriveMessages(), ...decision.messages]) === baseline.digest) return decision
    const source: AirInstructionSource = { kind: 'air-instructions', form: 'instructions', baseline: true, digest: baseline.digest }
    const message = createUserMessage({ content: [{ type: 'text', text: baseline.text }], source })
    // Place the context right after the messages the step claimed, before context other listeners appended.
    const lastClaimed = decision.messages.findLastIndex(entry => messages.includes(entry))
    return { ...decision, messages: decision.messages.toSpliced(lastClaimed + 1, 0, message) }
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const agent = exec.agent
    const filePath = touchedPath(exec)
    if (result.isError || agent === undefined || filePath === undefined || decision.kind !== 'accept') return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const absolute = resolve(cwd, filePath)
    if (!isInside(projectRoot, absolute)) return decision
    const limits = { maxFileBytes: resolved.maxFileBytes, maxEntries: resolved.maxWalkEntries }
    const ruleSet = await loadClaudeRules(projectRoot, limits, ruleCache)
    report(ruleSet.problems)
    const keys = deliveredRules(agent.session)
    const fresh = matchingRules(ruleSet.rules, toPosixRelative(projectRoot, absolute))
      .filter(rule => !keys.has(ruleKey(rule.relativePath, rule.digest)))
    if (fresh.length === 0) return decision
    for (const rule of fresh) keys.add(ruleKey(rule.relativePath, rule.digest))
    return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], ...fresh.map(ruleMessage)] }
  })
}
