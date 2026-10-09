/** Line-delimited JSON-RPC MCP server over stdio with one tool, `echo`. */
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// Tests set ECHO_PID_FILE to learn which processes this server started and to check that they exit.
if (process.env.ECHO_PID_FILE) writeFileSync(`${process.env.ECHO_PID_FILE}.${process.pid}`, '')

const reply = (id, body) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`)

process.stdin.once('end', () => process.exit(0))

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  // Notifications carry no id and need no reply.
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize':
      reply(request.id, {
        result: {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'air-echo', version: '1' },
        },
      })
      break
    case 'tools/list':
      reply(request.id, {
        result: {
          tools: [{
            name: 'echo',
            description: 'Return the text argument.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          }],
        },
      })
      break
    case 'tools/call':
      reply(request.id, { result: { content: [{ type: 'text', text: `echo: ${request.params.arguments.text}` }] } })
      break
    default:
      reply(request.id, { error: { code: -32601, message: 'Method not found' } })
  }
})
