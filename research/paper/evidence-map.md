# Evidence map for `phase1-paper.md`

Each row maps one quantitative claim in the paper to its source. Paths are relative to the repository root. "Label" is the paper's own: MEASURED (run by a person on the stated machine), ESTIMATE (arithmetic or assumption in the source), DERIVED (arithmetic computed for the paper over reported values), CLAIM (figure quoted from a cited external source, not reproduced), TEST COUNT (recorded in a plan file at execution), HAND-RUN (single run recorded in the verification log). Rows marked "weak" rest on a summary whose raw data are lost, a single run, or a scratch copy outside the executed work.

## 1. Introduction and abstract

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| Abstract, 1.1, 5.1 | First live request size before any conversation | about 8,500 tokens | `air/CHECKS.md`, 2026-10-12 desktop app, "Open or not covered" | HAND-RUN |
| Abstract, 1.1, 5.1 | Share of a 16,384-token window | 52 to 54 percent | `air/CHECKS.md`, 2026-10-12 desktop app; `air/plans/README.md`, "Context budget on local models" | HAND-RUN |
| 1.1, 5.1 | Runtime default context on this GPU class | 4,096 tokens | `research/notes/10-local-models-rig.md`, sections 1 and 4.5 | MEASURED |
| 1.1, 2.1, 7 | Qwen3-8b attack success without and with reasoning | 14 percent and 41.8 percent | `research/notes/10-local-models-rig.md`, sections 3.3 and 10 (quoting arXiv 2508.14925) | CLAIM |
| Abstract, 5.1, 6 | Same-day lean versus full request | 32 tools and 7,686 tokens versus 19 tools and 4,426 tokens | `air/CHECKS.md`, 2026-10-12 local-model tuning, E4 and E5 | HAND-RUN |
| Abstract, 5.7 | Files changed outside the AIR workspace and `research/` | 23 | `air/UPSTREAM-DELTA.md`, "Re-check after each upstream sync" | Count in delta record |
| 1.2 | Team size | owner plus four teammates | `air/plans/README.md`, owner decisions (team size and tracking) | Record |

## 2. Background

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 2.2 | Repositories using AGENTS.md | more than 60,000 | `research/notes/03-competitors.md`, section 1.4 | CLAIM |
| 2.2 | Skill metadata always loaded and body size | about 100 tokens; under about 5,000 tokens | `research/notes/03-competitors.md`, sections 1.3 and 2.1 | CLAIM |
| 2.2 | Agent Plugins launch date | 2026-08-07 | `research/notes/03-competitors.md`, section 1.4 | CLAIM |
| 2.2 | Skill never invoked; compressed index score | 56 percent; 100 percent | `research/notes/03-competitors.md`, section 2.2 (Vercel, 2026-01-27) | CLAIM |
| 2.2 | Marketplace skills with at least one vulnerability | 26.1 percent of 31,132 | `research/notes/03-competitors.md`, sections 0 and 2.2 (arXiv 2601.10338) | CLAIM |
| 2.3 | MCPTox cases, servers, o1-mini attack success | 1,312 cases; 45 servers; 72.8 percent | `research/notes/07-product-fyp-strategy.md`, section 1; `research/notes/04-mcp-security.md`, section 1.3 | CLAIM |
| 2.3 | Number of existing pinning systems | at least seven | `research/notes/04-mcp-security.md`, sections 0, 2.1, 2.2; `research/research.md`, section 3, correction 1 | Survey count |
| 2.3 | Release transitions with unchanged invocation surface | 74.6 percent of 59,821 | `research/notes/07-product-fyp-strategy.md`, section 1 (Snyk issue 482, third-party report) | CLAIM (not re-fetched) |
| 2.3 | Defenses bypassed above 90 percent attack success | 12 | `research/notes/04-mcp-security.md`, section 4 row 7; `research/research.md`, section 3 | CLAIM |
| 2.3 | CaMeL task completion with provable security versus undefended | 77 percent versus 84 percent | `research/notes/04-mcp-security.md`, section 4 row 8; `research/notes/07-product-fyp-strategy.md`, section 2.3 | CLAIM |
| 2.4 | Prefix reuse: repeated 7.9k-token prefix | 0.03 to 0.04 s versus 3.4 to 4.9 s | `research/notes/10-local-models-rig.md`, sections 1 and 4.2 | MEASURED, n = 1 or 2 |

