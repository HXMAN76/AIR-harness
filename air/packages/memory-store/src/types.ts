/**
 * Memory vocabulary: branded ids, memory types, trust derivation, and record fields.
 * @module @air/dsh-memory-store/types
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one memory file; also its file stem. */
export type MemoryId = Branded<'AirMemoryId'>

/** `user`, or `project:<16 hex>` for one workspace. */
export type MemoryScopeId = Branded<'AirMemoryScopeId'>

/** Ids are file stems, so the pattern admits no path separator or dot. */
export const MEMORY_ID_PATTERN = /^mem_[0-9a-z]{8,40}$/u

/** Scope ids are directory names under `projects/`, so the pattern admits no path separator or dot. */
export const MEMORY_SCOPE_PATTERN = /^(?:user|project:[0-9a-f]{16})$/u

/** Source kinds a memory file may record. */
export const MEMORY_SOURCE_KIND_PATTERN = /^(?:user-stated|user-confirmed|agent-inferred|tool-derived:[a-z0-9_-]+)$/u

/**
 * Validate and brand a memory id.
 * @param value - candidate id from a tool argument or a file.
 * @returns the branded id.
 * @throws TypeError when the value does not match {@link MEMORY_ID_PATTERN}.
 */
export function MemoryId(value: string): MemoryId {
  if (!MEMORY_ID_PATTERN.test(value)) throw new TypeError(`invalid memory id ${JSON.stringify(value)}`)
  return brandString<MemoryId>(value)
}

/**
 * Validate and brand a scope id.
 * @param value - candidate scope.
 * @returns the branded scope id.
 * @throws TypeError when the value does not match {@link MEMORY_SCOPE_PATTERN}.
 */
export function MemoryScopeId(value: string): MemoryScopeId {
  if (!MEMORY_SCOPE_PATTERN.test(value)) throw new TypeError(`invalid memory scope ${JSON.stringify(value)}`)
  return brandString<MemoryScopeId>(value)
}

/** The scope shared by every workspace. */
export const USER_SCOPE: MemoryScopeId = MemoryScopeId('user')

/** Memory types; each is a directory name. */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference', 'episode'] as const

/** One of {@link MEMORY_TYPES}. */
export type MemoryType = typeof MEMORY_TYPES[number]

/** How far a memory's source is trusted. */
export type MemoryTrust = 'high' | 'low' | 'untrusted'

/**
 * Derive trust from a source kind. The value is never read from a file or a model.
 * @param kind - a source kind matching {@link MEMORY_SOURCE_KIND_PATTERN}.
 * @returns `high` for user-stated or user-confirmed, `low` for agent-inferred, `untrusted` otherwise.
 */
export function trustOf(kind: string): MemoryTrust {
  if (kind === 'user-stated' || kind === 'user-confirmed') return 'high'
  if (kind === 'agent-inferred') return 'low'
  return 'untrusted'
}

/** Where a memory came from. */
export interface MemorySource {
  /** `user-stated`, `user-confirmed`, `agent-inferred`, or `tool-derived:<tool>`. */
  kind: string
  /** Session that wrote the memory, when one did. */
  session?: string | undefined
  /** Session log offset at the time of the write. */
  seq?: number | undefined
}

/** Frontmatter of one memory file. Times are ISO-8601 strings. */
export interface MemoryFrontmatter {
  id: MemoryId
  type: MemoryType
  scope: MemoryScopeId
  /** One line; shown in search results and the pinned core. */
  description: string
  created: string
  updated: string
  /** Start of the validity interval. */
  valid_from: string
  /** End of the validity interval; `null` while the memory is valid. */
  valid_to: string | null
  /** The memory this one replaced. */
  supersedes: MemoryId | null
  /** The memory that replaced this one. */
  superseded_by: MemoryId | null
  /** 1 (minor) to 5 (essential). */
  importance: number
  source: MemorySource
  /** Derived from `source.kind` on every parse and render. */
  trust: MemoryTrust
  last_recalled: string | null
}

/** One memory file as read from disk. */
export interface MemoryRecord {
  frontmatter: MemoryFrontmatter
  /** Markdown body without surrounding whitespace. */
  body: string
  /** Path relative to the memory root, with `/` separators. */
  path: string
  /** SHA-256 hex of the file text. */
  hash: string
}

/**
 * Whether a memory is neither superseded nor past its validity interval.
 * @param frontmatter - the memory's frontmatter.
 * @param now - Unix epoch milliseconds to compare `valid_to` against.
 * @returns true when the memory takes part in recall.
 */
export function isCurrent(frontmatter: MemoryFrontmatter, now: number): boolean {
  return frontmatter.superseded_by === null
    && (frontmatter.valid_to === null || Date.parse(frontmatter.valid_to) > now)
}
