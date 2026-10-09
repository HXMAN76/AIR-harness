/** Parses Claude Code project `.mcp.json` files into MCP client specifications. */
import { isRecord } from '@air/dsh-convention-core'

/** One server to connect, with every `${VAR}` already expanded. */
export type ServerSpec =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: string[]
    readonly env: Record<string, string>
    /** Working directory of the server process: the session cwd. */
    readonly cwd: string
    /** The entry as written in the file (`${VAR}` unexpanded) in canonical JSON; the approval identity. */
    readonly definition: string
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Record<string, string>
    /** The entry as written in the file (`${VAR}` unexpanded) in canonical JSON; the approval identity. */
    readonly definition: string
  }

/** Values that are not part of the file. */
export interface ParseOptions {
  /** Session working directory, used as the cwd of stdio servers. */
  readonly cwd: string
  /** Environment read by `${VAR}` expansion. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Same grammar upstream `mcp-client` accepts for `serverName`. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu

/**
 * Serialize parsed JSON with object keys sorted at every depth, so two files that differ only in key
 * order produce the same text.
 * @param value - a value produced by `JSON.parse`.
 * @returns the canonical JSON text.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Expand `${VAR}` and `${VAR:-default}`.
 * @param value - text from the file.
 * @param env - environment mapping.
 * @returns the expanded text.
 * @throws when a variable without a default is unset.
 */
export function expandEnv(value: string, env: Readonly<Record<string, string | undefined>>): string {
  return value.replace(VARIABLE, (_match: string, variable: string, fallback: string | undefined) => {
    const resolved = env[variable] ?? fallback
    if (resolved === undefined) throw new Error(`environment variable ${variable} is not set`)
    return resolved
  })
}

function stringList(value: unknown, field: string, options: ParseOptions): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`"${field}" must be a list of strings`)
  }
  return value.map(item => expandEnv(item, options.env))
}

function stringMap(value: unknown, field: string, options: ParseOptions): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`"${field}" must be an object of strings`)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`"${field}.${key}" must be a string`)
    result[key] = expandEnv(item, options.env)
  }
  return result
}

function parseServer(serverName: string, raw: unknown, options: ParseOptions): ServerSpec {
  if (!SERVER_NAME.test(serverName)) throw new Error('server name must match [A-Za-z0-9_-]{1,32}')
  if (!isRecord(raw)) throw new Error('server entry must be an object')
  const definition = canonicalJson(raw)
  const url = raw['url']
  const command = raw['command']
  const type = raw['type'] ?? (typeof url === 'string' ? 'http' : 'stdio')
  if (type === 'stdio') {
    if (typeof command !== 'string') throw new Error('a stdio server requires a "command" string')
    return {
      transport: 'stdio',
      serverName,
      command: expandEnv(command, options.env),
      args: stringList(raw['args'], 'args', options),
      env: stringMap(raw['env'], 'env', options),
      cwd: options.cwd,
      definition,
    }
  }
  if (type === 'http' || type === 'streamable-http') {
    if (typeof url !== 'string') throw new Error('an http server requires a "url" string')
    return {
      transport: 'streamable-http',
      serverName,
      url: expandEnv(url, options.env),
      headers: stringMap(raw['headers'], 'headers', options),
      definition,
    }
  }
  throw new Error(`transport type ${JSON.stringify(type)} is not supported; use stdio or http`)
}

/**
 * Parse a `.mcp.json` document.
 * @param text - file content; a leading byte-order mark (written by some Windows editors) is ignored.
 * @param options - session cwd and environment.
 * @returns valid servers in file order, and one problem line per rejected entry or document error.
 */
export function parseMcpJson(text: string, options: ParseOptions): { servers: ServerSpec[]; problems: string[] } {
  let document: unknown
  try {
    document = JSON.parse(text.replace(/^﻿/u, ''))
  } catch (error: unknown) {
    return { servers: [], problems: [`.mcp.json is not valid JSON: ${(error as Error).message}`] }
  }
  const table = isRecord(document) ? document['mcpServers'] : undefined
  if (!isRecord(table)) return { servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] }
  const servers: ServerSpec[] = []
  const problems: string[] = []
  for (const [serverName, raw] of Object.entries(table)) {
    try {
      servers.push(parseServer(serverName, raw, options))
    } catch (error: unknown) {
      problems.push(`${serverName}: ${(error as Error).message}`)
    }
  }
  return { servers, problems }
}
