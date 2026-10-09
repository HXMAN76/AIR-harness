import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CANONICALIZATION, emptyLock, LockfileError, LOCK_VERSION, parseLockDocument, readLockfile,
  updateLockfile, watchLockfile, type LockServer,
} from '../src/lockfile.ts'

const D = `sha256:${'a'.repeat(64)}`
const IDENTITY = 'b'.repeat(64)

const SERVER: LockServer = {
  surfaceDigest: D,
  instructions: { digest: D, text: 'Use carefully.' },
  tools: {
    echo: {
      digest: D,
      fields: { description: D },
      definition: { name: 'echo', description: 'Echo.' },
      approvedAt: '2026-09-29T10:00:00.000Z',
      approvedBy: 'cli',
    },
  },
}

const document = (servers: Record<string, unknown>): unknown => ({
  version: LOCK_VERSION, canonicalization: CANONICALIZATION, servers,
})

let dir: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'air-mcp-lock-')))
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('parseLockDocument', () => {
  it('accepts a complete document and a server without instructions', () => {
    const { instructions: _dropped, ...bare } = SERVER
    const parsed = parseLockDocument(document({ browser: SERVER, bare }))
    expect(parsed.servers['browser']).toEqual(SERVER)
    expect(parsed.servers['bare']).toEqual(bare)
    expect(parsed.servers['missing']).toBeUndefined()
  })

  it('keeps a server named __proto__ as data', () => {
    const parsed = parseLockDocument(JSON.parse(
      `{"version":1,"canonicalization":"${CANONICALIZATION}","servers":{"__proto__":${JSON.stringify(SERVER)}}}`,
    ))
    expect(Object.keys(parsed.servers)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(parsed.servers)).toBeNull()
  })

  it('keeps tool and field names such as __proto__ and constructor as data', () => {
    const tool = SERVER.tools['echo']
    const parsed = parseLockDocument(JSON.parse(JSON.stringify(document({
      s: { ...SERVER, tools: { constructor: tool } },
    })).replace('"constructor"', '"__proto__"')))
    const tools = parsed.servers['s']!.tools
    expect(Object.keys(tools)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(tools)).toBeNull()
    expect(({} as Record<string, unknown>)['echo']).toBeUndefined()
  })

  it('round-trips an optional identity and rejects a malformed one', () => {
    const pinned = { ...SERVER, identity: IDENTITY }
    expect(parseLockDocument(document({ s: pinned })).servers['s']).toEqual(pinned)
    expect(() => parseLockDocument(document({ s: { ...SERVER, identity: 'xyz' } }))).toThrow('lockfile.servers.s.identity')
  })

  it('drops members it does not know, so they are not carried into the pin', () => {
    const noisy = { ...SERVER, extra: 1, tools: { echo: { ...SERVER.tools['echo'], approved: true } } }
    const parsed = parseLockDocument({ ...(document({ s: noisy }) as object), futureField: 1 })
    expect(parsed.servers['s']).toEqual(SERVER)
    expect(Object.keys(parsed).sort()).toEqual(['canonicalization', 'servers', 'version'])
  })

  it.each([
    ['a non-object root', [], 'lockfile must be an object'],
    ['a null root', null, 'lockfile must be an object'],
    ['an unknown version', { version: 2, canonicalization: CANONICALIZATION, servers: {} }, 'lockfile.version must be 1'],
    ['an unknown canonicalization', { version: 1, canonicalization: 'sorted-keys', servers: {} }, 'lockfile.canonicalization'],
    ['missing servers', { version: 1, canonicalization: CANONICALIZATION }, 'lockfile.servers must be an object'],
    ['a malformed surface digest', document({ s: { ...SERVER, surfaceDigest: 'md5:1' } }), 'lockfile.servers.s.surfaceDigest'],
    ['an upper-case digest', document({ s: { ...SERVER, surfaceDigest: `sha256:${'A'.repeat(64)}` } }), 'lockfile.servers.s.surfaceDigest'],
    ['a non-string digest', document({ s: { ...SERVER, surfaceDigest: 5 } }), 'lockfile.servers.s.surfaceDigest must be a string'],
    ['non-string instruction text', document({ s: { ...SERVER, instructions: { digest: D, text: 1 } } }), 'lockfile.servers.s.instructions.text'],
    ['a tool that is null', document({ s: { ...SERVER, tools: { echo: null } } }), 'lockfile.servers.s.tools.echo must be an object'],
    ['a malformed field digest', document({ s: { ...SERVER, tools: { echo: { ...SERVER.tools['echo'], fields: { description: 'x' } } } } }), 'fields.description'],
    ['an unknown approver', document({ s: { ...SERVER, tools: { echo: { ...SERVER.tools['echo'], approvedBy: 'web' } } } }), 'approvedBy'],
  ])('rejects %s', (_label, value, message) => {
    expect(() => parseLockDocument(value)).toThrow(LockfileError)
    expect(() => parseLockDocument(value)).toThrow(message)
  })
})

