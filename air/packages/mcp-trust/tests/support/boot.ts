/** Loader boot helper: real Loader, real mcp-client row, and the mutable stdio fixture. */
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

const packageDir = join(import.meta.dirname, '..', '..')
const fixture = join(packageDir, 'tests', 'fixtures', 'mutable-server.mjs')

/**
 * Replace a file by rename. On Windows the rename fails with EPERM or EBUSY
 * while the fixture's directory watcher or a reader still holds the target, so
 * a few short retries make the helper behave the same on both platforms.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= 10) throw error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
}

/** JSON document the fixture server serves. */
export interface Surface {
  tools: object[]
  instructions?: string
  ttlMs?: number
  pageSize?: number
  notify?: boolean
  restart?: boolean
  epoch?: number
}

/** Inputs for one booted tree. */
export interface BootOptions {
  /** Initial fixture surface. */
  surface: Surface
  /** Builds extra Loader rows placed before the mcp-client row; runs before boot. */
  rows?: (paths: BootPaths) => Promise<object[]>
  /** Whether the mcp-client row declares `inject: [mcpToolReview]` (default true). */
  reviewed?: boolean
}

/** Scratch paths of one booted tree. */
export interface BootPaths {
  /** Scratch directory inside the package; removed on dispose. */
  root: string
  /** Lockfile path for the trust row (not created). */
  lockPath: string
  /** Audit directory for the trust row (not created). */
  auditDir: string
}

/** One booted tree and its scratch paths. */
export interface Booted extends BootPaths {
  ctx: Context
  writeSurface: (surface: Surface) => Promise<void>
  dispose(): Promise<void>
}

/**
 * Public ToolRuntime name of a fixture tool.
 * @param rawName - the fixture's own tool name.
 * @returns the name the model sees.
 */
export const PUBLIC = (rawName: string): string => `mcp__mutable__${rawName}`

/**
 * Boot a Loader tree with one mcp-client row connected to the fixture.
 * @param options - initial surface, extra rows, and whether the row is reviewed.
 * @returns the context, scratch paths, a surface writer, and a disposer.
 */
export async function boot(options: BootOptions): Promise<Booted> {
  const root = await mkdtemp(join(packageDir, '.loader-'))
  const surfaceDir = join(root, 'surface')
  const stageDir = join(root, 'stage')
  await mkdir(surfaceDir)
  await mkdir(stageDir)
  const surfacePath = join(surfaceDir, 'surface.json')
  let writes = 0
  const writeSurface = async (surface: Surface): Promise<void> => {
    // Stage outside the watched directory so the fixture sees one rename event.
    const staged = join(stageDir, `surface-${String(++writes)}.json`)
    await writeFile(staged, JSON.stringify(surface))
    await renameWithRetry(staged, surfacePath)
  }
  await writeSurface(options.surface)

  const paths: BootPaths = {
    root,
    lockPath: join(root, 'home', 'mcp-lock.json'),
    auditDir: join(root, 'home', 'mcp-audit'),
  }
  const rows: object[] = [
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    ...await options.rows?.(paths) ?? [],
    {
      id: 'mcp-mutable',
      name: '@deepseek-ai/dsh-mcp-client',
      ...options.reviewed === false ? {} : { inject: ['mcpToolReview'] },
      config: {
        transport: 'stdio',
        serverName: 'mutable',
        command: process.execPath,
        args: [fixture],
        env: { AIR_MCP_TRUST_FIXTURE_SURFACE: surfacePath },
        reconnect: { initialDelayMs: 20, maxDelayMs: 200, maxAttempts: 5 },
      },
    },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(rows, null, 2))

  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(packageDir).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  return {
    ...paths,
    ctx,
    writeSurface,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
