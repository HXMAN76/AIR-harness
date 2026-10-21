/** Locations in the repository, computed from this source file (`air/apps/voice/src/core`). Bundled entry points pass their own. */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root of the fork. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

/** Root of the voice app (`air/apps/voice`). */
export const VOICE_APP_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Upstream SenseVoice package; its `package.json` anchors `sherpa-onnx-node` resolution and its runtime holds `assets.json`. */
export const SENSEVOICE_PACKAGE_JSON = join(REPO_ROOT, 'packages', 'experimental', 'speech-to-text-sensevoice', 'package.json')
