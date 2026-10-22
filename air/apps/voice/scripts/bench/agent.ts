/**
 * The agent: turn latency of the local route (Ollama, qwen3-8b-32k) and, when the cloud key is present, the cloud
 * route, over ten short harmless prompts repeated three times. Each turn is a fresh conversation, so the numbers do not
 * grow with context. The first turn of each route is reported separately (it starts the dsh runtime and may load the
 * model). Reads no key: the cloud route is used only if the bridge reports the key as present.
 * `pnpm -C air/apps/voice exec tsx scripts/bench/agent.ts [--quick]`
 * Note: the turns are real sessions in the voice home, like any voice turn.
 */
import { join } from 'node:path'
import { AgentBridge } from '../../src/core/agent.ts'
import { rewriteForAgent, type Route } from '../../src/core/commands.ts'
import { assertWorkspaceOutsideHome, cloudKeyPresent, voiceHome, voiceWorkspace } from '../../src/core/home.ts'
import { type BenchContext, type BenchResult, contextFromArgs, isMain, repoRelative, runDir, statsTable, writeCsv, writeManifest } from './lib.ts'

/** Short prompts that need no tool that changes the system. */
export const PROMPTS: readonly string[] = [
  'what time is it in Tokyo',
  'say hello',
  'what is the capital of Australia',
  'tell me a one line joke',
  'how many days are in a leap year',
  'spell the word necessary',
  'what is twelve times fifteen',
  'name three primary colors',
  'what is the boiling point of water in Fahrenheit',
  'give me a fun fact about octopuses',
]

const TURN_TIMEOUT_MS = 240_000

interface Turn {
  route: Route
  cold: boolean
  prompt: number
  run: number
  ok: boolean
  firstEventMs: number | undefined
  totalMs: number
  promptTokens: number
  outputTokens: number
  steps: number
  tools: number
  replyWords: number
}

async function runRoute(route: Route, prompts: readonly string[], runs: number, log: (line: string) => void): Promise<Turn[] | string> {
  const home = voiceHome()
  const workspace = voiceWorkspace()
  assertWorkspaceOutsideHome(workspace, home)
  const bridge = new AgentBridge({ dshHome: home, cwd: workspace })
  const turns: Turn[] = []
  try {
    if (route !== 'local' && !cloudKeyPresent(process.env, home)) return 'the cloud key is not present'
    const set = bridge.setRoute(route)
    if (!set.ok) return 'the cloud key is not present'
    for (let run = 0; run < runs; run++) {
      for (const [prompt, text] of prompts.entries()) {
        bridge.newConversation()
        const started = performance.now()
        let turn: Turn
        try {
          const result = await Promise.race([
            bridge.ask(rewriteForAgent(text)),
            new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('turn timed out')) }, TURN_TIMEOUT_MS) }),
          ])
          turn = {
            route, cold: turns.length === 0, prompt, run, ok: true,
            firstEventMs: result.stats.firstEventMs, totalMs: performance.now() - started,
            promptTokens: result.stats.promptTokens, outputTokens: result.stats.outputTokens, steps: result.stats.steps,
            tools: result.tools.length, replyWords: result.reply.split(/\s+/).filter(word => word !== '').length,
          }
        } catch {
          turn = {
            route, cold: turns.length === 0, prompt, run, ok: false, firstEventMs: undefined,
            totalMs: performance.now() - started, promptTokens: 0, outputTokens: 0, steps: 0, tools: 0, replyWords: 0,
          }
          await bridge.cancel()
        }
        turns.push(turn)
        log(`${route} run ${run + 1} prompt ${prompt + 1}: ${turn.ok ? 'ok' : 'FAILED'} ${Math.round(turn.totalMs)} ms${turn.cold ? ' (cold)' : ''}`)
      }
    }
  } finally {
    await bridge.dispose()
  }
  return turns
}

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const prompts = ctx.quick ? PROMPTS.slice(0, 2) : PROMPTS
  const runs = ctx.quick ? 1 : 3
  const notes: string[] = []
  const all: Turn[] = []
  for (const route of ['local', 'cloud'] as const) {
    const turns = await runRoute(route, prompts, runs, log)
    if (typeof turns === 'string') notes.push(`The ${route} route was skipped: ${turns}.`)
    else all.push(...turns)
  }
  const dir = runDir(ctx, 'agent')
  writeCsv(join(dir, 'data.csv'), ['route', 'cold', 'prompt', 'run', 'ok', 'first_event_ms', 'total_ms', 'prompt_tokens', 'output_tokens', 'model_calls', 'tool_calls', 'reply_words'],
    all.map(turn => [
      turn.route, turn.cold, turn.prompt, turn.run, turn.ok, turn.firstEventMs, turn.totalMs,
      turn.promptTokens, turn.outputTokens, turn.steps, turn.tools, turn.replyWords,
    ]))
  await writeManifest(dir, 'agent', all.length, { prompts: prompts.length, runsPerPrompt: runs, routes: [...new Set(all.map(turn => turn.route))], models: { local: 'qwen3-8b-32k (Ollama)', cloud: 'minimax-m3.1-flash (Ollama Cloud)' } }, ['qwen3-8b-32k'])

  const routes = [...new Set(all.map(turn => turn.route))]
  const warm = (route: Route): Turn[] => all.filter(turn => turn.route === route && !turn.cold && turn.ok)
  const pick = (pickFrom: (turn: Turn) => number | undefined): (readonly [string, readonly number[]])[] =>
    routes.map(route => [`${route} (warm)`, warm(route).flatMap(turn => pickFrom(turn) ?? [])] as const)
  const cold = all.filter(turn => turn.cold)
  return {
    bench: 'agent',
    dir: repoRelative(dir),
    n: all.length,
    tables: [
      statsTable('Turn time, command to final reply (ms), warm turns', 'route', pick(turn => turn.totalMs)),
      statsTable('Time to the first session event (ms), warm turns', 'route', pick(turn => turn.firstEventMs)),
      statsTable('Prompt (input) tokens per turn, summed over the turn\'s model calls', 'route', pick(turn => turn.promptTokens), 0),
      statsTable('Output tokens per turn', 'route', pick(turn => turn.outputTokens), 0),
      { title: 'Cold first turn (starts the dsh runtime, may load the model)', columns: ['route', 'total (ms)', 'first event (ms)', 'prompt tokens', 'output tokens'], rows: cold.map(turn => [turn.route, Math.round(turn.totalMs), turn.firstEventMs === undefined ? '-' : Math.round(turn.firstEventMs), turn.promptTokens, turn.outputTokens]) },
      { title: 'Failed turns', columns: ['route', 'failed', 'of'], rows: routes.map(route => [route, all.filter(turn => turn.route === route && !turn.ok).length, all.filter(turn => turn.route === route).length]) },
    ],
    notes: [
      `${prompts.length} prompts x ${runs} runs per route; every turn starts a new conversation (system prompt only), so context does not accumulate. Tokens come from the model's usage report and are 0 where the provider omits it.`,
      'Local: Ollama, qwen3-8b-32k on the laptop GPU; the model may already be resident in VRAM, which makes the cold turn look better than a true cold start.',
      'Cloud timings include the network to Ollama Cloud and depend on load there; treat them as one sample of that service.',
      ...notes,
    ],
  }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
