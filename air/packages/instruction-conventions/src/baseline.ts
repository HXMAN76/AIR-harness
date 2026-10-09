/** Assembles the model-facing text for the convention files that apply from the first request. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describeSkip, directoriesBetween, readContained } from '@air/dsh-convention-core'
import { resolveImports, type InstructionFile, type SkippedImport } from './imports.ts'
import { loadClaudeRules, type RuleCache } from './rules.ts'

/** Files upstream `agent-instructions` injects itself; here they only start import chains. */
const CHAIN_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']

const PREAMBLE = 'These project convention files apply to this workspace. Follow them together with the other workspace instructions.'

/** Inputs for {@link composeBaseline}. */
export interface BaselineInput {
  /** Session working directory. */
  readonly cwd: string
  readonly projectRoot: string
  /** Claude Code home (`~/.claude`). */
  readonly claudeHome: string
  /** Home directory used to expand `@~/...` imports. */
  readonly home: string
  /** Whether `<claudeHome>/CLAUDE.md` is read and `claudeHome` is an allowed import root. */
  readonly includeUserRoots: boolean
  /** Absolute directories outside the project whose files may be imported. */
  readonly allowedImportRoots: readonly string[]
  /** UTF-8 byte budget for included file blocks. */
  readonly maxBytes: number
  /** Largest single file read, including seed files, imports, and rules, in bytes. */
  readonly maxFileBytes: number
  /** Most directory entries examined while walking `.claude/rules`. */
  readonly maxEntries: number
  /** Most `@path` imports followed in one file. */
  readonly maxImportsPerFile: number
  /** Parsed rules from earlier calls; supplied by a plugin that composes more than once. */
  readonly ruleCache?: RuleCache
}

/** The assembled text and its identity. */
export interface Baseline {
  readonly text: string
  /** First 16 hex digits of the SHA-256 of `text`; a changed digest means the text must be injected again. */
  readonly digest: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function attribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** Read seed files that exist; a file refused by the containment, credential, size, or type check becomes a problem line. */
async function readExisting(paths: readonly string[], root: string, input: BaselineInput, problems: string[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  for (const path of paths) {
    const read = await readContained(path, { roots: [root], maxBytes: input.maxFileBytes })
    if (read.kind === 'ok') files.push({ path, content: read.text })
    else if (read.kind !== 'absent') problems.push(describeSkip(path, read.kind, input.maxFileBytes))
  }
  return files
}

function render(files: readonly InstructionFile[], skipped: readonly SkippedImport[], maxBytes: number): Baseline | undefined {
  const seen = new Set<string>()
  const blocks: string[] = []
  const notes = skipped.map(item => `<skipped path="${attribute(item.path)}" reason="${item.reason}"/>`)
  let bytes = 0
  for (const file of files) {
    const content = file.content.trim()
    const identity = sha256(content)
    if (content.length === 0 || seen.has(identity)) continue
    seen.add(identity)
    const block = `<file path="${attribute(file.path)}">\n${content}\n</file>`
    const size = Buffer.byteLength(block)
    if (bytes + size > maxBytes) {
      notes.push(`<skipped path="${attribute(file.path)}" reason="budget"/>`)
      continue
    }
    bytes += size
    blocks.push(block)
  }
  // Notes spend the same budget as file blocks; the rest are counted in one fixed-size note.
  const kept: string[] = []
  for (const note of notes) {
    const size = Buffer.byteLength(note)
    if (bytes + size > maxBytes) continue
    bytes += size
    kept.push(note)
  }
  if (kept.length < notes.length) kept.push(`<skipped reason="notes-omitted" count="${notes.length - kept.length}"/>`)
  if (blocks.length === 0 && kept.length === 0) return undefined
  const text = ['<air_instructions>', PREAMBLE, ...blocks, ...kept, '</air_instructions>'].join('\n')
  return { text, digest: sha256(text).slice(0, 16) }
}

/**
 * Read the convention files that apply to a session from its first request and render them.
 * @param input - workspace location, user-root opt-in, import allowlist, and byte budget.
 * @returns the baseline, or undefined when no file applies; plus rule-file parse problems.
 */
export async function composeBaseline(input: BaselineInput): Promise<{ baseline: Baseline | undefined; problems: string[] }> {
  const problems: string[] = []
  const included = [
    ...await readExisting([join(input.projectRoot, '.claude', 'CLAUDE.md')], input.projectRoot, input, problems),
    ...input.includeUserRoots ? await readExisting([join(input.claudeHome, 'CLAUDE.md')], input.claudeHome, input, problems) : [],
  ]
  const chain = await readExisting(
    directoriesBetween(input.projectRoot, input.cwd).flatMap(directory => CHAIN_FILES.map(file => join(directory, file))),
    input.projectRoot,
    input,
    problems,
  )
  const imports = await resolveImports([...included, ...chain], {
    projectRoot: input.projectRoot,
    allowedRoots: [...input.allowedImportRoots, ...input.includeUserRoots ? [input.claudeHome] : []],
    home: input.home,
    maxFileBytes: input.maxFileBytes,
    maxImportsPerFile: input.maxImportsPerFile,
  })
  const limits = { maxFileBytes: input.maxFileBytes, maxEntries: input.maxEntries }
  const ruleSet = await loadClaudeRules(input.projectRoot, limits, input.ruleCache)
  const always = ruleSet.rules
    .filter(rule => rule.globs.length === 0)
    .map(rule => ({ path: rule.path, content: rule.content }))
  return {
    baseline: render([...included, ...imports.files, ...always], imports.skipped, input.maxBytes),
    problems: [...problems, ...ruleSet.problems],
  }
}
