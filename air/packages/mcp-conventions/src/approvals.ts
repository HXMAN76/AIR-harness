/** The consent record for project MCP servers: which exact server definitions a person approved. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isRecord, readTextFile } from '@air/dsh-convention-core'
import type { ServerSpec } from './config.ts'

/** Identity of one approved server definition in one project. */
export type McpApprovalKey = Branded<'McpApprovalKey'>

function normalizedRoot(projectRoot: string): string {
  const absolute = resolve(projectRoot)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Compute the approval identity of a server. The key covers the project root, the server name, and
 * the entry exactly as written in `.mcp.json` (variables unexpanded), so editing the command,
 * arguments, URL, or any variable name requires a new approval, while rotating the value of a
 * `${VAR}` does not. On Windows the project root compares without regard to letter case.
 * @param projectRoot - absolute project root that holds the `.mcp.json`.
 * @param spec - parsed server.
 * @returns a 64-digit hex SHA-256.
 */
export function approvalKey(projectRoot: string, spec: ServerSpec): McpApprovalKey {
  const canonical = [normalizedRoot(projectRoot), spec.serverName, spec.definition]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex') as McpApprovalKey
}

/** What is stored beside a key so a person can read the file. */
export interface ApprovalRecord {
  readonly projectRoot: string
  readonly server: string
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

  /** @param file - absolute path of the approvals file; it is created on the first approval. */
  constructor(private readonly file: string) {}

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
    const document: unknown = JSON.parse(text)
    const approved = isRecord(document) ? document['approved'] : undefined
    if (!isRecord(approved)) throw new Error(`air-mcp-conventions: ${this.file} is not an approvals file`)
    return approved
  }

  private async write(approved: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    // Mode 0600 applies on POSIX; on Windows the file inherits the private ACL of the user profile.
    await writeFile(temporary, `${JSON.stringify({ version: 1, approved }, undefined, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
  }
}
