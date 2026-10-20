import { describe, expect, it } from 'vitest'
import { parseMemoryFile, renderMemoryFile } from '../src/frontmatter.ts'
import { MemoryId, MemoryScopeId, type MemoryFrontmatter } from '../src/types.ts'

const FRONTMATTER: MemoryFrontmatter = {
  id: MemoryId('mem_aaaaaaaa'),
  type: 'feedback',
  scope: MemoryScopeId('project:0123456789abcdef'),
  description: 'Run tests before every commit',
  created: '2026-09-29T10:00:00.000Z',
  updated: '2026-09-29T11:00:00.000Z',
  valid_from: '2026-09-29T10:00:00.000Z',
  valid_to: null,
  supersedes: MemoryId('mem_bbbbbbbb'),
  superseded_by: null,
  importance: 4,
  source: { kind: 'user-confirmed', session: 'session-1', seq: 42 },
  trust: 'high',
  last_recalled: null,
}

function fileWith(lines: string[]): string {
  return ['---', ...lines, '---', '', 'body'].join('\n')
}

const VALID_LINES = [
  'id: mem_aaaaaaaa',
  'type: user',
  'scope: user',
  'description: Prefers neovim',
  'created: 2026-09-29T10:00:00Z',
  'updated: 2026-09-29T10:00:00Z',
  'valid_from: 2026-09-29T10:00:00Z',
  'valid_to: null',
  'supersedes: null',
  'superseded_by: null',
  'importance: 3',
  'source: { kind: agent-inferred }',
  'trust: high',
  'last_recalled: null',
]

describe('memory file format', () => {
  it('round-trips frontmatter and body', () => {
    const text = renderMemoryFile(FRONTMATTER, '  The user asked for this twice.\n\n')
    expect(text.startsWith('---\nid: mem_aaaaaaaa\ntype: feedback\n')).toBe(true)
    expect(text.endsWith('---\n\nThe user asked for this twice.\n')).toBe(true)
    expect(parseMemoryFile(text)).toEqual({ frontmatter: FRONTMATTER, body: 'The user asked for this twice.' })
  })

  it('round-trips a superseded memory', () => {
    const closed = { ...FRONTMATTER, superseded_by: MemoryId('mem_cccccccc'), valid_to: '2026-09-30T00:00:00.000Z' }
    expect(parseMemoryFile(renderMemoryFile(closed, 'x')).frontmatter).toEqual(closed)
  })

  it('omits absent source fields when rendering', () => {
    const text = renderMemoryFile({ ...FRONTMATTER, source: { kind: 'user-stated' } }, 'x')
    expect(text).toContain('source:\n  kind: user-stated\ntrust: high\n')
  })

  it('recomputes trust from the source kind instead of reading it', () => {
    const parsed = parseMemoryFile(fileWith(VALID_LINES))
    expect(parsed.frontmatter.trust).toBe('low')
    expect(parsed.frontmatter.source).toEqual({ kind: 'agent-inferred' })
    expect(parsed.body).toBe('body')
  })

  it('accepts a file without the optional trust line', () => {
    const lines = VALID_LINES.filter(line => !line.startsWith('trust:'))
    expect(parseMemoryFile(fileWith(lines)).frontmatter.trust).toBe('low')
  })

  it('reads a file saved by a Windows editor (byte-order mark, CRLF)', () => {
    const text = `\uFEFF${fileWith(VALID_LINES.filter(line => !line.startsWith('trust:'))).replaceAll('\n', '\r\n')}`
    expect(parseMemoryFile(text)).toMatchObject({ frontmatter: { id: 'mem_aaaaaaaa' }, body: 'body' })
  })

  it('rejects text without a frontmatter block', () => {
    expect(() => parseMemoryFile('just text')).toThrow('memory file has no frontmatter block')
    expect(() => parseMemoryFile('---\nid: mem_aaaaaaaa\n')).toThrow('memory file has no frontmatter block')
  })

  it('rejects invalid YAML', () => {
    expect(() => parseMemoryFile('---\nid: [unclosed\n---\nbody')).toThrow('memory frontmatter is not valid YAML')
  })

  it.each([
    ['an unknown key', [...VALID_LINES, 'extra: 1']],
    ['a bad id', VALID_LINES.map(line => (line.startsWith('id:') ? 'id: ../x' : line))],
    ['a bad type', VALID_LINES.map(line => (line.startsWith('type:') ? 'type: secret' : line))],
    ['a bad scope', VALID_LINES.map(line => (line.startsWith('scope:') ? 'scope: team' : line))],
    ['a bad time', VALID_LINES.map(line => (line.startsWith('created:') ? 'created: yesterday' : line))],
    ['a bad importance', VALID_LINES.map(line => (line.startsWith('importance:') ? 'importance: 9' : line))],
    ['a bad source kind', VALID_LINES.map(line => (line.startsWith('source:') ? 'source: { kind: rumor }' : line))],
    ['a multi-line description', VALID_LINES.map(line => (line.startsWith('description:') ? 'description: "a\\nb"' : line))],
  ])('rejects %s', (_label, lines) => {
    expect(() => parseMemoryFile(fileWith(lines))).toThrow('memory frontmatter is invalid')
  })
})
