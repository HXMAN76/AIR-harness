/**
 * Memory files as the source of truth: Markdown with frontmatter under one root, one git commit
 * per write. Superseded and forgotten memories keep their files (`valid_to`, `superseded_by`);
 * only `forget(id, 'delete')` removes one.
 * @module @air/dsh-memory-store
 */

import { randomBytes } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-subprocess'
import { defaultMemoryRoot, memoryPath, scanMemoryFiles, sha256, type ScanCache } from './files.ts'
import { parseMemoryFile, renderMemoryFile } from './frontmatter.ts'
import { runGit } from './git.ts'
import { exportMemories, importMemories, type ExportReport, type ImportOptions, type ImportReport } from './transfer.ts'
import {
  isCurrent,
  MemoryId,
  trustOf,
  type MemoryFrontmatter,
  type MemoryRecord,
  type MemoryScopeId,
  type MemorySource,
  type MemoryType,
} from './types.ts'

export * from './types.ts'
export { exportMemories, importMemories } from './transfer.ts'
export type { ExportReport, ImportOptions, ImportReport } from './transfer.ts'
export { defaultMemoryRoot, memoryPath, scanMemoryFiles } from './files.ts'
export { parseMemoryFile, renderMemoryFile } from './frontmatter.ts'
export { runGit } from './git.ts'
export { activeProvider, routeAllows, routeLabel } from './route.ts'
export type { RouteAgent } from './route.ts'
export { canonicalRootText, projectScopeId } from './scope.ts'
export type { ScopeOptions } from './scope.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    airMemoryStore: MemoryStore
  }
}

/** Store configuration. Invalid values fail plugin load. */
export interface Config {
  /** Memory root directory. Omit to use `<DSH_HOME>/air/memory`. */
  root?: string
  /** git executable path or name. */
  gitPath: string
  /** Author and committer name of memory commits. */
  commitAuthorName: string
  /** Author and committer email of memory commits. */
  commitAuthorEmail: string
  /** Milliseconds one git command may run. */
  gitTimeoutMs: number
  /** Milliseconds a writer waits for another writer's lock. */
  lockWaitMs: number
  /** Model route ids (provider ids) that may receive memory text (pinned core, search and read results); `*` allows every route. */
  shareWith: string[]
}

/** Whether writes are also recorded as git commits. */
export interface Versioning {
  /** `git` while commits succeed; `files-only` after git failed, until a later commit succeeds. */
  state: 'git' | 'files-only'
  /** Why git failed, or `null` while commits succeed. */
  reason: string | null
}

/** Fields a caller supplies for a new memory; the store assigns id, times, and trust. */
export interface MemoryWriteInput {
  type: MemoryType
  scope: MemoryScopeId
  description: string
  body: string
  importance: number
  source: MemorySource
  /** Current memory of the same scope that the new one replaces. */
  supersedes?: MemoryId
}

const FILE_MODES = { mode: 0o600, dirMode: 0o700 } as const

function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

function sessionSuffix(session: string | undefined): string {
  return session === undefined ? '' : ` (session ${session})`
}

/**
 * Resolve the memory root.
 * @param config - store configuration.
 * @returns the configured root, or `<DSH_HOME>/air/memory`.
 */
export function resolveRoot(config: Config): string {
  return config.root ?? defaultMemoryRoot()
}

/** File-backed memory store, registered as `ctx.airMemoryStore`. */
export class MemoryStore extends Service {
  static Config: z<Config> = z.object({
    root: z.string().description('Memory root directory; omit to use <DSH_HOME>/air/memory.'),
    gitPath: z.string().default('git').description('git executable path or name.'),
    commitAuthorName: z.string().default('AIR memory').description('Author name of memory commits.'),
    commitAuthorEmail: z.string().default('air-memory@localhost').description('Author email of memory commits.'),
    gitTimeoutMs: z.natural().default(15_000).description('Milliseconds one git command may run.'),
    lockWaitMs: z.natural().default(10_000).description('Milliseconds a writer waits for the write lock.'),
    shareWith: z.array(z.string()).default(['ollama']).description('Model route ids that may receive memory text; * allows every route.'),
  })

