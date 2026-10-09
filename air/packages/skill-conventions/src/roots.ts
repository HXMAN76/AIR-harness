/** The skill roots this provider scans and their precedence ranks. */
import { join } from 'node:path'
import type { SkillSource } from '@deepseek-ai/dsh-skill'
import type { UserHomes } from '@air/dsh-convention-core'

/**
 * One directory scanned for skills: `<dir>/SKILL.md` and flat `<name>.md`, one level.
 * Lower `rank` wins a duplicate name inside one registry layer.
 */
export interface SkillRoot {
  readonly path: string
  readonly source: SkillSource
  readonly rank: number
}

/** Inputs for {@link skillRoots}. */
export interface RootOptions {
  /** Project root of the lookup cwd; undefined for a lookup without a cwd. */
  readonly projectRoot: string | undefined
  readonly homes: UserHomes
  /** Whether `~/.agents/skills` and `~/.claude/skills` are scanned. */
  readonly includeUserRoots: boolean
  /** Extra skill directories relative to the project root, for example `.opencode/skills`. */
  readonly extraProjectRoots: readonly string[]
}

/**
 * List the roots for one lookup. Ranks match upstream `skill-filesystem` for `.dsh/skills` (100) and
 * `.agents/skills` (200); the remaining roots follow in the documented priority order.
 * @param options - project root, homes, and opt-in flags.
 * @returns roots in ascending rank order.
 */
export function skillRoots(options: RootOptions): SkillRoot[] {
  const { projectRoot, homes } = options
  const roots: SkillRoot[] = []
  if (projectRoot !== undefined) {
    roots.push(
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 },
      { path: join(projectRoot, '.claude', 'skills'), source: 'project-claude', rank: 220 },
    )
    for (const relativeRoot of options.extraProjectRoots) {
      roots.push({ path: join(projectRoot, relativeRoot), source: 'project-extra', rank: 240 })
    }
  }
  roots.push({ path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350 })
  if (options.includeUserRoots) {
    roots.push(
      { path: join(homes.agentsHome, 'skills'), source: 'user-agents', rank: 500 },
      { path: join(homes.claudeHome, 'skills'), source: 'user-claude', rank: 520 },
    )
  }
  return roots
}
