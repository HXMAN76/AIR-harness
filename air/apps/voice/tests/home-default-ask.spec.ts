import { execFileSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { describe, expect, it } from 'vitest'
import { documentsDir } from '../src/core/home.ts'

describe('documentsDir without options', () => {
  it('probes PowerShell on Windows and falls back elsewhere', () => {
    const found = documentsDir()
    expect(isAbsolute(found)).toBe(true)
    if (process.platform === 'win32') {
      const asked = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('MyDocuments')"],
        { encoding: 'utf8', timeout: 10_000, windowsHide: true },
      ).trim()
      expect(found).toBe(asked)
    } else {
      expect(found.endsWith('Documents')).toBe(true)
    }
  })
})
