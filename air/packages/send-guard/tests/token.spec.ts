import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { consumeSendToken, issueSendToken } from '../src/token.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'air-send-'))
  dirs.push(dir)
  return dir
}

describe('send tokens', () => {
  it('issues a 16 hex token with a file, creating the directory', () => {
    const dir = join(tmp(), 'nested')
    const token = issueSendToken(dir)
    expect(token).toMatch(/^\[AIR-SEND-[0-9a-f]{16}\]$/)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(existsSync(join(dir, token.slice(10, 26)))).toBe(true)
  })

  it('issues a different token each time', () => {
    const dir = tmp()
    expect(issueSendToken(dir)).not.toBe(issueSendToken(dir))
  })

  it('consumes a live token once', () => {
    const dir = tmp()
    const token = issueSendToken(dir, () => Buffer.from('0123456789abcdef', 'hex'))
    expect(token).toBe('[AIR-SEND-0123456789abcdef]')
    expect(consumeSendToken(dir, `Now press Send ${token}`)).toBe(true)
    expect(consumeSendToken(dir, `Now press Send ${token}`)).toBe(false)
  })

  it('rejects text without a token, a malformed one, and one that was never issued', () => {
    const dir = tmp()
    expect(consumeSendToken(dir, 'press Send')).toBe(false)
    expect(consumeSendToken(dir, '[AIR-SEND-0123]')).toBe(false)
    expect(consumeSendToken(dir, '[AIR-SEND-ffffffffffffffff]')).toBe(false)
  })

  it('finds the live token when an unknown one comes first', () => {
    const dir = tmp()
    const live = issueSendToken(dir)
    expect(consumeSendToken(dir, `[AIR-SEND-ffffffffffffffff] ${live}`)).toBe(true)
  })
})
