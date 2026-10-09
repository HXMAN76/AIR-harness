/** Parses Claude Code project `.mcp.json` files into MCP client specifications. */
import { errorMessage, isRecord } from '@air/dsh-convention-core'

/** One server to connect, with every `${VAR}` already expanded. */
export type ServerSpec =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: string[]
    readonly env: Record<string, string>
    /** `env` exactly as written in the file (`${VAR}` unexpanded); shown to a person so the approval is informed. */
    readonly declared: Record<string, string>
    /** Working directory of the server process: the session cwd. */
    readonly cwd: string
    /** The entry as written in the file (`${VAR}` unexpanded) in canonical JSON; the approval identity. */
    readonly definition: string
    /** Command line exactly as written in the file (`${VAR}` unexpanded); the only form shown to a person. */
    readonly display: string
    /** Values that came from the environment and must never be shown; used to scrub third-party messages. */
    readonly secrets: string[]
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Record<string, string>
    /** `headers` exactly as written in the file (`${VAR}` unexpanded); shown to a person so the approval is informed. */
    readonly declared: Record<string, string>
    /** The entry as written in the file (`${VAR}` unexpanded) in canonical JSON; the approval identity. */
    readonly definition: string
    /** URL exactly as written in the file (`${VAR}` unexpanded); the only form shown to a person. */
    readonly display: string
    /** Values that came from the environment and must never be shown; used to scrub third-party messages. */
    readonly secrets: string[]
  }

/** Values that are not part of the file. */
export interface ParseOptions {
  /** Absolute path of the parsed file; named in document problems. */
  readonly file: string
  /** Session working directory, used as the cwd of stdio servers. */
  readonly cwd: string
  /** Environment read by `${VAR}` expansion. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Same grammar upstream `mcp-client` accepts for `serverName`. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu

/**
 * Render a server name that may not have been validated yet, so control and escape characters cannot reach a terminal.
 * @param name - key from the `mcpServers` object, or text a person typed.
 * @returns the name cut to 64 characters and written as a JSON string literal.
 */
export function quoteName(name: string): string {
  return JSON.stringify(name.length > 64 ? `${name.slice(0, 64)}...` : name)
}

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
 * @param onValue - called with each substituted value, so a caller can track what must not be shown.
 * @returns the expanded text.
 * @throws when a variable without a default is unset; the message names the variable, never a value.
 */
export function expandEnv(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
  onValue?: (resolved: string) => void,
): string {
  return value.replace(VARIABLE, (_match: string, variable: string, fallback: string | undefined) => {
    const resolved = env[variable] ?? fallback
    if (resolved === undefined) throw new Error(`environment variable ${variable} is not set`)
    onValue?.(resolved)
    return resolved
  })
}

/**
 * Replace every tracked secret in a message from outside this package.
 * @param text - message that may quote an expanded value.
 * @param secrets - values to hide.
 * @returns the text with each secret replaced by `[redacted]`.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let result = text
  for (const secret of [...secrets].filter(item => item.length > 0).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[redacted]')
  }
  return result
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`"${field}" must be a list of strings`)
  }
  return value
}

function stringMap(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`"${field}" must be an object of strings`)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`"${field}.${key}" must be a string`)
    result[key] = item
  }
  return result
}

/** Expand every value of a validated map; each value is treated as a secret. */
function expandMap(map: Record<string, string>, options: ParseOptions, secrets: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(map)) {
    result[key] = expandEnv(item, options.env, (value) => { secrets.push(value) })
    secrets.push(result[key])
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
  const secrets: string[] = []
  const expand = (value: string): string => expandEnv(value, options.env, (resolved) => { secrets.push(resolved) })
  if (type === 'stdio') {
    if (typeof command !== 'string') throw new Error('a stdio server requires a "command" string')
    const args = stringList(raw['args'], 'args')
    const env = stringMap(raw['env'], 'env')
    return {
      transport: 'stdio',
      serverName,
      command: expand(command),
      args: args.map(expand),
      env: expandMap(env, options, secrets),
      declared: env,
      cwd: options.cwd,
      definition,
      display: [command, ...args].join(' '),
      secrets,
    }
  }
  if (type === 'http' || type === 'streamable-http') {
    if (typeof url !== 'string') throw new Error('an http server requires a "url" string')
    const headers = stringMap(raw['headers'], 'headers')
    return {
      transport: 'streamable-http',
      serverName,
      url: expand(url),
      headers: expandMap(headers, options, secrets),
      declared: headers,
      definition,
      display: url,
      secrets,
    }
  }
  throw new Error('"type" is not supported; use stdio or http')
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
  } catch {
    // The parser message quotes a snippet of the file, which may hold secrets, so it is dropped.
    return { servers: [], problems: [`${options.file} is not valid JSON; fix its syntax and start a new session`] }
  }
  const table = isRecord(document) ? document['mcpServers'] : undefined
  if (!isRecord(table)) return { servers: [], problems: [`${options.file} must contain an "mcpServers" object`] }
  const servers: ServerSpec[] = []
  const problems: string[] = []
  for (const [serverName, raw] of Object.entries(table)) {
    try {
      servers.push(parseServer(serverName, raw, options))
    } catch (error: unknown) {
      problems.push(`${quoteName(serverName)}: ${errorMessage(error)}`)
    }
  }
  return { servers, problems }
}
