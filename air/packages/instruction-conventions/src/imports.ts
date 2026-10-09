/** Resolves Claude Code `@path` imports found in instruction files. */
import { dirname, resolve } from 'node:path'
import { expandHome, fileSize, isInside, readTextFile, realpathIfPresent } from '@air/dsh-convention-core'

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
  readonly reason: 'outside-project' | 'max-hops' | 'sensitive' | 'too-large'
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
}

const FENCE = /^(?:```|~~~)/u
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u
/** Directories that hold credentials; any path through one is never imported. */
const SENSITIVE_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])
const SENSITIVE_FILES = /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.npmrc|\.netrc|credentials|.*\.(?:pem|key|p12|pfx))$/iu

/**
 * Test whether a path looks like a credential file: an `.env*` file, an SSH key, a certificate or key
 * file, `.npmrc`, `.netrc`, or any file under `.ssh`, `.aws`, `.gnupg`, `.kube`, or `.docker`.
 * @param path - absolute path with `/` or `\` separators.
 * @returns true when the file must not be sent to a model through an import.
 */
export function isSensitivePath(path: string): boolean {
  const segments = path.split(/[\\/]/u)
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return segments.slice(0, -1).some(segment => SENSITIVE_DIRECTORIES.has(segment.toLowerCase())) || SENSITIVE_FILES.test(name)
}

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
  const realRoots = await Promise.all(lexicalRoots.map(async root => (await realpathIfPresent(root)) ?? root))
  const permitted = (roots: readonly string[], path: string): boolean => roots.some(root => isInside(root, path))
  const visit = async (file: InstructionFile, hop: number): Promise<void> => {
    for (const written of findImportPaths(file.content)) {
      const target = resolve(dirname(file.path), expandHome(written, options.home))
      if (visited.has(pathKey(target))) continue
      visited.add(pathKey(target))
      if (!permitted(lexicalRoots, target)) {
        skipped.push({ path: target, reason: 'outside-project' })
        continue
      }
      const real = await realpathIfPresent(target)
      if (real === undefined) continue
      visited.add(pathKey(real))
      if (!permitted(realRoots, real)) {
        skipped.push({ path: target, reason: 'outside-project' })
        continue
      }
      if (isSensitivePath(target) || isSensitivePath(real)) {
        skipped.push({ path: target, reason: 'sensitive' })
        continue
      }
      const size = await fileSize(real)
      if (size === undefined) continue
      if (size > options.maxFileBytes) {
        skipped.push({ path: target, reason: 'too-large' })
        continue
      }
      if (hop + 1 > MAX_IMPORT_HOPS) {
        skipped.push({ path: target, reason: 'max-hops' })
        continue
      }
      const content = await readTextFile(real)
      /* v8 ignore next -- the size was read a moment ago; only a concurrent delete reaches this. */
      if (content === undefined) continue
      const imported = { path: target, content }
      files.push(imported)
      await visit(imported, hop + 1)
    }
  }
  for (const seed of seeds) await visit(seed, 0)
  return { files, skipped }
}
