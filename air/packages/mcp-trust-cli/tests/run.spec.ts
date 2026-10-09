import { describe, expect, it, vi } from 'vitest'
import type { LockEntrySummary, McpTrust, ObservedSurface } from '@air/dsh-mcp-trust'
import { EXIT_DRIFT, EXIT_ERROR, EXIT_OK, EXIT_USAGE, runTrustCli, type CliIo } from '../src/run.ts'

const KEY_A = 'a1b2c3d4e5f6'.padEnd(64, '0')
const KEY_B = 'a1b2c3d4ffff'.padEnd(64, '1')

function surface(serverName: string, state: ObservedSurface['state']): ObservedSurface {
  return {
    serverName, surfaceDigest: 'sha256:1', instructions: '', tools: [],
    diff: { added: [], removed: [], changed: [], instructionsChanged: false },
    state, action: 'accept', withheld: [], observedAt: 0,
  }
}

function entry(serverName: string, reviewKey?: string, tools = 1, approvedAt = '2026-10-01T00:00:00.000Z'): LockEntrySummary {
  return { serverName, ...reviewKey === undefined ? {} : { reviewKey }, tools, approvedAt }
}

function harness(surfaces: ObservedSurface[], entries: LockEntrySummary[] = [], io: Partial<CliIo> = {}) {
  const out: string[] = []
  const err: string[] = []
  const byName = new Map(surfaces.map(each => [each.serverName, each] as const))
  const trust = {
    observed: vi.fn((ref: { serverName: string }) => byName.get(ref.serverName)),
    servers: vi.fn(() => [...byName.keys()].map(serverName => ({ serverName }))),
    describe: vi.fn((ref: { serverName: string }) => `server ${ref.serverName}: ${byName.get(ref.serverName)?.state ?? 'missing'}`),
    pin: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()),
    verify: vi.fn(() => surfaces),
    entries: vi.fn(() => Promise.resolve(entries)),
  } satisfies McpTrust
  const cli: CliIo = {
    out: text => out.push(text),
    err: text => err.push(text),
    isTty: () => false,
    confirm: () => Promise.resolve(false),
    ...io,
  }
  return { trust, cli, out, err }
}

describe('diff', () => {
  it('prints the description and exits 0 for an approved surface', async () => {
    const { trust, cli, out, err } = harness([surface('browser', 'approved')])
    expect(await runTrustCli(trust, { kind: 'diff', server: 'browser' }, cli)).toBe(EXIT_OK)
    expect(out).toEqual(['server browser: approved'])
    expect(err).toEqual([])
    expect(trust.pin).not.toHaveBeenCalled()
  })

  it('exits 1 on drift with one stderr line, and 2 for a server that was not observed', async () => {
    const { trust, cli, out, err } = harness([surface('browser', 'quarantined')])
    expect(await runTrustCli(trust, { kind: 'diff', server: 'browser' }, cli)).toBe(EXIT_DRIFT)
    expect(out).toEqual(['server browser: quarantined'])
    expect(err).toEqual([
      'air-mcp: server "browser" differs from its pin (quarantined). Run `pnpm dsh --profile air-mcp pin browser` to approve it'
      + ' or `pnpm dsh --profile air-mcp revoke browser` to keep it blocked.',
    ])
    err.length = 0
    expect(await runTrustCli(trust, { kind: 'diff', server: 'ghost' }, cli)).toBe(EXIT_ERROR)
    expect(err).toHaveLength(1)
    expect(err[0]).toMatch(/^air-mcp: server "ghost" was not observed\. This profile connects only the mcp-client rows in its own/)
    expect(err[0]).toContain('.mcp.json')
  })

  it('escapes control characters in a server name it prints', async () => {
    const { trust, cli, err } = harness([])
    await runTrustCli(trust, { kind: 'diff', server: 'bad\u001b[2Jname' }, cli)
    expect(err[0]).toContain('bad<U+001B>[2Jname')
    expect(err[0]).not.toContain('\u001b')
  })

  it('names the project entries when only a keyed entry has that name', async () => {
    const { trust, cli, err } = harness([], [entry('browser', KEY_A), entry('browser', KEY_B), entry('other')])
    expect(await runTrustCli(trust, { kind: 'diff', server: 'browser' }, cli)).toBe(EXIT_ERROR)
    expect(err).toHaveLength(1)
    expect(err[0]).toContain('no profile-level server "browser" was observed')
    expect(err[0]).toContain('browser  key a1b2c3d4e5f6; browser  key a1b2c3d4ffff')
    expect(err[0]).toContain('reviewed inside a session in that project')
    expect(err[0]).not.toContain('other')
  })

  it('adds the lockfile problem when the entries cannot be read', async () => {
    const { trust, cli, err } = harness([])
    trust.entries.mockRejectedValueOnce(new Error('/x/mcp-lock.json is not JSON'))
    expect(await runTrustCli(trust, { kind: 'diff', server: 'ghost' }, cli)).toBe(EXIT_ERROR)
    expect(err).toHaveLength(1)
    expect(err[0]).toContain('was not observed')
    expect(err[0]).toContain('The lockfile cannot be read: /x/mcp-lock.json is not JSON')
  })

  it('tolerates a non-error rejection from the entries read', async () => {
    const { trust, cli, err } = harness([])
    trust.entries.mockRejectedValueOnce('disk gone')
    expect(await runTrustCli(trust, { kind: 'diff', server: 'ghost' }, cli)).toBe(EXIT_ERROR)
    expect(err[0]).toContain('The lockfile cannot be read: disk gone')
  })
})

