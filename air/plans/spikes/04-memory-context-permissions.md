# Spike 04: memory, desktop context, and permissions

Research spike for three AIR feature families built as out-of-tree plugins under `air/packages/*` on the dsh `0.2.0-rc.1` fork: long-term memory (research.md §5.4, notes/05 §2), desktop context providers (notes/05 §3), and permissions (research.md §5.3). Every API below was read from the current tree; line numbers refer to `packages/...` source files at the time of writing. Machine probes were run read-only on this Fedora 44 / GNOME Shell 50.5 / Wayland host.

## 0. Cross-cutting findings (read these first)

1. **An out-of-tree plugin cannot write an `ignorable: true` session event.** `Session.append` (`packages/core/session/src/index.ts:722`) has the signature
   ```ts
   append<T extends SessionEventType>(type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []): SessionEvent<T>
   ```
   and builds the frozen event from `type`, `seq`, `time`, `data`, and surface metadata only (lines 744-750). The `ignorable?: true` envelope field (`packages/core/session/src/types.ts:511`) is only carried by seeds and by restored records (`packages/session/session-log-deepseek/src/index.ts:85-105`). Reload refuses any type outside `KNOWN_SESSION_EVENT_TYPES` that lacks the marker (`packages/session/session-persistence/src/storage-contract.ts:75`). Consequence: **an AIR plugin that appends any custom event type makes the session unloadable on the next resume, even in the AIR build.** Correction 13's "optional `ignorable: true` audit event" is not implementable without a fork edit (add an `ignorable` option to `append`, carried in `air/UPSTREAM-DELTA.md`).
   **Decision for this plan: AIR declares zero new `SessionEventMap` types.** Structured audit data goes into (a) extra fields on an AIR-declared `MessageSourceMap` entry of an ordinary `user/message` (a known type; unknown source kinds are data, see `packages/core/session/src/surface.ts:172-205`, which never inspects `source.kind`), (b) `output.presentationMeta` on `tool/result`, or (c) AIR-owned files outside the session log (JSONL audit files, git history).
2. **Model-visible inputs follow the time-context pattern.** An `agent/pre-step` waterfall listener calls `next()`, then returns `{ ...decision, messages: [...] }` with one extra `createUserMessage({ content, source })`. The loop logs it as `user/message` with `surfaceOp: 'append'` after `step/start` (asserted in `packages/context/time-context/tests/time-context.e2e.ts:52-60`). That is logged, source-labelled, and append-only, so it never rewrites the reusable prefix.
3. **New synchronous history reads are prohibited.** `Session.eventAt`, `snapshotEvents`, and `ownEvents` are `@deprecated` for new production calls (`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`). AIR state that must survive resume goes in a session projection (`ctx.sessionProjections.register`, `packages/session/session-projection/src/index.ts:233-255`, read with `stateOf(session, key)` at line 319) or is maintained incrementally from `session/event`. time-context and tmux-context still call `eventAt` under a waiver; AIR must not copy that.
4. **Listener order is load order.** Cordis `prepend: true` uses `unshift` (`vendor/cordis/src/events.ts:143`), so the last-loaded prepended listener is outermost. Every AIR waterfall listener must be written order-independent: call `next()` first, then combine.
5. **The Web client already renders unknown context sources.** `ContextInjectionRow` shows a bare source kind as the row label and understands `KnownContextForm = 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall'` (`packages/client/ui-conversation/src/client/contract/context-producer.ts`). AIR context messages need no client plugin to be visible.

## 1. Context injection

### 1.1 Current APIs

**Pre-step waterfall** (`packages/core/agent/src/runtime-types.ts:112-119`, event at line 320):
```ts
export type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }

'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```
`@mode waterfall`, agent-scope filtered. Related emits: `'agent/created'` (line 261, payload `{ agent; source: SessionStartSource; signal? }`, where `SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`), `'agent/disposed'` (270), `'agent/status'` (280, `'idle' | 'running'`), serial `'agent/turn-stopping'` (381). Out-of-band context: `agent.inject(message: UserMessage): void` (line 241) queues for the next pre-step without waking the driver; `agent.inbox.prepend(target: InboxTarget, message)`, `replace(messageId, newMessage): boolean`, `remove(messageId): boolean` (lines 69-84).

