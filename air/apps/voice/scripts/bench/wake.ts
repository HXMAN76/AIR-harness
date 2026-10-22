/**
 * Text wake: the true-positive rate on "Jarvis, <command>" clips and the false-positive rate on phrases without the
 * wake word (including look-alikes such as "service" and "nervous"). Checked three ways: on the reference text alone
 * (the matcher), on the recogniser's transcript of synthesized speech, and on the owner's own recordings, which are
 * reported separately because they have no ground truth beyond the file name.
 * `pnpm -C air/apps/voice exec tsx scripts/bench/wake.ts [--quick]`
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { wordEdits } from '../../src/core/metrics.ts'
import { modelDir, modelRoot } from '../../src/core/models.ts'
import { matchTextWake } from '../../src/core/wake.ts'
import { WorkerEngine } from '../../src/core/worker-engine.ts'
import type { WorkerMessage } from '../../src/core/frames.ts'
import { readWav, resample } from './audio.ts'
import { COMMANDS, ensureCorpus, NEGATIVES } from './corpus.ts'
import { type BenchContext, type BenchResult, contextFromArgs, isMain, percent, repoRelative, runDir, statsTable, writeCsv, writeManifest } from './lib.ts'
import { createParakeet, decode, loadSherpa } from './sherpa.ts'

const SAMPLES = join(homedir(), '.air', 'voice-samples')

interface Tally { tp: number; pos: number; fp: number; neg: number; hardFp: number; hard: number; edits: number; words: number }

/** Feed a clip through the real worker engine in 100 ms frames, then silence, and collect what it sent. */
function throughEngine(sherpa: ReturnType<typeof loadSherpa>, samples: Float32Array): { messages: WorkerMessage[]; decodeMs: number[] } {
  const messages: WorkerMessage[] = []
  const root = modelRoot()
  const engine = new WorkerEngine({
    sherpa,
    modelsRoot: root,
    dirs: { vad: modelDir('vad'), kws: modelDir('kws'), asrEn: modelDir('asr-en'), asrTa: modelDir('asr-ta') },
    keywordsFile: join(root, 'unused.txt'),
    wake: 'text',
    asr: 'parakeet',
    send: message => messages.push(message),
  })
  const padded = new Float32Array(samples.length + 16_000 * 2)
  padded.set(samples)
  for (let at = 0; at < padded.length; at += 1600) engine.push(padded.subarray(at, Math.min(at + 1600, padded.length)))
  engine.finish()
  const decodeMs = messages.flatMap(message => 'type' in message && message.type === 'command' ? [message.decodeMs] : [])
  return { messages, decodeMs }
}

