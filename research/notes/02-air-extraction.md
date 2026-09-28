# 02 — AIR extraction: what to port into AIR-harness

This note extracts the design, results, defects, and lessons of the earlier final-year project **AIR — AI Integration Runtime** (Python 3.12, repository `github.com/HXMAN76/AIR`) and decides, component by component, how each part should reach the TypeScript/Cordis fork at `/home/hxman/AIR-harness`. AIR paths below are relative to the AIR repository root; harness paths are relative to `/home/hxman/AIR-harness`.

Sources read: AIR `CLAUDE.md`, `config.yaml`, `docs/architecture/{ARCHITECTURE.md, AIR_Architecture_v0.2.md, PRD.md}`, `docs/adr/0001`–`0010`, `docs/{STATUS, PROGRESS, PRODUCT_AUDIT, EVALUATION, DEMO_READINESS, WORK}.md`, all of `core/`, all plugin servers and manifests under `plugins/`, `sdk/air_client.py`, and the security and evaluation tests. Harness sources: `packages/mcp/mcp-client/src/{tools.ts,index.ts,connection.ts,transport.ts}`, `packages/core/tools/src/index.ts`, `docs/subsystems/{mcp,tools,approval,permission-presets,sandbox,schedule,workflow,storage,session-telemetry}.md`, and package READMEs named where cited.

Verdict vocabulary: **PORT AS-IS** (same design, new language), **PORT REDESIGNED** (keep the idea, change the mechanism to fit harness extension points), **ALREADY BETTER IN HARNESS** (use the named package; carry over at most a detail), **DROP**.

## 1. Headline findings

1. The research contribution, manifest tool-pinning, is worth porting, but it must be redesigned. In AIR the digest covers only `inputSchema` (`core/plugin_manager/manager.py:diff_tool_surface`, `core/tool_gateway/models.py:compute_schema_digest`). A changed tool **description**, the classic MCP "rug pull" and tool-poisoning vector, is not detected. Invariant Labs' `mcp-scan` (2025) already pins tools by hashing descriptions, so ADR-0001's claim that RQ2 is "unsolved by the state of the art" overstates novelty. The defensible contribution is the combination that neither AIR nor `mcp-scan` has alone: content pinning of the full tool definition, bound to capability grants, enforced inside the runtime's single execution pipeline, with a fail-closed state machine.
2. The harness removes AIR's biggest runtime weakness for free. AIR spawns a fresh MCP subprocess for every tool call (`core/plugin_manager/mcp_client.py:StdioMCPToolCaller`) and checked the tool surface on a separate throwaway process, which is the load-time vs. call-time gap ADR-0005 names. `dsh-mcp-client` keeps one serving process per configured server and re-syncs on `tools/list_changed` notifications (`packages/mcp/mcp-client/src/connection.ts`, `enqueueSync`). Pinning each sync generation before registration turns AIR's 300-second polling recheck into an event-driven gate on the same process that will serve the calls.
3. Most of AIR's core (Kernel, Tool Gateway, Approval Manager, audit log, config overlays, correlation IDs, Event Bus, web UI, SDK) is already better in the harness. What the harness genuinely lacks is exactly what the task statement lists: schema/description pinning, capability scopes on MCP tools, long-term memory, desktop context, and voice.
4. AIR's evaluation is honest about its limits but weak as evidence. RQ2's 100% detection is guaranteed by construction (any change to a hashed dict changes the hash) and was measured against a mock lister. RQ3 uses a five-record synthetic corpus. RQ5 does not measure the dominant cost, the per-call subprocess spawn. RQ4 was true at the M12 snapshot and was violated two days later when per-plugin tool names entered the Planner's `SYSTEM_PROMPT` and the classifier's keyword list.

## 2. Component extraction

### 2.1 Plugin manifest and manifest tool-pinning (Plugin Manager)

**Design.** Each plugin ships `manifest.json`, validated by Pydantic models with `extra="forbid"` at every level (`core/plugin_manager/models.py`; ADR-0002 item 1 decided "reject, no warn tier"). The actual filesystem manifest (`plugins/filesystem/manifest.json`, digests shortened):

```json
{
  "id": "air.plugin.filesystem",
  "name": "Filesystem Access",
  "version": "0.2.0",
  "mcp_server": {
    "transport": "stdio",
    "command": ["python", "-m", "plugins.filesystem.server"],
    "spec_version": "2026-07-28",
    "sdk": "python-mcp-sdk>=2.0.0b"
  },
  "air_sdk_version": "^0.2",
  "scope_env_var": "AIR_FS_SCOPE",
  "capabilities": [
    {"id": "fs.read",  "scope": ["~/Documents", "~/Downloads"], "confirmation": "install_time"},
    {"id": "fs.write", "scope": ["~/Documents/AIR"],            "confirmation": "per_call"}
  ],
  "tools": [
    {"name": "read_file",      "capability": "fs.read",  "schema_digest": "sha256:b73ad103…", "timeout_ms": 3000},
    {"name": "write_file",     "capability": "fs.write", "schema_digest": "sha256:7bdc3c04…", "timeout_ms": 3000},
    {"name": "list_directory", "capability": "fs.read",  "schema_digest": "sha256:b343cb64…", "timeout_ms": 3000}
  ],
  "sandbox": {"mode": "subprocess", "bubblewrap": true, "network": false}
}
```

