import { describe, expect, it } from 'vitest'
import { nodeExec, runPowerShell, startTarget, type ExecLike } from '../src/exec.ts'

interface Call { file: string; args: string[]; env: Record<string, string> }

function recorder(): { calls: Call[]; exec: ExecLike } {
  const calls: Call[] = []
  return { calls, exec: async (file, args, env) => void calls.push({ file, args, env }) }
}

describe('nodeExec', () => {
  it('resolves when the process exits with code 0 and passes the extra environment', async () => {
    await expect(nodeExec(process.execPath, ['-e', 'process.exit(process.env.AIR_TEST_FLAG === "yes" ? 0 : 3)'], { AIR_TEST_FLAG: 'yes' })).resolves.toBeUndefined()
  })

  it('rejects with an Error naming the file when the process fails', async () => {
    await expect(nodeExec(process.execPath, ['-e', 'process.exit(3)'], {})).rejects.toThrow(/failed/)
  })
})

describe('runPowerShell', () => {
  it('passes the script as one argument and the target in the environment', async () => {
    const { calls, exec } = recorder()
    await runPowerShell(exec, 'Get-Date')
    await runPowerShell(exec, 'Start-Process -FilePath $env:AIR_OP_TARGET', 'notepad.exe')
    expect(calls).toEqual([
      { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date'], env: {} },
      {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:AIR_OP_TARGET'],
        env: { AIR_OP_TARGET: 'notepad.exe' },
      },
    ])
  })
})

describe('startTarget', () => {
  it('starts an allowed target', async () => {
    const { calls, exec } = recorder()
    await startTarget(exec, 'https://github.com')
    expect(calls[0]?.env).toEqual({ AIR_OP_TARGET: 'https://github.com' })
  })

  it('refuses anything else without running', async () => {
    const { calls, exec } = recorder()
    await expect(startTarget(exec, 'powershell.exe')).rejects.toThrow('not allowed')
    expect(calls).toEqual([])
  })
})
