# Fitting a Verifiable Agent Harness onto an 8 GB GPU: Context Budgeting, Convention Compatibility, and Review-Before-Registration in {{PRODUCT_NAME}}, a Local-First Personal Agent

Draft for the Phase 1 final review. Date: 2026-10-20. Upstream base: release tag `dsh-v0.2.1-alpha.2`. The product name is undecided; the placeholder `{{PRODUCT_NAME}}` is defined in `air/BRANDING.md`, and the working name AIR is used in the running text below. This is a Phase 1 report: every number comes from the repository's verification log, research notes, or plans, and every result is labelled with how it was obtained. Where the repository holds no evidence, the text says so.

## Abstract

General-purpose agent harnesses are designed around hosted models with context windows of 128,000 tokens or more. A student-owned laptop with an 8 GB consumer GPU runs an 8-billion-parameter model with a usable window of 16,384 or 32,768 tokens, and the harness's own fixed prompt then occupies a large share of that window before the user types anything. This paper reports Phase 1 of AIR, a local-first personal agent delivered as out-of-tree plugins on a fork of an MIT-licensed agent harness. We ask four questions: how much of a small window the harness consumes and how far tool-set selection and compaction policy reduce that cost; whether the project conventions of other coding agents (instruction files, skills, commands, and `.mcp.json`) can be read unchanged without harming a small model; whether Model Context Protocol (MCP) tool definitions can be reviewed before they enter the model's context; and how much upstream change this requires. In hand-run checks on one laptop, a lean preset reduced the request from 32 tools and 7,686 prompt tokens to 19 tools and 4,426 prompt tokens. We found that the upstream compaction defaults made the compaction threshold negative for 16K and 32K windows, so compaction never ran on local models until per-model policies were added. A chronological log appended to the summary instruction corrected one observed ordering failure. Review-before-registration required a small in-tree hook; the full footprint outside the AIR workspace is 23 files. The evidence is thin: most results are single runs on one machine and one model family, and no hosted model, drift corpus, user study, or benchmark was run. We list the experiments needed before the claims can be called results.

## 1. Introduction

### 1.1 Problem

Agent harnesses such as Claude Code, Codex, OpenCode, and Goose assume a model that accepts a long prompt cheaply. They send a system prompt, a catalog of tools, project instructions, a skill catalog, and the conversation on every request. On a hosted model this is a small fraction of the window. On a local model it is not. In Phase 1 of this project, the first request of a new session in the unmodified AIR composition was about 8,500 tokens before any conversation, which is 52 to 54 percent of a 16,384-token window (CHECKS, 2026-10-12). Ollama, the local runtime, defaults to a 4,096-token context on this class of GPU and truncates longer requests without an error (research note 10, section 4.5). A harness that was never exercised under these limits can fail in ways that do not look like failures: replies are cut off, the system prompt is silently dropped, or the history is never compacted.

At the same time, a personal agent that reads project files and connects to third-party tool servers has a security problem that does not depend on window size. Text in a tool description or a skill reaches the model with the authority of the system prompt, so a definition that changes after a person approved it is an attack surface (research note 04, section 1). A small model does not make this safer: the MCPTox benchmark reports that attack success on Qwen3-8b rose from 14 percent without reasoning to 41.8 percent with reasoning (research note 10, section 3.3, quoting that paper).

### 1.2 Approach and scope

AIR is built as plugins and bundles in a separate `air/` workspace that is loaded into the upstream harness's own desktop application, Web UI, and headless runner. It reads the files other agents already use, pins and reviews MCP tool definitions, and carries a set of context-budget measures for small local models. The project is a final-year university project with an owner and four teammates; the upstream project accepts no external contributions, so the fork carries its own work on a separate branch (`air/plans/README.md`, owner decisions).

Phase 1 covers plans 00 to 02 (workspace foundation, file conventions, MCP trust) and a set of follow-up fixes found while running the product on a local model (CHECKS, 2026-10-12). Plans 03 to 07 (permissions, memory, evaluation pilots, desktop shell) are written but not executed, and are Phase 2 work. This report therefore describes a built system with hand-run checks, not a benchmarked one.

### 1.3 Research questions

The questions were formulated from the Phase 1 work after the fact, not registered in advance; Section 7 discusses what that means for the claims.

- **RQ1 (context budget).** How much of a small local model's context window does a general-purpose harness consume before any user content, and how far do tool-set selection, thinking control, and compaction policy reduce that cost without making the agent unusable?
- **RQ2 (convention compatibility).** Can a harness read another agent's project conventions (`.claude` instructions, rules, skills, commands, and `.mcp.json`) unchanged, under a byte and trust budget suited to small models?
- **RQ3 (review before registration).** Can MCP tool definitions and server instructions be held for review before the model sees them, using an in-client hook, and what do the resulting mechanism and evidence look like?
- **RQ4 (extension footprint).** How much of this can be done outside the upstream tree, and what had to be changed in it?

### 1.4 Contributions

1. A measured account of the context cost of a general-purpose harness on an 8 GB GPU, including a defect class we call hosted-window assumptions: harness defaults that are correct for large windows and silently wrong for small ones (Sections 5.1 to 5.3).
2. A small prompt-level change to compaction, a numbered chronological log appended to the summary instruction, with one live observation that it fixes an ordering failure of the small model's summaries (Section 5.3).
3. A design for review-before-registration of MCP tool definitions that works under the constraint that an out-of-tree plugin cannot add session event types (Sections 3.5 and 5.6).
4. Convention readers with containment, size, and trust limits, checked by hand against a demonstration project (Sections 3.4 and 5.5).
5. An accounting of the upstream footprint: 23 files outside the AIR workspace and the research folder at the upstream base tag (Section 5.7).

We do not claim a new pinning mechanism, a defense against prompt injection, a benchmark result, or a comparison with other products. Section 2 explains why pinning is not novel, and Section 8 lists what is needed before any such claim.

## 2. Background and Related Work

Citations below are the sources already collected in the project's research notes, with the same identifiers. Statements that need a source the notes do not hold are marked [CITATION NEEDED].

### 2.1 Local models on consumer hardware

