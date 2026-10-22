import { describe, expect, it } from 'vitest'
import { THINKING_LINE, progressLabel, toolLabel, withElapsed } from '../src/core/progress.ts'

describe('toolLabel', () => {
  it.each([
    ['pwsh', undefined, 'Running PowerShell…'],
    ['bash', undefined, 'Running PowerShell…'],
    ['web_fetch', undefined, 'Reading a web page…'],
    ['web_search', undefined, 'Searching the web…'],
    ['memory_search', undefined, 'Searching memory…'],
    ['memory_write', undefined, 'Searching memory…'],
    ['mcp__browser__browser_click', undefined, 'Using the browser…'],
    ['read_file', undefined, 'Working: read_file…'],
    ['open', undefined, 'Opening…'],
    ['open', { kind: 'app', value: 'notepad' }, 'Opening Notepad…'],
    ['open', { kind: 'app', value: 'no such app' }, 'Opening an app…'],
    ['open', { kind: 'app', value: '  ' }, 'Opening…'],
    ['open', { kind: 'app', value: 3 }, 'Opening…'],
    ['open', { kind: 'search', value: 'secret query' }, 'Searching Google…'],
    ['open', { kind: 'url', value: 'https://example.com/private' }, 'Opening a web page…'],
  ] as const)('%s %j -> %s', (name, args, label) => {
    expect(toolLabel(name, args as Record<string, unknown> | undefined)).toBe(label)
  })
})

describe('progressLabel and withElapsed', () => {
  it('labels thinking and tool calls', () => {
    expect(progressLabel({ kind: 'thinking' })).toBe(THINKING_LINE)
    expect(progressLabel({ kind: 'tool', name: 'pwsh' })).toBe('Running PowerShell…')
    expect(progressLabel({ kind: 'tool', name: 'open', args: { kind: 'app', value: 'notepad' } })).toBe('Opening Notepad…')
  })

  it('adds seconds from the third second on', () => {
    expect(withElapsed('Working…', 0)).toBe('Working…')
    expect(withElapsed('Working…', 2999)).toBe('Working…')
    expect(withElapsed('Working…', 3000)).toBe('Working… 3 s')
    expect(withElapsed('Working…', 12_400)).toBe('Working… 12 s')
  })
})
