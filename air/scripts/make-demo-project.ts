/** Create a scratch project with a skill, a command, instructions, a rule, and a .mcp.json server (Windows and Linux). */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const demo = join(mkdtempSync(join(tmpdir(), 'air-demo-')), 'air-demo')

function put(relativePath: string, text: string): void {
  const target = join(demo, relativePath)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, text)
}

mkdirSync(demo, { recursive: true })
const init = spawnSync('git', ['init', '-q', demo], { encoding: 'utf8' })
if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
put('.claude/skills/hello/SKILL.md', '---\ndescription: Greet the user by name\n---\nSay hello to the person named in the request.\n')
put('.claude/commands/issue.md', 'Summarise issue $ARGUMENTS in one sentence.\n')
put('.claude/CLAUDE.md', 'Project memory: answer in British English. @notes.md\n')
put('.claude/notes.md', 'Imported note: the project is called Demo.\n')
put('.claude/rules/ts.md', '---\npaths: "**/*.ts"\n---\nTypeScript files use strict mode.\n')
put('.mcp.json', JSON.stringify({
  mcpServers: { demo: { command: process.execPath, args: [join(repoRoot, 'air', 'packages', 'mcp-conventions', 'tests', 'fixtures', 'echo-server.mjs')] } },
}, undefined, 2))
console.log(demo)
