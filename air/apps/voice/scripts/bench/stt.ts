/**
 * Speech recognition: Parakeet decode latency and real-time factor over the synthesized command clips, repeated,
 * and word error rate against the spoken text. The clips are synthetic speech, not a human voice.
 * `pnpm -C air/apps/voice exec tsx scripts/bench/stt.ts [--quick]`
 */
import { join } from 'node:path'
import { wordEdits } from '../../src/core/metrics.ts'
import { readWav } from './audio.ts'
import { ensureCorpus, VOICES } from './corpus.ts'
import { type BenchContext, type BenchResult, contextFromArgs, isMain, percent, repoRelative, runDir, statsTable, writeCsv, writeManifest } from './lib.ts'
import { createParakeet, decode } from './sherpa.ts'

/** Decodes per clip in the committed run. */
export const STT_RUNS = 5

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const clips = ensureCorpus(log).filter(clip => clip.kind === 'command')
  const runs = ctx.quick ? 2 : STT_RUNS
  const recognizer = createParakeet()
  const first = readWav(clips[0]!.path)
  const cold = decode(recognizer, first.samples).ms
  decode(recognizer, first.samples)
  const rows: (string | number)[][] = []
  const perVoice = new Map<string, { ms: number[]; rtf: number[]; edits: number; words: number; exact: number; clips: number }>()
  for (const clip of clips) {
    const pcm = readWav(clip.path)
    const audioMs = pcm.samples.length / pcm.sampleRate * 1000
    const group = perVoice.get(clip.voice) ?? { ms: [], rtf: [], edits: 0, words: 0, exact: 0, clips: 0 }
    perVoice.set(clip.voice, group)
    for (let index = 0; index < runs; index++) {
      const { text, ms } = decode(recognizer, pcm.samples)
      const { edits, words } = wordEdits(clip.text, text)
      rows.push([clip.voice, clip.id, index, Math.round(audioMs), ms, ms / audioMs, edits, words, text])
      group.ms.push(ms)
      group.rtf.push(ms / audioMs)
      if (index === 0) {
        group.edits += edits
        group.words += words
        group.clips++
        if (edits === 0) group.exact++
      }
    }
  }
  const dir = runDir(ctx, 'stt')
  writeCsv(join(dir, 'data.csv'), ['voice', 'clip', 'run', 'audio_ms', 'decode_ms', 'rtf', 'word_edits', 'ref_words', 'hypothesis'], rows)
  await writeManifest(dir, 'stt', rows.length, { runsPerClip: runs, clips: clips.length, voices: VOICES.map(voice => voice.id), recognizer: 'parakeet-tdt (int8, 4 threads, cpu)', coldFirstDecodeMs: Math.round(cold) })
  const all = [...perVoice.values()]
  const byVoice = (pick: (group: typeof all[number]) => number[]): (readonly [string, readonly number[]])[] =>
    [...[...perVoice.entries()].map(([voice, group]) => [voice, pick(group)] as const), ['all voices', all.flatMap(pick)] as const]
  const werRow = (label: string, group: { edits: number; words: number; exact: number; clips: number }): (string | number)[] =>
    [label, group.clips, group.words, group.edits, percent(group.edits, group.words), percent(group.exact, group.clips)]
  const total = { edits: 0, words: 0, exact: 0, clips: 0 }
  for (const group of all) {
    total.edits += group.edits
    total.words += group.words
    total.exact += group.exact
    total.clips += group.clips
  }
  return {
    bench: 'stt',
    dir: repoRelative(dir),
    n: rows.length,
    tables: [
      statsTable('Parakeet decode latency (ms), per voice', 'voice', byVoice(group => group.ms)),
      statsTable('Parakeet real-time factor (decode time / audio time)', 'voice', byVoice(group => group.rtf), 3),
      { title: 'Word error rate against the spoken text (first decode of each clip)', columns: ['voice', 'clips', 'ref words', 'word errors', 'WER', 'clips with no error'], rows: [...[...perVoice.entries()].map(([voice, group]) => werRow(voice, group)), werRow('all voices', total)] },
    ],
    notes: [
      `${clips.length} clips x ${runs} decodes; decoding is deterministic, so repeats measure timing only and the WER rows use each clip once.`,
      `Cold first decode in this process: ${Math.round(cold)} ms (excluded from the tables, as is one more warm-up decode).`,
      'Synthetic speech from Kokoro and SAPI; real microphone speech is harder. Latency is the recogniser call only (stream creation to result), as the listener worker measures it.',
    ],
  }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
