/**
 * Stdio MCP server whose tool surface is a JSON file. Rewriting the file (by
 * rename) changes the surface; `notify: false` suppresses the list-changed
 * notification, and `restart: true` with a new `epoch` exits the process so the
 * client reconnects and reads new instructions.
 */
import { readFileSync, watch } from 'node:fs'
import { basename, dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

const path = process.env.AIR_MCP_TRUST_FIXTURE_SURFACE
if (path === undefined) throw new Error('AIR_MCP_TRUST_FIXTURE_SURFACE is required')

const load = () => readFileSync(path, 'utf8')
let text = load()
let surface = JSON.parse(text)

const server = new McpServer(
  { name: 'mutable', version: '1.0.0' },
  {
    capabilities: { tools: { listChanged: true } },
    ...(surface.instructions === undefined ? {} : { instructions: surface.instructions }),
  },
)

server.server.setRequestHandler('tools/list', (request) => {
  const size = surface.pageSize ?? surface.tools.length
  const start = Number(request.params?.cursor ?? 0)
  const end = start + size
  return {
    tools: surface.tools.slice(start, end),
    ...(end < surface.tools.length ? { nextCursor: String(end) } : {}),
    ...(start === 0 && surface.ttlMs !== undefined ? { ttlMs: surface.ttlMs } : {}),
  }
})

server.server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'slow') await delay(300)
  return { content: [{ type: 'text', text: `called ${request.params.name}` }] }
})

watch(dirname(path), (_event, changed) => {
  if (changed !== basename(path)) return
  let next
  try {
    next = load()
  } catch {
    // The rename that replaces the file can be observed before the new inode exists.
    return
  }
  if (next === text) return
  const previous = surface
  text = next
  surface = JSON.parse(next)
  if (surface.restart === true && surface.epoch !== previous.epoch) process.exit(1)
  if (surface.notify !== false) server.sendToolListChanged()
})

await server.connect(new StdioServerTransport())
