/** Argument splitting and placeholder substitution for command files. */

/** Characters a backslash may escape; any other backslash is literal, which keeps Windows paths intact. */
const ESCAPABLE = /["'\s]/u

/**
 * Split command input into arguments. Whitespace separates arguments; single or double quotes
 * group text, and a backslash before a quote or whitespace keeps that character. Any other backslash is
 * literal, so `C:\Users\me\a.txt` is one argument. An unterminated quote runs to the end.
 * @param raw - text typed after the command name.
 * @returns the arguments in order.
 */
export function splitArguments(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let started = false
  let quote: string | undefined
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index)
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === '\'') {
      quote = char
      started = true
    } else if (char === '\\' && ESCAPABLE.test(raw.charAt(index + 1))) {
      index += 1
      current += raw.charAt(index)
      started = true
    } else if (/\s/u.test(char)) {
      if (started) parts.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) parts.push(current)
  return parts
}

const PLACEHOLDER = /\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS|\$(\d+)|\$([A-Za-z_][A-Za-z0-9_]*)/gu

/**
 * Substitute argument placeholders in a command body.
 * @param body - command file body.
 * @param rawInput - text typed after the command name.
 * @param names - frontmatter `arguments:` names; `$name` maps to the argument at the same position.
 * @param positionalBase - index of the first argument for `$ARGUMENTS[N]` and `$N` (0 or 1).
 * @returns the prompt text. When no placeholder was replaced and the input is not empty, the input is appended as `ARGUMENTS: <input>`.
 */
export function substituteArguments(
  body: string,
  rawInput: string,
  names: readonly string[],
  positionalBase: number,
): string {
  const all = rawInput.trim()
  const positional = splitArguments(all)
  const state = { replaced: false }
  const text = body.replace(PLACEHOLDER, (
    match: string,
    indexed: string | undefined,
    numbered: string | undefined,
    named: string | undefined,
  ) => {
    if (named !== undefined) {
      const position = names.indexOf(named)
      if (position < 0) return match
      state.replaced = true
      return positional[position] ?? ''
    }
    state.replaced = true
    const index = indexed ?? numbered
    return index === undefined ? all : positional[Number(index) - positionalBase] ?? ''
  })
  return state.replaced || all.length === 0 ? text : `${text}\n\nARGUMENTS: ${all}`
}
