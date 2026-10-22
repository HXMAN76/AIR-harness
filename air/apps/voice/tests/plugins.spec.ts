import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecLike } from '@air/dsh-tool-open/exec'
import { installVoicePlugins, VOICE_PLUGINS } from '../src/core/plugins.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function home(manifest?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'voice-plugins-'))
  dirs.push(dir)
  if (manifest !== undefined) {
    mkdirSync(join(dir, 'profiles', 'sdk'), { recursive: true })
    writeFileSync(join(dir, 'profiles', 'sdk', 'package.json'), manifest)
  }
  return dir
}

interface Call { file: string; args: string[]; env: Record<string, string>; timeoutMs: number | undefined }

function recorder(failOn?: string): { calls: Call[]; exec: ExecLike } {
  const calls: Call[] = []
  return {
    calls,
    exec: async (file, args, env, timeoutMs) => {
      calls.push({ file, args, env, timeoutMs })
      if (failOn !== undefined && args.at(-1)?.endsWith(failOn) === true) throw new Error('boom')
    },
  }
}

const ONE = { name: '@air/dsh-tool-open', dir: 'air/packages/tool-open' }

describe('installVoicePlugins', () => {
  it('adds every package by absolute path with DSH_HOME set and no shell', async () => {
    const dir = home()
    const { calls, exec } = recorder()
    const result = await installVoicePlugins({ home: dir, repoRoot: 'R', exec })
    expect(result.skipped).toEqual([])
    expect(result.installed).toEqual(VOICE_PLUGINS.map(plugin => plugin.name))
    expect(calls).toHaveLength(8)
    expect(calls[0]).toEqual({
      file: process.execPath,
      args: [join('R', 'apps', 'cli', 'lib', 'bin.js'), 'plugin', '--profile', 'sdk', 'add', join('R', 'air', 'packages', 'tool-open')],
      env: { DSH_HOME: dir },
      timeoutMs: 300_000,
    })
  })

  it('names the memory, tool, and MCP client packages the patches load', () => {
    expect(VOICE_PLUGINS.map(plugin => plugin.name)).toEqual([
      '@air/dsh-tool-open', '@air/dsh-memory-store', '@air/dsh-memory-index', '@air/dsh-tool-memory', '@air/dsh-memory-context',
      '@air/dsh-send-guard', '@air/dsh-voice-approval', '@deepseek-ai/dsh-mcp-client',
    ])
  })

  it('skips packages already in the profile manifest', async () => {
    const dir = home(JSON.stringify({ dependencies: { '@air/dsh-tool-open': 'link:x', '@air/dsh-memory-store': 'link:y' } }))
    const { calls, exec } = recorder()
    const result = await installVoicePlugins({ home: dir, repoRoot: 'R', exec })
    expect(result.skipped).toEqual(['@air/dsh-tool-open', '@air/dsh-memory-store'])
    expect(calls).toHaveLength(6)
  })

  it('treats a manifest without dependencies as empty, and installs nothing when all are present', async () => {
    expect((await installVoicePlugins({ home: home('{}'), repoRoot: 'R', exec: recorder().exec, plugins: [ONE] })).installed).toEqual([ONE.name])
    const full = home(JSON.stringify({ dependencies: { [ONE.name]: 'link:x' } }))
    expect(await installVoicePlugins({ home: full, repoRoot: 'R', exec: recorder().exec, plugins: [ONE] })).toEqual({ installed: [], skipped: [ONE.name] })
  })

  it('stops at the first failure', async () => {
    const { calls, exec } = recorder('memory-store')
    await expect(installVoicePlugins({ home: home(), repoRoot: 'R', exec })).rejects.toThrow('boom')
    expect(calls).toHaveLength(2)
  })
})
