import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentBridge, defaultDshBin, ROUTES, type HarnessLike, type HarnessOptions } from '../src/core/agent.ts'
import { REPO_ROOT, VOICE_APP_ROOT } from '../src/core/paths.ts'

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

function setup(options: { env?: Record<string, string | undefined>; envFile?: string; reply?: () => Promise<string> } = {}): {
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
    harnessFactory: (harnessOptions) => {
      const harness: FakeHarness = {
        options: harnessOptions,
        closed: false,
        runs: [],
        session: (id) => {
          const sessionId = id ?? `session-${++sessions}`
          return {
            id: sessionId,
            run: async (text) => {
              harness.runs.push({ sessionId, text })
              const finalResponse = options.reply === undefined ? `reply to ${text}` : await options.reply()
              return {
                finalResponse,
                events: [
                  { type: 'turn/start', data: {} },
                  { type: 'tool/call', data: { name: 'pwsh', callId: 'a', arguments: '{}' } },
                  { type: 'tool/result', data: {} },
                  { type: 'tool/call', data: { name: 'web_fetch', callId: 'b', arguments: '{}' } },
                  { type: 'tool/call', data: { callId: 'c' } },
                  { type: 'assistant/message', data: {} },
                ],
              }
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
  it('maps routes to OpenRouter and Ollama models', () => {
    expect(ROUTES).toEqual({
      local: { provider: 'ollama', model: 'qwen3-8b-32k', patches: ['voice.cordis.patch.yml'], cloud: false },
      cloud: { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', patches: ['voice.cordis.patch.yml'], cloud: true },
      screen: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', patches: ['voice.cordis.patch.yml', 'screen.cordis.patch.yml'], cloud: true },
    })
  })

  it('starts on the local route and launches the SDK runtime lazily', async () => {
    const { bridge, harnesses, home } = setup()
    expect(bridge.route).toBe('local')
    expect(harnesses).toHaveLength(0)
    await expect(bridge.ask('what time is it')).resolves.toEqual({ reply: 'reply to what time is it', tools: ['pwsh', 'web_fetch'] })
    expect(harnesses[0]!.options).toEqual({
      dshBin: 'C:/repo/apps/cli/lib/bin.js',
      profile: 'sdk',
      patches: [join('C:/voice/profile', 'voice.cordis.patch.yml')],
      dshHome: home,
      cwd: 'C:/Users/u/Documents/AIR Voice',
      provider: 'ollama',
      model: 'qwen3-8b-32k',
      initializeTimeoutMs: 300_000,
      env: {},
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

  it('refuses a cloud route without the OpenRouter key and stays local', () => {
    const { bridge } = setup({ env: { OPENROUTER_API_KEY: '' } })
    expect(bridge.setRoute('cloud')).toEqual({ ok: false, reason: 'missing-key' })
    expect(bridge.setRoute('screen')).toEqual({ ok: false, reason: 'missing-key' })
    expect(bridge.route).toBe('local')
  })

  it('accepts the cloud route with the key in the environment and uses OpenRouter Haiku', async () => {
    const { bridge, harnesses } = setup({ env: { OPENROUTER_API_KEY: 'test-value' } })
    expect(bridge.setRoute('cloud')).toEqual({ ok: true })
    expect(bridge.route).toBe('cloud')
    await bridge.ask('hello')
    expect(harnesses[0]!.options.provider).toBe('openrouter')
    expect(harnesses[0]!.options.model).toBe('anthropic/claude-haiku-5.5')
  })

  it('accepts the cloud route with the key in the voice home .env file', () => {
    const { bridge } = setup({ envFile: 'OLLAMA_API_KEY=ollama\n# OPENROUTER_API_KEY=old\nOPENROUTER_API_KEY = "x"\n' })
    expect(bridge.setRoute('screen')).toEqual({ ok: true })
  })

  it('treats an empty assignment in .env as missing', () => {
    const { bridge } = setup({ envFile: 'OPENROUTER_API_KEY=\n' })
    expect(bridge.setRoute('cloud')).toEqual({ ok: false, reason: 'missing-key' })
  })

  it('always accepts the local route', () => {
    const { bridge } = setup()
    expect(bridge.setRoute('local')).toEqual({ ok: true })
  })

  it('adds the screen patch on the screen route, one harness per route', async () => {
    const { bridge, harnesses } = setup({ env: { OPENROUTER_API_KEY: 'test-value' } })
    await bridge.ask('a')
    bridge.setRoute('screen')
    await bridge.ask('b')
    bridge.setRoute('local')
    await bridge.ask('c')
    expect(harnesses).toHaveLength(2)
    expect(harnesses[1]!.options.patches).toEqual([join('C:/voice/profile', 'voice.cordis.patch.yml'), join('C:/voice/profile', 'screen.cordis.patch.yml')])
    expect(harnesses[1]!.options.model).toBe('anthropic/claude-sonnet-5.5')
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

  it('without an env option, checks the process environment and lets the runtime inherit it', async () => {
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
    expect('env' in seen[0]!).toBe(false)
    expect(seen[0]!.dshBin).toBe(defaultDshBin())
    expect(seen[0]!.patches[0]).toBe(join(VOICE_APP_ROOT, 'profile', 'voice.cordis.patch.yml'))
  })

  it('has defaults for the runtime, profile directory, environment, and factory', () => {
    expect(() => new AgentBridge({ dshHome: tempHome(), cwd: 'C:/w' })).not.toThrow()
  })
})
