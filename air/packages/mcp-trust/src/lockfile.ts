/**
 * The MCP trust lockfile: approved tool definitions per local server name.
 * Readers take no lock because every commit is an atomic rename; writers
 * serialize through the sibling `.lock` file of `dsh-atomic-write`.
 * @module
 */

import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Lockfile format version this build reads and writes. */
export const LOCK_VERSION = 1

/** Canonicalization and hash named in every lockfile. */
export const CANONICALIZATION = 'RFC8785-JCS/SHA-256'

/** Who wrote an approval: the `air-mcp` command line, a slash command, the approval prompt, or trust on first use. */
export type ApprovedBy = 'cli' | 'command' | 'prompt' | 'tofu'

const APPROVERS: readonly string[] = ['cli', 'command', 'prompt', 'tofu']

/** Sentence appended to every lockfile read error, so the person knows the file is untouched and what to do. */
const REPAIR = 'The file was not changed. Repair it, or move it aside and pin each server again.'
const DIGEST = /^sha256:[0-9a-f]{64}$/
const IDENTITY = /^[0-9a-f]{64}$/

/** One approved tool definition. */
export interface LockTool {
  digest: string
  fields: Record<string, string>
  definition: Record<string, unknown>
  approvedAt: string
  approvedBy: ApprovedBy
}

/** The approved surface of one server, keyed by its local name. */
export interface LockServer {
  /**
   * `approvalKey` (64 lowercase hex) of the server specification the pin was taken for: project root,
   * server name, unexpanded definition, and working directory. When present, a pin applies only to a
   * server whose current `approvalKey` is equal. Absent means the pin is by name alone.
   */
  identity?: string
  surfaceDigest: string
  instructions?: { digest: string; text: string }
  tools: Record<string, LockTool>
}

/** The whole lockfile. */
export interface LockDocument {
  version: typeof LOCK_VERSION
  canonicalization: typeof CANONICALIZATION
  servers: Record<string, LockServer>
}

/** The lockfile is unreadable or does not have the supported format. */
export class LockfileError extends Error {
  /** @param message - the offending path or field and why it was rejected. */
  constructor(message: string) {
    super(message)
    this.name = 'LockfileError'
  }
}

/**
 * A lockfile with no servers.
 * @returns a fresh empty document.
 */
export function emptyLock(): LockDocument {
  return { version: LOCK_VERSION, canonicalization: CANONICALIZATION, servers: bare() }
}

/** Null-prototype record, so a key such as `__proto__` stays data. */
function bare<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

/** Message of a caught value; `fs`, `JSON.parse`, and the parsers here only throw `Error` instances. */
function reason(error: unknown): string {
  /* v8 ignore next -- the throwing calls above never throw a non-Error */
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LockfileError(`${path} must be an object`)
  }
  return Object.assign(bare<unknown>(), value)
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new LockfileError(`${path} must be a string`)
  return value
}

function digest(value: unknown, path: string): string {
  const candidate = text(value, path)
  if (!DIGEST.test(candidate)) throw new LockfileError(`${path} must be a sha256 digest`)
  return candidate
}

function parseApprover(value: unknown, path: string): ApprovedBy {
  const candidate = text(value, path)
  for (const approver of ['cli', 'command', 'prompt', 'tofu'] as const) {
    if (candidate === approver) return approver
  }
  throw new LockfileError(`${path} must be one of ${APPROVERS.join(', ')}`)
}

function parseTool(value: unknown, path: string): LockTool {
  const raw = record(value, path)
  const fields = bare<string>()
  for (const [field, fieldDigest] of Object.entries(record(raw['fields'], `${path}.fields`))) {
    fields[field] = digest(fieldDigest, `${path}.fields.${field}`)
  }
  return {
    digest: digest(raw['digest'], `${path}.digest`),
    fields,
    definition: record(raw['definition'], `${path}.definition`),
    approvedAt: text(raw['approvedAt'], `${path}.approvedAt`),
    approvedBy: parseApprover(raw['approvedBy'], `${path}.approvedBy`),
  }
}