Digest algorithm (`core/tool_gateway/models.py`): `"sha256:" + sha256(json.dumps(input_schema, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()`. Load algorithm (`PluginManagerImpl.load`, AIR_Architecture_v0.2 §7.3): parse and validate the manifest; refuse a manifest whose `spec_version` differs from the pinned `2026-07-28` or whose transport is not `stdio`; start the server; `initialize`; `tools/list`; digest each live schema; compute `ToolSurfaceDiff{added, missing, altered}` where `added` = live names absent from the manifest, `missing` = pinned names the server no longer reports, `altered` = pinned names with a different digest. Any non-empty set moves the plugin to `ERRORED`; boot continues. The state machine is `Discovered → Validated → DependencyResolved → Loaded → Enabled → Running → Disabled/Errored → Uninstalled` (`PluginState`); `enable()` refuses an `ERRORED` plugin until a fresh load re-runs the check. Post-M12, `diff_tool_surface(plugin_id)` is scheduled per plugin by APScheduler every `plugin_manager.tool_surface_recheck_interval_s` (default 300) (`sdk/air_client.py`). `air plugin new` computes digests by starting the generated server, instead of trusting a hand-typed hash.

**What worked.** The mechanism is small, auditable, and was verified sound by the audit (`docs/PRODUCT_AUDIT.md` §1). Key reordering is correctly not drift. Gating the browser plugin by pinned tool names rather than Playwright capability groups (`CLAUDE.md`, AIR_Architecture_v0.2 §7.6) is a genuinely useful rule: `browser_evaluate` is only callable if pinned, and a live server reporting it unpinned errors the plugin (`tests/security/test_tool_pinning.py`).

**Bugs and limitations found.**
- Only `inputSchema` is hashed. `LiveTool` carries just `name` and `input_schema` (`core/plugin_manager/models.py`). Description changes, `outputSchema`, and annotations are invisible. This is the most important gap for a port.
- Load-time vs. call-time: the check ran on a throwaway process and every call spawned a new one with no identity link (`docs/PRODUCT_AUDIT.md` §1 finding 3; ADR-0005 accepted "load + periodic recheck" and named per-call pinning and process-identity pinning as rejected or deferred).
- `diff_tool_surface()` was dead code until the post-M12 fix (`docs/PRODUCT_AUDIT.md` §1 finding 2).
- Fragility to SDK upgrades: the Python SDK generates `inputSchema` from function signatures, so an SDK bump that changes generated `title` or `default` fields would error every plugin. The team held the `mcp` 2.1.1→2.2.0 bump for manual review for this reason (`docs/PROGRESS.md`, A6). There is no re-pin workflow other than regenerating the manifest.
- Canonicalization is Python-specific. `json.dumps` escapes non-ASCII (`ensure_ascii=True`), serializes `1.0` as `1.0`, and sorts keys by code point. JavaScript's `JSON.stringify` emits raw UTF-8, prints `1.0` as `1`, and default string sort uses UTF-16 code units. Existing AIR digests will not reproduce in TypeScript unless the canonicalizer is replicated byte-for-byte.
- Pinning to one MCP spec revision string made the runtime refuse any other revision. The harness negotiates revisions in the official TS SDK 2.0.0 (`.agents/notes/implemented/feature/2026-09-12-mcp-sdk-protocol-negotiation.md`). Pin content, not protocol version.
- The evaluation used `MockMCPServer` (a fake lister), not real servers.

**Verdict: PORT REDESIGNED.** Implement pinning as a gate on each `dsh-mcp-client` sync generation. `syncTools()` (`packages/mcp/mcp-client/src/tools.ts`) already builds the complete next generation before the swap phase; a pin policy evaluated between fetch and swap can reject the generation, keep the server's tools unregistered, and record a drift event. Required changes:
- Digest the full definition: `{name, description, inputSchema, outputSchema, annotations}`, canonicalized with RFC 8785 (JSON Canonicalization Scheme), prefixed with the algorithm (`jcs-sha256:`). Re-pin AIR plugins with the TypeScript tool rather than reusing Python digests.
- Key pins by the local `serverName` from cordis.yml plus the raw tool name, never by remote `serverInfo.name` (ADR-0001 contract 5, which the harness already follows in `publicToolName`).
- Add a synchronous `ctx.tools.guard()` that denies any call whose server is currently in a drifted state. This closes the window between a `list_changed` notification and re-evaluation. Guards cannot force-allow, so the rule composes with approval policy.
- Record pin verdicts as session events so that the tool set a model saw is reconstructable (harness rule "Model-visible ⟺ logged").
- Offer a two-state response rather than AIR's single `ERRORED`: whole-server quarantine (AIR's behavior) or per-tool narrowing (register only tools whose digest matches). Measure both in the evaluation.

A proposed harness-side manifest, loaded by a new pinning plugin and matched to an `mcp-client` entry by `serverName`:

```json
{
  "serverName": "air_fs",
  "version": "0.3.0",
  "digestAlgorithm": "jcs-sha256",
  "capabilities": [
    {"id": "fs.read",  "scope": ["~/Documents"], "scopeArgKeys": ["path"], "confirmation": "install_time"},
    {"id": "fs.write", "scope": ["~/Documents/AIR"], "scopeArgKeys": ["path"], "confirmation": "per_call"}
  ],
  "tools": [
    {"name": "read_file",  "capability": "fs.read",  "digest": "jcs-sha256:…"},
    {"name": "write_file", "capability": "fs.write", "digest": "jcs-sha256:…"}
  ],
  "onDrift": "quarantine-server"
}
```

### 2.2 Tool Gateway (single chokepoint)

**Design.** `ToolGatewayImpl.invoke(tool_name, args, caller)` (`core/tool_gateway/gateway.py`): unknown tool → `unknown_tool`; `jsonschema.validate` → `invalid_args`; plugin-enabled predicate → `plugin_disabled`; missing handler → `no_handler`; `CapabilityManager.check` → `capability_deny|ask`; `asyncio.wait_for(handler, spec.timeout_ms/1000)` → `timeout` or `tool_error`; else `ok`. Every branch writes one structlog line and one `JsonlAuditLog` record. `CallerContext` is `planner | workflow | client` and changes attribution only. `ToolSchema` (`extra="forbid"`: `name`, `description`, `parameters`) is structurally separate from `ToolSpec` (ADR-0001 contract 3).

