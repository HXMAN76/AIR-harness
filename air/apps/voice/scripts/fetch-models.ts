/**
 * Download the pinned SenseVoice int8 model, its tokens, and the Silero VAD into ~/.air/voice-models.
 * Files that already match the pinned size and SHA-256 are skipped. `pnpm -C air/apps/voice exec tsx scripts/fetch-models.ts`
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadModelAssets, modelPaths, verifyModels, type ModelAssets, type ModelPaths } from '../src/core/models.ts'

const paths = modelPaths()
const assets = loadModelAssets()
const keys = ['model', 'tokens', 'vad'] as const

function only(key: keyof ModelPaths): { paths: ModelPaths; assets: ModelAssets } {
  return {
    paths: { model: paths[key], tokens: paths[key], vad: paths[key] },
    assets: { model: assets[key], tokens: assets[key], vad: assets[key] },
  }
}

await mkdir(dirname(paths.model), { recursive: true })
let failed = false
for (const key of keys) {
  const one = only(key)
  if ((await verifyModels(one.paths, one.assets)).ok) {
    console.log(`ok       ${assets[key].name} (${assets[key].bytes} bytes)`)
    continue
  }
  console.log(`download ${assets[key].name} from ${assets[key].url}`)
  const response = await fetch(assets[key].url)
  if (!response.ok) {
    console.error(`failed   ${assets[key].name}: HTTP ${response.status}`)
    failed = true
    continue
  }
  const partial = `${paths[key]}.partial`
  await writeFile(partial, Buffer.from(await response.arrayBuffer()))
  const check = { paths: { model: partial, tokens: partial, vad: partial }, assets: one.assets }
  if (!(await verifyModels(check.paths, check.assets)).ok) {
    await rm(partial, { force: true })
    console.error(`failed   ${assets[key].name}: size or SHA-256 does not match the pin`)
    failed = true
    continue
  }
  await rename(partial, paths[key])
  console.log(`ok       ${assets[key].name} (${assets[key].bytes} bytes)`)
}
process.exitCode = failed ? 1 : 0
