/**
 * Sidecar audit of trust decisions as JSON Lines under one directory:
 * `process.jsonl` for drift seen by the process, and `<sessionId>.jsonl` for
 * the surface each session's turns ran against. Nothing is written to a
 * session log, so sessions stay loadable by builds without this plugin.
 *
 * Records are single JSON values, one per line, so server-supplied text with
 * embedded newlines cannot start a forged record. The review display cuts
 * server text at a fixed length; the audit keeps it whole: the full text of
 * every added or changed tool definition and of changed instructions is stored
 * once, by SHA-256 of its stored JSON, in `blobs/<hex>.json`, and a record names
 * it as `sha256:<hex>`. Each log file rotates to one previous file
 * (`<name>.jsonl.1`) when it would pass the size limit; blobs are not rotated,
 * and their number grows with the number of distinct changed definitions.
 * @module
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DriftRecord } from './engine.ts'
import { lockKey } from './lockfile.ts'
import type { ObservedSurface, ServerTrustState } from './types.ts'
import { hasDrift } from './verdict.ts'

/** Digest of one stored full-text blob, as `sha256:<hex>`; the file is `blobs/<hex>.json`. */
export type AuditBlobDigest = string

/** Full text of one tool definition, stored in a blob. */
export interface AuditDefinitionRef {
  /** Raw tool name as the server listed it. */
  tool: string
  blob: AuditBlobDigest
}

/** Full-text references shared by surface and drift records. */
export interface AuditFullText {
  /** Complete definitions of added and changed tools; absent when there are none. */
  definitions?: AuditDefinitionRef[]
  /** Complete server instructions, stored as a JSON string, when they changed or the server is new. */
  instructionsBlob?: AuditBlobDigest
}

/** Why a session's turn ran against one server's surface. */
export interface AuditSurfaceData extends AuditFullText {
  serverName: string
  /** Identity of the server definition, when it has one. */
  reviewKey?: string
  surfaceDigest: string
  verdict: ServerTrustState
  /** Raw tool names fetched but not registered. */
  withheld: readonly string[]
  /** `surfaceDigest` of the lock entry used, when one existed. */
  lockfileDigest?: string
}

/** Drift as written to a file: the engine's record plus references to the full text. */
export type AuditDriftData = DriftRecord & AuditFullText

/** One line of an audit file. */
export type AuditRecord = { sessionId?: string; turn?: number; time: string } & (
  | { type: 'mcp/surface'; data: AuditSurfaceData }
  | { type: 'mcp/drift'; data: AuditDriftData }
)

/** Blobs a record refers to, by file name, with the text to store. */
type Blobs = Map<string, string>

/** Appends audit records; a failed write is reported and never interrupts a turn or changes a verdict. */
export class Audit {
  /** Last recorded `digest|state` per session and server definition; one small entry each for the life of the process. */
  private readonly recorded = new Map<string, Map<string, string>>()
  /** Tail of the write queue; every write waits for the previous one so lines never interleave. */
  private tail: Promise<void> = Promise.resolve()

  /**
   * @param dir - absolute audit directory, created owner-only on first write.
   * @param logger - receives write failures.
   * @param now - clock for record timestamps.
   * @param maxFileBytes - size a log file may reach before it rotates to `<name>.1`.
   */
  constructor(
    private readonly dir: string,
    private readonly logger: { error(message: string): void },
    private readonly now: () => Date,
    private readonly maxFileBytes: number,
  ) {}

  /**
   * Record drift observed by the process, with no session attached.
   * @param record - the differing review.
   * @param surface - the surface that was reviewed; its added and changed definitions and changed instructions are stored whole.
   */
  async drift(record: DriftRecord, surface?: ObservedSurface): Promise<void> {
    const blobs: Blobs = new Map()
    const text = surface === undefined ? {} : fullText(surface, blobs)
    await this.append('process', [{ time: this.now().toISOString(), type: 'mcp/drift', data: { ...record, ...text } }], blobs)
  }

