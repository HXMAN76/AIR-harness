/** Manual check: speak the arguments through the SAPI child. `pnpm -C air/apps/voice exec tsx scripts/say.ts "Hello from AIR"` */
import { Speaker } from '../src/core/speaker.ts'

const speaker = new Speaker()
await speaker.speak(process.argv.slice(2).join(' ') || 'Hello from AIR')
await speaker.dispose()