## 3. System design

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 3.1 | Packages and bundles | ten packages, five bundles | `air/AGENTS.md`, "Current state" | Record |
| 3.3 | Thinking multiplies output tokens | four to five times | `research/notes/10-local-models-rig.md`, section 4.4 | MEASURED, n = 1 |
| 3.3 | Default headroom that makes the threshold negative | 65,536 tokens | `air/README.md`, "Compaction and its limits"; `air/plans/README.md`, "Context budget" | Record |
| 3.3 | Preset-by-model window threshold | 65,536 tokens | `air/packages/preset-by-model/README.md`, Config | Configuration default |
| 3.3 | Log cap and first-request length | 60 entries; 300 characters | `air/packages/compaction-log/README.md`, Config | Configuration default |
| 3.3 | Summary output limit at 32K | 2,048 tokens | `air/packages/compaction-log/README.md`, "Model Experience" | Configuration |
| 3.4 | Instruction byte budget set by the bundle | 32,768 bytes | `air/packages/instruction-conventions/README.md`, Config | Configuration |
| 3.4 | Import depth | at most 4 hops | `air/packages/instruction-conventions/README.md`, Summary | Specification |
| 3.5 | Display cut of server text | 4,000 characters | `air/packages/mcp-trust/README.md`, "Known limitations" | Specification |

## 4. Methodology

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 4.2 | Linux laptop | Ryzen AI 9 HX 370, 30 GiB RAM, RTX 4060 Laptop 8 GiB, Fedora 44, Ollama 0.32.7 | `research/notes/10-local-models-rig.md`, section 2; `research/notes/09-desktop-cross-os.md`, status line | MEASURED |
| 4.2 | Windows laptop | Windows 11 Home 10.0.26200, RTX 4060 Laptop 8 GB, 31 GB RAM, Node 26.12.0, pnpm 11.28.5, Ollama 0.40.6 | `air/CHECKS.md`, 2026-10-20 first native Windows run | HAND-RUN |
| 4.3, 5.2 | Raw API protocol | one warm-up and two measured requests per configuration; system prompt 5,523 tokens | `research/notes/10-local-models-rig.md`, section 12.1 | MEASURED, raw data lost (weak) |
| 4.3, 5.4 | In-harness protocol | ten small tasks, two runs per model, nine scorable | `research/notes/10-local-models-rig.md`, section 12.2 | MEASURED, raw data lost (weak) |

## 5. Results

### 5.1 and 5.2 Context cost, window, speed

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.1 table | Full preset earlier capture | 36 tools, 8,113 tokens | `air/CHECKS.md`, E4 | HAND-RUN |
| 5.1 table | `air` preset by hand | 32 tools, 7,686 tokens | `air/CHECKS.md`, E5 | HAND-RUN |
| 5.1 table | `air-lean` | 19 tools, 4,426 tokens | `air/CHECKS.md`, E4 | HAND-RUN |
| 5.1 table | Shares of 16,384 and 32,768 windows | 49.5 and 24.8; 46.9 and 23.5; 27.0 and 13.5 percent | Arithmetic over E4 and E5 values | DERIVED |
| 5.1 | Tokens saved, same-day pair | 3,260 (7,686 minus 4,426); about 250 per removed tool | Arithmetic over E4 and E5 values | DERIVED |
| 5.1 | README statement of the saving | about 3,400 tokens | `air/packages/preset-by-model/README.md`, Summary | Record (differs from the derived value) |
| 5.1, 6 | Reduction in fixed cost | 45 percent (earlier capture) and 42 percent (same day) | Arithmetic over E4 and E5 values | DERIVED |
| 5.1 | Windows request size on the lean preset | 4.8K tokens | `air/CHECKS.md`, 2026-10-20, "Passed" | HAND-RUN |
| 5.1 | Tokens per run and steps, `qwen3-8b-16k`; per-step ratio | 25,600 tokens; 2.8 steps; about 9,000 per step | `research/notes/10-local-models-rig.md`, section 12.2; arithmetic | MEASURED (weak) and DERIVED |
| 5.1 | Silent truncation | 7.9k-token request reported as 2,050 prompt tokens | `research/notes/10-local-models-rig.md`, section 4.5 | MEASURED, n = 1 |
| 5.2 table | Speed and GPU share by context size | `qwen3:8b` 40, 33, 21, 15 tokens per second and 100, 90, 76, 67 percent; `qwen3.5:9b` 41, 39, 40, 33 and 100, 100, 100, 87; `llama3.1:8b` 43, 42, 30, 23 and 100, 100, 82, 74; `granite4.2:8b` 36, 27, 16, 13 and 100, 85, 72, 63; `qwen2.5:7b-instruct` 48 and 100 | `research/notes/10-local-models-rig.md`, section 12.1 | MEASURED, raw data lost (weak) |
| 5.2 | KV cache per token | about 141 KiB (`qwen3:8b`); about 47 to 57 KiB (`qwen2.5:7b-instruct`) | `research/notes/10-local-models-rig.md`, section 3.1 | MEASURED |
| 5.2 | Real harness prompt size | about 7,500 tokens | `research/notes/10-local-models-rig.md`, section 12.1 | MEASURED |
| 5.2 | Default and alternative speeds | 15 and 33 tokens per second | `air/README.md`, "Local models"; `air/ONBOARDING.md`, section 8 | Record |
| 5.2 | Fedora hand-run speed and reply time | about 30 tokens per second; 35 s | `air/CHECKS.md`, 2026-10-12 desktop app | HAND-RUN |
| 5.2 | Windows hand-run speed, load, memory | 17 tokens per second; 14 s; 10.3 GB model with 6.3 GB in GPU memory | `air/CHECKS.md`, 2026-10-20 | HAND-RUN |
| 5.2 | GPU temperature and speed variation | 50 to 67 degrees Celsius; 37.5 and 46.8 tokens per second; about 20 percent | `research/notes/10-local-models-rig.md`, sections 4.1 and 9.4; arithmetic | MEASURED and DERIVED |

