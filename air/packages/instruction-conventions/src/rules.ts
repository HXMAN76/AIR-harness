/** Loads Markdown rule files under .claude/rules and matches path-scoped rules against touched files. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import picomatch from 'picomatch'
import {
  describeSkip,
  describeTruncation,
  fileSignature,
  listMarkdownTree,
  parseFrontmatter,
  readContained,
  stringListField,
} from '@air/dsh-convention-core'

/** Directory levels walked under `.claude/rules`. */
const RULE_TREE_DEPTH = 6

/** One rule file. A rule without globs applies always; a rule with globs applies after a matching file is touched. */
export interface Rule {
  readonly path: string
  /** Path relative to the project root with `/` separators, used as the rule's identity in message sources. */
  readonly relativePath: string
  readonly content: string
  /** `paths:` globs relative to the project root; empty for an always rule. */
  readonly globs: readonly string[]
  /** First 16 hex digits of the SHA-256 of `content`. */
  readonly digest: string
}

/** Size and entry limits for reading rule files. */
export interface RuleLimits {
  /** Largest rule file in bytes. */
  readonly maxFileBytes: number
  /** Most directory entries examined while walking `.claude/rules`. */
  readonly maxEntries: number
}

interface RuleOutcome {
  readonly rule?: Rule
  readonly problem?: string
}

interface CachedRule extends RuleOutcome {
  /** Identity of the file version the outcome was computed from. */
  readonly signature: string
}

/** Parsed rule files by path, reused while a file keeps its signature. Create one per plugin instance. */
export type RuleCache = Map<string, CachedRule>

/**
 * Load every rule file of a project. A rule file is read only when its real path is inside the project
 * root, it is not a credential-like file, and it is within the size limit; a refused file adds a problem
 * line naming the path and the reason.
 * @param projectRoot - project root directory.
 * @param limits - file size and walk entry limits.
 * @param cache - results of earlier calls; a file whose signature is unchanged is not read again.
 * @returns rules with non-empty bodies, and one problem line per file that failed to parse or was refused.
 */
export async function loadClaudeRules(
  projectRoot: string,
  limits: RuleLimits,
  cache: RuleCache = new Map(),
): Promise<{ rules: Rule[]; problems: string[] }> {
  const rules: Rule[] = []
  const problems: string[] = []
  const next: RuleCache = new Map()
  const directory = join(projectRoot, '.claude', 'rules')
  const tree = await listMarkdownTree(directory, RULE_TREE_DEPTH, { roots: [projectRoot], maxEntries: limits.maxEntries })
  for (const skipped of tree.skipped) problems.push(describeSkip(skipped.path, skipped.reason, limits.maxFileBytes))
  if (tree.truncated) problems.push(describeTruncation(directory, limits.maxEntries))
  for (const entry of tree.entries) {
    const signature = await fileSignature(entry.path)
    /* v8 ignore next -- the file was listed a moment ago; only a concurrent delete reaches this. */
    if (signature === undefined) continue
    const known = cache.get(entry.path)
    let result: CachedRule | undefined = known !== undefined && known.signature === signature ? known : undefined
    if (result === undefined) {
      const read = await readContained(entry.path, { roots: [projectRoot], maxBytes: limits.maxFileBytes })
      /* v8 ignore next -- the file was listed a moment ago; only a concurrent delete reaches this. */
      if (read.kind === 'absent') continue
      const outcome = read.kind === 'ok'
        ? parseRule(entry, read.text)
        : { problem: describeSkip(entry.path, read.kind, limits.maxFileBytes) }
      result = Object.assign({}, outcome, { signature })
    }
    next.set(entry.path, result)
    if (result.problem !== undefined) problems.push(result.problem)
    if (result.rule !== undefined) rules.push(result.rule)
  }
  cache.clear()
  for (const [path, result] of next) cache.set(path, result)
  return { rules, problems }
}

function parseRule(entry: { path: string; segments: readonly string[] }, raw: string): RuleOutcome {
  try {
    const { data, body } = parseFrontmatter(raw)
    const globs = stringListField(data, 'paths') ?? []
    const content = body.trim()
    if (content.length === 0) return {}
    const digest = createHash('sha256').update(content).digest('hex').slice(0, 16)
    return { rule: { path: entry.path, relativePath: `.claude/rules/${entry.segments.join('/')}.md`, content, globs, digest } }
  } catch (error: unknown) {
    return { problem: `${entry.path}: ${(error as Error).message}` }
  }
}

/**
 * Select the path-scoped rules that apply to one file.
 * @param rules - rules from {@link loadClaudeRules}.
 * @param relativeFilePath - file path relative to the project root with `/` separators (`toPosixRelative`).
 *   Globs follow POSIX rules on every platform and match case-sensitively.
 * @returns rules with at least one matching glob; always rules are never returned.
 */
export function matchingRules(rules: readonly Rule[], relativeFilePath: string): Rule[] {
  return rules.filter(rule => rule.globs.length > 0 && picomatch.isMatch(relativeFilePath, [...rule.globs], { dot: true, windows: false }))
}
