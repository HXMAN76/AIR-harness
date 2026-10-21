import { describe, expect, it } from 'vitest'
import { ftsMatchExpression, queryTerms } from '../src/query.ts'

describe('query helpers', () => {
  it('extracts unique lowercase terms and quotes each one', () => {
    expect(queryTerms('Neovim OR "tea" neovim; DROP')).toEqual(['neovim', 'or', 'tea', 'drop'])
    expect(queryTerms('?? --')).toEqual([])
    expect(ftsMatchExpression(['neovim', 'tea'])).toBe('"neovim" OR "tea"')
  })
})
