/** Assembles the model-facing text for the convention files that apply from the first request. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { directoriesBetween, readTextFile } from '@air/dsh-convention-core'
import { resolveImports, type InstructionFile, type SkippedImport } from './imports.ts'
import { loadClaudeRules } from './rules.ts'

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

async function readExisting(paths: readonly string[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  for (const path of paths) {
    const content = await readTextFile(path)
    if (content !== undefined) files.push({ path, content })
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
  if (blocks.length === 0 && notes.length === 0) return undefined
  const text = ['<air_instructions>', PREAMBLE, ...blocks, ...notes, '</air_instructions>'].join('\n')
  return { text, digest: sha256(text).slice(0, 16) }
}

/**
 * Read the convention files that apply to a session from its first request and render them.
 * @param input - workspace location, user-root opt-in, import allowlist, and byte budget.
 * @returns the baseline, or undefined when no file applies; plus rule-file parse problems.
 */
export async function composeBaseline(input: BaselineInput): Promise<{ baseline: Baseline | undefined; problems: string[] }> {
  const included = await readExisting([
    join(input.projectRoot, '.claude', 'CLAUDE.md'),
    ...input.includeUserRoots ? [join(input.claudeHome, 'CLAUDE.md')] : [],
  ])
  const chain = await readExisting(
    directoriesBetween(input.projectRoot, input.cwd).flatMap(directory => CHAIN_FILES.map(file => join(directory, file))),
  )
  const imports = await resolveImports([...included, ...chain], {
    projectRoot: input.projectRoot,
    allowedRoots: [...input.allowedImportRoots, ...input.includeUserRoots ? [input.claudeHome] : []],
    home: input.home,
    maxFileBytes: input.maxBytes,
  })
  const ruleSet = await loadClaudeRules(input.projectRoot)
  const always = ruleSet.rules
    .filter(rule => rule.globs.length === 0)
    .map(rule => ({ path: rule.path, content: rule.content }))
  return {
    baseline: render([...included, ...imports.files, ...always], imports.skipped, input.maxBytes),
    problems: ruleSet.problems,
  }
}
