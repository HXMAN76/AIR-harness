import { describe, expect, it, vi } from 'vitest'
import { WebUi, buildOpenUrl, parseWebUrl, redactUrl, type EnvSpawn } from '../src/core/web-ui.ts'
import { FakeChild } from './fake-child.ts'

describe('parseWebUrl', () => {
  it('reads the URL of a "dsh web:" line', () => {
    expect(parseWebUrl('dsh web: http://127.0.0.1:59385/?token=abc\r')).toBe('http://127.0.0.1:59385/?token=abc')
    expect(parseWebUrl('dsh web: https://example.test/ui/?token=abc')).toBe('https://example.test/ui/?token=abc')
  })

  it('ignores every other line', () => {
    expect(parseWebUrl('dsh web: opening the default browser')).toBeUndefined()
    expect(parseWebUrl('dsh web: ftp://x/')).toBeUndefined()
    expect(parseWebUrl('dsh web: http://[bad')).toBeUndefined()
    expect(parseWebUrl('noise http://127.0.0.1:1/')).toBeUndefined()
    expect(parseWebUrl('')).toBeUndefined()
  })
})

describe('redactUrl and buildOpenUrl', () => {
  it('hides the token value', () => {
    expect(redactUrl('http://127.0.0.1:5/?token=secret&x=1')).toBe('http://127.0.0.1:5/?token=***&x=1')
    expect(redactUrl('http://127.0.0.1:5/')).toBe('http://127.0.0.1:5/')
    expect(redactUrl('not a url')).toBe('(unparsable url)')
  })

  it('opens the root URL: the Web UI has no session route', () => {
    expect(buildOpenUrl('http://127.0.0.1:5/?token=t')).toBe('http://127.0.0.1:5/?token=t')
  })
})

interface Spawned {
  command: string
  args: readonly string[]
  env: Record<string, string | undefined>
  child: FakeChild
}

