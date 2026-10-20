import { describe, expect, it } from 'vitest'
import { parseVoiceCommand } from '../src/core/commands.ts'

describe('parseVoiceCommand', () => {
  it.each([
    ['use cloud', { kind: 'route', route: 'cloud' }],
    ['Use the cloud model.', { kind: 'route', route: 'cloud' }],
    ['switch to local', { kind: 'route', route: 'local' }],
    ['Use local model', { kind: 'route', route: 'local' }],
    ['use screen mode', { kind: 'route', route: 'screen' }],
    ['Screen mode on', { kind: 'route', route: 'screen' }],
    ['new conversation', { kind: 'new-conversation' }],
    ['Start a new conversation.', { kind: 'new-conversation' }],
    ['cancel', { kind: 'cancel' }],
    ['Cancel that!', { kind: 'cancel' }],
    ['share memory with cloud', { kind: 'memory-share', on: true }],
    ['Share memory with the cloud.', { kind: 'memory-share', on: true }],
    ['stop sharing memory', { kind: 'memory-share', on: false }],
    ["Don't share memory with the cloud", { kind: 'memory-share', on: false }],
  ])('%j', (command, expected) => {
    expect(parseVoiceCommand(command)).toEqual(expected)
  })

  it('passes anything else to the agent, trimmed and in its original casing', () => {
    expect(parseVoiceCommand('  Open Notepad and use cloud storage ')).toEqual({ kind: 'ask', text: 'Open Notepad and use cloud storage' })
    expect(parseVoiceCommand('cancel my meeting')).toEqual({ kind: 'ask', text: 'cancel my meeting' })
  })
})
