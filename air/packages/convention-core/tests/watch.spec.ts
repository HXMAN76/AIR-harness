import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PollWatcher } from '../src/index.ts'

const created: string[] = []
const watchers: PollWatcher[] = []

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-watch-'))
  created.push(dir)
  return dir
}

function watcher(onChange: () => void, options: { maxGroups?: number; onError?: (error: unknown) => void } = {}): PollWatcher {
  const subject = new PollWatcher({ intervalMs: 20, maxGroups: options.maxGroups ?? 8, onChange, onError: options.onError ?? (() => {}) })
  watchers.push(subject)
  return subject
}

describe('PollWatcher', () => {
  it('reports a change to a retained file and nothing while it is unchanged', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    await sleep(120)
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now())
    await subject.pollOnce()
    await subject.pollOnce()
    expect(onChange).not.toHaveBeenCalled()
    await writeFile(file, 'one two three')
    await subject.pollOnce()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports a retained path that appears after it was listed as absent', async () => {
    const dir = await tempDir()
    const file = join(dir, 'later.md')
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now())
    await subject.pollOnce()
    expect(onChange).not.toHaveBeenCalled()
    await writeFile(file, 'now present')
    await subject.pollOnce()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports a file modified between listing and the first poll, and ignores an older one', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'content')
    const stale = vi.fn()
    watcher(stale).retain('project', [file], Date.now() + 10_000)
    const early = vi.fn()
    const subject = watcher(early)
    subject.retain('project', [file], Date.now() - 10_000)
    await subject.pollOnce()
    expect(early).toHaveBeenCalledTimes(1)
    const quiet = watcher(stale)
    quiet.retain('project', [file], Date.now() + 10_000)
    await quiet.pollOnce()
    expect(stale).not.toHaveBeenCalled()
  })

  it('polls on its own timer', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now() + 10_000)
    await subject.pollOnce()
    await writeFile(file, 'one two three four')
    await vi.waitFor(() => { expect(onChange).toHaveBeenCalled() }, { timeout: 5000 })
  })

  it('evicts the least recently retained project and invalidates once', async () => {
    const onChange = vi.fn()
    const subject = watcher(onChange, { maxGroups: 2 })
    subject.retain('a', ['pa'], 0)
    subject.retain('b', ['pb'], 0)
    subject.retain('a', ['pa'], 0)
    expect(subject.groups).toEqual(['b', 'a'])
    subject.retain('c', ['pc'], 0)
    expect(subject.groups).toEqual(['a', 'c'])
    await vi.waitFor(() => { expect(onChange).toHaveBeenCalledTimes(1) })
  })

  it('does not report a release when the watcher closes before it is delivered', async () => {
    const onChange = vi.fn()
    const subject = watcher(onChange, { maxGroups: 1 })
    subject.retain('a', ['pa'], 0)
    subject.retain('b', ['pb'], 0)
    subject.close()
    await sleep(10)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats an unreadable path as unchanged', async () => {
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', ['bad\0path'], Date.now())
    await subject.pollOnce()
    await subject.pollOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('passes a failing change callback to onError', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onError = vi.fn()
    const subject = watcher(() => { throw new Error('boom') }, { onError })
    subject.retain('project', [file], Date.now() + 10_000)
    await subject.pollOnce()
    await writeFile(file, 'one two three four')
    await vi.waitFor(() => { expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' })) }, { timeout: 5000 })
  })

  it('stops on close, ignores later retains, and does not report a poll that finished after close', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now() + 10_000)
    await subject.pollOnce()
    await writeFile(file, 'one two three four')
    const pending = subject.pollOnce()
    subject.close()
    await pending
    expect(onChange).not.toHaveBeenCalled()
    expect(subject.groups).toEqual([])
    subject.retain('project', [file], 0)
    expect(subject.groups).toEqual([])
  })
})
