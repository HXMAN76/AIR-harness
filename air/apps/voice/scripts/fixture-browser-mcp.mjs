/**
 * Test fixture: a tiny stdio MCP server named like the Playwright one, with only browser_click and browser_press_key.
 * It records every tools/call as one JSON line in the file named by AIR_FIXTURE_LOG, so a live run can show which
 * calls got past the send guard. It clicks nothing: it only answers "ok".
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = process.env.AIR_FIXTURE_LOG
const tools = [
  {
    name: 'browser_click',
    description: 'Click an element on the page.',
    inputSchema: { type: 'object', properties: { element: { type: 'string', description: 'Human-readable element description' }, ref: { type: 'string', description: 'Element reference' } }, required: ['element', 'ref'] },
  },
  {
    name: 'browser_press_key',
    description: 'Press a key on the keyboard.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Key name' } }, required: ['key'] },
  },
]

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    reply(message.id, { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'browser', version: '0.0.0' } })
  } else if (message.method === 'tools/list') {
    reply(message.id, { tools })
  } else if (message.method === 'tools/call') {
    if (log) appendFileSync(log, `${JSON.stringify({ tool: message.params?.name, arguments: message.params?.arguments })}\n`)
    reply(message.id, { content: [{ type: 'text', text: 'ok' }] })
  } else if (message.id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })}\n`)
  }
})
