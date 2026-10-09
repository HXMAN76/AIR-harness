import { describe, expect, it } from 'vitest'
import { isSensitivePath } from '../src/index.ts'

describe('isSensitivePath', () => {
  it.each([
    ['/home/u/project/.env', true],
    ['/home/u/project/.env.production', true],
    ['C:\\Users\\u\\.ssh\\config', true],
    ['/home/u/.aws/credentials', true],
    ['/home/u/project/id_ed25519', true],
    ['/home/u/project/server.pem', true],
    ['/home/u/project/.npmrc', true],
    ['/home/u/project/.git/config', true],
    ['/home/u/.git-credentials', true],
    ['/home/u/.pypirc', true],
    ['/home/u/.pgpass', true],
    ['/home/u/project/prod.tfvars', true],
    ['/home/u/project/.claude/settings.local.json', true],
    ['/home/u/.config/gh/hosts.yml', true],
    ['C:\\Users\\u\\.config\\gh\\hosts.yml', true],
    ['/home/u/project/.claude/settings.json', false],
    ['/home/u/project/.config/other/hosts.yml', false],
    ['/home/u/project/docs/config', false],
    ['/home/u/project/docs/environment.md', false],
    ['/home/u/project/notes.md', false],
  ])('classifies %s', (path, expected) => {
    expect(isSensitivePath(path)).toBe(expected)
  })
})
