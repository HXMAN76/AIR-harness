/**
 * Voice turn metrics: a monotonic-clock recorder with named marks, spans, counters and labels, and an opt-in JSONL log.
 * A record holds only durations, counts, and labels from a closed vocabulary (`[a-z0-9_.-]`, at most 32 characters),
 * so it cannot carry a transcript, a reply, a path or a key. `AIR_VOICE_METRICS=1` appends records to
 * `<voiceHome>/metrics/voice-<date>.jsonl`.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Milliseconds on a monotonic clock. */
export type Clock = () => number

/** Which kind of event a record describes. */
export type RecordKind = 'turn' | 'barge_in'

/** One finished measurement. */
export interface MetricsRecord {
  kind: RecordKind
  /** Wall-clock time the record was closed, ISO 8601. */
  at: string
  /** Durations in milliseconds (one decimal). */
  spans: Record<string, number>
  /** Counts, such as token totals. */
  counters: Record<string, number>
  /** Short labels: `route`, `path`, `outcome`. */
  labels: Record<string, string>
}

/** Receives each closed record. */
export type MetricsSink = (record: MetricsRecord) => void

const SAFE_NAME = /^[a-z0-9_.-]{1,48}$/
const SAFE_LABEL = /^[a-z0-9_.-]{1,32}$/

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** The marks, spans, counters and labels of one voice turn (or one barge-in). */
export class Trace {
  private readonly marks = new Map<string, number>()
  private readonly spans: Record<string, number> = {}
  private readonly counters: Record<string, number> = {}
  private readonly labels: Record<string, string> = {}
  private closed = false

  constructor(
    private readonly kind: RecordKind,
    private readonly now: Clock,
    private readonly wall: () => Date,
    private readonly sink: MetricsSink | undefined,
  ) {}

  /**
   * Remember a point in time under a name. The first mark of a name wins.
   * @param name - mark name.
   * @param at - monotonic time; now by default.
   * @returns the time stored.
   */
  mark(name: string, at: number = this.now()): number {
    const existing = this.marks.get(name)
    if (existing !== undefined) return existing
    this.marks.set(name, at)
    return at
  }

  /** @returns the time of a mark, or undefined. */
  at(name: string): number | undefined {
    return this.marks.get(name)
  }

  /**
   * Store a duration directly.
   * @param name - span name.
   * @param ms - duration in milliseconds; negative or non-finite values are dropped.
   */
  setSpan(name: string, ms: number): void {
    if (SAFE_NAME.test(name) && Number.isFinite(ms) && ms >= 0) this.spans[name] = round1(ms)
  }

  /**
   * Store the time between two marks; nothing is stored unless both exist.
   * @param name - span name.
   * @param from - starting mark.
   * @param to - ending mark.
   */
  between(name: string, from: string, to: string): void {
    const start = this.marks.get(from)
    const end = this.marks.get(to)
    if (start !== undefined && end !== undefined) this.setSpan(name, end - start)
  }

  /**
   * Add to a counter.
   * @param name - counter name.
   * @param amount - amount to add (default 1); non-finite amounts are dropped.
   */
  count(name: string, amount = 1): void {
    if (SAFE_NAME.test(name) && Number.isFinite(amount)) this.counters[name] = (this.counters[name] ?? 0) + amount
  }

  /**
   * Set a label. A value outside the closed vocabulary is dropped, so free text never gets in.
   * @param name - label name.
   * @param value - label value.
   */
  label(name: string, value: string): void {
    if (SAFE_NAME.test(name) && SAFE_LABEL.test(value)) this.labels[name] = value
  }

  /** @returns the label stored under a name. */
  labelOf(name: string): string | undefined {
    return this.labels[name]
  }

  /**
   * Close the trace once and hand the record to the sink.
   * @returns the record, or undefined when the trace was already closed.
   */
  finish(): MetricsRecord | undefined {
    if (this.closed) return undefined
    this.closed = true
    const record: MetricsRecord = {
      kind: this.kind,
      at: this.wall().toISOString(),
      spans: { ...this.spans },
      counters: { ...this.counters },
      labels: { ...this.labels },
    }
    try {
      this.sink?.(record)
    } catch {
      // Metrics never break the voice loop.
    }
    return record
  }
}

