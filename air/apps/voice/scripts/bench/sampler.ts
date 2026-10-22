/**
 * Samples CPU and memory of a process tree once a second through a long-lived PowerShell child
 * (`sample-processes.ps1`), and turns the samples into per-role statistics. Roles are assigned by the sampler from the
 * command line (host, listener, tts, dsh-runtime, electron-*, ...); command lines themselves are never kept.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineReader } from '../../src/core/child.ts'
import { summarize } from '../../src/core/metrics.ts'
import type { SummaryTable } from './lib.ts'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'sample-processes.ps1')

/** One process at one sample time. */
export interface ProcessSample {
  /** Unix time of the sampling cycle, ms. */
  t: number
  pid: number
  role: string
  /** Cumulative processor time, ms. */
  cpuMs: number
  rssBytes: number
}

/** One role's totals for one sampling cycle. */
export interface RoleTick {
  t: number
  role: string
  /** Percent of one core used since the previous cycle (can exceed 100). */
  cpuPercent: number
  rssMiB: number
  processes: number
}

function isSample(value: unknown): value is ProcessSample {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['t'] === 'number' && typeof record['pid'] === 'number' && typeof record['role'] === 'string'
    && typeof record['cpuMs'] === 'number' && typeof record['rssBytes'] === 'number'
}

/** Watches a process and everything it starts. */
export class ProcessSampler {
  private child: ChildProcess | undefined
  readonly samples: ProcessSample[] = []

  /**
   * @param rootPid - the process whose tree is sampled (its role is `host`).
   * @param intervalMs - time between cycles.
   */
  constructor(private readonly rootPid: number, private readonly intervalMs = 1000) {}

  /** Start sampling. */
  start(): void {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-RootPid', String(this.rootPid), '-IntervalMs', String(this.intervalMs)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    child.stdout.on('data', lineReader((line) => {
      try {
        const value: unknown = JSON.parse(line)
        if (isSample(value)) this.samples.push(value)
      } catch {
        // A partial or non-JSON line is ignored.
      }
    }))
    this.child = child
  }

  /** Stop sampling and return everything collected. */
  stop(): ProcessSample[] {
    this.child?.kill()
    this.child = undefined
    return this.samples
  }
}

/**
 * Turn raw samples into per-role, per-cycle totals. CPU needs two cycles of the same process, so a process contributes
 * from its second cycle on.
 */
export function roleTicks(samples: readonly ProcessSample[]): RoleTick[] {
  const previous = new Map<number, ProcessSample>()
  const byCycle = new Map<number, ProcessSample[]>()
  for (const sample of samples) byCycle.set(sample.t, [...byCycle.get(sample.t) ?? [], sample])
  const ticks: RoleTick[] = []
  for (const [t, cycle] of [...byCycle.entries()].toSorted((a, b) => a[0] - b[0])) {
    const roles = new Map<string, { cpu: number; rss: number; processes: number }>()
    for (const sample of cycle) {
      const before = previous.get(sample.pid)
      previous.set(sample.pid, sample)
      if (before === undefined || t <= before.t) continue
      const role = roles.get(sample.role) ?? { cpu: 0, rss: 0, processes: 0 }
      role.cpu += (sample.cpuMs - before.cpuMs) / (t - before.t) * 100
      role.rss += sample.rssBytes / 2 ** 20
      role.processes++
      roles.set(sample.role, role)
    }
    for (const [role, total] of roles) {
      ticks.push({ t, role, cpuPercent: Math.max(0, total.cpu), rssMiB: total.rss, processes: total.processes })
    }
  }
  return ticks
}

/**
 * @param title - table title.
 * @param ticks - from {@link roleTicks}.
 * @returns per-role CPU (percent of one core) and resident memory (MiB, working set), over the sampling cycles.
 */
export function resourceTable(title: string, ticks: readonly RoleTick[]): SummaryTable {
  const roles = [...new Set(ticks.map(tick => tick.role))].toSorted()
  const round = (value: number): number => Math.round(value * 10) / 10
  const rows = roles.map((role) => {
    const mine = ticks.filter(tick => tick.role === role)
    const cpu = summarize(mine.map(tick => tick.cpuPercent))
    const rss = summarize(mine.map(tick => tick.rssMiB))
    const processes = Math.max(...mine.map(tick => tick.processes))
    return [
      role, processes, mine.length,
      round(cpu?.mean ?? 0), round(cpu?.p95 ?? 0), round(cpu?.max ?? 0), round(rss?.mean ?? 0), round(rss?.max ?? 0),
    ]
  })
  const cycles = [...new Set(ticks.map(tick => tick.t))].map(t => ticks.filter(tick => tick.t === t))
  const totalCpu = summarize(cycles.map(cycle => cycle.reduce((sum, tick) => sum + tick.cpuPercent, 0)))
  const totalRss = summarize(cycles.map(cycle => cycle.reduce((sum, tick) => sum + tick.rssMiB, 0)))
  if (cycles.length > 0) rows.push(['all roles together', Math.max(...cycles.map(cycle => cycle.reduce((sum, tick) => sum + tick.processes, 0))), cycles.length, round(totalCpu?.mean ?? 0), round(totalCpu?.p95 ?? 0), round(totalCpu?.max ?? 0), round(totalRss?.mean ?? 0), round(totalRss?.max ?? 0)])
  return { title, columns: ['role', 'processes', 'cycles', 'CPU mean (% of one core)', 'CPU p95', 'CPU max', 'RSS mean (MiB)', 'RSS max (MiB)'], rows }
}
