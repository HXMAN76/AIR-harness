/**
 * The local operator: how long `matchOperatorIntent` takes (microseconds), how long running an intent takes with a
 * dry-run process runner (so URL intents never launch a browser), and the real execution time of the one safe intent
 * pair: open Notepad, then close it with `CloseMainWindow`. The real part is skipped when a Notepad is already running,
 * so it can never touch the user's own window.
 * `pnpm -C air/apps/voice exec tsx scripts/bench/operator.ts [--quick]`
 */
import { nodeExec, type ExecLike } from '@air/dsh-tool-open/exec'
import { join } from 'node:path'
import { matchOperatorIntent, runOperatorIntent, type OperatorIntent } from '../../src/core/operator.ts'
import { COMMANDS } from './corpus.ts'
import { type BenchContext, type BenchResult, contextFromArgs, isMain, repoRelative, runDir, statsTable, writeCsv, writeManifest } from './lib.ts'

const NOTEPAD_RUNNING = '$p = Get-Process -Name notepad -ErrorAction SilentlyContinue; if (-not $p) { exit 1 }'
const NOTEPAD_WINDOW = '$p = Get-Process -Name notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; if (-not $p) { exit 1 }'

async function check(script: string): Promise<boolean> {
  try {
    await nodeExec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {}, 10_000)
    return true
  } catch {
    return false
  }
}

async function until(script: string, present: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (await check(script) === present) return true
    await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
  }
  return false
}

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const reps = ctx.quick ? 20 : 200
  const execReps = ctx.quick ? 3 : 10
  const rows: (string | number)[][] = []

  // 1. Matching alone.
  const matchUs: number[] = []
  const matched: { command: string; intent: OperatorIntent }[] = []
  for (const command of COMMANDS) {
    const intent = matchOperatorIntent(command)
    if (intent !== null) matched.push({ command, intent })
  }
  for (let rep = 0; rep < reps; rep++) {
    for (const command of COMMANDS) {
      const started = performance.now()
      matchOperatorIntent(command)
      const us = (performance.now() - started) * 1000
      matchUs.push(us)
      rows.push(['match', command, rep, us])
    }
  }

  // 2. Running with a dry-run runner: nothing is launched. Time and date answer without a process;
  // news needs the network and lock needs a yes.
  const dry: ExecLike = () => Promise.resolve()
  const dryMs: number[] = []
  const runnable = matched.filter(item => item.intent.kind !== 'lock' && item.intent.kind !== 'news')
  for (const { command, intent } of runnable) {
    for (let rep = 0; rep < execReps * 10; rep++) {
      const started = performance.now()
      await runOperatorIntent(intent, dry)
      const ms = performance.now() - started
      dryMs.push(ms)
      rows.push(['dry-run', command, rep, ms * 1000])
    }
  }

  // 3. Real Notepad open and close.
  const openMs: number[] = []
  const closeMs: number[] = []
  const notes: string[] = []
  const open: OperatorIntent = { kind: 'open', target: 'notepad.exe', label: 'Notepad' }
  const close = matchOperatorIntent('close notepad')
  if (await check(NOTEPAD_RUNNING)) {
    notes.push('Real open/close skipped: a Notepad window was already running, and the benchmark never touches a window it did not open.')
  } else if (close === null) {
    notes.push('Real open/close skipped: "close notepad" did not match an intent.')
  } else {
    for (let rep = 0; rep < execReps; rep++) {
      let started = performance.now()
      await runOperatorIntent(open)
      const opened = performance.now() - started
      if (!await until(NOTEPAD_WINDOW, true, 10_000)) {
        notes.push(`Real open/close stopped at repetition ${rep + 1}: no Notepad window appeared within 10 s.`)
        break
      }
      started = performance.now()
      await runOperatorIntent(close)
      const closed = performance.now() - started
      if (!await until(NOTEPAD_RUNNING, false, 10_000)) {
        notes.push(`Real open/close stopped at repetition ${rep + 1}: Notepad did not close within 10 s after CloseMainWindow; close it by hand.`)
        break
      }
      openMs.push(opened)
      closeMs.push(closed)
      rows.push(['real-open', 'open notepad', rep, opened * 1000], ['real-close', 'close notepad', rep, closed * 1000])
      log(`notepad ${rep + 1}/${execReps}: open ${Math.round(opened)} ms, close ${Math.round(closed)} ms`)
    }
  }

  const dir = runDir(ctx, 'operator')
  writeCsv(join(dir, 'data.csv'), ['stage', 'command', 'rep', 'microseconds'], rows)
  await writeManifest(dir, 'operator', rows.length, { matchRepsPerCommand: reps, commands: COMMANDS.length, matchedIntents: matched.length, dryRunCommands: runnable.length, dryRunRepsPerCommand: execReps * 10, realRepetitions: openMs.length })
  return {
    bench: 'operator',
    dir: repoRelative(dir),
    n: rows.length,
    tables: [
      statsTable('matchOperatorIntent latency (microseconds, all 30 phrases)', 'stage', [['match', matchUs]], 2),
      statsTable('runOperatorIntent with a dry-run runner (ms; includes time/date answers and every open, search, close, volume intent)', 'stage', [['dry-run', dryMs]], 3),
      statsTable('Real execution of the safe pair (ms): the PowerShell call returns, Notepad opened or told to close', 'stage', [['open notepad', openMs], ['close notepad (CloseMainWindow)', closeMs]]),
    ],
    notes: [
      `${matched.length} of the ${COMMANDS.length} command phrases are operator intents; the others go to the agent.`,
      'URL intents (open youtube, search, gmail) are run only with the dry-run runner, so no browser opens during the benchmark.',
      ...notes,
    ],
  }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
