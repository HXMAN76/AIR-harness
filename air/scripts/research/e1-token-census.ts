/**
 * E1, prompt-token census (deterministic capture, Windows and Linux).
 *
 * Composes a Web profile with the AIR bundle under a throwaway DSH_HOME, points the local `ollama` route at a recording
 * proxy on 127.0.0.1, and for each agent preset (`standard` from upstream, `air`, `air-lean`) boots the Web host, creates
 * one Session through the public `session/create` Remote with that preset, and sends one fixed prompt through
 * `session/prompt`. The proxy saves the exact request body the harness sends and answers with a canned two-token reply,
 * so no model runs during capture. Each preset is captured several times, each time in a fresh host process and Session,
 * and every body is hashed.
 *
 * Counting: (a) each captured body is replayed to Ollama's `/v1/chat/completions` with `stream: false` and
 * `max_tokens: 1`, and `usage.prompt_tokens` (Ollama's `prompt_eval_count`) is recorded, plus two variants of the first
 * capture per preset (tools removed; last user message only) to split tools from the rest by difference; (b) the
 * harness's own fixed heuristic (4 characters per token plus framing, `dsh-token-meter`), which is what compaction
 * compares against its threshold. No offline Qwen tokenizer is installed in this repository, so (b) is not a tokenizer.
 *
 * Usage: pnpm -C air exec tsx scripts/research/e1-token-census.ts [--captures 3] [--no-replay] [--presets standard,air,air-lean]
 * Environment: AIR_E1_OLLAMA (default http://127.0.0.1:11434), AIR_E1_MODEL (default qwen3-8b-32k), AIR_E1_SECONDS (boot
 * and capture timeout per capture, default 180).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LAUNCHER_PROBLEM } from '../launcher-problems.ts'
import { baseManifest, repoRoot, runDirectory, toCsv, writeJson, type Cell } from './manifest.ts'

/** Fixed first message of every capture. */
export const PROMPT = 'Reply OK.'
/** Characters per token and framing of the harness heuristic (packages/llm/token-meter/src/estimate.ts). */
export const HEURISTIC = { charsPerToken: 4, blockOverhead: 4, roleOverhead: 4 } as const

const ollamaBase = process.env['AIR_E1_OLLAMA'] ?? 'http://127.0.0.1:11434'
const model = process.env['AIR_E1_MODEL'] ?? 'qwen3-8b-32k'
const timeoutMs = Number(process.env['AIR_E1_SECONDS'] ?? '180') * 1000
const profile = 'air-e1'
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]

// ---------------------------------------------------------------------------------------------------------------------
// Request analysis (pure; covered by tests/e1-token-census.spec.ts)

