/**
 * Regenerate `src/keywords.txt`: the wake phrases as BPE tokens of the KWS model's `bpe.model`.
 * Needs the KWS model (`fetch-models.ts`) and `uv` (sentencepiece runs in a throw-away Python 3.12 environment).
 * `pnpm -C air/apps/voice exec tsx scripts/gen-keywords.ts`
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modelDir } from '../src/core/models.ts'
import { VOICE_APP_ROOT } from '../src/core/paths.ts'

/** Wake phrases, the label the spotter reports, and the per-phrase boost and trigger threshold (tuned on SAPI speech, see README). */
const PHRASES = [
  { phrase: 'JARVIS', label: 'JARVIS', boost: 2, threshold: 0.25 },
  { phrase: 'HEY JARVIS', label: 'JARVIS', boost: 2, threshold: 0.25 },
  { phrase: 'OK JARVIS', label: 'JARVIS', boost: 2, threshold: 0.25 },
]

const PYTHON = 'import json,sys,sentencepiece as spm\nsp=spm.SentencePieceProcessor(model_file=sys.argv[1])\nprint(json.dumps({p:sp.encode(p,out_type=str) for p in sys.argv[2:]}))'

const bpe = join(modelDir('kws'), 'bpe.model')
const run = spawnSync('uv', ['run', '--python', '3.12', '--with', 'sentencepiece', 'python', '-I', '-c', PYTHON, bpe, ...PHRASES.map(entry => entry.phrase)], { encoding: 'utf8' })
if (run.status !== 0) {
  console.error(run.stderr || 'uv failed')
  process.exit(1)
}
const tokens = JSON.parse(run.stdout) as Record<string, string[]>
const lines = PHRASES.map(entry => `${(tokens[entry.phrase] ?? []).join(' ')} :${entry.boost} #${entry.threshold} @${entry.label}`)
const out = join(VOICE_APP_ROOT, 'src', 'keywords.txt')
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')
console.log(`wrote ${out}\n${lines.join('\n')}`)
