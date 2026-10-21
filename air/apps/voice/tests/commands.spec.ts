import { describe, expect, it } from 'vitest'
import { parseVoiceCommand, rewriteForAgent } from '../src/core/commands.ts'

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

describe('rewriteForAgent', () => {
  it.each([
    ['remember that I like short answers', 'Use the memory_write tool with type user to save this note: I like short answers. Then reply "Noted."'],
    ['Please remember my sister is Asha.', 'Use the memory_write tool with type user to save this note: my sister is Asha. Then reply "Noted."'],
    ["don't forget the meeting is at 5", 'Use the memory_write tool with type user to save this note: the meeting is at 5. Then reply "Noted."'],
    ['Dont forget that I am vegetarian!', 'Use the memory_write tool with type user to save this note: I am vegetarian. Then reply "Noted."'],
    ['note I prefer dark mode', 'Use the memory_write tool with type user to save this note: I prefer dark mode. Then reply "Noted."'],
    ['what do you remember about my sister?', 'Use memory_search for: my sister. Answer in one sentence.'],
    ['Do you remember my favourite colour', 'Use memory_search for: my favourite colour. Answer in one sentence.'],
  ])('%j', (text, expected) => {
    expect(rewriteForAgent(text)).toBe(expected)
  })

  it.each(['remember', 'open notepad', 'I remember that', 'notes are useful', '  tell me a joke '])('leaves %j alone', (text) => {
    expect(rewriteForAgent(text)).toBe(text)
  })
})

describe('language commands', () => {
  it.each(['tamil mode', 'Switch to Tamil.', 'use tamil mode', 'go to Tamil', 'தமிழ்', 'தமிழ் மோட்'])('%j switches to Tamil', (text) => {
    expect(parseVoiceCommand(text)).toEqual({ kind: 'language', lang: 'ta' })
  })

  it.each(['english mode', 'Switch to English.', 'use english', 'இங்கிலீஷ் மோட்', 'ஆங்கிலம்'])('%j switches to English', (text) => {
    expect(parseVoiceCommand(text)).toEqual({ kind: 'language', lang: 'en' })
  })

  it('leaves other Tamil and English text for the agent', () => {
    expect(parseVoiceCommand('tamil movies near me')).toEqual({ kind: 'ask', text: 'tamil movies near me' })
  })
})
