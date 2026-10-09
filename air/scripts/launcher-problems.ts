/** Stderr phrases the dsh launcher prints for composition and activation problems. */

/**
 * Matches the launcher's own diagnostics: a patch whose target row or insert anchor is missing
 * (`patch: entry ... not found`), a profile row disabled for compatibility, and rows that failed to
 * import or are waiting for a service (`N entry did not activate` with per-row `failed to import` or `pending`).
 * Other stderr text that merely contains words such as "failed" does not match.
 */
export const LAUNCHER_PROBLEM = new RegExp([
  'patch(?: insert)?: entry .+ not found',
  'disabling profile plugin ',
  'entr(?:y|ies) did not activate',
  '\\): failed to import',
  '\\): pending \\(waiting for',
].join('|'), 'i')
