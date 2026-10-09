import { describe, expect, it } from 'vitest'
import { canonicalJson, expandEnv, parseMcpJson } from '../src/config.ts'

const options = { cwd: '/work/project', env: { TOKEN: 'secret', HOST: 'example.test' } }

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1]},"b":1}')
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })
})

describe('expandEnv', () => {
  it('substitutes set variables and defaults', () => {
    expect(expandEnv('Bearer ${TOKEN}', options.env)).toBe('Bearer secret')
    expect(expandEnv('${MISSING:-fallback}/${HOST:-unused}', options.env)).toBe('fallback/example.test')
    expect(expandEnv('${MISSING:-}', options.env)).toBe('')
    expect(expandEnv('no variables', options.env)).toBe('no variables')
  })

  it('throws for an unset variable without a default', () => {
    expect(() => expandEnv('${MISSING}', options.env)).toThrow('environment variable MISSING is not set')
  })
})

describe('parseMcpJson', () => {
  it('parses stdio and http servers and records each definition as written', () => {
    const entries = {
      files: { command: 'npx', args: ['-y', 'server-files', '${HOST}'], env: { API_TOKEN: '${TOKEN}' } },
      bare: { type: 'stdio', command: 'my-server' },
      remote: { type: 'http', url: 'https://${HOST}/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
      inferred: { url: 'https://example.test/other' },
      named: { type: 'streamable-http', url: 'https://example.test/third' },
    }
    const cwd = '/work/project'
    expect(parseMcpJson(JSON.stringify({ mcpServers: entries }), options)).toEqual({
      servers: [
        {
          transport: 'stdio',
          serverName: 'files',
          command: 'npx',
          args: ['-y', 'server-files', 'example.test'],
          env: { API_TOKEN: 'secret' },
          cwd,
          definition: canonicalJson(entries.files),
        },
        {
          transport: 'stdio',
          serverName: 'bare',
          command: 'my-server',
          args: [],
          env: {},
          cwd,
          definition: canonicalJson(entries.bare),
        },
        {
          transport: 'streamable-http',
          serverName: 'remote',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer secret' },
          definition: canonicalJson(entries.remote),
        },
        {
          transport: 'streamable-http',
          serverName: 'inferred',
          url: 'https://example.test/other',
          headers: {},
          definition: canonicalJson(entries.inferred),
        },
        {
          transport: 'streamable-http',
          serverName: 'named',
          url: 'https://example.test/third',
          headers: {},
          definition: canonicalJson(entries.named),
        },
      ],
      problems: [],
    })
  })

  it('keeps ${VAR} text in the definition so a rotated value does not change it', () => {
    const text = JSON.stringify({ mcpServers: { files: { command: 'npx', env: { API_TOKEN: '${TOKEN}' } } } })
    const first = parseMcpJson(text, options).servers[0]
    const second = parseMcpJson(text, { ...options, env: { TOKEN: 'rotated' } }).servers[0]
    expect(first?.definition).toBe(second?.definition)
    expect(first?.definition).toContain('${TOKEN}')
  })

  it('reports each invalid server and keeps the valid ones', () => {
    const text = JSON.stringify({
      mcpServers: {
        ok: { command: 'server' },
        'bad name!': { command: 'server' },
        legacy: { type: 'sse', url: 'https://example.test/sse' },
        scalar: 'npx server',
        nocommand: { type: 'stdio' },
        nourl: { type: 'http' },
        badargs: { command: 'server', args: 'one two' },
        badenv: { command: 'server', env: { PORT: 8080 } },
        badheaders: { url: 'https://example.test', headers: ['a'] },
        unset: { command: '${NOT_SET}' },
      },
    })
    const { servers, problems } = parseMcpJson(text, options)
    expect(servers.map(server => server.serverName)).toEqual(['ok'])
    expect(problems).toEqual([
      'bad name!: server name must match [A-Za-z0-9_-]{1,32}',
      'legacy: transport type "sse" is not supported; use stdio or http',
      'scalar: server entry must be an object',
      'nocommand: a stdio server requires a "command" string',
      'nourl: an http server requires a "url" string',
      'badargs: "args" must be a list of strings',
      'badenv: "env.PORT" must be a string',
      'badheaders: "headers" must be an object of strings',
      'unset: environment variable NOT_SET is not set',
    ])
  })

  it('reports an unreadable document', () => {
    expect(parseMcpJson('{ not json', options).problems[0]).toMatch(/^\.mcp\.json is not valid JSON: /u)
    const missing = { servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] }
    expect(parseMcpJson('[]', options)).toEqual(missing)
    expect(parseMcpJson('{"mcpServers": []}', options)).toEqual(missing)
  })

  it('accepts a byte-order mark and CRLF line endings', () => {
    const text = '﻿{\r\n  "mcpServers": { "ok": { "command": "server" } }\r\n}\r\n'
    expect(parseMcpJson(text, options).servers.map(server => server.serverName)).toEqual(['ok'])
  })
})
