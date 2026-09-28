# 05 — Long-term memory and desktop context for AIR-harness

Research date: 2026-09-28. Scope: web research only; no code was changed. Every figure below is attributed to its source, and vendor-reported benchmark numbers are labelled as self-reported. Where sources disagree, both positions are given.

## Summary

The field has converged on a pattern AIR-harness can adopt cheaply. The memory itself lives in plain Markdown files that people can read, edit, and version. A rebuildable index, lexical plus vector, sits beside the files. A small pinned core is loaded every session, deeper recall happens through a search tool, and a background pass consolidates memory "while the user sleeps". Claude Code auto memory, Anthropic's API memory tool, and Letta's 2026 git-backed "context repositories" all converged on this design independently. Benchmark evidence says a well-built agent with plain file search is competitive with dedicated memory stacks, and that vendor leaderboards are not comparable to each other. The main new risk is memory poisoning. Published attacks reach very high success rates against agents that write memory automatically from untrusted content. The design below therefore gates automatic writes by the trust of their source.

For desktop context, the lesson of Microsoft Recall, Rewind, screenpipe, and OpenAI's Chronicle is that continuous capture is both the most useful option and the most fragile, for privacy and for security alike. AIR-harness should start with pull-based, change-only, minimized readings, logged like the existing `time-context` and `tmux-context` readings, with no background recorder.

## 1. Survey

### 1.1 Product memory systems

