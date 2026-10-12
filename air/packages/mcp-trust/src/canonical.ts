/**
 * RFC 8785 (JCS) canonicalization and SHA-256 digests of MCP tool surfaces.
 * Input is rejected unless it is I-JSON, because the hashed bytes are chosen
 * by the server. Strings are never Unicode-normalized.
 * @module
 */

import { createHash } from 'node:crypto'
import canonicalize from 'canonicalize'

/** A value that has no I-JSON form (lone surrogate, non-finite number, non-JSON type). */
export class NonIJsonError extends Error {
  /** @param message - where the value failed and why. */
  constructor(message: string) {
    super(message)
    this.name = 'NonIJsonError'
  }
}

/**
 * Require an I-JSON value: plain objects, arrays, well-formed strings and
 * keys, finite numbers, booleans, and null.
 * @param value - candidate value.
 * @param path - JSON path used in the error message.
 * @throws NonIJsonError naming the first offending path.
 */
export function assertIJson(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new NonIJsonError(`${path}: string contains a lone surrogate`)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NonIJsonError(`${path}: number is not finite`)
    return
  }
  if (typeof value !== 'object') throw new NonIJsonError(`${path}: ${typeof value} is not a JSON value`)
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertIJson(item, `${path}[${String(index)}]`)
    return
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NonIJsonError(`${path}: value is not a plain object`)
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key.isWellFormed()) throw new NonIJsonError(`${path}: object key contains a lone surrogate`)
    assertIJson(item, `${path}.${key}`)
  }
}

/**
 * Canonical JSON text of an I-JSON value.
 * @param value - value to serialize.
 * @returns the RFC 8785 serialization.
 * @throws NonIJsonError when the value is not I-JSON.
 */
export function jcs(value: unknown): string {
  assertIJson(value)
  const text = canonicalize(value)
  /* v8 ignore next -- assertIJson rejected every input that canonicalize maps to undefined */
  if (text === undefined) throw new NonIJsonError('$: value has no canonical form')
  return text
}

/** `sha256:<hex>` of UTF-8 text. */
function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/**
 * Digest of a value's canonical JSON text.
 * @param value - I-JSON value.
 * @returns `sha256:` followed by 64 lowercase hex characters.
 */
export function sha256Jcs(value: unknown): string {
  return sha256(jcs(value))
}

/** Tool definition members covered by the tool digest; `icons` and `_meta` are excluded. */
export const DIGEST_FIELDS = ['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations', 'execution'] as const

/** The members of an MCP tool definition that the digest reads. */
export interface DigestableTool {
  readonly name: string
  readonly title?: unknown
  readonly description?: unknown
  readonly inputSchema?: unknown
  readonly outputSchema?: unknown
  readonly annotations?: unknown
  readonly execution?: unknown
}

/** Digests and the hashed projection of one tool definition. */
export interface ToolDigest {
  /** Digest over every present digest field. */
  digest: string
  /** One digest per present field other than `name`. */
  fields: Record<string, string>
  /** The hashed projection, stored so a later diff can show text. */
  definition: Record<string, unknown>
}

/**
 * Digest one tool definition.
 * @param tool - definition as fetched from the server.
 * @returns whole-tool digest, per-field digests, and the hashed projection.
 * @throws NonIJsonError when a hashed field is not I-JSON.
 */
export function digestTool(tool: DigestableTool): ToolDigest {
  const definition: Record<string, unknown> = {}
  const fields: Record<string, string> = {}
  for (const field of DIGEST_FIELDS) {
    const value = tool[field]
    if (value === undefined) continue
    definition[field] = value
    if (field !== 'name') fields[field] = sha256Jcs(value)
  }
  return { digest: sha256Jcs(definition), fields, definition }
}

/**
 * Digest raw server instructions.
 * @param text - instructions without attribution.
 * @returns the digest of the UTF-8 text, or `null` for empty text.
 * @throws NonIJsonError when the text contains a lone surrogate.
 */
export function digestInstructions(text: string): string | null {
  if (text === '') return null
  assertIJson(text, 'instructions')
  return sha256(text)
}

/**
 * Digest a whole surface.
 * @param instructionsDigest - digest of pinned instructions, or `null` when none are pinned.
 * @param tools - tool digest per raw tool name.
 * @returns the digest of `{ instructions, tools }`.
 */
export function digestSurface(instructionsDigest: string | null, tools: Readonly<Record<string, string>>): string {
  return sha256Jcs({ instructions: instructionsDigest, tools })
}
