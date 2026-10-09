import { describe, expect, it } from 'vitest'
import { booleanField, isRecord, parseFrontmatter, stringField, stringListField } from '../src/index.ts'

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from the body', () => {
    const parsed = parseFrontmatter('---\nname: demo\ndescription: A demo\n---\n# Body\ntext\n')
    expect(parsed).toEqual({ data: { name: 'demo', description: 'A demo' }, body: '# Body\ntext\n', hasFrontmatter: true })
  })

  it('accepts CRLF line endings and a byte-order mark', () => {
    const parsed = parseFrontmatter('\uFEFF---\r\nname: demo\r\n---\r\nbody')
    expect(parsed.data).toEqual({ name: 'demo' })
    expect(parsed.body).toBe('body')
  })

  it('returns the whole text as body when there is no frontmatter', () => {
    expect(parseFrontmatter('Just text\n')).toEqual({ data: {}, body: 'Just text\n', hasFrontmatter: false })
    expect(parseFrontmatter('---\nname: unterminated\n')).toEqual({
      data: {},
      body: '---\nname: unterminated\n',
      hasFrontmatter: false,
    })
  })

  it('treats an empty frontmatter block as no fields', () => {
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body', hasFrontmatter: true })
  })

  it('throws for invalid YAML and for a non-mapping document', () => {
    expect(() => parseFrontmatter('---\nname: [unclosed\n---\nbody')).toThrow()
    expect(() => parseFrontmatter('---\n- a\n- b\n---\nbody')).toThrow('frontmatter must be a YAML mapping')
  })
})

describe('field readers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('stringField returns non-empty strings only', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x')
    expect(stringField({ a: '' }, 'a')).toBeUndefined()
    expect(stringField({ a: 3 }, 'a')).toBeUndefined()
    expect(stringField({}, 'a')).toBeUndefined()
  })

  it('booleanField reads booleans and their string spellings', () => {
    expect(booleanField({ a: true }, 'a')).toBe(true)
    expect(booleanField({ a: 'false' }, 'a')).toBe(false)
    expect(booleanField({ a: 'TRUE' }, 'a')).toBe(true)
    expect(booleanField({}, 'a')).toBeUndefined()
    expect(() => booleanField({ a: 'maybe' }, 'a')).toThrow('frontmatter field "a" must be a boolean')
    expect(() => booleanField({ a: 1 }, 'a')).toThrow(TypeError)
  })

  it('stringListField reads YAML lists and separated strings', () => {
    expect(stringListField({ a: ['x', ' y ', ''] }, 'a')).toEqual(['x', 'y'])
    expect(stringListField({ a: 'Bash(git add:*, git commit:*), Read  Grep' }, 'a')).toEqual([
      'Bash(git add:*, git commit:*)',
      'Read',
      'Grep',
    ])
    expect(stringListField({ a: 'weird)name' }, 'a')).toEqual(['weird)name'])
    expect(stringListField({}, 'a')).toBeUndefined()
    expect(stringListField({ a: null }, 'a')).toBeUndefined()
    expect(() => stringListField({ a: [1] }, 'a')).toThrow('frontmatter field "a" must be a string or a list of strings')
    expect(() => stringListField({ a: 7 }, 'a')).toThrow(TypeError)
  })
})
