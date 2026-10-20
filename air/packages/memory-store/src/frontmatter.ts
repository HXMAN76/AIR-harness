/**
 * Memory file format: a YAML frontmatter block between `---` lines, then a Markdown body.
 * @module @air/dsh-memory-store/frontmatter
 */

import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  MEMORY_ID_PATTERN,
  MEMORY_SCOPE_PATTERN,
  MEMORY_SOURCE_KIND_PATTERN,
  MEMORY_TYPES,
  MemoryId,
  MemoryScopeId,
  trustOf,
  type MemoryFrontmatter,
} from './types.ts'

const isoTime = z.string().refine(value => !Number.isNaN(Date.parse(value)), 'must be an ISO-8601 time')
const memoryId = z.string().regex(MEMORY_ID_PATTERN)

const frontmatterSchema = z.strictObject({
  id: memoryId,
  type: z.enum(MEMORY_TYPES),
  scope: z.string().regex(MEMORY_SCOPE_PATTERN),
  description: z.string().min(1).max(200).refine(value => !value.includes('\n'), 'must be one line'),
  created: isoTime,
  updated: isoTime,
  valid_from: isoTime,
  valid_to: isoTime.nullable(),
  supersedes: memoryId.nullable(),
  superseded_by: memoryId.nullable(),
  importance: z.number().int().min(1).max(5),
  source: z.strictObject({
    kind: z.string().regex(MEMORY_SOURCE_KIND_PATTERN),
    session: z.string().optional(),
    seq: z.number().int().nonnegative().optional(),
  }),
  trust: z.enum(['high', 'low', 'untrusted']).optional(),
  last_recalled: isoTime.nullable(),
})

/**
 * Parse and validate one memory file.
 * @param fileText - complete file text; a leading byte-order mark and CRLF line endings are accepted.
 * @returns validated frontmatter (trust recomputed from the source kind) and the trimmed body.
 * @throws Error when the frontmatter block is missing, is not YAML, or violates the schema.
 */
export function parseMemoryFile(fileText: string): { frontmatter: MemoryFrontmatter; body: string } {
  // Windows editors may add a byte-order mark and save CRLF line endings.
  const text = (fileText.startsWith('\uFEFF') ? fileText.slice(1) : fileText).replaceAll('\r\n', '\n')
  const end = text.startsWith('---\n') ? text.indexOf('\n---', 4) : -1
  if (end === -1) throw new Error('memory file has no frontmatter block')
  let raw: unknown
  try {
    raw = parse(text.slice(4, end))
  } catch (error: unknown) {
    throw new Error('memory frontmatter is not valid YAML', { cause: error })
  }
  const result = frontmatterSchema.safeParse(raw)
  if (!result.success) throw new Error(`memory frontmatter is invalid: ${result.error.message}`)
  const data = result.data
  return {
    frontmatter: {
      id: MemoryId(data.id),
      type: data.type,
      scope: MemoryScopeId(data.scope),
      description: data.description,
      created: data.created,
      updated: data.updated,
      valid_from: data.valid_from,
      valid_to: data.valid_to,
      supersedes: data.supersedes === null ? null : MemoryId(data.supersedes),
      superseded_by: data.superseded_by === null ? null : MemoryId(data.superseded_by),
      importance: data.importance,
      source: {
        kind: data.source.kind,
        ...data.source.session !== undefined ? { session: data.source.session } : {},
        ...data.source.seq !== undefined ? { seq: data.source.seq } : {},
      },
      trust: trustOf(data.source.kind),
      last_recalled: data.last_recalled,
    },
    body: text.slice(end + 4).trim(),
  }
}

/**
 * Render one memory file in a fixed key order.
 * @param frontmatter - the memory's fields; `trust` is recomputed from `source.kind`.
 * @param body - Markdown body; surrounding whitespace is dropped.
 * @returns the complete file text, ending in one newline.
 */
export function renderMemoryFile(frontmatter: MemoryFrontmatter, body: string): string {
  const header = stringify({
    id: frontmatter.id,
    type: frontmatter.type,
    scope: frontmatter.scope,
    description: frontmatter.description,
    created: frontmatter.created,
    updated: frontmatter.updated,
    valid_from: frontmatter.valid_from,
    valid_to: frontmatter.valid_to,
    supersedes: frontmatter.supersedes,
    superseded_by: frontmatter.superseded_by,
    importance: frontmatter.importance,
    source: {
      kind: frontmatter.source.kind,
      ...frontmatter.source.session !== undefined ? { session: frontmatter.source.session } : {},
      ...frontmatter.source.seq !== undefined ? { seq: frontmatter.source.seq } : {},
    },
    trust: trustOf(frontmatter.source.kind),
    last_recalled: frontmatter.last_recalled,
  })
  return `---\n${header}---\n\n${body.trim()}\n`
}
