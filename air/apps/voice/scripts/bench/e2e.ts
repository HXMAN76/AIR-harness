/**
 * End to end: synthesized "Jarvis, <command>" speech is streamed in real time through the real listener worker (VAD,
 * Parakeet, text wake) into the real controller, which answers through the real `Speaker` and Kokoro worker into a
 * recording player (no sound). Operator commands run with a dry-run process runner, so nothing is launched; one agent
 * command runs on the real local agent. The latency is the controller's own metrics: speech end to the first audio
 * handed to the player. The VAD needs 350 ms of silence to close a segment (configured, not part of the number below);
 * a human hears the reply that much later still. CPU and memory of the process tree are sampled throughout.
 * Needs `pnpm -C air/apps/voice run build` first. `pnpm -C air/apps/voice exec tsx scripts/bench/e2e.ts [--quick]`
 */
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { AgentBridge } from '../../src/core/agent.ts'
import { VoiceController } from '../../src/core/controller.ts'
import { assertWorkspaceOutsideHome, voiceHome, voiceWorkspace } from '../../src/core/home.ts'
import { Listener } from '../../src/core/listener.ts'
import { MetricsRecorder, type MetricsRecord } from '../../src/core/metrics.ts'
import { modelDir, modelRoot } from '../../src/core/models.ts'
import { matchOperatorIntent, runOperatorIntent, type ExecLike } from '../../src/core/operator.ts'
import { SENSEVOICE_PACKAGE_JSON, VOICE_APP_ROOT } from '../../src/core/paths.ts'
import { Speaker, type AudioPlayer } from '../../src/core/speaker.ts'
import { nodeSpawn } from '../../src/node-spawn.ts'
import { readWav } from './audio.ts'
import { ensureCorpus, type Clip } from './corpus.ts'
import { type BenchContext, BenchSkipped, type BenchResult, contextFromArgs, isMain, repoRelative, runDir, statsTable, writeCsv, writeManifest } from './lib.ts'
import { ProcessSampler, resourceTable, roleTicks } from './sampler.ts'

/** The agent command: a plain question the operator does not match. */
const AGENT_COMMAND = 'what is the capital of France'
/** Silence the VAD needs to close a segment, as configured in the worker engine. */
const VAD_TAIL_MS = 350

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** A player that takes no time and makes no sound. */
class RecordingPlayer implements AudioPlayer {
  beeps = 0
  play(): Promise<void> { return Promise.resolve() }
  stop(): void { /* nothing plays */ }
  beep(): void { this.beeps++ }
}

/** Safe operator intents only: nothing that locks the screen, reads the network, or needs a spoken yes. */
function isSafeOperatorCommand(command: string): boolean {
  const intent = matchOperatorIntent(command)
  return intent !== null && intent.kind !== 'lock' && intent.kind !== 'news'
}

interface Row {
  kind: 'operator' | 'agent'
  cold: boolean
  clip: string
  voice: string
  record: MetricsRecord | undefined
}