**Message sources** (`packages/llm/llm/src/message.ts`):
- `ContextForm` (line 55): `'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall'`.
- `ContextFormed` (line 86): discriminated by `form`; `snapshot` requires `sections: readonly { name: string; text: string }[]`, `notice` requires `summary: string` (bounded by `boundContextSummary`, 120 chars).
- `MessageSourceMap` (line 110): merge-extensible; each producer declares its own `kind`; there is no shared `plugin` kind (the cookbook's `{ kind: 'plugin', plugin }` example in `docs/cookbook/adding-a-tool.md` is stale).
- `createUserMessage<T extends NewUserMessage>(input: T & { readonly id?: never; readonly role?: never }): T & Pick<UserMessage, 'id' | 'role'>` (line 246).

**time-context** (`packages/context/time-context/src/index.ts`):
- Source declaration, lines 14-18: `interface MessageSourceMap { 'time-context': { kind: 'time-context' } & ContextFormed }`.
- `export const inject = ['agents', 'sessionProjections']` (53); Config with `refreshIntervalMs` (56-67).
- A host projection `timeContext` (157-183) folds `user/message` events whose `source.kind === name` to remember the last injection time, so throttling survives resume without scanning history.
- Listener (185-225): `ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => { const decision = await next(); if (decision.kind === 'reject' || signal.aborted) return decision; ... return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text }], source: { kind: name, form: 'snapshot', sections: [{ name, text }] } })] } }, { prepend: true })`. The reading is appended after the claimed user batch.

**tmux-context** (`packages/context/tmux-context/src/index.ts`): same pattern with `@persistenceAttribution` JSDoc on the source (29-37), a `tmuxContext` projection storing the last rendered stable state (230-244), step-1-only reads, change-only injection, and the reading placed before the batch (`messages: [reading, ...decision.messages]`, 264-272). The external read runs through `ctx.get('shell')` and a failed or rejected query is logged as a warning and injects nothing.

**agent-instructions** (`packages/context/agent-instructions/src/index.ts`): `inject = ['sessionProjections']` (33). On every pre-step (315-335) it composes the desired baseline, removes stale pending copies, and splices the context right after the claimed batch (`decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)`). Source `{ kind: 'agent-instructions', form: 'instructions', baseline: true, baselineIdentity, changes }` carries structured extra fields. It re-injects a complete baseline when the visible baseline is gone from `session.surface.nodes` or its identity changed, which is how it survives compaction and resume. Asynchronous updates outside a step go through `agent.inbox.prepend('next-step', desired)` (249).

**Runtime context alternative.** `ctx.systemPrompt.context(context: PromptContext): () => void` (`packages/core/system-prompt/src/index.ts:489`, `PromptContext` at 79: `{ name; order; text: string | ((context: AssembleContext) => string) }`) lets a plugin contribute a line to the loop-owned `runtime-context` snapshot. The loop re-emits the whole joined snapshot as one `user/message` whenever any contributor's text changes (`packages/core/agent-loop/src/runtime-context.ts:114-165`). Use it only for tiny, rarely-changing facts (the approval service does this for its policy sentence, `packages/interaction/user-approval/src/index.ts:162-174`). Desktop readings and recall must not use it: every change re-sends every contributor's text, and the provider callback is synchronous.

### 1.2 Rules AIR must follow

- Declare each AIR source kind in the producing package with `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { ... } }` and an `@persistenceAttribution` note.
- Put structured metadata (memory ids, scores, content hashes, redaction counts, provider id) as extra readonly JSON fields on the source, not in a custom event.
- Keep injection change-only and throttled through a projection that folds the plugin's own `user/message` events (no `eventAt`).
- Frozen content is never rewritten; later changes are new messages ("KV Cache effect: append-only").
- External reads are fail-open with a deadline and never fail the turn.

### 1.3 Templates

**Memory pinned core** (source kind `air-memory-core`, form `snapshot`, extra fields `coreId: string` (content hash), `memoryIds: readonly string[]`, `scope: string`, `budgetTokens: number`):
- Listener on `agent/pre-step`, `step === 1`. Projection `airMemoryCore` folds own `user/message` events to `{ coreId, seq } | null` and clears it when a replacement surface event (compaction) names that seq in `sourceEventSeqs` (copy the `RuntimeContextProjection` rule at `runtime-context.ts:135-144`).
- If the projection holds a visible core, inject nothing (frozen for the session, even if files changed). If none is visible (new session, or compaction removed it), render the core from the store and splice it right after the claimed batch, as agent-instructions does.
- Text is fenced and labelled: `<user-memory kind="notes" trust="...">` ... `</user-memory>` plus one line stating that these are notes, not instructions.
- Mid-session memory changes (from another session or the extraction job) are announced with `agent.inject(createUserMessage({ content, source: { kind: 'air-memory-notice', form: 'notice', summary } }))`; the prefix is never touched.

**Memory auto-recall** (source kind `air-memory-recall`, form `recall`, extra fields `query: string`, `candidates: readonly { id: string; hash: string; bm25: number; cosine: number; fused: number }[]`, `embedder: string | null`, `floor: number`):
- Listener on `agent/pre-step`, `step === 1`, off by default. Take the query from the claimed `messages` with `source.kind === 'user'`.
- Wrap the search in `deadline(signal, config.recallTimeoutMs, 'AIR_MEMORY_RECALL_TIMEOUT')` (`packages/util/timeout/src/index.ts:91`); on timeout or error log a warning and return `decision` unchanged (fail-open, as the MemOS adapter does with its 3,000 ms deadline).
- Skip when the top fused score is under `floor`. Append after the user message. When no embedder answered, record `embedder: null` in the source instead of silently degrading.
- Note: form `recall` is defined as "material lifted out of another session's log". Memory files are partly derived from logs; if that reading is judged wrong, use `snapshot` with one section per memory. Decide in spike S1.

**Desktop reading** (source kind `air-desktop-context`, form `snapshot`, one section per tier, extra fields `provider: string`, `signals: Record<string, 'ok' | 'unsupported' | 'denied' | 'redacted'>`, `redactions: number`, `untrusted: true`):
- Follow tmux-context exactly: step-1-only, change-only against a projection holding the last stable text, `refreshIntervalMs` floor, fail-open query, text first line volatile (`desktop reading (turn N):`), stable block after it.
- Place it before the claimed batch (tmux) so the user's words stay last in the request.

## 2. Tools

### 2.1 Current APIs

- `defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(options: DefineToolOptions<S, O>): ToolDefinition` (`packages/core/tools/src/schema.ts:554`). `DefineToolOptions` (line 483): `name`, `description`, `parameters: S`, `output: { schema: O; render(args, value): ContentBlock[]; presentationMeta?(args, value): JsonValue }`, `deferLoading?: true`, `timeoutMs?`, `isConcurrencySafe?(args)`, `execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<O>>`, `projectContent?`, `finalizeContent?`, `presentCall?(args): ToolCallView | undefined`, `presentResult?(args, result: ToolResult): ToolResultView | undefined`.
- `ctx.tools.register(definition: ToolDefinition): () => void` (`packages/core/tools/src/index.ts:1063`); throws when `output.render` is missing; `run_code` is reserved.
- `ToolResult` (index.ts:301): `{ content: ContentBlock[]; isError: boolean; meta?: JsonValue }`; `meta` is persisted on `tool/result`.
- Views (`packages/core/tools/src/presentation.ts`): `ToolCallView = GenericCallView | TerminalCallView | DiffCallView` (46); `ToolResultView = GenericResultView | TerminalResultView | DiffResultView | SearchResultView | ReadResultView | WebResultView` (140). `GenericCallView = { card: 'generic'; title; kind?; rawInput?; content?; locations? }`.

Card requirements (`docs/cookbook/adding-a-tool.md`): return only the canonical JSON value from `execute`; `render` owns model prose; presenters are pure functions of args and the persisted result (no I/O, no clock); use `presentationMeta` for replayable card facts; honor `exec.signal`. The built-in Web client ignores `presentCall`/`presentResult` and derives cards from raw `tool/call`/`tool/result` plus `result.meta` through the `tool.call.toolview` keyed Client slot; without one, a generic row is shown. PTC mode exposes every registered tool as `await tools.<name>(args)` automatically, so `output.schema` is a programmatic API.

### 2.2 Proposed tools

| Tool | Parameters | Output value | Notes |
|---|---|---|---|
| `memory_search` | `query: string` (required), `scope?: 'user' \| 'project' \| 'all'`, `types?: string[]`, `include_superseded?: boolean`, `limit?: number` | `{ results: { id, type, scope, description, snippet, score, trust, updated, superseded: boolean }[], embedder: string \| null }` | `isConcurrencySafe: () => true`; `presentationMeta` = ids + scores; card `generic` with `kind: 'search'` |
| `memory_read` | `id: string` | `{ id, frontmatter, body }` | Path confinement: resolves only ids in the index |
| `memory_write` | `type`, `description`, `body`, `scope?`, `supersedes?: string` | `{ id, status: 'committed' \| 'quarantined' \| 'rejected', reason? }` | Calls `ctx.approval.request({ agent: exec.agent, toolName, callId: exec.callId, reason })` itself for `feedback` type and for imperative text, the way sandbox escalation does (`packages/sandbox/sandbox/src/escalation.ts`); returns `rejected` on a non-grant |
| `memory_forget` | `id: string`, `mode?: 'soft' \| 'delete'` | `{ id, mode, commit: string }` | Always asks; `presentCall` shows the description |
| `desktop_context` | `signals: string[]` (enum of signal names) | `{ provider, readings: { signal, status, value? }[], redactions }` | Tier 2 signals ask per call; result text is fenced as untrusted |

The approval for `memory_write`/`memory_forget` needs an open turn (`ApprovalService.request` throws otherwise, `packages/interaction/user-approval/src/index.ts:215-223`); tool execution always runs inside one.

## 3. Storage

### 3.1 Current APIs

**node:sqlite** is loaded lazily and synchronously used on the JS thread: `const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path)` (`packages/session-query/session-query-sqlite/src/schema.ts:52-53`). No worker thread is used by either package. Node `v22.23.1` with SQLite `3.51.2` on this host; `CREATE VIRTUAL TABLE t USING fts5(x)` succeeds; Node 22 prints an `ExperimentalWarning` for `node:sqlite` on stderr.

**session-query-sqlite** is the template for a disposable derived index:
- `SESSION_QUERY_SQLITE_SCHEMA_VERSION = 8` (line 8) stored in `PRAGMA user_version`; `SESSION_QUERY_SQLITE_APPLICATION_ID = 0x44534851` (line 11) in `PRAGMA application_id` protects unrelated files.
- `openSearchDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync>` (46): creates the file `0o600` in a `0o700` directory, refuses a foreign `application_id` or unknown tables, and on a version mismatch drops every derived table and resets (`resetDerivedSchema`, 96) instead of migrating.
- FTS5 table: `CREATE VIRTUAL TABLE persisted_docs USING fts5(text, session_id UNINDEXED, ..., tokenize = 'unicode61')` (127). `query.ts` quotes caller text as one FTS5 phrase so query syntax stays inert and caps outer predicates at 14.

**storage-sqlite** (`packages/storage/storage-sqlite/src/schema.ts`) is the template for canonical data: `STORAGE_SQLITE_SCHEMA_VERSION = 1` (20), `openDatabase(path, journalMode)` (60) refuses any non-zero incompatible `user_version` instead of resetting.

**Paths** (`packages/util/home-paths/src/index.ts`): `resolveDshHome(configured?: string, env?): string` (87), `dshHomePath(...segments: string[]): string` (98), `dshCachePath(optionsOrSegment?: { dshHome?: string } | string, ...segments: string[]): string` (108). Precedence: explicit config, `$DSH_HOME`, `~/.dsh`.

**Atomic writes** (`packages/util/atomic-write/src/index.ts`): `writeFileAtomic(filename: string, content: string, options: { mode: number; dirMode?: number }): Promise<void>` (79; `wx` temp sibling then rename; no fsync) and `withFileLock<T>(filename: string, operation: () => Promise<T>, options?: { waitMs?: number }): Promise<T>` (235; `<file>.lock` with PID takeover, default 2 s wait).

### 3.2 Proposed layout

Research note 05 proposed XDG paths; this spike recommends keeping everything under the harness home so `DSH_HOME` isolation, tests, and backup behave like upstream data:

```
$DSH_HOME/air/memory/               # git repo, source of truth (Config: memory.root)
  MEMORY.md                         # index, capped (Config: indexMaxLines, indexMaxBytes)
  user/ feedback/ reference/ episode/
  projects/<workspace-id>/
  .quarantine/                      # candidates, never committed to the main tree
  .air/extraction.jsonl             # auxiliary model requests/responses (audit)
$DSH_HOME/cache/air/memory-index.sqlite   # derived; deletable (dshCachePath('air', ...))
$DSH_HOME/air/permissions/audit.jsonl     # rule-based grants and denials
```

Memory file frontmatter (YAML, parsed with the repo's `yaml` dependency, validated with zod):
```yaml
id: mem_01J...            # branded MemoryId
type: user                # user | feedback | project | reference | episode
scope: user               # user | project:<workspace-id>
description: Prefers neovim for quick edits
created: 2026-09-29T10:00:00Z
updated: 2026-09-29T10:00:00Z
valid_from: 2026-09-29T10:00:00Z
valid_to: null
supersedes: null
superseded_by: null
importance: 3
source: { kind: user-stated, session: <SessionId>, seq: 42 }   # user-stated | user-confirmed | agent-inferred | tool-derived:<tool>
trust: high               # derived from source.kind; never written by the model
last_recalled: null
```
Writes: `withFileLock(<root>/.air/write)` around render, `writeFileAtomic(path, text, { mode: 0o600, dirMode: 0o700 })`, then `git add` + `git commit -m "air-memory: <op> <id> (session <id>)"` through `ctx.subprocess.spawn` with fixed argv (`packages/subprocess/subprocess/src/index.ts:153`; spec fields `argv`, `cwd`, `stdio`, `graceMs`, `signal?`, `env?` in `types.ts:79-106`). Path confinement: ids map to paths inside `root` only; reject `..`, absolute paths, and symlinks (`lstat`).

Index schema (reset-in-place on version change, same guards as session-query-sqlite):
```sql
PRAGMA application_id = 0x41495231;   -- 'AIR1'
PRAGMA user_version = 1;              -- AIR_MEMORY_INDEX_SCHEMA_VERSION
CREATE TABLE memories (id TEXT PRIMARY KEY, path TEXT NOT NULL, scope TEXT NOT NULL, type TEXT NOT NULL,
  description TEXT NOT NULL, trust TEXT NOT NULL, importance INTEGER NOT NULL, updated INTEGER NOT NULL,
  valid_to INTEGER, superseded_by TEXT, last_recalled INTEGER, content_hash TEXT NOT NULL) STRICT;
CREATE VIRTUAL TABLE memories_fts USING fts5(description, body, id UNINDEXED, tokenize = 'unicode61');
CREATE TABLE vectors (id TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL, content_hash TEXT NOT NULL,
  vec BLOB NOT NULL, PRIMARY KEY (id, model)) STRICT;
```
Rebuild compares `content_hash` per file; vectors are re-embedded lazily when `model` or `dim` differs. The vector scan loads `Float32Array` views over the BLOBs and computes cosine in JS; at 256 dimensions and 10,000 memories that is about 10 MB and a few milliseconds per query. `last_recalled` lives only in the index (not rewritten into files on every recall) and is folded back into files by the nightly consolidation, so recall does not create a git commit per read.

## 4. LLM access and embeddings

### 4.1 Current APIs

- `LlmRuntime.stream(options: GenerateOptions): AsyncIterable<StreamChunk>` (`packages/llm/llm/src/index.ts:1135`); adapter failures become terminal `error`/`aborted` finish chunks.
- `LlmRuntime.prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>` (936) binds one adapter registration across header logging and dispatch; it is what the agent loop uses. `resolveCallConfig(config, signal?)` (878) validates `reasoningEffort` against the exact model and throws `UNSUPPORTED_REASONING_EFFORT`; there is no "off" value in the core vocabulary, efforts are adapter-owned ids.
- `GenerateOptions` (`packages/llm/llm/src/types.ts:511`): `provider`, `model`, `reasoningEffort?`, `messages: RequestMessage[]`, `system?`, `tools?`, `toolHistory?`, `temperature?`, `maxTokens?`, `stop?`, `signal?`, `sessionId?`, `purpose?: 'compaction' | 'session-title'` (552; closed, so AIR calls leave it unset).
- Auxiliary-call precedents:
  - `generateSessionTitleWithLlm` (`packages/session/session-title-llm/src/index.ts:238-300`): route from explicit Config `provider`+`model` pair, else the session's logged request route (`resolveRoute`, 181); one-shot `system` + one `createUserMessage`; `deadline(request.signal, config.timeoutMs, code)`; `BlockAssembler` over `ctx.llm.stream(options)`; rejects tool-call blocks. It logs the exact request as a `session/title-llm-request` event, which AIR cannot copy (finding 0.1).
  - auto-review `classifyRisk` (`packages/experimental/auto-review/src/index.ts`, around 616-631): route from the agent's current request header, `temperature: 0`, strict JSON output parsed by a closed protocol, and the prompt deliberately never enters a session log.
- MemOS's DSH adapter (research.md §5.4) calls the same public `ctx.llm` service for summaries; nothing else is needed from the host.

**Recommendation.** `@air/dsh-memory-extract` takes Config `provider?`, `model?` (paired, as session-title-llm validates), `reasoningEffort?` (passed through only when set; the default leaves the adapter default, and the local Ollama route through `llm-pi-ai` has no efforts to switch off), `temperature` (0), `maxOutputTokens`, `timeoutMs`. Without an explicit route it uses the route of the session being extracted (from its logged request header via `session.requestHeader()`, `packages/core/session/src/index.ts:788`). Each request and response is appended to `<memory>/.air/extraction.jsonl`; memory commits cite that line.

### 4.2 Embeddings

There is no embedding API anywhere in the dsh packages (searched `packages/*/*/src` for `embed`/`embedding`). Plan a direct client:

- `POST http://127.0.0.1:11434/api/embed` with `{ model, input: string[], dimensions?, keep_alive? }` returns `{ model, embeddings: number[][], total_duration, load_duration, prompt_eval_count }`.
- Probed on this host: Ollama `0.32.7`; `nomic-embed-text:latest` (137M) installed; 768 dimensions by default; `dimensions: 256` honoured; cold call 6.2 s (model load), warm call about 40-50 ms. nomic-embed-text needs task prefixes (`search_query: ` / `search_document: `); make them Config.
- Fetch policy: the launcher installs one undici global dispatcher (`installProxyFromEnvironment`, `packages/util/http-proxy/src/install.ts:296`) whose `NO_PROXY` always includes loopback (`LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]']`, `policy.ts:33`), so plain `fetch` to `127.0.0.1` goes direct. Use `AbortSignal.any([signal, AbortSignal.timeout(ms)])`.
- Service Definition `ctx.airEmbedding` with `embed(texts: readonly string[], role: 'query' | 'document', signal: AbortSignal): Promise<{ model: string; dim: number; vectors: Float32Array[] }>`; providers `@air/dsh-embedding-ollama` and a deterministic hashed provider for tests (AIR RQ3 style). Absent provider means FTS-only, reported in results.

## 5. Background work

### 5.1 Current APIs

- **Jobs** (`packages/jobs/jobs/src`): abstract `JobRegistry` (`ctx.jobs`), `start(spec: JobSpec): JobId` (index.ts:110). `JobSpec` (types.ts:126): `kind`, `label`, `owner?: SessionId`, `outputLimitBytes?`, `output?`, `run(job: JobHandle): JobHooks`. `start` refuses work when no attached job controller serves the owner; jobs are model-facing (`job_*` tools, completion notices) and owner disposal cancels them. Good for "show extraction progress in the Jobs UI", wrong as the only home for a host-internal pipeline.
- **Schedule** (`packages/schedule/schedule`): host-owned reminders that always deliver as follow-up messages into the original session (`packages/schedule/AGENTS.md`); recurrence helpers (`resolveCronOccurrence`, `resolveDailyOccurrence`) are in `src/domain.ts` and not exported from the package entry. A plugin cannot schedule a session-less host job through it.
- **Session lifecycle** (`packages/core/session/src/index.ts`): emits `'session/created'` (55), `'session/disposed'` (65), `'session/event'(session, event)` (77, post-commit, fire-and-forget), parallel `'session/flush'(session)` (86). `turn/end` is a session event `{ turn: number; reason: TurnEndReason }` (`types.ts:297`), observed through `session/event`. Agent-level: `'agent/status'` idle/running, `'agent/disposed'`.

### 5.2 Recommendation

- **End-of-turn capture:** `ctx.on('session/event', (session, event) => ...)` appends model-visible user/assistant text (and a taint bit when the turn contained `tool/result` from untrusted tools, web fetches, MCP, or any `air-desktop-context` message) to a per-session in-memory buffer; on `turn/end` it enqueues the turn into a bounded per-session queue. This avoids historical reads.
- **Extraction trigger:** when the agent goes `idle` for `extractIdleMs`, on `session/disposed`, or when the buffer exceeds `extractMaxTurns`. The worker runs outside any turn with its own `AbortController`, registered with `ctx.effect` so plugin disposal aborts and awaits it (bounded drain `disposeDrainMs`). Extraction cursors (`sessionId -> last extracted turn`) live in the AIR index database, so resume does not repeat work.
- **Resume gap:** a session that crashed before extraction has no buffer. Read its history through `session-query` (asynchronous, paged) or leave it; MemOS has the same gap. Spike S5.
- **Nightly consolidation:** a plugin-owned timer (`setTimeout` recomputed from Config `consolidateAt: 'HH:MM'` and `timeZone`, with `Temporal`), guarded by a `lastRun` value in the index database and a per-run budget (`maxModelCalls`, `maxTokens`). Optionally register an unowned job for visibility when `ctx.jobs` is composed. Do not route it through `schedule`.

## 6. Desktop context on GNOME Wayland

### 6.1 Probe results on this machine

| Signal | Mechanism | Result |
|---|---|---|
| Binaries | `wl-paste`, `wl-copy` (wl-clipboard 2.2.1), `gdbus`, `busctl`, `dbus-send`, `gnome-extensions` | all installed |
| Session type | `XDG_SESSION_TYPE=wayland`, `XDG_CURRENT_DESKTOP=GNOME`, GNOME Shell 50.5 | |
| Active window / apps | `org.gnome.Shell.Introspect.GetWindows`, `GetRunningApplications` | **AccessDenied: "is not allowed"** (interface present; restricted to allowlisted callers) |
| Arbitrary shell JS | `org.gnome.Shell.Eval` | returns `(false, '')` (disabled) |
| Idle time | `org.gnome.Mutter.IdleMonitor` `/org/gnome/Mutter/IdleMonitor/Core` `GetIdletime` | works (`uint64` ms) |
| Screen lock | `org.gnome.ScreenSaver.GetActive`; logind `LockedHint`, `IdleHint` | works |
| Battery | UPower `DisplayDevice` `Percentage`, `State`, `TimeToEmpty`; `UPower.OnBattery` | works |
| Network | NetworkManager `Connectivity` (4 = full), `Metered` | works |
| Power saver | portal `PowerProfileMonitor.power-saver-enabled` | works |
| Clipboard types | `wl-paste --list-types` | works, no content read |
| Recent files | `~/.local/share/recently-used.xbel` | present, `0600` |
| JSON output | `busctl --json=short get-property ...` | returns `{"type":"u","data":2}`; easier to parse than gdbus GVariant text |

No D-Bus client library is in the lockfile (`dbus-next` is absent and has had no release since 2021). `fast-xml-parser` is already in the workspace for the xbel file.

### 6.2 Provider design

- **Tier 0 (system state), default on:** one `busctl --json=short` call per property group through `ctx.subprocess.spawn` with fixed argv and a short `graceMs`; `--user` for Mutter and ScreenSaver, system bus for UPower, NetworkManager, logind. Pull on step 1 only (tmux pattern), no background subscription. Output: `battery`, `onBattery`, `connectivity`, `metered`, `powerSaver`, `locked`, `idleMs`, `diskFree` (from `statfs`).
- **Tier 1 (focus), opt-in:** requires a GNOME Shell extension because Introspect is denied. Ship `air/gnome-extension/air-focus@air.local/` (GJS ESM, GNOME 45+ `Extension` class) that exports `org.air.Desktop1` on the session bus with `GetFocus() -> a{sv}` (`app_id`, `wm_class`, `pid`, `workspace`, and `title` only when its own setting enables titles) and a `FocusChanged` signal. The Node provider calls it with `busctl --user --json=short call`. Absent extension reports `unsupported: gnome-extension-missing` in the reading. Recent files come from the xbel file, filtered to the workspace and a Config allowlist, pull-only through `desktop_context`.
- **Tier 2 (content), per-call ask:** clipboard via `wl-paste --list-types` first; drop the read when a password-manager hint type (`x-kde-passwordManagerHint`) is present; otherwise `wl-paste --no-newline --type text/plain` with a byte cap. Only reachable through the `desktop_context` tool, which asks through `ctx.approval.request` on every tier 2 call.
- **Redaction** runs in the provider before anything is returned: app denylist, regex scrubbers (tokens, card numbers, emails), size caps, and a redaction count only.
- **Native helper strategy:** no Node native addon. The "helper" is (a) the stock `busctl`/`wl-paste` binaries, resolved once with `ctx.subprocess.resolveExecutable` and reported `unsupported` when missing, and (b) the GJS extension for focus. Do not run these through `ctx.shell`: that executor is the sandboxed model-facing seam, may deny access to the D-Bus socket, and applies policy meant for model commands.

## 7. Permissions

### 7.1 Current APIs

- **Pre-execute waterfall** (`packages/core/tools/src/index.ts:153`): `'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>`; default `next()` result is `{ kind: 'allow' }` (1505-1508).
- `PreToolDecision` (607-611):
  ```ts
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } }
  ```
  Argument rewriting is excluded by design. `ToolExecution` (393) exposes `callId`, `rootCallId`, `name`, frozen `arguments: unknown`, `agent?`, `parent?`, `signal`, `token`.
- **Guards:** `ctx.tools.guard(guard: ToolGuard): () => void` (1136) run after the waterfall only when it allowed; any guard string denies and nothing can force-allow past it.
- **Ask resolution:** `serviceAsk` (1727-1766) calls `ctx.approval.request({ agent, toolName: exec.name, callId: exec.callId, reason?, displayReason?, signal: exec.signal })` and maps the closed `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'` (`packages/interaction/user-approval/src/types.ts:32`) to allow/deny; missing service or missing agent denies.
- **Approval service** (`packages/interaction/user-approval/src/index.ts`): `request(req: ApprovalRequest): Promise<ApprovalOutcome>` (215) requires an open turn, appends `approval/asked { id, toolName, callId?, reason? }` and `approval/decided { id, outcome }`, applies policy `'ask' | 'never'` before answerers, then dispatches the `'approval/request'` waterfall (`types.ts:87-91`) with `ApprovalRequestEvent { agent; toolName; callId?; reason?; displayReason?; signal? }` (63-76). The request carries **no arguments**; `callId` links to the already logged `tool/call { turn, step, callId, name, arguments: string }` (`packages/core/session/src/types.ts:361`, appended before dispatch in `packages/core/agent-loop/src/tool-calls.ts:264`).
- **Direct askers bypass pre-execute:** sandbox escalation calls `ctx.approval.request` from the tool layer (`packages/sandbox/sandbox/src/escalation.ts`). auto-review (`packages/experimental/auto-review/src/index.ts:686-721`) is the in-tree example of a prepended pre-execute gate that combines its own decision with `await next()`.
- **Permission presets** (`packages/interaction/permission-presets/src/index.ts:180`): `PermissionPresetService extends TypertRemoteService` bundles sandbox mode + approval policy per session; `defaultPreset` is a `.volatile()` Config field (198) edited through Settings; `registerAuto` lets one integration add the `auto` preset.
- **Web approval UI** (`packages/client/ui-approval/src/client`): registers a `conversation.composer` chain entry at `priority: 1` selecting `PendingApproval` (index.ts:91-103) and answers the forwarded `approval/request` waterfall (104-106; forwarded by `API_REMOTE_FORWARDED_EVENTS` in `packages/api/remotes/src/remote-events.ts`). `PendingApproval.answer` accepts only `ApprovalDecision = 'allowed-once' | 'rejected'` (`contract/slots.ts:66`). The panel has two buttons (Reject, Allow once; `ApprovalPanel.tsx:78-83`). Argument detail comes from the single-occupant `conversation.approval.detail` slot (slots.ts:35-42), filled by ui-chat's `ApprovalCommand`, which shows only `args.command` (`packages/client/ui-chat/src/client/chat/ApprovalCommand.tsx:16-40`). Chain entries run in ascending `priority`; single slots render the lowest priority (`packages/client/ui-slots/src/index.ts:762-779`).
- **Settings writes from the client:** `ctx.remote.settings.mutate(ns, [{ op: 'set', path, value }], revision)` edits `.volatile()` Config fields of the profile entry whose id is `ns` and persists them to the profile `cordis.patch.yml` (`packages/client/ui-permission-presets/src/client/settings-store.ts:124-128`, ns `'permission'` at line 19). This path is already mounted in the Web client.

### 7.2 Where the rule store lives (no change to `ApprovalOutcome`)

Two AIR listeners, both order-independent:

1. **Pre-execute policy listener** (prepended): `const downstream = await next()`; compute the AIR decision from capability scopes and rules; combine with `deny > cancel > ask > allow`, except that an explicit AIR `allow` rule may satisfy a downstream `ask` (the user already granted it). A matching `deny` rule returns `deny` with `info: { name: 'AirRuleDenied', code: 'AIR_RULE_DENIED' }`. An AIR `ask` returns `{ kind: 'ask', reason, displayReason }` where `reason` is an English argument summary (persisted in `approval/asked.reason`, the only durable place for it) and `displayReason` the localized text. It also records `callId -> { name, arguments }` in a process-local map for listener 2.
2. **Approval answerer** (`approval/request`, prepended, host side): for asks that did not come through listener 1 (sandbox escalation, hooks), look up the call's arguments in the map by `callId`, and return `'allowed-once'` when an allow rule matches; otherwise `next()` (the Web or ACP answerer). It never returns `'rejected'` from a rule, so a human stays the only source of a recorded rejection.

Both append a line to `$DSH_HOME/air/permissions/audit.jsonl` (`{ time, sessionId, callId, tool, ruleId, decision }`), because an allow decided in listener 1 creates no approval events at all and one decided in listener 2 is recorded as a plain `allowed-once`.

Rules are a `.volatile()` Config field `rules` on the `@air/dsh-permission-rules` entry (entry id `air-permission-rules`), so the "Always allow" button, the `/permit` command, and hand-edited YAML all write one place:
```yaml
- id: air-permission-rules
  name: '@air/dsh-permission-rules'
  config:
    scopes:                       # tool -> capability scope and the argument keys that define it
      bash: { scope: exec, argKeys: [command] }
      write: { scope: fs.write, argKeys: [file_path] }
      edit: { scope: fs.write, argKeys: [file_path] }
      web_fetch: { scope: net, argKeys: [url] }
      memory_write: { scope: memory.write, argKeys: [type] }
    unscopedDefault: ask          # tool with no scope entry: allow | ask | deny (fail loud on unknown value)
    scopeDefaults: { exec: ask, fs.read: allow, fs.write: ask, net: ask, memory.write: ask }
    rules:                        # volatile; first match wins, deny before allow
      - { id: r1, decision: allow, tool: bash, match: { command: 'git status*' } }
      - { id: r2, decision: deny, scope: net, match: { url: 'http://169.254.*' } }
```
Matching uses `picomatch` (already a workspace dependency) on string argument values; `fs.*` paths are resolved against the session `cwd` before matching. Unknown tools named in `scopes` fail at load (misconfiguration fails loud). A tool listed in `scopes` without its `argKeys` present in the call is treated as unscoped.

"Granted scope shown in tool descriptions" (research.md §5.3) would need the `system-prompt/assemble` waterfall to rewrite tool descriptions; that changes the request header, so do it only when the rule set changes and accept the cache miss.

### 7.3 Web "Always allow"

An out-of-tree Client plugin can add it without replacing `ui-approval`:
- Register a `conversation.composer` chain entry with `priority: 0` (before `ui-approval`'s 1) whose selector matches `PendingApproval` instances, and render an AIR panel with Reject / Allow once / Always allow. "Always allow" calls `ctx.remote.settings.mutate('air-permission-rules', [{ op: 'set', path: ['rules', String(n)], value: rule }], revision)` and then `pending.answer('allowed-once')`. The waterfall outcome stays inside the closed union.
- Register `conversation.approval.detail` at `priority: -1` to shadow `ApprovalCommand` and show the full parsed arguments of the correlated call (falling back to `command`).
- A dedicated `ctx.remote.airPermissions.*` namespace is possible (`TypertRemoteService` + `@Remote`, `docs/cookbook/adding-a-remote-api.md`) but the Client assembly mounts namespaces in-tree (`packages/api/remotes`), and the generated `/typert` and `/remote` artifacts come from the repo's tsdown plugin. Prefer the Settings path.
- Out-of-tree browser bundles load through a package's `dsh.client` declaration (`packages/client/modules`), but the AIR workspace has not built one yet (spike S3).

## 8. Proposed packages under `@air/`

| Package | Role (capability-seam role) | Key Config fields |
|---|---|---|
| `@air/dsh-memory` | Service Definition: `MemoryStore` service (`ctx.airMemory`: `list`, `read`, `write`, `supersede`, `forget`, `search`), branded `MemoryId`/`MemoryScopeId`, frontmatter zod schema, trust derivation, all AIR memory `MessageSourceMap` declarations | none |
| `@air/dsh-memory-files` | Provider: Markdown + frontmatter git repo, locks, atomic writes, git through `ctx.subprocess`, quarantine directory, path confinement | `root` (default `dshHomePath('air','memory')`), `gitPath`, `indexMaxLines`, `indexMaxBytes`, `commitAuthor` |
| `@air/dsh-memory-index-sqlite` | Derived FTS5 + JS vector index, content-hash rebuild, RRF fusion and priors | `path` (default `dshCachePath('air','memory-index.sqlite')`), `journalMode`, `rrfK` (60), `recencyHalfLifeDays`, `weights: { recency, importance, trust }` |
| `@air/dsh-embedding` + `@air/dsh-embedding-ollama` | Definition `ctx.airEmbedding` + Ollama provider | `baseUrl` (`http://127.0.0.1:11434`), `model` (`nomic-embed-text`), `dimensions` (256), `queryPrefix`, `documentPrefix`, `timeoutMs`, `keepAlive` |
| `@air/dsh-tool-memory` | Consumer: `memory_search`, `memory_read`, `memory_write`, `memory_forget` | `mode: 'on' \| 'read-only' \| 'off'`, `searchLimit`, `confirmTypes` (`['feedback']`) |
| `@air/dsh-memory-context` | Consumer: pinned core, auto-recall, change notices, incognito notice | `coreBudgetTokens` (1500), `autoRecall` (false), `recallBudgetTokens` (500), `recallTopK`, `recallFloor`, `recallTimeoutMs` (1500) |
| `@air/dsh-memory-extract` | Background extraction with trust gate, nightly consolidation | `provider?`/`model?` (paired), `reasoningEffort?`, `timeoutMs`, `maxOutputTokens`, `extractIdleMs`, `extractMaxTurns`, `untrustedSources` (tool names and source kinds), `consolidateAt`, `timeZone`, `maxModelCalls`, `disposeDrainMs` |
| `@air/dsh-desktop` | Definition `ctx.airDesktop` (`read(signals, signal): Promise<DesktopReading>`), signal vocabulary, redaction pipeline | `denyApps`, `redactPatterns`, `maxValueBytes` |
| `@air/dsh-desktop-gnome` | Provider: busctl/wl-paste/xbel + extension client | `busctlPath`, `wlPastePath`, `queryTimeoutMs`, `titles` (false), `recentFilesLimit` |
| `@air/dsh-desktop-context` | Consumer: tier 0/1 reading injection, `desktop_context` tool | `tiers: { system: true, focus: false, content: false }`, `refreshIntervalMs`, `signals` |
| `air/gnome-extension/air-focus@air.local` | GJS Shell extension (not an npm package) | extension GSettings `expose-titles` |
| `@air/dsh-permission-rules` | Pre-execute policy + approval answerer + audit + `/permit` command (`ctx.commands.register`, `packages/interaction/commands/src/index.ts:285`) | `scopes`, `scopeDefaults`, `unscopedDefault`, `rules` (volatile), `auditPath` |
| `@air/dsh-client-ui-approval-rules` | Client: composer entry with Always allow, argument detail | none |

Incognito and memory mode are per-session facts that the closed `SessionHeader` (`packages/core/session/src/types.ts:94`) cannot carry. Record them as a model-visible `air-memory-notice` message ("memory is off for this session") at the first step and fold it in a projection; that keeps replay faithful without a custom event.

## 9. Task order

1. **Spikes S1-S3** (section 11) before any product code; each is small and decides a structural choice.
2. **Permissions first** (smallest, unblocks memory confirmations): `@air/dsh-permission-rules` pre-execute listener with scopes and static rules; audit file; approval answerer for direct asks; `/permit`; then the Client plugin.
3. **Memory core path:** `@air/dsh-embedding(-ollama)` and a hashed test provider; `@air/dsh-memory-index-sqlite`; `@air/dsh-memory` + `-files`; `memory_search` and `memory_read`; `memory_write`/`memory_forget` with approvals.
4. **Memory context:** pinned core with compaction survival; change notices; then opt-in auto-recall with deadline.
5. **Extraction:** turn capture, trust gate, quarantine, extraction log; then consolidation timer and quarantine review (`/memory` command, later a Web panel).
6. **Desktop:** `@air/dsh-desktop` + GNOME tier 0 provider + injection; `desktop_context` tool; GNOME extension and tier 1; tier 2 clipboard with per-call ask.
7. **Evaluation hooks** for RQ3 (arms toggled by Config) once steps 3-5 exist.

## 10. Test approach

- **Unit (vitest, in-process Loader):** follow `packages/context/time-context/tests/time-context.spec.ts`: `new Context()`, `@deepseek-ai/cordis-plugin-loader`, `mountAgentLoopTestDependencies` from `@deepseek-ai/dsh-agent-loop-testkit`, a scripted `LlmAdapter`, `AgentRegistry`, `SessionProjectionRegistry`, and the plugin under test. Assert on logged `user/message` events (source kind, form, extra fields, text) and on `tool/result.meta`. Memory tests use a temp `root`, the hashed embedder, and `:memory:` index. Cover the note 05 §2.9-C list (current beats stale, superseded exclusion, abstention floor, scope isolation, forget, incognito, quarantine, imperative rejection, rebuild equivalence).
- **REAL-composition Loader test:** `runLoaderSmoke` from `@deepseek-ai/dsh-loader-smoke` with a patch over the shipped headless profile, as `time-context.e2e.ts` does with `tests/fixtures/time-context.patch.yml` (disable `headless-startup`/`headless-runner`, point `agent-loop` at a mock provider, set `session-persistence-jsonl.root: ./.sessions`, `insert` the AIR rows). Then read the JSONL and assert: (1) every event type is in `KNOWN_SESSION_EVENT_TYPES` (guards finding 0.1); (2) AIR messages are `surfaceOp: 'append'` after `step/start`; (3) a second boot **without** the AIR rows resumes the same session (proves logs stay readable when AIR is removed); (4) the request prefix is byte-identical across turns after a mid-session `memory_write`.
- **Desktop:** the provider takes executable paths from Config; tests point them at fixture scripts under `tests/fixtures/bin` that print recorded `busctl --json=short` output, so tests never touch the real bus. One opt-in local test (`AIR_DESKTOP_LIVE=1`) runs against the real bus.
- **Permissions:** Loader test with a fixture tool, `dsh-user-approval`, and a scripted `approval/request` answerer; cases for rule allow over downstream ask, deny over everything, direct `ctx.approval.request` answered by rule, audit lines, and a rule added through the Settings service surviving a reload.
- **Snapshot tests:** the repo requires keyless recorded-session snapshots for model-visible changes in-tree; AIR should keep an equivalent recorded-session replay under `air/` for the pinned core and desktop readings.

## 11. Risks and spikes

| # | Spike / risk | What to verify | Size |
|---|---|---|---|
| S1 | Extra `MessageSource` fields round-trip | A `user/message` with an AIR source kind and extra JSON fields survives JSONL write, reload, API transport, and renders in `ContextInjectionRow`; choose `recall` vs `snapshot` for auto-recall | 0.5 day |
| S2 | Compaction survival of the pinned core | Run `compaction-basic` in a Loader test; confirm the replacement surface event names the core's seq and that the projection re-injects exactly once | 0.5 day |
| S3 | Out-of-tree Client plugin | Build a trivial `dsh.client` plugin from `air/packages` with the repo's client tsdown helper; mount a `conversation.composer` entry at priority 0; call `ctx.remote.settings.mutate` on an AIR entry | 1 day |
| S4 | GNOME extension | Minimal GJS extension exporting `org.air.Desktop1`; install flow (`gnome-extensions install`, re-login needed on Wayland for a new extension); any session-bus client can call it, so titles stay off by default | 1 day |
| S5 | Extraction quality and cost on local models | qwen3:8b / qwen2.5:7b-instruct JSON extraction reliability, tokens per session, resume gap handling through `session-query` | 1-2 days |
| R1 | No ignorable writes | Any future need for a structured session event requires a fork edit to `Session.append`; record in `air/UPSTREAM-DELTA.md` if taken | decision |
| R2 | Settings precedence | A home patch or command-line overlay that sets `rules` makes client writes refused ("a form write that they would override is refused"); the AIR bundle must not set `rules` | check in S3 |
| R3 | Audit gap | Rule-based grants are not distinguishable in `approval/decided`; the AIR audit file is the only record | accepted |
| R4 | Ollama cold start | 6.2 s first embed exceeds the recall deadline; send `keep_alive` and warm the model at plugin start | low |
| R5 | `node:sqlite` experimental warning | Stderr noise on Node 22; upstream already accepts it | low |
| R6 | Deprecated history reads | Extraction must not call `eventAt`/`snapshotEvents`; incremental capture misses turns from before process start | S5 |
| R7 | Load-order-dependent waterfalls | Combination logic must not depend on position; test with AIR loaded before and after auto-review | low |
| R8 | Forgetting is partial | Logged recall and pinned-core text stay in session logs after `memory_forget`; document it as upstream-style session deletion | accepted |
| R9 | Peer ranges | Every AIR package pins `@deepseek-ai/dsh-*` peer ranges that must be bumped at each upstream sync | process |
