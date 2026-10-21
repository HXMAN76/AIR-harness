import { describe, expect, it } from 'vitest'
import { isCurrent, MemoryId, MemoryScopeId, trustOf, USER_SCOPE, type MemoryFrontmatter } from '../src/types.ts'

function frontmatter(patch: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    id: MemoryId('mem_aaaaaaaa'),
    type: 'user',
    scope: USER_SCOPE,
    description: 'Prefers neovim',
    created: '2026-09-29T10:00:00.000Z',
    updated: '2026-09-29T10:00:00.000Z',
    valid_from: '2026-09-29T10:00:00.000Z',
    valid_to: null,
    supersedes: null,
    superseded_by: null,
    importance: 3,
    source: { kind: 'user-confirmed' },
    trust: 'high',
    last_recalled: null,
    ...patch,
  }
}

describe('memory ids', () => {
  it('accepts well-formed ids and scopes', () => {
    expect(MemoryId('mem_0123abcd')).toBe('mem_0123abcd')
    expect(MemoryScopeId('user')).toBe('user')
    expect(MemoryScopeId('project:0123456789abcdef')).toBe('project:0123456789abcdef')
  })

  it.each(['../etc/passwd', 'mem_', 'mem_ABCDEFGH', '/abs/mem_aaaaaaaa', 'mem_aaaaaaaa/../x'])('rejects the id %s', (value) => {
    expect(() => MemoryId(value)).toThrow(TypeError)
  })

  it.each(['project:', 'project:../x', 'team', 'project:0123456789ABCDEF'])('rejects the scope %s', (value) => {
    expect(() => MemoryScopeId(value)).toThrow(TypeError)
  })
})

describe('trust and validity', () => {
  it('derives trust from the source kind', () => {
    expect(trustOf('user-stated')).toBe('high')
    expect(trustOf('user-confirmed')).toBe('high')
    expect(trustOf('agent-inferred')).toBe('low')
    expect(trustOf('tool-derived:web_fetch')).toBe('untrusted')
  })

  it('treats superseded and expired memories as not current', () => {
    const now = Date.parse('2026-10-01T00:00:00.000Z')
    expect(isCurrent(frontmatter(), now)).toBe(true)
    expect(isCurrent(frontmatter({ superseded_by: MemoryId('mem_bbbbbbbb') }), now)).toBe(false)
    expect(isCurrent(frontmatter({ valid_to: '2026-09-30T00:00:00.000Z' }), now)).toBe(false)
    expect(isCurrent(frontmatter({ valid_to: '2026-10-02T00:00:00.000Z' }), now)).toBe(true)
  })
})
