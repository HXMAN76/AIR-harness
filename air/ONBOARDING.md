# Onboarding for the AIR team

This page is the entry point for a new teammate. It says what the project is, where to start, what to do on the first day, how the team works, and where the context lives.

## 1. What you are joining

1. AIR (working name; the final name is undecided) is a local-first personal agent. It is a final-year project with research questions on MCP tool pinning, permission policy, and memory.
2. It is built on a fork of an MIT-licensed open-source agent harness and delivered as plugins and bundles in the `air/` workspace.
3. The product runs inside upstream's Electron desktop app. The desktop app is the primary surface, the Web UI must keep working, and a headless profile serves evaluation and scripted runs. macOS is out of scope.
4. The default model is `qwen3:8b` on Ollama with a 32K context variant. Hosted models are untested.
5. Working: project files from other agents (`.claude` folders, `.mcp.json`) are read unchanged, project MCP servers are pinned and reviewed, two presets switch by model size, and compaction keeps a chronological log.
6. Checked: on Fedora, by hand, in the desktop app ([CHECKS.md](CHECKS.md)).
7. Not checked: nobody has run anything on native Windows, and there is no installer on any OS.
8. Written but not executed: plans 03 (permissions), 04 (memory), 05 and 06 (evaluation). Plan 07 (desktop shell) is superseded and needs a rewrite ([plans/README.md](plans/README.md)).
9. The status table in [README.md](README.md#status) is the short version.
10. Nothing important lives only in one person's chat history; the repository is the record.

## 2. Choose your path

| You use | Go to |
|---|---|
| Native Windows (PowerShell, no WSL) | [WINDOWS.md](WINDOWS.md), then return to section 3 |
| Linux | The quick start in [README.md](README.md#quick-start-desktop-app) |

## 3. First-day checklist

1. Set up the toolchain and build, following the page for your path (Node `^22.19` or `>=24`, pnpm exactly `11.28.5`, Git 2.26 or newer, Ollama).
2. Create the model `qwen3-8b-32k` ([README.md](README.md#local-models)).
3. Run `pnpm -C air run desktop:setup`, then `pnpm -C air run desktop`. The first launch downloads a runtime payload and takes a while.
4. Send a message. Check that the window shows the preset "AIR Lean" and the model `qwen3-8b-32k`.
5. Try a `.claude` project: run `pnpm -C air run demo` to create a scratch project, add it as a workspace, and ask the model to use the `hello` skill or the `/issue 42` command ([README.md](README.md#project-conventions)).
6. Try an MCP server from that project's `.mcp.json`: `/mcp approve <server>`, then the tool-list approval ([README.md](README.md#mcp-trust)).
7. Run the AIR checks: `pnpm -C air run typecheck`, `lint`, `test`, and `smoke`.
8. Windows teammates: fill in the report template at the end of [WINDOWS.md](WINDOWS.md) and post it.

## 4. How the work is organised

- Branch from `air/main` (`feat/<topic>`, `fix/<topic>`, `docs/<topic>`), open a pull request into `air/main`, and get one teammate's review. `master` mirrors upstream: never push to it and never commit to it.
- The fork's own `air` CI job (Linux and Windows) is the signal for AIR work.
- Upstream's `CI` workflow also runs on the fork. Some of its jobs need upstream's private runners and are cancelled after 24 hours, which leaves a red "all checks passed" mark on every pull request. That mark is expected: ignore it.
- Never change workflow settings or disable workflows in the fork.
- Each plan has one owner at a time. Write your name and the date next to the plan in the roadmap table when you take it, and tick the task checkboxes in the plan file as you finish them.
- Anything that changes scope, defaults, or architecture goes into [plans/README.md](plans/README.md) in the same pull request, with the date.
- Before pushing, run `pnpm run test:docs` if you touched Markdown and the relevant AIR tests if you touched code. Do not run the whole upstream suite; CI owns it.
- Upstream syncs are done by one person, following the routine in [AGENTS.md](AGENTS.md).

## 5. Working with a coding agent in this repository

- The agent reads the root `AGENTS.md` (upstream rules). Claude Code also loads `.claude/rules/air.md`, which points at [AGENTS.md](AGENTS.md) in this directory. For other tools, tell the agent to read `air/AGENTS.md` first.
- Build the code graph once with `graphify update .` if graphify is installed, then use `graphify query "<question>"`, `graphify explain "<concept>"`, and `graphify path "<A>" "<B>"` before grepping across `packages/`. It is optional.
- Worker rules the project uses: give a worker one small task; write the test first; have the worker report what it ran and what it did not run, with estimates labelled as estimates; do not execute a later plan until the owner says to.
- Agent memory is per machine. Put anything the team needs into the repository: a decision in `plans/README.md`, a measurement in [CHECKS.md](CHECKS.md) or a research note, a pitfall in the relevant plan.

## 6. Where the context lives

| You want | Read |
|---|---|
| The status and how to run it | [README.md](README.md) |
| What was checked, when, and where | [CHECKS.md](CHECKS.md) |
| Roadmap, plans, decisions, open questions | [plans/README.md](plans/README.md) |
| The whole research picture | [../research/research.md](../research/research.md) |
| Evidence per topic | `../research/notes/01` to `14` |
| Exact upstream APIs for a feature | [plans/spikes/](plans/spikes/) |
| Rules for agents working in this fork | [AGENTS.md](AGENTS.md) |
| Which upstream files the fork changed | [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md) |
| Product name and icon placeholders | [BRANDING.md](BRANDING.md) |
| How to write a plugin | [../research/notes/08-dev-contrib-guide.md](../research/notes/08-dev-contrib-guide.md), [plans/spikes/01-toolchain.md](plans/spikes/01-toolchain.md) |

## 7. Who decides

The project owner decides the product name, scope cuts, model budget, rubric and deadlines, and release steps. The open questions are listed at the end of [plans/README.md](plans/README.md).

## 8. Models

Measured recommendation (research note 10 section 12, 2026-10-10, and the desktop checks of 2026-10-12): use `qwen3:8b` with a context variant as the agent model. `qwen3-8b-32k` is the default (about 15 tokens per second on an 8 GB GPU) and `qwen3-8b-16k` is faster (about 33 tokens per second) but tight. Plain `qwen3:8b` runs at a 4,096-token context and silently truncates requests, so always create a variant. `qwen2.5:7b-instruct` is faster but less reliable on multi-step tasks. The other variants and their sizes are in [README.md](README.md#local-models).

Candidate models for an 8 GB GPU (tags checked against the Ollama registry on 2026-10-02; the small set is about 25 GB). On Linux:

```sh
for m in qwen3:8b qwen3.5:9b qwen3.5:4b granite4.2:8b granite4.2:3b gemma4:e4b-it-qat qwen3-embedding:0.6b embeddinggemma; do ollama pull "$m" || echo "FAILED: $m"; done
```

On Windows PowerShell:

```powershell
foreach ($m in "qwen3:8b","qwen3.5:9b","qwen3.5:4b","granite4.2:8b","granite4.2:3b","gemma4:e4b-it-qat","qwen3-embedding:0.6b","embeddinggemma") { ollama pull $m; if ($LASTEXITCODE -ne 0) { "FAILED: $m" } }
```

| Tag | Download | Why |
|---|---|---|
| `qwen3:8b` | not recorded | Recommended agent model, with a context variant |
| `qwen3.5:9b` | 6.6 GB | Newest Qwen in this size; tight fit |
| `qwen3.5:4b` | 3.4 GB | Fast small model for routing and judging |
| `granite4.2:8b` | 5.3 GB | Tool calling and JSON output; Apache-2.0 |
| `granite4.2:3b` | 2.2 GB | Small tool-calling model |
| `gemma4:e4b-it-qat` | 6.1 GB | Comparison point; check its licence before shipping |
| `qwen3-embedding:0.6b` | 0.6 GB | Candidate embedding upgrade (1,024 dimensions) |
| `embeddinggemma` | 0.6 GB | Candidate small embedder |

Optional large models that run split across CPU and GPU (about 32 GB more): `gpt-oss:20b` and `qwen3:30b`. Already used by the project: `qwen3:8b`, `qwen2.5:7b-instruct`, `llama3.1:8b`, `nomic-embed-text`.