function parseServer(value: unknown, path: string): LockServer {
  const raw = record(value, path)
  const tools = bare<LockTool>()
  for (const [name, tool] of Object.entries(record(raw['tools'], `${path}.tools`))) {
    tools[name] = parseTool(tool, `${path}.tools.${name}`)
  }
  const server: LockServer = { surfaceDigest: digest(raw['surfaceDigest'], `${path}.surfaceDigest`), tools }
  if (raw['identity'] !== undefined) {
    const identity = text(raw['identity'], `${path}.identity`)
    if (!IDENTITY.test(identity)) throw new LockfileError(`${path}.identity must be 64 lowercase hex characters`)
    server.identity = identity
  }
  if (raw['instructions'] !== undefined) {
    const instructions = record(raw['instructions'], `${path}.instructions`)
    server.instructions = {
      digest: digest(instructions['digest'], `${path}.instructions.digest`),
      text: text(instructions['text'], `${path}.instructions.text`),
    }
  }
  return server
}

/**
 * Validate a parsed JSON value as a lockfile. Members this build does not know are dropped, so a
 * later rewrite does not carry them.
 * @param value - result of `JSON.parse`.
 * @returns the validated document with null-prototype maps.
 * @throws LockfileError naming the first invalid field.
 */
export function parseLockDocument(value: unknown): LockDocument {
  const root = record(value, 'lockfile')
  if (root['version'] !== LOCK_VERSION) throw new LockfileError(`lockfile.version must be ${String(LOCK_VERSION)}`)
  if (root['canonicalization'] !== CANONICALIZATION) {
    throw new LockfileError(`lockfile.canonicalization must be ${CANONICALIZATION}`)
  }
  const servers = bare<LockServer>()
  for (const [name, server] of Object.entries(record(root['servers'], 'lockfile.servers'))) {
    servers[name] = parseServer(server, `lockfile.servers.${name}`)
  }
  return { version: LOCK_VERSION, canonicalization: CANONICALIZATION, servers }
}

/**
 * Read and validate the lockfile.
 * @param path - absolute lockfile path.
 * @returns the document; an absent file is an empty document.
 * @throws LockfileError naming the path and the repair when the file is unreadable, empty, truncated, not JSON, or invalid.
 */
export async function readLockfile(path: string): Promise<LockDocument> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return emptyLock()
    throw new LockfileError(`cannot read ${path}: ${reason(error)}. ${REPAIR}`)
  }
  // A Windows editor may save a byte order mark; CRLF line ends need no handling because JSON.parse accepts them.
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new LockfileError(`${path} is not JSON: ${reason(error)}. ${REPAIR}`)
  }
  try {
    return parseLockDocument(value)
  } catch (error) {
    throw new LockfileError(`${path} is invalid: ${reason(error)}. ${REPAIR}`)
  }
}

/**
 * Apply one change to the lockfile under the cross-process writer lock.
 * @param path - absolute lockfile path; its directory is created owner-only.
 * @param mutate - edits the freshly read document in place.
 * @param waitMs - longest wait for the writer lock.
 * @returns the committed document.
 * @throws LockfileError when the existing file is invalid (it is left untouched).
 */
export async function updateLockfile(
  path: string,
  mutate: (doc: LockDocument) => void,
  waitMs: number,
): Promise<LockDocument> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return await withFileLock(path, async () => {
    const doc = await readLockfile(path)
    mutate(doc)
    await writeFileAtomic(path, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    return doc
  }, { waitMs })
}

/**
 * Watch the lockfile's directory for replacements of the lockfile.
 * @param path - absolute lockfile path; its directory must exist.
 * @param onChange - called once per burst of changes to that file name.
 * @param debounceMs - quiet time that ends a burst.
 * @param onError - receives watcher failures.
 * @returns a disposer that stops watching and cancels a pending call.
 */
export function watchLockfile(
  path: string,
  onChange: () => void,
  debounceMs: number,
  onError: (error: Error) => void,
): () => void {
  const file = basename(path)
  let timer: NodeJS.Timeout | undefined
  const watcher = watch(dirname(path), (_event, changed) => {
    if (changed !== file) return
    clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
    timer.unref()
  })
  watcher.on('error', onError)
  watcher.unref()
  return () => {
    clearTimeout(timer)
    watcher.close()
  }
}