**What worked.** One result type for every outcome including denial; deny paths proven never to dispatch (`tests/unit/test_tool_gateway.py`).

**Bugs.** `get_filtered_tool_schemas()` did not filter by grant until the audit (`docs/PRODUCT_AUDIT.md` §1 finding 1). `disable()` did not stop dispatch until a `plugin_enabled` predicate was added (§0.5). The `session_id` parameter is still unused.

**Verdict: ALREADY BETTER IN HARNESS** — `@deepseek-ai/dsh-tools` (`packages/core/tools`). Its pipeline (`tools/pre-execute` allow/deny/ask waterfall → monotonic `guard()`s → `tools/execute` wrappers → `tools/post-execute` → `finalizeContent` → immutable `tools/result`) is the shape ADR-0001 contract 1 copied, with scope-layered `ToolRestriction`, cancellation signals, and the session log as audit. Registration disposal replaces the `plugin_disabled` predicate. Carry over nothing except the explicit `caller` attribution idea, which the harness already expresses through `agent`, `rootCallId`, and `parent`.

### 2.3 Capability Manager, capability taxonomy, and scopes

**Design.** `Capability{id, resource_scope, confirmation_mode ∈ {install_time, per_call}, scope_arg_keys=["path"]}` (`core/capability_manager/models.py`). `check(plugin_id, tool, args)` (`core/capability_manager/manager.py`): no declared capability → deny; no grant → deny; `_first_scope_violation` (expand and `resolve()` each named argument, require equality with or descent from a resolved scope root) → deny; `per_call` with no confirmer → `ASK` (which the Gateway treats as a denial); a confirmer that raises → deny; declined → deny; otherwise allow. Every decision is audited. The taxonomy (`core/capability_manager/taxonomy.py`) maps 15 categories to risk and default confirmation, for example `fs.read` low/install_time, `fs.write` medium, `browser.execute_script` high/per_call, `shell.execute` high/per_call, `system.device_control` medium/per_call. `granted_scope()` feeds the real scope into the model-facing tool description ("Valid paths: …").

**What worked.** Fail-closed on every axis the audit checked. Placing the check in dispatch code a plugin does not control. Appending the granted scope to the tool description fixed the "path hallucination" failure, where the model guessed `/home/user/Documents` (`docs/PROGRESS.md`).

**Bugs and limitations.**
- The scope check only inspected the `path` key until `scope_arg_keys` was added. The default still fails open for any capability whose tool uses another key without declaring it (`docs/PRODUCT_AUDIT.md` §1 finding 4).
- An M6 regression scope-checked every string argument, which denied `write_file` because its `content` was not a path (`docs/STATUS.md`).
- `install_time` is never asked. `sdk/air_client.py:_register_plugin` grants every capability declared in every configured manifest at startup, so "install-time confirmation" means "listed in config.yaml".
- There is a check-then-use race: the Capability Manager resolves symlinks at check time and the plugin resolves again later. Bubblewrap mitigates this only for the filesystem plugin.
- Grants are per plugin, not per session.

**Verdict: PORT REDESIGNED** as a pinning-and-capability plugin that registers (a) a `tools/pre-execute` listener that maps `mcp__<server>__<tool>` to a manifest capability and returns `deny` for missing grants or scope violations and `ask` for `per_call`, and (b) a guard for drifted servers. `ask` flows into `ctx.approval` automatically; with no approval service the registry already denies (`packages/core/tools/src/index.ts`, ask resolution). Make `scopeArgKeys` mandatory whenever `scope` is non-empty (fail loud at load, per the harness convention). Implement a real install-time approval: first activation of an unapproved manifest issues one approval request and persists the decision in `dsh-storage`. Put the granted scope in the tool description through the MCP definition (pin the description after the scope text is appended, or append at `schemas()` time and log it). Port the taxonomy table AS-IS as data.

### 2.4 Approval Manager

**Design.** `ApprovalManager` (`core/capability_manager/approval.py`) wraps a UI handler with `asyncio.wait_for` (default 30 s) and resolves a timeout or handler exception to deny. It implements `ContextualConfirmer.approve_with_context(plugin_id, tool, args, category, risk)`, so prompts show plugin, tool, arguments, category, and risk.

**Bugs.** The terminal handler blocked the event loop (`typer.prompt` inside `async def`). The web UI never received approvals; they went to the server's stdin (`docs/PROGRESS.md`, B2).

**Verdict: ALREADY BETTER IN HARNESS** — `@deepseek-ai/dsh-user-approval` (`packages/interaction/user-approval`: `ask`/`never` policy, `approval/asked`/`approval/decided` audit pair, `unavailable` fails closed), `ui-approval` in the web client, and `dsh-permission-presets`. Carry over the requirement that the approval request carries capability category, risk, and the exact resource argument.

### 2.5 Plugin isolation and the bubblewrap PoC

**Design.** `core/plugin_manager/bubblewrap.py:wrap_command` builds `bwrap --ro-bind / / --dev /dev --proc /proc --unshare-net --unshare-pid --die-with-parent --bind-try <scope> <scope> … -- <cmd>`, only for manifests with `sandbox.bubblewrap: true` (filesystem only). A missing `bwrap` binary degrades to running unwrapped, with a log line.

**Bugs.** `~` was not expanded (`bwrap: Can't find source path ~/Documents`), which failed the suite on Linux. `--bind` hard-failed on a missing scope directory until it was changed to `--bind-try`. CI needed `kernel.apparmor_restrict_unprivileged_userns=0` on Ubuntu 24.04. `sandbox.network` is declared in every manifest but enforced nowhere except as a side effect of bwrap for the filesystem plugin.

