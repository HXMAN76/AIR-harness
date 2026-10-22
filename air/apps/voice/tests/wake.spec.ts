import { describe, expect, it } from 'vitest'
import { DEFAULT_WAKE_PHRASES, editDistance, matchTextWake, matchWake } from '../src/core/wake.ts'

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

  describe('text wake', () => {
    it.each([
      ['Jervis: new conversation', 'new conversation'],
      ['Jarvas, cancel', 'cancel'],
      ['Travis open the browser', 'open the browser'],
      ['Davis, open notepad.', 'open notepad'],
      ['Jrvis, openNotepad.', 'openNotepad'],
      ['Javis open notad', 'open notad'],
      ['Jvis.', ''],
      ['Hey Javis, open the notepad.', 'open the notepad'],
      ['OK Jervis, what time is it', 'what time is it'],
      ['Hay jarves open mail', 'open mail'],
      ['hi charvis what time is it', 'what time is it'],
      ['okay jarvas stop', 'stop'],
      ['so jarvis read the news', 'read the news'],
      ['a jarvis open notepad', 'open notepad'],
      ["Jarvis's open notepad", 'open notepad'],
      ['Jar vis open notepad', 'open notepad'],
      ['Hey jo vis, what time is it', 'what time is it'],
      ['jarvis is open notepad', 'open notepad'],
      ['jarvis is', 'is'],
      ['JARVIS', ''],
    ])('wakes on %j', (transcript, command) => {
      expect(matchTextWake(transcript)).toEqual({ wake: true, command })
    })

    it.each([
      'service please', 'nervous breakdown', 'javascript is fun', 'harvest the crops', 'this is a test', 'hey there',
      'hey', '', '   ', 'I said hey jarvis yesterday', 'I told javis to stop', 'jar visit tomorrow', 'so so jarvis', 'hey hey jarvis',
      'a b c',
    ])('does not wake on %j', (transcript) => {
      expect(matchTextWake(transcript)).toEqual({ wake: false, command: '' })
    })
  })

  describe('editDistance', () => {
    it.each([
      ['jarvis', 'jarvis', 0], ['javis', 'jarvis', 1], ['travis', 'jarvis', 2], ['', 'abc', 3], ['abc', '', 3], ['ab', 'ba', 1],
      ['service', 'jarvis', 4],
    ])('%s vs %s is %i', (a, b, distance) => {
      expect(editDistance(a, b)).toBe(distance)
    })
  })
})
