import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Audit } from '../src/audit.ts'
import type { ObservedSurface } from '../src/types.ts'
import { emptyDiff } from '../src/verdict.ts'

const NOW = new Date('2026-09-30T00:00:00.000Z')
const KEY = 'a'.repeat(64)
let root: string
let dir: string
let errors: string[]

const surface = (overrides: Partial<ObservedSurface> = {}): ObservedSurface => ({
  serverName: 'browser', surfaceDigest: 'sha256:1', instructions: '', tools: [], diff: emptyDiff(),
  state: 'approved', action: 'accept', withheld: [], pinnedDigest: 'sha256:1', observedAt: 0, ...overrides,
})

const lines = async (file: string): Promise<unknown[]> =>
  (await readFile(join(dir, file), 'utf8')).trimEnd().split('\n').map((line): unknown => JSON.parse(line))

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'air-mcp-audit-')))
  dir = join(root, 'mcp-audit')
  errors = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const audit = (maxFileBytes = 1_000_000): Audit => new Audit(dir, { error: message => errors.push(message) }, () => NOW, maxFileBytes)

describe('Audit', () => {
  it('records each accepted surface once per session and again when it changes', async () => {
    const log = audit()
    await log.recordTurn('session-1', 1, [surface()])
    await log.recordTurn('session-1', 2, [surface()])
    await log.recordTurn('session-2', 1, [surface()])
    const drifted = surface({
      state: 'quarantined', action: 'reject-generation', withheld: ['nav'], surfaceDigest: 'sha256:2',
      diff: { ...emptyDiff(), changed: [{ tool: 'nav', fields: ['description'] }] },
    })
    await log.recordTurn('session-1', 3, [drifted])
    await log.recordTurn('session-1', 5, [{ ...drifted, reviewKey: KEY }])
    await log.recordTurn('session-1', 4, [])

    expect(await lines('session-1.jsonl')).toMatchObject([
      { sessionId: 'session-1', turn: 1, time: NOW.toISOString(), type: 'mcp/surface', data: { serverName: 'browser', surfaceDigest: 'sha256:1', verdict: 'approved', withheld: [], lockfileDigest: 'sha256:1' } },
      { sessionId: 'session-1', turn: 3, time: NOW.toISOString(), type: 'mcp/surface', data: { serverName: 'browser', surfaceDigest: 'sha256:2', verdict: 'quarantined', withheld: ['nav'], lockfileDigest: 'sha256:1' } },
      { sessionId: 'session-1', turn: 3, time: NOW.toISOString(), type: 'mcp/drift', data: { serverName: 'browser', added: [], removed: [], changed: [{ tool: 'nav', fields: ['description'] }], instructionsChanged: false, action: 'reject-generation' } },
      { turn: 5, type: 'mcp/surface', data: { reviewKey: KEY } },
      { turn: 5, type: 'mcp/drift', data: { reviewKey: KEY, action: 'reject-generation' } },
    ])
    expect(await lines('session-2.jsonl')).toHaveLength(1)
    if (process.platform !== 'win32') expect((await stat(join(dir, 'session-1.jsonl'))).mode & 0o777).toBe(0o600)
    if (process.platform !== 'win32') expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  it('keeps same-named servers with different review keys apart and records the key', async () => {
    const log = audit()
    await log.recordTurn('s', 1, [surface(), surface({ reviewKey: KEY }), surface({ reviewKey: KEY })])
    const records = await lines('s.jsonl') as { data: { reviewKey?: string } }[]
    expect(records).toHaveLength(2)
    expect(Object.hasOwn(records[0]!.data, 'reviewKey')).toBe(false)
    expect(records[1]!.data.reviewKey).toBe(KEY)
  })

  it('omits the lockfile digest for an unpinned server and keeps file names inside the audit directory', async () => {
    const { pinnedDigest: _unused, ...unpinned } = surface({ state: 'unpinned', action: 'withhold' })
    await audit().recordTurn('../evil id', 1, [unpinned])
    const [record] = await lines('.._evil_id.jsonl') as { data: object }[]
    expect(Object.hasOwn(record!.data, 'lockfileDigest')).toBe(false)
  })

  it('appends process-level drift with a timestamp, the review key, and no session', async () => {
    await audit().drift({ serverName: 'browser', reviewKey: KEY, ...emptyDiff(), added: ['extra'], action: 'withhold' })
    expect(await lines('process.jsonl')).toEqual([
      { time: NOW.toISOString(), type: 'mcp/drift', data: { serverName: 'browser', reviewKey: KEY, added: ['extra'], removed: [], changed: [], instructionsChanged: false, action: 'withhold' } },
    ])
  })

  it('keeps the complete text of changed definitions and instructions recoverable by digest', async () => {
    const description = `${'long description '.repeat(400)}END`
    expect(description.length).toBeGreaterThan(4000)
    const nav = { name: 'nav', description, inputSchema: { type: 'object' as const } }
    const added = { name: 'extra', description: 'new', inputSchema: { type: 'object' as const } }
    const instructions = `${'follow these rules\n'.repeat(300)}LAST`
    const changed = surface({
      state: 'withheld', action: 'withhold', withheld: ['extra'], surfaceDigest: 'sha256:2', instructions,
      tools: [nav, added, { name: 'same', inputSchema: { type: 'object' as const } }],
      diff: { ...emptyDiff(), added: ['extra'], changed: [{ tool: 'nav', fields: ['description'] }], instructionsChanged: true },
    })
    const log = audit()
    await log.recordTurn('s', 1, [changed])
    await log.drift({ serverName: 'browser', ...changed.diff, action: 'withhold' }, changed)

    const read = async (blob: string): Promise<unknown> => {
      const text = await readFile(join(dir, 'blobs', `${blob.slice('sha256:'.length)}.json`), 'utf8')
      expect(`sha256:${createHash('sha256').update(text).digest('hex')}`).toBe(blob)
      return JSON.parse(text)
    }
    const [record] = await lines('s.jsonl') as { data: { definitions: { tool: string; blob: string }[]; instructionsBlob: string } }[]
    expect(record!.data.definitions.map(ref => ref.tool).sort()).toEqual(['extra', 'nav'])
    const nav2 = record!.data.definitions.find(ref => ref.tool === 'nav')!
    expect(await read(nav2.blob)).toEqual(nav)
    expect(((await read(nav2.blob)) as { description: string }).description).toBe(description)
    expect(await read(record!.data.instructionsBlob)).toBe(instructions)

    const [process] = await lines('process.jsonl') as { data: { definitions: unknown; instructionsBlob: string } }[]
    expect(process!.data.definitions).toEqual(record!.data.definitions)
    expect(process!.data.instructionsBlob).toBe(record!.data.instructionsBlob)
    expect((await readdir(join(dir, 'blobs'))).filter(name => name.endsWith('.json'))).toHaveLength(3)
  })

  it('records definitions of a newly seen server with its instructions, and none for an unchanged surface', async () => {
    const tool = { name: 'a', inputSchema: { type: 'object' as const } }
    const first = surface({
      state: 'unpinned', action: 'withhold', instructions: 'hello', tools: [tool], diff: { ...emptyDiff(), added: ['a'] },
    })
    await audit().recordTurn('s', 1, [first, surface({ serverName: 'quiet', instructions: 'ignored', tools: [tool] })])
    const records = await lines('s.jsonl') as { data: { serverName: string; definitions?: unknown; instructionsBlob?: string } }[]
    expect(records.find(record => record.data.serverName === 'browser')!.data.definitions).toHaveLength(1)
    expect(records.find(record => record.data.serverName === 'browser')!.data.instructionsBlob).toBeDefined()
    const quiet = records.find(record => record.data.serverName === 'quiet')!
    expect(Object.hasOwn(quiet.data, 'definitions')).toBe(false)
    expect(Object.hasOwn(quiet.data, 'instructionsBlob')).toBe(false)
  })

  it('writes hostile text as one JSON line per record', async () => {
    const nasty = surface({
      state: 'withheld', action: 'withhold', withheld: ['x\n{"type":"forged"} '], surfaceDigest: 'sha256:9',
      diff: { ...emptyDiff(), added: ['x\n{"type":"forged"} \ud800'] },
    })
    await audit().recordTurn('s', 1, [nasty])
    const text = await readFile(join(dir, 's.jsonl'), 'utf8')
    expect(text.split('\n')).toHaveLength(3)
    expect((await lines('s.jsonl')).every(record => (record as { type: string }).type !== 'forged')).toBe(true)
  })

  it('does not interleave concurrent appends', async () => {
    const log = audit()
    const writes: Promise<void>[] = []
    for (let index = 0; index < 20; index += 1) {
      writes.push(log.drift({ serverName: `s${String(index)}`, ...emptyDiff(), added: ['x'.repeat(5000)], action: 'withhold' }))
    }
    await Promise.all(writes)
    expect(await lines('process.jsonl')).toHaveLength(20)
  })

  it('rotates a full file to one previous file', async () => {
    const log = audit(900)
    const record = { serverName: 'browser', ...emptyDiff(), added: ['x'.repeat(300)], action: 'withhold' as const }
    for (let index = 0; index < 5; index += 1) await log.drift(record)
    const current = await lines('process.jsonl')
    const previous = await lines('process.jsonl.1')
    expect(current.length).toBeGreaterThan(0)
    expect(previous.length).toBeGreaterThan(0)
    expect(current.length + previous.length).toBeLessThanOrEqual(5)
    expect((await stat(join(dir, 'process.jsonl'))).size).toBeLessThanOrEqual(900)
    expect((await readdir(dir)).sort()).toEqual(['process.jsonl', 'process.jsonl.1'])
  })

  it('reports a failed write as an error and keeps running', async () => {
    await writeFile(dir, 'not a directory')
    await audit().drift({ serverName: 'browser', ...emptyDiff(), action: 'accept' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('audit write')
  })
})
