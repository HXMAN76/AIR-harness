# 07 — Product and Final-Year-Project Strategy

Research date: 2026-09-28. All figures below are attributed to the page that reported them and are dated where the page gave a date. Where this note needs a number that no source provides (for example, a per-episode token count used in a cost estimate), the number is labelled as a planning assumption and must be replaced by a measured value from a pilot run.

## 1. Summary of findings

1. **The project needs one defensible research contribution, not a feature list.** Marking schemes reward research questions, analysis, and original thought (section 2.1). Nine shallowly evaluated features score worse than a working product whose security and memory claims are measured rigorously.
2. **MCP tool pinning is not novel as an idea; the narrowness of existing implementations is the gap.** Invariant Labs' MCP-Scan (now Snyk Agent Scan) already ships "Tool Pinning" to detect rug pulls (https://invariantlabs.ai/blog/introducing-mcp-scan; https://appsecsanta.com/mcp-scan). A GitHub issue opened on 2026-09-20 reports that the pin is `md5(entity.description)` only, leaving input schema, command, arguments, and resolved package version outside it. The same issue reports that on 74.6% of 59,821 release transitions across 7,949 multi-version registry servers the invocation surface stayed identical while the resolved package version changed, and that a narrower "capability expansion" trigger cut false alerts to about 13.0% on 90 cases with 57.1% precision (https://github.com/snyk/agent-scan/issues/482). AIR's full-schema SHA-256 design is therefore positioned against a current, cited weakness, and its evaluation must measure false alerts on benign upgrades as well as detection.
3. **The rug-pull threat is documented.** Invariant Labs published proofs of concept in April 2025 (https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks); the Cloud Security Alliance cites CVE-2025-54136 (CVSS 8.8, July 2025) as approval that did not survive a server-side change (https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/); MCPTox (AAAI) built 1,312 poisoning cases on 45 live servers and reports o1-mini at 72.8% attack success (https://arxiv.org/abs/2508.14925).
4. **Detection-based injection defenses fail against adaptive attackers; architectural controls fare better.** "The Attacker Moves Second" (USENIX Security 2026) bypassed 12 defenses with attack success above 90% for most (https://arxiv.org/abs/2510.09023). Meta's Agents Rule of Two (2025-10-31) says a session should combine at most two of untrusted input, sensitive data access, and external state change (https://ai.meta.com/blog/practical-ai-agent-security/). Enforcing such policies as plugins is measurable and defensible.
5. **Persistent memory is an attack surface.** "Bad Memory" (arXiv, 2026-07-16) shows payloads planted in memory files attack current and future sessions of Claude and OpenAI agent systems (https://arxiv.org/abs/2607.14611). Measure recall and poisoning resistance together.
6. **The core benchmarks fit a student budget** with subsets and a cheap API model (section 4.2); OSWorld and full SWE-bench do not.
7. **Open-source adoption follows governance, onboarding, and trust** as much as features; licence and telemetry changes have caused backlash (section 7).
8. **The fork must not use the "DeepSeek Harness" name.** The repository's `BRAND_GUIDELINES.md` calls it a registered trademark of DeepSeek, permits "built on DeepSeek Harness", and recommends "DSH" for ecosystem naming. The MIT `LICENSE` notice "Copyright (c) 2026 DeepSeek" must be retained.

## 2. What makes a strong final-year project and paper

### 2.1 Assessment expectations

UK-style marking criteria consistently reward: a problem statement grounded in literature; explicit objectives or research questions; justified choice of method; rigorous analysis with quantitative and qualitative evidence; critical reflection on limitations; and presentation quality (Sussex: https://www.sussex.ac.uk/ei/internal/forstudents/informatics/undergraduate/finalyearprojects/reportmarkingcriteria; UCC: http://www.cs.ucc.ie/~jdoherty/files/FYPGradingGuidelines.pdf). The student should obtain their own department's rubric and map every chapter to it; the structure below assumes a typical rubric.

For a paper beyond the dissertation, reviewers in systems and security venues check four things:

- **Novelty relative to named prior work.** Here that means MCP-Scan tool pinning, MCPTox, MCPSecBench (https://arxiv.org/abs/2508.13220), MCPGuard (https://arxiv.org/abs/2510.23673), CaMeL, and the Rule of Two. The related-work chapter must say what each does and precisely what AIR-harness adds.
- **Rigorous evaluation.** Baselines, ablations, repeated runs, confidence intervals, and honest negative results.
- **Reproducibility.** ACM's badging scheme distinguishes Artifacts Available, Artifacts Evaluated (Functional, Reusable), Results Reproduced, and Results Replicated (https://www.acm.org/publications/policies/artifact-review-and-badging-current). Aim for "Available" plus "Functional": a tagged release archived with a DOI, a container or lockfile, and one script per research question that regenerates each table.
- **Threats to validity.** Use Wohlin et al.'s four categories (construct, internal, external, conclusion) as the standard frame in empirical software engineering (overview: https://www.researchgate.net/publication/279355975_Experimentation_in_Software_Engineering).

### 2.2 Scoping a large system so the contribution is defensible

The dissertation must separate three layers:

1. **Platform (inherited, credited).** Cordis plugin runtime, sessions, sandbox, MCP client, desktop and web clients: upstream work, described in one background chapter and credited.
2. **Engineering contributions (built by the student, described but not the research claim).** Desktop polish, voice, OS control, routines, Markdown skills and agents.
3. **Research contributions (built and evaluated).** At most two or three mechanisms with research questions: full-surface MCP manifest pinning with drift policy; a policy layer that enforces Rule-of-Two-style constraints and secret handoff; hybrid, source-tagged long-term memory.

A useful test: every sentence in the abstract that makes a claim must point to a table in the evaluation chapter.

### 2.3 Well-received agent-system papers from 2024–2026 to use as templates

- **OpenHands** (ICLR 2025): platform paper with evaluation over 13 benchmarks including SWE-bench and WebArena (https://arxiv.org/abs/2407.16741); template for "system plus broad evaluation".
- **AgentDojo** (NeurIPS 2024): 97 user tasks and 629 security cases across banking, Slack, travel, and workspace, measuring utility, utility under attack, and attack success (https://arxiv.org/abs/2406.13352); template for joint security-utility measurement.
- **CaMeL** (SaTML 2026): design-level defense solving 77% of AgentDojo tasks with provable security versus 84% undefended (https://arxiv.org/abs/2503.18813); template for "architecture, not detection".
- **MCP-Universe** (2025): 231 tasks over 11 real MCP servers with execution-based evaluators; GPT-5 reached 43.72% (https://arxiv.org/abs/2508.14704).
- **MCPTox** (AAAI) and **LongMemEval** (ICLR 2025; 500 questions over five memory abilities, https://arxiv.org/abs/2410.10813).

## 3. Proposed research questions

The six questions below extend AIR's RQ1–RQ5. Each has a primary metric, a baseline, and a success criterion stated before running the experiment, so that a negative result is still reportable.

| RQ | Question | Primary metrics | Baselines | Data / benchmark |
|---|---|---|---|---|
| RQ1 | Does full-surface manifest pinning (description, `inputSchema`, `outputSchema`, annotations, tool set membership, server identity, and resolved package digest) detect MCP tool drift more completely than description-only pinning, at an acceptable false-alert rate? | Detection rate per drift class; false-alert rate on benign upgrades; time to detection (tool calls before block) | (a) No pinning (upstream harness); (b) description-only hash, reimplemented to match MCP-Scan's documented behaviour; (c) full-surface pin; (d) full-surface pin plus capability-expansion classifier | Synthetic drift corpus (at least 8 drift classes × multiple servers); MCPTox poisoned descriptions; real version histories from the official MCP registry for false-alert rate |
| RQ2 | Do harness-level policies (pinning, Rule-of-Two session policy, approval gating, secret handoff) reduce attack success on indirect-injection benchmarks without large utility loss? | AgentDojo benign utility, utility under attack, targeted attack success rate; canary-secret leakage count in model-visible context and session log | Upstream harness with default approvals; harness with each policy ablated | AgentDojo (all four suites); InjecAgent subset (https://arxiv.org/abs/2403.02691); MCPTox subset |
| RQ3 | Does hybrid memory (lexical + dense + time-aware retrieval, source tags) improve long-term recall over vector-only and full-context baselines, and does origin record tagging reduce memory-poisoning success? | LongMemEval accuracy overall and per ability (information extraction, multi-session, temporal, knowledge update, abstention); retrieval recall@k; tokens per query; poisoning success rate | Vector-only; BM25-only; full-context (long-context model with whole history); hybrid without source tags | LongMemEval_S (about 115k tokens and about 40 sessions per history); LoCoMo as a secondary set; memory-poisoning scenarios modelled on "Bad Memory" |
| RQ4 | How does task success on real MCP workloads change between a cheap API model and a local open-weight model inside the same harness, and at what cost and latency? | Task success rate; pass^k consistency over repeated runs; dollars and wall-clock per task | Same harness, different model provider plugins | MCP-Universe subset or MCP-Bench subset (https://github.com/Accenture/mcp-bench) |
| RQ5 | Can the new capabilities be added purely as plugins, and what runtime overhead do they impose? | Lines changed in core packages (target: zero outside documented extension points); p50/p95 added latency per tool call; memory footprint | Upstream harness without the new plugins | Micro-benchmarks using the repository's existing `benchmarks/` setup; `git diff --stat` against the upstream tag |
| RQ6 | Is the assistant usable and does the security UX avoid approval fatigue? | Task completion rate and time; System Usability Scale; Raw NASA-TLX; approvals per task and share of approvals granted in under 2 seconds | Participants' current assistant (for example Claude Desktop or ChatGPT desktop) on matched tasks, or a within-subjects comparison of policy on/off | Lab study, 12–20 participants, 6–8 scripted personal-assistant tasks |

Notes on the table:

- **RQ1 is the headline.** It strengthens AIR's "100% detection on 10 scenarios": any hash of a changed field detects that change by construction, so the informative results are which drift classes description-only pinning misses and how many benign upgrades each scheme flags.
- **RQ2 policy and secrets.** The policy plugin labels each tool with the three Rule-of-Two properties and refuses or escalates sessions combining all three. For secret handoff, plant a canary key and search the session log and model requests for it; the target is zero occurrences.
- **SUS interpretation.** A SUS score of 68 corresponds to the 50th percentile in Sauro and Lewis's benchmark database (https://measuringu.com/sus/). With 12–20 participants, report SUS with a confidence interval and treat it as directional.
- **Raw TLX.** Unweighted Raw TLX over the six subscales is common practice and has been used in 522 CHI papers between 2006 and 2024, according to a 2026 arXiv paper (https://arxiv.org/abs/2609.12273; NASA reference: https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/).

## 4. Evaluation plan

### 4.1 Benchmark selection

| Benchmark | Why it fits | Recommended scope | Feasibility |
|---|---|---|---|
| AgentDojo | Joint security and utility; Python, extensible; used by CaMeL and many defense papers | All 97 user tasks and 629 injection cases, 3 repeats, per configuration | High. Needs an adapter that routes AgentDojo tool calls through the harness's tool registry and policy plugins |
| InjecAgent | 1,054 cases, 17 user tools, 62 attacker tools; cheap single-turn style | Stratified subset (for example 200 cases) as a second injection set | High |
| MCPTox | Tool-poisoning on real servers; directly relevant to RQ1 and RQ2 | Poisoned tool descriptions as RQ1 drift inputs; a subset for RQ2 | Medium. Live servers may change; snapshot them |
| MCP-Universe | Real MCP servers, execution-based evaluators | Domains that need no paid third-party keys (check the repository before choosing) | Medium. Some domains need external accounts; dynamic ground truth adds variance |
| MCP-Bench | 28 live servers, 250 tools, multi-step tasks | Subset as an alternative to MCP-Universe | Medium |
| LiveMCPBench, MCPToolBench++, tau2-bench | 95 tasks over many servers (https://icip-cas.github.io/LiveMCPBench/); 1.5K QA pairs over 6 domains (https://arxiv.org/abs/2508.07575); dual-control user simulation (https://github.com/sierra-research/tau2-bench) | Optional; tau2 only if a conversational claim is made | Optional |
| LongMemEval | 500 questions, five abilities; S, M, and Oracle variants; official scorer uses GPT-4o as judge (https://github.com/xiaowu0162/LongMemEval) | LongMemEval_S all 500; Oracle as upper bound | High for retrieval variants; the full-context baseline is the most expensive run |
| LoCoMo | Long multi-session dialogues; widely used but protocol-sensitive (LLM-judge versus F1 results are not comparable) (https://mem0.ai/blog/ai-memory-benchmarks-in-2026) | Secondary memory check only | Medium |
| OSWorld / OSWorld-Verified | 369 real desktop tasks; human baseline 72.36% in the original paper (https://os-world.github.io/); a secondary source reports frontier agents above 85% by July 2026 (https://benchmarkingagents.com/osworld/) | Out of scope for core evaluation; at most a handful of hand-picked tasks to demo OS control | Low. VM images and parallel infrastructure (https://xlang.ai/blog/osworld-verified) |
| SWE-bench Verified / Lite | 500 / 300 issues; harness needs roughly 120 GB or more of disk (https://www.swebench.com/SWE-bench/guides/docker_setup/) | Out of scope; the project is a personal agent, not a coding benchmark competitor | Low for a laptop; Epoch reports a 62-minute run on a 32-core, 128 GB machine (https://epoch.ai/latest/swebench-docker) |
| BFCL v4 | Function-calling accuracy; useful to choose local models (https://gorilla.cs.berkeley.edu/leaderboard.html) | Read published scores; do not re-run | Leaderboard only |

### 4.2 Hardware and cost estimate

Hardware: a development laptop covers AgentDojo, InjecAgent, RQ1, RQ5, and LongMemEval retrieval variants with API models. For RQ4, a single consumer GPU with about 12 GB of VRAM can serve a quantised 7–14B model through llama.cpp or Ollama; secondary guides report 1–2 s end-to-end local voice latency on an RTX 3060 with an 8B model and Whisper small (https://www.bigiron.cc/guides/self-hosted-voice-assistant-pipeline-stt-vad-llm-tts-wake-word). Treat such figures as indicative and measure on the actual hardware; a university GPU node removes the constraint.

API cost formula per configuration:

`cost = episodes × repeats × (input_tokens × input_price + output_tokens × output_price)`

Illustrative AgentDojo estimate using official off-peak `deepseek-flash` prices. The token counts are **planning assumptions**, not measured values:

- Episodes: 97 benign + 629 injection = 726.
- Assumption: 30,000 input tokens and 2,000 output tokens per episode, with no cache hits.
- Input: 726 × 30,000 = 21.78M tokens × $0.15/M ≈ $3.27. Output: 726 × 2,000 = 1.45M tokens × $0.60/M ≈ $0.87. Total ≈ $4.14 per configuration per repeat.
- With 4 configurations × 3 repeats ≈ $50 before cache discounts. Repeated system prompts and tool schemas should hit the cache ($0.003/M), so the real figure is likely lower. Running at peak hours doubles it.

LongMemEval full-context baseline: 500 questions × about 115k history tokens ≈ 57.5M input tokens ≈ $8.6 off-peak per run at cache-miss prices, plus judge costs. Retrieval variants send only retrieved chunks and cost a small fraction of that.

Action: run a 20-episode pilot per benchmark, take real token counts from the session log, recompute, and budget 2× for reruns. The official LongMemEval judge is GPT-4o; a cheaper judge breaks comparability with published numbers, so either use the official judge on the final run or report agreement between judges on a subset.

### 4.3 Experimental protocol

- **Pin everything.** Model and provider, temperature, harness and benchmark commits, MCP server versions (snapshot into containers where licences allow), seeds.
- **Repeats and statistics.** At least 3 repeats per configuration; report means with 95% confidence intervals (Wilson intervals for proportions, bootstrap for continuous metrics). For paired binary outcomes on the same tasks (defense on versus off), use McNemar's test. Report pass^k where consistency matters, following the tau-bench convention (https://github.com/sierra-research/tau2-bench).
- **Ablations.** For RQ2, switch each policy plugin on alone and all together. For RQ3, remove each retrieval component and the source tags.
- **Adaptive attacker section.** Given "The Attacker Moves Second", include at least a small manual red-team exercise against the student's own defenses (for example, attacks written after reading the policy code) and report the result honestly. State that pinning defends integrity of tool metadata, not the semantics of tool outputs.
- **Recorded sessions.** Reuse the repository's keyless recorded-session replay (`pnpm run test:snapshot`) so examiners can replay key trajectories without an API key.

### 4.4 Threats to validity

- **Construct validity.** Synthetic drift may not resemble real malicious changes; mitigate with MCPTox payloads and real registry version histories. SUS measures perceived usability, not correctness. LLM-as-judge scoring can mis-score answers; report judge agreement on a hand-labelled sample.
- **Internal validity.** Model non-determinism, provider-side model updates during the study, rate-limit retries, and cache effects; mitigate with repeats, pinned model names, and logging of provider response metadata. The student is both designer and evaluator; pre-register metrics and success criteria in the repository before final runs.
- **External validity.** AgentDojo's four suites and a few MCP domains do not cover all personal-assistant use; the participant pool (likely students) is not representative of general users; results on one cheap model and one local model may not transfer to frontier models.
- **Conclusion validity.** Small n in the user study; multiple comparisons across many metrics (apply a correction or designate primary metrics in advance); benchmark contamination for public datasets.
- **Adapter fidelity.** Wrapping AgentDojo tools as harness tools may change prompts; compare undefended utility against AgentDojo's published baselines for the same model.

### 4.5 Ethics

A user study needs departmental ethics approval before recruitment; apply in the first month. Use synthetic personal data (fake inbox, calendar, files) rather than participants' own accounts, and never store participants' credentials.

## 5. Academic-year roadmap

Dates assume a dissertation deadline in late April or May 2027 and a viva in May or June 2027; shift to match the university calendar.

| Month | Research milestone | Product milestone | Deliverable |
|---|---|---|---|
| Oct 2026 | Lock RQ1–RQ6 and success criteria; related-work survey (section 2.3 list); ethics application | Fork hygiene: rename, attribution, `NOTICE`, brand check; CI green; one-command install from the fork | Project proposal |
| Nov 2026 | Build the drift corpus (synthetic classes, MCPTox descriptions, registry version histories); reimplement the description-only baseline | Manifest pinning plugin as an MCP client extension with a drift diff UI in desktop and web clients | Interim report or literature review |
| Dec 2026 | RQ1 experiments and first results | Signed plugin bundles (Sigstore or minisign) and verification on install; secret handoff plugin using the OS keychain | RQ1 results table |
| Jan 2027 | RQ3: LongMemEval harness, hybrid memory, ablations; memory-poisoning scenarios | Memory plugin with source tags and a user-visible memory editor | RQ3 results table |
| Feb 2027 | RQ2: AgentDojo adapter, InjecAgent and MCPTox subsets, policy ablations, small red-team exercise | Rule-of-Two policy plugin; approval UX. **MVP feature freeze at the end of February** | RQ2 results table |
| Mar 2027 | RQ6 user study (12–20 participants); RQ4 MCP-Universe or MCP-Bench subset with API and local models; RQ5 overhead measurements | Bug fixing from the study; documentation site; public beta | Study data and analysis |
| Apr 2027 | Write evaluation, discussion, threats to validity; artifact packaging with DOI | Public v0.1 launch (section 8 checklist) | Dissertation submission |
| May 2027 | Viva preparation; optional workshop paper submission | Launch follow-up: triage, first external contributions | Viva demo and slides |

**MVP cut line (must exist by the end of February 2027):**

- Full-surface MCP manifest pinning with drift policy and diff UI.
- Rule-of-Two session policy and approval gating.
- Secret handoff that keeps secrets out of model-visible context and the session log.
- Hybrid long-term memory with source tags and an editor.
- Markdown-defined skills and agents (the upstream harness already has skill loading; this is mostly packaging and documentation).
- Desktop client that installs with one command and runs the above against DeepSeek and one local model.
- Evaluation scripts that regenerate every RQ1–RQ5 table.

**Stretch goals (only after the MVP, each demoted without penalty if time runs out):** local voice loop (wake word, VAD, STT, TTS); desktop context capture; OS control through the existing experimental computer-use packages; proactive triggers and routines built on the schedule, jobs, and webhook packages; a small OSWorld demo subset; a ProAgentBench-style proactive evaluation (https://arxiv.org/abs/2602.04482).

The stretch features are where scope creep is most likely: each adds a large attack surface (always-on microphone, screen capture, input injection) that the security story must then cover. If any of them ships, it must pass through the same policy and approval layer and be listed in the threat model.

### 5.1 Viva demo script (about 10 minutes, with a recorded fallback)

1. **Install (30 s).** Run the one-command install on a clean user account; the desktop client opens.
2. **Connect and pin (1 min).** Add a small demonstration MCP server. The client shows the pinned manifest digest per tool.
3. **Rug pull (2 min).** Flip the server to a version that changes only the `inputSchema` (adds an `exfil_url` parameter) while keeping the description identical. Show that a description-only pin would pass it; the harness blocks the tool, shows a field-level diff, and asks the user to re-approve.
4. **Indirect injection (2 min).** Ask the assistant to summarise a synthetic inbox containing an injected instruction to email a file externally. The Rule-of-Two policy refuses the combination of untrusted input, sensitive file, and outbound email; show the session log entry explaining the refusal.
5. **Secret handoff (1 min).** A tool needs an API key; the user enters it into the OS keychain prompt. Run a search over the session log and captured model requests for the key: zero hits.
6. **Memory (1.5 min).** In a new session, ask a question that depends on a fact from a week-old session; show the retrieved memory with its source session and tool call. Show that a memory item written from an untrusted web page is tagged and not treated as an instruction.
7. **Evidence (1.5 min).** Open the evaluation dashboard; run one regeneration script live on a small subset; point to the full tables in the dissertation.
8. **Close (30 s).** Show the plugin diff against upstream: new capabilities as plugins, no core-loop changes.

Record a video of the full script in the week before the viva, and keep recorded sessions for offline replay in case of network or API failure.

## 6. Competitive positioning

### 6.1 Landscape as of 2026-09-28

- **Claude Desktop.** Anthropic launched Cowork on 2026-01-12 as an agent that works in user-selected folders with a sandboxed shell; the Windows version followed on 2026-02-10; a secondary source reports the app reorganised around Chat, Cowork, and Code modes (https://venturebeat.com/technology/anthropic-launches-cowork-a-claude-desktop-agent-that-works-in-your-files-no; https://pasqualepillitteri.it/en/news/260/claude-desktop-windows-cowork-guide). Local MCP servers install as MCP Bundles (`.mcpb`), zip archives with a `manifest.json` (https://github.com/modelcontextprotocol/mcpb). Strengths: frontier model, polish, distribution. Limits for this project's audience: closed source, single model vendor, cloud account required.
- **Claude Code, Cursor, ChatGPT desktop.** Closed, vendor-hosted, strong UX; not verifiable by the user. Claude Code sets the bar for developer-agent UX.
- **Qoder.** Alibaba's agentic coding platform with Agent and Quest modes, Repo Wiki, and long-term memory; Qoder 1.0 is described as moving "from AI IDE to Autonomous Development Desktop" (https://www.alibabacloud.com/blog/introducing-qoder-1-0-from-ai-ide-to-autonomous-development-desktop_603260). Closed source and coding-focused.
- **goose.** Open-source, local-first, MCP-based agent now governed by the Agentic AI Foundation under the Linux Foundation, alongside MCP and AGENTS.md (https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation; https://goose-docs.ai/blog/2026/04/07/goose-moves-to-aaif/). The closest open competitor and the most credible governance model.
- **Open Interpreter.** Now a coding agent for open models with a desktop app driving local apps and files via Ollama, LM Studio, or OpenAI-compatible endpoints (https://www.openinterpreter.com/); its 01 voice project warned it lacked basic safeguards (https://github.com/openinterpreter/01).
- **OpenCode, Cline, Continue, OpenHands.** Open-source coding agents with large communities. Secondary sources report OpenCode above 160k GitHub stars in 2026 (https://www.developersdigest.tech/blog/opencode-developer-guide-2026); star counts vary by source and date, so do not quote them as facts.

### 6.2 Where an open, local-first, security-verifiable personal agent can win

1. **Verifiable supply-chain integrity for tools.** Full-surface pinning, signed bundles, and a published threat model. `.mcpb` bundles, as described by third-party documentation, do not require code signing (https://mcpfind.org/blog/installing-mcp-desktop-extensions-mcpb); verify this against the MCPB specification before claiming it. Signed bundles verified on install are a concrete differentiator.
2. **User-owned memory.** Memory stored locally in inspectable form, editable, exportable, and source-tagged. This answers both privacy concerns and the "Bad Memory" attack class.
3. **Model choice and cost.** The harness supports provider plugins, so users can run a cheap API model or a local model; RQ4 turns this into measured trade-offs rather than a slogan.
4. **Auditability.** The upstream "model-visible input must be reconstructable from the session log" rule means every decision can be audited after the fact. That is a property closed assistants cannot offer to users.
5. **Extensibility without forks.** Everything-is-a-plugin lets third parties add capabilities without patching the core; RQ5 measures this.

### 6.3 Pitfalls

- **Scope creep.** Breadth against Claude Desktop is not winnable by one student in a year; compete on trust and let breadth come from MCP servers and community plugins.
- **Upstream maintenance burden.** The upstream harness is a developer preview that warns of compatibility-breaking changes (https://github.com/deepseek-ai/deepseek-harness). Keep new work in separate plugin packages, avoid core edits, merge upstream on a fixed cadence, and contribute generic fixes upstream.
- **Local model quality.** Multi-turn tool use degrades relative to single-turn calls for every model, according to a secondary analysis of BFCL v4 (https://www.spheron.network/blog/tool-calling-benchmarks-bfcl-tau-bench-latency-optimization/). Market "local" as a supported option with measured limits, not as parity with frontier models.
- **Security overclaiming.** Pinning protects tool metadata integrity; it does not stop injection through tool outputs, and no current defense is complete against adaptive attacks. The upstream `SAFETY.md` already states the software is unaudited; keep that language.
- **Approval fatigue.** Too many prompts train users to approve everything; RQ6 measures it, and the policy layer should minimise prompts for low-risk combinations.

## 7. Lessons from successful open-source projects

- **Governance and trust.** Home Assistant moved code and brand into the non-profit Open Home Foundation in April 2024, funded by commercial partner Nabu Casa, and reports more than 21,000 contributors in 2024 (https://github.blog/open-source/maintainers/the-local-first-rebellion-how-home-assistant-became-the-most-important-project-in-your-house/). goose's move to the AAIF follows the same pattern. The student-scale version is a written `GOVERNANCE.md` and a promise of licence stability.
- **Licence stability.** Open WebUI moved to BSD-3-Clause in January 2025, then in April 2025 (v0.6.6) added a branding-protection clause, producing its own "Open WebUI License"; this drew significant criticism, including discussion on Hacker News (https://docs.openwebui.com/license/; https://news.ycombinator.com/item?id=43901575). Choose a licence once and keep it.
- **Telemetry ethics.** Audacity's 2021 plan for opt-in telemetry after an acquisition triggered a user revolt and was dropped (https://hackaday.com/2021/05/17/telemetry-debate-rocks-audacity-community-in-open-source-dustup/). Russ Cox's "transparent telemetry" proposal for Go shows a design that publishes exactly what is collected (https://research.swtch.com/telemetry-intro). For a local-first privacy product, ship with no telemetry, or strictly opt-in, documented, and aggregate-only.
- **Onboarding.** Research on "good first issue" labels finds they resolve at markedly higher rates than regular issues and that timely feedback on a first contribution improves retention (https://arxiv.org/html/2604.27532v2; https://arxiv.org/abs/2407.04159). Maintain a small set of labelled, well-specified starter issues and respond to first pull requests quickly.
- **One-command start.** The upstream harness already starts with `npx @deepseek-ai/dsh web` (https://deepseek.com/harness/en/). The fork should keep a single command to a working UI with an obvious model-key step.
- **Evaluation as credibility.** OpenHands built credibility with reproducible benchmark results; a public security scorecard (AgentDojo, MCPTox subset, drift corpus) can do the same here.
- **Licensing choice: MIT versus Apache-2.0.** Apache-2.0 adds an explicit contributor patent grant and a patent-retaliation clause that MIT lacks (https://opensource.org/blog/patents-and-open-source-understanding-the-risks-and-available-solutions-2). Upstream code is MIT and its notice must be kept whatever licence is chosen. The simplest, lowest-friction option is to keep the whole repository MIT, which keeps upstream merges trivial. If patent protection matters for new code, license new plugin packages under Apache-2.0 and document the per-package licences clearly; do not relicense upstream files.

## 8. Open-source launch checklist

Legal and attribution:

- [ ] Keep upstream `LICENSE` text and "Copyright (c) 2026 DeepSeek"; add a line for the fork's own copyright.
- [ ] Keep and extend `THIRD_PARTY_NOTICES.md`; add a `NOTICE` or README section: "Built on DeepSeek Harness (https://github.com/deepseek-ai/deepseek-harness), MIT licence."
- [ ] Remove DeepSeek logos and brand assets from the fork's UI, website, and packaging, per `BRAND_GUIDELINES.md`.
- [ ] Rename npm packages away from the `@deepseek-ai/` scope and the `dsh` binary if it could imply official status; the brand guidelines permit "DSH" in names, so a name such as `<name>-dsh` is acceptable.
- [ ] Run a trademark search for the chosen name (USPTO, EUIPO, WIPO Global Brand Database, and the local national office) and check npm, PyPI, GitHub, and domain availability.
- [ ] Add a Developer Certificate of Origin (DCO) sign-off requirement or a lightweight CLA decision, documented in `CONTRIBUTING.md`.

Security and trust:

- [ ] `SECURITY.md` with a private disclosure channel (GitHub private vulnerability reporting) and response times.
- [ ] Extend upstream `SAFETY.md` with the fork's new capabilities and their risks.
- [ ] Publish `docs/threat-model.md` (assets, actors, trust boundaries, attacks in and out of scope, residual risks), referencing the MCP security best practices page (https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).
- [ ] Signed releases (Sigstore/cosign) and an SBOM; OpenSSF Scorecard in CI (https://scorecard.dev/); apply for the OpenSSF Best Practices badge (https://openssf.org/best-practices-badge/).
- [ ] Branch protection, required reviews, secret scanning, and dependency updates.

Product and documentation:

- [ ] README: pitch, 60-second quickstart, GIF, supported models, security summary, limitations.
- [ ] Documentation site (the repository's `website/` VitePress projection) with install, plugin authoring, skill and agent authoring in Markdown, and FAQ.
- [ ] `PRIVACY.md` (section 9).
- [ ] Reproducibility guide: one command per RQ, pinned versions, expected outputs, and a `CITATION.cff`; archive the evaluation release with a DOI (for example Zenodo).
- [ ] Changelog and a stated release cadence (for example monthly minor releases, with patch releases as needed).

Community:

- [ ] `CONTRIBUTING.md` (fork-specific), `CODE_OF_CONDUCT.md` (Contributor Covenant), `GOVERNANCE.md`.
- [ ] Issue and pull request templates; 10 or more labelled good first issues; a public roadmap.
- [ ] One discussion venue (GitHub Discussions first; add Discord or Matrix only when there is someone to moderate it).
- [ ] Launch post with the security scorecard and demo video (Show HN, r/LocalLLaMA, MCP community).
- [ ] Offer generic fixes upstream to deepseek-harness to maintain a good relationship and reduce divergence.

## 9. Responsible AI

- **Safety documentation.** State what the agent can touch (files, shell, network, OS input), default permissions, and how to run it in a VM or container; keep upstream's "not audited" wording until an external review.
- **Threat model.** Publish before launch and update per capability, covering Rule-of-Two properties per tool, MCP supply chain (poisoning, rug pull, package drift), memory poisoning, secrets, and local attackers.
- **Privacy policy for local data.** What is stored locally (sessions, memory, attachments, keys), where, whether encrypted at rest, how to export and delete it, and what leaves the machine. Name each default model provider, link its data-use policy, and state that choosing a cloud model sends conversation content to it.
- **Voice and screen features.** Default off, local processing, and visible indicators while the microphone or screen capture is active.
- **Accessibility.** Target WCAG 2.2 AA for web and desktop clients (keyboard navigation, screen-reader labels, contrast, transcripts for voice output).
- **Internationalisation.** Keep upstream's typed locale dictionaries and English/Chinese docs; invite community translations.
- **Misuse.** Document prohibited uses; keep irreversible actions behind confirmation by default.

## 10. Positioning statement and naming

### 10.1 Positioning statement (draft)

> For people who want a capable personal AI agent on their own computer without handing over trust they cannot verify, **[Name]** is an open-source, local-first assistant built on DeepSeek Harness that pins and verifies every tool it uses, keeps memory the user can inspect and edit, and runs with cheap or local models. Unlike closed desktop assistants, every model-visible input is logged, every plugin is signed, and every security claim is backed by a reproducible benchmark.

Short tagline options: "A personal agent you can audit." / "Local-first. Pinned. Provable."

### 10.2 Naming and branding for a fork

- **Do not use "DeepSeek Harness" or "DeepSeek" in the product name, logo, or package scope.** The upstream brand guidelines call it a registered trademark and ask forks to avoid it, while allowing "built on DeepSeek Harness" and "compatible with DeepSeek Harness" in descriptions and suggesting "DSH" for ecosystem naming.
- **Avoid "Jarvis" as the product name.** It is tied to a major film franchise and used by many existing products, so it is weak for search and risky for trademark.
- **"AIR" continuity.** Reusing AIR links to the earlier project, but it is a common word and acronym; a distinct compound (for example "AIR-DSH") or coined word is easier to protect and find.
- **Attribution text for README and About dialog:** "[Name] is an independent project built on DeepSeek Harness (MIT licence). It is not affiliated with or endorsed by DeepSeek."
- **Academic attribution.** In the dissertation, state which packages are upstream, which are modified, and which are new, with a commit hash of the upstream base, so that examiners can separate the student's contribution from inherited work.
