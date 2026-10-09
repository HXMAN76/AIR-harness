/** Derives air/.oxlintrc.json from the repository's root .oxlintrc.json. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/** Subset of the oxlint configuration this generator reads and writes. */
export interface OxlintConfig {
  $schema?: string
  ignorePatterns?: string[]
  overrides?: OxlintOverride[]
  [key: string]: unknown
}

/** One oxlint override block. */
export interface OxlintOverride {
  files: string[]
  [key: string]: unknown
}

const UPSTREAM_PACKAGE_PREFIX = 'packages/*/*/'
const ANY_PACKAGE_PREFIX = 'packages/**/'
const APP_PREFIX = 'apps/'
const AIR_SCHEMA = './node_modules/oxlint/configuration_schema.json'

function mapGlob(glob: string): string | undefined {
  if (glob.startsWith(UPSTREAM_PACKAGE_PREFIX)) return `packages/*/${glob.slice(UPSTREAM_PACKAGE_PREFIX.length)}`
  if (glob.startsWith(ANY_PACKAGE_PREFIX)) return glob
  if (glob.startsWith(APP_PREFIX)) return glob
  return undefined
}

/**
 * Map root lint rules onto the AIR layout: `air/packages/<pkg>` instead of `packages/<group>/<pkg>`; `apps/*` globs carry over to `air/apps/*`.
 * @param root - parsed root configuration.
 * @returns the configuration to write to air/.oxlintrc.json.
 */
export function deriveAirOxlintConfig(root: OxlintConfig): OxlintConfig {
  const overrides: OxlintOverride[] = []
  for (const override of root.overrides ?? []) {
    const files = override.files.map(mapGlob).filter((glob): glob is string => glob !== undefined)
    if (files.length > 0) overrides.push({ ...override, files })
  }
  const derived: OxlintConfig = { ...root, $schema: AIR_SCHEMA, overrides }
  if (root.ignorePatterns !== undefined) {
    derived.ignorePatterns = root.ignorePatterns.filter(pattern => pattern.startsWith('**/'))
  }
  return derived
}

/**
 * Parse JSON that may contain comments and trailing commas (the root config's format).
 * @param text - file contents.
 * @returns the parsed value.
 */
export function parseJsonWithComments(text: string): OxlintConfig {
  const result = ts.parseConfigFileTextToJson('.oxlintrc.json', text)
  if (result.error !== undefined) {
    throw new Error(`gen-oxlintrc: ${ts.flattenDiagnosticMessageText(result.error.messageText, '\n')}`)
  }
  return result.config as OxlintConfig
}

function main(argv: readonly string[]): number {
  const airDir = join(import.meta.dirname, '..')
  const rootConfig = parseJsonWithComments(readFileSync(join(airDir, '..', '.oxlintrc.json'), 'utf8'))
  const next = `${JSON.stringify(deriveAirOxlintConfig(rootConfig), null, 2)}\n`
  const target = join(airDir, '.oxlintrc.json')
  if (argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(target, 'utf8')
    } catch (error) {
      // A missing target is reported as stale below; nothing else to recover.
      void error
    }
    if (current !== next) {
      console.error('gen-oxlintrc: air/.oxlintrc.json is stale; run `pnpm -C air run lint:gen`.')
      return 1
    }
    return 0
  }
  writeFileSync(target, next)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
