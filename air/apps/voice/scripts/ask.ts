/**
 * Manual check: one SDK turn on the local route, printing the reply, each tool call, and the time taken.
 * `pnpm -C air/apps/voice exec tsx scripts/ask.ts "Use pwsh to print the year"`
 * Several prompts run in one conversation: `ask.ts "first" "second"`.
 */
import { AgentBridge, type HarnessLike, type HarnessOptions } from '../src/core/agent.ts'
import { voiceHome, voiceWorkspace } from '../src/core/home.ts'
import { sdkHarness } from '../src/sdk-harness.ts'

const prompts = process.argv.slice(2)
if (prompts.length === 0) prompts.push('Use pwsh to print the year')

/** Wrap the SDK harness so each turn's tool calls are printed with their arguments. */
function tracingFactory(options: HarnessOptions): HarnessLike {
  const harness = sdkHarness(options)
  return {
    close: () => harness.close(),
    session: (id) => {
      const session = harness.session(id)
      return {
        id: session.id,
        run: async (text) => {
          const result = await session.run(text)
          for (const event of result.events) {
            if (event.type === 'tool/call') console.log('tool/call', JSON.stringify(event.data))
            if (event.type === 'tool/result') console.log('tool/result', JSON.stringify(event.data).slice(0, 600))
            if (event.type === 'assistant/message') {
              const data = event.data as { usage?: unknown; message?: { usage?: unknown } } | undefined
              console.log('usage', JSON.stringify(data?.usage ?? data?.message?.usage ?? null))
            }
          }
          return result
        },
      }
    },
  }
}

const bridge = new AgentBridge({ dshHome: voiceHome(), cwd: voiceWorkspace(), harnessFactory: tracingFactory })
try {
  for (const prompt of prompts) {
    const started = Date.now()
    console.log(`> ${prompt}`)
    const { reply, tools } = await bridge.ask(prompt)
    console.log(`reply (${Date.now() - started} ms): ${reply}`)
    console.log(`tools: ${tools.join(', ') || '(none)'}`)
  }
} finally {
  await bridge.dispose()
}