**Verdict: PORT REDESIGNED** on `@deepseek-ai/dsh-sandbox` + `dsh-sandbox-local` (bwrap/Landlock on Linux, Seatbelt on macOS, restricted tokens on Windows). The harness sandbox currently confines shell tools, not MCP stdio servers, and its `SandboxMode` governs file effects only (`docs/subsystems/sandbox.md`). The port is a wrapper that passes an MCP server's argv through the sandbox seam, plus an explicit network decision; that decision is out of the sandbox vocabulary today and must be stated honestly as a limitation.

### 2.6 Logging, audit, and "model-visible means logged"

**Design.** Async-queued structlog plus `JsonlAuditLog` with a bounded buffer that drops and counts on overflow. The Tool Gateway and Capability Manager write independently. `tests/security/test_model_visible_means_logged.py` asserts that every tool the model can see produces an audit record on every outcome. Correlation IDs came from `structlog.contextvars.bound_contextvars(request_id, session_id)` (ADR-0009).

**Limitation.** The invariant covered tool schemas only. Recalled memory and the Context Engine snapshot were concatenated into the prompt (`core/planner/planner.py:_build_user_prompt`, `_build_prompt_with_context`) and were never logged, so AIR itself violated the rule for its two most distinctive inputs.

**Verdict: ALREADY BETTER IN HARNESS** — the session log (`packages/session/*`) is the audit record, "Model-visible ⟺ logged" is a repository-wide convention, and `dsh-session-telemetry-otel` supplies the OpenTelemetry export that ADR-0009 deferred.

### 2.7 Agent Kernel

**Design.** `Kernel.submit_request` (`core/kernel/kernel.py`) runs `memory.recall(text)` and `context.gather(session_id)` in parallel, calls the Planner, then stores the turn as a memory record (`kind="conversation"`, `importance=0.5`).

**Bugs.** `cancel()` and `shutdown()` were no-ops, and the test asserted only on internal bookkeeping (`docs/PRODUCT_AUDIT.md` §0.2–0.3). The Memory and Workflow SQLite stores blocked the event loop (§0.4). `httpx.AsyncClient` was never closed.

**Verdict: ALREADY BETTER IN HARNESS** — `@deepseek-ai/dsh-agent-loop` and `dsh-session` provide durable sessions, cancellation, and teardown under the defensive-patterns rules. The automatic "store every turn" behavior is dropped (see 2.10).

### 2.8 Planner: multi-hop loop, fake tool-call detection, grounding prompts

**Design.** A bounded loop `_MAX_TOOL_HOPS = 4` (ADR-0006). Tools are re-offered each hop, results are appended to a running prompt, and a final `tools=None` call is forced at the cap. `_fake_tool_call_name` regex-matches `"name": "<offered tool>"` in answer text, retries once with `_RETRY_NUDGE`, and, if the model fakes the call again, returns an honest "nothing was executed" message. Grounding instructions say: use only the tool result and never add training-data facts, and a failed tool must be reported, not retried identically.

**Bugs found live (`docs/PROGRESS.md`).** Fake tool calls from llama3.1:8b; fabricated headlines padded around a real `browser_read_page` result; memory bleed-through choosing `browser_read_page` for "what is the system status". The `SYSTEM_PROMPT` requires the user to say "read file", "browse", "bluetooth", and similar phrases before any tool call. That is a workaround for a weak model, and it couples the prompt to specific plugins.

**Verdict.** The loop is **ALREADY BETTER IN HARNESS** (`dsh-agent-loop` with native tool calls, parallel and exclusive scheduling, `@deepseek-ai/dsh-repeat-tool-reminder`, `@deepseek-ai/dsh-tool-call-timeout-policy`). Fake-tool-call detection is **PORT REDESIGNED** as an optional plugin for local-model profiles: inspect the final assistant text against the offered tool names, and inject one logged corrective message instead of rewriting the answer. The keyword-gated system prompt is **DROP**.

### 2.9 Model Router and fast/deep routing

**Design.** `ModelRouter` retries each backend three times with backoff `0.5 s × 2^(n-1)` and then falls back to another configured backend, raising `ModelError`, which the Planner turns into an honest message. `classify_tier(text)` (`core/model_router/classifier.py`, ADR-0007) returns `deep` when the request contains an ambiguity marker ("not sure", "maybe", "figure out"…), a multi-step marker (" then ", "after that"…), or a tool-trigger phrase, and `fast` otherwise. The tier is computed once per turn. Config: `model_router.backends.ollama.{default_model: llama3.1:8b, fast_model}`. The OpenAI-compatible backend re-resolves `api_key_ref` (`env:` or `keychain:`) on every call (ADR-0010).

**Limitations.** The classifier's keyword list duplicates the Planner's plugin-specific trigger phrases, so every new plugin requires editing both. Classification accuracy was never measured.

**Verdict.** Retry and fallback are **ALREADY BETTER IN HARNESS** (`@deepseek-ai/dsh-llm-retry`; Ollama is reachable as a custom `openai-completions` provider through `dsh-llm-pi-ai`, see `docs/user/guide/providers.md`; credentials through `dsh-credentials`). Fast/deep routing is **PORT REDESIGNED**, optional, and low priority: a per-turn model-selection plugin whose decision is logged, with a signal derived from the offered tool set rather than a keyword list. Only build it if the evaluation includes routing accuracy and latency.

### 2.10 Memory Engine (hybrid recall)

