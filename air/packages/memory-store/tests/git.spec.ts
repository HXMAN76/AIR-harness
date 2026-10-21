import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { runGit } from '../src/git.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'air-memory-git-'))
  const ctx = new Context()
  cleanups.push(() => rm(cwd, { recursive: true, force: true }), () => ctx.fiber.dispose())
  await ctx.plugin(LocalSubprocessRuntime)
  return { cwd, subprocess: ctx.subprocess }
}

const signal = new AbortController().signal

describe('runGit', () => {
  it('returns stdout of a successful command', async () => {
    const { cwd, subprocess } = await setup()
    expect(await runGit(subprocess, 'git', ['--version'], { cwd, timeoutMs: 30_000, signal })).toContain('git version')
  })

  it('throws the stderr of a failed command', async () => {
    const { cwd, subprocess } = await setup()
    await expect(runGit(subprocess, 'git', ['rev-parse', 'HEAD'], { cwd, timeoutMs: 30_000, signal }))
      .rejects.toThrow('git rev-parse HEAD failed:')
  })

  it('reports timeouts and aborts', async () => {
    const { cwd, subprocess } = await setup()
    await expect(runGit(subprocess, 'git', ['--version'], { cwd, timeoutMs: 1, signal })).rejects.toThrow('timed out after 1ms')
    const aborted = new AbortController()
    setTimeout(() => { aborted.abort() }, 0)
    await expect(runGit(subprocess, 'git', ['--version'], { cwd, timeoutMs: 30_000, signal: aborted.signal }))
      .rejects.toThrow('git --version was aborted')
  })
})
