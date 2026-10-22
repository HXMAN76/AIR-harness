/** Speech model files: where they live and whether they match upstream's pinned sizes and hashes. */
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SENSEVOICE_PACKAGE_JSON } from './paths.ts'

/** Absolute paths of the three model files. */
export interface ModelPaths {
  model: string
  tokens: string
  vad: string
}

/** One pinned download from upstream's `assets.json`. */
export interface ModelAsset {
  name: string
  url: string
  bytes: number
  sha256: string
}

/** The pinned SenseVoice int8 model, its tokens, and the Silero VAD. */
export type ModelAssets = Record<keyof ModelPaths, ModelAsset>

/** Result of {@link verifyModels}. */
export type ModelCheck = { ok: true } | { ok: false; missing: string[] }

/** Upstream manifest of the SenseVoice package. */
export const DEFAULT_ASSETS_JSON = join(dirname(SENSEVOICE_PACKAGE_JSON), 'runtime', 'assets.json')

/**
 * @param home - user home directory.
 * @returns paths under `<home>/.air/voice-models`.
 */
export function modelPaths(home: string = homedir()): ModelPaths {
  const dir = join(home, '.air', 'voice-models')
  return { model: join(dir, 'model.int8.onnx'), tokens: join(dir, 'tokens.txt'), vad: join(dir, 'silero_vad.onnx') }
}

/**
 * Read upstream's pinned assets.
 * @param path - the `assets.json` file.
 * @returns the int8 model, tokens, and VAD entries.
 */
export function loadModelAssets(path: string = DEFAULT_ASSETS_JSON): ModelAssets {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { models: { int8: ModelAsset }; tokens: ModelAsset; vad: ModelAsset }
  return { model: manifest.models.int8, tokens: manifest.tokens, vad: manifest.vad }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function matches(path: string, asset: ModelAsset): Promise<boolean> {
  try {
    if ((await stat(path)).size !== asset.bytes) return false
  } catch {
    return false
  }
  return await sha256(path) === asset.sha256
}

/**
 * Check each file's size and SHA-256 against the pinned assets.
 * @param paths - files to check.
 * @param assets - pinned sizes and hashes.
 * @returns ok, or the paths that are missing or do not match.
 */
export async function verifyModels(paths: ModelPaths, assets: ModelAssets = loadModelAssets()): Promise<ModelCheck> {
  const keys = ['model', 'tokens', 'vad'] as const
  const results = await Promise.all(keys.map(key => matches(paths[key], assets[key])))
  const missing = keys.filter((_, index) => results[index] !== true).map(key => paths[key])
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

/** One file of a pinned model, relative to the model directory. `url` is set for models downloaded file by file. */
export interface LockFile {
  path: string
  /** Path inside the archive when it differs from `path`. */
  from?: string
  bytes: number
  sha256: string
  url?: string
}

/** One entry of `models.lock.json`: a model directory under `~/.air/voice-models/<name>/`. */
export interface LockEntry {
  title: string
  license: string
  /** Release archive (`.tar.bz2`) extracted with `tar.exe`; `root` is its top-level folder. Absent for file-by-file models. */
  archive?: { url: string; bytes: number; sha256: string; root: string }
  /** Folders of the archive kept whole (for example engine data); files listed under them are verified, not moved one by one. */
  dirs?: string[]
  /** The files kept from the archive or downloaded, each verified after install. */
  files: LockFile[]
}

/** The pinned model set. */
export interface ModelLock {
  models: Record<string, LockEntry>
}

/** Names in `models.lock.json`. */
export type ModelName = 'kws' | 'asr-en' | 'asr-ta' | 'vad' | 'tts-en'

/** Path of the model lock next to this file. */
export const MODEL_LOCK_JSON = fileURLToPath(new URL('models.lock.json', import.meta.url))

/**
 * @param path - the lock file.
 * @returns the parsed lock.
 */
export function loadModelLock(path: string = MODEL_LOCK_JSON): ModelLock {
  return JSON.parse(readFileSync(path, 'utf8')) as ModelLock
}

/**
 * @param home - user home directory.
 * @returns `<home>/.air/voice-models`, the folder that holds every model directory.
 */
export function modelRoot(home: string = homedir()): string {
  return join(home, '.air', 'voice-models')
}

/**
 * @param name - lock entry name.
 * @param home - user home directory.
 * @returns `<home>/.air/voice-models/<name>`.
 */
export function modelDir(name: ModelName, home: string = homedir()): string {
  return join(modelRoot(home), name)
}

/**
 * Check every file of a lock entry against its pinned size and SHA-256.
 * @param dir - the model directory.
 * @param entry - the lock entry.
 * @returns ok, or the paths that are missing or do not match.
 */
export async function verifyEntry(dir: string, entry: LockEntry): Promise<ModelCheck> {
  const results = await Promise.all(entry.files.map(file => fileMatches(join(dir, file.path), file)))
  const missing = entry.files.filter((_, index) => results[index] !== true).map(file => join(dir, file.path))
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

/**
 * Check a downloaded file against a pinned size and SHA-256.
 * @param path - the file.
 * @param expected - pinned size and hash.
 * @returns whether it matches.
 */
export async function fileMatches(path: string, expected: { bytes: number; sha256: string }): Promise<boolean> {
  return await matches(path, { name: path, url: '', ...expected })
}