describe('readLockfile', () => {
  it('treats a missing file as an empty document', async () => {
    expect(await readLockfile(join(dir, 'absent.json'))).toEqual(emptyLock())
  })

  it('fails on unreadable paths, invalid JSON, and invalid documents', async () => {
    await expect(readLockfile(dir)).rejects.toThrow(/cannot read/)
    await writeFile(join(dir, 'bad.json'), '{')
    await expect(readLockfile(join(dir, 'bad.json'))).rejects.toThrow(/is not JSON/)
    await writeFile(join(dir, 'v2.json'), '{"version":2}')
    await expect(readLockfile(join(dir, 'v2.json'))).rejects.toThrow(LockfileError)
    await expect(readLockfile(join(dir, 'v2.json'))).rejects.toThrow(/v2\.json is invalid: lockfile\.version must be 1\. The file was not changed/)
  })

  it('fails closed on an empty file, a truncated file, and a parent that is a file; none reads as empty', async () => {
    const full = JSON.stringify(document({ s: SERVER }), null, 2)
    await writeFile(join(dir, 'empty.json'), '')
    await writeFile(join(dir, 'cut.json'), full.slice(0, full.length - 9))
    await writeFile(join(dir, 'file'), 'x')
    for (const name of ['empty.json', 'cut.json', 'file/lock.json']) {
      await expect(readLockfile(join(dir, name))).rejects.toThrow(LockfileError)
    }
  })

  it('reads a file saved by a Windows editor: byte order mark and CRLF line ends', async () => {
    const path = join(dir, 'crlf.json')
    const text = JSON.stringify({ version: 1, canonicalization: CANONICALIZATION, servers: { s: SERVER } }, null, 2)
    await writeFile(path, `﻿${text.replaceAll('\n', '\r\n')}\r\n`)
    expect((await readLockfile(path)).servers['s']).toEqual(SERVER)
  })
})

