/**
 * Visual check for the voice orb: launches the built Electron app in preview mode, which tours idle, listening,
 * thinking and speaking (a SAPI sentence through the real playback path), saves one PNG per state and a contact
 * sheet, and prints the measured frame rate.
 * `pnpm -C air/apps/voice run build && pnpm -C air/apps/voice exec tsx scripts/orb-preview.ts [outDir]`
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = process.argv[2] ?? join(homedir(), '.air', 'voice-ui-shots')
const electron = createRequire(import.meta.url)('electron') as string

const env: NodeJS.ProcessEnv = { ...process.env, AIR_VOICE_PREVIEW: out }
delete env['ELECTRON_RUN_AS_NODE']
const child = spawn(electron, [join(root, 'lib', 'main.cjs')], {
  stdio: 'inherit',
  env,
})
child.on('exit', (code) => {
  console.log(`shots in ${out}`)
  process.exit(code ?? 1)
})
