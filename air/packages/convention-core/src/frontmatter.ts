/** YAML frontmatter parsing and typed field readers for Markdown convention files. */
import { parse as parseYaml } from 'yaml'

/** A Markdown document split into frontmatter fields and body. */
export interface ParsedDocument {
  /** Frontmatter mapping; empty when the document has none. */
  readonly data: Record<string, unknown>
  /** Text after the closing `---`, or the whole text when there is no frontmatter. */
  readonly body: string
  /** Whether a complete frontmatter block was present. */
  readonly hasFrontmatter: boolean
}

/**
 * Narrow a value to a plain object.
 * @param value - value to test.
 * @returns true for non-null, non-array objects.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Split a Markdown document into YAML frontmatter and body.
 * @param raw - file content.
 * @returns the parsed fields and body; a document without a complete block has no fields.
 * @throws when the block is not valid YAML or is not a mapping.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const lines = text.split('\n')
  const first = lines[0]
  if (first === undefined || stripCarriageReturn(first) !== '---') return { data: {}, body: text, hasFrontmatter: false }
  const close = lines.findIndex((line, index) => index > 0 && stripCarriageReturn(line) === '---')
  if (close < 0) return { data: {}, body: text, hasFrontmatter: false }
  const body = lines.slice(close + 1).join('\n')
  const parsed: unknown = parseYaml(lines.slice(1, close).map(stripCarriageReturn).join('\n'))
  if (parsed === null || parsed === undefined) return { data: {}, body, hasFrontmatter: true }
  if (!isRecord(parsed)) throw new TypeError('frontmatter must be a YAML mapping')
  return { data: parsed, body, hasFrontmatter: true }
}

/**
 * Read a non-empty string field.
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns the string, or undefined when absent, empty, or not a string.
 */
export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read a boolean field.
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns the boolean, or undefined when absent.
 * @throws TypeError when the value is neither a boolean nor the text `true` or `false`.
 */
export function booleanField(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const text = value.toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function splitList(value: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (char === ',' || /\s/u.test(char))) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  items.push(current)
  return items
}

/**
 * Read a list-of-strings field. Claude Code writes these either as a YAML list or as one string
 * separated by commas or spaces; separators inside parentheses belong to the item (`Bash(git add:*)`).
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns trimmed non-empty items, or undefined when the field is absent or null.
 * @throws TypeError when the value is neither a string nor a list of strings.
 */
export function stringListField(data: Record<string, unknown>, key: string): string[] | undefined {
  const value = data[key]
  if (value === undefined || value === null) return undefined
  let items: string[]
  if (typeof value === 'string') items = splitList(value)
  else if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) items = value
  else throw new TypeError(`frontmatter field "${key}" must be a string or a list of strings`)
  return items.map(item => item.trim()).filter(item => item.length > 0)
}
