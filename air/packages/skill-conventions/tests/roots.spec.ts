import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skillRoots } from '../src/roots.ts'

const base = (...segments: string[]): string => resolve(sep, ...segments)
const homes = { airHome: base('h', '.air'), claudeHome: base('h', '.claude'), agentsHome: base('h', '.agents') }

describe('skillRoots', () => {
  it('lists project roots and the AIR home, without user roots by default', () => {
    const projectRoot = base('p')
    expect(skillRoots({ projectRoot, homes, includeUserRoots: false, extraProjectRoots: ['.opencode/skills'] })).toEqual([
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 },
      { path: join(projectRoot, '.claude', 'skills'), source: 'project-claude', rank: 220 },
      { path: join(projectRoot, '.opencode', 'skills'), source: 'project-extra', rank: 240 },
      { path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350 },
    ])
  })

  it('adds the user roots only on request and omits project roots without a project', () => {
    expect(skillRoots({ projectRoot: undefined, homes, includeUserRoots: true, extraProjectRoots: ['x'] })).toEqual([
      { path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350 },
      { path: join(homes.agentsHome, 'skills'), source: 'user-agents', rank: 500 },
      { path: join(homes.claudeHome, 'skills'), source: 'user-claude', rank: 520 },
    ])
  })
})
