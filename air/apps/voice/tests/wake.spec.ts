import { describe, expect, it } from 'vitest'
import { DEFAULT_WAKE_PHRASES, TEXT_WAKE_PHRASES, matchWake } from '../src/core/wake.ts'

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
    ['Travis open the browser', { wake: false, command: '' }],
    ['Davis, open notepad.', { wake: false, command: '' }],
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

  it('ships a tight default list', () => {
    expect(DEFAULT_WAKE_PHRASES).toEqual(['jarvis', 'hey jarvis', 'ok jarvis'])
  })

  describe('text wake list', () => {
    it.each([
      ['Jervis: new conversation', { wake: true, command: 'new conversation' }],
      ['Jarvas, cancel', { wake: true, command: 'cancel' }],
      ['Travis open the browser', { wake: true, command: 'open the browser' }],
      ['Davis, open notepad.', { wake: true, command: 'open notepad' }],
      // Heard by SenseVoice from SAPI speech of "Jarvis" (2026-10-21).
      ['Jrvis, openNotepad.', { wake: true, command: 'openNotepad' }],
      ['Javis open notad', { wake: true, command: 'open notad' }],
      ['Jvis.', { wake: true, command: '' }],
      // The owner's real mic, transcribed by Parakeet (2026-10-22).
      ['Hey Javis, open the notepad.', { wake: true, command: 'open the notepad' }],
      ['OK Jervis, what time is it', { wake: true, command: 'what time is it' }],
      ['I told hey javis yesterday', { wake: false, command: '' }],
    ])('%j', (transcript, expected) => {
      expect(matchWake(transcript, TEXT_WAKE_PHRASES)).toEqual(expected)
    })

    it('includes every default phrase', () => {
      for (const phrase of DEFAULT_WAKE_PHRASES) expect(TEXT_WAKE_PHRASES).toContain(phrase)
    })
  })
})
