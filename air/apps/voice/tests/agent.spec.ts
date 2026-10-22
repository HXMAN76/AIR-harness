import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentBridge, defaultDshBin, ROUTES, type HarnessLike, type HarnessOptions } from '../src/core/agent.ts'
import { REPO_ROOT, VOICE_APP_ROOT } from '../src/core/paths.ts'
import type { AgentProgress } from '../src/core/progress.ts'

interface FakeHarness extends HarnessLike {
  options: HarnessOptions
  closed: boolean
  runs: { sessionId: string; text: string }[]
}

const homes: string[] = []
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempHome(envFile?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'voice-home-'))
  homes.push(home)
  if (envFile !== undefined) writeFileSync(join(home, '.env'), envFile)
  return home
}

function setup(options: {
  env?: Record<string, string | undefined>
  envFile?: string
  reply?: () => Promise<string>
  extraEvents?: Array<{ type: string; data?: unknown }>
} = {}): {
  bridge: AgentBridge
  harnesses: FakeHarness[]
  home: string
} {
  const harnesses: FakeHarness[] = []
  let sessions = 0
  const home = tempHome(options.envFile)
  const bridge = new AgentBridge({
    dshHome: home,
    cwd: 'C:/Users/u/Documents/AIR Voice',
    dshBin: 'C:/repo/apps/cli/lib/bin.js',
    profileDir: 'C:/voice/profile',
    env: options.env ?? {},
    clock: (() => { let t = 0; return () => (t += 3) })() ,
    harnessFactory: (harnessOptions) => {
      const harness: FakeHarness = {
        options: harnessOptions,
        closed: false,
        runs: [],
        session: (id) => {
          const sessionId = id ?? `session-${++sessions}`
          return {
            id: sessionId,
            run: async (text, runOptions) => {
              harness.runs.push({ sessionId, text })
              const finalResponse = options.reply === undefined ? `reply to ${text}` : await options.reply()
              const events = [
                { type: 'turn/start', data: {} },
                { type: 'tool/call', data: { name: 'pwsh', callId: 'a', arguments: { command: 'secret command text' } } },
                { type: 'tool/result', data: {} },
                { type: 'tool/call', data: { name: 'web_fetch', callId: 'b', arguments: '{}' } },
                { type: 'tool/call', data: { callId: 'c' } },
                { type: 'assistant/message', data: { usage: { inputTokens: 1000, outputTokens: 20 } } },
                { type: 'assistant/message', data: { usage: { inputTokens: 1100, outputTokens: 30 } } },
                { type: 'assistant/message', data: { usage: { inputTokens: 'x' } } },
                { type: 'assistant/message', data: {} },
                ...options.extraEvents ?? [],
              ]
              if (runOptions?.onNotification !== undefined) {
                runOptions.onNotification({ method: 'session.status', params: { status: 'busy' } })
                runOptions.onNotification({ method: 'session.event', params: {} })
                for (const event of events) runOptions.onNotification({ method: 'session.event', params: { sessionId, event } })
              }
              return { finalResponse, events }
            },
          }
        },
        close: async () => {
          harness.closed = true
        },
      }
      harnesses.push(harness)
      return harness
    },
  })
  return { bridge, harnesses, home }
}

