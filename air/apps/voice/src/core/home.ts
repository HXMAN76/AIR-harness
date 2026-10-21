/** The voice runtime home and workspace, and the one-time setup of the home's `.env`. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Name of the cloud key. AIR code checks only whether it is set; the value is never read into a variable. */
export const CLOUD_KEY_ENV = 'OPENROUTER_API_KEY'

/**
 * @param home - user home directory.
 * @returns `<home>/.air/voice-home`, the `DSH_HOME` of the voice runtime.
 */
export function voiceHome(home: string = homedir()): string {
  return join(home, '.air', 'voice-home')
}

/**
 * The Windows sandbox cannot grant ACLs outside the user profile on some drives, so the workspace lives in Documents.
 * @param home - user home directory.
 * @returns `<home>/Documents/AIR Voice`.
 */
export function voiceWorkspace(home: string = homedir()): string {
  return join(home, 'Documents', 'AIR Voice')
}

/**
 * Whether a dotenv text assigns a non-empty value to `name` (commented lines do not count).
 * @param text - dotenv file contents.
 * @param name - variable name.
 * @returns presence only.
 */
export function envTextAssigns(text: string, name: string): boolean {
  const pattern = new RegExp(`^\\s*${name}\\s*=\\s*['"]?[^\\s'"#]`)
  return text.split(/\r?\n/).some(line => pattern.test(line))
}

/**
 * @param env - environment to check.
 * @param dshHome - runtime home whose `.env` may hold the key.
 * @returns whether `OPENROUTER_API_KEY` is set in either place.
 */
export function cloudKeyPresent(env: Record<string, string | undefined>, dshHome: string): boolean {
  const value = env[CLOUD_KEY_ENV]
  if (value !== undefined && value !== '') return true
  const file = join(dshHome, '.env')
  return existsSync(file) && envTextAssigns(readFileSync(file, 'utf8'), CLOUD_KEY_ENV)
}

/** What {@link prepareVoiceHome} did. */
export interface VoiceHomeReport {
  home: string
  workspace: string
  envUpdated: boolean
  backup: string | undefined
  cloudKey: boolean
}

/**
 * Create the home and workspace and add `OLLAMA_API_KEY=ollama` to `<home>/.env` when absent.
 * A changed file is first copied to `<name>.bak-<timestamp>`.
 * @param options - locations, environment, and clock.
 * @returns what was done and whether the cloud key is present.
 */
export function prepareVoiceHome(options: {
  home: string
  workspace: string
  env?: Record<string, string | undefined>
  now?: () => number
}): VoiceHomeReport {
  const { home, workspace } = options
  const now = options.now ?? Date.now
  mkdirSync(home, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const file = join(home, '.env')
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  let envUpdated = false
  let backup: string | undefined
  if (before === undefined || !envTextAssigns(before, 'OLLAMA_API_KEY')) {
    if (before !== undefined) {
      backup = `${file}.bak-${now()}`
      copyFileSync(file, backup)
    }
    const prefix = before === undefined ? '' : before.replace(/\n?$/, '\n')
    writeFileSync(file, `${prefix}OLLAMA_API_KEY=ollama\n`)
    envUpdated = true
  }
  return { home, workspace, envUpdated, backup, cloudKey: cloudKeyPresent(options.env ?? process.env, home) }
}
