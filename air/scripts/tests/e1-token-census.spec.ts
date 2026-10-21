import { describe, expect, it } from 'vitest'
import { PROMPT, asWireBody, census, classifyUserMessage, normalize, sha256 } from '../research/e1-token-census.ts'

const skills = '<system-reminder>\n<available_skills>\n- `a`: b\n</available_skills>\n</system-reminder>'
const runtime = 'Current runtime context. Current working directory: "C:\\Temp\\ws".\nCurrent DeepSeek Harness Web GUI URL: "http://127.0.0.1:54146".'
const time = 'Time sampled while preparing turn 1, step 1: 2026-10-21T03:25:57+05:30[Asia/Calcutta]\nBrowser time zone: unavailable.'
const instructions = '# AGENTS.md\nbe brief'
const raw = JSON.stringify({
  model: 'qwen3-8b-32k',
  messages: [
    { role: 'system', content: 'You are an agent.' },
    { role: 'user', content: PROMPT },
    { role: 'user', content: [{ type: 'text', text: runtime }] },
    { role: 'user', content: skills },
    { role: 'user', content: instructions },
    { role: 'user', content: time },
  ],
  tools: [
    { type: 'function', function: { name: 'read', description: 'Read a file.', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'write', description: 'Write a file.', parameters: { type: 'object', properties: {} } } },
  ],
})

describe('E1 request census', () => {
  const body = asWireBody(JSON.parse(raw))

  it('parses a chat body and rejects other JSON', () => {
    expect(body?.messages).toHaveLength(6)
    expect(asWireBody({ prompt: 'x' })).toBeUndefined()
  })

  it('classifies the injected user messages', () => {
    expect(classifyUserMessage(PROMPT, PROMPT)).toBe('prompt')
    expect(classifyUserMessage(runtime, PROMPT)).toBe('runtime-context')
    expect(classifyUserMessage(time, PROMPT)).toBe('time-context')
    expect(classifyUserMessage(skills, PROMPT)).toBe('skill-catalog')
    expect(classifyUserMessage('# CLAUDE.md', PROMPT)).toBe('instructions')
  })

  it('measures each part of the request', () => {
    if (body === undefined) throw new Error('no body')
    const result = census(raw, body)
    expect(result).toMatchObject({
      bodyChars: raw.length, messageCount: 6, toolCount: 2, toolNames: ['read', 'write'],
      systemChars: 'You are an agent.'.length,
      promptChars: PROMPT.length,
      runtimeContextChars: runtime.length,
      timeContextChars: time.length,
      skillCatalogChars: skills.length,
      instructionChars: instructions.length,
    })
    expect(result.userChars).toBe(PROMPT.length + runtime.length + skills.length + instructions.length + time.length)
    expect(result.tools[0]).toEqual({ name: 'read', schemaChars: JSON.stringify(body.tools?.[0]).length, descriptionChars: 12, parametersChars: 17 })
    expect(result.toolsChars).toBe(JSON.stringify(body.tools).length)
    expect(result.heuristicSystemTokens).toBe(Math.ceil(result.systemChars / 4) + 4)
    expect(result.heuristicToolsTokens).toBe(Math.ceil(result.toolsChars / 4) + 4)
  })

  it('normalizes run-specific paths, the sampled time, and the host port', () => {
    const normalized = normalize(raw, { 'C:\\Temp\\ws': '<WS>' })
    expect(normalized).toContain('step 1: <TIME>\\n')
    expect(normalized).toContain('127.0.0.1:<PORT>')
    expect(normalized).toContain('directory: \\"<WS>\\"')
    const other = raw.replace('03:25:57', '04:00:01').replace('54146', '61000')
    expect(normalize(other, { 'C:\\Temp\\ws': '<WS>' })).toBe(normalized)
  })

  it('normalizes Windows and POSIX forms of a path', () => {
    const home = 'C:\\Temp\\air-e1-home-1'
    const text = JSON.stringify({ a: home, b: 'C:/Temp/air-e1-home-1/x', c: '/tmp/ws' })
    expect(normalize(text, { [home]: '<HOME>', '/tmp/ws': '<WS>' })).toBe(JSON.stringify({ a: '<HOME>', b: '<HOME>/x', c: '<WS>' }))
    // A path quoted inside message text is escaped twice in the request body.
    const nested = JSON.stringify({ content: `directory: ${JSON.stringify(home)}.` })
    expect(normalize(nested, { [home]: '<HOME>' })).toBe(JSON.stringify({ content: 'directory: "<HOME>".' }))
  })

  it('hashes with SHA-256', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
