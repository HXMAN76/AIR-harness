/** Loads Markdown rule files under .claude/rules and matches path-scoped rules against touched files. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { listMarkdownTree, parseFrontmatter, readTextFile, stringListField } from '@air/dsh-convention-core'

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

/**
 * Load every rule file of a project.
 * @param projectRoot - project root directory.
 * @returns rules with non-empty bodies, and one problem line per file that failed to parse.
 */
export async function loadClaudeRules(projectRoot: string): Promise<{ rules: Rule[]; problems: string[] }> {
  const rules: Rule[] = []
  const problems: string[] = []
  for (const entry of await listMarkdownTree(join(projectRoot, '.claude', 'rules'), RULE_TREE_DEPTH)) {
    const raw = await readTextFile(entry.path)
    /* v8 ignore next -- the file was listed a moment ago; only a concurrent delete reaches this. */
    if (raw === undefined) continue
    try {
      const { data, body } = parseFrontmatter(raw)
      const globs = stringListField(data, 'paths') ?? []
      const content = body.trim()
      if (content.length === 0) continue
      rules.push({
        path: entry.path,
        relativePath: `.claude/rules/${entry.segments.join('/')}.md`,
        content,
        globs,
        digest: createHash('sha256').update(content).digest('hex').slice(0, 16),
      })
    } catch (error: unknown) {
      problems.push(`${entry.path}: ${(error as Error).message}`)
    }
  }
  return { rules, problems }
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
