/** What an escalation request is, in one line a person can hear. */

/** Longest summary part, in characters. */
const CLIP = 120

function record(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      return record(JSON.parse(args))
    } catch {
      return {}
    }
  }
  return typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
}

function oneLine(value: unknown): string {
  const text = typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : ''
  return text.length > CLIP ? `${text.slice(0, CLIP - 1)}…` : text
}

/**
 * @param args - the tool arguments (object or JSON text).
 * @returns whether the call asks for a wider sandbox (`sandbox_permissions` set), which is what needs a spoken yes.
 */
export function isEscalation(args: unknown): boolean {
  return oneLine(record(args).sandbox_permissions) !== ''
}

/**
 * @param args - the tool arguments of an escalation.
 * @returns "run <command>" with the justification in brackets, on one line; "do something outside the workspace" without a command.
 */
export function escalationSummary(args: unknown): string {
  const { command, justification } = record(args)
  const what = oneLine(command) === '' ? 'do something outside the workspace' : `run ${oneLine(command)}`
  const why = oneLine(justification)
  return why === '' ? what : `${what} (${why})`
}
