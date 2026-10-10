/** The air-mcp command-line provider over a real Loader tree: one test per subcommand plus help, usage, and pending cases. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { internals as cmdlineInternals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { LockEntrySummary, McpTrust, ObservedSurface } from '@air/dsh-mcp-trust'
import * as cli from '../src/index.ts'
import { internals } from '../src/internals.ts'

declare global {
  // eslint-disable-next-line no-var -- a global binding is the only channel into natively imported rows
  var __airMcpTrustCli: { apply: typeof cli.apply; trust: McpTrust } | undefined
}

const original = { ...internals }
const disposers: (() => Promise<void>)[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  Object.assign(internals, original)
  cmdlineInternals.stdout = process.stdout
  cmdlineInternals.stderr = process.stderr
})

const APPROVED: ObservedSurface = {
  serverName: 'browser', surfaceDigest: 'sha256:1', instructions: '', tools: [],
  diff: { added: [], removed: [], changed: [], instructionsChanged: false },
  state: 'approved', action: 'accept', withheld: [], observedAt: 0,
}

const KEY = 'a1b2c3d4e5f6'.padEnd(64, '0')
const ENTRIES: LockEntrySummary[] = [
  { serverName: 'browser', tools: 2, approvedAt: '2026-10-01T00:00:00.000Z' },
  { serverName: 'projectsrv', reviewKey: KEY, tools: 1, approvedAt: '2026-10-02T00:00:00.000Z' },
]

function fakeTrust(surfaces: ObservedSurface[]) {
  const byName = new Map(surfaces.map(each => [each.serverName, each] as const))
  return {
    observed: vi.fn((ref: { serverName: string }) => byName.get(ref.serverName)),
    servers: vi.fn(() => [...byName.keys()].map(serverName => ({ serverName }))),
    describe: vi.fn((ref: { serverName: string }) => `server ${ref.serverName}: ${byName.get(ref.serverName)?.state ?? 'missing'}`),
    pin: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()),
    verify: vi.fn(() => surfaces),
    entries: vi.fn(() => Promise.resolve(ENTRIES)),
  } satisfies McpTrust
}

async function bootCli(args: string[], options: { surfaces?: ObservedSurface[]; withTrust?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'air-mcp-cli-'))
  dirs.push(dir)
  const trust = fakeTrust(options.surfaces ?? [APPROVED])
  globalThis.__airMcpTrustCli = { apply: cli.apply, trust }
  writeFileSync(join(dir, 'cli.mjs'), [
    'export const name = \'air-mcp-trust-cli\'',
    'export const inject = [\'cmdlineArgs\', \'mcpTrust\']',
    'export const apply = ctx => globalThis.__airMcpTrustCli.apply(ctx)',
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'trust.mjs'), [
    'export const name = \'fake-mcp-trust\'',
    'export const apply = (ctx) => { ctx.provide(\'mcpTrust\', globalThis.__airMcpTrustCli.trust) }',
    '',
  ].join('\n'))
  const rows = [
    { id: 'air-mcp-trust-cli', name: pathToFileURL(join(dir, 'cli.mjs')).href },
    ...options.withTrust === false ? [] : [{ id: 'air-mcp-trust', name: pathToFileURL(join(dir, 'trust.mjs')).href }],
  ]
  writeFileSync(join(dir, 'cordis.yml'), JSON.stringify(rows))

  const out: string[] = []
  const err: string[] = []
  const exits: number[] = []
  internals.stdout = { write: (chunk: string) => out.push(chunk) }
  internals.stderr = { write: (chunk: string) => err.push(chunk) }
  cmdlineInternals.stdout = { write: (chunk: string) => out.push(chunk) }
  cmdlineInternals.stderr = { write: (chunk: string) => err.push(chunk) }

  const listeners = new Set<() => void>()
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, {
    args,
    exit: code => void exits.push(code),
    ready: {
      onReady(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  let disposed: Promise<void> | undefined
  const dispose = (): Promise<void> => disposed ??= Promise.resolve(ctx.fiber.dispose()).then(() => {})
  disposers.push(dispose)
  const commit = (): void => { for (const listener of listeners) listener() }
  return { trust, out, err, exits, listeners, commit, dispose }
}

describe('air-mcp command-line provider', () => {
  it('verify --all runs after startup commits and exits 0 on a match', async () => {
    const { out, exits, commit } = await bootCli(['verify', '--all'])
    expect(exits).toEqual([])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(out).toEqual(['browser: approved\n'])
  })

  it('verify <server> exits 1 on drift', async () => {
    const { exits, commit } = await bootCli(['verify', 'browser'], { surfaces: [{ ...APPROVED, state: 'quarantined' }] })
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([1]) })
  })

  it('diff exits 2 for a server that was not observed and reports on stderr', async () => {
    const { err, exits, commit } = await bootCli(['diff', 'ghost'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([2]) })
    expect(err.join('')).toContain('server "ghost" was not observed')
  })

  it('pin --yes --tool passes the selection and exits 0', async () => {
    const { trust, exits, commit } = await bootCli(['pin', 'browser', '--tool', 'nav', 'snap', '--yes'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(trust.pin).toHaveBeenCalledWith({ serverName: 'browser' }, { tools: ['nav', 'snap'], approvedBy: 'cli' })
  })

  it('pin without --yes refuses on a non-terminal stdin', async () => {
    internals.stdin = new PassThrough()
    const { trust, exits, commit } = await bootCli(['pin', 'browser'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([1]) })
    expect(trust.pin).not.toHaveBeenCalled()
  })

  it('pin without --yes asks on a terminal and accepts a typed yes', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true })
    internals.stdin = stdin
    const { trust, err, exits, commit } = await bootCli(['pin', 'browser'])
    commit()
    await vi.waitFor(() => { expect(err.join('')).toContain('Pin this surface for "browser"? [y/N] ') })
    stdin.write('Yes\n')
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(trust.pin).toHaveBeenCalledWith({ serverName: 'browser' }, { approvedBy: 'cli' })
  })

  it('pin without --yes treats any other answer as no', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true })
    internals.stdin = stdin
    const { trust, exits, commit } = await bootCli(['pin', 'browser'])
    commit()
    stdin.write('maybe\n')
    await vi.waitFor(() => { expect(exits).toEqual([1]) })
    expect(trust.pin).not.toHaveBeenCalled()
  })

  it('revoke --tool passes the selection and exits 0', async () => {
    const { trust, exits, commit } = await bootCli(['revoke', 'browser', '--tool', 'nav'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(trust.revoke).toHaveBeenCalledWith({ serverName: 'browser' }, { tools: ['nav'] })
  })

  it('list prints the lockfile entries and exits 0', async () => {
    const { out, exits, commit } = await bootCli(['list'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(out).toEqual([
      'browser  -  2 tools  2026-10-01T00:00:00.000Z\n',
      'projectsrv  a1b2c3d4e5f6  1 tool  2026-10-02T00:00:00.000Z\n',
    ])
  })

  it('revoke --key resolves a project entry by prefix', async () => {
    const { trust, exits, commit } = await bootCli(['revoke', 'projectsrv', '--key', 'a1b2c3d4'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(trust.revoke).toHaveBeenCalledWith({ serverName: 'projectsrv', reviewKey: KEY }, {})
  })

  it('pin --key is refused as a project server and exits 1 without mounting anything', async () => {
    const { trust, err, exits, commit } = await bootCli(['pin', 'projectsrv', '--key', 'a1b2c3d4', '--yes'])
    commit()
    await vi.waitFor(() => { expect(exits).toEqual([1]) })
    expect(err.join('')).toContain('belongs to a project and is reviewed inside a session in that project')
    expect(trust.pin).not.toHaveBeenCalled()
  })

  it('diff --key and verify --key are refused as project servers', async () => {
    const diff = await bootCli(['diff', 'projectsrv', '--key', 'a1b2c3d4'])
    diff.commit()
    await vi.waitFor(() => { expect(diff.exits).toEqual([1]) })
    const verify = await bootCli(['verify', 'projectsrv', '--key', 'a1b2c3d4'])
    verify.commit()
    await vi.waitFor(() => { expect(verify.exits).toEqual([1]) })
    expect(verify.err.join('')).toContain('belongs to a project')
  })

  it('--help prints usage, exits 0, and runs nothing', async () => {
    const { out, exits, listeners } = await bootCli(['--help'])
    expect(exits).toEqual([0])
    expect(out.join('')).toContain('Usage: dsh --profile air-mcp')
    expect(out.join('')).toContain('pin')
    expect(out.join('')).toContain('list')
    expect(listeners.size).toBe(0)
  })

  it('an unknown command is a usage error', async () => {
    const { err, exits, listeners } = await bootCli(['approve', 'browser'])
    expect(exits).toEqual([1])
    expect(err.join('')).toContain('unknown command')
    expect(listeners.size).toBe(0)
  })

  it('stays pending without the trust service and cancels its startup listener on unload', async () => {
    const pending = await bootCli(['verify', '--all'], { withTrust: false })
    expect(pending.listeners.size).toBe(0)
    expect(pending.exits).toEqual([])

    const loaded = await bootCli(['verify', '--all'])
    expect(loaded.listeners.size).toBe(1)
    await loaded.dispose()
    expect(loaded.listeners.size).toBe(0)
  })

  it('fails loud when the launcher facts or the trust service are absent', () => {
    const bare = new Context()
    expect(() => { cli.apply(bare) }).toThrow('the launcher must provide ctx.appReady and ctx.appExit, and the tree must provide mcpTrust')
    provideCmdline(bare, { args: [], exit: () => {} })
    expect(() => { cli.apply(bare) }).toThrow('the launcher must provide')
    const noTrust = new Context()
    provideCmdline(noTrust, { args: [], exit: () => {}, ready: { onReady: () => () => {} } })
    expect(() => { cli.apply(noTrust) }).toThrow('the tree must provide mcpTrust')
  })
})
