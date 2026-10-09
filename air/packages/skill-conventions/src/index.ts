/**
 * Skill provider for the file conventions other agents use: project `.dsh/skills`, `.agents/skills`,
 * `.claude/skills`, extra project roots, the AIR home, and opt-in user roots. `.claude/commands` files
 * are not skills here; `@air/dsh-command-conventions` registers them as slash commands.
 * Mount it in the same agent preset as upstream `skill-filesystem` so both register in one layer.
 *
 * @module @air/dsh-skill-conventions
 */
import { join, posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import {
  PollWatcher,
  findProjectRoot,
  isRecord,
  listDirectory,
  readTextFile,
  resolveUserHomes,
  type UserHomes,
} from '@air/dsh-convention-core'
import { parseSkillText, type ParsedSkillFile } from './parse.ts'
import { skillRoots } from './roots.ts'

export const name = 'air-skill-conventions'
export const inject = ['skills']

/** Plugin configuration. */
export interface Config {
  /** Unique provider name in the skill registry layer. Defaults to `air-conventions`. */
  providerName?: string
  /** AIR home; its `skills` directory is always scanned. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home, read only with `includeUserRoots`. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Shared agents home, read only with `includeUserRoots`. Defaults to `$DSH_AGENTS_HOME`, then `~/.agents`. */
  agentsHome?: string
  /** Whether `<agentsHome>/skills` and `<claudeHome>/skills` are scanned. Defaults to false. */
  includeUserRoots?: boolean
  /** Extra skill directories relative to the project root, for example `.opencode/skills`. */
  extraProjectRoots?: string[]
  /** Longest skill description kept in the catalog. Defaults to 1500. */
  descriptionMaxChars?: number
  /** Milliseconds between polls of scanned roots and skill files; 0 disables watching. Defaults to 3000. */
  watchIntervalMs?: number
  /** Maximum number of projects whose roots stay watched. Defaults to 32. */
  watchMaxProjects?: number
}

export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default('air-conventions').description('Unique provider name in the skill registry layer.'),
  airHome: Schema.string().description('AIR home; defaults to $AIR_HOME, then ~/.air.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  agentsHome: Schema.string().description('Shared agents home; defaults to $DSH_AGENTS_HOME, then ~/.agents.'),
  includeUserRoots: Schema.boolean().default(false).description('Scan ~/.agents/skills and ~/.claude/skills.'),
  extraProjectRoots: Schema.array(Schema.string()).default([]).description('Extra skill directories relative to the project root.'),
  descriptionMaxChars: Schema.number().default(1500).description('Longest skill description kept in the catalog.'),
  watchIntervalMs: Schema.number().default(3000).description('Milliseconds between polls of scanned paths; 0 disables watching.'),
  watchMaxProjects: Schema.number().default(32).description('Maximum number of projects whose skill roots stay watched.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly providerName: string
  readonly homes: UserHomes
  readonly includeUserRoots: boolean
  readonly extraProjectRoots: readonly string[]
  readonly descriptionMaxChars: number
  readonly watchIntervalMs: number
  readonly watchMaxProjects: number
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? 'air-conventions',
    homes: resolveUserHomes(config),
    includeUserRoots: config.includeUserRoots ?? false,
    extraProjectRoots: config.extraProjectRoots ?? [],
    descriptionMaxChars: config.descriptionMaxChars ?? 1500,
    watchIntervalMs: config.watchIntervalMs ?? 3000,
    watchMaxProjects: config.watchMaxProjects ?? 32,
  }
  if (!Number.isInteger(resolved.descriptionMaxChars) || resolved.descriptionMaxChars < 1) {
    throw new TypeError('air-skill-conventions: descriptionMaxChars must be a positive integer')
  }
  if (!Number.isInteger(resolved.watchIntervalMs) || resolved.watchIntervalMs < 0) {
    throw new TypeError('air-skill-conventions: watchIntervalMs must be a non-negative integer')
  }
  if (!Number.isInteger(resolved.watchMaxProjects) || resolved.watchMaxProjects < 1) {
    throw new TypeError('air-skill-conventions: watchMaxProjects must be a positive integer')
  }
  for (const root of resolved.extraProjectRoots) {
    // Both path flavors are checked so a profile patch shared between Windows and Linux fails the same way on each.
    if (posix.isAbsolute(root) || win32.isAbsolute(root) || root.split(/[\\/]/u).includes('..')) {
      throw new TypeError(`air-skill-conventions: extraProjectRoots entry "${root}" must be a relative path inside the project`)
    }
  }
  return resolved
}

interface SkillFile {
  readonly path: string
  /** Directory that `${CLAUDE_SKILL_DIR}` and relative resources resolve against. */
  readonly directory: string
  readonly fallbackName: string
  /** True for `<name>.md` directly in a root. */
  readonly flat: boolean
}

function isLocator(value: unknown): value is SkillFile {
  return isRecord(value)
    && typeof value['path'] === 'string'
    && typeof value['directory'] === 'string'
    && typeof value['fallbackName'] === 'string'
    && typeof value['flat'] === 'boolean'
}

async function skillFiles(rootPath: string): Promise<SkillFile[]> {
  const files: SkillFile[] = []
  for (const entry of await listDirectory(rootPath)) {
    if (entry.kind === 'directory') {
      files.push({ path: join(entry.path, 'SKILL.md'), directory: entry.path, fallbackName: entry.name, flat: false })
    } else if (entry.name.endsWith('.md')) {
      files.push({ path: entry.path, directory: rootPath, fallbackName: entry.name.slice(0, -3), flat: true })
    }
  }
  return files
}

/** Skill provider over the convention roots. One instance serves every lookup cwd. */
export class ConventionSkillProvider implements SkillProvider {
  readonly name: string
  private readonly watcher: PollWatcher | undefined

  /**
   * @param logger - receives warnings about unreadable skill files and failed change notifications.
   * @param control - registration lifecycle; `invalidate` is called when a watched path changes.
   * @param config - resolved configuration.
   */
  constructor(
    private readonly logger: Pick<Context['logger'], 'warn'>,
    control: SkillProviderControl,
    private readonly config: ResolvedConfig,
  ) {
    this.name = config.providerName
    this.watcher = config.watchIntervalMs > 0
      ? new PollWatcher({
        intervalMs: config.watchIntervalMs,
        maxGroups: config.watchMaxProjects,
        onChange: control.invalidate,
        onError: (error: unknown) => { logger.warn(`air-skill-conventions: change notification failed: ${String(error)}`) },
      })
      : undefined
    control.signal.addEventListener('abort', () => { this.dispose() }, { once: true })
  }

  /**
   * Discover skill candidates for one lookup.
   * @param options - lookup options; `cwd` selects the project roots.
   * @returns candidates from every configured root; files that fail to parse are logged and omitted.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const listedAt = Date.now()
    const projectRoot = options.cwd === undefined ? undefined : await findProjectRoot(options.cwd)
    const roots = skillRoots({
      projectRoot,
      homes: this.config.homes,
      includeUserRoots: this.config.includeUserRoots,
      extraProjectRoots: this.config.extraProjectRoots,
    })
    const candidates: SkillCandidate[] = []
    const watched: string[] = []
    for (const root of roots) {
      watched.push(root.path)
      for (const file of await skillFiles(root.path)) {
        watched.push(file.path)
        const parsed = await this.parse(file)
        if (parsed === undefined) continue
        if (!parsed.invocation.modelInvocable && !parsed.invocation.userInvocable) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          provider: this.name,
          source: root.source,
          rank: root.rank,
          locator: file,
          resourceBase: { kind: 'directory', path: file.directory },
          path: file.path,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        })
      }
    }
    this.watcher?.retain(projectRoot ?? '', watched, listedAt)
    return candidates
  }

  /**
   * Load the body of a candidate this provider listed.
   * @param candidate - winning candidate from {@link list}.
   * @returns the definition with `${CLAUDE_SKILL_DIR}` replaced by the skill directory,
   *   or undefined when the file is gone or no longer parses.
   */
  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator
    if (!isLocator(locator)) return undefined
    const parsed = await this.parse(locator)
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      content: parsed.body.replaceAll('${CLAUDE_SKILL_DIR}', locator.directory),
    }
  }

  /** Stop watching. Safe to call more than once. */
  dispose(): void {
    this.watcher?.close()
  }

  private async parse(file: SkillFile): Promise<ParsedSkillFile | undefined> {
    const raw = await readTextFile(file.path)
    if (raw === undefined) return undefined
    try {
      return parseSkillText(raw, {
        fallbackName: file.fallbackName,
        flat: file.flat,
        descriptionMaxChars: this.config.descriptionMaxChars,
      })
    } catch (error: unknown) {
      this.logger.warn(`air-skill-conventions: ${file.path} ignored: ${(error as Error).message}`)
      return undefined
    }
  }
}

/**
 * Register the convention skill provider in the calling context's skill-registry layer.
 * @param ctx - plugin context with the `skills` service injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  let provider: ConventionSkillProvider | undefined
  ctx.skills.registerProvider((control) => {
    provider = new ConventionSkillProvider(ctx.logger, control, resolved)
    return provider
  })
  ctx.effect(() => () => { provider?.dispose() }, 'air-skill-conventions.watcher')
}
