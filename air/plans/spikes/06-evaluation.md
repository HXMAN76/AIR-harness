# Spike 06: evaluation harness for RQ1–RQ6

Status: research spike, 2026-09-30. Checked against this checkout at upstream dsh 0.2.0-rc.2 and against shallow clones of each benchmark repository made on 2026-09-29/30. It answers how to run the research questions in [research/research.md §6](../../../research/research.md) and [research/notes/07-product-fyp-strategy.md §3–4](../../../research/notes/07-product-fyp-strategy.md) on this harness. It builds on [spike 03](03-mcp-trust.md) (MCP trust, sidecar audit) and [spike 04](04-memory-context-permissions.md) (memory, permissions). Every number marked **assumption** is a planning figure and must be replaced by a value measured in the pilot (section 8).

## 0. Findings that change the research design

1. **AgentDojo's "629 attacks" is the v1 count; the default benchmark is now v1.2.2 with 949.** Counted by loading the suites from the cloned repository: v1 has 97 user tasks, 27 injection tasks, 629 user×injection pairs. v1.2.2 (the `--benchmark-version` default) has the same 97 user tasks but 35 injection tasks (workspace grew from 6 to 14), giving 949 pairs. RQ2 must state which version it uses. Recommendation: run v1.2.2 as the primary set (current, fixed task bugs) and report v1 only if a comparison with older published numbers needs it.
2. **The SDK wire protocol has three methods only: `initialize`, `session/prompt`, `shutdown`** (`packages/sdk/protocol/src/types.ts`, `HarnessSdkRequestMap`). There is no client-provided tool and no approval channel. AgentDojo's Python tools must therefore reach the harness as an MCP server, and every approval decision in an evaluation run must come from an in-process answerer plugin, not from the Python driver.
3. **The AgentDojo environment must stay in the Python process.** Utility and security checks read the mutated `task_environment` and the function-call trace from the returned messages. The adapter therefore serves the suite's `FunctionsRuntime` over an in-process MCP server bound to the live `env` object, and one harness runtime plus one MCP server forms one worker (MCP calls carry no session id, so two concurrent sessions cannot share a bridge).
4. **Out-of-tree plugins cannot write custom session event types** (spike 03 §0.1, spike 04 §0.1). Evaluation metrics come from standard session events (`assistant/message.usage`, stream timings, `tool/call`, `tool/result`, `approval/asked`, `approval/decided`, `turn/end`), from the `session-stats` field definitions recomputed in Python, and from AIR-owned JSONL audit files (MCP trust audit, permission audit, memory extraction log). No evaluation feature may add a `SessionEventMap` member.
5. **MCPTox has no licence file** (the repository's issue #5 asks for one). Use it for research with citation, fetch it at run time into a git-ignored directory, and never commit its data into this repository. MSB is MIT; LongMemEval code and data are MIT; AgentDojo is MIT; MCP-Bench's README declares Apache-2.0 but the clone has no `LICENSE` file.
6. **MCPTox poisons by adding a new tool**, not by editing an existing one. Its 45 servers each gain a tool such as `qubit` whose description instructs the agent to misuse other tools. Against a pinned server this is tool-set membership drift: description-only pinning of existing tools does not flag it, full-surface pinning does. This makes MCPTox a direct RQ1 input, not only an RQ2 input.
7. **LongMemEval histories cannot be replayed at real dates through the product path.** Sessions record wall-clock time. The replay must state each session's `haystack_date` in the transcript text and the question date in the question prompt, and the memory extractor must take dates from the text. This is a construct-validity threat for temporal-reasoning items (section 6.4).
8. **The official LongMemEval judge is cheap enough to use for final runs.** 100 questions × 8 arms × 3 repeats is 2,400 judgments of about 600 input tokens and at most 10 output tokens each, about 1.5M input tokens in total. At GPT-4o list prices (verify on the day) that is a few dollars. Use a local or `deepseek-flash` judge during development and report its agreement with GPT-4o and with hand labels on a sample.
9. **An 8 GB laptop GPU makes full local AgentDojo runs slow.** The machine has an RTX 4060 Laptop GPU (8 GB), 24 threads, 30 GB RAM, and Ollama models `qwen3:8b`, `llama3.1:8b`, `qwen2.5:7b-instruct`, `nomic-embed-text`. A full v1.2.2 run is 1,046 episodes. At an **assumed** 40–60 s per episode that is 12–17 hours per configuration per repeat. Run local models on a fixed subset and run full sets on `deepseek-flash`.

## 1. AgentDojo (RQ2)

### 1.1 Facts

| Item | Value |
|---|---|
| Repository | https://github.com/ethz-spylab/agentdojo, MIT licence |
| Latest PyPI release | `agentdojo` 0.1.35, uploaded 2025-10-27, Python ≥ 3.10 |
| Repository head (2026-06-02) | adds an `openai-compatible` provider that is not on PyPI; pin a git revision in `uv.lock` if it is needed |
| Suites | workspace (24 tools), travel (28), banking (11), slack (11) |
| Counts | v1: 97 user tasks, 629 pairs. v1.2.2: 97 user tasks, 949 pairs (40×14 + 20×7 + 16×9 + 21×5) |
| Attacks (registered names) | `important_instructions` (and variants), `tool_knowledge`, `direct`, `ignore_previous`, `system_message`, `injecagent`, `manual`, `dos` and four DoS variants; custom attacks register with `@register_attack` |
| Metrics | benign utility (97 tasks), utility under attack and targeted attack success (per pair) |
| Entry points | `benchmark_suite_without_injections(agent_pipeline, suite, logdir, force_rerun, benchmark_version)` and `benchmark_suite_with_injections(agent_pipeline, suite, attack, logdir, force_rerun, benchmark_version)` in `agentdojo.benchmark` |

### 1.2 How an agent plugs in

An agent is a `BasePipelineElement` with one method:

```python
def query(self, query, runtime: FunctionsRuntime, env: Env, messages, extra_args)
    -> tuple[str, FunctionsRuntime, Env, Sequence[ChatMessage], dict]
```

`AgentPipeline([...elements])` chains elements; the stock pipeline is `SystemMessage → InitQuery → LLM → ToolsExecutionLoop([ToolsExecutor, LLM])`. The checker reads two things from the returned value: the final assistant text (`model_output_from_messages`) and the tool-call trace (`functions_stack_trace_from_messages`, built from `ChatAssistantMessage.tool_calls` as `FunctionCall(function, args, id)`), plus the post-run `env`. A replacement agent can therefore be one element that runs its own loop, as long as it mutates the same `env` and returns faithful messages.

### 1.3 Adapter architecture (recommended)

```
AgentDojo benchmark loop (Python)
  └─ AirHarnessAgent(BasePipelineElement)            air/eval/src/air_eval/agentdojo/pipeline.py
       ├─ McpBridge: in-process MCP server (streamable HTTP on 127.0.0.1:<port>)
       │     lists runtime.functions: name, description, parameters.model_json_schema()
       │     tools/call → runtime.run_function(bound_env, name, args)
       │     result text = agentdojo's own tool_result_to_str (YAML), error → isError
       │     bound_env swapped per task (one bridge per worker)
       ├─ DeepSeekHarness (python/sdk) with profile air-eval + arm patches
       │     one runtime per (worker, suite, arm); fresh session id per episode
       └─ convert.py: RunResult.events → ChatMessage list
             tool/call(name "mcp__agentdojo__send_money") → FunctionCall(function="send_money", args, id=callId)
             tool/result → ChatToolResultMessage; blocked/denied call → result with error text
             last assistant/message text → final ChatAssistantMessage
```

Why MCP and not injected tools: the SDK protocol has no client-tool method (finding 2), and MCP is the product path whose trust and policy plugins RQ2 evaluates. Streamable HTTP avoids the stdio probe process and keeps the tool implementations inside the Python process that owns `env`. The harness row is an ordinary `@deepseek-ai/dsh-mcp-client` entry with `serverName: agentdojo`, `transport: streamable-http`, `url: http://127.0.0.1:<port>/mcp`, `failOnStartupError: true`. Tool sets are fixed per suite, so the harness runtime is started once per suite and reused across that suite's episodes.

Fidelity rules for the adapter:

- **Composition.** Start from the standalone `sdk-minimal` tree (only persistent shell, local execution, JSONL sessions) rather than `sdk`, disable `persistent-bash`, and insert `llm-pi-ai` (Ollama and `deepseek-flash` routes), the MCP row, `dsh-user-approval`, and the AIR policy rows for the arm. Set `session-persistence-jsonl.compression: none`. No shell, file, web, skill, subagent, todo, or telemetry rows, so the model sees only AgentDojo's tools. Confirm with `dsh --profile air-eval --dump-config`.
- **Persona.** Replace the SDK coding-agent persona with AgentDojo's default system message through the `system-prompt` row config, so the remaining difference from AgentDojo's native pipeline is the harness's own prompt sections and tool naming.
- **Dates.** AgentDojo environments carry their own "today". Keep any time-context row out of the composition, or the model receives two conflicting current dates.
- **Tool names.** The model sees `mcp__agentdojo__<name>`. Strip the prefix when building the trace; ground-truth checks compare bare names.
- **Approvals.** AgentDojo has no human. Approval gating is evaluated with an eval-only answerer plugin (`@air/dsh-eval-approval-oracle`, an `approval/request` waterfall terminal answerer) that reads a per-session policy file written by the Python driver before each episode. Three simulated users: `never` (deny every ask), `rubber-stamp` (allow every ask, the approval-fatigue bound), and `diligent` (allow only calls whose tool name appears in the user task's ground-truth call list, `user_task.ground_truth(env)`). Report all three; `diligent` is optimistic and must be labelled as a simulated user.
- **Calibration arm.** Run AgentDojo's own pipeline with the same model (`OpenAILLM(openai.OpenAI(base_url=..., api_key=...), model_id)`; Ollama exposes `http://127.0.0.1:11434/v1`). Undefended-harness utility is then compared with native utility for the same model; a large gap is an adapter defect or a harness-prompt effect and must be explained before any defence result is reported.

### 1.4 Arms

| Arm | Composition | Purpose |
|---|---|---|
| N | AgentDojo native pipeline, same model | Calibration |
| H0 | Harness, no AIR policy, approvals `ask` answered `rubber-stamp` | Undefended harness baseline |
| H-scope | H0 + capability scopes (spike 04 `@air/dsh-permission-rules`) | Ablation |
| H-approve | H0 + argument-aware approval gating, `diligent` and `never` users | Ablation |
| H-taint | H0 + taint escalation (Rule-of-Two session state) | Ablation (stretch in the roadmap) |
| H-all | All policies on | Main result |
| H-all-adaptive | H-all against the adaptive attacker (1.6) | Case study |

Secret handoff is not an AgentDojo property. Measure it separately: plant a canary value in a tool that needs a credential, route model traffic through the capturing proxy (section 5.3), and count canary occurrences in session JSONL files, AIR audit files, and captured model requests. The target is zero.

### 1.5 Local models, cost, and time

Local models work: the harness reaches Ollama through `llm-pi-ai` (`air/examples/ollama.profile.cordis.patch.yml`), and the native arm reaches it through AgentDojo's OpenAI client. Two cautions. `qwen3:8b` emits thinking tokens by default; fix the thinking setting per arm and record it. An 8B model can have low benign utility; low utility with low attack success is a floor effect, not a defence, so report attack success together with utility and with the share of episodes that made any tool call.

Per-run estimate for v1.2.2, one attack, one repeat (1,046 episodes). Token counts are **assumptions** (4 model calls per episode, 12k input tokens per call because of the harness prompt and tool schemas, 1.5k output tokens per episode, 70% prefix cache hits):

| Model | Cost | Wall clock |
|---|---|---|
| `deepseek-flash`, off-peak prices from note 07 ($0.15/M miss, $0.003/M hit, $0.60/M output) | 50.2M input: 15.1M miss ≈ $2.26, 35.1M hit ≈ $0.11; 1.57M output ≈ $0.94; **≈ $3.3** | ≈ 20 s per episode; 8 workers ≈ 45 min |
| `qwen3:8b` on the RTX 4060 laptop | electricity only | 40–60 s per episode sequential; **12–17 h** |

Plan: main arms (N, H0, H-all) × 3 repeats and ablations × 1 repeat on `deepseek-flash`: 13 runs ≈ $45; budget $100 including reruns and peak-hour runs. Local models run on a fixed subset (banking + slack: 37 user tasks, 249 pairs, 286 episodes, about 4–5 h per arm) for the "local vs API" comparison.

### 1.6 Adaptive attacker

Register one or two `BaseAttack` subclasses written after reading the policy code, for example an injection that asks for a sequence of individually permitted calls, or one that places the exfiltration target inside an argument the scope rules treat as benign. Run them on a fixed subset (about 20 user tasks × 5 injection tasks) against H-all and report them as a case study without significance tests. Pre-commit the attack text to the repository before the run.

### 1.7 Effort

| Task | Effort |
|---|---|
| MCP bridge (FastMCP or low-level `mcp` server, env binding, YAML result formatting) | 1.5 d |
| Pipeline element, SDK runner, event→message converter with unit tests against recorded events | 2 d |
| `air-eval` profile patch and arm patches, `--dump-config` check | 1 d |
| Approval oracle plugin (TypeScript, Loader test) | 2 d, after `@air/dsh-permission-rules` exists |
| Native calibration runner and the 20-episode pilot | 1 d |
| Adaptive attacks | 2–3 d |

## 2. MCPTox, MSB, and MCP-Bench

| Benchmark | Availability and licence | Content | How it runs upstream |
|---|---|---|---|
| MCPTox (AAAI 2026, arXiv 2508.14925) | https://github.com/zhiqiangwang4/MCPTox-Benchmark; **no licence file**; last change 2025-12-03 | `pure_tool.json`: 45 servers with poisoned tool entries (`tool_name`, `query`, `tool_content`); `response_all.json`: per-server clean tool lists and system prompts, 1,348 labelled cases, attack scopes (credential leakage, data tampering, …) and three trigger templates; `def_tool/*.py`: 485 poisoned tools as FastMCP functions | Single request: system prompt listing clean + poisoned tools, one user query; an LLM labels the response. No tool execution |
| MSB, MCP Security Bench (ICLR 2026, arXiv 2510.15994) | https://github.com/dongsenzhang/MSB; MIT; last change 2026-03-24 | 12 attack types (name collision, preference manipulation, prompt injection, out-of-scope parameter, user impersonation, false error, tool transfer, retrieval injection, 4 mixtures), 9 agent scenarios, 4 attack tasks, benign servers as `mcpServers` JSON (`npx -y <pkg>`, unpinned), attack servers as Python FastMCP per scenario | Own agent on `mcp_use` + LangChain; any OpenAI-compatible `base_url`; `metrics.py` reads logs plus files written under `operation_space/output` |
| MCP-Bench (Accenture) | https://github.com/Accenture/mcp-bench; README says Apache-2.0, no `LICENSE` file in the clone; last change 2025-10-07 | 28 real servers vendored under `mcp_servers/`, 104 tasks (56 single-server, 30 two-server, 18 three-server) | Needs OpenRouter or Azure keys, some free third-party API keys (NPS, NASA, Google Maps, NCI), and an `o4-mini` judge hard-coded for reproduction |

Reuse plan:

- **MCPTox for RQ1.** Treat each server's clean tool list as the pinned v1 and "clean + poisoned tool" as v2. Measure which pinning scheme flags the transition (full-surface flags set membership; description-only per-tool pinning only flags it if it also treats unknown tools as drift). Also apply the poisoned text as an in-place description edit of an existing tool, which both schemes should flag, as a control.
- **MCPTox for RQ2.** Build one FastMCP stub server per MCPTox server from `response_all.json` (clean tools return canned outputs) plus the poisoned tool from `def_tool/`. Drive the harness with the case's `query` through the SDK and score **deterministically** from `tool/call` events: success means the targeted tool (for example `write_file` on `~/.ssh/id_rsa`) was executed with the target arguments. This replaces MCPTox's LLM label with an execution check, which is stronger but not directly comparable with the paper's numbers; say so. Use a stratified subset of about 200 cases over attack scope and template.
- **MSB for RQ2 (optional, second).** Convert MSB's `mcpServers` JSON into `mcp-client` rows with pinned package versions, keep only scenarios whose benign servers need no account (for example time, sequential thinking, filesystem, Met Museum, paper search), drive `agent_task.jsonl` tasks through the SDK, and write MSB-compatible logs from session events so `metrics.py` scores them. About 4–5 days; do it only after AgentDojo and MCPTox work.
- **MCP-Bench for RQ1 and RQ5 only.** Its 28 vendored servers give a realistic benign tool surface (about 250 tools) for false-alert and pinning-overhead measurements. Running its task suite needs paid judge and API keys and answers a capability question outside RQ1–RQ6; skip it.

## 3. RQ1 drift corpus from real release histories

### 3.1 Collection method

For each candidate package, for each stable version (drop pre-release tags; cap at the most recent 40 stable versions):

1. `npm view <pkg> time --json` (npm) or the PyPI JSON API (`https://pypi.org/pypi/<pkg>/json`) for the version list and publish dates.
2. Install into a fresh temporary directory: `npm install --prefix $TMP --no-save --ignore-scripts --no-audit --no-fund <pkg>@<v>`; for PyPI, `uv venv $TMP/.venv && uv pip install --python $TMP/.venv <pkg>==<v>`. Retry once without `--ignore-scripts` only for packages that need a postinstall step, and record which ones.
3. Start the server over stdio with the Python `mcp` client (`stdio_client`) inside a sandbox with no network (`bwrap --unshare-net` or `podman run --network=none`), dummy values for required API-key variables, and a scratch directory for servers that need a path argument. Per-server launch arguments live in `rq1/candidates.yaml`.
4. `initialize` then `tools/list` (follow pagination), and also `prompts/list` and `resources/list` when advertised. Timeout 20 s.
5. Write one JSON record: `{ecosystem, package, version, published_at, launch, ok, error, protocolVersion, serverInfo, capabilities, instructions, tools, prompts, resources, stderr_tail}`, plus the RFC 8785 canonical digests computed by the same code as `@air/dsh-mcp-trust` (spike 03 §7, shared golden vectors).
6. Delete `$TMP`. Keep the npm and uv caches.

Classify each consecutive-version transition automatically: identical surface (version-only change); description-only change; schema change without capability expansion; capability expansion (new tool, new parameter, widened enum or type, `readOnlyHint` true→false, `destructiveHint` false→true); tool removal or rename; instructions change; output schema or annotation change. Every real transition is labelled benign by assumption (published releases of named projects), which is the false-alert denominator. Malicious transitions are synthetic: apply the drift classes of research note 04 to real manifests (for example add an `exfil_url` parameter with an identical description, poison a parameter description, flip an annotation, add a shadowing tool), plus the MCPTox additions (2), plus MSB tool-signature and out-of-scope-parameter payloads. Each scheme (none, description-only as MCP-Scan documents it, full surface, full surface + capability-expansion classifier) is then replayed over every transition by a pure function, so RQ1 results need no model calls.

Time-to-detect (polling versus `list_changed`) is measured separately in the harness with spike 03's mutable fixture server, not in the corpus.

### 3.2 Time estimate

**Assumption:** 5–40 s per npm install, 1–5 s per start and list, about 20 s per version on average. 40 servers × about 25 retained versions ≈ 1,000 snapshots ≈ 6 h sequential, about 2 h with 4 parallel workers, unattended. Disk: a few GB of package cache; installs are deleted per version. Engineering: collector 2 d, classifier and synthetic drift generator 2 d, scheme replay and tables 1 d. Expect 10–20% of versions to fail to start (missing native binaries, required live credentials, old protocol versions); report the failure count per server.

### 3.3 Candidate servers

Version counts are all published versions (including pre-releases) as returned by the registries on 2026-09-29.

| Ecosystem | Package | Versions | Licence | Note |
|---|---|---|---|---|
| npm | `@modelcontextprotocol/server-filesystem` | 19 | see package | needs a directory argument |
| npm | `@modelcontextprotocol/server-memory` | 14 | see package | |
| npm | `@modelcontextprotocol/server-everything` | 28 | see package | reference server, frequent surface changes |
| npm | `@modelcontextprotocol/server-sequential-thinking` | 9 | see package | |
| npm | `@modelcontextprotocol/server-github`, `-slack`, `-postgres`, `-puppeteer`, `-brave-search` | 8–13 each | MIT | deprecated; still useful history |
| npm | `@playwright/mcp` | 436 | Apache-2.0 | filter to stable releases |
| npm | `@upstash/context7-mcp` | 86 | MIT | |
| npm | `chrome-devtools-mcp` | 63 | Apache-2.0 | |
| npm | `@notionhq/notion-mcp-server` | 22 | MIT | dummy token |
| npm | `firecrawl-mcp` | 114 | MIT | dummy key |
| npm | `@supabase/mcp-server-supabase` | 61 | Apache-2.0 | dummy token |
| npm | `@sentry/mcp-server` | 47 | FSL-1.1-ALv2 | dummy token |
| npm | `@stripe/mcp` | 15 | MIT | dummy key |
| npm | `tavily-mcp` | 28 | MIT | |
| npm | `exa-mcp-server` | 49 | unstated | |
| npm | `figma-developer-mcp` | 51 | MIT | |
| npm | `@antv/mcp-server-chart` | 44 | MIT | |
| npm | `@wonderwhy-er/desktop-commander` | 121 | MIT | high-privilege tools |
| npm | `@executeautomation/playwright-mcp-server` | 25 | MIT | |
| npm | `mongodb-mcp-server` | 98 | Apache-2.0 | |
| npm | `mcp-server-kubernetes` | 98 | MIT | |
| npm | `@heroku/mcp-server` | 24 | Apache-2.0 | |
| npm | `@shopify/dev-mcp` | 140 | ISC | |
| npm | `@azure/mcp` | 158 | MIT | platform binary packages; may need install scripts |
| PyPI | `mcp-server-git`, `mcp-server-fetch`, `mcp-server-time` | 19, 10, 12 | MIT | reference servers |
| PyPI | `awslabs.aws-documentation-mcp-server` | 44 | Apache-2.0 | |
| PyPI | `mcp-atlassian` | 83 | unstated | dummy credentials |
| PyPI | `jupyter-mcp-server` | 91 | BSD-3-Clause | |
| PyPI | `arxiv-mcp-server`, `blender-mcp` | 38 each | Apache-2.0, MIT | |
| PyPI | `mcp-server-motherduck`, `mcp-clickhouse`, `chroma-mcp` | 33, 21, 21 | unstated, Apache-2.0, Apache-2.0 | |

Also include the time, filesystem, sequential-thinking, and paper-search servers that MSB uses, and cross-check the list against the official MCP registry (`https://registry.modelcontextprotocol.io/v0/servers`), which the Snyk agent-scan issue #482 used for its 59,821-transition count.

## 4. LongMemEval (RQ3)

### 4.1 Data and format

- Code: https://github.com/xiaowu0162/LongMemEval (MIT). Data: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned (MIT, cleaned September 2025; the history sessions were edited to remove interference with answer correctness, so results on it are not comparable with numbers on the original release).
- Files: `longmemeval_s_cleaned.json` (277 MB), `longmemeval_oracle.json` (15 MB), `longmemeval_m_cleaned.json` (2.7 GB). Use S for the arms and Oracle as the upper bound.
- Each item: `question_id` (suffix `_abs` marks abstention), `question_type` (`single-session-user`, `single-session-assistant`, `single-session-preference`, `temporal-reasoning`, `knowledge-update`, `multi-session`), `question`, `answer`, `question_date`, `haystack_session_ids`, `haystack_dates`, `haystack_sessions` (lists of `{role, content}` turns; evidence turns carry `has_answer: true`), `answer_session_ids`. S histories are about 115k tokens over about 40 sessions (README).
- The paper reports GPT-4o full-context at 0.606 on S against 0.870 with oracle retrieval, and 0.98 average judge agreement with human experts (arXiv 2410.10813, Table 5 and Figure 4).

### 4.2 Stratified subset

Sample 100 questions from S with a fixed seed, proportional to type with a floor of 8 per type, and keep the `_abs` share. Using the per-type counts reported in the paper (70, 56, 30, 133, 78, 133; recount after download): single-session-user 13, single-session-assistant 11, single-session-preference 8, multi-session 26, knowledge-update 16, temporal-reasoning 26. Commit the list of `question_id`s.

### 4.3 Replaying histories into AIR sessions

Driving the real model through 40 sessions per question would cost tokens and would replace the recorded assistant turns with new ones. Instead:

1. **Replay model server** (`longmemeval/replay_server.py`): a local OpenAI-compatible endpoint that returns, for each request, the recorded assistant turn that follows the last user message in the current haystack session. It is registered in `llm-pi-ai` as provider `lme-replay`. The ingestion runtime runs with `provider="lme-replay"`.
2. **Ingestion** (`longmemeval/ingest.py`): one fresh `DSH_HOME` per question. For each haystack session in date order, open a new SDK session (`session_id = <question_id>--<haystack_session_id>`), prefix the first user turn with `[Conversation date: <haystack_date>]`, and send each user turn with `Session.run()`. The harness writes real sessions (arm 2 searches them through `session-query`), and AIR memory capture and extraction run on `turn/end` through the product path, with the extraction model set in the memory-extract Config (`qwen3:8b` or `deepseek-flash`). Wait for the extraction queue to drain, then snapshot `DSH_HOME`.
3. **Query**: for each arm, copy the snapshot, start a runtime with the arm's patch and the answer model, open a new session, and send `Current date: <question_date>. <question>`. Store `{question_id, hypothesis}` JSONL, the format `evaluate_qa.py` reads.

Ingestion runs once per question and is shared by arms 1–7, so extraction randomness does not differ between arms (it is held fixed; see threats). **Assumption:** about 500 turns per question at 0.2–0.5 s harness overhead per replayed turn ≈ 2–4 min, plus extraction calls; 100 questions ≈ 4–8 h plus extraction time, unattended.

### 4.4 Arms

From research note 05 §2.9, with arm switches as Config fields of the spike 04 packages:

| Arm | Memory composition |
|---|---|
| 1 | No memory, no session search |
| 2 | Raw `session-query` search tool only (`tool-session-query`) |
| 3 | Memory files + FTS5 only |
| 4 | Memory files + vector only (`nomic-embed-text` via Ollama) |
| 5 | Hybrid RRF |
| 6 | Hybrid + priors (recency, importance, trust) |
| 7 | Arm 6 + auto-recall at `agent/pre-step` |
| M | MemOS local plugin (`@memtensor/memos-local-plugin`), ingested through the same replay path; blocked until its peer range covers 0.2 or run against a pinned 0.1.x host (research.md §5.4) |

Optional reference: Oracle (evidence sessions only, in context) with `deepseek-flash` as the upper bound. A full-context S arm does not fit the 32k context of the local models; run it only on `deepseek-flash` if the budget allows (note 07 estimates about $8.6 per 500-question run; about $1.7 for 100).

Poisoning red team: MINJA-style sequences and one indirect injection through a fetched page, injected into the replayed histories of a small separate set (about 20 histories). The metric is the number of attacker-written candidates that reach committed memory without an approval, counted from the memory directory and the extraction audit JSONL, not from model output. MemOS is expected to capture every turn; report its count with the same counter over its SQLite store.

### 4.5 Judge

`src/evaluation/evaluate_qa.py <judge> <hypothesis.jsonl> <reference.json>` calls a chat model with a type-specific yes/no prompt, `temperature 0`, `max_tokens 10`, and counts a `yes`. Its `model_zoo` knows `gpt-4o` (`gpt-4o-2024-08-06`), `gpt-4o-mini`, and a local `llama-3.1-70b-instruct` at `http://localhost:8001/v1`.

- **Final runs:** official `gpt-4o-2024-08-06` judge (a few dollars; finding 8), so numbers are comparable in protocol with published results.
- **Development:** add two `model_zoo` entries in a local copy of the script (not a fork of the repository): `deepseek-flash` through its OpenAI-compatible endpoint, and `qwen2.5:7b-instruct` through Ollama. Do not use `qwen3:8b` as the judge with thinking enabled: `max_tokens 10` truncates it inside the thinking block and the `yes` check fails.
- **Validity:** on 200 (question, hypothesis) pairs drawn across arms, report Cohen's κ and raw agreement of each cheap judge with GPT-4o, and of GPT-4o with the student's own labels on 100 of them. A cheap judge is acceptable for development only if κ ≥ 0.8 with GPT-4o; published numbers always use GPT-4o. Small judges are known to be lenient on partial answers and on abstention items; report agreement per question type.

## 5. Harness plumbing: many headless sessions and their metrics

### 5.1 Driver

Use the Python SDK, not one `dsh --profile headless` process per episode: one runtime serves many sessions, so profile boot and MCP connection happen once per worker.

- `DeepSeekHarness(dsh_home=..., cwd=..., profile="air-eval", patches=(arm_patch,), provider=..., model=..., max_tokens=..., request_timeout_seconds=...)`; `harness.start_session(id).run(prompt)` returns `RunResult(session_id, final_response, finish_reason, events, notifications)`. `events` holds the root session's `session.event` payloads in wire order; `finish_reason` is the last `turn/end` kind.
- Runtime binary: build the SDK runtime from this checkout (`pnpm exec tsx scripts/build-exe-for-python-sdk.ts`) or set `DSH_RUNTIME_MODE=node` to use the dev Node carrier on system Node ≥ 22.19 (python/development.md). The eval project depends on `python/sdk` and `python/sdk-runtime` by path, as `python/sdk/pyproject.toml` does.
- Profile: create `air-eval` once per `DSH_HOME` from the `sdk-minimal` tree, then `dsh plugin --profile air-eval add file:<air bundle>` for AIR rows (needs `pnpm`), then per-arm patch files passed through `patches=`. The SDK never reads `~/.dsh`; each run gets its own `DSH_HOME` under `air/eval/runs/<run-id>/home`.
- Isolation: fresh session id per episode; fresh `DSH_HOME` per run (per question for LongMemEval). Concurrency: N workers, each owning one runtime and, for AgentDojo, one MCP bridge. N = 1–2 against a single local GPU (`OLLAMA_NUM_PARALLEL`), about 8 against `deepseek-flash`.
- Every run writes `manifest.json`: harness version and git revision of the checkout, benchmark package version or pinned revision, dataset file SHA-256, model and provider route, reasoning and thinking settings, `max_tokens`, arm patch contents, seeds, host and GPU, start and end times.

### 5.2 Metrics sources

No new session event types (finding 4). Sources, in order of preference:

| Metric | Source |
|---|---|
| Input, output, cache-read, reasoning tokens per step | `assistant/message.usage` (`TokenUsage`) in `RunResult.events` and in the session JSONL |
| Model latency, time to first token, decode time | event `time` of `step/start` and the `stream` records (`time0`, `dt`) of `assistant/message`; fold with the field definitions of `@deepseek-ai/dsh-session-stats` (`turns`, `steps`, `llmMs`, `toolMs`, `ttftMs`, `decodeMs`, `decodeTokens`), reimplemented in `air_eval/events.py` and checked against the Web stats strip on a few sessions |
| Tool calls, arguments, results, errors | `tool/call` and `tool/result` |
| Approvals asked and outcomes | `approval/asked`, `approval/decided`, `approval/policy` (in-tree event types of `dsh-user-approval`) |
| Episode wall clock | Python monotonic clock around `Session.run()` |
| Pinning verdicts, drift, quarantine | `mcp-audit/<sessionId>.jsonl` sidecar (spike 03 §3) |
| Policy decisions (scope match, rule, taint state) | permission-rules `auditPath` JSONL (spike 04 §8) |
| Memory candidates, quarantine, commits | memory extraction log JSONL and the memory git history |
| Whole-session history after the run | session JSONL files under `$DSH_HOME/sessions/--<cwd>--/<id>/` (highest `session.v<N>.jsonl`; `compression: none` in the eval profile) |

`session-log-export` is a Web ZIP download route and `session-query` is an in-process service; neither is a headless export path, so offline analysis reads the JSONL files. `ctx.tokenMeter` estimates are not needed because providers report usage.

### 5.3 Capturing proxy and keyless replay

`air_eval/proxy.py` is a small OpenAI-compatible reverse proxy placed between `llm-pi-ai` and the model endpoint. In record mode it stores each request and response body; in replay mode it answers from the recording. It serves three purposes: canary search over the exact model-visible requests (secret handoff), a byte-level check that model-visible input equals what the session log reconstructs, and keyless regeneration of result tables by an examiner from recorded model output (the evaluation counterpart of the upstream recorded-session snapshots; replay is exact only while the harness build and composition are unchanged).

## 6. Statistical design

### 6.1 Runs per arm

| RQ | Unit | Repeats | Notes |
|---|---|---|---|
| RQ1 | release transition; synthetic drift case | 1 (deterministic replay) | report per server and per drift class |
| RQ2 AgentDojo | user task (utility, n = 97); user×injection pair (n = 949) | 3 for N, H0, H-all; 1 for ablations | `deepseek-flash`, temperature 0; local models on the fixed 286-episode subset |
| RQ2 MCPTox | case (about 200) | 3 for H0 and H-all | deterministic execution scoring |
| RQ3 | question (n = 100) | ingestion 1; answering 3 per arm | judge fixed per report |
| RQ5 | micro-benchmark iteration | ≥ 1,000 iterations after warm-up, 5 process restarts | pinned hardware, AC power, CPU governor recorded |
| RQ6 | participant (n ≈ 8–12) | within subjects, counterbalanced order | ethics approval first |

### 6.2 Estimates and tests

- **Proportions** (utility, attack success, accuracy, false-alert rate): mean over repeats per item, then a cluster bootstrap over items (resample user tasks for AgentDojo, so pairs of one user task move together; resample servers for RQ1; resample questions for RQ3), 10,000 resamples, percentile 95% intervals. Also give Wilson intervals on single-repeat counts for comparison with other papers.
- **Paired arm comparisons** on the same items: McNemar's exact test per repeat on the majority outcome per item, plus the bootstrap interval of the paired difference. For RQ3's eight arms, Cochran's Q across arms, then pairwise McNemar with Holm correction; or a mixed-effects logistic regression with a random intercept per question as the single model.
- **Primary metrics, fixed before the final runs** (pre-register in `air/eval/PREREGISTRATION.md`): RQ1 false-alert rate on benign transitions and detection per drift class; RQ2 targeted attack success under `important_instructions`, H-all versus H0, with benign utility as the co-primary cost; RQ3 overall accuracy of arm 6 versus arm 2 and committed poisoned memories without approval. All other comparisons are exploratory.
- **Minimum detectable effects.** Benign utility on 97 tasks has a 95% half-width near ±10 points at 50%, so utility losses smaller than about 10 points cannot be claimed as present or absent. Attack success over 949 pairs clustered in 97 user tasks resolves differences of a few points. RQ3 with 100 questions resolves about 10–14 points between arms; per-type results (8–26 questions each) are descriptive only.
- **RQ5**: medians and p95 with bootstrap intervals; report pinning overhead against the MCP-Bench tool surface (about 250 tools) as well as small servers.
- **RQ6**: SUS mean with a t interval, Wilcoxon signed-rank for paired measures, effect sizes; directional only at this n.

### 6.3 Threats to validity (additions to note 07 §4.4)

- **Adapter fidelity.** Harness prompt sections, the `mcp__agentdojo__` name prefix, and MCP result formatting change model behaviour. Mitigation: the N calibration arm, the AgentDojo persona patch, AgentDojo's own result formatter, and a converter test that feeds recorded events back through AgentDojo's checkers.
- **Simulated approvals.** The `diligent` user reads the ground truth and overstates what a real user would catch; `rubber-stamp` understates it. Report both bounds and leave the real-user question to RQ6.
- **Floor effects with local models.** Low attack success can reflect failed tool use. Report utility, the share of episodes with any tool call, and attack success together.
- **Benchmark versions and contamination.** Name the AgentDojo version (v1.2.2 vs v1) and the LongMemEval release (cleaned vs original). Public test sets may be in pre-training data of any model.
- **Scoring changes.** MCPTox scored by execution rather than by its LLM label; LongMemEval judged by a non-official judge during development. Neither may be compared directly with published numbers.
- **Replay artefacts.** LongMemEval dates appear as text, not as session timestamps; recency priors computed from wall-clock `updated` fields are meaningless under replay and must read the conversation date instead. Extraction runs once per question, so arm comparisons are conditional on one extraction sample; repeat ingestion for arms 5–7 on a 20-question subset to measure that variance.
- **Drift corpus labels.** Real releases are assumed benign; a compromised release in the history would count as a false alert. Synthetic drift classes are the student's own design; MCPTox and MSB payloads reduce, but do not remove, that bias.
- **Provider drift and non-determinism.** `deepseek-flash` may change during the study; record response metadata from the proxy. Ollama at temperature 0 is not bit-reproducible across batch sizes; record model digests (`ollama list` IDs).
- **Designer as evaluator.** Pre-registration, attacks committed before runs, and publishing raw run directories.

## 7. Proposed layout and task order

### 7.1 `air/eval/` (Python uv project)

```
air/eval/
  pyproject.toml            uv project; deps: deepseek-harness-sdk (path ../../python/sdk),
                            deepseek-harness-runtime-bin (path ../../python/sdk-runtime), agentdojo==0.1.35,
                            mcp, uvicorn, httpx, pydantic, pyyaml, numpy, pandas, scipy, statsmodels
  uv.lock
  README.md                 one command per RQ table; data download; expected run times
  PREREGISTRATION.md        primary metrics, arms, repeats, success criteria (frozen before final runs)
  profiles/
    air-eval.patch.yml      sdk-minimal based tree: llm-pi-ai routes, compression none, no telemetry
    arms/rq2-*.patch.yml    H0, H-scope, H-approve, H-taint, H-all
    arms/rq3-*.patch.yml    arms 1–7, M
  configs/                  experiment YAMLs (model, arm list, repeats, seeds, subset files)
  subsets/                  committed id lists (LongMemEval 100, AgentDojo local subset, MCPTox 200)
  src/air_eval/
    harness.py              SDK runner, worker pool, per-run DSH_HOME, profile init, manifest
    events.py               session event fold (tokens, latency, tool calls, approvals)
    audit.py                readers for AIR JSONL audit files
    proxy.py                record/replay proxy for model traffic
    stats.py                bootstrap, Wilson, McNemar, Cochran's Q, Holm
    agentdojo/              mcp_bridge.py, pipeline.py, convert.py, run.py, attacks.py
    mcptox/                 build_servers.py, run.py, score.py
    msb/                    (optional) bridge and log writer
    rq1/                    candidates.yaml, collect.py, classify.py, synth_drift.py, schemes.py
    longmemeval/            sample.py, replay_server.py, ingest.py, ask.py, judge.py
    rq5/                    overhead benchmarks driver
    report/                 tables.py (CSV, Markdown, LaTeX)
  tests/                    pytest: converter, stats, classifier, one keyless AgentDojo episode via proxy replay
  data/                     git-ignored; fetch scripts pin revisions and check SHA-256
  runs/                     git-ignored; one directory per run (manifest, sessions, audit, raw results)
  results/                  committed summary CSVs regenerated by report/
```

Eval-only Cordis plugins live in the existing AIR pnpm workspace, not in the Python project: `air/packages/eval-approval-oracle` (simulated-user answerer) and, if needed, a `dsh` startup provider for batch ingestion that follows spike 03 §5's pattern for the "Application launch" rule. They are never part of the product bundle.

### 7.2 Task order and effort

| # | Task | Depends on | Effort |
|---|---|---|---|
| E0 | uv project, SDK runner, `air-eval` profile, event fold, manifest, proxy (record mode) | runtime build | 3 d |
| E1 | RQ1 collector on 5 servers, classifier, scheme replay | RFC 8785 code from spike 03 T2 (or a Python port with shared vectors) | 3 d |
| E2 | AgentDojo bridge, pipeline element, converter, calibration arm N, H0 pilot | E0 | 5 d |
| E3 | Stats and report generators | E0 | 2 d |
| E4 | RQ1 full collection (40 servers, unattended), synthetic drift, MCPTox transitions | E1 | 3 d + 1 night |
| E5 | LongMemEval sampler, replay server, ingestion, arms 1–2, judge wrapper and agreement study | E0 | 5 d |
| E6 | Approval oracle plugin; RQ2 ablation runs | permission-rules, E2 | 2 d + runs |
| E7 | MCPTox execution harness (RQ2) | E0, policies | 3 d |
| E8 | LongMemEval arms 3–7 and M; poisoning red team | memory packages | 3 d + runs |
| E9 | Adaptive attacker case study | H-all | 3 d |
| E10 | RQ5 overhead benchmarks | mcp-trust, permission-rules | 2 d |
| E11 | MSB bridge (optional) | E7 | 4–5 d |

About 38–45 working days in total, spread over the roadmap months in research.md §7 (RQ1 in Nov–Dec, RQ3 in Jan, RQ2 in Mar).

## 8. Phase-1 review pilot (what can be honest by then)

The AIR policies, pinning, and memory plugins do not exist yet, so a phase-1 demo can show the measurement apparatus and baseline numbers, not the contribution. A small, honest pilot:

1. **AgentDojo banking suite, N versus H0**, one model (`deepseek-flash`, about $0.50; or `qwen3:8b`, about 2 h), v1.2.2, 16 user tasks and 144 pairs under `important_instructions`, one repeat. Output: benign utility, utility under attack, attack success, each with Wilson intervals, labelled "pilot, n = 16 / 144, one repeat, no AIR defences". The claim is only that the adapter runs and how far harness utility sits from native utility.
2. **RQ1 mini-corpus**: 5 servers (`server-everything`, `server-filesystem`, `@upstash/context7-mcp`, `mcp-server-git`, `firecrawl-mcp`), all stable versions. Output: counts of transitions per class, and how many a description-only pin and a full-surface pin would flag. This is already real data and a first false-alert estimate for both schemes.
3. **Per-episode metrics table** from the event fold (tokens, TTFT, model and tool time, wall clock) for the pilot episodes, replacing note 07's assumed token counts with measured ones and recomputing the budget in 1.5.
4. **LongMemEval smoke**: 10 questions through the replay ingestion with arms 1 and 2 and two judges, to show the pipeline end to end and a first judge-agreement figure. No memory result is claimed.

Present each with its n and its limits; do not extrapolate the pilot to the final research questions.

## 9. Sources

- AgentDojo: https://github.com/ethz-spylab/agentdojo (MIT); PyPI `agentdojo` 0.1.35; paper arXiv 2406.13352.
- LongMemEval: https://github.com/xiaowu0162/LongMemEval (MIT); data https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned; paper arXiv 2410.10813.
- MCPTox: https://github.com/zhiqiangwang4/MCPTox-Benchmark; paper arXiv 2508.14925; licence request https://github.com/zhiqiangwang4/MCPTox-Benchmark/issues/5.
- MSB: https://github.com/dongsenzhang/MSB (MIT); paper arXiv 2510.15994.
- MCP-Bench: https://github.com/Accenture/mcp-bench.
- Snyk agent-scan description-only pinning: https://github.com/snyk/agent-scan/issues/482.
- Official MCP registry API: https://registry.modelcontextprotocol.io/v0/servers.
- In this checkout: `python/sdk/README.md`, `python/sdk/src/deepseek_harness/api.py`, `packages/sdk/protocol/src/types.ts`, `packages/sdk/server/src/server.ts`, `packages/bundle/sdk-app/README.md`, `packages/bundle/sdk-minimal/cordis.patch.yml`, `packages/mcp/mcp-client/README.md`, `packages/interaction/user-approval/README.md`, `packages/session/session-stats/README.md`, `packages/session/session-persistence-jsonl/README.md`, `packages/core/session/src/types.ts`, `python/development.md`.
