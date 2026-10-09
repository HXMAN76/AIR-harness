/** Claude Code tool names and their dsh equivalents, shared by skills, agents, hooks, and permission rules. */

/** Claude Code tool name to dsh tool name. MCP names (`mcp__server__tool`) are identical on both sides. */
export const CLAUDE_TO_DSH_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Bash: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'todo_write',
  Task: 'agent',
  Agent: 'agent',
  AskUserQuestion: 'ask_user_question',
})

const MCP_PREFIX = 'mcp__'

/**
 * Translate one Claude Code tool name.
 * @param claudeName - bare tool name without a `(pattern)` suffix.
 * @returns the dsh tool name, or undefined when the table has no entry.
 */
export function toDshToolName(claudeName: string): string | undefined {
  if (claudeName.startsWith(MCP_PREFIX)) return claudeName
  return Object.hasOwn(CLAUDE_TO_DSH_TOOL_NAMES, claudeName) ? CLAUDE_TO_DSH_TOOL_NAMES[claudeName] : undefined
}

/**
 * List the Claude Code names that map to one dsh tool name.
 * @param dshName - dsh tool name.
 * @returns matching Claude Code names in table order; empty when none map to it.
 */
export function toClaudeToolNames(dshName: string): string[] {
  if (dshName.startsWith(MCP_PREFIX)) return [dshName]
  return Object.entries(CLAUDE_TO_DSH_TOOL_NAMES)
    .filter(([, mapped]) => mapped === dshName)
    .map(([claudeName]) => claudeName)
}

/**
 * Translate a list of Claude Code tool entries such as `Read` or `Bash(git add:*)`.
 * @param claudeNames - entries from `allowed-tools`, `tools`, or a permission rule list.
 * @returns distinct dsh names in first-seen order, plus the entries the table does not know.
 */
export function translateToolNames(claudeNames: readonly string[]): { names: string[]; unknown: string[] } {
  const names: string[] = []
  const unknown: string[] = []
  for (const entry of claudeNames) {
    const open = entry.indexOf('(')
    const bare = (open < 0 ? entry : entry.slice(0, open)).trim()
    const mapped = toDshToolName(bare)
    if (mapped === undefined) unknown.push(entry)
    else if (!names.includes(mapped)) names.push(mapped)
  }
  return { names, unknown }
}
