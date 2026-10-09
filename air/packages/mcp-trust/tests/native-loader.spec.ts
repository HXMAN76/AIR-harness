/** Built-package smoke: every row, including `@air/dsh-mcp-trust`, resolves through Node from the package directory. */
import { afterEach, expect, it } from 'vitest'
import { updateLockfile } from '../src/lockfile.ts'
import { pinSurface } from '../src/verdict.ts'
import { boot, PUBLIC, type Booted } from './support/boot.ts'

const ECHO = { name: 'echo', description: 'Echo the input.', inputSchema: { type: 'object' } }

let booted: Booted | undefined

afterEach(async () => {
  await booted?.dispose()
  booted = undefined
})

it('loads the built trust plugin by package name and registers a pinned surface', async () => {
  booted = await boot({
    surface: { tools: [ECHO] },
    rows: async (paths) => {
      await updateLockfile(paths.lockPath, (doc) => {
        doc.servers['mutable'] = pinSurface([ECHO], '', 'cli', '2026-09-30T00:00:00.000Z')
      }, 2000)
      return [{
        id: 'air-mcp-trust',
        name: '@air/dsh-mcp-trust',
        config: {
          lockfile: paths.lockPath,
          auditDir: paths.auditDir,
          defaults: { mode: 'enforce', onAdded: 'withhold', onChanged: 'reject-generation', onRemoved: 'accept', instructions: 'pin' },
          denyUnreviewedMcpTools: true,
          maxPromptsPerServer: 1,
          minReverifyMs: 1000,
          maxReverifyMs: 60000,
          lockWaitMs: 2000,
          watchDebounceMs: 50,
          cliCommand: 'pnpm dsh --profile air-mcp',
          enrollOnApproval: false,
        },
      }]
    },
  })
  expect(booted.ctx.tools.get(PUBLIC('echo'))).toBeDefined()
})
