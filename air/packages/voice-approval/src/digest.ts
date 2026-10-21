/** A digest of one exact tool call, so an approval token can be bound to the command it was spoken for. */
import { createHash } from 'node:crypto'

/** JSON with object keys sorted, so the same arguments always give the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * @param toolName - the tool called.
 * @param args - its arguments: the parsed object, or the JSON text the model wrote (an unparsable text is used as it is).
 * @returns the SHA-256 (hex) of the tool name and the canonical arguments.
 */
export function approvalDigest(toolName: string, args: unknown): string {
  let value = args
  if (typeof args === 'string') {
    try {
      value = JSON.parse(args)
    } catch {
      value = args
    }
  }
  return createHash('sha256').update(`${toolName}\n${canonicalJson(value)}`).digest('hex')
}
