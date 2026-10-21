import { describe, expect, it } from 'vitest'
import { DEFAULT_WAKE_PHRASES, matchWake } from '../src/core/wake.ts'

describe('matchWake', () => {
  it.each([
    ['Jarvis, open Notepad.', { wake: true, command: 'open Notepad' }],
    ['hey jarvis what time is it', { wake: true, command: 'what time is it' }],
    ['Hey, Jarvis.', { wake: true, command: '' }],
    ['I said hey jarvis yesterday', { wake: false, command: '' }],
    ['I told Jarvis to stop', { wake: false, command: '' }],
    ['', { wake: false, command: '' }],
    ['JARVIS!!! search weather', { wake: true, command: 'search weather' }],
    ['OK Jarvis. Use cloud.', { wake: true, command: 'Use cloud' }],
    ['Jervis: new conversation', { wake: true, command: 'new conversation' }],
    ['Jarvas, cancel', { wake: true, command: 'cancel' }],
    ['Travis open the browser', { wake: true, command: 'open the browser' }],
    // Heard by SenseVoice from SAPI speech of "Jarvis" (2026-10-21).
    ['Jrvis, openNotepad.', { wake: true, command: 'openNotepad' }],
    ['Javis open notad', { wake: true, command: 'open notad' }],
    ['Jvis.', { wake: true, command: '' }],
    ['jarvisville tickets', { wake: false, command: '' }],
    ['  ...  ', { wake: false, command: '' }],
  ])('%j', (transcript, expected) => {
    expect(matchWake(transcript)).toEqual(expected)
  })

  it('prefers the longest phrase that matches', () => {
    expect(matchWake('hey jarvis open mail')).toEqual({ wake: true, command: 'open mail' })
    expect(matchWake('hey there air open mail', ['hey there', 'hey there air'])).toEqual({ wake: true, command: 'open mail' })
  })

  it('uses a custom phrase list', () => {
    expect(matchWake('Computer, lights on', ['computer'])).toEqual({ wake: true, command: 'lights on' })
    expect(matchWake('Jarvis, lights on', ['computer'])).toEqual({ wake: false, command: '' })
  })

  it('ignores blank phrases in a custom list', () => {
    expect(matchWake('anything', ['', '  '])).toEqual({ wake: false, command: '' })
  })

  it('ships the default phrases', () => {
    expect(DEFAULT_WAKE_PHRASES).toEqual(['jarvis', 'hey jarvis', 'ok jarvis', 'jervis', 'jarvas', 'travis', 'javis', 'jrvis', 'jvis', 'davis', 'hey davis', 'jarvis is', 'charvis', 'jarviss'])
    expect(matchWake('Davis, open notepad.')).toEqual({ wake: true, command: 'open notepad' })
  })
})