  static inject = ['subprocess']

  /** Absolute memory root directory. */
  readonly root: string
  /** Model route ids that may receive memory text; the consumers that talk to a model check it. */
  readonly shareWith: readonly string[]

  private readonly cache: ScanCache = new Map()
  private writes = 0
  private versioningState: Versioning = { state: 'git', reason: null }

  constructor(ctx: Context, private readonly options: Config) {
    super(ctx, 'airMemoryStore')
    this.root = resolveRoot(options)
    this.shareWith = options.shareWith
  }

  /** Number of writes, forgets, and imports this process made; a reader compares it to skip needless work. */
  get generation(): number {
    return this.writes
  }

  /** Whether the latest write was also committed to git. */
  get versioning(): Versioning {
    return this.versioningState
  }

  /**
   * Read every valid memory file under the root. Symlinks, dot directories, `MEMORY.md`, and
   * files that fail validation are skipped; invalid files are reported once as warnings. Files
   * whose size and modification time are unchanged are not read again.
   * @param options - `includeSuperseded` also returns superseded and expired memories.
   * @returns records sorted by id.
   */
  async list(options: { includeSuperseded?: boolean } = {}): Promise<MemoryRecord[]> {
    const records = await scanMemoryFiles(this.root, this.cache, (message) => { this.ctx.logger.warn(message) })
    const now = Date.now()
    return records
      .filter(record => options.includeSuperseded === true || isCurrent(record.frontmatter, now))
      .sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id))
  }

  /**
   * Read one memory by id. The id is looked up among scanned files, never joined into a path.
   * @param id - memory id.
   * @returns the record, superseded or not, or `undefined` when no file has that id.
   */
  async read(id: MemoryId): Promise<MemoryRecord | undefined> {
    return (await this.list({ includeSuperseded: true })).find(record => record.frontmatter.id === id)
  }

  /**
   * Create a memory file and commit it. With `supersedes`, the replaced memory is closed
   * (`valid_to`, `superseded_by`) in the same commit and its file stays.
   * @param input - type, scope, text, importance, source, and the memory to replace, if any.
   * @param signal - cancels git commands.
   * @returns the new record.
   * @throws Error when the text violates the file schema, or the replaced memory is unknown, already superseded, or in another scope.
   */
  async write(input: MemoryWriteInput, signal: AbortSignal): Promise<MemoryRecord> {
    return this.locked(async () => {
      const now = new Date().toISOString()
      const id = MemoryId(`mem_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`)
      let previous: MemoryRecord | undefined
      if (input.supersedes !== undefined) {
        previous = await this.read(input.supersedes)
        if (previous === undefined) throw new Error(`memory ${input.supersedes} does not exist`)
        if (previous.frontmatter.superseded_by !== null) throw new Error(`memory ${input.supersedes} is already superseded`)
        if (previous.frontmatter.scope !== input.scope) throw new Error(`memory ${input.supersedes} belongs to another scope`)
      }
      const frontmatter: MemoryFrontmatter = {
        id,
        type: input.type,
        scope: input.scope,
        description: input.description,
        created: now,
        updated: now,
        valid_from: now,
        valid_to: null,
        supersedes: input.supersedes ?? null,
        superseded_by: null,
        importance: input.importance,
        source: input.source,
        trust: trustOf(input.source.kind),
        last_recalled: null,
      }
      const text = renderMemoryFile(frontmatter, input.body)
      // Validate the rendered text before anything reaches the disk.
      const parsed = parseMemoryFile(text)
      const path = memoryPath(input.scope, input.type, id)
      await writeFileAtomic(join(this.root, path), text, FILE_MODES)
      if (previous !== undefined) {
        const closed = { ...previous.frontmatter, updated: now, valid_to: now, superseded_by: id }
        await writeFileAtomic(join(this.root, previous.path), renderMemoryFile(closed, previous.body), FILE_MODES)
      }
      this.writes += 1
      await this.commit(`air-memory: write ${id}${sessionSuffix(input.source.session)}`, signal)
      return { ...parsed, path, hash: sha256(text) }
    })
  }

  /**
   * Forget one memory and commit the change.
   * @param id - memory id.
   * @param mode - `soft` ends the validity interval and keeps the file; `delete` removes the file (git history keeps it).
   * @param session - session named in the commit subject, when one asked.
   * @param signal - cancels git commands.
   * @returns false when no file has that id.
   */
  async forget(id: MemoryId, mode: 'soft' | 'delete', session: string | undefined, signal: AbortSignal): Promise<boolean> {
    return this.locked(async () => {
      const record = await this.read(id)
      if (record === undefined) return false
      if (mode === 'delete') {
        await rm(join(this.root, record.path))
      } else {
        const now = new Date().toISOString()
        const closed = { ...record.frontmatter, updated: now, valid_to: now }
        await writeFileAtomic(join(this.root, record.path), renderMemoryFile(closed, record.body), FILE_MODES)
      }
      this.writes += 1
      await this.commit(`air-memory: forget-${mode} ${id}${sessionSuffix(session)}`, signal)
      return true
    })
  }

  /**
   * Write every memory file to one JSON archive.
   * @param destination - archive path.
   * @returns the number of files exported.
   */
  exportTo(destination: string): Promise<ExportReport> {
    return exportMemories(this.root, destination)
  }

  /**
   * Add the memories of an archive that this store lacks, then commit them as one change.
   * Deliberately not a model tool: the person runs it.
   * @param source - archive written by {@link exportTo}.
   * @param options - `keepTrust` keeps high-trust sources; otherwise imported notes become `agent-inferred`.
   * @param signal - cancels git commands.
   * @returns counts of imported, skipped, and invalid entries.
   */
  async importFrom(source: string, options: Pick<ImportOptions, 'keepTrust'>, signal: AbortSignal): Promise<ImportReport> {
    const report = await importMemories(this.root, source, { ...options, lockWaitMs: this.options.lockWaitMs })
    if (report.imported > 0) {
      this.writes += 1
      await this.locked(() => this.commit(`air-memory: import ${String(report.imported)} memories`, signal))
    }
    return report
  }

  /** Run one write cycle under the cross-process lock; the repository is created on first use by {@link commit}. */
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(join(this.root, '.air', 'no-hooks'), { recursive: true, mode: 0o700 })
    return withFileLock(join(this.root, '.air', 'write'), operation, { waitMs: this.options.lockWaitMs })
  }

  /**
   * Commit everything under the root. A git failure (git missing, no repository rights, a hook,
   * a timeout) never fails the write: the files are already on disk, `versioning` turns to
   * `files-only` with the reason, and the next successful commit also records the changes
   * made in between.
   */
  private async commit(message: string, signal: AbortSignal): Promise<void> {
    try {
      if (!await exists(join(this.root, '.git'))) {
        await this.git(['-c', 'init.defaultBranch=main', 'init', '-q'], signal)
        await writeFileAtomic(join(this.root, '.gitignore'), '.air/\n', FILE_MODES)
        await writeFileAtomic(join(this.root, '.gitattributes'), '* text eol=lf\n', FILE_MODES)
      }
      await this.git(['add', '-A', '--', '.'], signal)
      await this.git([
        '-c', `user.name=${this.options.commitAuthorName}`,
        '-c', `user.email=${this.options.commitAuthorEmail}`,
        '-c', 'commit.gpgsign=false',
        '-c', 'core.autocrlf=false',
        '-c', `core.hooksPath=${join(this.root, '.air', 'no-hooks')}`,
        'commit', '-q', '--no-verify', '-m', message,
      ], signal)
      this.versioningState = { state: 'git', reason: null }
    } catch (error: unknown) {
      const reason = String(error)
      this.versioningState = { state: 'files-only', reason }
      this.ctx.logger.warn(`air-memory: saved as plain files, git did not record it: ${reason}`)
    }
  }

  private git(args: readonly string[], signal: AbortSignal): Promise<string> {
    return runGit(this.ctx.subprocess, this.options.gitPath, args, {
      cwd: this.root,
      timeoutMs: this.options.gitTimeoutMs,
      signal,
    })
  }
}

export default MemoryStore
