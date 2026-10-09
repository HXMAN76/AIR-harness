/** Resolves Claude Code `@path` imports found in instruction files. */
import { dirname, resolve } from 'node:path'
import { expandHome, isInside, readContained, realpathIfPresent } from '@air/dsh-convention-core'

/** Claude Code follows imports at most this many files deep from the file that starts the chain. */
export const MAX_IMPORT_HOPS = 4

/** An instruction file with its content. */
export interface InstructionFile {
  readonly path: string
  readonly content: string
}

/** An import that was found but not read. */
export interface SkippedImport {
  readonly path: string
  readonly reason: 'outside-project' | 'max-hops' | 'sensitive' | 'too-large' | 'import-limit'
}

/** Containment and size settings for {@link resolveImports}. */
export interface ImportOptions {
  readonly projectRoot: string
  /** Absolute directories outside the project whose files may be imported. */
  readonly allowedRoots: readonly string[]
  /** Home directory used to expand `@~/...`. */
  readonly home: string
  /** Largest imported file in bytes; a larger file is skipped without being read. */
  readonly maxFileBytes: number
  /** Most `@path` tokens followed in one file; the rest are skipped with one `import-limit` entry for that file. */
  readonly maxImportsPerFile: number
}

const FENCE = /^(?:```|~~~)/u
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u
function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * List the `@path` tokens in Markdown text. A token starts a line or follows whitespace.
 * Fenced code blocks and inline code spans are ignored.
 * @param text - instruction file content.
 * @returns paths as written, without the `@` and without trailing punctuation.
 */
export function findImportPaths(text: string): string[] {
  const paths: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line.trimStart())) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const token of line.replace(/`[^`]*`/gu, ' ').split(/\s+/u)) {
      if (!token.startsWith('@')) continue
      const path = token.slice(1).replace(TRAILING_PUNCTUATION, '')
      if (path.length > 0) paths.push(path)
    }
  }
  return paths
}

/**
 * Read every file reachable through `@path` imports from the seed files.
 * Relative paths resolve against the importing file's directory. A file is read once; seed files
 * are never returned. A path that is absent or not a regular file is ignored. A file is read only
 * when its path and its real path (symbolic links resolved) are inside the project root or an allowed
 * root, it is not a credential-like file, and it is no larger than `maxFileBytes`.
 * At most `maxImportsPerFile` tokens of one file are followed.
 * @param seeds - files whose content starts the import chains (hop 0).
 * @param options - project root, extra allowed roots, home directory, and size limit.
 * @returns imported files in depth-first document order, plus the imports that were not read.
 */
export async function resolveImports(
  seeds: readonly InstructionFile[],
  options: ImportOptions,
): Promise<{ files: InstructionFile[]; skipped: SkippedImport[] }> {
  const files: InstructionFile[] = []
  const skipped: SkippedImport[] = []
  const visited = new Set(seeds.map(seed => pathKey(resolve(seed.path))))
  const lexicalRoots = [options.projectRoot, ...options.allowedRoots]
  const visit = async (file: InstructionFile, hop: number): Promise<void> => {
    for (const [index, written] of findImportPaths(file.content).entries()) {
      if (index >= options.maxImportsPerFile) {
        skipped.push({ path: file.path, reason: 'import-limit' })
        break
      }
      const target = resolve(dirname(file.path), expandHome(written, options.home))
      if (visited.has(pathKey(target))) continue
      visited.add(pathKey(target))
      if (!lexicalRoots.some(root => isInside(root, target))) {
        skipped.push({ path: target, reason: 'outside-project' })
        continue
      }
      const real = await realpathIfPresent(target)
      if (real === undefined) continue
      visited.add(pathKey(real))
      const read = await readContained(target, { roots: lexicalRoots, maxBytes: options.maxFileBytes })
      if (read.kind === 'absent' || read.kind === 'not-file') continue
      if (read.kind !== 'ok') {
        skipped.push({ path: target, reason: read.kind === 'outside-root' ? 'outside-project' : read.kind })
        continue
      }
      if (hop + 1 > MAX_IMPORT_HOPS) {
        skipped.push({ path: target, reason: 'max-hops' })
        continue
      }
      const content = read.text
      const imported = { path: target, content }
      files.push(imported)
      await visit(imported, hop + 1)
    }
  }
  for (const seed of seeds) await visit(seed, 0)
  return { files, skipped }
}