describe('updateLockfile', () => {
  it('creates the parent directory, writes owner-only pretty JSON, and returns the committed document', async () => {
    const path = join(dir, 'nested', 'mcp-lock.json')
    const committed = await updateLockfile(path, (doc) => { doc.servers['browser'] = SERVER }, 2000)
    expect(committed.servers['browser']).toEqual(SERVER)
    const text = await readFile(path, 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "version": 1,')
    expect(await readLockfile(path)).toEqual(committed)
    expect(await readdir(join(dir, 'nested'))).toEqual(['mcp-lock.json'])
  })

  it.skipIf(process.platform === 'win32')('creates the file owner-only and the directory owner-only', async () => {
    const path = join(dir, 'nested', 'mcp-lock.json')
    await updateLockfile(path, () => {}, 2000)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700)
  })

  it('applies concurrent updates one after another', async () => {
    const path = join(dir, 'mcp-lock.json')
    await Promise.all(['a', 'b', 'c'].map(name => updateLockfile(path, (doc) => { doc.servers[name] = SERVER }, 5000)))
    expect(Object.keys((await readLockfile(path)).servers).sort()).toEqual(['a', 'b', 'c'])
  })

  it('serializes writers that start in separate processes', async () => {
    const path = join(dir, 'mcp-lock.json')
    const writer = join(dir, 'writer.mjs')
    await writeFile(writer, [
      'import { updateLockfile } from ' + JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'src', 'lockfile.ts')).href),
      'const [path, name] = process.argv.slice(2)',
      'await updateLockfile(path, (doc) => { doc.servers[name] = JSON.parse(process.env.AIR_TEST_SERVER) }, 10000)',
    ].join('\n'))
    const spawnWriter = (name: string): Promise<number | null> => new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx/esm', writer, path, name], {
        env: { ...process.env, AIR_TEST_SERVER: JSON.stringify(SERVER) },
        stdio: 'ignore',
      })
      child.on('exit', resolve)
    })
    expect(await Promise.all(['p', 'q', 'r'].map(spawnWriter))).toEqual([0, 0, 0])
    expect(Object.keys((await readLockfile(path)).servers).sort()).toEqual(['p', 'q', 'r'])
  })

  it('refuses to overwrite a lockfile it cannot parse', async () => {
    const path = join(dir, 'mcp-lock.json')
    await writeFile(path, '{"version":2}')
    await expect(updateLockfile(path, () => {}, 2000)).rejects.toThrow(LockfileError)
    expect(await readFile(path, 'utf8')).toBe('{"version":2}')
  })

  it('leaves the file unchanged when the mutation throws', async () => {
    const path = join(dir, 'mcp-lock.json')
    await updateLockfile(path, (doc) => { doc.servers['keep'] = SERVER }, 2000)
    const before = await readFile(path, 'utf8')
    await expect(updateLockfile(path, (doc) => {
      doc.servers['lost'] = SERVER
      throw new Error('stop')
    }, 2000)).rejects.toThrow('stop')
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(await readdir(dir)).toEqual(['mcp-lock.json'])
  })

  it.skipIf(process.platform === 'win32')('replaces a symbolic link at the lockfile path without writing through it', async () => {
    const target = join(dir, 'target.json')
    await updateLockfile(target, (doc) => { doc.servers['old'] = SERVER }, 2000)
    const before = await readFile(target, 'utf8')
    const path = join(dir, 'mcp-lock.json')
    await symlink(target, path)
    await updateLockfile(path, (doc) => { doc.servers['s'] = SERVER }, 2000)
    expect(await readFile(target, 'utf8')).toBe(before)
    expect((await lstat(path)).isSymbolicLink()).toBe(false)
    expect(Object.keys((await readLockfile(path)).servers).sort()).toEqual(['old', 's'])
  })
})

/** Resolves on the next change event for `name` seen by an independent watcher. */
function sawEvent(name: string): { done: Promise<void>; stop: () => void } {
  let stop = (): void => {}
  const done = new Promise<void>((resolve) => {
    const raw = watch(dir, (_event, changed) => {
      if (changed === name) resolve()
    })
    stop = () => { raw.close() }
  })
  return { done, stop }
}

/** Lets already queued watcher callbacks run. */
async function flushEvents(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await new Promise<void>((resolve) => { setImmediate(resolve) })
}

/** Waits until the watcher under test has armed its debounce timer. */
async function armed(): Promise<void> {
  for (let turn = 0; turn < 2000 && vi.getTimerCount() === 0; turn++) {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
  expect(vi.getTimerCount()).toBeGreaterThan(0)
}

describe('watchLockfile', () => {
  it('debounces replacements of the named file and ignores siblings', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const path = join(dir, 'mcp-lock.json')
    const onChange = vi.fn()
    const close = watchLockfile(path, onChange, 30, () => {})
    const sibling = sawEvent('mcp-lock.json.lock')
    try {
      await writeFile(join(dir, 'mcp-lock.json.lock'), '1\n')
      await sibling.done
      await flushEvents()
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(onChange).not.toHaveBeenCalled()

      await mkdir(join(dir, 'stage'))
      await writeFile(join(dir, 'stage', 'next.json'), '{}')
      await rename(join(dir, 'stage', 'next.json'), path)
      await writeFile(path, '{} ')
      await armed()
      await flushEvents()
      expect(onChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      sibling.stop()
      close()
    }
    await writeFile(path, '{}  ')
    await flushEvents()
    vi.advanceTimersByTime(1000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending notification when closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const path = join(dir, 'mcp-lock.json')
    const onChange = vi.fn()
    const close = watchLockfile(path, onChange, 200, () => {})
    await writeFile(path, '{}')
    await armed()
    close()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('throws when the directory does not exist', () => {
    expect(() => watchLockfile(join(dir, 'missing', 'mcp-lock.json'), () => {}, 10, () => {})).toThrow()
  })
})