describe('--key on pin, diff, and verify', () => {
  it.each([
    ['pin', { kind: 'pin', server: 'browser', key: KEY_A.slice(0, 12), yes: true }],
    ['diff', { kind: 'diff', server: 'browser', key: KEY_A.slice(0, 12) }],
    ['verify', { kind: 'verify', all: false, server: 'browser', key: KEY_A.slice(0, 12) }],
  ] as const)('%s says the project server is reviewed inside its project and exits with the usage code', async (_name, invocation) => {
    const { trust, cli, out, err } = harness([surface('browser', 'unpinned')], [entry('browser', KEY_A)])
    expect(await runTrustCli(trust, invocation, cli)).toBe(EXIT_USAGE)
    expect(out).toEqual([])
    expect(err).toHaveLength(1)
    expect(err[0]).toContain('belongs to a project and is reviewed inside a session in that project')
    expect(err[0]).toContain('"browser"')
    expect(trust.observed).not.toHaveBeenCalled()
    expect(trust.pin).not.toHaveBeenCalled()
  })
})

describe('--key without a server name', () => {
  it('verify --all with --key is refused without naming a server', async () => {
    const { trust, cli, err } = harness([surface('browser', 'approved')])
    expect(await runTrustCli(trust, { kind: 'verify', all: true, key: KEY_A.slice(0, 12) }, cli)).toBe(EXIT_USAGE)
    expect(err[0]).toContain('a server (key a1b2c3d4e5f6) belongs to a project')
  })
})

