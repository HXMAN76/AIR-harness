/**
 * Pure trust decisions: resolve a server's policy, then compare one fetched
 * surface with its lock entry and decide what registers. No I/O.
 * @module
 */

import { digestInstructions, digestSurface, digestTool, type DigestableTool, type ToolDigest } from './canonical.ts'
import type { ApprovedBy, LockServer, LockTool } from './lockfile.ts'
import type { ServerPolicy, ServerTrustState, SurfaceDiff, TrustAction } from './types.ts'

const ENUMS = {
  mode: ['off', 'tofu', 'enforce'],
  onAdded: ['withhold', 'reject-generation'],
  onChanged: ['reject-generation', 'withhold'],
  onRemoved: ['accept', 'reject-generation'],
  instructions: ['pin', 'drop', 'accept'],
} as const

type EnumKey = keyof typeof ENUMS
const ENUM_KEYS = Object.keys(ENUMS) as EnumKey[]
const LIST_KEYS = ['allow', 'deny'] as const
const POLICY_KEYS: readonly string[] = [...ENUM_KEYS, ...LIST_KEYS, 'override']

function policyObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  for (const key of Object.keys(value)) {
    if (!POLICY_KEYS.includes(key)) throw new Error(`${path}.${key} is not a trust policy option`)
  }
  return value as Record<string, unknown>
}