Research note 10 measured the project laptop (Section 4 of this paper) and cites the Ollama documentation for the 4,096-token default context on GPUs under 24 GiB. The AgentDojo authors observe that more capable models tend to be more susceptible to injection and that weaker models show lower attack success partly because they fail tasks of any kind (arXiv 2406.13352, as quoted in note 10, section 10). MCPTox reports the same inverse relation for tool poisoning (arXiv 2508.14925). For this reason, a small local model complicates security evaluation: low attack success may be incapacity rather than robustness, and the thinking setting changes vulnerability. How the performance of small models degrades as a fixed prompt grows relative to the window is a general question for which the notes hold no source [CITATION NEEDED]. Published tool-use results for 4B to 9B models, such as BFCL v4 rows, were not retrieved in the notes; the project quotes none.

### 2.2 The convention ecosystem

The notes document convergence on open file formats: `AGENTS.md`, stewarded by the Agentic AI Foundation, with more than 60,000 repositories reported; `SKILL.md` under the Agent Skills standard (agentskills.io), with about 100 tokens of metadata always loaded and a body under about 5,000 tokens loaded on demand; and the Agent Plugins `plugin.json` format launched on 2026-08-07 (research note 03, sections 1.3 and 1.4). Note 03 gives eight reasons the Markdown approach works and five failure modes, including context bloat (every skill description costs tokens on every turn), skills that do not trigger (Vercel's January 2026 evaluation found a skill was never invoked in 56 percent of cases, while a compressed index in `AGENTS.md` scored 100 percent), and advice mistaken for enforcement: Anthropic's own documentation says the files are context, not enforced configuration. Third-party skills are a supply-chain risk: 26.1 percent of 31,132 marketplace skills had at least one vulnerability (arXiv 2601.10338). The notes find no product that combines open source, local-first operation, model agnosticism, a desktop experience, and user-verifiable security (note 03, section 4). That gap motivates the project, but the notes' product survey is a literature and documentation review and not an experiment, and several cells are marked as unverified.

### 2.3 MCP tool-definition security and pinning

Invariant Labs published the tool-poisoning and rug-pull proofs of concept in April 2025. MCPTox builds 1,312 poisoning cases on 45 live servers and reports 72.8 percent attack success for o1-mini (arXiv 2508.14925; notes 04 and 07). At least seven systems already pin or fingerprint MCP tool definitions, among them Invariant's mcp-scan, Trail of Bits' mcp-context-protector, Pipelock, MCPProxy, MCPTrust, the Vercel AI SDK's drift detection, and Microsoft's agent-governance-toolkit, and the OWASP MCP Security Cheat Sheet recommends pinning (research note 04, section 2.1). A GitHub issue on the Snyk agent-scan repository reports that the original pin covered only the description and that, on 74.6 percent of 59,821 release transitions, the invocation surface stayed identical while the resolved package version changed (research note 07, section 1; a third-party report, not reproduced here). Signed-definition proposals exist (ETDI, arXiv 2506.01333). Detection-based defenses against injection are weak against adaptive attackers: twelve published defenses were bypassed at above 90 percent attack success (arXiv 2510.09023), and CaMeL, a design-level defense, solves 77 percent of AgentDojo tasks with provable security versus 84 percent undefended (arXiv 2503.18813). Pinning therefore protects the integrity of tool metadata; it does not address injection through tool results. Our pinning work is positioned as an implementation inside the client's registration step, not as a new idea (Section 3.5).

### 2.4 Context management and memory

The notes describe memory and context designs in products (Claude Code's `MEMORY.md` index, the Anthropic memory tool, Letta's git-backed context repositories, MemOS) and attack classes such as memory poisoning ("Bad Memory", arXiv 2607.14611) (research note 05). They do not survey compaction or summarization of agent histories as a research topic, and the chronological-log technique of Section 3.3 has no cited prior art here [CITATION NEEDED]. Prompt caching matters for the cost of a fixed prompt: a repeated 7.9k-token prefix cost 0.03 to 0.04 seconds on a local model instead of 3.4 to 4.9 seconds (note 10, section 4.2), which is why AIR avoids changing the conversation prefix.

### 2.5 Positioning

This paper is a systems and measurement report. Its closest relatives are platform papers that combine a system with an evaluation (research note 07, section 2.3, lists OpenHands, AgentDojo, CaMeL, and MCP-Universe as templates). It does not yet have the evaluation those templates carry. Section 8 maps the missing pieces to the unexecuted plans.

## 3. System Design

### 3.1 Substrate and the out-of-tree rule

The upstream harness is an all-plugin architecture on the Cordis framework: a running process is a tree of plugin rows composed from bundles and profiles, with a durable, append-only session log and the rule that anything the model sees must be reconstructable from that log (research note 01; research.md, section 2). AIR adds ten packages under `air/packages` and five bundles under `air/bundles`, loaded into upstream's desktop application (profile `desktop`), the Web UI (profile `air`), and headless runs (profile `air-headless`), plus a command-line profile for MCP review (`air-mcp`). macOS is out of scope (`air/AGENTS.md`).

Two rules shape every design decision:

- **Stay out of tree.** AIR code lives in its own workspace, and any edit to an upstream file is listed with a re-check procedure, because the fork carries it across every sync.
- **No custom session event types.** An out-of-tree plugin cannot write events that older builds may skip, and an unknown, non-ignorable event makes a session unloadable, even by AIR's own build (spike 03, finding 1; research.md, correction 13). Model-visible input therefore enters as injected user messages with an AIR source kind or as tool results, and audit data goes to files under the harness home.

### 3.2 Surfaces and defaults

The default model route is local Ollama with `qwen3-8b-32k`, a variant of `qwen3:8b` with a 32,768-token context. Accounts, upstream telemetry, and session-log upload are disabled in the AIR bundle. A second bundle, `air-desktop`, restores two account rows that upstream's desktop application reads at boot, because without them the window showed a web request failure (`air/README.md`).

### 3.3 Context-budget mechanisms (RQ1)

Five mechanisms were added after the first live run showed the fixed prompt at 52 to 54 percent of a 16K window.

1. **A lean preset.** The `air-lean` preset is the upstream standard preset with the schedule, goal, delegation (subagent, fork, listing, messaging, interrupt), and workflow tools removed. Its plugin list is generated from the full `air` preset by a script, and a lint step fails if the generated block is stale.
2. **Preset by model.** A plugin selects `air-lean` for a blank session whose model has a context window below 65,536 tokens and `air` otherwise. It acts only through the preset registry's own selection operation, so the session log holds the ordinary selection event, and it never overrides a preset the user chose.
3. **Thinking off by default for Qwen 3.** Thinking multiplies output tokens four to five times per step in measurement (note 10, section 4.4). The route maps the `off` effort to `none`. A companion plugin keeps a one-off effort pick in the session instead of saving it as the new default.
4. **Per-model compaction policies.** Upstream's compaction engine computes its threshold as the smaller of the window times a ratio and the window minus the reserved output minus a headroom, and its default headroom is 65,536 tokens. For a 16K or 32K window the second term is negative, so compaction was skipped. AIR generates per-model overrides for headroom, retained tokens, and the summary's output limit from one table. This is the hosted-window assumption defect of Contribution 1.
5. **A chronological log in the summary.** The compaction engine of the `compaction-log` package is upstream's engine with one change: while it makes the summary call, a one-shot listener on the model-stream hook appends two sections to the final user message, a numbered log of every user request and tool call, oldest first, capped at 60 entries, and the first user request quoted verbatim, cut to 300 characters. The conversation prefix is unchanged, so the provider's prefix cache is reused. The summary call needs room for the log, so the summary output limit is 2,048 tokens for 32K windows.

An in-tree two-line change in the chat client keeps the "Context compacted" row visible outside collapsed tool groups, because trimming context silently is a user-facing hazard (`air/UPSTREAM-DELTA.md`).

### 3.4 Convention readers (RQ2)

Five packages read the files other agents use, mapped onto existing upstream seams:

| Input | Package | Behavior |
|---|---|---|
| `.claude/skills`, `.agents/skills`, `.dsh/skills`, user skill roots | skill-conventions | A skill provider ranked among the project roots; user-level roots from other agents are off by default |
| `.claude/CLAUDE.md`, `@path` imports (at most four hops), `.claude/rules` | instruction-conventions | One baseline user message with source kind `air-instructions`, re-added only when the digest of the assembled text changes; rules with `paths:` arrive after the first matching file operation |
| `.claude/commands/*.md` | command-conventions | Slash commands with `$ARGUMENTS` substitution; a file named like a built-in command is skipped |
| `.mcp.json` | mcp-conventions | Servers mounted per Agent, each requiring a person's approval keyed by the full entry and working directory |
| Shared library | convention-core | Contained reads, frontmatter parsing, a polling watcher, and a table of tool names |

Three design points are relevant to small models and to safety. First, a byte budget bounds the injected instructions (the AIR bundle sets 32,768 bytes), and a file that does not fit is named in a `skipped` line rather than truncated. Second, user-level folders written for other agents are not read by default, because a large unrelated skill catalog derailed the small local model (plan README, Phase 1 cut; the observation was not measured). Third, every file read goes through a contained reader that requires the real path to lie inside an allowed root, refuses credential-like files, and enforces a size cap; residual risks, such as hard links and Windows junctions, are listed in the package README. Markdown remains advice: the instruction block advises the model, and only pinning, approval, and the sandbox enforce.

### 3.5 Review before registration (RQ3)

The design follows research note 04, section 3. Because a poisoned description harms the model without the poisoned tool ever being called, a call-time guard alone leaves the text in the context. The enforcement point must be the operation that registers tools.

**The hook.** Upstream's MCP client fetches a server's tool list and registers it in two phases. AIR adds an optional `mcpToolReview` service that the client consults once per sync between fetch and registration. A reviewer that rejects or throws leaves the server with zero tools and withdrawn instructions; with no reviewer, behavior is unchanged. Every MCP row in an AIR patch declares the service as an injected dependency, so the row stays pending, rather than registering unreviewed, until the reviewer exists. This is the one in-tree edit that a plugin could not avoid.

**The reviewer.** The `mcp-trust` package digests each tool over name, title, description, input schema, output schema, annotations, and execution fields, using RFC 8785 canonical JSON and SHA-256, plus the server instructions, and compares the result with a lockfile that stores the approved definitions themselves. The shipped mode is `enforce`: a server with no pin registers nothing, and a changed pinned surface is quarantined until a person reviews it. Policies exist for added, changed, and removed tools. A person approves either with the `air-mcp` command line (`list`, `diff`, `pin`, `verify`, `revoke`) or, for project servers that the command line cannot observe, with `/mcp-trust` inside a session. `pin` requires a short prefix of the digest of the surface that `diff` printed, so a surface that changed after it was read cannot be approved by mistake. Server-supplied text is shown with control and bidirectional characters made visible and cut at 4,000 characters.

**Audit under the event constraint.** Research note 04 proposed log-only session events for surface verdicts. Spike 03 found that an out-of-tree plugin cannot write such events safely, so the implementation writes JSON Lines sidecar files (one per session and one for the process, with full definition text stored by digest) under the harness home, and writes nothing to the session log. The consequence is stated in Section 7: a session log alone does not say which surface the model saw.

**What is new and what is not.** Section 2.3 lists existing pinning systems. The claim for AIR is limited to the integration points: enforcement inside the client's registration transaction, a lockfile with full approved definitions that allows readable diffs, a digest contract shared with the Python evaluation tooling through a golden file, and per-server-definition pins so that two projects with the same server name do not overwrite each other.

### 3.6 Upstream footprint (RQ4)

Section 5.7 lists the in-tree edits. The three kinds are the review hook in the MCP client, a platform table and two related files in the desktop application (so that the development launcher accepts Linux), and a two-line change in the chat client. Housekeeping files (CI workflow, a pointer file, an ignore file, a gate manifest, a generated catalog) make up the rest.

## 4. Methodology

### 4.1 Nature of the evidence

This is an engineering report built on three kinds of evidence, which we keep apart in every table:

- **Hand-run checks** recorded in the verification log (`air/CHECKS.md`): a person ran the desktop application with a local model, drove it through scenarios, and recorded the outcome. These are single runs with no repetition and no controls beyond what each check describes.
- **Measurements** from research note 10: probes on the project laptop on 2026-10-02 (MEASURED in the note's own vocabulary) and two runs on 2026-10-10 whose scripts and raw result files were lost when the machine restarted on 2026-10-12. The 2026-10-10 figures are summaries and cannot be reproduced from stored data.
- **Automated tests**, whose counts were recorded in the plan files at the time of execution. Tests show that behavior matches the specification, not that the specification is right.

We use the labels MEASURED (run by a person on the machine named), ESTIMATE (arithmetic or an assumption), DERIVED (arithmetic over reported values, computed for this paper), and CLAIM (a figure quoted from a cited source, not reproduced).

### 4.2 Environments

| Item | Linux environment | Windows environment |
|---|---|---|
| Date of use | 2026-10-02 to 2026-10-12 | 2026-10-20 |
| OS | Fedora 44 (Wayland session) | Windows 11 Home 10.0.26200 |
| CPU and memory | Ryzen AI 9 HX 370; 30 GiB RAM | 31 GB RAM |
| GPU | RTX 4060 Laptop, 8 GiB | RTX 4060 Laptop, 8 GB |
| Ollama | 0.32.7 | 0.40.6 |
| Node and pnpm | Not recorded here | Node 26.12.0; pnpm 11.28.5 |
| Models | `qwen3:8b` variants at 16,384 and 32,768 tokens; others in note 10 | `qwen3-8b-32k`, `qwen3-8b-16k` |

All Phase 1 hand runs used the project owner's laptop (Linux) or one Windows 11 laptop of the same GPU class. The two machines are not independent subjects.

### 4.3 Protocols per question

- **RQ1.** Request size was read from a recording proxy in front of Ollama (checks E4, E5) or from the desktop application's Trajectory view; context-versus-speed figures come from the raw Ollama API at four context sizes, with one warm-up and two measured requests per configuration (note 10, section 12.1); in-harness task reliability comes from ten small tasks run twice per model under the headless profile, scored by string match and by files left on disk (note 10, section 12.2); compaction behavior comes from checks E8 and F4.
- **RQ2.** A scripted scratch project with a skill, a command, instructions with an import, a rule, and a `.mcp.json` server (`pnpm -C air run demo`) was loaded in the desktop application and the Web UI, and each feature was exercised once. The desktop application was driven through Electron's renderer debugging port (`air/scripts/desktop-drive.mjs`).
- **RQ3.** Scenario tests against the real plugin loader with a mutable fixture server, a live walk-through of approval, diff, and pin on the demo server, and the two gaps the walk-through exposed.
- **RQ4.** The list of files changed outside the AIR workspace and the research folder at the upstream base tag, and the record of four upstream syncs.

### 4.4 What is deliberately out of the method

No baseline product, hosted model, repeated trial, statistical test, human participant, or benchmark was used. The two evaluation plans (plans 05 and 06) were written, and their code was run in a scratch copy, but they are not part of the repository's executed work; Section 5.8 reports their pilot figures only as a caution about variance.

## 5. Evaluation and Results

### 5.1 Fixed prompt cost (RQ1)

| Configuration | Tools | Prompt tokens | Share of 16,384 | Share of 32,768 | Basis |
|---|---|---|---|---|---|
| First live request, early composition (2026-10-12, 16K model) | not recorded | about 8,500 | 52 to 54 percent | not applicable | CHECKS, desktop check, hand-run |
| Full preset, earlier capture | 36 | 8,113 | 49.5 percent (DERIVED) | 24.8 percent (DERIVED) | CHECKS E4, hand-run |
| `air` preset chosen by hand | 32 | 7,686 | 46.9 percent (DERIVED) | 23.5 percent (DERIVED) | CHECKS E5, hand-run |
| `air-lean` (default) | 19 | 4,426 | 27.0 percent (DERIVED) | 13.5 percent (DERIVED) | CHECKS E4, hand-run |

Removing 13 tools and the prompt text that accompanies them cut 3,260 prompt tokens in the same-day comparison (7,686 minus 4,426, DERIVED), which is about 250 tokens per removed tool. The preset package README states a saving of about 3,400 tokens; the sources do not explain the difference between the earlier 36-tool capture and the 32-tool capture, so we use the same-day pair. The Windows first run on 2026-10-20 showed 4.8K tokens in the request on the lean preset (CHECKS), consistent in order of magnitude with the Linux capture; the exact count was not recorded.

Between the earlier full-preset capture and the lean preset the fixed cost fell by 45 percent, and by 42 percent in the same-day pair (DERIVED); on a 32K window the remaining overhead is 13.5 percent of the window by arithmetic. A fixed prompt of this size also dominates the token cost of short tasks. In the in-harness run, a model step cost on the order of 9,000 tokens (25,600 tokens per run over 2.8 steps, DERIVED, assuming the source's tokens-per-run figure counts all steps' input and output, which it does not state). Because the Ollama prefix cache makes an unchanged prefix nearly free (0.03 to 0.04 seconds against 3.4 to 4.9 seconds, MEASURED), the time cost of the fixed prompt is mainly paid on the first request and whenever the prefix changes, for example when a convention file changes. This is an inference from the cache probe; it was not measured inside the harness.

**Silent truncation.** On 2026-10-02 a 7.9k-token request sent to `qwen2.5:7b-instruct` through the OpenAI-compatible endpoint with the default context reported 2,050 prompt tokens, and the model answered that the text contained no secret word that the text began with (MEASURED, n = 1; note 10, section 4.5). The AIR documentation therefore requires a Modelfile variant with `num_ctx` for every local model, and the profile's `contextWindow` must equal it. A startup check that reads the loaded context is recommended in the notes but not built.

### 5.2 Window size, speed, and GPU fit (RQ1)

Measured on the raw Ollama API on 2026-10-10 with temperature 0 and thinking off, with a system prompt of 5,523 tokens (the harness itself sends about 7,500, so real speeds are slightly lower; raw data lost):

| Model | Generation speed at 8k / 16k / 24k / 32k (tokens per second) | GPU share at 8k / 16k / 24k / 32k |
|---|---|---|
| `qwen3:8b` | 40 / 33 / 21 / 15 | 100 / 90 / 76 / 67 percent |
| `qwen3.5:9b` | 41 / 39 / 40 / 33 | 100 / 100 / 100 / 87 percent |
| `llama3.1:8b` | 43 / 42 / 30 / 23 | 100 / 100 / 82 / 74 percent |
| `granite4.2:8b` | 36 / 27 / 16 / 13 | 100 / 85 / 72 / 63 percent |
| `qwen2.5:7b-instruct` | 48 at every size | 100 percent at every size |

The KV cache size differs strongly between models of similar parameter count: `qwen3:8b` needs about 141 KiB per token and `qwen2.5:7b-instruct` about 47 to 57 KiB per token (MEASURED, note 10, section 3.1). Thus the same 8 GB GPU gives `qwen3:8b` a 33 tokens-per-second experience at 16K and a 15 tokens-per-second experience at 32K, because part of the model runs on the CPU. The project chose 32K as the default (about 15 tokens per second) and keeps 16K as a faster but tight alternative, trading speed for room. The rationale is that at 16K the fixed prompt plus the 4,096-token reply reserve leaves little space (`air/README.md`); the choice was not tested with users.

Hand-run speeds agree in order of magnitude: about 30 tokens per second in the first desktop run at 16K on Fedora, and 17 tokens per second at 32K on Windows, where Ollama reported 10.3 GB for the model with 6.3 GB in GPU memory (CHECKS). GPU temperature rose from 50 to 67 degrees Celsius within a minute, and the same configuration varied between 37.5 and 46.8 tokens per second across runs minutes apart (note 10, section 4.1), so speeds are ranges, not constants. Energy was not measured because the GPU power reading on this driver was not usable.

### 5.3 Compaction on a small window (RQ1)

**The defect.** Before 2026-10-12, compaction never ran on local models: the default headroom of 65,536 tokens made the threshold negative for 16K and 32K windows, it was skipped, and replies were cut off (`air/plans/README.md`, context budget section). A reply in a seven-turn session was cut with "Output token limit reached" once; it did not repeat, and its cause is not known (CHECKS).

**After the per-model policies.** On the lean preset, compaction starts at about 9,000 tokens at 16K, replies are capped near 3,000 tokens, and history is pruned and summarized about every three turns when tool results are large; at 32K the threshold is 20,000 tokens and replies keep 4,096 tokens. After the threshold is crossed, a tool result over 8,192 characters is cut to its head and tail in the model's view, while the original stays in the session log (all from `air/README.md`, measured on the lean preset). In check E8, with whole-file reads of about 11,000 tokens each, request prompts fell from 18,200 to 11,607, from 22,649 to 13,905, from 20,567 to 13,599, and from 24,564 to 15,844 tokens (reductions of 36.2, 38.6, 33.9, and 35.5 percent, DERIVED), and "Output token limit reached" never appeared. The third of these (20,567 to 13,599) went through a summary request limited to 2,048 output tokens.

**The ordering failure and the log.** With the stock instruction, the 8B model wrote a summary that named only the most recent file and then answered "f4" to "which file did you read first" when the truth was f1. With the chronological-log section, the summary listed f1 to f4 in the right order, at 367 tokens instead of 205 (compaction-log README, manual replay). In the live check F4 over 11 file-read messages, two summary requests were recorded, the last summary (957 tokens) listed f1.txt to f8.txt in order, the model answered "f1.txt" to the first-file question, and the ordered list of read files was right for all 10 files. The added instruction costs about 330 tokens per summary request and the log about 160 tokens in the measured case, growing by one line per user request or tool call up to the cap (README, estimate).

Limits: both results are single observations of one task type (file reads) on one model; the log is written by the same small model, so entries can be wrong or incomplete, and the cap of 60 entries is an estimate for 32K windows.

### 5.4 Model choice and in-harness reliability (RQ1)

Raw API tool calling at 16K with thinking off, ten cases run twice (eight needing one specific tool with correct arguments, two needing no tool), reported as passes out of 20: `qwen2.5:7b-instruct` 20, `qwen3.5:4b` 20, `qwen3:8b` 20, `gemma4:e4b-it-qat` 19, `qwen3.5:9b` 18, `granite4.2:8b` 18, `granite4.2:3b` 18, `llama3.1:8b` 16. No model wrote a tool call as plain text in 160 runs, so the fake-tool-call guard of the earlier AIR project was not ported.

The same models behaved differently inside the harness (headless profile with the AIR bundle, ten small tasks, two runs each; one task could not be scored because the instruction plugin was inactive in that composition, leaving nine tasks and 18 runs per model; string-match scoring):

| Model | Passed | Mean seconds | Model steps per run | Tokens per run |
|---|---|---|---|---|
| `qwen3-8b-16k` | 17 of 18 | 65 | 2.8 | 25,600 |
| `qwen35-4b-32k` | 15 of 18 (16 on a lenient reading) | 58 | 4 | 39,500 |
| `qwen35-9b-24k` | 15 of 18 | 66 | 2.8 | 25,900 |
| `qwen25-7b-32k` | 12 of 18 | 14 | 2.9 | 25,000 |

`qwen2.5:7b-instruct` was the fastest and most precise at single tool calls and the least reliable on multi-step tasks (it wrote a stray file when no tool was needed and failed the multi-step write task both times), which is why it is not the default despite its speed. The one failure of `qwen3-8b-16k` was a correct answer that the scoring pattern missed. With 18 runs per model, the differences between 17, 15, and 15 passes are within what scoring noise and run variation could produce; only the gap to 12 is large enough to merit attention, and even that is a single comparison. Upstream's `write` tool has optional escalation arguments; models often sent one of them alone and spent an extra step retrying. This is a tool-schema cost specific to small models.

### 5.5 Convention compatibility (RQ2)

Checks were hand-run on 2026-10-09 (Web UI, `qwen3-8b-16k`) and 2026-10-12 (desktop application, Fedora), with a demonstration project:

| Feature | Result | Basis |
|---|---|---|
| `.claude/CLAUDE.md` with an `@notes.md` import | Reached the model (the model named the project from the imported note) | Hand-run, both dates |
| `/issue 42` command from `.claude/commands` | Sent "Summarise issue 42 in one sentence." to the model, confirmed in the Trajectory view | Hand-run, both dates |
| `hello` skill from `.claude/skills` | The `skill` tool was called with name `hello`; the model answered "Hello Sam!" | Hand-run, 2026-10-12 |
| `.mcp.json` server | Listed as not approved with its unexpanded command; started after `/mcp approve demo`; tool call returned `echo: mango` after pinning | Hand-run, 2026-10-12 |
| Plain session without project files | 7.5K-token request (46 percent of the 16K window) answered in 43 s at about 25 tokens per second; the model was not sidetracked by user-level skills | Hand-run, 2026-10-09 |

These checks show that the features work on a prepared project for single runs. They do not show broad compatibility. Several fields are parsed but not enforced: `allowed-tools`, `context: fork`, `agent`, `model`, and `paths` for skills; `allowed-tools` and `model` for commands; `` !`cmd` `` and `@file` expansion in skill and command bodies. Not covered by any check: path-scoped rules, the British-English instruction (the reply that could show it used American spelling), and the remaining Cursor and Kiro rule formats (not implemented). No corpus of real-world `.claude` repositories was used. Automated coverage is larger: plan 01 recorded 298 passing tests (289 in packages at 100 percent coverage, 9 workspace-level), and a Windows leg of continuous integration passed after three tests that had assumed Linux were corrected.

### 5.6 Review before registration (RQ3)

**Automated.** Plan 02 recorded 308 tests in `mcp-trust`, 48 in `mcp-trust-cli`, 72 in `mcp-conventions`, and 141 in upstream's MCP client suite at 100 percent coverage of its source. The 27 drift scenarios of research note 04, section 3.9, are each mapped to an asserting test in the plan's coverage table, including a description-only change, an instructions-only change, an annotation flip, a mid-flight mutation, an invisible character inserted into a description, and equal numbers written as `1.0` and `1`. A cross-language digest vector in a golden file is asserted on the TypeScript side; the Python side belongs to the unexecuted evaluation plan. Because any hashed field change changes the hash by construction, these tests demonstrate correct wiring and correct policy, not detection power against attackers.

**Hand-run (2026-10-12, Linux desktop application).** `/mcp` listed the project server as not approved; `/mcp approve demo` started it; `/mcp-trust status` showed it unpinned; asking the model to use its tool raised the approval prompt; after "Reject" the tool stayed unavailable and `list_mcp_resources` for the declined server was denied; `/mcp-trust diff demo` showed the tool's description, input, and the exact pin command; the pin command pinned one tool; status then showed approved; the tool call returned `echo: mango`.

**What the first live run exposed.** On 2026-10-10 the live walk-through found two gaps, both fixed with tests afterwards: the generic resource tools still worked for a server the user had declined, and `diff` showed only tool names for an unpinned server. Both are gaps that tests written from the design had missed, which is an argument for live runs and a caution that coverage numbers overstate assurance.

**Not run.** No pinned server's tool description was changed in a live run (covered only by tests through the real loader), no drift corpus or false-alert rate was measured, no comparison with a description-only baseline was run, and nothing was run on native Windows. The model is not told why a tool is missing after a decline, a declined change is asked again up to a per-server cap, and audit blobs are not rotated (package README). The headline question of the original plan, whether full-surface pinning detects drift that description-only pinning misses at an acceptable false-alert rate, is therefore open.

### 5.7 Upstream footprint (RQ4)

On the Phase 1 branch, which is built on the upstream base tag `dsh-v0.2.1-alpha.2`, 23 files outside the AIR workspace and the research folder differ from upstream, and they are exactly the files listed in the delta record:

| Group | Files | Reason |
|---|---|---|
| MCP client review hook | 8 (a new service file, three source files, one test file, three README files) | Registration must be reviewable before any registry change |
| Desktop development launcher | 5 | The launcher rejected the Linux target before any build step |
| Chat client compaction row | 3 (two one-line source changes, one test file) | The compaction row was folded into a collapsed tool group |
| Generated catalog and its generator | 3 | An optional service key without a provider must be listed |
| CI workflow, pointer file, ignore file, translation-gate manifest | 4 | Fork infrastructure |

Of these, only the first three groups change behavior. The fork absorbed four upstream syncs between 2026-09-28 and 2026-10-09, which brought in 2,224, 187, 266, and 669 upstream commits respectively. The convention packages built and passed their tests unchanged through the last sync, with two AIR changes needed: bringing the preset in line with the upstream standard preset, and moving the convention packages from a session header directory to the new working-directory service, which was identified from the upstream upgrade guides because the tests still passed. The cost of carrying the MCP client edit is unmeasured; its exposure is the registration loop and the instruction block, which the plan identifies as the most change-prone code.

### 5.8 Windows and the pilot figures (limits of the evidence)

**First native Windows run (2026-10-20).** Install, build, typecheck, lint, the ten package test suites, and the three profile smokes passed; the model variants were created; `desktop:setup` and the desktop launch worked on the second attempt (the first failed with a permission error while preparing the runtime payload, taken to be a file held by another process; not proven); the application showed "AIR Lean", `qwen3-8b-32k`, effort Off and no sign-in wall; and "say hello in one sentence" was answered in 14 seconds including model load, at 17 tokens per second. One test failed on the first full run while another process used the CPU; the test uses a 500 ms server start-up timeout and passed three times in a row afterwards. This shows timing sensitivity of at least one test under load. Not covered on Windows: the Electron window itself (the check used the page it serves), the Web UI fallback, MCP trust, skills, commands, and compaction.

**Pilot figures from the evaluation plans.** In a scratch copy outside the repository's executed work, a five-episode AgentDojo banking pilot on `qwen2.5:7b-instruct` gave, per episode, 6.9 seconds and 3,601 input and 263 output tokens for the native pipeline and 9.6 seconds and 5,174 input and 350 output tokens for the undefended harness (plan 06). An earlier summary of a pilot of the same design reports 5.8 and 9.0 seconds and 5,094 input and 313 output tokens for the harness (note 10, section 9.1). The two runs disagree by about a fifth on the native timing. We report this only to show that five-episode timings are not stable enough to compare arms.

### 5.9 What was not run

Hosted (cloud) models; any repeated trial or confidence interval; any benchmark (AgentDojo, MCPTox, LongMemEval); an MCP drift corpus; a user study; the permission rule store, memory core, and desktop shell plans; an installer, tray, menus, or updater; macOS (out of scope); and the 2026-10-10 benchmark scripts, whose raw data were lost.

## 6. Discussion

**RQ1.** The Phase 1 evidence supports a modest claim: on an 8 GB GPU with an 8B model, the harness's fixed prompt is a first-order design constraint, tool-set selection moves it by about 42 percent in the one same-day comparison (7,686 to 4,426 tokens, DERIVED), and defaults tuned for large windows can disable whole subsystems without any error. The compaction threshold defect is the clearest finding: nothing in the product reported that compaction never ran, and the symptom (cut-off replies) pointed elsewhere. The general lesson, which we state as a hypothesis, not as a result, is that hosted-window assumptions are likely present in other defaults of general-purpose harnesses, and that a harness should assert its context assumptions at start-up (for example, read the loaded context from the runtime and compare it with the declared window, as the notes recommend). The window size interacts with GPU fit in a model-specific way (`qwen3:8b` loses more than half of its speed from 8K to 32K while `qwen2.5:7b-instruct` loses none), so a single recommended context size cannot be derived from window arithmetic.

The comparison between the raw-API and in-harness results also deserves attention. A model that is best at isolated tool calls was worst at multi-step tasks, which suggests that raw tool-call probes are a poor proxy for agent suitability. With two runs per task, this is a pointer for Phase 2 and not a conclusion.

**RQ2.** The convention readers work on a prepared project, and their design choices (budgeted injection, user roots off, contained reads, approval for MCP servers) respond to small-model and security constraints that products built for hosted models do not face. We cannot claim compatibility in general. Parsing a field without enforcing it, as the skill reader does for `allowed-tools`, can mislead a user who believes a restriction holds; the READMEs say so, and the instruction layer's own documentation of advice versus enforcement applies here as well.

**RQ3.** The mechanism is plausible and thoroughly tested, but the evidence for its value is the design argument of note 04, not a measurement. Its contribution is integration (registration-time enforcement, a diffable lockfile of full definitions, sidecar audit under the event constraint). The false-alert question raised by the Snyk issue, namely that a changed package version can leave the listed surface unchanged, is untouched: AIR pins definitions, not launch commands or package versions, and the plan lists launch-command pinning as a follow-up. Server code that changes while its listed surface does not remains outside the guarantee.

**RQ4.** Most of the product is out of tree, and the three in-tree behavioral edits are small, but "small" is measured here only as a count of files. Two points are instructive. The no-custom-events rule forced a sidecar audit design that weakens the harness's own principle that everything model-relevant is reconstructable from the session log. And the one hook the plugin could not do without is exactly where upstream's two-phase tool registration lacks an extension point. A real extension point there, which upstream does not accept contributions to, would remove the carried edit.

## 7. Threats to Validity and Limitations

**Construct validity.** Prompt tokens are a proxy for context pressure, and the 52 to 54 percent figure comes from an early composition that no longer ships. String-match scoring misjudged correct answers in three runs across two models (note 10, section 12.2). A hand-run "works" for a convention feature shows a feature can work, not that it works across the ecosystem's variants. The MCP tests establish wiring by construction, as note 02 observed of the earlier project's 10 of 10 drift result.

**Internal validity.** Nearly every result is a single run or two runs. Local inference speed varied by up to about 20 percent (DERIVED from 37.5 and 46.8 tokens per second) between runs minutes apart, associated with GPU temperature. The authors designed, built, and evaluated the system; the research questions were written after the work; no success criteria were registered in advance. The Ollama runtime moved from 0.32.7 to 0.40.6 between the Linux and Windows checks, and the record does not give model file digests. Raw data for the 2026-10-10 runs are lost, so those tables rest on summaries.

**External validity.** One GPU class, one operating-system pair, one model family for the lean-preset and compaction checks, and ten small tasks for reliability. The results say nothing about hosted models, larger windows, or long multi-file work. The upstream harness is a developer preview that changes quickly, and the conclusions about defaults are tied to the base tag.

**Conclusion validity.** No statistical test or interval is reported. Derived percentages in this paper are arithmetic over reported values and inherit all their uncertainty.

**Audit limitation.** Because audit data lives in sidecar files, a session log alone does not record which MCP surface was trusted when a session ran; the correspondence relies on the session identifier in the sidecar file name and on files that are not covered by the session format's guarantees.

**Security limitations.** Pinning protects tool metadata. It does not stop injection through tool results, does not pin the code a server runs, and does not stop a user from approving a bad server. Project servers cannot be reviewed from the command line, and an approval prompt does not appear in sessions that cannot ask. MCP child processes are not sandboxed by AIR. The convention readers' containment has documented residual risks (hard links, Windows junctions, check-then-read races). Link confinement and POSIX file modes have no Windows evidence because those tests are skipped there.

**Competing explanations.** The effect of the lean preset on reliability was not measured; the preset reduces cost, and the in-harness reliability run predates it. The effect of the chronological log on long sessions is unknown.

## 8. Future Work (Phase 2)

The unexecuted plans give the work needed to turn this report into an evaluation. No plan is to be started until the project owner says so.

| Plan | Content | What it would add to this paper |
|---|---|---|
| 05 Evaluation pilot | An evaluation project, a five-server RQ1 drift mini-corpus with false-alert counts for description-only and full-surface pins, a per-episode token and latency table from session logs, and a ten-question LongMemEval smoke | The first measured answer to RQ3's open question and a reproducible token table for RQ1 |
| 06 AgentDojo pilot | Native pipeline versus the undefended harness on the banking suite, an MCP bridge, and an approval answerer; follow-up arms for pinning and permission rules and a local-versus-hosted route study | A baseline for injection experiments with a floor-effect caveat for small models |
| 03 Permissions | A `Tool(pattern)` rule store, capability scopes, an approval answerer with audit, and a sudo guard, amended to keep upstream's permission presets as the default | Policies that act on top of pinning, with a per-server trust level to avoid asking twice |
| 04 Memory core | A Markdown store with an index, four memory tools, a pinned core | Memory-poisoning and recall experiments, with a trust gate on writes |
| 07 Desktop shell | Superseded; to be rewritten around upstream's desktop app for installer, packaging, updates, and first-run setup | An installable product; first-run setup that creates the model variant and checks the loaded context |

Cross-cutting items from the roadmap that bear directly on this paper: replace the compaction table with settings derived from each model's window; make the trimming of large tool results visible; tell the model why an MCP tool is missing; and, from the parked candidates, a first-run check of Ollama and the loaded context size, a privacy ledger of requests that left the machine, and a latency and token dashboard. Hybrid local and cloud operation (research note 12) is a separate research question: its proposed experiment, always-local and always-cloud arms on a 286-episode AgentDojo subset with routers computed offline, depends on plans 05 and 06 and a hosted key.

## 9. Conclusion

Phase 1 produced a working local-first agent as out-of-tree plugins, with a small, honest evidence base. The most solid finding is about context: a general-purpose harness spends a large fraction of a small local window before the user types, harness defaults built for large windows silently disabled compaction, and a lean tool set and per-model policies reduced the problem on one model and one laptop. The review-before-registration design is complete, well tested, and not yet measured against alternatives. Convention compatibility is shown by example, not by corpus. Making any of these claims reportable requires repeated runs, baselines, and the Phase 2 evaluation plans. We have tried to state which of the numbers above could be reproduced from the repository today (the tests and checks that are scripted) and which could not (the 2026-10-10 raw data).

## References

Sources are listed as they appear in the project's research notes; identifiers are kept from those notes. Items not independently re-fetched for this paper are marked.

1. Research notes 01 to 14 and `research/research.md`, this repository (section numbers cited inline).
2. Upstream harness release `dsh-v0.2.1-alpha.2` (the base tag of this work) and its documentation as cited in the notes.
3. AgentDojo. arXiv 2406.13352 (cited via research notes 07 and 10).
4. MCPTox. arXiv 2508.14925 (notes 04, 07, 10).
5. "The Attacker Moves Second." arXiv 2510.09023 (notes 04, 07).
6. CaMeL. arXiv 2503.18813 (notes 04, 07).
7. ETDI. arXiv 2506.01333 (note 04).
8. Agent Skills security study of 31,132 marketplace skills. arXiv 2601.10338 (note 03).
9. "Bad Memory." arXiv 2607.14611 (notes 05, 07).
10. LongMemEval. arXiv 2410.10813 (note 07).
11. Invariant Labs. MCP security notification: tool poisoning attacks (April 2025), https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks (note 04).
12. Trail of Bits. mcp-context-protector, https://github.com/trailofbits/mcp-context-protector (note 04).
13. Pipelock, https://github.com/luckypipewrench/pipelock (note 04).
14. Snyk agent-scan issue 482 on tool pinning and release transitions (third-party report quoted in notes 04 and 07; not re-fetched).
15. OWASP MCP Security Cheat Sheet (note 04).
16. Vercel. "AGENTS.md outperforms skills in our agent evals," 2026-01-27, https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals (note 03).
17. Agent Skills specification, https://agentskills.io/specification; AGENTS.md, https://agents.md; Agent Plugins, https://agent-plugins.org/ (note 03).
18. Anthropic. Claude Code documentation (memory, skills, hooks, plugins, sandboxing), https://code.claude.com/docs/en/memory and related pages (note 03).
19. RFC 8785, JSON Canonicalization Scheme (cited in note 04).
20. Ollama documentation, context length, https://docs.ollama.com/context-length (note 10).
21. Model Context Protocol specification, revisions 2025-11-25 and 2026-07-28 (note 04).
22. Letta context repositories, MemOS, and the Anthropic memory tool, as described in research note 05.
23. FrugalGPT (arXiv 2305.05176), AutoMix (arXiv 2310.12963), Hybrid LLM (arXiv 2404.14618), RouteLLM (arXiv 2406.18665), cited in note 12 for future hybrid routing work; figures not reproduced here.
24. Prior work on compaction and summarization of agent histories, context-length effects on small-model accuracy, and tool-use accuracy of 4B to 9B models: [CITATION NEEDED].

## Appendix A. Rejected framings

- **MCP tool pinning as the headline.** Rejected. At least seven systems already pin or fingerprint tool definitions (note 04), the project's own pinning tests are correct by construction, and the planned drift corpus and baseline comparison (plan 05) have not been run. It remains a design component (Section 3.5), and becomes a headline only after the RQ1 corpus exists.
- **Deterministic policy against prompt injection (permissions, taint, AgentDojo).** Rejected. Plans 03 and 06 are unexecuted, and the notes themselves caution that detection-style results overstate robustness and that small models show a floor effect.
- **Memory with a trust gate.** Rejected. Plan 04 is unexecuted and no memory code exists.
- **Cross-agent convention compatibility alone.** Rejected as the sole framing. The checks are single runs on one demonstration project, no corpus of real repositories was used, and several fields are parsed but not enforced. It is kept as RQ2 with an explicit evidence limit.
- **Out-of-tree extension without forking event types alone.** Rejected as the sole framing. It is one project's experience (23 files, three behavioral edits), and the "no custom events" rule is a property of one upstream version. It is kept as RQ4 and as a design constraint explanation.
- **Hybrid local and cloud routing.** Rejected. It is a research design (note 12) with no code and no measurement.
- **A benchmark of local models on the rig.** Rejected as a paper. The 2026-10-10 raw data were lost, the in-harness task set has ten small tasks run twice, and scoring was by string match. The measurements are used as supporting evidence for RQ1.
- **Chosen framing.** Context budgeting for small local models in a general-purpose harness, with the trust and convention work as the constraints and mechanisms that follow from it, because this is where the repository holds measured numbers, a concrete defect, and a mitigation checked live, albeit with small samples.