describe('AgentBridge', () => {
  it('maps routes to local Ollama and Ollama Cloud models', () => {
    expect(ROUTES).toEqual({
      local: { provider: 'ollama', model: 'qwen3-8b-32k', patches: ['voice.cordis.patch.yml'], cloud: false },
      cloud: { provider: 'ollama-cloud', model: 'minimax-m3.1-flash', patches: ['voice.cordis.patch.yml', 'browser.cordis.patch.yml'], cloud: true },
      screen: { provider: 'ollama-cloud', model: 'minimax-m3.1-flash', patches: ['voice.cordis.patch.yml', 'browser.cordis.patch.yml', 'screen.cordis.patch.yml'], cloud: true },
    })
  })

  it('reports a tool denied for want of a spoken approval, with what it wanted', async () => {
    const args = { command: 'Remove-Item C:/old', sandbox_permissions: 'danger-full-access', justification: 'Clean up.' }
    const { bridge } = setup({
      extraEvents: [
        { type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'x', name: 'pwsh', arguments: JSON.stringify(args) }] } } },
        { type: 'tool/result', data: { error: { message: 'Needs voice approval: run Remove-Item C:/old (Clean up.).' } } },
      ],
    })
    const result = await bridge.ask('clean up')
    expect(result.approval).toMatchObject({ summary: 'run Remove-Item C:/old (Clean up.)' })
    expect(result.approval?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports an approval request the profile rejected', async () => {
    const { bridge } = setup({
      extraEvents: [
        { type: 'approval/asked', data: { id: 'a1', toolName: 'plugin_manager', reason: 'Install the weather bundle' } },
        { type: 'approval/decided', data: { id: 'a1', outcome: 'rejected' } },
      ],
    })
    expect((await bridge.ask('install weather')).refused).toBe('Install the weather bundle')
  })

  it('starts on the local route and launches the SDK runtime lazily', async () => {
    const { bridge, harnesses, home } = setup()
    expect(bridge.route).toBe('local')
    expect(harnesses).toHaveLength(0)
    const progress: AgentProgress[] = []
    const result = await bridge.ask('what time is it', p => progress.push(p))
    expect(result).toEqual({ reply: 'reply to what time is it', tools: ['pwsh', 'web_fetch'], stats: { firstEventMs: 3, promptTokens: 2100, outputTokens: 50, steps: 4 } })
    expect(progress).toEqual([
      { kind: 'thinking' },
      { kind: 'tool', name: 'pwsh', args: { command: 'secret command text' } },
      { kind: 'tool', name: 'web_fetch' },
    ])
    expect(bridge.sessionId).toBe('session-1')
    expect(harnesses[0]!.options).toEqual({
      dshBin: 'C:/repo/apps/cli/lib/bin.js',
      profile: 'sdk',
      patches: [join('C:/voice/profile', 'voice.cordis.patch.yml')],
      dshHome: home,
      cwd: 'C:/Users/u/Documents/AIR Voice',
      provider: 'ollama',
      model: 'qwen3-8b-32k',
      initializeTimeoutMs: 300_000,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('keeps one session per route until a new conversation', async () => {
    const { bridge, harnesses } = setup()
    await bridge.ask('one')
    await bridge.ask('two')
    bridge.newConversation()
    await bridge.ask('three')
    expect(harnesses).toHaveLength(1)
    expect(harnesses[0]!.runs).toEqual([
      { sessionId: 'session-1', text: 'one' },
      { sessionId: 'session-1', text: 'two' },
      { sessionId: 'session-2', text: 'three' },
    ])
  })

  it('refuses a cloud route without the cloud key and stays local', () => {
    const { bridge } = setup({ env: { OLLAMA_CLOUD_KEY: '' } })
    expect(bridge.setRoute('cloud')).toEqual({ ok: false, reason: 'missing-key' })
    expect(bridge.setRoute('screen')).toEqual({ ok: false, reason: 'missing-key' })
    expect(bridge.route).toBe('local')
  })

  it('accepts the cloud route with the key in the environment and uses Ollama Cloud', async () => {
    const { bridge, harnesses } = setup({ env: { OLLAMA_CLOUD_KEY: 'test-value' } })
    expect(bridge.setRoute('cloud')).toEqual({ ok: true })
    expect(bridge.route).toBe('cloud')
    await bridge.ask('hello')
    expect(harnesses[0]!.options.provider).toBe('ollama-cloud')
    expect(harnesses[0]!.options.model).toBe('minimax-m3.1-flash')
  })

  it('passes the cloud key to cloud launches as OLLAMA_API_KEY and keeps the local launch free of it', async () => {
    const { bridge, harnesses } = setup({ env: { OLLAMA_CLOUD_KEY: 'test-value', PATH: 'p' } })
    await bridge.ask('a')
    bridge.setRoute('cloud')
    await bridge.ask('b')
    expect(harnesses[0]!.options.env).toEqual({ OLLAMA_CLOUD_KEY: 'test-value', PATH: 'p', ELECTRON_RUN_AS_NODE: '1' })
    expect(harnesses[1]!.options.env).toEqual({ OLLAMA_CLOUD_KEY: 'test-value', PATH: 'p', ELECTRON_RUN_AS_NODE: '1', OLLAMA_API_KEY: 'test-value' })
  })

  it('reads the cloud key from the process environment when no env is given and passes the full environment plus the injected key', async () => {
    const before = process.env.OLLAMA_CLOUD_KEY
    process.env.OLLAMA_CLOUD_KEY = 'test-value'
    try {
      const launches: HarnessOptions[] = []
      const bridge = new AgentBridge({
        dshHome: tempHome(),
        cwd: 'C:/ws',
        dshBin: 'bin.js',
        profileDir: 'C:/voice/profile',
        harnessFactory: (options) => {
          launches.push(options)
          return { session: () => ({ id: 's', run: async () => ({ finalResponse: 'ok', events: [] }) }), close: async () => {} }
        },
      })
      expect(bridge.setRoute('cloud')).toEqual({ ok: true })
      await bridge.ask('x')
      expect(launches[0]!.env).toMatchObject({ OLLAMA_API_KEY: 'test-value', OLLAMA_CLOUD_KEY: 'test-value', ELECTRON_RUN_AS_NODE: '1' })
      expect(launches[0]!.env?.PATH ?? launches[0]!.env?.Path).toBe(process.env.PATH ?? process.env.Path)
    } finally {
      if (before === undefined) delete process.env.OLLAMA_CLOUD_KEY
      else process.env.OLLAMA_CLOUD_KEY = before
    }
  })

  it('accepts the cloud route with the key in the voice home .env file', () => {
    const { bridge } = setup({ envFile: 'OLLAMA_API_KEY=ollama\n# OLLAMA_CLOUD_KEY=old\nOLLAMA_CLOUD_KEY = "x"\n' })
    expect(bridge.setRoute('screen')).toEqual({ ok: true })
  })

  it('treats an empty assignment in .env as missing', () => {
    const { bridge } = setup({ envFile: 'OLLAMA_CLOUD_KEY=\n' })
    expect(bridge.setRoute('cloud')).toEqual({ ok: false, reason: 'missing-key' })
  })

  it('always accepts the local route', () => {
    const { bridge } = setup()
    expect(bridge.setRoute('local')).toEqual({ ok: true })
  })

  it('adds the browser patch on the cloud route and both on the screen route, never on local', async () => {
    const { bridge, harnesses } = setup({ env: { OLLAMA_CLOUD_KEY: 'test-value' } })
    bridge.setRoute('cloud')
    await bridge.ask('a')
    bridge.setRoute('local')
    await bridge.ask('b')
    expect(harnesses[0]!.options.patches).toEqual([join('C:/voice/profile', 'voice.cordis.patch.yml'), join('C:/voice/profile', 'browser.cordis.patch.yml')])
    expect(harnesses[1]!.options.patches).toEqual([join('C:/voice/profile', 'voice.cordis.patch.yml')])
  })

  it('adds the screen patch on the screen route, one harness per route', async () => {
    const { bridge, harnesses } = setup({ env: { OLLAMA_CLOUD_KEY: 'test-value' } })
    await bridge.ask('a')
    bridge.setRoute('screen')
    await bridge.ask('b')
    bridge.setRoute('local')
    await bridge.ask('c')
    expect(harnesses).toHaveLength(2)
    expect(harnesses[1]!.options.patches).toEqual([join('C:/voice/profile', 'voice.cordis.patch.yml'), join('C:/voice/profile', 'browser.cordis.patch.yml'), join('C:/voice/profile', 'screen.cordis.patch.yml')])
    expect(harnesses[1]!.options.model).toBe('minimax-m3.1-flash')
    expect(harnesses[0]!.runs.map(run => run.sessionId)).toEqual(['session-1', 'session-1'])
  })

  it('cancel() closes the harnesses and the next ask starts a new one with a new session', async () => {
    const { bridge, harnesses } = setup()
    await bridge.ask('one')
    await bridge.cancel()
    expect(harnesses[0]!.closed).toBe(true)
    await bridge.ask('two')
    expect(harnesses).toHaveLength(2)
    expect(harnesses[1]!.runs).toEqual([{ sessionId: 'session-2', text: 'two' }])
  })

  it('records memory sharing, restarts the runtime, and adds the share patch only when the file exists', async () => {
    const { bridge, harnesses } = setup()
    expect(bridge.memoryShared).toBe(false)
    await bridge.ask('one')
    await bridge.setMemoryShare(true)
    expect(bridge.memoryShared).toBe(true)
    expect(harnesses[0]!.closed).toBe(true)
    await bridge.ask('two')
    expect(harnesses[1]!.options.patches).toEqual([join('C:/voice/profile', 'voice.cordis.patch.yml')])
  })

  it('adds memory-share.cordis.patch.yml when sharing is on and the file exists', async () => {
    const harnesses: HarnessOptions[] = []
    const profileDir = tempHome()
    writeFileSync(join(profileDir, 'memory-share.cordis.patch.yml'), '[]\n')
    const bridge = new AgentBridge({
      dshHome: tempHome(),
      cwd: 'C:/w',
      dshBin: 'C:/b.js',
      profileDir,
      env: {},
      harnessFactory: (options) => {
        harnesses.push(options)
        return { session: () => ({ id: 's', run: async () => ({ finalResponse: '', events: [] }) }), close: async () => undefined }
      },
    })
    await bridge.setMemoryShare(true)
    await bridge.ask('x')
    expect(harnesses[0]!.patches).toEqual([join(profileDir, 'voice.cordis.patch.yml'), join(profileDir, 'memory-share.cordis.patch.yml')])
  })

  it('dispose() closes every harness', async () => {
    const { bridge, harnesses } = setup()
    await bridge.ask('one')
    await bridge.dispose()
    expect(harnesses[0]!.closed).toBe(true)
  })

  it('resolves the dsh CLI from AIR_VOICE_DSH_BIN, else from the repository root', () => {
    expect(defaultDshBin({ AIR_VOICE_DSH_BIN: 'G:/main/apps/cli/lib/bin.js' })).toBe('G:/main/apps/cli/lib/bin.js')
    expect(defaultDshBin({ AIR_VOICE_DSH_BIN: '' })).toBe(join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js'))
    expect(defaultDshBin({})).toBe(join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js'))
  })

  it('without an env option, starts from the process environment with ELECTRON_RUN_AS_NODE set', async () => {
    const seen: HarnessOptions[] = []
    const bridge = new AgentBridge({
      dshHome: tempHome(),
      cwd: 'C:/w',
      harnessFactory: (options) => {
        seen.push(options)
        return { session: () => ({ id: 's', run: async () => ({ finalResponse: 'ok', events: [] }) }), close: async () => undefined }
      },
    })
    expect(typeof bridge.setRoute('cloud').ok).toBe('boolean')
    bridge.setRoute('local')
    await bridge.ask('x')
    expect(seen[0]!.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1' })
    expect(seen[0]!.env?.PATH ?? seen[0]!.env?.Path).toBe(process.env.PATH ?? process.env.Path)
    expect(seen[0]!.env).not.toHaveProperty('OLLAMA_API_KEY')
    expect(seen[0]!.dshBin).toBe(defaultDshBin())
    expect(seen[0]!.patches[0]).toBe(join(VOICE_APP_ROOT, 'profile', 'voice.cordis.patch.yml'))
  })

  it('has defaults for the runtime, profile directory, environment, and factory', () => {
    expect(() => new AgentBridge({ dshHome: tempHome(), cwd: 'C:/w' })).not.toThrow()
  })
})
