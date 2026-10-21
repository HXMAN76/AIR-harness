import { describe, expect, it } from 'vitest'
import { CONFIRM_SEND, matchEmailCommand, parseVoiceCommand, rewriteForAgent } from '../src/core/commands.ts'

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

describe('email commands', () => {
  it.each([
    ['send a gmail to asha@example.com saying running late', { kind: 'send', details: 'to asha@example.com saying running late' }],
    ['Send an email to Ravi saying hello.', { kind: 'send', details: 'to Ravi saying hello' }],
    ['write the mail to mum', { kind: 'send', details: 'to mum' }],
    ['compose e-mail, to Bob', { kind: 'send', details: 'to Bob' }],
    ['send gmail', { kind: 'send', details: '' }],
    ['open gmail', { kind: 'open' }],
    ['Open my email.', { kind: 'open' }],
    ['open inbox', { kind: 'open' }],
    ['check my mail', { kind: 'check' }],
    ['Read my emails', { kind: 'check' }],
    ['check gmail', { kind: 'check' }],
    ['read my inbox!', { kind: 'check' }],
  ])('matches %j', (text, expected) => {
    expect(matchEmailCommand(text)).toEqual(expected)
  })

  it.each(['open notepad', 'send a text to Asha', 'mail the report', 'what is gmail', 'check the weather', 'sending gmail'])('does not match %j', (text) => {
    expect(matchEmailCommand(text)).toBeNull()
  })

  it('rewrites a send into a compose-only instruction ending in the gate line', () => {
    const out = rewriteForAgent('send a gmail to asha@example.com saying running late')
    expect(out).toContain('compose an email in Gmail at https://mail.google.com: to asha@example.com saying running late.')
    expect(out).toContain('do NOT press Send')
    expect(out.endsWith(`exactly ${CONFIRM_SEND}`)).toBe(true)
    expect(CONFIRM_SEND).toBe('CONFIRM SEND')
  })

  it('asks the model to find out the details when none were spoken', () => {
    expect(rewriteForAgent('send an email')).toContain('ask me who it is for and what it should say')
  })

  it('rewrites open and check without any send language', () => {
    expect(rewriteForAgent('open gmail')).toBe('Use the browser tools to open https://mail.google.com. Reply in one sentence saying what the inbox shows. Do not click anything else.')
    const check = rewriteForAgent('check my mail')
    expect(check).toContain('read the newest unread messages')
    expect(check).toContain('Do not reply, delete, or send anything.')
  })
})