**Design.** `MemoryRecord{id, text, kind, importance ∈ [0,1], created_at, entity_ids (reserved for graph memory), metadata}` (`core/memory/models.py`). Storage: SQLite table `memory_records` plus a standalone FTS5 shadow table `memory_fts(id UNINDEXED, text)`, WAL, lock plus `asyncio.to_thread` (`core/memory/sqlite_store.py`). Vectors: FAISS `IndexIDMap(IndexFlatIP)` with L2-normalized vectors, so inner product equals cosine, persisted to `vector_index_path`, with `IndexDesyncError` when the index and database disagree (`core/memory/vector_store_faiss.py`). Embeddings: Ollama `nomic-embed-text` behind the `EmbeddingProvider` protocol (ADR-0003). Recall (`core/memory/manager.py`):

- candidates = top `k × candidate_k_multiplier` (default 4) from FTS5 ∪ FAISS;
- `fts = 1 / (1 + |bm25|)` (0 if absent); the query is tokenized with `\w+` and each token is quoted, which makes it injection-safe;
- `vector = (cosine + 1) / 2` (0 if absent);
- `recency = 0.5 ^ (age_seconds / recency_half_life_seconds)`, half-life 604800 s (7 days);
- `score = 0.3·fts + 0.3·vector + 0.2·recency + 0.2·importance` (config `memory.recall_weights`).

**What worked.** The Protocol seams (`VectorStore`, `EmbeddingProvider`), injection-safe FTS queries, and index persistence across restarts.

**Bugs and limitations.**
- Memory bleed-through. Every turn, including wrong or refused answers, is written back with `importance=0.5` and recalled by lexical overlap, so an earlier browsing turn steered tool choice in a later unrelated turn. Hallucinated content can also be recalled later as "memory", which reinforces it.
- `1/(1+|bm25|)` is not normalized per query, so the FTS term's scale varies with corpus statistics.
- `kind` is never used for routing or filtering. There is no session, project, or origin record filter, and `entity_ids` is unused.
- Recalled memory enters the prompt unlogged (see 2.6).

**Verdict: PORT REDESIGNED** as a new capability seam (Service Definition / Provider / Consumer): a `memory` service with an SQLite provider built on `dsh-storage-sqlite` conventions (FTS5 plus `sqlite-vec` or an in-process flat index), an Ollama or provider-routed embedding call, explicit `memory_remember`/`memory_recall`/`memory_forget` tools, and optional auto-recall injected as a source-attributed, logged context message (the `dsh-time-context` pattern). Keep the four-term formula and its config keys, add min-max normalization per candidate set, and add source fields (session id, source tool call) with a same-project filter. Do not auto-store every turn; store explicit writes and summarized facts. Two harness assets reduce the work: `dsh-session-query-sqlite` already provides ranked FTS5 search over past sessions, and `docs/user/guide/mcp-memory.md` documents third-party memory MCP servers usable as baselines.

### 2.11 Context Engine (desktop context)

**Design.** `ContextProvider{name, snapshot(), start(), stop()}`, with the rule "native protocol, never MCP" (`core/context/protocols.py`). `ContextEngineImpl.gather(session_id)` fans out with `asyncio.gather(return_exceptions=True)`, applies a per-provider timeout (`context.gather_timeout_s`, 2.0), and caches per session (`cache_ttl_s`, 1.0). A failing provider becomes `{"available": false, "reason": …}`. Providers: clipboard (poll `pyperclip.paste` every 0.5 s and publish on change), active window (`xdotool`, Win32 `ctypes`, `osascript`), open files (watchdog thread bridged with `call_soon_threadsafe`), current project (static), system state (`psutil` every 30 s, publish on rounded change).

**Bugs and limitations.** A single shared cache leaked one session's snapshot to another until it was keyed by session. On GNOME/Wayland, `xdotool` exits 0 with blank output, so the active window is always unavailable. Clipboard contents, which can include passwords, were injected into every prompt, including to a remote backend when configured, which conflicts with Local-First. Snapshots were pasted as Python dict reprs. Nothing was logged.

**Verdict: PORT REDESIGNED** as a `desktop-context` plugin modeled on `@deepseek-ai/dsh-time-context` (`packages/context/time-context`): a per-step, durable, source-attributed context message with `refreshIntervalMs`, one config flag per provider, clipboard off by default, secret redaction, and a size cap. Linux active-window support needs a Wayland path (for example GNOME Shell introspection or a compositor-specific protocol) or an honest "unavailable" status. `dsh-computer-use` is the heavier alternative for screen observation.

### 2.12 Event Bus

In-process pub/sub (`core/event_bus/manager.py`) with per-handler isolation. **Verdict: ALREADY BETTER IN HARNESS** — Cordis typed events, waterfalls, and scoped effects (`vendor/cordis`, `docs/cordis-primer.md`).

### 2.13 Workflow Engine

**Design.** `WorkflowDefinition{id, trigger: schedule(cron) | event(topic) | manual, conditions: [{type: context, provider, expr}], actions: [{tool, args, save_as, retry=0, retry_backoff_s=1.0}]}` (`core/workflow/models.py`). Conditions use an AST allowlist evaluator: comparisons, boolean and arithmetic operators, names, and constants only; `eval` runs with empty `__builtins__` (`core/workflow/conditions.py`). Arguments are rendered through Jinja2 `SandboxedEnvironment` (ADR-0004). Runs persist `RUNNING` after each step. Retry applies only to `timeout` and `tool_error`, never to `invalid_args` or `capability_*` (ADR-0008). The engine is a peer of the Kernel and calls the same Tool Gateway with `CallerContext.WORKFLOW`.

**Limitations.** A false condition is recorded as `CANCELLED`. Concurrent runs of one workflow are not deduplicated. There is no engine-side cap on `retry`. A `per_call` tool is always denied in a workflow because no confirmer exists, which is correct fail-closed behavior but makes unattended automations unable to write.

