/** Create the voice runtime home and workspace and install the profile plugins: `pnpm -C air/apps/voice exec tsx scripts/setup-home.ts` */
import { nodeExec } from '@air/dsh-tool-open/exec'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CREDENTIALS_FILE, TOKEN_FILE } from '../src/core/gmail/auth.ts'
import { prepareVoiceHome, voiceHome, voiceWorkspace } from '../src/core/home.ts'
import { REPO_ROOT } from '../src/core/paths.ts'
import { installVoicePlugins } from '../src/core/plugins.ts'

const report = prepareVoiceHome({ home: voiceHome(), workspace: voiceWorkspace() })
console.log(`voice home: ${report.home}`)
console.log(`workspace:  ${report.workspace}`)
console.log(`.env:       ${report.envUpdated ? 'added OLLAMA_API_KEY=ollama' : 'unchanged'}${report.backup === undefined ? '' : ` (backup ${report.backup})`}`)
console.log(`OLLAMA_CLOUD_KEY present: ${report.cloudKey ? 'yes' : 'no'}`)

console.log(`gmail:      ${CREDENTIALS_FILE} present: ${existsSync(join(report.home, CREDENTIALS_FILE)) ? 'yes' : 'no'}; ${TOKEN_FILE} present: ${existsSync(join(report.home, TOKEN_FILE)) ? 'yes' : 'no'} (see README, Gmail API)`)

const plugins = await installVoicePlugins({ home: report.home, repoRoot: REPO_ROOT, exec: nodeExec })
console.log('browser:    for web apps such as Gmail on the cloud routes, run once at the repository root: pnpm exec playwright install chromium')
console.log(`plugins:    installed ${plugins.installed.join(', ') || 'none'}; already present ${plugins.skipped.join(', ') || 'none'}`)