/** One tool entry of an OpenAI-style chat request. */
interface WireTool {
  readonly type?: string
  readonly function?: { readonly name?: string; readonly description?: string; readonly parameters?: unknown }
}
/** One message of an OpenAI-style chat request. */
interface WireMessage { readonly role: string; readonly content?: unknown }
/** The parts of a chat request this script reads. */
export interface WireBody {
  readonly model?: string
  readonly messages: readonly WireMessage[]
  readonly tools?: readonly WireTool[]
  readonly [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow a parsed JSON value to a chat request body.
 * @param value - parsed request JSON.
 * @returns the body, or undefined when it has no messages array.
 */
export function asWireBody(value: unknown): WireBody | undefined {
  if (!isRecord(value) || !Array.isArray(value['messages'])) return undefined
  const messages = value['messages'].filter(isRecord).map(message => ({ ...message, role: String(message['role']) }))
  const tools = Array.isArray(value['tools']) ? value['tools'].filter(isRecord) : undefined
  return { ...value, messages, ...(tools === undefined ? {} : { tools }) }
}

/** Text of one message's content, whether a string or a list of text parts. */
export function messageText(message: WireMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content === undefined || content === null ? '' : JSON.stringify(content)
  return content.map(part => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : JSON.stringify(part))).join('')
}

/** Size of one tool schema as sent. */
export interface ToolSize {
  readonly name: string
  readonly schemaChars: number
  readonly descriptionChars: number
  readonly parametersChars: number
}

/** Character census of one request body. */
export interface Census {
  readonly bodyChars: number
  readonly messageCount: number
  readonly toolCount: number
  readonly toolNames: readonly string[]
  readonly tools: readonly ToolSize[]
  /** JSON length of the whole `tools` array. */
  readonly toolsChars: number
  /** Text of all system (or developer) role messages. */
  readonly systemChars: number
  /** Text of all user role messages: the typed prompt plus the context messages the harness injects. */
  readonly userChars: number
  /** Per user message, its kind and length, in request order. */
  readonly userMessages: readonly { readonly kind: UserMessageKind; readonly chars: number }[]
  /** Text of the user message equal to the typed prompt. */
  readonly promptChars: number
  /** Runtime-context message (working directory, file and approval policy, checkout, Web GUI URL). */
  readonly runtimeContextChars: number
  /** Time-context message (sampled time and time zone). */
  readonly timeContextChars: number
  /** Skill catalog message (the injected `<available_skills>` reminder). */
  readonly skillCatalogChars: number
  /** Every other injected user message, such as instruction files; 0 in an empty workspace. */
  readonly instructionChars: number
  /** Harness heuristic: system prompt tokens (text / 4 + role framing). */
  readonly heuristicSystemTokens: number
  /** Harness heuristic over the OpenAI `tools` JSON; the harness prices its own tool envelope, which is close but not equal. */
  readonly heuristicToolsTokens: number
  /** Harness heuristic: non-system messages, each as one text block plus role framing. */
  readonly heuristicMessageTokens: number
}

const ceilDiv = (chars: number): number => Math.ceil(chars / HEURISTIC.charsPerToken)

/** Kind of one user role message in the first request. */
export type UserMessageKind = 'prompt' | 'runtime-context' | 'time-context' | 'skill-catalog' | 'instructions'

/**
 * Classify one user message by the markers the harness writes at dsh-v0.2.1-rc.2.
 * @param text - message text.
 * @param prompt - the typed prompt.
 * @returns the kind; anything unrecognized counts as `instructions` (injected instruction files and other context).
 */
export function classifyUserMessage(text: string, prompt: string): UserMessageKind {
  if (text === prompt) return 'prompt'
  if (text.startsWith('Current runtime context')) return 'runtime-context'
  if (text.startsWith('Time sampled while preparing')) return 'time-context'
  if (text.includes('<available_skills>')) return 'skill-catalog'
  return 'instructions'
}

/**
 * Measure one request body by part.
 * @param raw - request body text exactly as sent.
 * @param body - the parsed body.
 * @returns the character census and the heuristic token estimates.
 */
export function census(raw: string, body: WireBody): Census {
  const system = body.messages.filter(message => message.role === 'system' || message.role === 'developer')
  const users = body.messages.filter(message => message.role === 'user')
  const others = body.messages.filter(message => message.role !== 'system' && message.role !== 'developer')
  const systemText = system.map(messageText).join('')
  const userTexts = users.map(messageText)
  const tools = body.tools ?? []
  const toolSizes = tools.map(tool => ({
    name: tool.function?.name ?? '(unnamed)',
    schemaChars: JSON.stringify(tool).length,
    descriptionChars: tool.function?.description?.length ?? 0,
    parametersChars: tool.function?.parameters === undefined ? 0 : JSON.stringify(tool.function.parameters).length,
  }))
  const userMessages = userTexts.map(text => ({ kind: classifyUserMessage(text, PROMPT), chars: text.length }))
  const charsOf = (kind: UserMessageKind): number =>
    userMessages.filter(item => item.kind === kind).reduce((sum, item) => sum + item.chars, 0)
  const toolsChars = tools.length === 0 ? 0 : JSON.stringify(tools).length
  return {
    bodyChars: raw.length,
    messageCount: body.messages.length,
    toolCount: tools.length,
    toolNames: toolSizes.map(tool => tool.name),
    tools: toolSizes,
    toolsChars,
    systemChars: systemText.length,
    userChars: userTexts.reduce((sum, text) => sum + text.length, 0),
    userMessages,
    promptChars: charsOf('prompt'),
    runtimeContextChars: charsOf('runtime-context'),
    timeContextChars: charsOf('time-context'),
    skillCatalogChars: charsOf('skill-catalog'),
    instructionChars: charsOf('instructions'),
    heuristicSystemTokens: systemText.length === 0 ? 0 : ceilDiv(systemText.length) + HEURISTIC.roleOverhead,
    heuristicToolsTokens: toolsChars === 0 ? 0 : ceilDiv(toolsChars) + HEURISTIC.blockOverhead,
    heuristicMessageTokens: others.reduce(
      (sum, message) => sum + ceilDiv(messageText(message).length) + HEURISTIC.blockOverhead + HEURISTIC.roleOverhead,
      0,
    ),
  }
}

/** SHA-256 of a text, hex. */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Text that changes on every capture by design: the sampled turn time and the Web host's ephemeral port. */
export const DYNAMIC_TEXT: readonly (readonly [RegExp, string])[] = [
  [/(Time sampled while preparing turn \d+, step \d+: )[^\\"]+/gu, '$1<TIME>'],
  [/(Web GUI URL: \\"http:\/\/127\.0\.0\.1:)\d+/gu, '$1<PORT>'],
]

/**
 * Replace run-specific strings (temporary paths, Session ids) by placeholders, so bodies from different runs or
 * machines can be compared. Both slash forms and JSON-escaped backslashes are replaced.
 * @param raw - request body text.
 * @param replacements - literal value to placeholder.
 * @returns the normalized text.
 */
export function normalize(raw: string, replacements: Readonly<Record<string, string>>): string {
  let text = raw
  for (const [pattern, placeholder] of DYNAMIC_TEXT) text = text.replace(pattern, placeholder)
  const entries = Object.entries(replacements).filter(([value]) => value !== '').sort(([a], [b]) => b.length - a.length)
  for (const [value, placeholder] of entries) {
    const forms = new Set([value, value.replaceAll('\\', '/'), value.replaceAll('\\', '\\\\'), JSON.stringify(value).slice(1, -1)])
    for (const form of forms) text = text.split(form).join(placeholder)
  }
  return text
}

// ---------------------------------------------------------------------------------------------------------------------
// Recording proxy

/** One request the proxy received. */
interface Recorded { readonly at: string; readonly method: string; readonly url: string; readonly body: string }

/** Canned reply in OpenAI chat format, streamed or not, so the harness finishes its turn without a model. */
function cannedReply(res: ServerResponse, stream: boolean, modelId: string): void {
  const base = { id: 'chatcmpl-e1', created: 0, model: modelId }
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      ...base, object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const chunk = (value: unknown): void => { res.write(`data: ${JSON.stringify(value)}\n\n`) }
  chunk({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })
  chunk({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  chunk({ ...base, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  res.end('data: [DONE]\n\n')
}

/** Start the recording proxy; `/v1/models` and other GETs are forwarded to Ollama unchanged. */
async function startProxy(): Promise<{ port: number; recorded: Recorded[]; close: () => Promise<void> }> {
  const recorded: Recorded[] = []
  const target = new URL(ollamaBase)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const url = req.url ?? '/'
      if (req.method === 'POST' && url.endsWith('/chat/completions')) {
        recorded.push({ at: new Date().toISOString(), method: req.method, url, body })
        let stream = false
        try {
          const parsed: unknown = JSON.parse(body)
          stream = isRecord(parsed) && parsed['stream'] === true
        } catch { stream = false }
        cannedReply(res, stream, model)
        return
      }
      // Anything else (model listing, version probes) goes to Ollama as is.
      const headers = { ...req.headers, host: target.host }
      const forwardOptions = { hostname: target.hostname, port: target.port, path: url, method: req.method, headers }
      const forward = httpRequest(forwardOptions, (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers)
        upstream.pipe(res)
      })
      forward.on('error', () => { res.writeHead(502); res.end() })
      forward.end(body)
    })
  })
  await new Promise<void>((resolveListen) => { server.listen(0, '127.0.0.1', resolveListen) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { port, recorded, close: () => new Promise((resolveClose) => { server.close(() => { resolveClose() }) }) }
}

// ---------------------------------------------------------------------------------------------------------------------
// Harness driving

function fail(message: string, detail = ''): never {
  console.error(`e1: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

function dsh(env: NodeJS.ProcessEnv, args: readonly string[]): { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) fail(`dsh ${args.join(' ')} exited ${String(result.status)}`, result.stderr)
  return { stdout: result.stdout, stderr: result.stderr }
}

/** Compose the profile once: Web template, AIR bundle, the Ollama route pointed at the proxy, preset-by-model off. */
function composeProfile(env: NodeJS.ProcessEnv, home: string, proxyPort: number): string {
  dsh(env, ['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
  dsh(env, ['plugin', '--profile', profile, 'add', join(repoRoot, 'air', 'bundles', 'air')])
  const route = readFileSync(join(repoRoot, 'air', 'examples', 'ollama.profile.cordis.patch.yml'), 'utf8')
  if (!route.includes('127.0.0.1:11434')) fail('the Ollama example no longer names 127.0.0.1:11434; update this script')
  const patch = `${route.replaceAll('127.0.0.1:11434', `127.0.0.1:${proxyPort}`)}
# E1: the preset comes from session/create, so the by-model pick is turned off.
- id: air-preset-by-model
  disabled: true
`
  writeFileSync(join(home, 'profiles', profile, 'cordis.patch.yml'), patch)
  writeFileSync(join(home, '.env'), 'OLLAMA_API_KEY=ollama\n')
  const dump = dsh(env, ['--profile', profile, '--dump-config'])
  if (LAUNCHER_PROBLEM.test(dump.stderr)) fail('composition problems:', dump.stderr)
  if (!dump.stdout.includes('patched by @air/dsh-air-bundle')) fail('AIR bundle layer missing from the composed tree')
  return dump.stdout
}

/** Minimal HTTP client for the owned loopback host (no proxy dispatcher, no keep-alive). */
function loopback(url: URL, options: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: IncomingMessage['headers']; text: string }> {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest(url, { method: options.method, headers: options.headers, agent: false }, (res) => {
      res.setEncoding('utf8')
      let text = ''
      res.on('data', (chunk: string) => { text += chunk })
      res.once('end', () => { resolveRequest({ status: res.statusCode ?? 0, headers: res.headers, text }) })
      res.once('error', reject)
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => { setTimeout(resolveSleep, ms) })

/** Result of one capture. */
interface Capture {
  readonly preset: string
  readonly index: number
  readonly sessionId: string
  readonly requests: readonly Recorded[]
  readonly stderr: string
}

type Proxy = Awaited<ReturnType<typeof startProxy>>

/**
 * Boot the Web host, create one Session with the preset, send the prompt, and wait for the first model request.
 * @returns the requests recorded during this capture.
 */
async function captureOnce(env: NodeJS.ProcessEnv, workspace: string, proxy: Proxy, preset: string, index: number): Promise<Capture> {
  const before = proxy.recorded.length
  const child = spawn(process.execPath, [...launcher, '--profile', profile, '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: repoRoot, env })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString() })
  const deadline = Date.now() + timeoutMs
  try {
    let url: string | undefined
    while (url === undefined) {
      url = /dsh web: (http:\/\/\S+)/u.exec(out)?.[1]
      if (child.exitCode !== null) fail(`host exited early with code ${String(child.exitCode)}`, err)
      if (Date.now() > deadline) fail('no ready line from the Web host', err)
      if (url === undefined) await sleep(250)
    }
    if (LAUNCHER_PROBLEM.test(err)) fail('boot problems:', err)
    const auth = await loopback(new URL(url), { method: 'GET' })
    const cookie = auth.headers['set-cookie']?.[0]?.split(';', 1)[0]
    if (cookie === undefined) fail('the Web host issued no authentication cookie')
    const origin = new URL(url).origin
    const rpc = async (method: string, args: Record<string, unknown>): Promise<unknown> => {
      const rpcId = randomUUID()
      const response = await loopback(new URL(`/api/${method}`, origin), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
      })
      if (response.status !== 200) fail(`${method} returned HTTP ${String(response.status)}`, response.text)
      const envelope: unknown = JSON.parse(response.text)
      const result = isRecord(envelope) ? envelope['result'] : undefined
      if (!isRecord(result) || result['ok'] !== true) fail(`${method} failed`, response.text)
      return result['value']
    }
    const created = await rpc('session/create', { request: { cwd: workspace, agentPreset: preset } })
    if (!isRecord(created) || typeof created['sessionId'] !== 'string') fail('session/create returned no sessionId', JSON.stringify(created))
    if (created['agentPreset'] !== preset) fail(`session/create ran preset ${String(created['agentPreset'])}, not ${preset}`)
    const sessionId = created['sessionId']
    await rpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPT }] } })
    while (proxy.recorded.length === before) {
      if (child.exitCode !== null) fail('host exited before its first model request', err)
      if (Date.now() > deadline) fail('no model request reached the proxy', err)
      await sleep(100)
    }
    // Let follow-up requests of the same turn (a title request, for example) arrive so they are recorded, not mixed
    // into the next capture.
    await sleep(3000)
    return { preset, index, sessionId, requests: proxy.recorded.slice(before), stderr: err }
  } finally {
    child.kill()
    await new Promise<void>((resolveExit) => { if (child.exitCode !== null) resolveExit(); else child.once('exit', () => { resolveExit() }) })
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ollama counting

async function ollamaJson(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, ollamaBase), body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path}: HTTP ${String(response.status)} ${await response.text()}`)
  return response.json()
}

/**
 * Replay a body to Ollama with one output token and read the prompt token count.
 * @param body - chat request body, possibly a variant.
 * @returns Ollama's `usage.prompt_tokens` (its `prompt_eval_count`).
 */
async function promptTokens(body: WireBody): Promise<number> {
  const { stream_options: _streamOptions, max_completion_tokens: _maxCompletion, ...rest } = body
  const replay = { ...rest, stream: false, max_tokens: 1 }
  const value = await ollamaJson('/v1/chat/completions', replay)
  const usage = isRecord(value) ? value['usage'] : undefined
  const count = isRecord(usage) ? usage['prompt_tokens'] : undefined
  if (typeof count !== 'number') throw new Error(`no usage.prompt_tokens in ${JSON.stringify(value).slice(0, 400)}`)
  return count
}

/** Ollama facts for the manifest: version, model digest from the tag list, and the model's parameters from /api/show. */
async function ollamaFacts(): Promise<Record<string, unknown>> {
  const versionValue = await ollamaJson('/api/version')
  const tags = await ollamaJson('/api/tags')
  const entries = isRecord(tags) && Array.isArray(tags['models']) ? tags['models'].filter(isRecord) : []
  const entry = entries.find(candidate => candidate['name'] === model || candidate['name'] === `${model}:latest`)
  const show = await ollamaJson('/api/show', { model })
  return {
    baseUrl: ollamaBase,
    version: isRecord(versionValue) ? versionValue['version'] : undefined,
    model,
    digest: entry?.['digest'],
    details: isRecord(show) ? show['details'] : undefined,
    parameters: isRecord(show) ? show['parameters'] : undefined,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Main

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name)
  return at < 0 ? undefined : argv[at + 1]
}

/** The first recorded request of a capture that carries tools, else the first request: the agent's first model call. */
function firstAgentRequest(capture: Capture): { record: Recorded; body: WireBody } {
  const parsed = capture.requests.map((record) => {
    let value: unknown
    try { value = JSON.parse(record.body) } catch { value = undefined }
    return { record, body: asWireBody(value) }
  }).filter((item): item is { record: Recorded; body: WireBody } => item.body !== undefined)
  const pick = parsed.find(item => (item.body.tools?.length ?? 0) > 0) ?? parsed[0]
  if (pick === undefined) fail(`capture ${capture.preset}#${String(capture.index)} recorded no chat request`)
  return pick
}

async function main(argv: readonly string[]): Promise<void> {
  const startedAt = new Date().toISOString()
  const captures = Number(flag(argv, '--captures') ?? '3')
  const presets = (flag(argv, '--presets') ?? 'standard,air,air-lean').split(',').filter(preset => preset !== '')
  const replay = !argv.includes('--no-replay')
  const dir = runDirectory('e1', startedAt)
  const rawDir = join(dir, 'requests')
  mkdirSync(rawDir, { recursive: true })

  let ollama: Record<string, unknown> | undefined
  if (replay) {
    try { ollama = await ollamaFacts() } catch (error) { fail(`Ollama at ${ollamaBase} is not usable for replay; pass --no-replay to capture only`, String(error)) }
  }

  const home = mkdtempSync(join(tmpdir(), 'air-e1-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'air-e1-workspace-'))
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, '.agents'), DSH_TELEMETRY_DISABLED: '1', NODE_NO_WARNINGS: '1' }
  const proxy = await startProxy()
  console.log(`e1: home ${home}, workspace ${workspace}, proxy port ${String(proxy.port)}`)
  const composed = composeProfile(env, home, proxy.port)
  writeFileSync(join(dir, 'composed-profile.txt'), normalize(composed, { [home]: '<DSH_HOME>', [workspace]: '<WORKSPACE>' }))

  const rows: Record<string, Cell>[] = []
  const toolRows: Record<string, Cell>[] = []
  const summaries: Record<string, unknown>[] = []
  try {
    for (const preset of presets) {
      for (let index = 1; index <= captures; index += 1) {
        console.log(`e1: capturing ${preset} #${String(index)}`)
        const capture = await captureOnce(env, workspace, proxy, preset, index)
        const { record, body } = firstAgentRequest(capture)
        const replacements = { [home]: '<DSH_HOME>', [workspace]: '<WORKSPACE>', [capture.sessionId]: '<SESSION_ID>', [repoRoot]: '<CHECKOUT>' }
        const stem = `${preset}-${String(index)}`
        writeFileSync(join(rawDir, `${stem}.json`), record.body)
        writeFileSync(join(rawDir, `${stem}.normalized.json`), normalize(record.body, replacements))
        writeJson(join(rawDir, `${stem}.all-requests.json`), capture.requests.map(item => ({ at: item.at, url: item.url, bodySha256: sha256(item.body), bodyChars: item.body.length })))
        const measured = census(record.body, body)
        let ollamaPromptTokens: number | undefined
        let ollamaNoToolsTokens: number | undefined
        let ollamaPromptOnlyTokens: number | undefined
        if (replay) {
          ollamaPromptTokens = await promptTokens(body)
          if (index === 1) {
            const { tools: _tools, tool_choice: _choice, ...withoutTools } = body
            ollamaNoToolsTokens = await promptTokens(withoutTools)
            const last = body.messages.filter(message => message.role === 'user').at(-1)
            ollamaPromptOnlyTokens = await promptTokens({ model: body.model ?? model, messages: last === undefined ? [] : [last] })
          }
        }
        const row: Record<string, Cell> = {
          preset, capture: index, sessionRequests: capture.requests.length,
          bodySha256: sha256(record.body), normalizedSha256: sha256(normalize(record.body, replacements)),
          bodyChars: measured.bodyChars, messageCount: measured.messageCount, toolCount: measured.toolCount,
          toolsChars: measured.toolsChars, systemChars: measured.systemChars, userChars: measured.userChars,
          promptChars: measured.promptChars, runtimeContextChars: measured.runtimeContextChars,
          timeContextChars: measured.timeContextChars, skillCatalogChars: measured.skillCatalogChars,
          instructionChars: measured.instructionChars,
          ollamaPromptTokens, ollamaNoToolsTokens, ollamaPromptOnlyTokens,
          ollamaToolsTokensByDifference: ollamaPromptTokens !== undefined && ollamaNoToolsTokens !== undefined
            ? ollamaPromptTokens - ollamaNoToolsTokens
            : undefined,
          heuristicSystemTokens: measured.heuristicSystemTokens, heuristicToolsTokens: measured.heuristicToolsTokens,
          heuristicMessageTokens: measured.heuristicMessageTokens,
          heuristicTotalTokens: measured.heuristicSystemTokens + measured.heuristicToolsTokens + measured.heuristicMessageTokens,
          maxTokens: typeof body['max_tokens'] === 'number' ? body['max_tokens'] : undefined,
          reasoningEffort: typeof body['reasoning_effort'] === 'string' ? body['reasoning_effort'] : undefined,
        }
        rows.push(row)
        if (index === 1) {
          for (const tool of measured.tools) toolRows.push({ preset, ...tool })
          summaries.push({ preset, toolNames: measured.toolNames })
        }
        console.log(`e1: ${preset} #${String(index)}: ${String(measured.toolCount)} tools, ${String(measured.bodyChars)} chars, Ollama ${String(ollamaPromptTokens ?? '-')} prompt tokens`)
      }
    }
  } finally {
    await proxy.close()
  }

  const columns = Object.keys(rows[0] ?? {})
  writeFileSync(join(dir, 'census.csv'), toCsv(columns, rows))
  writeFileSync(join(dir, 'tools.csv'), toCsv(['preset', 'name', 'schemaChars', 'descriptionChars', 'parametersChars'], toolRows))
  const determinism = presets.map((preset) => {
    const mine = rows.filter(row => row['preset'] === preset)
    return {
      preset,
      captures: mine.length,
      identicalBodies: new Set(mine.map(row => row['bodySha256'])).size === 1,
      identicalNormalizedBodies: new Set(mine.map(row => row['normalizedSha256'])).size === 1,
      identicalOllamaCounts: new Set(mine.map(row => row['ollamaPromptTokens'])).size === 1,
    }
  })
  writeJson(join(dir, 'manifest.json'), {
    ...baseManifest('e1-token-census', startedAt),
    finishedAt: new Date().toISOString(),
    prompt: PROMPT,
    presets,
    capturesPerPreset: captures,
    profile: { template: 'web', bundle: 'air/bundles/air', route: 'air/examples/ollama.profile.cordis.patch.yml (baseURL pointed at the proxy)', disabledRows: ['air-preset-by-model'] },
    workspace: 'empty temporary directory, replaced by <WORKSPACE> in normalized bodies',
    capture: 'recording proxy on 127.0.0.1 answers each /chat/completions request with a canned reply; no model ran during capture',
    counting: {
      ollama: replay ? 'replay of each captured body to /v1/chat/completions with stream false and max_tokens 1; usage.prompt_tokens' : 'not run (--no-replay)',
      heuristic: 'packages/llm/token-meter/src/estimate.ts density: ceil(chars / 4) + framing; tools priced over the OpenAI tools JSON',
      offlineTokenizer: 'none installed in this repository; token counts are Ollama-only',
    },
    ollama: ollama ?? null,
    determinism,
    toolNames: summaries,
    files: ['census.csv', 'tools.csv', 'composed-profile.txt', 'requests/'],
  })
  console.log(`e1: wrote ${dir}`)
  console.log(JSON.stringify(determinism))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => { fail('run failed', error instanceof Error ? (error.stack ?? error.message) : String(error)) })
}
