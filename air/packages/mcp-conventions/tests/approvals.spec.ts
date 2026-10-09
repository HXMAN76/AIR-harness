import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { canonicalJson, type ServerSpec } from '../src/config.ts'

const created: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function approvalsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-approvals-'))
  created.push(dir)
  return join(dir, 'nested', 'mcp-approvals.json')
}

const root = resolve(sep, 'p')
const at = '2026-10-01T00:00:00.000Z'
const stdioEntry = { command: 'npx', args: ['server'], env: { B: '${B}', A: '1' } }
const httpEntry = { type: 'http', url: 'https://example.test/mcp', headers: { Z: '1', A: '${A}' } }
const stdio: ServerSpec = {
  transport: 'stdio',
  serverName: 'files',
  command: 'npx',
  args: ['server'],
  env: { B: '2', A: '1' },
  cwd: root,
  definition: canonicalJson(stdioEntry),
}
const http: ServerSpec = {
  transport: 'streamable-http',
  serverName: 'remote',
  url: 'https://example.test/mcp',
  headers: { Z: '1', A: '2' },
  definition: canonicalJson(httpEntry),
}

describe('approvalKey', () => {
  it('is a stable SHA-256 of the project, server name, and definition as written', () => {
    const key = approvalKey(root, stdio)
    expect(key).toMatch(/^[0-9a-f]{64}$/u)
    expect(approvalKey(root, { ...stdio, cwd: join(root, 'sub') })).toBe(key)
    expect(approvalKey(root, { ...stdio, env: { A: '1', B: 'rotated' } })).toBe(key)
    expect(approvalKey(root, { ...http, headers: { A: 'rotated', Z: '1' } })).toBe(approvalKey(root, http))
  })

  it('changes with the project, the server name, and any edit of the definition', () => {
    const key = approvalKey(root, stdio)
    expect(approvalKey(resolve(sep, 'q'), stdio)).not.toBe(key)
    expect(approvalKey(root, { ...stdio, serverName: 'other' })).not.toBe(key)
    expect(approvalKey(root, { ...stdio, definition: canonicalJson({ ...stdioEntry, command: 'node' }) })).not.toBe(key)
    expect(approvalKey(root, { ...stdio, definition: canonicalJson({ ...stdioEntry, args: ['server', '--unsafe'] }) })).not.toBe(key)
    expect(approvalKey(root, { ...http, definition: canonicalJson({ ...httpEntry, url: 'https://evil.test/mcp' }) }))
      .not.toBe(approvalKey(root, http))
  })

  it('treats a Windows project root without regard to letter case', () => {
    const lower = approvalKey(root, stdio)
    expect(approvalKey(root.toUpperCase(), stdio)).not.toBe(lower)
    vi.stubGlobal('process', Object.defineProperty(Object.create(process) as NodeJS.Process, 'platform', { value: 'win32' }))
    expect(approvalKey(root.toUpperCase(), stdio)).toBe(approvalKey(root.toLowerCase(), stdio))
  })
})

describe('ApprovalStore', () => {
  it('records and removes approvals', async () => {
    const file = await approvalsFile()
    const store = new ApprovalStore(file)
    const key = approvalKey(root, stdio)
    const other = approvalKey(root, http)
    expect(await store.has(key)).toBe(false)
    await store.add(key, { projectRoot: root, server: 'files', approvedAt: at })
    await store.add(other, { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' })
    expect(await store.has(key)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      approved: {
        [key]: { projectRoot: root, server: 'files', approvedAt: at },
        [other]: { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' },
      },
    })
    await store.remove(key)
    expect(await store.has(key)).toBe(false)
    expect(await new ApprovalStore(file).has(other)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('writes a private file', async () => {
    const file = await approvalsFile()
    await new ApprovalStore(file).add(approvalKey(root, stdio), { projectRoot: root, server: 'files', approvedAt: at })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps every approval when several are added at once', async () => {
    const store = new ApprovalStore(await approvalsFile())
    const specs = ['a', 'b', 'c', 'd'].map(serverName => ({ ...stdio, serverName }))
    await Promise.all(specs.map(spec => store.add(approvalKey(root, spec), { projectRoot: root, server: spec.serverName, approvedAt: at })))
    for (const spec of specs) expect(await store.has(approvalKey(root, spec))).toBe(true)
  })

  it('keeps accepting writes after one failed', async () => {
    const file = await approvalsFile()
    const store = new ApprovalStore(file)
    await store.add(approvalKey(root, stdio), { projectRoot: root, server: 'files', approvedAt: at })
    await writeFile(file, '{ truncated')
    const remote = { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' }
    await expect(store.add(approvalKey(root, http), remote)).rejects.toThrow()
    await writeFile(file, '{"version": 1, "approved": {}}')
    await store.add(approvalKey(root, http), remote)
    expect(await store.has(approvalKey(root, http))).toBe(true)
  })

  it('fails loud on a file that is not an approvals file', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'air-approvals-')), 'mcp-approvals.json')
    created.push(join(file, '..'))
    const store = new ApprovalStore(file)
    await writeFile(file, '{ truncated')
    await expect(store.has(approvalKey(root, stdio))).rejects.toThrow()
    await writeFile(file, '{"version": 1, "approved": []}')
    await expect(store.has(approvalKey(root, stdio))).rejects.toThrow('is not an approvals file')
    await writeFile(file, '[]')
    await expect(store.has(approvalKey(root, stdio))).rejects.toThrow('is not an approvals file')
  })
})