**ChatGPT.** OpenAI runs two layers: explicit "saved memories" and "reference chat history". Saved memories are stored separately from chats, and deleting a chat does not delete a memory derived from it. Deleting a memory stops future use but "does not remove mentions of that information from past conversations" ([OpenAI Help](https://help.openai.com/en/articles/8590148-memory-in-chatgpt)). Independent analysis found that saved memories are injected, with timestamps, into a "Model Set Context" section of the system prompt. The same analysis found that chat-history memory behaves like a rolling profile plus recent user messages, not a search ([Embrace The Red, 2025](https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/)). The same researcher showed the memory-writing tool could be triggered by indirect prompt injection.

**OpenAI Chronicle / Computer History (2026).** This is a macOS-only research preview in the ChatGPT desktop app that turns screen activity into memories for ChatGPT and Codex. The current documentation says it records interaction events (clicks, typing, shortcuts, app switches) and text available through macOS accessibility. It says it does not record screenshots, microphone or system audio, or private browsing. Event files stay on the Mac for up to 48 hours, are processed on OpenAI servers into memories, and the memories are stored locally. Controls include per-app and per-site allow/block lists, pause, and timeline deletion. The documentation warns that the feature "increases the risk of prompt injection from content in apps and websites" ([ChatGPT Learn](https://learn.chatgpt.com/docs/customization/computer-history)). Earlier coverage described screen capture ([Towards AI](https://pub.towardsai.net/openai-chronicle-lets-codex-read-your-screen-to-build-memories-fc72468dfb72)), so the capture design appears to have changed during the preview. One user reported 572 background summaries generated overnight that consumed quota ([OpenAI community, May 2026](https://community.openai.com/t/codex-chronicle-generated-572-background-summaries-overnight-and-consumed-quota/1380899)). Background extraction needs cost and rate limits.

**Claude apps.** Memory reached Team/Enterprise in September 2025 together with incognito chats ([Claude on X](https://x.com/claudeai/status/1981407198665462127)) and later reached Pro/Max. Claude summarizes conversations into a synthesis. Memory is scoped per project, so project chats stay separate from non-project memory, and incognito chats are neither remembered nor saved to history ([Claude Help Center](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)). A separate chat-search feature retrieves raw past conversations through visible tool calls.

**Claude Code.** Claude Code has two mechanisms, and both load at session start: human-written CLAUDE.md files, and "auto memory" that Claude writes itself. Auto memory lives in `~/.claude/projects/<project>/memory/` as a `MEMORY.md` index, "one line per memory, loaded into every session", plus one topic file per memory. Only the first 200 lines or 25 KB of `MEMORY.md` are loaded. When the file nears the limit, Claude Code tells Claude to keep one line per entry, move detail into topic files, and merge or drop stale entries. Auto memory is machine-local, shared across worktrees of one repository, and exempt from transcript cleanup ([Claude Code docs](https://code.claude.com/docs/en/memory)). The docs describe both mechanisms as "context, not enforced configuration".

**Anthropic API memory tool.** `memory_20250818` is a client-side tool with six file commands (view, create, str_replace, insert, delete, rename) over a `/memories` directory. The application executes the commands and must reject path traversal. It pairs with context editing, which clears stale tool results after important facts have been written to memory ([Claude Platform docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)).

**Gemini.** "Personal Intelligence" draws on Gmail, Photos, Search, YouTube, and past chats, with view/delete controls ([Google](https://gemini.google/overview/personal-intelligence/)). "Past Chats" personalization reached free users in February 2026 ([9to5Google](https://9to5google.com/2026/02/26/gemini-past-chats-free/)). Its strength is first-party data integration. A local agent can only approximate that through connectors.

### 1.2 Memory frameworks and research systems

**MemGPT / Letta.** MemGPT introduced memory tiers under agent control: in-context "core" memory blocks, recall memory (conversation history), and archival memory. Letta 0.7.0 (April 2025) split memory editing out to a "sleep-time agent" that rewrites the primary agent's memory blocks asynchronously, so the primary agent never pays latency for memory upkeep ([Letta, Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/); [paper](https://arxiv.org/html/2504.13171v1)). On 2026-02-12, Letta moved to "context repositories" (MemFS). Memory is a git repository of Markdown files. A `system/` directory "designates which files are always fully loaded into the system prompt". Each file carries frontmatter with a description, subagents write concurrently in separate worktrees and merge, and a sleep-time process "periodically reviews recent conversation history and persists important information" ([Letta blog](https://www.letta.com/blog/context-repositories/); [MemFS docs](https://docs.letta.com/concepts/memfs)). The post publishes no benchmark numbers.

**Mem0.** The April 2025 paper extracts candidate facts with an LLM and applies ADD/UPDATE/DELETE/NOOP operations, with an optional graph variant. It reports a 26% relative LLM-judge improvement over OpenAI memory on LoCoMo, 91% lower p95 latency, and more than 90% token savings versus full context ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)). Mem0's April 2026 algorithm moved to single-pass ADD-only extraction, where memories accumulate rather than overwrite. It adds entity linking and fuses semantic, BM25, and entity scores. Self-reported results are 92.5 on LoCoMo, 94.4 on LongMemEval, 64.1 on BEAM-1M, and 48.6 on BEAM-10M, at roughly 7K tokens per query. Knowledge-update (93.6) and multi-session (88.0) are its weakest LongMemEval categories. Mem0 attributes the knowledge-update weakness to ADD-only storage surfacing stale facts next to new ones ([Mem0 benchmark guide, updated 2026-09-22](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)).

**Zep / Graphiti.** Graphiti is a temporal knowledge graph with episodic, semantic-entity, and community subgraphs. It uses a bi-temporal model that tracks both when a fact was true and when it was ingested. Superseded edges get invalidation timestamps and are not deleted. The January 2025 paper reports 94.8% versus MemGPT's 93.4% on DMR. On LongMemEval_S with gpt-4o it reports 71.2% versus 60.2% for full context, at 2.58 s versus 28.9 s latency and about 1.6K versus 115K context tokens. The gains are largest on preference and temporal questions, and single-session-assistant questions regressed from 94.6% to 80.4% ([arXiv 2501.13956](https://arxiv.org/html/2501.13956v1)).

**A-MEM (NeurIPS 2025).** A-MEM builds Zettelkasten-style notes with LLM-generated keywords, tags, and context descriptions, and links each new note to related ones. New notes can trigger "memory evolution" of older notes' attributes ([GitHub](https://github.com/WujiangXu/A-mem); [proceedings](https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html)).

**LangMem.** LangMem distinguishes semantic memory (facts and preferences), episodic memory (successful past interactions), and procedural memory (self-refined system instructions). It offers hot-path memory tools and a background memory manager ([LangChain](https://www.langchain.com/blog/langmem-sdk-launch)).

**Cognee.** Cognee runs an Extract-Cognify-Load pipeline into a hybrid graph, vector, and relational store. A "memify" stage prunes stale nodes, reweights edges, and adds derived facts ([GitHub](https://github.com/topoteretes/cognee)).

**MemOS.** MemOS is a "memory operating system" whose MemCubes pair content with origin metadata, versioning, and governance rules ([arXiv 2507.03724](https://arxiv.org/pdf/2507.03724)). It self-reports accuracy gains over OpenAI memory and 35.24% memory-token savings. Its repository description, as indexed in September 2026, mentions "DeepSeek Harness support" ([GitHub](https://github.com/MemTensor/MemOS)). Check what that integration is before duplicating work.

**Generative Agents (2023).** This paper supplies the classic retrieval score, which AIR already adapted. The score sums recency, importance, and relevance, with all weights set to 1. Recency decays exponentially with factor 0.995 per game hour since last access, an LLM rates importance from 1 to 10, and relevance is cosine similarity. Reflection runs when accumulated importance crosses a threshold ([Park et al.](https://arxiv.org/pdf/2304.03442)).

### 1.3 Benchmarks and what actually wins

- **LoCoMo** (2024) has conversations of about 300 turns and 9K tokens across up to 35 sessions. It does not score knowledge updates explicitly ([Mem0 guide](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)).
- **LongMemEval** (ICLR 2025) has 500 questions over five abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention. The questions fall into seven types. The _S variant has about 115K tokens over about 40 sessions, and the _M variant about 500 sessions ([arXiv 2410.10813](https://arxiv.org/html/2410.10813v1); [GitHub](https://github.com/xiaowu0162/longmemeval)). One of its ablations matters for design. Expanding the index key with extracted facts ("K = V + fact") raised session-level Recall@5 for BM25 from 0.634 to 0.683 and for Contriever from 0.723 to 0.762 (same source, Appendix E.1). Indexing extracted facts next to raw text is a cheap win.
- **MemoryAgentBench** (ICLR 2026) feeds information incrementally, over 2,071 questions and 103K to 1.44M tokens of context. It tests accurate retrieval, test-time learning, long-range understanding, and conflict resolution ([arXiv 2507.05257](https://arxiv.org/abs/2507.05257); [GitHub](https://github.com/HUST-AI-HYZ/MemoryAgentBench)). The same group's MemoryArena, which evaluates memory on agentic tasks, was accepted at ICML 2026.
- **BEAM** (ICLR 2026) has 100 conversations up to 10M tokens and 2,000 questions across ten capabilities, including contradiction resolution and telling instructions apart from preferences ([Mem0 guide](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)).

What wins, read skeptically:

1. **Protocol dominates the leaderboard.** The judge model, the answer model, and whether a reranking step is used swing scores widely. ByteRover's own comparison put Zep at 75.1% and Mem0 at 66.9% on LoCoMo, well below both vendors' self-reports ([Mem0 guide](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)). No cross-vendor number is comparable unless it was run on the same stack.
2. **An agent with plain file search is competitive.** Letta dumped LoCoMo histories into files and gave GPT-4o mini a search tool. It scored 74.0%, against the 68.5% Mem0 had reported for its graph variant at the time ([Letta, Aug 2025](https://www.letta.com/blog/benchmarking-ai-agent-memory/)). Letta's conclusion is that the agent's retrieval behaviour matters more than the memory data structure.
3. **Structured memory beats raw long context at equal cost.** Zep's LongMemEval result (1.6K versus 115K tokens, higher accuracy) and BEAM's finding that long context alone falls short both point the same way. Pair every accuracy figure with its token budget.
4. **Knowledge updates and multi-session synthesis remain the hard parts.** This holds for Mem0 (weakest categories) and Zep (regression on assistant-recall questions). Contradiction handling is the design choice that matters most.
5. **Writes and forgetting are barely benchmarked** ([Mem0 guide](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)). AIR needs its own mechanism tests for those.

### 1.4 Retrieval engineering

**Fusion.** Reciprocal rank fusion (RRF) needs only ranks, so it combines BM25 and vector results without normalizing their scores. It can run inside one SQLite query over FTS5 and sqlite-vec ([Alex Garcia](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html); [Simon Willison](https://simonwillison.net/2024/Oct/4/hybrid-full-text-search-and-vector-search-with-sqlite/)). Bruch et al. found that a tuned convex combination of normalized scores outperforms RRF both in-domain and out-of-domain. They found RRF is sensitive to its constant, the choice of normalization matters little, and the convex weight can be tuned from a small sample ([ACM TOIS 2023 / arXiv 2210.11934](https://arxiv.org/abs/2210.11934)). The practical consequence: use RRF until a labelled dev set exists, then fit a weighted sum. AIR's fixed 0.3/0.3/0.2/0.2 weights were an untuned convex combination.

**Recency and importance.** Recency and importance make good priors on top of relevance, but they cause errors when used alone. AIR's RQ3 test showed the useful mechanism: a current record outranks a stale record that is lexically closer to the query. A validity interval, as in Zep, makes this explicit. Superseded facts are filtered out of the candidate set, not merely penalized in the ranking.

**Consolidation and reflection.** Generative Agents reflection, Letta sleep-time agents and context repositories, Cognee memify, and Mem0's background consolidation ("Dream", 2026) all run consolidation outside the conversation's hot path. That fits AIR-harness's `jobs` and `schedule` packages.

**Contradictions.** There are two approaches. Overwriting with UPDATE/DELETE loses history and can delete the wrong fact. Accumulating with ADD-only surfaces stale facts. The bi-temporal "supersede, don't delete" approach keeps both history and a clean current view.

**Local embeddings.** EmbeddingGemma (September 2025) has 308M parameters. It uses Matryoshka embeddings at 768 dimensions that can be truncated to 512, 256, or 128, runs in under 200 MB of RAM with quantization-aware training, and is the top open multilingual model under 500M parameters on MTEB ([Google Developers Blog](https://developers.googleblog.com/en/introducing-embeddinggemma/)). It runs locally through Ollama or ONNX. nomic-embed and bge models remain viable alternatives. At personal-memory scale (10^3 to 10^4 items), 256 dimensions are enough and a brute-force cosine scan in JavaScript is fast.

**Local stores usable from Node.** AIR-harness's `session-query-sqlite` already uses `node:sqlite` (`DatabaseSync`). Node added `allowExtension` and `loadExtension()` in v22.13.0 ([Node docs](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html)). Field reports show sqlite-vec failing to load in some deployments: a `node:sqlite` build without extension loading on macOS, and a sqlite-vec Windows DLL built against an older SQLite ([openclaw #66977](https://github.com/openclaw/openclaw/issues/66977), [#65704](https://github.com/openclaw/openclaw/issues/65704)). LanceDB has a solid TypeScript SDK, but one comparison notes it has no multi-process write locking ([Kanopy Labs](https://kanopylabs.com/blog/lancedb-vs-chroma-vs-sqlite-vec)). DuckDB VSS is another option, but it adds a second database engine. The safest recommendation is to rely only on FTS5, which ships in SQLite. Store vectors as BLOBs and scan them in JavaScript, with sqlite-vec as an optional accelerator.

### 1.5 Trade-off table

| Approach | Examples | Strengths | Weaknesses | Fit for AIR-harness |
|---|---|---|---|---|
| Markdown files + pinned index, agent-edited | Claude Code auto memory, Anthropic memory tool, Letta MemFS | Human-readable and editable; diffable; git history gives undo; no infrastructure; the model already knows file tools | Recall depends on the index file and agent search; no semantic search by itself; index bloat needs caps | **Source of truth.** |
| Files + derived hybrid index (FTS5 + vectors) | Letta Filesystem benchmark, AIR M4 | Adds lexical and semantic recall; rebuildable; local | Index drift; embedding-model upgrades require re-embedding | **Retrieval layer.** |
| Vector DB with LLM fact extraction | Mem0, LangMem | Compact facts; token-efficient; mature | Opaque store; extraction errors silently corrupt memory; UPDATE/DELETE risk | Borrow the extraction prompts, not the store. |
| Temporal knowledge graph | Zep/Graphiti, Cognee | Best at temporal and relational questions; explicit validity | Graph DB dependency; LLM cost per ingest; hard for users to inspect or edit | Borrow validity intervals as frontmatter fields only. |
| Self-organizing notes | A-MEM, MemOS | Links and evolution; rich metadata | Many LLM calls; automatic rewriting of old memories widens the poisoning surface | Defer. |
| Raw history search | Claude chat search, AIR-harness `session-query` | No extraction loss; exact quotes | Costly at read time; noisy; no consolidation | Keep as the episodic fallback tool. |
| Continuous screen/activity capture | Recall, screenpipe, Chronicle | Richest ambient recall | Privacy backlash, injection surface, cost | Not in v1 (see §3). |

## 2. Recommended memory design for AIR-harness

### 2.1 Principles

1. **Files are the truth, and the index is derived.** Deleting the SQLite index loses nothing.
2. **Every memory byte a model sees is in the session log** ("model-visible ⟺ logged"). Memory files change over time, so the log records the rendered text, not a file reference.
3. **Plugins, not loop changes.** Memory is a capability seam: a Service Definition, providers, and consumers.
4. **Trust follows the source.** Where a memory came from decides what it may do.
5. **Tunables are Config.** Weights, budgets, half-lives, and scopes are validated `Config` fields, not constants.

### 2.2 Package layout (proposed)

- `packages/memory/memory`: the Service Definition. Defines `MemoryStore` (list, read, write, supersede, forget), `MemoryIndex` (search), the branded `MemoryId` and `MemoryScopeId`, and session events.
- `packages/memory/memory-store-markdown`: the provider for Markdown plus frontmatter in a git-initialized directory.
- `packages/memory/memory-index-sqlite`: the FTS5 and vector index on `node:sqlite`, rebuilt by content hash.
- `packages/memory/tool-memory`: model tools `memory_search`, `memory_read`, `memory_write`, `memory_forget`.
- `packages/context/memory-context`: injects the pinned core and optional auto-recall.
- `packages/memory/memory-consolidate`: a job run through `jobs`/`schedule` for extraction and consolidation.

### 2.3 Storage layout

```
~/.local/share/air/memory/            # user scope (XDG_DATA_HOME); git repo
  MEMORY.md                           # index: one line per memory, capped
  user/  feedback/  reference/        # typed topic files
  projects/<workspace-id>/            # project scope; same types
  .quarantine/                        # proposed memories awaiting approval
<index>: ~/.cache/air/memory-index.sqlite   # derived, disposable
```

Frontmatter per file (YAML):

- `id`
- `type`: `user`, `feedback`, `project`, `reference`, or `episode`
- `scope`: `user` or `project:<id>`
- `description`: one line, used in the index and as the fact key
- `created`, `updated`
- `valid_from`, `valid_to`: the validity interval borrowed from Zep, where `valid_to` marks a superseded memory
- `supersedes` / `superseded_by`
- `importance`: 1–5
- `source`: one of `user-stated`, `user-confirmed`, `agent-inferred`, or `tool-derived:<tool>`, plus the session id and log sequence it came from
- `trust`: derived from `source`
- `last_recalled`

Every write is a git commit whose message names the session that made it. That gives history, `git revert`, and review with `git log -p`, as in Letta.

### 2.4 Memory types, mapped from AIR's logical views

| AIR view | AIR-harness home | Loaded how |
|---|---|---|
| STM | The current session itself (the log and compaction) | Already present |
| LTM: user profile | `user/*.md` (role, preferences, expertise) | Pinned core |
| LTM: procedural | `feedback/*.md` (how the user wants the agent to work) | Pinned core; **writes need user confirmation** |
| Project | `projects/<id>/*.md` | Pinned core when that workspace is active |
| Semantic | `reference/*.md` (pointers, facts about the world or the user's tools) | Search only |
| Conversation / episodic | `episode` digests produced by the consolidation job, plus `session-query` over raw logs | Search only |

### 2.5 Write path: three tiers

1. **Explicit hot-path tool** (`memory_write`, `memory_forget`). The user says "remember X", or the agent proposes a memory and the user confirms. The tool call and result are ordinary logged tool events. This is the Claude Code and Anthropic memory-tool model, and it has the highest trust.
2. **End-of-session extraction job.** When a session goes idle or ends, a `jobs` task reads the session log. Its prompt is modelled on Mem0/LangMem extraction, and it emits candidate facts with the log sequence each came from. Each candidate is compared with existing memories by hybrid search:
   - a duplicate updates `last_recalled`;
   - a refinement edits the existing file;
   - a contradiction creates a new file and sets `valid_to` and `superseded_by` on the old one, which is never deleted;
   - anything new is written.

   A trust gate applies: a candidate whose supporting turns include untrusted content goes to `.quarantine/` and is not committed. Untrusted content means web fetches, file contents outside the workspace, email, clipboard, desktop readings, or MCP results. The job runs as its own session, so every model call it makes is logged under the same rule.
3. **Nightly consolidation** (`schedule`, sleep-time style). This pass merges near-duplicates and rewrites `MEMORY.md` under its cap (Claude Code uses 200 lines or 25 KB; AIR-harness should make the cap Config). It decays `importance` for memories that have not been recalled, flags stale `project` memories whose workspace no longer exists, and produces a digest of pending quarantine items for the user. It needs a per-run budget and a cap on model calls, given the Chronicle quota report.

Forgetting is layered:

- **Soft.** A superseded or expired memory is excluded from search.
- **User forget.** The file is deleted, the index row removed, and a commit recorded.
- **Hard purge.** Rewriting git history requires explicit user action.

The documentation must say plainly, as OpenAI's does, that forgetting a memory does not erase earlier session logs where the fact appeared. Removing those is a session-deletion operation.

### 2.6 Read path

**Pinned core (session start).** Render `MEMORY.md` plus the `user/` and `feedback/` entries, and the `projects/<id>/` entries for the active workspace, within a Config token budget (for example 1–2K tokens). Inject the result once, as a durable, source-attributed context message, following the `agent-instructions` and `time-context` conventions. **Freeze it for the session.** Later memory changes are appended as small delta readings ("memory updated: …") and the prefix is never rewritten. This keeps the reusable request prefix byte-stable for KV cache hits, the same property `time-context` documents ("Append-only; newly visible content follows the reusable request prefix").

**Agentic recall (primary).** `memory_search(query, scope?, types?, include_superseded?)` returns ranked snippets with ids. Letta's result suggests letting the model search iteratively beats one-shot injection. The results are tool results, so they are logged automatically.

**Auto-recall (optional, off by default).** On the first step of a turn, run hybrid search on the user message and append the top-k results under a small budget (for example 500 tokens) after the user message. Skip injection when the top score is below a floor, so irrelevant memories do not distract the model. Record a structured session event such as `memory.recall` with the query, scope, candidate ids, component scores, content hashes, and the exact rendered text. Declare it in `SessionEventMap` with JSDoc (`@mode`, `@param`). Treat it as required-on-read unless it is purely diagnostic.

**Ranking.** Stage 1 generates candidates: FTS5 BM25 over `description` + body, with the LongMemEval "K = V + fact" key expansion, plus vector kNN over the same text. The two lists are fused with RRF (k = 60 as a Config default). Stage 2 filters out superseded and out-of-scope items. Stage 3 reranks with `relevance_fused × (1 + w_r·recency + w_i·importance + w_t·trust)`, where recency is `exp(-Δt / half_life)` measured from the later of `updated` and `last_recalled`. The weights and half-life are Config fields and start from AIR's ratios. Once the evaluation set in §2.9 exists, replace RRF with a fitted convex combination (Bruch et al.).

**Embeddings.** Use a pluggable `EmbeddingProvider` with local defaults: EmbeddingGemma through Ollama, truncated to 256 dimensions, or nomic-embed-text. Store the model id and dimension with each vector and re-embed lazily when the model changes. If no embedder is available, fall back to FTS5 only, and say so in the recall event rather than skipping silently.

### 2.7 User controls

- A `/memory` command and a Web panel to list, show, edit (open in `$EDITOR`), forget, restore (git revert), and review quarantine (approve or reject). Each recalled memory shown in the UI links to its file and to the session and log sequence it came from.
- **Scopes.** Keep user and per-project memory separate. A project memory is never recalled outside its workspace. Claude's project-scoped memory is the product precedent.
- **Modes.** Memory on, read-only (recall but no writes), or off. Add an **incognito session** flag that disables both reads and writes, which Claude and Gemini both offer. The session header records the flag so replay is faithful.
- **Export.** The memory directory is the export, so no special format is needed.
- **Visibility.** Recall and writes appear as tool or context cards in the transcript, never hidden.

### 2.8 Poisoning defenses

The threat is well documented. MINJA (NeurIPS 2025) poisons memory through ordinary queries alone. Follow-up work reports over 95% injection success and 70% attack success under idealized conditions ([arXiv 2601.05504](https://arxiv.org/html/2601.05504v2)). AgentPoison targets RAG and memory stores ([arXiv 2407.12784](https://arxiv.org/abs/2407.12784)), and MemoryGraft (December 2025) poisons experience retrieval ([arXiv 2512.16962](https://arxiv.org/abs/2512.16962)). On the defense side, A-MemGuard (ICML 2026) uses consensus across related memories plus a separate "lessons" store, and reports more than 95% attack-success reduction ([arXiv 2510.02373](https://arxiv.org/abs/2510.02373)). The FARMA attack (July 2026) forges reasoning traces, reports up to 100% attack success, and defeats both keyword filters and A-MemGuard. Its authors' SENTINEL defense cut FARMA to as low as 0%, with no false positives on 326 benign traces ([arXiv 2607.05029](https://arxiv.org/abs/2607.05029)). The lesson is that detection alone cannot be relied on. Limit what a memory can do.

Layered defenses for AIR-harness:

1. **Taint by source.** Any turn in which untrusted content entered the context taints the facts extracted from it, and tainted candidates go to quarantine. The `source` field makes this checkable.
2. **Memories are declarative data, not instructions.** Reject candidates phrased as imperatives or conditional rules ("always…", "when X, do Y", "ignore…") unless the user wrote them. `feedback/` (procedural) memories are writable only through explicit user confirmation.
3. **Render as quoted data.** The injected block is fenced and labelled as user-owned notes, with a line saying they are notes and not instructions. Every memory keeps its source, so the model and user can weigh it.
4. **Memory cannot authorize actions.** Permission checks for side-effectful tools ignore memory content. A remembered "user allows X" never replaces a live approval.
5. **Path confinement.** Memory tools touch only the memory root. The Anthropic docs require path-traversal rejection explicitly.
6. **Review surface.** Git diffs, the quarantine digest, and an "agent-inferred" badge in the UI.
7. **Later.** Add a SENTINEL- or A-MemGuard-style consistency check in the consolidation job and treat its flags as prompts for user review.

### 2.9 Evaluation plan

**A. LongMemEval_S subset (end-to-end).** Take a stratified sample of about 100 of the 500 questions across all seven types, including the `_abs` abstention items. Replay each history into AIR-harness sessions, run the extraction job, then ask the question in a new session. Report accuracy per type **together with** injected tokens per question, latency, and model calls spent on extraction. Pin the answer model and the judge in the report, since protocol dominates scores. Arms:

1. no memory;
2. raw `session-query` search tool only;
3. files + FTS5 only;
4. files + vector only;
5. hybrid RRF;
6. hybrid + priors;
7. arm 6 + auto-recall.

Arm 2 versus the rest tests Letta's claim on AIR-harness's own stack.

**B. Conflict subset.** Run the MemoryAgentBench conflict-resolution items and the LongMemEval knowledge-update items to exercise supersession.

**C. Deterministic mechanism tests (AIR RQ3 style, no network).** Use a hashed embedding provider, as AIR RQ3 did, and cover:

- current-beats-stale;
- superseded exclusion unless `include_superseded`;
- abstention floor (a query with no relevant memory injects nothing);
- scope isolation (project A never recalled in project B);
- forget removes a memory from the index and the next recall;
- incognito performs no reads or writes;
- the quarantine gate (a fact that arrived through a web-fetch result is not committed);
- imperative-rejection;
- index rebuild equivalence (drop the index, rebuild it, get identical rankings).

**D. Logging and caching invariants.**

- A keyless recorded-session snapshot replays with the memory directory **absent** and still reproduces every model-visible memory byte from the log.
- The request prefix is byte-identical across turns after a mid-session memory write.
- The TypeScript and Python SDK expected outputs are updated for the new session events.

**E. Poisoning red team.** Run MINJA-style query sequences and an indirect injection through a fetched page, a window title, and a clipboard reading. Measure how many candidates reach committed memory. The target is zero without a user approval.

## 3. Desktop-context provider design

### 3.1 Lessons from ambient-capture products

- **Microsoft Recall** was pulled after a 2024 backlash. It returned opt-in, with snapshots encrypted under TPM-held keys usable only inside a VBS enclave and gated by Windows Hello ([Windows Blog, Sept 2024](https://blogs.windows.com/windowsexperience/2024/09/27/update-on-recall-security-and-privacy-architecture/)). It reached broad availability in April 2025 with a sensitive-information filter on by default ([TechRepublic](https://www.techrepublic.com/article/news-microsoft-recall-expands-rollout/)), but testers reported the filter still missed sensitive data ([BetaNews, Aug 2025](https://betanews.com/2025/08/04/microsoft-recall-is-bad-at-filtering-sensitive-information/)). Signal set the DRM screen-capture flag to block it, and Brave (1.81) and AdGuard followed ([BleepingComputer](https://www.bleepingcomputer.com/news/security/brave-blocks-windows-recall-from-screenshotting-your-browsing-activity/)). Lesson: applications now signal that they do not want to be captured, and a well-behaved agent must honour that.
- **Rewind/Limitless** was acquired by Meta. Screen and audio capture was disabled on 2025-12-19, and EU and UK users lost the service ([9to5Mac](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/)). Lesson: a local-first design only protects users if the data format and tools are open.
- **screenpipe** uses event-driven capture (app switch, click, typing pause, clipboard), with the accessibility tree as the primary text source and OCR as a fallback. On Linux, Tesseract OCR is the primary engine because accessibility support varies ([screenpipe docs](https://docs.screenpipe.com/architecture); [GitHub](https://github.com/screenpipe/screenpipe)). Lesson: accessibility text is cheaper and more precise than screenshots, and Linux is the weakest platform for it.
- **Chronicle** kept accessibility text and interaction events and dropped screenshots and audio. It warns about prompt injection (see §1.1). Lesson: any text captured from the screen is untrusted input.

### 3.2 Signals and default policy

| Tier | Signals | Default | Delivery |
|---|---|---|---|
| 0: system state | OS, power/battery, network online, idle/locked, CPU/memory pressure, disk free | On when the plugin is enabled | Push reading on change, at most once per turn |
| 1: focus | Active application (process/app id), window title (redacted), workspace/desktop, current repo (already known), recently used files from the XDG `recently-used.xbel` or editor | Opt-in per signal | Push the app id on change; title and recent files **pull only** through `desktop_context` |
| 2: content | Clipboard text, selected text, focused-element accessibility text | Opt-in, and **each pull needs a live user action or confirmation** | Pull only |
| Never | Keystrokes, continuous screenshots, audio, password/secure fields, private-browsing windows, capture-protected windows, deny-listed apps | — | — |

Redaction runs before anything is logged, because the log is permanent:

- Drop clipboard items marked `org.nspasteboard.ConcealedType` or `TransientType` (macOS), `ExcludeClipboardContentFromMonitorProcessing` or `CanIncludeInClipboardHistory = 0` (Windows), or `x-kde-passwordManagerHint` (X11/Wayland). These are the markers password managers set ([CrossPaste PR](https://github.com/CrossPaste/crosspaste-desktop/pull/5015)).
- Skip secure text roles: macOS `AXSecureTextField`, AT-SPI `ROLE_PASSWORD_TEXT`, UIA `IsPassword`.
- Skip windows that request capture exclusion.
- Apply a default app denylist (password managers, messaging) plus user patterns.
- Apply regex scrubbers for tokens, card numbers, and email addresses.
- Cap sizes.
- Log counts of redactions, never the redacted content.

### 3.3 Per-OS mechanisms

| Signal | Linux X11 | Linux Wayland | macOS | Windows |
|---|---|---|---|---|
| Active app/window | EWMH `_NET_ACTIVE_WINDOW`, `WM_CLASS`, `_NET_WM_NAME` via xcb | No protocol concept of an active window ([ActivityWatch FAQ](https://docs.activitywatch.net/en/latest/faq.html)). GNOME: Shell extension exposing focus over D-Bus (the ActivityWatch workaround, [issue #1218](https://github.com/ActivityWatch/activitywatch/issues/1218)). KDE: KWin scripting/D-Bus. wlroots: `wlr-foreign-toplevel-management`, `swaymsg`/`hyprctl` ([aw-watcher-window-wayland](https://github.com/ActivityWatch/aw-watcher-window-wayland)) | `NSWorkspace.frontmostApplication` needs no permission. Window title needs the Accessibility permission (`AXFocusedWindow`/`AXTitle`) | `GetForegroundWindow`, `GetWindowText`, process from `GetWindowThreadProcessId` |
| Focused text | AT-SPI2 over the D-Bus accessibility bus ([freedesktop](https://www.freedesktop.org/wiki/Accessibility/AT-SPI2/)) | AT-SPI2 (GNOME works; KDE from Plasma 6) | AXUIElement focused element (Accessibility/TCC grant) | UI Automation focused element |
| Clipboard | X selections; check `TARGETS` for hints | `wl-paste --list-types` (data-control protocol; compositor-dependent) | `NSPasteboard` + `changeCount`; check pasteboard types | Clipboard API; check exclusion formats |
| Idle/lock | XScreenSaver extension | `ext-idle-notify-v1`, logind `LockedHint` | `CGEventSourceSecondsSinceLastEventType`; screen-lock notifications | `GetLastInputInfo`; WTS session notifications |
| Recent files | `~/.local/share/recently-used.xbel` | same | Spotlight/`LSSharedFileList` (limited); prefer editor/workspace | Recent items via Shell; prefer editor/workspace |

Implement each row as a provider behind one `desktopContext` Service Definition, for example `desktop-context-x11`, `-wayland-gnome`, `-wayland-kde`, `-wlroots`, `-macos`, `-windows`. OS calls go through small native helpers; the repository already has `native/` addon infrastructure. An unavailable signal returns an explicit `unsupported` reason, which is recorded in the reading and never silently omitted. AIR's Python `core/context/` providers (`active_window`, `clipboard`, `open_files`, `current_project`, `system_state`) map onto these rows one to one.

### 3.4 Logging and caching

Follow the `tmux-context` pattern: on the first step of a turn, append a durable, source-attributed reading **only if the value changed**. Put the structured payload (signal names, values after redaction, redaction counts, permission state, provider id) in a declared session event, and keep the rendered text in the model-visible message. Readings are appended after the reusable prefix, so they never invalidate the KV cache. Pulls through `desktop_context` are tool calls and are logged as such. Every desktop reading is marked **untrusted**: a window title or clipboard can carry injected instructions, as Chronicle's documentation warns. That mark feeds the memory quarantine gate in §2.5. Desktop readings are never written to memory directly.

### 3.5 Consent flow

1. Show a first-run dialog per tier, and a separate OS permission prompt for Accessibility on macOS, with a plain list of what is captured and where it is stored (the session log).
2. Show a persistent indicator in the Web and terminal UI while any tier 1 or 2 signal is enabled, with one-click pause.
3. In the session transcript, each reading renders as a card showing exactly what the model saw.
4. Settings expose per-signal toggles, the app denylist, and redaction patterns. All of these are Config fields.
5. There is no background recorder in v1. If a timeline feature is added later, it should be a separate opt-in package with its own retention limits and encryption at rest, following Recall's opt-in-with-Hello model.

## 4. Open questions and risks

- **Logging versus forgetting.** Append-only logs make "forget" partial by design. Minimization at capture and a clear session-deletion path are the mitigations. The team should confirm this is acceptable for desktop readings.
- **sqlite-vec portability** on `node:sqlite` builds varies by platform. A pure-JavaScript vector scan avoids the dependency at personal scale; benchmark it before adopting sqlite-vec.
- **Extraction cost** under a DeepSeek-only stack is unknown. Measure model calls and tokens per session in eval A before scheduling nightly jobs by default.
- **MemOS "DeepSeek Harness support"** should be inspected: it may offer a comparison baseline or overlap with this design.
- **Wayland focus tracking** needs per-compositor code, and GNOME needs a Shell extension. Decide whether AIR-harness ships that extension or documents it.
