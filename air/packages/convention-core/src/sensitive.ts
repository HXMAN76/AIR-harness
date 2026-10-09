/** Credential-file classification shared by every convention reader. */
import nodePath, { type PlatformPath } from 'node:path'
import { isInside } from './paths.ts'

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
 * A directory above the allowed root says nothing about the file: a project under `~/.docker/work` is
 * not a credential store. Pass `root` so only the part of the path inside it is tested; without `root`
 * every segment of `path` is tested, which suits a caller that has no root (for example a path from a
 * tool argument). {@link readContained} always passes the root that contains the file.
 * @param path - absolute path with `/` or `\` separators.
 * @param root - allowed root containing `path`; segments above it are ignored. A path outside `root` is tested by file name only.
 * @param pathApi - path module used to relate `path` to `root`; pass `path.win32` for Windows rules on any host.
 * @returns true when the file must not be sent to a model by a convention reader.
 */
export function isSensitivePath(path: string, root?: string, pathApi: PlatformPath = nodePath): boolean {
  let tested = path
  if (root !== undefined) {
    tested = isInside(root, path, pathApi) ? pathApi.relative(pathApi.resolve(root), pathApi.resolve(path)) : pathApi.basename(path)
  }
  const segments = tested.split(/[\\/]/u).map(segment => segment.toLowerCase())
  const name = tested.slice(Math.max(tested.lastIndexOf('/'), tested.lastIndexOf('\\')) + 1).toLowerCase()
  const parents = segments.slice(0, -1)
  const parent = parents.at(-1)
  return parents.some(segment => SENSITIVE_DIRECTORIES.has(segment))
    || SENSITIVE_FILES.test(name)
    || (parent === '.git' && name === 'config')
    || (parent === '.claude' && name === 'settings.local.json')
    || parents.some((segment, index) => segment === '.config' && parents[index + 1] === 'gh')
}