/** Options of {@link MetricsRecorder}. */
export interface RecorderOptions {
  /** Monotonic millisecond clock; defaults to `performance.now`. */
  now?: Clock
  /** Wall clock for the record timestamp. */
  wall?: () => Date
  /** Where closed records go; none keeps them only in the returned value. */
  sink?: MetricsSink
}

/** Creates traces that share a clock and a sink. */
export class MetricsRecorder {
  readonly now: Clock
  private readonly wall: () => Date
  private readonly sink: MetricsSink | undefined

  constructor(options: RecorderOptions = {}) {
    this.now = options.now ?? (() => performance.now())
    this.wall = options.wall ?? (() => new Date())
    this.sink = options.sink
  }

  /** @returns a new trace of the given kind. */
  begin(kind: RecordKind = 'turn'): Trace {
    return new Trace(kind, this.now, this.wall, this.sink)
  }
}

/**
 * @param dir - the metrics folder (`<voiceHome>/metrics`).
 * @returns a sink that appends each record as one JSON line to `voice-<YYYY-MM-DD>.jsonl`; write errors are ignored.
 */
export function jsonlSink(dir: string): MetricsSink {
  return (record) => {
    try {
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, `voice-${record.at.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`)
    } catch {
      // A full disk or a locked file must not stop the voice loop.
    }
  }
}

/**
 * Build the recorder the app uses: records are written only when `AIR_VOICE_METRICS=1`.
 * @param env - process environment.
 * @param voiceHome - the voice runtime home.
 * @param options - clock overrides for tests.
 * @returns the recorder.
 */
export function recorderFromEnv(
  env: Record<string, string | undefined>,
  voiceHome: string,
  options: Omit<RecorderOptions, 'sink'> = {},
): MetricsRecorder {
  return new MetricsRecorder({ ...options, ...env['AIR_VOICE_METRICS'] === '1' ? { sink: jsonlSink(join(voiceHome, 'metrics')) } : {} })
}

/** Summary statistics of a list of durations. */
export interface Stats {
  n: number
  mean: number
  p50: number
  p90: number
  p95: number
  p99: number
  min: number
  max: number
}

/**
 * Linear-interpolation percentile (the "R-7" definition) of a sorted list.
 * @param sorted - values in ascending order, at least one.
 * @param fraction - 0 to 1.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const low = Math.floor(position)
  const high = Math.ceil(position)
  const a = sorted[low] as number
  const b = sorted[high] as number
  return a + (b - a) * (position - low)
}

/**
 * @param values - measurements; non-finite values are ignored.
 * @returns n, mean, p50, p90, p95, p99, min and max, or undefined when there is no value. With few values the high
 *   percentiles are interpolated between neighbours and carry no real tail information; report n beside them.
 */
export function summarize(values: readonly number[]): Stats | undefined {
  const sorted = values.filter(value => Number.isFinite(value)).toSorted((a, b) => a - b)
  if (sorted.length === 0) return undefined
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0] as number,
    max: sorted.at(-1) as number,
  }
}

/** Word-level Levenshtein distance between a reference and a hypothesis, and the reference's word count. */
export function wordEdits(reference: string, hypothesis: string): { edits: number; words: number } {
  const norm = (text: string): string[] => text.toLowerCase().replaceAll(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(word => word !== '')
  const ref = norm(reference)
  const hyp = norm(hypothesis)
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index)
  for (let i = 1; i <= ref.length; i++) {
    const row = [i]
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      row.push(Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + cost))
    }
    previous = row
  }
  return { edits: previous[hyp.length] as number, words: ref.length }
}

/** Word error rate: {@link wordEdits} divided by the reference length (1 when a hypothesis follows an empty reference). */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const { edits, words } = wordEdits(reference, hypothesis)
  if (words === 0) return edits === 0 ? 0 : 1
  return edits / words
}