**Verdict: PORT REDESIGNED.** The harness `dsh-workflow` is a different product (model-written orchestration scripts that spawn subagents). Build AIR-style declarative automations on `dsh-schedule` (durable reminders that return to a session as later turns), `dsh-webhook` (event ingress), and `dsh-jobs`. Keep the retry-code rule and the AST condition evaluator. Use a skipped status. For unattended runs, pre-authorize `per_call` capabilities per workflow at registration, through one logged approval.

### 2.14 Configuration, secrets, correlation IDs

`config.yaml` validated with `extra="forbid"`, an `AIR_ENV` overlay deep-merge that fails if the selected overlay is missing, per-plugin `plugin_settings` merged only into that plugin's subprocess environment, and `env:`/`keychain:` key references resolved per call (ADR-0010). **Verdict: ALREADY BETTER IN HARNESS** — cordis.yml with `--patch` overlays, `dsh-settings`, `dsh-credentials`, and the stdio bridge's scrubbed parent environment (`packages/mcp/mcp-client/src/transport.ts` via `dsh-subprocess`). Carry over one rule: a plugin's environment is built explicitly from its declared scope and settings.

### 2.15 SDK, CLI, web UI, and voice

`AIRClient` (`sdk/air_client.py`) was the composition root. The Typer CLI provided `air ask`, `air plugin new`, and `air --version`. The FastAPI web UI provided `POST /api/ask`, `POST /api/voice` (microphone → `transcribe_audio` → ask → `synthesize_speech` → audio), `WS /ws/logs`, and `/health`. `invoke_tool()` with `CallerContext.CLIENT` let the UI call the voice tools without the model. **Verdict:** SDK, CLI, and web UI are **ALREADY BETTER IN HARNESS** (`packages/sdk/*`, `packages/client/*`, `packages/host/webserver`). The voice interaction loop is **PORT REDESIGNED** as a client module that records audio, calls a speech-to-text provider outside the model loop, submits the text as a user turn, and optionally speaks the reply. The loop must not be a model-chosen tool; AIR reached the same conclusion with `CallerContext.CLIENT`. `air plugin new`'s "compute digests from the live server" becomes a `dsh` CLI command in the pinning package.

## 3. Evaluation methodology (RQ1–RQ5)

| RQ | What AIR measured | Credibility | Re-run on harness? |
|---|---|---|---|
| RQ1 standardized execution | Code inspection: eight tool surfaces all reach `ToolGatewayImpl.invoke()` | Architectural argument, not a measurement | No; the harness already has one pipeline. Replace with "pinning and capabilities added with zero `agent-loop` changes" (git diff plus the harness rule that loop changes require updating `docs/architecture.md`). |
| RQ2 security | 10 scripted drift scenarios against `MockMCPServer`, 10/10 detected; 18 fail-closed Capability Manager tests; workflow `per_call` denial; bubblewrap write-outside-scope failure | Detection is tautological for dict hashing; no false-positive or burden measure; description attacks untested; mock rather than real servers; call-time gap untested | Yes, redesigned as below. |
| RQ3 memory | Five records, one query, hashed bag-of-words embedding; hybrid ranks `fresh-note` first, vector-only ranks the stale note first; P@5 = 0.20 for both | Demonstrates the formula's mechanism only; the scenario was constructed to favor hybrid; below any statistical bar | Yes, on public benchmarks. |
| RQ4 extensibility | `git log core/kernel/kernel.py` unchanged since M5 across five plugins | Reasonable at M12. Violated after M12: the Planner's `SYSTEM_PROMPT` and `classifier.py` now name plugin tools ("bluetooth", `browser_read_page`) | Yes: count agent-loop and system-prompt diffs per added plugin. |
| RQ5 overhead | pytest-benchmark: direct call 121 ns vs. full `invoke()` ≈2.16 ms | Honest, but the 17,800× ratio is meaningless, the cost split was asserted without profiling, and the dominant cost (a Python subprocess spawn plus MCP `initialize` on every call) was not measured | Yes, end to end. |

**Stronger evaluations for the final-year project.**
1. **Pinning under real conditions.** Collect the published version history of 20–50 real MCP servers (npm and PyPI releases), start each version, and record the full tool definitions. Report (a) the fraction of benign upgrades that trigger drift (re-approval burden) under inputSchema-only, description-inclusive, and full-definition digests; (b) time-to-detect for polling at 300 s versus event-driven `list_changed` gating; (c) per-tool narrowing versus whole-server quarantine.
2. **Attack suite with attack success rate (ASR).** Rug-pull description change, schema widening, cross-server tool shadowing, a tool added after approval with `list_changed` suppressed, a spoofed `serverInfo.name`, and a scope-argument key the policy does not declare. Measure ASR against real models (the local model plus one hosted model) with and without the pinning plugin. Use an established prompt-injection agent benchmark (for example AgentDojo) as the baseline harness, and compare against `mcp-scan`.
3. **Memory on public benchmarks.** Long-term conversational memory benchmarks such as LongMemEval or LoCoMo, with real embeddings (`nomic-embed-text`). Report Recall@k, MRR, and nDCG; ablate each weight; compare against FTS-only (`dsh-session-query-sqlite`) and a third-party memory MCP server; measure the bleed-through rate as the fraction of turns whose tool choice changes because of recalled memory.
4. **Task-level success.** 30–50 scripted desktop tasks with programmatic verification (file exists with content, calendar row created, Bluetooth state read back) under the local and a hosted model, reporting success, false-success claims (the fake-execution rate), and latency.
5. **Overhead.** Per-call latency through `dsh-tools` with and without the pinning and capability listener, sync-generation pinning cost as a function of tool count, and AIR's spawn-per-call latency as the historical baseline.
6. **Usability, if time allows.** A small study (n ≈ 8–12) of approval prompts that show category, risk, and resource versus generic prompts, measuring correct deny decisions on planted malicious requests.

## 4. Lessons learned as design rules

