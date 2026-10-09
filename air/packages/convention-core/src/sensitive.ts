/** Credential-file classification shared by every convention reader. */

/** Directories that hold credentials; any path through one is sensitive. */
const SENSITIVE_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])
const SENSITIVE_FILES = new RegExp(
  '^(?:\\.env(?:\\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\\.pub)?|\\.npmrc|\\.netrc|credentials|\\.git-credentials|\\.pypirc|\\.pgpass'
  + '|.*\\.(?:pem|key|p12|pfx|tfvars))$',
  'iu',
)

/**
 * Test whether a path looks like a credential file: an `.env*` file, an SSH key, a certificate or key
 * file, `.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`, `.pgpass`, a Terraform `*.tfvars` file,
 * `.git/config`, `.claude/settings.local.json`, anything under `.config/gh`, or any file under `.ssh`,
 * `.aws`, `.gnupg`, `.kube`, or `.docker`.
 * @param path - absolute path with `/` or `\` separators.
 * @returns true when the file must not be sent to a model by a convention reader.
 */
export function isSensitivePath(path: string): boolean {
  const segments = path.split(/[\\/]/u).map(segment => segment.toLowerCase())
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase()
  const parents = segments.slice(0, -1)
  const parent = parents.at(-1)
  return parents.some(segment => SENSITIVE_DIRECTORIES.has(segment))
    || SENSITIVE_FILES.test(name)
    || (parent === '.git' && name === 'config')
    || (parent === '.claude' && name === 'settings.local.json')
    || parents.some((segment, index) => segment === '.config' && parents[index + 1] === 'gh')
}