describe('verify', () => {
  it('exits 0 when every server is approved or pinned on first use, and writes nothing', async () => {
    const { trust, cli, out, err } = harness([surface('a', 'approved'), surface('b', 'tofu')])
    expect(await runTrustCli(trust, { kind: 'verify', all: true }, cli)).toBe(EXIT_OK)
    expect(out).toEqual(['a: approved', 'b: tofu'])
    expect(err).toEqual([])
    expect(trust.pin).not.toHaveBeenCalled()
    expect(trust.revoke).not.toHaveBeenCalled()
  })

  it.each(['withheld', 'quarantined', 'unpinned', 'accepted-once'] as const)('exits 1, prints the difference, and summarizes on stderr for a %s server', async (state) => {
    const { trust, cli, out, err } = harness([surface('a', 'approved'), surface('b', state)])
    expect(await runTrustCli(trust, { kind: 'verify', all: true }, cli)).toBe(EXIT_DRIFT)
    expect(out).toEqual(['a: approved', `b: ${state}`, `server b: ${state}`])
    expect(err).toEqual([`air-mcp: 1 server differs from its pin: b (${state}). Run \`pnpm dsh --profile air-mcp diff <server>\` to see why.`])
  })

  it('counts several drifted servers and shortens a long list', async () => {
    const many = Array.from({ length: 12 }, (_, index) => surface(`s${String(index)}`, 'unpinned'))
    const { trust, cli, err } = harness(many)
    expect(await runTrustCli(trust, { kind: 'verify', all: true }, cli)).toBe(EXIT_DRIFT)
    expect(err).toHaveLength(1)
    expect(err[0]).toContain('12 servers differ from their pins: s0 (unpinned)')
    expect(err[0]).toContain('and 2 more')
    expect(err[0]).not.toContain('s11')
  })

  it('verifies one named server, and exits 2 when it was not observed', async () => {
    const { trust, cli, err } = harness([surface('a', 'quarantined')])
    expect(await runTrustCli(trust, { kind: 'verify', all: false, server: 'a' }, cli)).toBe(EXIT_DRIFT)
    err.length = 0
    expect(await runTrustCli(trust, { kind: 'verify', all: false, server: 'ghost' }, cli)).toBe(EXIT_ERROR)
    expect(err).toHaveLength(1)
  })

  it('reports an empty observation and a missing target', async () => {
    const { trust, cli, out, err } = harness([])
    expect(await runTrustCli(trust, { kind: 'verify', all: true }, cli)).toBe(EXIT_OK)
    expect(out).toEqual(['no MCP servers were observed'])
    expect(await runTrustCli(trust, { kind: 'verify', all: false }, cli)).toBe(EXIT_USAGE)
    expect(err).toEqual(['air-mcp: verify needs a server name or --all. Run `pnpm dsh --profile air-mcp verify --all` to check every server.'])
  })
})

describe('pin', () => {
  it('writes with --yes and passes selected tools', async () => {
    const { trust, cli, out } = harness([surface('browser', 'unpinned')])
    expect(await runTrustCli(trust, { kind: 'pin', server: 'browser', yes: true }, cli)).toBe(EXIT_OK)
    expect(trust.pin).toHaveBeenLastCalledWith({ serverName: 'browser' }, { approvedBy: 'cli' })
    expect(out).toEqual(['server browser: unpinned', 'pinned browser'])
    await runTrustCli(trust, { kind: 'pin', server: 'browser', tools: ['nav'], yes: true }, cli)
    expect(trust.pin).toHaveBeenLastCalledWith({ serverName: 'browser' }, { tools: ['nav'], approvedBy: 'cli' })
  })

  it('refuses without --yes when stdin is not a terminal, after printing the difference', async () => {
    const { trust, cli, out, err } = harness([surface('browser', 'unpinned')])
    expect(await runTrustCli(trust, { kind: 'pin', server: 'browser', yes: false }, cli)).toBe(EXIT_USAGE)
    expect(out).toEqual(['server browser: unpinned'])
    expect(err).toEqual(['air-mcp: refusing to pin without --yes because stdin is not a terminal. Pass --yes to approve without a question.'])
    expect(trust.pin).not.toHaveBeenCalled()
  })

  it('asks on a terminal and honors the answer', async () => {
    const declined = harness([surface('browser', 'unpinned')], [], { isTty: () => true, confirm: () => Promise.resolve(false) })
    expect(await runTrustCli(declined.trust, { kind: 'pin', server: 'browser', yes: false }, declined.cli)).toBe(EXIT_DRIFT)
    expect(declined.trust.pin).not.toHaveBeenCalled()
    expect(declined.err).toEqual(['air-mcp: not pinned. Run the command again and answer y, or pass --yes.'])

    const confirm = vi.fn(() => Promise.resolve(true))
    const accepted = harness([surface('browser', 'unpinned')], [], { isTty: () => true, confirm })
    expect(await runTrustCli(accepted.trust, { kind: 'pin', server: 'browser', yes: false }, accepted.cli)).toBe(EXIT_OK)
    expect(confirm).toHaveBeenCalledWith('Pin this surface for "browser"? [y/N] ')
    expect(accepted.trust.pin).toHaveBeenCalledTimes(1)
  })

  it('exits 2 for an unobserved server and for a failed write', async () => {
    const { trust, cli, err } = harness([surface('browser', 'unpinned')])
    expect(await runTrustCli(trust, { kind: 'pin', server: 'ghost', yes: true }, cli)).toBe(EXIT_ERROR)
    trust.pin.mockRejectedValueOnce(new Error('mcp-trust: server "browser" does not list nope'))
    expect(await runTrustCli(trust, { kind: 'pin', server: 'browser', tools: ['nope'], yes: true }, cli)).toBe(EXIT_ERROR)
    expect(err.at(-1)).toBe('air-mcp: mcp-trust: server "browser" does not list nope')
    trust.pin.mockRejectedValueOnce('lock timeout')
    expect(await runTrustCli(trust, { kind: 'pin', server: 'browser', yes: true }, cli)).toBe(EXIT_ERROR)
    expect(err.at(-1)).toBe('air-mcp: lock timeout')
  })
})