function rig(options: { profileExists?: boolean; startTimeoutMs?: number } = {}) {
  const spawned: Spawned[] = []
  const opened: string[] = []
  const debug: string[] = []
  const spawnFn: EnvSpawn = (command, args, env) => {
    const child = new FakeChild()
    spawned.push({ command, args, env, child })
    return child
  }
  const ui = new WebUi({
    dshBin: 'C:/repo/apps/cli/lib/bin.js',
    home: 'C:/home',
    node: 'electron.exe',
    spawnFn,
    openExternal: (url) => { opened.push(url); return Promise.resolve() },
    env: { PATH: 'p', KEEP: 'yes' },
    exists: () => options.profileExists ?? true,
    debug: message => debug.push(message),
    ...options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs },
  })
  return { ui, spawned, opened, debug }
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('WebUi', () => {
  it('starts the web profile on the voice home once, reuses it, opens the printed URL, and never logs the token', async () => {
    const { ui, spawned, opened, debug } = rig()
    const first = ui.open()
    await flush()
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({
      command: 'electron.exe',
      args: ['C:/repo/apps/cli/lib/bin.js', '--profile', 'web', '--no-open', '--port', '0'],
      env: { PATH: 'p', KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1', DSH_HOME: 'C:/home' },
    })
    spawned[0]!.child.out('dsh web: opening the default browser\ndsh web: http://127.0.0.1:4000/?token=SECRET\n')
    await first
    await ui.open()
    expect(spawned).toHaveLength(1)
    expect(opened).toEqual(['http://127.0.0.1:4000/?token=SECRET', 'http://127.0.0.1:4000/?token=SECRET'])
    expect(debug).toEqual(['web ui at http://127.0.0.1:4000/?token=***'])
    expect(debug.join()).not.toContain('SECRET')
  })

  it('creates the web profile first when it is absent, and not otherwise', async () => {
    const { ui, spawned } = rig({ profileExists: false })
    const opening = ui.open()
    await flush()
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.args).toEqual(['C:/repo/apps/cli/lib/bin.js', '--profile', 'web', '--from-default-profile', 'web', '--dump-config'])
    spawned[0]!.child.out('profile dump')
    spawned[0]!.child.exit(0)
    await flush()
    expect(spawned).toHaveLength(2)
    spawned[1]!.child.out('dsh web: http://127.0.0.1:4001/?token=t\n')
    await opening
  })

  it('fails when the profile cannot be created', async () => {
    const exit = rig({ profileExists: false })
    const a = exit.ui.open()
    await flush()
    exit.spawned[0]!.child.exit(1)
    await expect(a).rejects.toThrow('could not create the web profile')
    const error = rig({ profileExists: false })
    const b = error.ui.open()
    await flush()
    error.spawned[0]!.child.emit('error', new Error('spawn failed'))
    await expect(b).rejects.toThrow('could not create the web profile')
  })

  it('fails and can retry when the server exits before printing a URL', async () => {
    const { ui, spawned } = rig()
    const first = ui.open()
    await flush()
    spawned[0]!.child.exit(1)
    await expect(first).rejects.toThrow('the web server stopped')
    const second = ui.open()
    await flush()
    expect(spawned).toHaveLength(2)
    spawned[1]!.child.out('dsh web: http://127.0.0.1:4002/?token=t\n')
    await second
  })

  it('starts again after the server exited later', async () => {
    const { ui, spawned } = rig()
    const first = ui.open()
    await flush()
    spawned[0]!.child.out('dsh web: http://127.0.0.1:4003/?token=t\n')
    await first
    spawned[0]!.child.exit(0)
    const second = ui.open()
    await flush()
    expect(spawned).toHaveLength(2)
    spawned[1]!.child.out('dsh web: http://127.0.0.1:4004/?token=t\n')
    await second
  })

  it('gives up when no URL is printed in time', async () => {
    vi.useFakeTimers()
    try {
      const { ui, spawned } = rig({ startTimeoutMs: 500 })
      const opening = ui.open()
      const failure = expect(opening).rejects.toThrow('did not start in time')
      await vi.advanceTimersByTimeAsync(600)
      await failure
      expect(spawned[0]!.child.killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a 30 s start timeout by default', async () => {
    vi.useFakeTimers()
    try {
      const { ui } = rig()
      const opening = ui.open()
      const failure = expect(opening).rejects.toThrow('did not start in time')
      await vi.advanceTimersByTimeAsync(29_000)
      await vi.advanceTimersByTimeAsync(2_000)
      await failure
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the server and starts a new one on the next open; stop with nothing running is a no-op', async () => {
    const { ui, spawned } = rig()
    ui.stop()
    const first = ui.open()
    await flush()
    spawned[0]!.child.out('dsh web: http://127.0.0.1:4005/?token=t\n')
    await first
    ui.stop()
    expect(spawned[0]!.child.killed).toBe(true)
    const second = ui.open()
    await flush()
    expect(spawned).toHaveLength(2)
    spawned[1]!.child.out('dsh web: http://127.0.0.1:4006/?token=t\n')
    await second
  })

  it('reads the process environment and the real filesystem by default', async () => {
    const spawned: Spawned[] = []
    const ui = new WebUi({
      dshBin: 'bin.js',
      home: 'Z:/definitely/not/a/home',
      node: 'node',
      spawnFn: (command, args, env) => {
        const child = new FakeChild()
        spawned.push({ command, args, env, child })
        return child
      },
      openExternal: () => Promise.resolve(),
    })
    const opening = ui.open()
    await flush()
    expect(spawned[0]!.args).toContain('--from-default-profile')
    expect(spawned[0]!.env['DSH_HOME']).toBe('Z:/definitely/not/a/home')
    spawned[0]!.child.exit(0)
    await flush()
    spawned[1]!.child.out('dsh web: http://127.0.0.1:4007/?token=t\n')
    await opening
  })
})
