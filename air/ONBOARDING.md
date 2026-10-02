# Onboarding for the AIR team

This page gets a new teammate from a fresh clone to a running local agent, and tells them where the project's context lives.

## 1. What you are joining

AIR (working name) is a local-first personal agent: a desktop app that runs an AI agent on your own machine, extended through plain files and plugins, with security properties that can be checked. It is built on a fork of an open-source, MIT-licensed agent harness, and it is a final-year project with research questions about MCP tool pinning, permission policy, and memory.

Status: research and implementation plans are complete; building has not started. See [plans/README.md](plans/README.md) for the roadmap and the owner's decisions.

## 2. Set up

Requirements: Linux or native Windows (WSL 2 is optional; if you use it, keep the checkout inside the Linux filesystem), Node `^22.19` or `>=24`, Git 2.26+, about 10 GB of free disk for the build, and [Ollama](https://ollama.com) for local models.

```sh
git clone git@github.com:HXMAN76/AIR-harness.git
cd AIR-harness
git switch air/main
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
corepack enable
pnpm install
pnpm run build                      # several minutes
```

On native Windows run the commands in PowerShell; replace `$PWD` with the repository path, `cp` with `Copy-Item`, `~/.dsh` with `$HOME\.dsh`, and write the `.env` line with `Add-Content`. The agent's shell tool on Windows is PowerShell, and the command sandbox there has partial enforcement (see `packages/sandbox/sandbox-windows-acl`).

Create the `air` profile (once per machine):

```sh
pnpm dsh --profile air --from-default-profile web --dump-config > /dev/null
pnpm dsh plugin --profile air add "$PWD/air/bundles/air"
cp air/examples/ollama.profile.cordis.patch.yml ~/.dsh/profiles/air/cordis.patch.yml
echo 'OLLAMA_API_KEY=ollama' >> ~/.dsh/.env
```

Pull the default local model and start the app:

```sh
ollama pull qwen3:8b
pnpm dsh --profile air              # opens the Web UI on http://127.0.0.1:3080
```

Known issue: Ollama's default context is 4,096 tokens, which silently truncates the agent's prompt. Until the bundle ships a check, start Ollama with a larger context (`OLLAMA_CONTEXT_LENGTH=16384`), see [research note 10](../research/notes/10-local-models-rig.md).

Known issue: skills in your personal `~/.agents/skills` are loaded too and can distract a small local model; plan 01 fixes this.

## 3. Where the context is

Everything the team needs is in the repository; nothing important lives only in one person's chat history.

| You want | Read |
|---|---|
| The whole picture in one document | [../research/research.md](../research/research.md) |
| Evidence and sources per topic | `../research/notes/01`–`11` |
| What we decided and what is still open | [plans/README.md](plans/README.md), sections "Owner decisions" and "Open decisions" |
| What to build, step by step | `plans/2026-09-30-0*.md` (one plan per feature, each task has code and tests) |
| Exact upstream APIs for a feature | [plans/spikes/](plans/spikes/) |
| Rules for working in this fork | [AGENTS.md](AGENTS.md), then the root `AGENTS.md` for upstream conventions |
| Which upstream files we changed and why | [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md) |
| How to develop a plugin | [../research/notes/08-dev-contrib-guide.md](../research/notes/08-dev-contrib-guide.md), [plans/spikes/01-toolchain.md](plans/spikes/01-toolchain.md) |

## 4. Working with an AI coding agent

If you use Claude Code, Codex, or a similar tool in this repository:

- The agent reads the root `AGENTS.md` (upstream rules) automatically. Claude Code also loads `.claude/rules/air.md`, which points it at [AGENTS.md](AGENTS.md) in this directory. For other tools, tell the agent to read `air/AGENTS.md` first.
- Build the code graph once (`graphify update .`) if you have graphify installed; it makes questions about the 316 upstream packages much cheaper. It is optional.
- Agent memory is per machine and is not shared. When you or your agent learn something the team needs (a decision, a pitfall, a measured number), put it in the repository: a decision in `plans/README.md`, a finding in the relevant research note or spike, a pitfall in the relevant plan.
- Execute plans task by task and commit after each task, as the plans describe.

## 5. Team workflow

- **Branches.** `master` mirrors upstream; never commit to it. Branch from `air/main` (`feat/<topic>`, `docs/<topic>`), open a pull request into `air/main`, and get one teammate's review.
- **One plan, one owner.** Each plan in `plans/` has one person responsible at a time; write your name and the date next to the plan in the roadmap table when you take it, and tick the task checkboxes in the plan file as you finish them. That file is the progress record.
- **Decisions.** Anything that changes scope, defaults, or architecture goes into `plans/README.md` in the same pull request, with the date.
- **Before pushing.** Run `pnpm run test:docs` if you touched Markdown, and the plan's own test commands if you touched code. Do not run the entire upstream test suite; CI owns it.
- **Upstream syncs.** One person does them, following the routine in [AGENTS.md](AGENTS.md), and announces the new release tag to the team.

## 6. Who decides

The project owner decides the product name, scope cuts, model budget, and release steps. Open questions for the owner are listed at the end of [plans/README.md](plans/README.md).

## 7. Models to pull for testing

Candidate local models for an 8 GB GPU, from [research note 10](../research/notes/10-local-models-rig.md). All tags were checked against the Ollama registry on 2026-10-02. One command pulls the small set (about 25 GB); it continues past a failed pull and can be re-run to resume:

```sh
for m in qwen3.5:9b qwen3.5:4b granite4.2:8b granite4.2:3b gemma4:e4b-it-qat qwen3-embedding:0.6b embeddinggemma; do ollama pull "$m" || echo "FAILED: $m"; done
```

| Tag | Download | Why |
|---|---|---|
| `qwen3.5:9b` | 6.6 GB | Newest Qwen in this size; candidate default (tight fit) |
| `qwen3.5:4b` | 3.4 GB | Fast small model for routing and judging |
| `granite4.2:8b` | 5.3 GB | Tool calling and JSON output; Apache-2.0 |
| `granite4.2:3b` | 2.2 GB | Small tool-calling model |
| `gemma4:e4b-it-qat` | 6.1 GB | Comparison point; check its licence before shipping |
| `qwen3-embedding:0.6b` | 0.6 GB | Candidate embedding upgrade (1,024 dims) |
| `embeddinggemma` | 0.6 GB | Candidate small embedder |

Optional large models that run split across CPU and GPU (about 32 GB more; pull only with disk and bandwidth to spare):

```sh
for m in gpt-oss:20b qwen3:30b; do ollama pull "$m" || echo "FAILED: $m"; done
```

Already used by the project: `qwen3:8b`, `qwen2.5:7b-instruct`, `llama3.1:8b`, `nomic-embed-text`.
