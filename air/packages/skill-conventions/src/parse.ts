/** Parses skill files into skill metadata. */
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import {
  booleanField,
  isRecord,
  parseFrontmatter,
  stringField,
  stringListField,
  toKebabName,
} from '@air/dsh-convention-core'

/** Inputs that depend on where the file was found and on plugin configuration. */
export interface ParseOptions {
  /** Directory name or file stem used when the file declares no name. */
  readonly fallbackName: string
  /**
   * True for `<name>.md` directly in a skill root; such a file is a skill only when its frontmatter
   * has a `description`, so `README.md` is not listed.
   */
  readonly flat: boolean
  /** Longest description kept; longer text ends with an ellipsis. */
  readonly descriptionMaxChars: number
}

/** A parsed skill file. */
export interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly metadata?: Record<string, unknown>
  /** Trimmed Markdown body with placeholders left as written. */
  readonly body: string
}

const LIST_FIELDS = [
  ['allowed-tools', 'allowedTools'],
  ['disallowed-tools', 'disallowedTools'],
  ['arguments', 'arguments'],
  ['paths', 'paths'],
] as const

const STRING_FIELDS = [
  ['model', 'model'],
  ['context', 'context'],
  ['agent', 'agent'],
  ['argument-hint', 'argumentHint'],
] as const

function firstParagraph(body: string): string | undefined {
  for (const block of body.split(/\n\s*\n/u)) {
    const text = block.replace(/^\s*#+\s*/u, '').replace(/\s+/gu, ' ').trim()
    if (text.length > 0) return text
  }
  return undefined
}

function claudeCodeFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [key, target] of LIST_FIELDS) {
    const value = stringListField(data, key)
    if (value !== undefined) fields[target] = value
  }
  for (const [key, target] of STRING_FIELDS) {
    const value = stringField(data, key)
    if (value !== undefined) fields[target] = value
  }
  return fields
}

/**
 * Parse one skill file.
 * @param raw - file content.
 * @param options - fallback name, whether the file is flat, and the description limit.
 * @returns name, description, invocation policy, recorded Claude Code fields, and body; undefined for a flat file that is not a skill.
 * @throws when the YAML is invalid, a flag is not a boolean, no usable name remains, or no description can be derived.
 */
export function parseSkillText(raw: string, options: ParseOptions): ParsedSkillFile | undefined {
  const { data, body } = parseFrontmatter(raw)
  if (options.flat && stringField(data, 'description') === undefined) return undefined
  const declared = stringField(data, 'name') ?? options.fallbackName
  const name = toKebabName(declared)
  if (name === undefined) throw new Error(`invalid skill name "${declared}"`)
  const description = stringField(data, 'description') ?? firstParagraph(body)
  if (description === undefined) throw new Error('no description in frontmatter or body')
  const invocation: SkillInvocationPolicy = {
    modelInvocable: booleanField(data, 'disable-model-invocation') !== true,
    userInvocable: booleanField(data, 'user-invocable') !== false,
  }
  const whenToUse = stringField(data, 'when_to_use') ?? stringField(data, 'whenToUse')
  const claudeCode = claudeCodeFields(data)
  const declaredMetadata = data['metadata']
  const metadata: Record<string, unknown> = {
    ...isRecord(declaredMetadata) ? declaredMetadata : {},
    ...Object.keys(claudeCode).length > 0 ? { claudeCode } : {},
  }
  return {
    name,
    description: description.length <= options.descriptionMaxChars
      ? description
      : `${description.slice(0, options.descriptionMaxChars - 1)}…`,
    ...whenToUse !== undefined ? { whenToUse } : {},
    invocation,
    ...Object.keys(metadata).length > 0 ? { metadata } : {},
    body: body.trim(),
  }
}
