# 12. Hybrid local and cloud operation: literature, design options, security, and research design

Date: 2026-10-03. Scope: research only; nothing was built or run for this note. Labels: **MEASURED** (taken from note 10's probes on the project laptop), **CLAIMED** (a number stated by a paper or vendor, not reproduced here), **ESTIMATE** (arithmetic on stated assumptions), **VERIFIED IN CODE** (read in this repository on 2026-10-03), **RECALLED** (from vendor or paper material read before this note and not re-fetched today; verify before citing).

Owner position: the research focus stays a local harness on the laptop; hosted keys exist and may be used together with local models where that helps the product or the research design.

## 1. Summary

1. The harness already has the mechanisms hybrid operation needs. Any plugin can replace the provider, model, and reasoning effort for a step through the `agent/request` waterfall; a failed request re-enters that waterfall on retry; subagents accept their own provider and model; every outbound request passes the `llm/stream` waterfall. No in-tree change is required for options (a)–(f) below, with two ordering questions to settle in a half-day spike (§3.7).
2. What was routed is already in the session log: each change of provider or model appends a `request/header` event with reason `change`, and each `assistant/message` carries its `provider` and `model`. Why it was routed is not, and belongs in an AIR-owned JSONL sidecar.
3. The published gains for routing are large but are CLAIMED on chat and question-answering sets between two hosted models. Results for tool-calling agents are recent and fewer (Switchcraft, May 2026). None measures a local 7–9B model against a hosted model inside an agent harness with injection attacks present, which is the gap AIR can fill.
4. Hybrid operation is a security change, not only a cost change: a stronger cloud model is, per AgentDojo and MCPTox, more likely to carry out an injected instruction, and escalation sends local tool results, memory recall, and desktop readings off the machine. The privacy gate and the egress counter therefore come before any automatic router.
5. Recommendation: build an egress ledger plus a "local-only" session lock first (about 3–4 days, phase 1), then a manual "ask the cloud model" subagent (configuration plus 2–3 days, phase 2). Run one experiment: always-local and always-cloud on the 286-episode AgentDojo subset, with random, oracle, and restart-cascade routers computed offline from those two logs (about 3 days of work, under $5 of hosted calls by the spike 06 assumptions).

## 2. Literature and practice, 2024–2026

### 2.1 Routing and cascades

| Work | What it does | Gains | Cost and requirements |
| --- | --- | --- | --- |
| FrugalGPT ([arXiv 2305.05176](https://arxiv.org/abs/2305.05176)) | Cascade: call cheap models first, a learned scorer decides whether to accept or continue | CLAIMED, RECALLED: matches the best single model with up to 98% lower cost on its query sets | Needs a scorer trained per task; every escalated query pays for both calls |
| AutoMix ([arXiv 2310.12963](https://arxiv.org/abs/2310.12963)) | Small model answers, then verifies itself few-shot; a POMDP router decides on escalation | CLAIMED (abstract, fetched 2026-10-03): over 50% lower computational cost for comparable performance, five models, five datasets | One extra verification call on the small model; no training set |
| Hybrid LLM ([arXiv 2404.14618](https://arxiv.org/abs/2404.14618), ICLR 2024) | A classifier predicts query difficulty and sends the query to a small (edge) or large (cloud) model, with a quality threshold tunable at run time | CLAIMED (abstract, fetched 2026-10-03): up to 40% fewer large-model calls with no quality drop | Trained router; decides before any generation, so no double payment |
| RouteLLM ([arXiv 2406.18665](https://arxiv.org/abs/2406.18665)) | Routers trained on human preference data choose a strong or weak model per query | CLAIMED, RECALLED: cost reduced by more than two times without quality loss in the abstract; the project page reports larger savings on MT-Bench | Preference data; evaluated on chat and QA, not tool use. Defines the metrics reused in §5: call-performance threshold and average performance gap recovered |
| RouterBench ([arXiv 2403.12031](https://arxiv.org/abs/2403.12031)) | Benchmark of more than 405k cached model outcomes for comparing routers offline | Finding, RECALLED: simple routers are close to learned ones; the oracle is far above both | Shows the method AIR can copy: evaluate routers offline from per-model logs |
| RouterArena ([arXiv 2510.00202](https://arxiv.org/abs/2510.00202)) | Open platform and leaderboard for routers: dataset with domain coverage and difficulty levels, several metrics | No single headline number in the abstract (fetched 2026-10-03) | Chat-style queries; useful for metric definitions |
| Switchcraft ([arXiv 2605.07112](https://arxiv.org/abs/2605.07112), 8 May 2026) | Router for agentic tool calling; DistilBERT classifier picks the cheapest model expected to be correct | CLAIMED (abstract, fetched 2026-10-03): 82.9% accuracy on five function-calling benchmarks, matching or exceeding the best single model, at 84% lower inference cost; also reports that larger models do not consistently win on tool use and that cheaper models can cost more through long reasoning | Trained classifier; single-call function-calling sets, not multi-step episodes |
| Carbon-aware routing ([arXiv 2609.13559](https://arxiv.org/abs/2609.13559), 11 Sep 2026) | k-NN predictor estimates accuracy, delay, and power per edge tier and routes function-calling queries to the lowest-emission tier that can succeed | CLAIMED (abstract, fetched 2026-10-03): matches cloud accuracy with 4 times lower operational carbon on average | Shows energy as a routing objective and BFCL as the tool-use set |

Reading for AIR: (i) pre-generation routers avoid double payment but need training data AIR does not have; (ii) cascades need no training but pay twice on escalation and, in an agent, the first attempt may already have caused side effects; (iii) the two 2026 tool-calling results both report that model size is a poor predictor of tool-call correctness, which matches note 10's observation that the 7B model completed native tool calls. The earlier AIR project's keyword fast/deep classifier (note 02 §2.9) never had its accuracy measured; any successor must be evaluated against random and oracle routers.

### 2.2 Local and cloud models collaborating over private data

- **Minions and MinionS** ([arXiv 2502.15964](https://arxiv.org/abs/2502.15964), 21 Feb 2025). A local model that holds the long private context converses with a cloud model that never reads it. CLAIMED (abstract, fetched 2026-10-03): the plain chat protocol cuts remote cost 30.4 times and recovers 87% of the frontier model's performance; MinionS, where the cloud model decomposes the task into subtasks that the local model runs over document chunks in parallel, cuts cost 5.7 times on average and recovers 97.9%. The paper names two local-model weaknesses: following multi-step instructions and reasoning over long contexts. Harness needs: a cloud agent whose context is only the task and the local model's short answers, and a local worker with the data. An Ollama integration exists (RECALLED).
- **PAPILLON** ([arXiv 2410.17127](https://arxiv.org/abs/2410.17127)). "Privacy-conscious delegation": a local model rewrites the user request into a query without personal information, a hosted model answers, and the local model composes the final reply. CLAIMED (abstract, fetched 2026-10-03): high response quality kept for 85.5% of queries with 7.5% leakage on the PUPA benchmark, with a stated remaining gap to the hosted model alone. Harness needs: a local rewriting step before each cloud call and a leakage metric. A 7.5% leak rate means redaction by a small model is a mitigation, not a guarantee.
- **Planner and executor splits.** The dual-model pattern and CaMeL ([arXiv 2503.18813](https://arxiv.org/abs/2503.18813)) let a privileged model plan from the trusted user request only, while a quarantined model reads untrusted data and cannot call tools; CaMeL reports provable security on a majority of AgentDojo tasks (RECALLED; check the current abstract for the figure). The mapping to hybrid operation is direct: a cloud planner that sees only the user's request, and a local quarantined reader for private and untrusted content, gives privacy and injection resistance from the same separation. The reverse split (local plans, cloud executes tools) sends tool results off the machine and has neither benefit.

### 2.3 Products

Statements in this subsection are RECALLED unless a URL and date are given.

- **Apple Intelligence and Private Cloud Compute** ([security.apple.com/blog/private-cloud-compute](https://security.apple.com/blog/private-cloud-compute/)): on-device models first; larger requests go to Apple-silicon servers with stateless processing, no privileged runtime access, non-targetable requests, and publicly inspectable software images. The split is decided by the system, and requests to a third-party model ask the user each time. Lesson: escalation to a different trust domain is a per-request user decision; escalation within the vendor's attested domain is silent.
- **Google**: Gemini Nano on device through Android AICore, and Private AI Compute (announced November 2025) for cloud processing inside attested enclaves. Lesson: same two-tier pattern; attestation is the mechanism that makes silent escalation acceptable, and a student project cannot offer it for third-party APIs.
- **Microsoft Copilot+ PCs**: Phi Silica on the NPU for local tasks, cloud models for the rest; "hybrid loop" was Microsoft's name for applications that decide at run time between local and Azure inference.
- **Ollama cloud models**: models tagged `-cloud` run on Ollama's servers through the same local API after `ollama signin` ([blog, 19 Sep 2025](https://ollama.com/blog/cloud-models)). Since 31 Aug 2026 plans are per-token: Pro $20 per month including $60 of usage, Max $100 including $300, a free tier with a starter amount, zero data retention, hosting in the US and Europe plus Singapore for some Qwen models ([blog, fetched 2026-10-03](https://ollama.com/blog/transparent-pricing)).
- **LM Studio and Jan**: both run local models behind an OpenAI-compatible server; Jan also lets the user add hosted provider keys and pick a model per thread. Neither routes automatically. This is option (a) below and is what the harness already does.

Common practice outside research is manual choice plus fallback chains (for example LiteLLM-style gateways); automatic difficulty routing is rare in shipped local-first assistants.

## 3. Design options for AIR, mapped to the harness

Extension points, VERIFIED IN CODE:

- `agent/request` waterfall (`packages/core/agent/src/runtime-types.ts`): a listener awaits `next()` and may return a replacement `LlmCallConfig` (`provider`, `model`, `reasoningEffort`, `temperature`, `maxTokens`, `stop`; `packages/llm/llm/src/call-config.ts`). It runs once per request attempt, after assembly and before the prompt is committed, and cannot change messages.
- `agent/pre-step` waterfall: may reject a step or replace the user messages entering it; everything it adds is logged as `user/message`.
- `agent/request-error` waterfall: a listener may return `{ kind: 'retry' }`. The loop in `packages/core/agent-loop/src/agent.ts` then calls `prepareRequest` again, which dispatches `agent/request` again, so the retry can use a different route.
- `llm/stream` waterfall (`packages/llm/llm/src/index.ts`): wraps every model call with the full `GenerateOptions` (provider, model, messages, tools, `sessionId`, `purpose` for compaction and session-title calls).
- Model selection: `installModelSelection` (`packages/core/agent/src/model-selection.ts`) couples a per-agent `ModelSelectionRef` to prompt assembly and to `agent/request`, and appends a logged user-role notice ("model changed: ...") when the provider or model differs from the last `request/header`. Entry points that own a selection: `packages/api/session-controller` (remote method `selectModel`), `packages/acp/acp/src/model-control.ts`, `packages/bundle/headless`. The default comes from `ctx.agentDefaultModel.currentSelection()` (`packages/core/agent-default-model/src/index.ts`).
- Subagents: the `tool-subagent` config takes `agentOptions.provider` and `agentOptions.model`, a `toolFilter` with `allow` and `deny` lists, and optional `modelSelectionSettings` backed by exact allowed routes (`packages/subagent/tool-subagent/src/index.ts`, `model-selection.ts`, `list-models.ts`). Without overrides a child inherits the parent's provider and model (`packages/subagent/subagent/src/child-agent.ts`).
- Providers: Ollama as a custom `openai-completions` route of `llm-pi-ai` (`air/examples/ollama.profile.cordis.patch.yml`); catalog and custom routes described in `docs/user/guide/providers.md`. The `llm` package has no notion of a local or remote provider; AIR must declare which provider ids are on-device.
- Durable record: `request/header` events with reason `initial | resume | change | series` hold the call configuration (`packages/core/session/src/types.ts`); `assistant/message` holds `source.provider`, `source.model`, and `usage`.

### 3.1 (a) Manual per-session choice

Exists. The user picks a route in the model picker; the switch notice and the `change` header are logged. Feasibility out of tree: nothing to build beyond declaring both routes in the `air` profile. Logging: complete in the session log. Gap: nothing tells the user that the chosen route leaves the machine, and nothing stops a switch in a session that already contains private context.

### 3.2 (b) Per-turn router plugin

An AIR plugin listens on `agent/request`, computes a decision at step 1 of each turn, and returns the chosen route for every step of that turn. Signals available without a model call: the offered tool set (from the last `request/header`), user-message length, presence of attachments, the session's sensitivity label (3.5), local server health. A small classifier or a local-model self-rating can be added later.

Granularity matters. MEASURED in note 10: re-evaluating a 7.9k-token prefix locally costs 3.4–4.9 s against 0.03–0.04 s when cached. Hosted cache-miss input costs 50 times the cache-hit price at DeepSeek (§6). A router that alternates per step loses both caches and, if it drives the selection ref, adds a model-visible notice each time. Route per turn or per task, not per step.

Feasibility: out of tree. Open points for the spike (§3.7): listener order against `installModelSelection`, which also rewrites the route in `agent/request`; and the system-prompt variables `provider` and `model`, which are set at assembly from the selection and would be stale if only `agent/request` changes the route. The cleaner design is for the router to set the session's selection through the same path the picker uses, so the notice and prompt variables stay consistent; whether an in-process plugin can reach that path without the remote API was not verified.

Logging: the route is in `request/header` and `assistant/message`. The reason (rule id or classifier score, features, candidate routes, sensitivity label, router version) goes to `route-audit/<sessionId>.jsonl`, one line per turn keyed by turn and step, following the `mcp-audit` sidecar pattern. No new session event type.

### 3.3 (c) Cascade: local first, escalate on evidence

Triggers, in order of reliability: explicit user request ("try the bigger model"); request failure or malformed tool call (through `agent/request-error`); repeated tool errors or a turn ending with no tool call where tools were expected (observed from session events); low self-rated confidence from the local model (an extra local call; AutoMix-style, least reliable on a 7–9B model).

Two forms. *Continue*: the next step of the same turn runs on the cloud model with the full history; cheap to build, but the whole context is sent off-device in one request. *Restart*: the task is re-run from the user message on the cloud model; cleaner for evaluation, but side effects of the local attempt remain. The product should use continue-on-request (user-triggered) first; automatic escalation must pass the privacy gate.

Feasibility: out of tree with `agent/request` plus `agent/request-error`; `llm-retry` also listens on `agent/request-error`, so ordering needs the same check as 3.2. Logging: as 3.2, plus the trigger and the count of tokens the escalation sent.

### 3.4 (d) Role split

- *Local main agent, cloud subagent.* Configuration only: a second `tool-subagent` entry with `agentOptions` naming the hosted route and a `toolFilter` that removes file, shell, memory, and desktop tools, so the child can reason but cannot read the machine. What leaves is exactly the prompt the local model wrote plus the child's own output; both are in the child session log. This is the Minions pattern with the harness's existing parts. The weakness is the one Minions reports: a small local model writes poor delegations. A user-invoked command ("ask the cloud model about this") avoids relying on the local model to decide.
- *Cloud planner, local executor.* The main agent runs on the hosted route with tools filtered to delegation only; a local subagent holds the tools and the private data and returns summaries. This gives the CaMeL-style separation, but the local model's summaries flow back to the cloud, so redaction quality bounds privacy, and note 10's 16k local window bounds what the executor can read.

Feasibility: both out of tree; the second needs prompt work and is a research track, not a product default. Logging: child sessions are durable and carry their own headers; the delegation prompt is in the parent's `tool/call`.

### 3.5 (e) Privacy gate and visible routing

Three parts.

1. **Label.** AIR-owned session state records which sensitive sources have entered context: memory recall (source-labelled messages from the memory plugin), desktop readings, file contents outside the workspace, MCP results from servers marked private. Labels are monotonic for a session, the same state machine plan 03 proposes for taint.
2. **Enforce.** A listener on `llm/stream` checks every outbound call, including compaction, session titles, and subagents: if the provider id is not in AIR's on-device list and the session carries a label the policy forbids, the call is refused with a clear error, or the route is forced local earlier in `agent/request`. Enforcement at `llm/stream` is the backstop because it sees calls the agent loop does not make.
3. **Redact, with care.** Rewriting messages inside `llm/stream` would make the model see text that differs from the log, which breaks the repository rule that model-visible content is reconstructable from the session log. Redaction therefore has to happen on logged channels: the redacted text is what gets appended (for example a subagent prompt composed by a local rewriting step), never a silent rewrite of history. PAPILLON's 7.5% leakage is the reason to treat redaction as a reduction, and to keep "forbid" as the default for labelled sessions.

Visible indication: each assistant message already stores provider and model; a per-message badge and a session-level "off-device tokens" counter need a client change whose slot was not verified here. Logging: an egress ledger `egress/<sessionId>.jsonl` with one line per outbound non-local request (turn, step, provider, model, purpose, input and output tokens from `usage`, labels present, decision).

### 3.6 (f) Offline and failure fallback

Cloud to local: on a network failure, `agent/request-error` returns `retry` and `agent/request` switches to the Ollama route; the context must fit the local window, so the plugin has to check token count against the declared `contextWindow` and otherwise fail with a message. Local to cloud (Ollama down or context truncated): allowed only if the privacy gate permits, and never silently. A startup health check (`/api/ps`, as note 10 §5.2 already requires) sets the initial route. Logging: the `change` header plus a ledger line with the failure code.

### 3.7 Half-day spike before any of this

Confirm with a throwaway plugin: (1) listener order between an AIR `agent/request` listener, `installModelSelection`, and `llm-retry`; (2) that a retry after `agent/request-error` reaches the new route and that the switch notice appears; (3) that `llm/stream` listeners see subagent and compaction calls with a usable `sessionId`; (4) that the `openai-completions` Ollama route and a hosted route can alternate in one session without tool-history projection errors.

## 4. Security and privacy analysis

**What leaves the machine on a cloud request.** The whole request: system prompt (including instruction files and skill text), all prior user and assistant messages, every tool result still in context (file contents, shell output, MCP results), recalled memories, desktop readings, and tool schemas (which reveal installed MCP servers). After one escalation in "continue" form, everything earlier in the session has left. Auxiliary calls (compaction, titles) send the same history if they use a hosted route.

**Data-flow labelling.** Two independent labels per context item: *confidentiality* (may this leave the device) and *integrity* (did this come from an untrusted source). Plan 03's taint tracking is the integrity label; the privacy gate adds the confidentiality label. They share the same carrier (message source kinds and AIR session state) and should share one implementation.

**Interaction with permission rules.** A route change is an egress action and belongs in the same rule store as tool permissions: "cloud route allowed for this session", "never for sessions with memory recall", with the same ask, allow-once, allow-always choices. Upstream's Auto review rates tool calls with the session's own model (note 11); in a hybrid session that reviewer changes strength when the route changes and would send tool-call arguments to the cloud. Pin the reviewer to one route.

**Interaction with MCP trust.** Pinning (RQ1) is model-independent and unaffected. Two additions: tool schemas and server instructions are part of what a cloud model receives, so a private server's surface is itself disclosed; and a hosted provider with server-side tools would add an unpinned tool surface, so hosted routes should be used for text generation only.

**Injection across the boundary.**

- *Local content attacking the cloud model.* Tool results and recalled memory containing an injection are forwarded on escalation. AgentDojo's authors and MCPTox both report that more capable models are more likely to carry out injected instructions (note 10 §10). Escalation can therefore raise attack success on exactly the hard, tool-heavy tasks that trigger it. The deterministic defences (scopes, approvals, taint escalation) apply regardless of route and are the control here.
- *Attacker-forced escalation.* If escalation triggers on tool failure or on text in tool results, an attacker who controls a tool result can force a cloud call and so exfiltrate context to the provider's logs. This is not exfiltration to the attacker, but it defeats a local-only promise. Triggers must not depend on untrusted content while the session is labelled private.
- *Cloud output attacking the local side.* A cloud subagent's result is model-generated text built from whatever it read; treat it as untrusted input to the local agent (taint it), especially when the cloud agent has web tools.
- *Restart cascades double exposure.* An attack succeeds if it succeeds in either attempt, so attack success under a restart cascade is at least the local rate on escalated tasks.
- *Provider trust.* Retention and training terms differ per provider and per tier; a gateway adds a second party. Record the provider and endpoint in the ledger so exposure can be audited later.

## 5. Research design

### 5.1 Local, cloud, and hybrid as a factor

- **RQ1 (pinning)** is model-independent; no model factor. State this once.
- **RQ2 (injection defences, AgentDojo).** Factor *route* with levels local, cloud, hybrid, crossed with the existing defence arms H0 and H-all. The floor-effect problem (note 10 §10) means the local level may show low undefended attack success because the agent fails to act; the cloud level supplies the headroom to show a reduction, and the deterministic defences should block at the same rate at every level. A difference in block rate across levels would indicate a defence that depends on model behaviour, which is itself a finding. Always report the four quantities note 10 lists (utility, utility under attack, attack success, share of episodes with a valid tool call) plus attack success conditional on the injection having been read.
- **RQ3 (memory, LongMemEval).** Route applies to two roles separately: the memory *extractor* and the *answerer*. A useful hybrid cell is local extraction (private history never leaves) with a cloud answerer that sees only retrieved snippets; its off-device token count against the full-context cloud arm is a direct privacy measure.
- **RQ5 (overhead).** Report per-step latency and tokens by route; add the router's own decision time and the cost of a route switch (cache loss), which note 10 measured locally at 3.4–4.9 s for a 7.9k-token prefix.

### 5.2 Outcome metrics

| Metric | Definition | Source |
| --- | --- | --- |
| Utility, attack success | Benchmark scoring | AgentDojo, LongMemEval judge |
| Hosted cost | Tokens by cache state times list price on the run date, peak or off-peak stated | `assistant/message.usage`, price table in the run manifest |
| Latency | Time to first token and wall clock per step and episode, arms interleaved | Session events (spike 06 §5.2) |
| Local energy | GPU power sampled at 1 Hz (`nvidia-smi`) plus CPU package energy (RAPL), integrated per episode, idle baseline subtracted | New sampler in the eval driver; MEASURED once built. Cloud energy is not observable and is not estimated |
| Privacy exposure | Input plus output tokens sent to non-local providers per episode; share of all tokens; count of episodes with any off-device request; for labelled runs, off-device tokens that carry a sensitive label | Egress ledger or, offline, `usage` joined with `source.provider` |
| Escalation rate | Share of tasks or turns sent to the cloud | Route audit |
| Routing quality | Performance gap recovered: (hybrid − local) / (cloud − local); area under the utility against cloud-share curve, as in RouteLLM | Computed |

### 5.3 Proposed RQ7: privacy-aware hybrid routing

**Question.** On agent tasks, how much of the utility gap between a local 7–9B model and a hosted model can a router recover per token sent off-device, and does routing change attack success under the AIR defences?

**Arms.** Always-local; always-cloud; random router at matched escalation rates (10 seeds, computed); oracle router (cloud only where local fails and cloud succeeds, computed); rule router on pre-task signals (offered tools, suite, prompt length); restart cascade with log-observable triggers (invalid tool call, no tool call, step limit). All but the first two are computed offline from the two single-model logs, the RouterBench method, because per-task outcomes of each model are all a task-level router needs. A cascade's cost is local plus cloud on escalated tasks; its attack success counts an attack that succeeded in either attempt.

**Hypotheses.** H1: a rule or cascade router recovers more of the gap than random at the same cloud share. H2: the oracle shows that a minority of tasks account for the gap (the oracle's cloud share is well under 100%). H3: with H-all on, attack success under routing is not higher than always-local by more than the interval width; with H0 it is.

**Threats.** Routers tuned and tested on the same 37 user tasks overfit: fix rules before looking at cloud results, or split by suite. Offline cascades ignore side effects of the first attempt. A live "continue" cascade cannot be computed offline and is a stretch arm.

### 5.4 Feasible run matrix

Time and cost figures are ESTIMATES from note 10 §9 and spike 06 §1.5 and inherit their assumptions (n = 5 pilot basis; assumed token counts).

| Run | Set | Where | Estimate |
| --- | --- | --- | --- |
| Local H0, `qwen2.5:7b-instruct` | banking + slack, 286 episodes | laptop | 0.7–2.2 h |
| Local H-all | same | laptop | 0.7–2.2 h |
| Cloud H0, `deepseek-flash` | same | hosted | about $0.9 (286/1,046 of the $3.3 full-run assumption), under 15 min with 8 workers |
| Cloud H-all | same | hosted | about $0.9 |
| RQ7 routers | same | offline analysis of the four logs | no model calls |
| Stretch: live continue-cascade, H-all | same | laptop plus hosted | one local arm plus the escalated share of a cloud arm |
| Already planned: full v1.2.2 main arms | 1,046 episodes | local once (4–8 h each), hosted repeats | unchanged from note 10 §9.5 |

The hybrid factor adds no new long local runs: the two local subset arms are already in note 10's plan, and the cloud arms are the "stronger hosted model" comparison it recommends. For RQ3, add one cell (local extractor, cloud answerer over retrieved snippets) to the existing arms.

## 6. Cloud models and prices (checked 2026-10-03)

| Model | Input per 1M (cache miss / hit) | Output per 1M | Source |
| --- | --- | --- | --- |
| `deepseek-flash` (DeepSeek V4.1 Flash), off-peak | $0.15 / $0.003 | $0.60 | [DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing/), fetched 2026-10-03. Peak hours are double per secondary sources ([CostGoat](https://costgoat.com/pricing/deepseek-api)), which give peak as 01:00–04:00 and 06:00–10:00 UTC on weekdays |
| `deepseek-v4-pro`, off-peak | $0.66 / $0.022 | $1.98 | same |
| OpenAI GPT-5.6 Luna | $0.20 (cached $0.02) | $1.20 | secondary: [gitautoreview table](https://gitautoreview.com/tools/llm-pricing), which states provider docs verified 2026-09-05; confirm on the provider page before budgeting |
| Google Gemini 3.8 Flash | $0.75 (cached $0.075), introductory until 2026-12-31, then $1.50 | $3.75, then $7.50 | secondary: [BenchLM](https://benchlm.ai/google/api-pricing), October 2026; official page at [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing) |
| Anthropic Claude Haiku 4.5 | $1.00 | $5.00 | secondary, same table |
| Anthropic Claude Sonnet 5 | $2.00 (cache hit $0.20) | $10.00 | secondary, same table |

Some third-party pages still list DeepSeek Flash at $0.14 and $0.28; the official page is the authority, and the run manifest must record the price and the peak or off-peak window used. AgentDojo's published baselines and the official LongMemEval judge use `gpt-4o-2024-08-06`; its current price was not fetched for this note.

Choice for the hybrid arm: `deepseek-flash` as the cloud level (cheapest, already a first-class provider in the harness, already the planned repeat model), plus one stronger model for a single confirmation run of H0 and H-all on the subset if budget allows; Sonnet 5 or GPT-5.6 Terra class models are the ones recent agent papers report.

**Would Ollama cloud or OpenRouter simplify setup?**

- *Ollama cloud.* One daemon and one API for both levels, which simplifies configuration. Against it: the local daemon forwards cloud requests, so the provider id and base URL (`127.0.0.1:11434`) look local; a privacy gate keyed on provider or host would be wrong unless it also inspects the model tag. Model choice is limited to open-weight models, and per-model token prices were not fetched here. Not recommended for the research arm; acceptable as a user-chosen product route if AIR treats `-cloud` tags as off-device.
- *OpenRouter.* One key for many models, no markup on provider token prices, a 5.5% fee on credit purchases, prompts not logged unless the user opts in ([FAQ, fetched 2026-10-03](https://openrouter.ai/docs/faq)). It adds a second party to the data path, and the serving provider can vary between requests unless pinned, which harms reproducibility. Use it only for a one-off stronger-model confirmation run, with the provider pinned and recorded.
- *Direct provider keys* remain the simplest reproducible choice: the harness already ships the DeepSeek adapter and catalog routes for the other vendors.

## 7. Recommendation

**Product.**

1. *Phase 1 (with the permission work): egress ledger and local-only lock.* AIR declares which provider ids are on-device; an `llm/stream` listener writes one ledger line per off-device request and refuses off-device calls in sessions the user marked local-only or that carry a forbidden label. Shows a session-level count of off-device tokens. ESTIMATE: 3–4 days including the §3.7 spike and tests; the client badge is extra and depends on the UI slot. This is the smallest feature that makes any later hybrid behaviour honest, and it is useful with manual switching alone.
2. *Phase 2: user-invoked cloud consult.* A filtered cloud subagent with no local tools, started by an explicit command, with the outgoing prompt shown for approval. ESTIMATE: configuration plus 2–3 days for the approval text and ledger wiring.
3. *Phase 2 or later: failure fallback* (3.6), cloud to local only. ESTIMATE: 2 days.
4. *Not now:* an automatic difficulty router. Build it only if RQ7's offline analysis shows a rule router beating random by a clear margin.

**Research.** Run the four subset arms of §5.4 and the offline router analysis, with the energy sampler and the off-device token metric. ESTIMATE: 1 day for the energy sampler and the egress computation in `air_eval`, 1 day for the offline router script and its tests, about half a day of supervised run time (two local arms at 0.7–2.2 h each, two hosted arms in minutes), half a day for tables; hosted cost under $5 by the spike 06 assumptions. This yields the route factor for RQ2, the first RQ7 result with all four baselines, and the privacy-exposure metric, without adding any multi-hour local run to the existing plan.

## 8. Open items

- Listener ordering and prompt-variable consistency for route changes made in `agent/request` (§3.7).
- Whether an in-process plugin can set a session's model selection through a public service rather than the remote `selectModel` method.
- Whether `reasoning_effort` reaches Ollama through the `openai-completions` route (already open in note 10).
- Client slot for a per-message route badge.
- Current figures for CaMeL, FrugalGPT, RouteLLM, and RouterBench marked RECALLED above; fetch the abstracts before quoting them in the report.
- Official price pages for the OpenAI, Anthropic, and Google rows.