export async function run(ctx: BenchContext, log: (line: string) => void = console.log): Promise<BenchResult> {
  const lib = join(VOICE_APP_ROOT, 'lib')
  for (const file of ['listener-worker.cjs', 'tts-worker.cjs', 'keywords.txt']) {
    if (!existsSync(join(lib, file))) throw new BenchSkipped('the voice app is not built (run `pnpm -C air/apps/voice run build`)')
  }
  const home = voiceHome()
  const workspace = voiceWorkspace()
  assertWorkspaceOutsideHome(workspace, home)

  const wakeClips = ensureCorpus(log).filter(clip => clip.kind === 'wake')
  const operatorClips = wakeClips.filter(clip => isSafeOperatorCommand(clip.command))
  const agentClips = wakeClips.filter(clip => clip.command === AGENT_COMMAND)
  const passes = ctx.quick ? 1 : 2
  const operatorPlan = ctx.quick ? operatorClips.slice(0, 3) : operatorClips

  const records: MetricsRecord[] = []
  const clock = (): number => performance.now()
  const player = new RecordingPlayer()
  const speaker = new Speaker(nodeSpawn, undefined, player, { command: 'node', args: [join(lib, 'tts-worker.cjs'), modelDir('tts-en'), SENSEVOICE_PACKAGE_JSON] })
  const listener = new Listener({ command: 'node', args: [join(lib, 'listener-worker.cjs'), modelRoot(), SENSEVOICE_PACKAGE_JSON, join(lib, 'keywords.txt')] })
  const errors: string[] = []
  listener.on('error', (error: Error) => errors.push(error.message))
  const agent = new AgentBridge({ dshHome: home, cwd: workspace })
  const dry: ExecLike = () => Promise.resolve()
  const controller = new VoiceController({
    listener,
    speaker,
    agent,
    runOperator: intent => runOperatorIntent(intent, dry),
    onState: () => undefined,
    metrics: new MetricsRecorder({
      now: clock,
      sink: (record) => {
        if (record.kind === 'turn') records.push(record)
      },
    }),
  })
  void controller

  const sampler = new ProcessSampler(process.pid)
  sampler.start()
  const ready = new Promise<void>((resolve) => { listener.once('ready', () => { resolve() }) })
  listener.start()
  speaker.warm()
  await ready
  await speaker.speak('Warm up. The first sentence loads the voice.')
  log('listener and speaker ready')

  /** Stream a clip in real time, then silence, and wait for the controller to finish its turn. */
  async function turn(clip: Clip, waitMs: number): Promise<MetricsRecord | undefined> {
    const before = records.length
    const pcm = readWav(clip.path)
    const padded = new Float32Array(pcm.samples.length + 16_000 * 2)
    padded.set(pcm.samples)
    const startedAt = performance.now()
    for (let at = 0, frame = 0; at + 1600 <= padded.length; at += 1600, frame++) {
      listener.push(padded.subarray(at, at + 1600))
      const due = startedAt + (frame + 1) * 100
      await sleep(Math.max(0, due - performance.now()))
    }
    const deadline = performance.now() + waitMs
    while (records.length === before && performance.now() < deadline) await sleep(50)
    await sleep(400)
    return records.length > before ? records[before] : undefined
  }

  const rows: Row[] = []
  const operatorTurns = operatorPlan.flatMap(clip => Array.from({ length: passes }, () => clip))
  for (const [index, clip] of operatorTurns.entries()) {
    const record = await turn(clip, 15_000)
    rows.push({ kind: 'operator', cold: false, clip: clip.id, voice: clip.voice, record })
    if (index % 10 === 9) log(`operator turns ${index + 1}/${operatorTurns.length}`)
  }

  // The agent: the first turn also starts the dsh runtime and is reported on its own.
  const repeated = agentClips.flatMap(clip => Array.from({ length: passes }, () => clip))
  const agentPlan = agentClips.length > 0 ? [agentClips[0] as Clip, ...repeated] : []
  const agentPlanned = ctx.quick ? agentPlan.slice(0, 2) : agentPlan
  for (const [index, clip] of agentPlanned.entries()) {
    const record = await turn(clip, 240_000)
    rows.push({ kind: 'agent', cold: index === 0, clip: clip.id, voice: clip.voice, record })
    log(`agent turn ${index + 1}/${agentPlanned.length}${index === 0 ? ' (cold)' : ''}`)
  }

  const ticks = roleTicks(sampler.stop())
  await Promise.all([listener.stop(), speaker.dispose(), agent.dispose()])

  const dir = runDir(ctx, 'e2e')
  const span = (record: MetricsRecord | undefined, name: string): number | undefined => record?.spans[name]
  writeCsv(join(dir, 'data.csv'),
    ['kind', 'cold', 'voice', 'clip', 'completed', 'outcome', 'path', 'stt_ms', 'wake_to_ack_ms', 'speech_end_to_ack_ms', 'operator_ms', 'agent_first_event_ms', 'agent_turn_ms', 'tts_first_audio_ms', 'e2e_ms', 'prompt_tokens', 'output_tokens'],
    rows.map(row => [row.kind, row.cold, row.voice, row.clip, row.record !== undefined, row.record?.labels['outcome'], row.record?.labels['path'],
      span(row.record, 'stt'), span(row.record, 'wake_to_ack'), span(row.record, 'speech_end_to_ack'), span(row.record, 'operator'),
      span(row.record, 'agent_first_event'), span(row.record, 'agent_turn'), span(row.record, 'tts_first_audio'), span(row.record, 'e2e'),
      row.record?.counters['prompt_tokens'], row.record?.counters['output_tokens']]))
  writeCsv(join(dir, 'resources.csv'), ['t_unix_ms', 'role', 'cpu_percent_of_one_core', 'rss_mib', 'processes'], ticks.map(tick => [tick.t, tick.role, tick.cpuPercent, tick.rssMiB, tick.processes]))
  await writeManifest(dir, 'e2e', rows.length, {
    operatorTurns: operatorTurns.length,
    operatorClips: operatorPlan.length,
    passesPerClip: passes,
    agentTurns: agentPlanned.length,
    agentCommand: AGENT_COMMAND,
    route: 'local',
    exec: 'dry-run (nothing launched)',
    player: 'recording (no sound)',
    vadTailMs: VAD_TAIL_MS,
    listenerErrors: errors.length,
  }, ['qwen3-8b-32k'])

  // A clip counts for its table only when the controller took the path it was meant for;
  // a mis-heard command that fell through to the agent is counted below instead.
  const wantedPath: Record<Row['kind'], string> = { operator: 'operator', agent: 'agent' }
  const done = (kind: Row['kind'], cold: boolean): MetricsRecord[] => rows.filter(row => row.kind === kind && row.cold === cold && row.record?.labels['path'] === wantedPath[kind]).flatMap(row => row.record === undefined ? [] : [row.record])
  const values = (records_: MetricsRecord[], name: string): number[] => records_.flatMap(record => record.spans[name] ?? [])
  const reply = (records_: MetricsRecord[]): number[] => records_.flatMap(record => record.spans['e2e'] !== undefined && record.spans['tts_first_audio'] !== undefined ? [record.spans['e2e'] - record.spans['tts_first_audio']] : [])
  const withTail = (records_: MetricsRecord[]): number[] => values(records_, 'e2e').map(value => value + VAD_TAIL_MS)
  const operator = done('operator', false)
  const agentWarm = done('agent', false)
  const agentCold = done('agent', true)
  const missed = rows.filter(row => row.record === undefined).length
  const rerouted = rows.filter(row => row.record !== undefined && row.record.labels['path'] !== wantedPath[row.kind]).length
  return {
    bench: 'e2e',
    dir: repoRelative(dir),
    n: rows.length,
    tables: [
      statsTable('Operator commands, speech end to first audio (ms)', 'span', [
        ['speech end to first audio (e2e)', values(operator, 'e2e')],
        ['  speech end to reply text ready', reply(operator)],
        ['  reply ready to first audio (Kokoro first sentence)', values(operator, 'tts_first_audio')],
        ['  recogniser decode (stt)', values(operator, 'stt')],
        ['  running the intent (dry run)', values(operator, 'operator')],
        ['speech end to wake cue dispatched', values(operator, 'speech_end_to_ack')],
        ['e2e plus the 350 ms VAD tail', withTail(operator)],
      ]),
      statsTable('Agent command (local route), speech end to first audio (ms), warm turns', 'span', [
        ['speech end to first audio (e2e)', values(agentWarm, 'e2e')],
        ['  agent turn, command to reply', values(agentWarm, 'agent_turn')],
        ['  agent first event', values(agentWarm, 'agent_first_event')],
        ['  reply ready to first audio', values(agentWarm, 'tts_first_audio')],
        ['e2e plus the 350 ms VAD tail', withTail(agentWarm)],
      ]),
      { title: 'Agent command, cold first turn (starts the dsh runtime)', columns: ['e2e (ms)', 'agent turn (ms)', 'first event (ms)', 'prompt tokens', 'output tokens'], rows: agentCold.map(record => [record.spans['e2e'] ?? '-', record.spans['agent_turn'] ?? '-', record.spans['agent_first_event'] ?? '-', record.counters['prompt_tokens'] ?? '-', record.counters['output_tokens'] ?? '-']) },
      resourceTable('CPU and memory of the benchmark process tree during the run', ticks),
    ],
    notes: [
      `${operatorTurns.length} operator turns (${operatorPlan.length} clips x ${passes} passes) and ${agentPlanned.length} agent turns attempted; ${missed} produced no turn record (not woken or timed out) and ${rerouted} took a different path than intended (the command was mis-heard) and are left out of the tables, though they stay in data.csv.`,
      'The wake and command arrive together in text-wake mode, so the cue (beep) is dispatched after the transcript is decoded; "speech end to wake cue" shows that.',
      'First audio is the moment the first Kokoro WAV is handed to the player; the Electron renderer adds a few milliseconds to decode and start it, and the audio device adds its own buffer. The numbers are from synthetic speech played to the microphone path in software, not a person.',
      `Roles in the resource table: host is this process (the Electron main process in the app: controller, listener parent, speaker); listener and tts are the worker processes; dsh-runtime is the agent runtime, present once the first agent turn starts it. CPU is percent of one core (the machine has ${cpus().length} logical cores).`,
      ...errors.length > 0 ? [`Listener reported ${errors.length} error event(s).`] : [],
    ],
  }
}

if (isMain(import.meta.url)) {
  const result = await run(contextFromArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
