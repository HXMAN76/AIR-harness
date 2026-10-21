/**
 * Query helpers: terms of a free-text query and an inert FTS5 MATCH expression.
 * @module @air/dsh-memory-index/query
 */

/**
 * Split a query into unique lowercase runs of letters and digits.
 * @param query - caller text.
 * @returns terms in first-seen order; empty when the query has no letters or digits.
 */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
}

/**
 * Build an FTS5 MATCH expression in which every term is a quoted string, so query syntax stays inert.
 * @param terms - output of {@link queryTerms}.
 * @returns the terms joined with `OR`.
 */
export function ftsMatchExpression(terms: readonly string[]): string {
  return terms.map(term => `"${term}"`).join(' OR ')
}