### 5.3 Compaction

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.3 | Compaction never ran on local models before 2026-10-12 | threshold negative at 16K and 32K | `air/plans/README.md`, "Context budget on local models" | Record |
| 5.3 | One cut-off reply in a seven-turn session | 1 occurrence | `air/CHECKS.md`, 2026-10-12 desktop app | HAND-RUN |
| 5.3 | Thresholds and reply caps | 16K: about 9,000 tokens, replies near 3,000; 32K: 20,000 tokens, replies 4,096 | `air/README.md`, "Compaction and its limits" | Measured per README |
| 5.3 | Large-result trimming | over 8,192 characters, head and tail | `air/README.md`, "Compaction and its limits" | Record |
| 5.3 | Prompt reductions in E8 | 18,200 to 11,607; 22,649 to 13,905; 20,567 to 13,599; 24,564 to 15,844 | `air/CHECKS.md`, E8 | HAND-RUN |
| 5.3, 6, slide 7 | Percent reductions | 36.2, 38.6, 33.9, 35.5 | Arithmetic over E8 values | DERIVED |
| 5.3 | Whole-file read size | about 11,000 tokens | `air/CHECKS.md`, E8 | HAND-RUN |
| 5.3 | Ordering failure and fix | summary 205 versus 367 tokens; "f4" versus f1 to f4 | `air/packages/compaction-log/README.md`, Summary | Manual replay (single) |
| 5.3 | Live check | 11 messages; two summary requests; summary 957 tokens; f1.txt to f8.txt; 10 files ordered correctly | `air/CHECKS.md`, F4 | HAND-RUN |
| 5.3 | Added cost | about 330 tokens (instruction), about 160 tokens (log) | `air/packages/compaction-log/README.md`, "Model Experience" | Estimate in README |

### 5.4 Model choice and reliability

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.4 | Raw API passes out of 20 | `qwen2.5:7b-instruct` 20, `qwen3.5:4b` 20, `qwen3:8b` 20, `gemma4:e4b-it-qat` 19, `qwen3.5:9b` 18, `granite4.2:8b` 18, `granite4.2:3b` 18, `llama3.1:8b` 16 | `research/notes/10-local-models-rig.md`, section 12.1 | MEASURED, raw data lost (weak) |
| 5.4 | Plain-text tool calls | none in 160 runs | `research/notes/10-local-models-rig.md`, section 12.1; `air/plans/README.md`, "Local-model quality" | MEASURED (weak) |
| 5.4 table | In-harness passes, seconds, steps, tokens | 17/18, 65, 2.8, 25,600; 15/18 (16 lenient), 58, 4, 39,500; 15/18, 66, 2.8, 25,900; 12/18, 14, 2.9, 25,000 | `research/notes/10-local-models-rig.md`, section 12.2 | MEASURED, raw data lost (weak) |
| 5.4, 7 | Scoring misses | 1 run (`qwen3-8b-16k`) and 2 runs (`qwen35-4b-32k`) | `research/notes/10-local-models-rig.md`, section 12.2 | MEASURED |

### 5.5 Conventions

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.5 | Web UI live run | 7.5K-token request, 46 percent of 16K, 43 s, about 25 tokens per second; import reached the model; `/issue 42`; echo tool call | `air/plans/2026-09-30-01-file-conventions-slice1.md`, "Live run and Windows CI (2026-10-09)" | HAND-RUN |
| 5.5 | Desktop checks | `@notes.md` import, `/issue 42`, `hello` skill answered "Hello Sam!", `.mcp.json` server pinned and `echo: mango` | `air/CHECKS.md`, 2026-10-12 desktop app | HAND-RUN |
| 5.5 | Plan 01 test counts | 298 (289 in packages at 100 percent coverage; 9 workspace-level) | `air/plans/2026-09-30-01-file-conventions-slice1.md`, "Review and fix round" | TEST COUNT |
| 5.5 | Windows CI | both legs pass after correcting three tests | `air/plans/2026-09-30-01-file-conventions-slice1.md`, "Live run and Windows CI" | Record |
| 5.5 | Fields parsed but not enforced | `allowed-tools`, `context: fork`, `agent`, `model`, `paths` | `air/packages/skill-conventions/README.md`, "Known Limitations"; `air/packages/command-conventions/README.md` | Record |