describe('revoke', () => {
  it('revokes a whole keyless entry or selected tools', async () => {
    const { trust, cli, out } = harness([], [entry('browser')])
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser' }, cli)).toBe(EXIT_OK)
    expect(trust.revoke).toHaveBeenLastCalledWith({ serverName: 'browser' }, {})
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', tools: ['nav'] }, cli)).toBe(EXIT_OK)
    expect(trust.revoke).toHaveBeenLastCalledWith({ serverName: 'browser' }, { tools: ['nav'] })
    expect(out).toEqual(['revoked browser', 'revoked browser: nav'])
  })

  it('resolves --key to the one entry whose key starts with the prefix, in any letter case', async () => {
    const { trust, cli, out } = harness([], [entry('browser', KEY_A), entry('browser', KEY_B), entry('browser')])
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', key: 'A1B2C3D4E5' }, cli)).toBe(EXIT_OK)
    expect(trust.revoke).toHaveBeenLastCalledWith({ serverName: 'browser', reviewKey: KEY_A }, {})
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', key: KEY_B, tools: ['nav'] }, cli)).toBe(EXIT_OK)
    expect(trust.revoke).toHaveBeenLastCalledWith({ serverName: 'browser', reviewKey: KEY_B }, { tools: ['nav'] })
    expect(out).toEqual(['revoked browser (key a1b2c3d4e5f6)', 'revoked browser (key a1b2c3d4ffff): nav'])
  })

  it('treats a prefix shared by several entries as a usage error and lists them', async () => {
    const { trust, cli, err } = harness([], [entry('browser', KEY_A), entry('browser', KEY_B)])
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', key: 'a1b2c3d4' }, cli)).toBe(EXIT_USAGE)
    expect(err).toHaveLength(1)
    expect(err[0]).toContain('matches 2 entries named "browser"')
    expect(err[0]).toContain('browser  key a1b2c3d4e5f6; browser  key a1b2c3d4ffff')
    expect(trust.revoke).not.toHaveBeenCalled()
  })

  it('treats a prefix that matches nothing as a usage error and lists the candidates', async () => {
    const { trust, cli, err } = harness([], [entry('browser', KEY_A), entry('browser')])
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', key: 'ffffffff' }, cli)).toBe(EXIT_USAGE)
    expect(err[0]).toContain('no entry named "browser" has a key starting with ffffffff')
    expect(err[0]).toContain('browser  key a1b2c3d4e5f6')
    const none = harness([], [entry('other')])
    expect(await runTrustCli(none.trust, { kind: 'revoke', server: 'browser', key: 'ffffffff' }, none.cli)).toBe(EXIT_USAGE)
    expect(none.err[0]).toContain('The lockfile has no project entries named "browser".')
    expect(none.trust.revoke).not.toHaveBeenCalled()
  })

  it('rejects a key shorter than 8 characters or not hexadecimal', async () => {
    const { trust, cli, err } = harness([], [entry('browser', KEY_A)])
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', key: 'a1b2c3d' }, cli)).toBe(EXIT_USAGE)
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser', key: 'zzzzzzzzzz' }, cli)).toBe(EXIT_USAGE)
    expect(err).toHaveLength(2)
    expect(err[0]).toContain('--key needs at least 8 hexadecimal characters')
    expect(trust.revoke).not.toHaveBeenCalled()
  })

  it('asks for --key when only project entries have that name, and exits 2 when no entry exists', async () => {
    const keyed = harness([], [entry('browser', KEY_A)])
    expect(await runTrustCli(keyed.trust, { kind: 'revoke', server: 'browser' }, keyed.cli)).toBe(EXIT_USAGE)
    expect(keyed.err[0]).toContain('has only project entries: browser  key a1b2c3d4e5f6')
    expect(keyed.err[0]).toContain('--key')
    const none = harness([], [])
    expect(await runTrustCli(none.trust, { kind: 'revoke', server: 'browser' }, none.cli)).toBe(EXIT_ERROR)
    expect(none.err).toEqual(['air-mcp: the lockfile has no entry named "browser". Run `pnpm dsh --profile air-mcp list` to see the entries.'])
    expect(none.trust.revoke).not.toHaveBeenCalled()
  })

  it('exits 2 with the reason when the lockfile cannot be read or the write fails', async () => {
    const { trust, cli, err } = harness([], [entry('browser')])
    trust.entries.mockRejectedValueOnce(new Error('/x/mcp-lock.json is invalid'))
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser' }, cli)).toBe(EXIT_ERROR)
    expect(err.at(-1)).toBe('air-mcp: the lockfile cannot be read: /x/mcp-lock.json is invalid')
    trust.revoke.mockRejectedValueOnce(new Error('lock wait timed out'))
    expect(await runTrustCli(trust, { kind: 'revoke', server: 'browser' }, cli)).toBe(EXIT_ERROR)
    expect(err.at(-1)).toBe('air-mcp: lock wait timed out')
  })
})

