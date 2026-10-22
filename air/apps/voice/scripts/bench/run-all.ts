/**
 * Runs every voice benchmark in turn (never in parallel, so they do not disturb each other) and writes the Markdown
 * summary `research/data/voice/SUMMARY.md` (overwritten each run) plus a time-stamped copy under
 * `research/data/voice/summaries/`.
 * `pnpm -C air/apps/voice exec tsx scripts/bench/run-all.ts [--quick] [--only stt,wake,tts,operator,agent,e2e,resources]`
 * `--quick` uses tiny counts and writes to a temporary folder; it only checks that the harness works.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BenchContext, type BenchResult, BenchSkipped, DATA_ROOT, contextFromArgs, machineFacts, markdownTable } from './lib.ts'

const ORDER = ['stt', 'wake', 'tts', 'operator', 'agent', 'e2e', 'resources'] as const
type Name = typeof ORDER[number]

const TITLES: Record<Name, string> = {
  stt: 'Speech recognition (Parakeet)',
  wake: 'Text wake',
  tts: 'Speech output (Kokoro and SAPI)',
  operator: 'Local operator',
  agent: 'Agent turns (local and cloud route)',
  e2e: 'End to end (speech in, first audio out)',
  resources: 'Idle resources of the app',
}

async function load(name: Name): Promise<(ctx: BenchContext, log: (line: string) => void) => Promise<BenchResult>> {
  switch (name) {
    case 'stt': return (await import('./stt.ts')).run
    case 'wake': return (await import('./wake.ts')).run
    case 'tts': return (await import('./tts.ts')).run
    case 'operator': return (await import('./operator.ts')).run
    case 'agent': return (await import('./agent.ts')).run
    case 'e2e': return (await import('./e2e.ts')).run
    case 'resources': return (await import('./resources.ts')).run
  }
}

/** @returns the Markdown summary of a run. */
export function renderSummary(
  stamp: string,
  quick: boolean,
  machine: Record<string, unknown>,
  results: readonly (BenchResult | { bench: Name; skipped: string })[],
): string {
  const lines: string[] = [
    '# Voice benchmarks',
    '',
    `Run \`${stamp}\`${quick ? ' (QUICK RUN: tiny counts, harness check only, not a result)' : ''}. Every table below is generated from the CSV files named in its section; nothing is typed in by hand.`,
    '',
    '## Machine and software',
    '',
    ...Object.entries(machine).map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`),
    '',
    '## How to read these numbers',
    '',
    '- `n` is the number of measurements behind each row. With fewer than about 30 measurements, p95 and p99 are interpolated between a handful of points and say little about the tail; treat them as the largest values seen, not as estimates of a population.',
    '- Percentiles use linear interpolation between order statistics. Latencies are milliseconds unless a title says otherwise.',
    '- The speech is synthetic (Kokoro and Windows SAPI voices), not a person speaking into the microphone, so recognition and wake rates are likely better than real use. The owner\'s own clips are reported separately in the wake section and have no ground truth.',
    '- One laptop, one run. The numbers describe this machine at the time of the run and are not a general claim about the software.',
    '',
  ]
  for (const result of results) {
    lines.push(`## ${TITLES[result.bench as Name]}`, '')
    if ('skipped' in result) {
      lines.push(`Skipped: ${result.skipped}.`, '')
      continue
    }
    lines.push(`Data: \`${result.dir}\` (${result.n} rows in data.csv, manifest.json beside it).`, '')
    for (const table of result.tables) lines.push(`### ${table.title}`, '', markdownTable(table), '')
    lines.push(...result.notes.map(note => `- ${note}`), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

if (process.argv[1] !== undefined) {
  const argv = process.argv.slice(2)
  const ctx = contextFromArgs(argv)
  const onlyAt = argv.indexOf('--only')
  const only = onlyAt >= 0 ? (argv[onlyAt + 1] ?? '').split(',').filter(name => name !== '') : [...ORDER]
  const selected = ORDER.filter(name => only.includes(name))
  const results: (BenchResult | { bench: Name; skipped: string })[] = []
  for (const name of selected) {
    console.log(`\n=== ${name} ===`)
    try {
      results.push(await (await load(name))(ctx, console.log))
    } catch (error) {
      if (!(error instanceof BenchSkipped)) throw error
      console.log(`skipped: ${error.message}`)
      results.push({ bench: name, skipped: error.message })
    }
  }
  const root = ctx.quick ? join(tmpdir(), 'air-bench-quick') : DATA_ROOT
  mkdirSync(join(root, 'summaries'), { recursive: true })
  const text = renderSummary(ctx.stamp, ctx.quick, await machineFacts(['qwen3-8b-32k']), results)
  writeFileSync(join(root, 'SUMMARY.md'), text)
  writeFileSync(join(root, 'summaries', `SUMMARY-${ctx.stamp}.md`), text)
  console.log(`\nwrote ${join(root, 'SUMMARY.md')}`)
}