1. **Pin content, not identity or protocol version.** Hash the full model-visible tool definition (name, description, input and output schema, annotations) with a language-neutral canonicalization (RFC 8785). A description is an instruction channel.
2. **Pin at the point of registration, on the serving connection.** A check on a different process than the one that serves calls is advisory. Gate every sync generation, and deny calls on a drifted server with a guard.
3. **Never trust remote `serverInfo.name`.** Identity is the local configured name plus the raw tool name (ADR-0001 contract 5).
4. **Fail closed on every axis, and test the deny path by asserting non-dispatch.** No answerer, a throwing answerer, an unknown value, or a timeout all mean deny.
5. **A scope policy must name its argument keys explicitly.** A default key list fails open for tools that use other names; reject a scoped capability with no declared keys at load.
6. **Put the granted scope in the tool description.** The model cannot choose valid paths it has never been shown (the path-hallucination fix).
7. **Model-visible means logged, for every input.** Recalled memory, desktop context, and pin verdicts are model-visible; each needs a session event.
8. **Verify after set.** A state-changing tool re-reads the real state and raises on disagreement (`plugins/bluetooth/server.py:set_bluetooth_power`).
9. **Trust execution, not narration.** Detect tool calls written as text, give one corrective nudge, and then say plainly that nothing ran.
10. **Ground answers in tool results only.** The follow-up instruction forbids adding training-data facts to a real result (the fabricated-headlines bug).
11. **Do not auto-store every turn as memory.** Store explicit and summarized facts with their source session and tool call; earlier turns are not instructions for this one.
12. **Stateful tools need a stateful connection.** Spawn-per-call broke `browser_navigate` followed by `browser_snapshot`. Keep one serving process, and declare exclusive scheduling for tools that share page state.
13. **"Install-time confirmation" must be a real prompt with a persisted decision**, not implied by a configuration entry.
14. **Retry only recoverable error codes.** Timeouts and tool errors may be retried; validation errors and denials must not be (ADR-0008).
15. **An API that claims a behavior must have a test that fails without it.** AIR's `cancel()` test passed against a no-op (`docs/PRODUCT_AUDIT.md` §0.2).
16. **Keep the system prompt free of plugin names.** Per-plugin text in a core prompt breaks the extensibility claim (RQ4).
17. **Do not overstate sandboxing.** Process isolation is not a sandbox; a declared `network: false` that nothing enforces is a documentation defect.

## 5. Reusing AIR's Python MCP plugins through `dsh-mcp-client` today

All seven AIR plugins are stdio MCP servers built on the Python SDK v2 `MCPServer`. The harness client uses the official TypeScript SDK 2.0.0 with automatic revision negotiation, so they should connect, but each must be smoke-tested once. Common configuration:

```yaml
- name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: air_calendar
    command: uv
    args: [run, --project, /path/to/AIR, python, -m, plugins.calendar.server]
    cwd: /path/to/AIR
    env: { AIR_CALENDAR_DB: /home/<user>/.air/data/calendar.db }
```

Common caveats:
- AIR's manifest is not read, so there is no pinning and no capability scope until the plugin from 2.1/2.3 exists.
- Scope environment variables must be passed explicitly in `env`, and the plugins fail closed when these are unset.
- The harness scrubs credential-shaped and `DSH_*` variables but otherwise inherits the environment, which is broader than AIR's narrow allowlist.
- Stdio negotiation starts a disposable probe process before the serving process.
- Tools appear as `mcp__<serverName>__<tool>`.
- AIR's `per_call` tools run without prompting unless a `tools/pre-execute` policy returns `ask`.

| Plugin | Reusable today? | What it needs |
|---|---|---|
| `calendar` (`create_event`, `list_events`) | Yes; lowest risk | `AIR_CALENDAR_DB`; local SQLite only. Good first pinning test subject. |
| `bluetooth` (`get_bluetooth_power`, `set_bluetooth_power`) | Yes, Linux | `bluetoothctl` on PATH; an `ask` policy for `set_bluetooth_power` (AIR: `system.device_control`, per_call). Keeps verify-after-set. |
| `clipboard_ocr` (`ocr_read_image`) | Yes, with dependencies | `uv sync --extra ocr`, system `tesseract`, `AIR_OCR_SCOPE`, `AIR_OCR_LANG`. A vision model plus harness attachments may make it redundant. |
| `voice` (`transcribe_audio`, `synthesize_speech`) | Yes, with dependencies | `uv sync --extra voice` (faster-whisper, piper-tts), `AIR_VOICE_SCOPE`, `AIR_WHISPER_MODEL`, `AIR_PIPER_VOICE`; a raised `toolCallTimeoutMs` because the first call loads models. Useful as the speech-to-text backend for a client voice module, not as a model tool. |
| `browser` (6 tools incl. `browser_read_page`, `browser_evaluate`) | Yes | `playwright install chromium`; an `ask` policy for `browser_evaluate`. Under a persistent process its lazy page now survives across calls, which fixes AIR's navigate/snapshot bug but shares one page across sessions. Prefer harness `dsh-browser-use` with its providers for product use. |
| `filesystem` (`read_file`, `write_file`, `list_directory`) | Yes, but redundant | `AIR_FS_SCOPE`; bubblewrap can be put in `command`/`args` by hand. Harness `dsh-tool-fs` with `dsh-fs-sandbox` is better; keep this only as a pinning test fixture. |
| `shell` (`execute`) | Technically yes | Uses `create_subprocess_shell` (`/bin/sh -c`). **DROP**: harness `dsh-tool-bash` with `dsh-bash-sandbox` and approval is strictly better. |
| `_template` | N/A | Port its "compute digest from the live server" idea into the pinning CLI. |

## 6. Mapping table

Effort: S ≤ 3 days, M ≈ 1–2 weeks, L > 2 weeks, for one developer familiar with Cordis.

