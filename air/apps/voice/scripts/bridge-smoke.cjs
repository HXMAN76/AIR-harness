/**
 * Manual check that the SDK runtime launches from inside Electron (process.execPath is electron.exe there):
 * `pnpm -C air/apps/voice exec electron scripts/bridge-smoke.cjs ["prompt"]`
 * Runs one local-route turn through AgentBridge, prints the reply, and exits 0 on a reply, 1 otherwise.
 */
const { app } = require('electron')
require('tsx/cjs')

const prompt = process.argv.slice(2).find(arg => !arg.endsWith('.cjs') && !arg.startsWith('-')) ?? 'say hi'

async function main() {
  const { AgentBridge } = require('../src/core/agent.ts')
  const { voiceHome, voiceWorkspace } = require('../src/core/home.ts')
  const bridge = new AgentBridge({ dshHome: voiceHome(), cwd: voiceWorkspace() })
  try {
    const started = Date.now()
    const { reply } = await bridge.ask(prompt)
    console.log(`execPath: ${process.execPath}`)
    console.log(`reply (${Date.now() - started} ms): ${reply}`)
    return reply.trim().length > 0 ? 0 : 1
  } finally {
    await bridge.dispose()
  }
}

app.whenReady().then(main).then(code => app.exit(code), error => {
  console.error(error)
  app.exit(1)
})