  /**
   * Record the surfaces a session's turn runs against. A server is recorded
   * when its surface digest or state differs from the last record of that
   * session.
   * @param sessionId - session whose turn opened.
   * @param turn - turn number.
   * @param surfaces - latest observed surface of every reviewed server.
   */
  async recordTurn(sessionId: string, turn: number, surfaces: readonly ObservedSurface[]): Promise<void> {
    const seen = this.recorded.get(sessionId) ?? new Map<string, string>()
    this.recorded.set(sessionId, seen)
    const time = this.now().toISOString()
    const records: AuditRecord[] = []
    const blobs: Blobs = new Map()
    for (const surface of surfaces) {
      const server = lockKey(surface.serverName, surface.reviewKey)
      const key = `${surface.surfaceDigest}|${surface.state}`
      if (seen.get(server) === key) continue
      seen.set(server, key)
      const text = fullText(surface, blobs)
      records.push({
        sessionId, turn, time, type: 'mcp/surface',
        data: {
          serverName: surface.serverName,
          ...surface.reviewKey === undefined ? {} : { reviewKey: surface.reviewKey },
          surfaceDigest: surface.surfaceDigest,
          verdict: surface.state,
          withheld: surface.withheld,
          ...surface.pinnedDigest === undefined ? {} : { lockfileDigest: surface.pinnedDigest },
          ...text,
        },
      })
      if (hasDrift(surface.diff)) {
        records.push({
          sessionId, turn, time, type: 'mcp/drift',
          data: {
            serverName: surface.serverName,
            ...surface.reviewKey === undefined ? {} : { reviewKey: surface.reviewKey },
            ...surface.diff,
            action: surface.action,
            ...text,
          },
        })
      }
    }
    if (records.length > 0) await this.append(sessionId, records, blobs)
  }

  private append(name: string, records: readonly AuditRecord[], blobs: Blobs): Promise<void> {
    const file = join(this.dir, `${name.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`)
    const text = records.map(record => `${JSON.stringify(record)}\n`).join('')
    const run = this.tail.then(async () => {
      try {
        await this.write(file, text, blobs)
      } catch (error) {
        /* v8 ignore next -- the fs calls above only throw Error instances */
        const why = error instanceof Error ? error.message : String(error)
        this.logger.error(`mcp-trust: audit write to ${file} failed: ${why}`)
      }
    })
    this.tail = run
    return run
  }

  private async write(file: string, text: string, blobs: Blobs): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    // Blobs first, so a record never names text that is not on disk.
    for (const [name, content] of blobs) await this.writeBlob(name, content)
    const size = await sizeOf(file)
    if (size > 0 && size + Buffer.byteLength(text) > this.maxFileBytes) await rename(file, `${file}.1`)
    await appendFile(file, text, { mode: 0o600 })
  }

  private async writeBlob(name: string, content: string): Promise<void> {
    const path = join(this.dir, 'blobs', name)
    if (await sizeOf(path) > 0) return
    await writeFileAtomic(path, content, { mode: 0o600, dirMode: 0o700 })
  }
}

/** Size of a file in bytes; 0 when it does not exist. */
async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch (error) {
    /* v8 ignore next -- only a stat failure other than a missing file reaches the rethrow */
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return 0
  }
}

/** Queue one blob and return its digest. */
function store(blobs: Blobs, value: unknown): AuditBlobDigest {
  const content = JSON.stringify(value)
  const hex = createHash('sha256').update(content).digest('hex')
  blobs.set(`${hex}.json`, content)
  return `sha256:${hex}`
}

/**
 * Select the text a record must keep whole: definitions of added and changed
 * tools, and the instructions when they changed or the server has no pin.
 */
function fullText(surface: ObservedSurface, blobs: Blobs): AuditFullText {
  const names = new Set([...surface.diff.added, ...surface.diff.changed.map(entry => entry.tool)])
  const definitions = surface.tools
    .filter(tool => names.has(tool.name))
    .map((tool): AuditDefinitionRef => ({ tool: tool.name, blob: store(blobs, tool) }))
  const keepInstructions = surface.diff.instructionsChanged || (surface.state === 'unpinned' && surface.instructions !== '')
  return {
    ...definitions.length === 0 ? {} : { definitions },
    ...keepInstructions ? { instructionsBlob: store(blobs, surface.instructions) } : {},
  }
}
