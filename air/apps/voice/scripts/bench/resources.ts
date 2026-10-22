/**
 * Idle resources of the real app: starts the built Electron app (`lib/main.cjs`), lets it settle, then samples CPU and
 * memory of the Electron processes, the listener worker and the TTS worker once a second for 60 seconds with nobody
 * speaking. Stops only the process tree it started. The agent runtime starts on the first agent turn, so it is absent
 * here and appears in the e2e benchmark's resource table instead.
 * Needs `pnpm -C air/apps/voice run build` first. `pnpm -C air/apps/voice exec tsx scripts/bench/resources.ts [--quick]`
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { VOICE_APP_ROOT } from '../../src/core/paths.ts'
import { type BenchContext, BenchSkipped, type BenchResult, contextFromArgs, isMain, repoRelative, runDir, writeCsv, writeManifest } from './lib.ts'
import { ProcessSampler, resourceTable, roleTicks } from './sampler.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const main = join(VOICE_APP_ROOT, 'lib', 'main.cjs')
  if (!existsSync(main)) throw new BenchSkipped('the voice app is not built (run `pnpm -C air/apps/voice run build`)')
  const electron = createRequire(join(VOICE_APP_ROOT, 'package.json'))('electron') as string
  const settleMs = ctx.quick ? 5000 : 20_000
  const windowMs = ctx.quick ? 8000 : 60_000

  const app = spawn(electron, [main], { cwd: VOICE_APP_ROOT, stdio: 'ignore', windowsHide: false })
  const pid = app.pid
  if (pid === undefined) throw new BenchSkipped('the Electron app did not start')
  log(`app started; settling ${settleMs / 1000} s, then sampling ${windowMs / 1000} s`)
  const sampler = new ProcessSampler(pid)
  try {
    await sleep(settleMs)
    sampler.start()
    await sleep(windowMs)
  } finally {
    sampler.stop()
    try {
      // Only the tree this run started: the app's own processes and its workers.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      // Already gone.
    }
  }
  const ticks = roleTicks(sampler.samples)
  const dir = runDir(ctx, 'resources')
  writeCsv(join(dir, 'data.csv'), ['t_unix_ms', 'role', 'cpu_percent_of_one_core', 'rss_mib', 'processes'], ticks.map(tick => [tick.t, tick.role, tick.cpuPercent, tick.rssMiB, tick.processes]))
  await writeManifest(dir, 'resources', ticks.length, { settleSeconds: settleMs / 1000, windowSeconds: windowMs / 1000, intervalSeconds: 1, state: 'idle: nobody speaking, microphone open, window shown' })
  return {
    bench: 'resources',
    dir: repoRelative(dir),
    n: ticks.length,
    tables: [resourceTable('Idle app: CPU and memory by role, one sample per second', ticks)],
    notes: [
      `${windowMs / 1000} s window after ${settleMs / 1000} s of settling; the app speaks one line at start-up (the model announcement), which falls inside the settle time.`,
      'CPU is percent of one core (a role with several processes is summed; the machine has 24 logical cores). Memory is the working set, which counts shared pages in each process, so the all-roles row overstates the true total.',
      'Role host is the Electron main process; the renderer, GPU and utility processes belong to Electron. The microphone stays open and the window shows an animated orb, so this is the idle state a user would leave running, not a stopped app.',
    ],
  }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