### 5.6 MCP review

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.6, slide 10 | Test counts | 308 (`mcp-trust`), 48 (`mcp-trust-cli`), 72 (`mcp-conventions`), 141 (upstream MCP client suite) | `air/plans/2026-09-30-02-mcp-trust.md`, "Execution record (2026-10-10, Fedora)", Evidence | TEST COUNT |
| 5.6 | Scenarios covered | 27 | `air/plans/2026-09-30-02-mcp-trust.md`, "Scenario coverage"; `research/notes/04-mcp-security.md`, section 3.9 | TEST COUNT |
| 5.6 | Hand-run approval flow | declined tool unavailable; resources tool denied; diff; pin; status approved; `echo: mango` | `air/CHECKS.md`, 2026-10-12 desktop app | HAND-RUN |
| 5.6 | Gaps found live and fixed | 2 | `air/plans/2026-09-30-02-mcp-trust.md`, "Execution record", Evidence | Record |
| 3.5 | Digest fields and encoding | name, title, description, input and output schema, annotations, execution; RFC 8785; SHA-256 | `research/notes/04-mcp-security.md`, section 3.2 and 3.3; `air/plans/2026-09-30-02-mcp-trust.md`, Execution record | Design specification |

### 5.7 Footprint

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.7 table | Files by group | 8 (MCP client); 5 (desktop); 3 (chat client); 3 (catalog and generator); 4 (infrastructure); total 23 | `air/UPSTREAM-DELTA.md`, table (grouping counted for the paper) | Count |
| 5.7 | Upstream commits per sync | 2,224; 187; 266; 669 | `research/research.md`, section 2b (first, second, third, fourth sync) | Record |
| 5.7 | Sync dates | 2026-09-28; 2026-09-29; 2026-10-08; 2026-10-09 | `research/research.md`, section 2b | Record |
| 5.7 | Convention packages unchanged through the last sync; two AIR changes | preset realignment; working-directory service | `air/plans/README.md`, "Changes the 2026-10-09 upstream sync requires" | Record |

### 5.8 Windows and pilot

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 5.8 | Windows steps passed | install, build, typecheck, lint, test (ten packages), smoke | `air/CHECKS.md`, 2026-10-20, "Passed" | HAND-RUN |
| 5.8 | Load-sensitive test | 500 ms start-up timeout; failed once; passed three times | `air/CHECKS.md`, 2026-10-20 | HAND-RUN |
| 5.8 | Windows first reply | 14 s including model load; 17 tokens per second | `air/CHECKS.md`, 2026-10-20 | HAND-RUN |
| 5.8 | Scratch pilot, plan 06 | native 6.9 s, 3,601 input and 263 output tokens; harness 9.6 s, 5,174 and 350; 5 episodes | `air/plans/2026-10-03-06-agentdojo-pilot.md`, "Facts verified while writing this plan", item 4 | MEASURED in scratch copy (weak) |
| 5.8 | Earlier pilot summary | native 5.8 s; harness 9.0 s, 5,094 input and 313 output tokens | `research/notes/10-local-models-rig.md`, section 9.1 | MEASURED (weak) |
| 5.8 | Disagreement on native timing | about a fifth | Arithmetic over 6.9 and 5.8 | DERIVED |

## 6. Discussion, limitations, future work

| Paper location | Claim | Value | Source file and section | Label |
|---|---|---|---|---|
| 6 | `qwen3:8b` speed lost from 8K to 32K | more than half (40 to 15) | `research/notes/10-local-models-rig.md`, section 12.1 | MEASURED (weak) |
| 7 | Benchmark raw data from 2026-10-10 lost | lost on 2026-10-12 | `research/notes/10-local-models-rig.md`, section 12; `air/CHECKS.md`, "Not checked" | Record |
| 8 | Hybrid experiment size | 286-episode AgentDojo subset | `research/research.md`, section 2c (note 12); `air/plans/2026-10-03-06-agentdojo-pilot.md`, follow-up plans | Plan |
| 8 | Plans 03 to 07 state | written, not executed (07 superseded) | `air/plans/README.md`, status table | Record |
| Appendix A | Numbers repeated from sections above | see rows above | see rows above | see rows above |
