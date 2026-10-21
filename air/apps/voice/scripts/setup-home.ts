/** Create the voice runtime home and workspace. `pnpm -C air/apps/voice exec tsx scripts/setup-home.ts` */
import { prepareVoiceHome, voiceHome, voiceWorkspace } from '../src/core/home.ts'

const report = prepareVoiceHome({ home: voiceHome(), workspace: voiceWorkspace() })
console.log(`voice home: ${report.home}`)
console.log(`workspace:  ${report.workspace}`)
console.log(`.env:       ${report.envUpdated ? 'added OLLAMA_API_KEY=ollama' : 'unchanged'}${report.backup === undefined ? '' : ` (backup ${report.backup})`}`)
console.log(`OLLAMA_CLOUD_KEY present: ${report.cloudKey ? 'yes' : 'no'}`)
