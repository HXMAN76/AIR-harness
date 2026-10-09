import { win32 } from 'node:path'
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

  it('ignores segments above the root and still tests the file name and segments inside it', () => {
    expect(isSensitivePath('/home/u/.docker/work/notes.md')).toBe(true)
    expect(isSensitivePath('/home/u/.docker/work/notes.md', '/home/u/.docker/work')).toBe(false)
    expect(isSensitivePath('/home/u/.docker/work/.env', '/home/u/.docker/work')).toBe(true)
    expect(isSensitivePath('/home/u/.docker/work/.ssh/id', '/home/u/.docker/work')).toBe(true)
    expect(isSensitivePath('/home/u/.docker/work/.git/config', '/home/u/.docker/work')).toBe(true)
    expect(isSensitivePath('C:\\u\\.aws\\p\\a.md', 'C:\\u\\.aws\\p', win32)).toBe(false)
  })

  it('tests only the file name of a path outside the root', () => {
    expect(isSensitivePath('/home/u/.ssh/notes.md', '/srv/project')).toBe(false)
    expect(isSensitivePath('/home/u/.ssh/.env', '/srv/project')).toBe(true)
  })
})
