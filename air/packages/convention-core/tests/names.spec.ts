import { describe, expect, it } from 'vitest'
import { toKebabName } from '../src/index.ts'

describe('toKebabName', () => {
  it.each([
    ['fix-issue', 'fix-issue'],
    ['Fix Issue', 'fix-issue'],
    ['frontend:component', 'frontend-component'],
    ['  My_Skill.v2 ', 'my-skill-v2'],
    ['Résumé', 'resume'],
  ])('normalises %j to %j', (input, expected) => {
    expect(toKebabName(input)).toBe(expected)
  })

  it('returns undefined when nothing usable remains', () => {
    expect(toKebabName('***')).toBeUndefined()
    expect(toKebabName('')).toBeUndefined()
  })
})