function hasType(message: WorkerMessage, type: string): boolean {
  return 'type' in message && message.type === type
}

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const clips = ensureCorpus(log)
  const recognizer = createParakeet()
  const sherpa = loadSherpa()
  decode(recognizer, readWav(clips[0]!.path).samples)
  const rows: (string | number | boolean)[][] = []

  // 1. The matcher on the reference text.
  let textTp = 0
  for (const command of COMMANDS) {
    const match = matchTextWake(`Jarvis, ${command}`)
    const ok = match.wake && match.command === command
    if (ok) textTp++
    rows.push(['text', 'reference', 'positive', `text-${command}`, true, match.wake, ok, 0, 0, 0])
  }
  let textFp = 0
  for (const negative of NEGATIVES) {
    const match = matchTextWake(negative.text)
    if (match.wake) textFp++
    rows.push(['text', 'reference', negative.hard ? 'hard-negative' : 'negative', `text-${negative.text}`, false, match.wake, !match.wake, 0, 0, 0])
  }

  // 2. The recogniser's transcript of synthesized speech, through the same matcher.
  const perVoice = new Map<string, Tally>()
  const falseWakes = new Map<string, number>()
  const wakeClips = clips.filter(clip => clip.kind !== 'command')
  for (const clip of wakeClips) {
    const group = perVoice.get(clip.voice) ?? { tp: 0, pos: 0, fp: 0, neg: 0, hardFp: 0, hard: 0, edits: 0, words: 0 }
    perVoice.set(clip.voice, group)
    const { text, ms } = decode(recognizer, readWav(clip.path).samples)
    const match = matchTextWake(text)
    if (clip.kind === 'wake') {
      group.pos++
      if (match.wake) group.tp++
      const { edits, words } = wordEdits(clip.command, match.command)
      if (match.wake) {
        group.edits += edits
        group.words += words
      }
      rows.push(['audio', clip.voice, 'positive', clip.id, true, match.wake, match.wake, ms, edits, words])
    } else {
      group.neg++
      if (clip.hard) group.hard++
      if (match.wake) {
        group.fp++
        if (clip.hard) group.hardFp++
        falseWakes.set(clip.text, (falseWakes.get(clip.text) ?? 0) + 1)
      }
      rows.push(['audio', clip.voice, clip.hard ? 'hard-negative' : 'negative', clip.id, false, match.wake, !match.wake, ms, 0, 0])
    }
  }

  // 3. The owner's own recordings, through the real VAD, the 4-second wake rule and the matcher.
  const owner: (string | number)[][] = []
  if (existsSync(SAMPLES)) {
    for (const file of readdirSync(SAMPLES).filter(name => name.toLowerCase().endsWith('.wav')).toSorted()) {
      const pcm = readWav(join(SAMPLES, file))
      const { messages, decodeMs } = throughEngine(sherpa, resample(pcm, 16_000))
      const longest = decodeMs.length > 0 ? Math.max(...decodeMs) : 0
      owner.push([
        file,
        Math.round(pcm.samples.length / pcm.sampleRate * 10) / 10,
        messages.some(message => hasType(message, 'wake')) ? 'yes' : 'no',
        messages.some(message => hasType(message, 'command')) ? 'yes' : 'no',
        messages.filter(message => hasType(message, 'heard')).length,
        Math.round(longest),
      ])
      rows.push(['owner-clip', 'owner-clips', 'unlabelled', file, '', messages.some(message => hasType(message, 'wake')), '', longest, 0, 0])
    }
  }

  const dir = runDir(ctx, 'wake')
  writeCsv(join(dir, 'data.csv'), ['level', 'voice_or_set', 'class', 'clip', 'expected_wake', 'woke', 'correct', 'decode_ms', 'command_word_errors', 'command_ref_words'], rows)
  await writeManifest(dir, 'wake', rows.length, {
    commands: COMMANDS.length,
    negatives: NEGATIVES.length,
    hardNegatives: NEGATIVES.filter(negative => negative.hard).length,
    ownerClips: owner.length,
    matcher: 'matchTextWake (fuzzy name within edit distance 2)',
  })

  const all = [...perVoice.values()]
  const sum = (pick: (group: Tally) => number): number => all.reduce((total, group) => total + pick(group), 0)
  const voiceRow = (label: string, g: Tally): (string | number)[] =>
    [label, g.pos, percent(g.tp, g.pos), g.neg, percent(g.fp, g.neg), g.hard, percent(g.hardFp, g.hard), percent(g.edits, g.words)]
  const tables = [
    {
      title: 'Text wake on the reference text (the matcher alone)',
      columns: ['set', 'n', 'rate'],
      rows: [
        ['positives woken with the right command', COMMANDS.length, percent(textTp, COMMANDS.length)],
        ['negatives woken (false positives)', NEGATIVES.length, percent(textFp, NEGATIVES.length)],
      ],
    },
    {
      title: 'Text wake on synthesized speech (recogniser transcript, then the matcher)',
      columns: ['voice', 'positives', 'true-positive rate', 'negatives', 'false-positive rate', 'hard negatives', 'hard false-positive rate', 'command WER when woken'],
      rows: [
        ...[...perVoice.entries()].map(([voice, group]) => voiceRow(voice, group)),
        voiceRow('all voices', { tp: sum(g => g.tp), pos: sum(g => g.pos), fp: sum(g => g.fp), neg: sum(g => g.neg), hardFp: sum(g => g.hardFp), hard: sum(g => g.hard), edits: sum(g => g.edits), words: sum(g => g.words) }),
      ],
    },
    {
      title: 'Text wake on the owner clips (no ground truth; labelled by file, transcripts not kept)',
      columns: ['clip', 'seconds', 'woke', 'command followed', 'speech without wake', 'longest decode (ms)'],
      rows: owner.length > 0 ? owner : [['(no clips found)', '-', '-', '-', '-', '-']],
    },
    statsTable('Decode time of the synthesized wake and negative clips (ms)', 'set', [['all clips', rows.filter(row => row[0] === 'audio').map(row => Number(row[7]))]]),
  ]
  const notes = [
    `${wakeClips.length} synthesized clips (3 voices x (${COMMANDS.length} "Jarvis, ..." + ${NEGATIVES.length} negatives)); one decode each.`,
    falseWakes.size > 0 ? `False wakes: ${[...falseWakes.entries()].map(([text, count]) => `"${text}" x${count}`).join('; ')}.` : 'No false wakes on the synthesized negatives.',
    'The matcher deliberately accepts names within edit distance 2 of "jarvis" (for example Travis and Davis), so those look-alikes count as false positives by design; the fuzziness buys recall on a mis-heard name.',
    'Owner clips include recordings made while debugging the microphone, some of them SAPI speech played through the speakers; there is no per-clip label, so no rate is computed for them.',
  ]
  return { bench: 'wake', dir: repoRelative(dir), n: rows.length, tables, notes }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
