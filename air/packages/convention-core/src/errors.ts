/** Error text helper for caught values. */

/**
 * Describe a caught value as text.
 * @param error - value from a `catch` clause or a rejected promise.
 * @returns `error.message` for an `Error`, otherwise `String(error)`.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
