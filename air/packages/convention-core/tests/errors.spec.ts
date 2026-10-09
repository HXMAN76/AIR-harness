import { describe, expect, it } from 'vitest'
import { errorMessage } from '../src/index.ts'

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new TypeError('bad input'))).toBe('bad input')
  })

  it('stringifies other values', () => {
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(42)).toBe('42')
  })
})
