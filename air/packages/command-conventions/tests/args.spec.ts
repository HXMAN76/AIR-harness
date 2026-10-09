import { describe, expect, it } from 'vitest'
import { splitArguments, substituteArguments } from '../src/args.ts'

describe('splitArguments', () => {
  it.each([
    ['', []],
    ['   ', []],
    ['123 high', ['123', 'high']],
    ['  "two words"  \'single quoted\' plain ', ['two words', 'single quoted', 'plain']],
    ['a\\ b c', ['a b', 'c']],
    ['say \\"hi\\"', ['say', '"hi"']],
    ['C:\\Users\\me\\f.txt "D:\\my dir\\x"', ['C:\\Users\\me\\f.txt', 'D:\\my dir\\x']],
    ['\\\\server\\share', ['\\\\server\\share']],
    ['"" x', ['', 'x']],
    ['pre"fix ed"post', ['prefix edpost']],
    ['"unterminated rest', ['unterminated rest']],
    ['trailing\\', ['trailing\\']],
  ])('splits %j', (raw, expected) => {
    expect(splitArguments(raw)).toEqual(expected)
  })
})

describe('substituteArguments', () => {
  it('replaces $ARGUMENTS with the trimmed input', () => {
    expect(substituteArguments('Fix issue $ARGUMENTS now', '  123 high ', [], 0)).toBe('Fix issue 123 high now')
  })

  it('replaces indexed and numbered placeholders from the configured base', () => {
    expect(substituteArguments('$ARGUMENTS[0]/$ARGUMENTS[1]/$0/$1/$2', 'a "b c"', [], 0)).toBe('a/b c/a/b c/')
    expect(substituteArguments('$ARGUMENTS[1]/$1/$2/$3', 'a "b c"', [], 1)).toBe('a/a/b c/')
    expect(substituteArguments('$0', 'a', [], 1)).toBe('')
  })

  it('replaces named placeholders declared in arguments and leaves other dollar words', () => {
    expect(substituteArguments('Issue $issue on $branch costs $HOME', '42 main', ['issue', 'branch'], 0))
      .toBe('Issue 42 on main costs $HOME')
    expect(substituteArguments('Issue $issue then $branch', '42', ['issue', 'branch'], 0)).toBe('Issue 42 then ')
  })

  it('inserts the input literally and in one pass', () => {
    expect(substituteArguments('A: $ARGUMENTS B: $1', '$0 x', [], 0)).toBe('A: $0 x B: x')
    expect(substituteArguments('Run $ARGUMENTS', '$& $\'', [], 0)).toBe('Run $& $\'')
    expect(substituteArguments('All: $ARGUMENTS', 'a\nb', [], 0)).toBe('All: a\nb')
    expect(substituteArguments('Tenth: $10 or $ARGUMENTS[10]', 'a', [], 0)).toBe('Tenth:  or ')
    expect(substituteArguments('Open bracket: $ARGUMENTS[ now', 'x', [], 0)).toBe('Open bracket: x[ now')
  })

  it('appends the input when the body has no placeholder', () => {
    expect(substituteArguments('Review the diff.', 'only tests', [], 0)).toBe('Review the diff.\n\nARGUMENTS: only tests')
    expect(substituteArguments('Review the diff for $USER.', 'only tests', [], 0)).toBe('Review the diff for $USER.\n\nARGUMENTS: only tests')
    expect(substituteArguments('Review the diff.', '   ', [], 0)).toBe('Review the diff.')
  })
})