describe('list', () => {
  it('prints name, key prefix or dash, tool count, and newest approval; it writes nothing', async () => {
    const { trust, cli, out, err } = harness([], [entry('browser', KEY_A, 2, '2026-10-02T00:00:00.000Z'), entry('files', undefined, 0, '')])
    expect(await runTrustCli(trust, { kind: 'list' }, cli)).toBe(EXIT_OK)
    expect(out).toEqual(['browser  a1b2c3d4e5f6  2 tools  2026-10-02T00:00:00.000Z', 'files  -  0 tools  -'])
    expect(err).toEqual([])
    expect(trust.pin).not.toHaveBeenCalled()
    expect(trust.revoke).not.toHaveBeenCalled()
  })

  it('says so for an empty lockfile, uses the singular for one tool, and escapes names', async () => {
    const empty = harness([], [])
    expect(await runTrustCli(empty.trust, { kind: 'list' }, empty.cli)).toBe(EXIT_OK)
    expect(empty.out).toEqual(['the lockfile has no entries'])
    const one = harness([], [entry('bad\u001bname', undefined, 1)])
    await runTrustCli(one.trust, { kind: 'list' }, one.cli)
    expect(one.out[0]).toBe('bad<U+001B>name  -  1 tool  2026-10-01T00:00:00.000Z')
  })

  it('prints the reason and exits 2 for a corrupt lockfile', async () => {
    const { trust, cli, out, err } = harness([])
    trust.entries.mockRejectedValueOnce(new Error('/x/mcp-lock.json is not JSON. The file was not changed.'))
    expect(await runTrustCli(trust, { kind: 'list' }, cli)).toBe(EXIT_ERROR)
    expect(out).toEqual([])
    expect(err).toEqual(['air-mcp: the lockfile cannot be read: /x/mcp-lock.json is not JSON. The file was not changed.'])
  })
})
