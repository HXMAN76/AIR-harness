import { describe, expect, it } from 'vitest'
import {
  CLAUDE_TO_DSH_TOOL_NAMES,
  toClaudeToolNames,
  toDshToolName,
  translateToolNames,
} from '../src/index.ts'

describe('tool-name table', () => {
  it('maps Claude Code names to dsh names', () => {
    expect(CLAUDE_TO_DSH_TOOL_NAMES).toEqual({
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
  })

  it('passes MCP names through and rejects unknown names', () => {
    expect(toDshToolName('Edit')).toBe('edit')
    expect(toDshToolName('mcp__github__create_issue')).toBe('mcp__github__create_issue')
    expect(toDshToolName('NotebookEdit')).toBeUndefined()
    expect(toDshToolName('toString')).toBeUndefined()
  })

  it('maps a dsh name back to every Claude Code name', () => {
    expect(toClaudeToolNames('edit')).toEqual(['Edit', 'MultiEdit'])
    expect(toClaudeToolNames('agent')).toEqual(['Task', 'Agent'])
    expect(toClaudeToolNames('mcp__a__b')).toEqual(['mcp__a__b'])
    expect(toClaudeToolNames('jobs')).toEqual([])
  })

  it('translates a list, strips Tool(pattern) suffixes, dedups, and reports unknown names', () => {
    expect(translateToolNames(['Bash(git add:*)', 'Read', 'Edit', 'MultiEdit', 'Nope', 'mcp__x__y'])).toEqual({
      names: ['bash', 'read', 'edit', 'mcp__x__y'],
      unknown: ['Nope'],
    })
  })
})
