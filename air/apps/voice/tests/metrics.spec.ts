import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MetricsRecorder, jsonlSink, recorderFromEnv, summarize, wordErrorRate, type MetricsRecord } from '../src/core/metrics.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-'))
  dirs.push(dir)
  return dir
}

function rig(): { recorder: MetricsRecorder; records: MetricsRecord[]; tick: (ms: number) => void } {
  let t = 100
  const records: MetricsRecord[] = []
  return {
    recorder: new MetricsRecorder({ now: () => t, wall: () => new Date('2026-10-22T10:00:00.000Z'), sink: record => records.push(record) }),
    records,
    tick: (ms) => { t += ms },
  }
}

describe('Trace', () => {
  it('derives spans from marks, rounds to one decimal, counts, labels, and closes once', () => {
    const { recorder, records, tick } = rig()
    const trace = recorder.begin()
    expect(trace.mark('a')).toBe(100)
    tick(12.34)
    trace.mark('b')
    expect(trace.mark('a', 5)).toBe(100)
    expect(trace.at('a')).toBe(100)
    expect(trace.at('nope')).toBeUndefined()
    trace.between('a_to_b', 'a', 'b')
    trace.between('missing', 'a', 'zzz')
    trace.between('missing2', 'zzz', 'a')
    trace.setSpan('direct', 7.26)
    trace.count('tokens', 5)
    trace.count('tokens')
    trace.label('route', 'local')
    expect(trace.labelOf('route')).toBe('local')
    expect(trace.labelOf('path')).toBeUndefined()
    const record = trace.finish()
    expect(record).toEqual({
      kind: 'turn',
      at: '2026-10-22T10:00:00.000Z',
      spans: { a_to_b: 12.3, direct: 7.3 },
      counters: { tokens: 6 },
      labels: { route: 'local' },
    })
    expect(records).toEqual([record])
    expect(trace.finish()).toBeUndefined()
    expect(records).toHaveLength(1)
  })

  it('refuses free text, bad names, and bad numbers', () => {
    const { recorder } = rig()
    const trace = recorder.begin('barge_in')
    trace.label('route', 'Open my bank statement please')
    trace.label('Bad Name', 'ok')
    trace.setSpan('Bad Name', 1)
    trace.setSpan('neg', -1)
    trace.setSpan('nan', Number.NaN)
    trace.count('Bad Name')
    trace.count('inf', Number.POSITIVE_INFINITY)
    expect(trace.finish()).toMatchObject({ kind: 'barge_in', spans: {}, counters: {}, labels: {} })
  })

  it('works without a sink, and a failing sink never throws', () => {
    expect(new MetricsRecorder().begin().finish()?.kind).toBe('turn')
    const failing = new MetricsRecorder({ sink: () => { throw new Error('disk full') } })
    expect(failing.begin().finish()?.kind).toBe('turn')
  })

  it('uses the monotonic clock by default', () => {
    const recorder = new MetricsRecorder()
    const first = recorder.now()
    expect(recorder.now()).toBeGreaterThanOrEqual(first)
  })
})

describe('jsonlSink and recorderFromEnv', () => {
  const record: MetricsRecord = { kind: 'turn', at: '2026-10-22T10:00:00.000Z', spans: { e2e: 1 }, counters: {}, labels: { route: 'local' } }

  it('appends one line per record to a dated file, creating the folder', () => {
    const dir = join(temp(), 'metrics')
    const sink = jsonlSink(dir)
    sink(record)
    sink({ ...record, at: '2026-10-23T00:00:01.000Z' })
    sink(record)
    expect(readFileSync(join(dir, 'voice-2026-10-22.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([record, record])
    expect(existsSync(join(dir, 'voice-2026-10-23.jsonl'))).toBe(true)
  })

  it('ignores a write that fails', () => {
    const blocked = join(temp(), 'file')
    writeFileSync(blocked, 'x')
    expect(() => jsonlSink(join(blocked, 'metrics'))(record)).not.toThrow()
  })

  it('writes only when AIR_VOICE_METRICS=1', () => {
    const home = temp()
    recorderFromEnv({}, home).begin().finish()
    expect(existsSync(join(home, 'metrics'))).toBe(false)
    recorderFromEnv({ AIR_VOICE_METRICS: '0' }, home).begin().finish()
    expect(existsSync(join(home, 'metrics'))).toBe(false)
    recorderFromEnv({ AIR_VOICE_METRICS: '1' }, home, { wall: () => new Date('2026-10-22T10:00:00.000Z') }).begin().finish()
    expect(existsSync(join(home, 'metrics', 'voice-2026-10-22.jsonl'))).toBe(true)
  })
})

describe('summarize', () => {
  it('computes n, mean, interpolated percentiles, min and max', () => {
    const stats = summarize([5, 1, 3, 2, 4, Number.NaN])
    expect(stats?.n).toBe(5)
    expect(stats?.mean).toBe(3)
    expect(stats?.p50).toBe(3)
    expect(stats?.p90).toBeCloseTo(4.6)
    expect(stats?.p95).toBeCloseTo(4.8)
    expect(stats?.p99).toBeCloseTo(4.96)
    expect([stats?.min, stats?.max]).toEqual([1, 5])
  })

  it('handles one value and none', () => {
    expect(summarize([7])).toEqual({ n: 1, mean: 7, p50: 7, p90: 7, p95: 7, p99: 7, min: 7, max: 7 })
    expect(summarize([])).toBeUndefined()
  })
})

describe('wordErrorRate', () => {
  it('counts substitutions, insertions and deletions over the reference length, ignoring case and punctuation', () => {
    expect(wordErrorRate('Open Notepad.', 'open notepad')).toBe(0)
    expect(wordErrorRate('open the notepad', 'open notepad')).toBeCloseTo(1 / 3)
    expect(wordErrorRate('open notepad', 'open the big notepad')).toBeCloseTo(1)
    expect(wordErrorRate('open notepad', 'close notepad')).toBeCloseTo(0.5)
    expect(wordErrorRate('', '')).toBe(0)
    expect(wordErrorRate('', 'noise')).toBe(1)
    expect(wordErrorRate('open notepad', '')).toBe(1)
  })
})