| AIR component (source) | Verdict | Harness package / extension point | Effort |
|---|---|---|---|
| Manifest tool-pinning (`core/plugin_manager/manager.py`, `mcp_client.py`) | PORT REDESIGNED | New pinning plugin gating `syncTools()` generations in `packages/mcp/mcp-client` (policy hook between fetch and swap) + `ctx.tools.guard()` + session events | L |
| Manifest schema v0.2 (`core/plugin_manager/models.py`) | PORT REDESIGNED | Manifest keyed by `serverName`; JCS digests; loaded by pinning plugin config | S |
| Digest tooling (`air plugin new`, `plugins/_template`) | PORT REDESIGNED | CLI subcommand of the pinning package (live `tools/list` → manifest) | S |
| Tool Gateway (`core/tool_gateway/gateway.py`) | ALREADY BETTER | `@deepseek-ai/dsh-tools` (`packages/core/tools`) | — |
| Capability Manager + scopes (`core/capability_manager/manager.py`) | PORT REDESIGNED | `tools/pre-execute` listener (deny/ask) + `dsh-user-approval`; install-time decision persisted via `dsh-storage` | M |
| Capability taxonomy (`core/capability_manager/taxonomy.py`) | PORT AS-IS | Data table in the capability plugin; category and risk on approval requests | S |
| Approval Manager (`core/capability_manager/approval.py`) | ALREADY BETTER | `dsh-user-approval`, client `ui-approval`, `dsh-permission-presets` | — |
| Bubblewrap PoC (`core/plugin_manager/bubblewrap.py`) | PORT REDESIGNED | `dsh-sandbox` / `dsh-sandbox-local` wrapping MCP stdio argv | M |
| Audit log + model-visible-means-logged (`core/logging/logger.py`) | ALREADY BETTER | Session log (`packages/session/*`), `dsh-invariants` | — |
| Correlation IDs / OTel (ADR-0009) | ALREADY BETTER | Session ids, `dsh-session-telemetry-otel` | — |
| Kernel (`core/kernel/kernel.py`) | ALREADY BETTER | `dsh-agent-loop`, `dsh-session` | — |
| Planner loop (`core/planner/planner.py`) | ALREADY BETTER | `dsh-agent-loop`, `dsh-repeat-tool-reminder`, `dsh-tool-call-timeout-policy` | — |
| Fake-tool-call detection | PORT REDESIGNED | Optional local-model guard plugin injecting a logged correction | S |
| Keyword-gated system prompt | DROP | — | — |
| Model Router retry/fallback (`core/model_router/router.py`) | ALREADY BETTER | `dsh-llm-retry`, `dsh-llm-pi-ai` custom provider (Ollama via `openai-completions`), `dsh-credentials` | — |
| Fast/deep routing (`core/model_router/classifier.py`) | PORT REDESIGNED (optional) | Per-turn model-selection plugin with logged decision | M |
| Memory Engine (`core/memory/*`) | PORT REDESIGNED | New `memory` capability seam; SQLite FTS5 + vector provider; tools + logged auto-recall; baselines `dsh-session-query-sqlite`, memory MCP servers | L |
| Context Engine (`core/context/*`) | PORT REDESIGNED | `desktop-context` plugin on the `dsh-time-context` pattern; `dsh-computer-use` as heavy alternative | M |
| Event Bus (`core/event_bus/manager.py`) | ALREADY BETTER | Cordis events (`vendor/cordis`) | — |
| Workflow Engine (`core/workflow/*`) | PORT REDESIGNED | `dsh-schedule`, `dsh-webhook`, `dsh-jobs`; declarative definitions + AST conditions + retry-code rule | L |
| Config overlays, key rotation (ADR-0010) | ALREADY BETTER | cordis.yml `--patch`, `dsh-settings`, `dsh-credentials` | — |
| AIR SDK, CLI, web UI (`sdk/`, `cli/`, `web/`) | ALREADY BETTER | `packages/sdk/*`, `packages/client/*`, `packages/host/webserver` | — |
| Voice interaction (`web/server.py` `/api/voice`) | PORT REDESIGNED | Client module + speech-to-text/text-to-speech provider (AIR `voice` server usable as backend) | M |
| Calendar, Bluetooth, OCR, Voice plugins | PORT AS-IS | `dsh-mcp-client` stdio entries (section 5) | S each |
| Browser plugin | ALREADY BETTER | `dsh-browser-use` + providers (AIR server usable as a fixture) | — |
| Filesystem, Shell plugins | DROP (keep FS as fixture) | `dsh-tool-fs` + `dsh-fs-sandbox`; `dsh-tool-bash` + `dsh-bash-sandbox` | — |
| RQ1–RQ5 evaluation (`tests/security`, `tests/evaluation`) | PORT REDESIGNED | Real-server drift corpus, ASR attack suite, LongMemEval/LoCoMo, task benchmark, end-to-end overhead | L |

## 7. Recommended porting order

1. Connect `calendar` and `bluetooth` through `dsh-mcp-client` to establish a working stdio baseline and a fixture for the attack suite (S).
2. Build the pinning plugin with full-definition JCS digests, generation gating, a drift guard, and session events, then run the real-server drift corpus. This is the research core (L).
3. Add the capability and scope `tools/pre-execute` listener with a real install-time approval (M).
4. Build the memory seam and the desktop-context plugin, both logged, with the memory benchmarks run alongside (L + M).
5. Add scheduled and declarative workflows and the voice client module only after the evaluations above have results.

One caution for the write-up: ADR-0001 describes deepseek-harness at release v0.1.5-rc.2 with the MCP TypeScript SDK v1. The fork now uses SDK 2.0.0 with list-change subscriptions, so the prior-art section must be re-derived from the fork rather than cited from ADR-0001.