function enumValue<K extends EnumKey>(merged: Record<string, unknown>, key: K, path: string): (typeof ENUMS)[K][number] {
  const value = merged[key]
  if (value === undefined) throw new Error(`${path}.${key} is required`)
  const allowed: readonly unknown[] = ENUMS[key]
  if (!allowed.includes(value)) throw new Error(`${path}.${key} must be one of ${ENUMS[key].join(', ')}`)
  return value as (typeof ENUMS)[K][number]
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${path} must be an array of strings`)
  }
  return value as string[]
}

function overrides(value: unknown, path: string): Record<string, { description: string }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  const entries: [string, { description: string }][] = []
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    const description = (entry as { description?: unknown } | null)?.description
    if (typeof description !== 'string') throw new Error(`${path}.${name}.description must be a string`)
    entries.push([name, { description }])
  }
  // fromEntries defines own properties, so a tool named `__proto__` stays data.
  return Object.fromEntries(entries)
}

/**
 * Resolve one server's policy from the configured defaults and its override.
 * @param defaults - `Config.defaults`; must supply every enum option.
 * @param override - `Config.servers[serverName]`, when present.
 * @param path - configuration path used in error messages.
 * @returns the complete policy.
 * @throws when a key is unknown, an enum value is invalid, or a required default is missing.
 */
export function resolvePolicy(defaults: unknown, override: unknown, path: string): ServerPolicy {
  const merged = { ...policyObject(defaults, path), ...policyObject(override, path) }
  return {
    mode: enumValue(merged, 'mode', path),
    onAdded: enumValue(merged, 'onAdded', path),
    onChanged: enumValue(merged, 'onChanged', path),
    onRemoved: enumValue(merged, 'onRemoved', path),
    instructions: enumValue(merged, 'instructions', path),
    ...merged['allow'] === undefined ? {} : { allow: stringList(merged['allow'], `${path}.allow`) },
    deny: merged['deny'] === undefined ? [] : stringList(merged['deny'], `${path}.deny`),
    override: merged['override'] === undefined ? {} : overrides(merged['override'], `${path}.override`),
  }
}

/**
 * A diff with no differences.
 * @returns a fresh empty diff.
 */
export function emptyDiff(): SurfaceDiff {
  return { added: [], removed: [], changed: [], instructionsChanged: false }
}

/**
 * Whether a diff reports any difference or an invalid surface.
 * @param diff - diff to inspect.
 * @returns true when something differs.
 */
export function hasDrift(diff: SurfaceDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0
    || diff.instructionsChanged || diff.invalid !== undefined
}

/**
 * Own entry of a name-keyed map. A plain object would also answer for `constructor` or `toString`.
 * @param map - map keyed by server-supplied names.
 * @param name - raw name.
 * @returns the entry, or `undefined` when `name` is not an own key.
 */
function own<T>(map: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.hasOwn(map, name) ? map[name] : undefined
}

/**
 * Build a lock entry from an instruction pin and approved tools.
 * @param instructions - pinned instructions, when any.
 * @param tools - approved tools by raw name.
 * @param identity - review key the entry is stored under (see `lockKey`), when the server has one.
 * @returns the entry with its surface digest recomputed.
 */
export function withTools(instructions: LockServer['instructions'], tools: Record<string, LockTool>, identity?: string): LockServer {
  const digests = Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, tool.digest]))
  return {
    ...identity === undefined ? {} : { identity },
    surfaceDigest: digestSurface(instructions?.digest ?? null, digests),
    ...instructions === undefined ? {} : { instructions },
    tools,
  }
}

/**
 * Build the lock entry that approves a digested surface.
 * @param digests - tool digests by raw name.
 * @param instructions - raw server instructions.
 * @param pinInstructions - whether instructions belong to the pin.
 * @param approvedBy - who approves.
 * @param approvedAt - ISO 8601 approval time.
 * @param identity - review key the entry is stored under (see `lockKey`), when the server has one.
 * @returns the entry.
 */
export function buildEntry(
  digests: ReadonlyMap<string, ToolDigest>,
  instructions: string,
  pinInstructions: boolean,
  approvedBy: ApprovedBy,
  approvedAt: string,
  identity?: string,
): LockServer {
  const tools = Object.fromEntries([...digests].map(([name, digest]) => [name, { ...digest, approvedAt, approvedBy }]))
  const instructionsDigest = pinInstructions ? digestInstructions(instructions) : null
  return withTools(instructionsDigest === null ? undefined : { digest: instructionsDigest, text: instructions }, tools, identity)
}

/**
 * Lock entry approving a whole surface, instructions included.
 * @param tools - tool definitions as fetched.
 * @param instructions - raw server instructions.
 * @param approvedBy - who approves.
 * @param approvedAt - ISO 8601 approval time.
 * @param identity - review key the entry is stored under (see `lockKey`), when the server has one.
 * @returns the entry.
 */
export function pinSurface(
  tools: readonly DigestableTool[],
  instructions: string,
  approvedBy: ApprovedBy,
  approvedAt: string,
  identity?: string,
): LockServer {
  const digests = new Map(tools.map(tool => [tool.name, digestTool(tool)] as const))
  return buildEntry(digests, instructions, true, approvedBy, approvedAt, identity)
}

/** Outcome of reviewing one fetched surface. */
export interface Decision<T> {
  /** Tools to register, with description overrides applied. */
  accepted: T[]
  /** Raw instructions to publish; empty withdraws them. */
  instructions: string
  diff: SurfaceDiff
  state: ServerTrustState
  action: TrustAction
  /** Raw names fetched but not registered because of the review. */
  withheld: string[]
  /** Raw names removed by `deny` or by an `allow` list. */
  denied: string[]
  /** Digest of the reviewed surface; empty when it is not canonicalizable. */
  surfaceDigest: string
  /** Digest of every reviewed tool by raw name. */
  digests: Map<string, ToolDigest>
  /** Entry to write when `tofu` mode pins a first surface. */
  tofu?: LockServer
}

function changedFields(pinned: Record<string, string>, observed: Record<string, string>): string[] {
  return [...new Set([...Object.keys(pinned), ...Object.keys(observed)])]
    .filter(field => own(pinned, field) !== own(observed, field))
    .sort()
}

/**
 * Decide what registers from one fetched surface.
 * @param input - policy, the one lock entry for this server definition (or none), fetched tools and instructions, the one-shot accepted
 *   surface digest, the current ISO time, and the review key for a new trust-on-first-use entry.
 * @returns the decision; see the decision table in the package README.
 */
export function decide<T extends DigestableTool>(input: {
  policy: ServerPolicy
  entry: LockServer | undefined
  tools: readonly T[]
  instructions: string
  acceptedOnce: string | undefined
  now: string
  /** Review key the entry is stored under; becomes `identity` of an entry written by trust on first use. */
  reviewKey?: string
}): Decision<T> {
  const { policy, entry } = input
  const denied: string[] = []
  const candidates = input.tools.filter((tool) => {
    const keep = !policy.deny.includes(tool.name) && (policy.allow === undefined || policy.allow.includes(tool.name))
    if (!keep) denied.push(tool.name)
    return keep
  })
  const names = candidates.map(tool => tool.name)
  const published = policy.instructions === 'drop' ? '' : input.instructions
  const overridden = (tool: T): T => {
    const override = own(policy.override, tool.name)
    return override === undefined ? tool : { ...tool, description: override.description }
  }
  const acceptAll = (state: ServerTrustState, rest: Pick<Decision<T>, 'diff' | 'surfaceDigest' | 'digests'>): Decision<T> => ({
    accepted: candidates.map(overridden), instructions: published, state, action: 'accept', withheld: [], denied, ...rest,
  })
  const acceptNone = (state: ServerTrustState, action: TrustAction, rest: Pick<Decision<T>, 'diff' | 'surfaceDigest' | 'digests'>): Decision<T> => ({
    accepted: [], instructions: '', state, action, withheld: names, denied, ...rest,
  })

  const digests = new Map<string, ToolDigest>()
  let instructionsDigest: string | null
  try {
    for (const tool of candidates) digests.set(tool.name, digestTool(tool))
    instructionsDigest = policy.instructions === 'pin' ? digestInstructions(input.instructions) : null
  } catch (error) {
    // The server chooses these bytes, so any digest failure is treated as drift, never as a match.
    const invalid = { diff: { ...emptyDiff(), invalid: error instanceof Error ? error.message : String(error) }, surfaceDigest: '', digests: new Map<string, ToolDigest>() }
    return policy.mode === 'off'
      ? acceptAll('unpinned', { ...invalid, diff: emptyDiff() })
      : acceptNone('quarantined', 'reject-generation', invalid)
  }
  const surfaceDigest = digestSurface(
    instructionsDigest,
    Object.fromEntries([...digests].map(([name, digest]) => [name, digest.digest])),
  )
  if (policy.mode === 'off') return acceptAll('unpinned', { diff: emptyDiff(), surfaceDigest, digests })

  const diff = emptyDiff()
  if (entry === undefined) {
    diff.added = names
  } else {
    for (const [name, digest] of digests) {
      const pinned = own(entry.tools, name)
      if (pinned === undefined) diff.added.push(name)
      else if (pinned.digest !== digest.digest) diff.changed.push({ tool: name, fields: changedFields(pinned.fields, digest.fields) })
    }
    diff.removed = Object.keys(entry.tools).filter(name => !digests.has(name))
    diff.instructionsChanged = policy.instructions === 'pin' && instructionsDigest !== (entry.instructions?.digest ?? null)
  }
  const rest = { diff, surfaceDigest, digests }

  if (input.acceptedOnce === surfaceDigest) return acceptAll('accepted-once', rest)
  if (entry === undefined) {
    if (policy.mode !== 'tofu') return acceptNone('unpinned', 'withhold', rest)
    return {
      ...acceptAll('tofu', { ...rest, diff: emptyDiff() }),
      tofu: buildEntry(digests, input.instructions, policy.instructions === 'pin', 'tofu', input.now, input.reviewKey),
    }
  }

  const reject = ((diff.changed.length > 0 || diff.instructionsChanged) && policy.onChanged === 'reject-generation')
    || (diff.added.length > 0 && policy.onAdded === 'reject-generation')
    || (diff.removed.length > 0 && policy.onRemoved === 'reject-generation')
  if (reject) return acceptNone('quarantined', 'reject-generation', rest)

  const withheld = [...diff.added, ...diff.changed.map(change => change.tool)]
  const accepted = candidates.filter(tool => !withheld.includes(tool.name))
  const partial = withheld.length > 0 || diff.instructionsChanged
  const tofuPinned = accepted.some(tool => own(entry.tools, tool.name)?.approvedBy === 'tofu')
  return {
    accepted: accepted.map(overridden),
    instructions: diff.instructionsChanged ? '' : published,
    state: partial ? 'withheld' : tofuPinned ? 'tofu' : 'approved',
    action: partial ? 'withhold' : 'accept',
    withheld,
    denied,
    ...rest,
  }
}
