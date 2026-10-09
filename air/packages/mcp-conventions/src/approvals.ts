/** The consent record for project MCP servers: which exact server definitions a person approved. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isRecord, readTextFile } from '@air/dsh-convention-core'
import type { ServerSpec } from './config.ts'

/** Identity of one approved server definition in one project. */
export type McpApprovalKey = Branded<'McpApprovalKey'>

function normalizedPath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Compute the approval identity of a server. The key covers the project root, the server name, the
 * entry exactly as written in `.mcp.json` (variables unexpanded), and for a stdio server the working
 * directory it runs in, so editing the command, arguments, URL, or any variable name, or running the
 * same definition from another directory, requires a new approval, while rotating the value of a
 * `${VAR}` does not. On Windows the project root and the working directory compare without regard to
 * letter case.
 * @param projectRoot - absolute project root that holds the `.mcp.json`.
 * @param spec - parsed server.
 * @returns a 64-digit hex SHA-256.
 */
export function approvalKey(projectRoot: string, spec: ServerSpec): McpApprovalKey {
  const cwd = spec.transport === 'stdio' ? normalizedPath(spec.cwd) : null
  const canonical = [normalizedPath(projectRoot), spec.serverName, spec.definition, cwd]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex') as McpApprovalKey
}

/**
 * Retry budget for replacing the approvals file. On Windows `rename` over a file that another process
 * has open fails with `EPERM` or `EBUSY` until that process closes it, so a few short retries ride out
 * antivirus scans and indexers without hiding a lasting lock.
 */
const RENAME_ATTEMPTS = 5
const RENAME_DELAY_MS = 100

/** File operations the store uses; tests replace them. */
export interface ApprovalIo {
  readonly rename: (from: string, to: string) => Promise<void>
  readonly sleep: (ms: number) => Promise<void>
}

/** Real file operations and a timer-based sleep. */
export const defaultApprovalIo: ApprovalIo = {
  rename,
  sleep: ms => new Promise<void>((done) => { setTimeout(done, ms) }),
}

/** What is stored beside a key so a person can read the file. */
export interface ApprovalRecord {
  readonly projectRoot: string
  readonly server: string
  /** Working directory the approved stdio server runs in; absent for an http server. */
  readonly cwd?: string
  /** ISO 8601 timestamp. */
  readonly approvedAt: string
}

/**
 * Reads and rewrites the approvals file. Reads see edits by another process. Writes from this process
 * run one at a time, so concurrent approvals do not overwrite each other; two processes writing at the
 * same instant can still lose one approval, which then has to be given again.
 */
export class ApprovalStore {
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param file - absolute path of the approvals file; it is created on the first approval.
   * @param io - file operations; replaced by tests.
   */
  constructor(private readonly file: string, private readonly io: ApprovalIo = defaultApprovalIo) {}

  /**
   * Test whether a key is approved.
   * @param key - approval identity.
   * @returns true when the file lists the key.
   * @throws when the file exists but is not an approvals file.
   */
  async has(key: McpApprovalKey): Promise<boolean> {
    return Object.hasOwn(await this.read(), key)
  }

  /**
   * Record an approval.
   * @param key - approval identity.
   * @param record - readable description stored with the key.
   */
  async add(key: McpApprovalKey, record: ApprovalRecord): Promise<void> {
    await this.serialized(async () => { await this.write({ ...await this.read(), [key]: record }) })
  }

  /**
   * Remove an approval.
   * @param key - approval identity.
   */
  async remove(key: McpApprovalKey): Promise<void> {
    await this.serialized(async () => {
      const approved = await this.read()
      await this.write(Object.fromEntries(Object.entries(approved).filter(([existing]) => existing !== key)))
    })
  }

  private serialized(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task)
    // A failed write is reported to its own caller; the queue only orders the writes after it.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async read(): Promise<Record<string, unknown>> {
    const text = await readTextFile(this.file)
    if (text === undefined) return {}
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      // The parser message quotes file content; the file only holds hashes and paths, but stay uniform.
      throw new Error(`air-mcp-conventions: ${this.file} is not an approvals file`)
    }
    const approved = isRecord(document) ? document['approved'] : undefined
    if (!isRecord(approved)) throw new Error(`air-mcp-conventions: ${this.file} is not an approvals file`)
    return approved
  }

  private async write(approved: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    // Mode 0600 applies on POSIX; on Windows the file inherits the private ACL of the user profile.
    await writeFile(temporary, `${JSON.stringify({ version: 1, approved }, undefined, 2)}\n`, { mode: 0o600 })
    await this.replace(temporary)
  }

  private async replace(temporary: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.io.rename(temporary, this.file)
        return
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code
        const locked = code === 'EPERM' || code === 'EBUSY'
        if (locked && attempt < RENAME_ATTEMPTS) {
          await this.io.sleep(RENAME_DELAY_MS)
          continue
        }
        await rm(temporary, { force: true })
        if (!locked) throw error
        throw new Error(`air-mcp-conventions: ${this.file} could not be replaced because another process holds it open; close that process and approve again`)
      }
    }
  }
}
