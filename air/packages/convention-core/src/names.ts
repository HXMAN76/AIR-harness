/** Name normalisation shared by skill and command discovery. */

/**
 * Convert a file stem, directory name, or namespaced command path into a kebab-case name.
 * @param input - raw name, for example `frontend:component` or `My Skill`.
 * @returns a name matching `^[a-z0-9]+(-[a-z0-9]+)*$`, or undefined when no letter or digit remains.
 */
export function toKebabName(input: string): string | undefined {
  const name = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return name.length > 0 ? name : undefined
}
