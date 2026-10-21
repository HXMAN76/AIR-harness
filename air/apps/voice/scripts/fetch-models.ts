/**
 * Download the pinned voice models into `<home>/.air/voice-models/<name>/` as listed in `src/core/models.lock.json`:
 * the keyword spotter (`kws`), English Parakeet (`asr-en`), Tamil IndicConformer (`asr-ta`), and Silero VAD (`vad`).
 * Archives are checked against their SHA-256, extracted with `tar.exe` (no shell), and every installed file is checked again.
 * Models whose files already match are skipped. `--sensevoice` also fetches the legacy SenseVoice files (`AIR_VOICE_ASR=sensevoice`).
 * `--only=<name>[,<name>]` limits the run. `pnpm -C air/apps/voice exec tsx scripts/fetch-models.ts`
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileMatches, loadModelAssets, loadModelLock, modelDir, modelPaths, modelRoot, verifyEntry, verifyModels, type LockEntry, type ModelAssets, type ModelPaths } from '../src/core/models.ts'

const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status} for ${url}`)
  await pipeline(response.body, createWriteStream(target))
}

function extract(archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TAR, ['-xf', archive, '-C', into], { stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)))
  })
}

async function install(name: string, entry: LockEntry, dir: string): Promise<void> {
  const root = modelRoot()
  await mkdir(root, { recursive: true })
  const work = await mkdtemp(join(root, `.fetch-${name}-`))
  try {
    await mkdir(dir, { recursive: true })
    if (entry.archive !== undefined) {
      const archive = join(work, 'archive.tar.bz2')
      console.log(`download ${entry.archive.url}`)
      await download(entry.archive.url, archive)
      if (!await fileMatches(archive, entry.archive)) throw new Error('archive size or SHA-256 does not match the pin')
      await extract(archive, work)
      for (const file of entry.files) await rename(join(work, entry.archive.root, file.from ?? file.path), join(dir, file.path))
    } else {
      for (const file of entry.files) {
        const partial = join(work, 'part')
        console.log(`download ${file.url}`)
        await download(file.url as string, partial)
        if (!await fileMatches(partial, file)) throw new Error(`${file.path}: size or SHA-256 does not match the pin`)
        await rename(partial, join(dir, file.path))
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

let failed = false
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length).split(',')
const lock = loadModelLock()
for (const [name, entry] of Object.entries(lock.models)) {
  if (only !== undefined && !only.includes(name)) continue
  const dir = modelDir(name as Parameters<typeof modelDir>[0])
  if ((await verifyEntry(dir, entry)).ok) {
    console.log(`ok       ${name} (${entry.title})`)
    continue
  }
  try {
    await install(name, entry, dir)
    const check = await verifyEntry(dir, entry)
    if (!check.ok) throw new Error(`missing or wrong: ${check.missing.join(', ')}`)
    console.log(`ok       ${name} (${entry.title})`)
  } catch (error) {
    console.error(`failed   ${name}: ${error instanceof Error ? error.message : String(error)}`)
    failed = true
  }
}

if (process.argv.includes('--sensevoice')) {
  const paths = modelPaths()
  const assets = loadModelAssets()
  for (const key of ['model', 'tokens', 'vad'] as const) {
    const one: { paths: ModelPaths; assets: ModelAssets } = {
      paths: { model: paths[key], tokens: paths[key], vad: paths[key] },
      assets: { model: assets[key], tokens: assets[key], vad: assets[key] },
    }
    if ((await verifyModels(one.paths, one.assets)).ok) {
      console.log(`ok       sensevoice ${assets[key].name}`)
      continue
    }
    try {
      const partial = `${paths[key]}.partial`
      console.log(`download ${assets[key].url}`)
      await mkdir(modelRoot(), { recursive: true })
      await download(assets[key].url, partial)
      if (!await fileMatches(partial, assets[key])) throw new Error('size or SHA-256 does not match the pin')
      await rename(partial, paths[key])
      console.log(`ok       sensevoice ${assets[key].name}`)
    } catch (error) {
      console.error(`failed   sensevoice ${assets[key].name}: ${error instanceof Error ? error.message : String(error)}`)
      failed = true
    }
  }
}
process.exitCode = failed ? 1 : 0
