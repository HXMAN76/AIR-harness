# 01 — Harness Audit: What the dsh Fork Already Gives a "Jarvis" Desktop Assistant

> **Upstream sync note (2026-09-28):** written against `dsh 0.1.6-alpha.2`. The fork is now at `dsh 0.2.0-rc.1`; see [research.md section 2b](../research.md) for what changed (experimental speech-to-text seam, cron-capable schedule with cold-session restore, Windows tray, agent-preset registry, session format v4).

Date: 2026-09-28. Scope: `/home/hxman/AIR-harness` at `master` (release `dsh 0.1.6-alpha.2`). Research only; no code was changed.

Method: the graphify knowledge graph (`graphify query/explain`) was used to orient, then each subsystem's group and package READMEs were read (every package README follows a fixed template with Summary, Model Experience, and "Known Limitations and Deferred Work" sections, which made the maturity comparison systematic), and selected source files were checked to confirm specific claims. Where a claim rests on a search rather than a full read, it is marked "not verified".

## 1. Overall picture

The repository is a large, disciplined TypeScript monorepo: 291 workspace packages under `packages/<group>/<pkg>/`, about 1,135 `*.spec.ts` files, 254 scripts of which about 60 are `verify-*` gates, a per-file 100% coverage CI gate (`pnpm run test:coverage`), keyless recorded-session snapshot tests (`snapshots/`), bilingual (English/Chinese) documentation with blob-hash pairing records (`README.i18n.yaml`), and roughly 18,000 commits. The code is MIT-licensed (`LICENSE`, copyright DeepSeek). Every capability is a Cordis plugin, including the agent loop itself (`docs/architecture.md`), so almost anything can be replaced from configuration without patching a core.

The quality bar is unusually high for an open-source agent harness, and the documentation is honest: every package lists its own constraints. The cost is complexity. The design is optimized for a single, well-staffed maintainer organization that wants strong invariants, not for casual third-party contributors or end users who want to drop a Markdown file into a folder.

For a Jarvis-style personal assistant, the harness already supplies the hard infrastructure (durable sessions, compaction, sandboxing, subagents, MCP, scheduling, a desktop shell, multiple model providers) but not the personal-assistant layer (memory, desktop context, voice, ambient triggers, OS integration such as tray and global hotkey, a user-facing extension model based on plain files).

## 2. Subsystem audit

### 2.1 Cordis plugin model, cordis.yml profiles, overlays, plugin install

What it does. Cordis (`vendor/cordis`, rescoped to `@deepseek-ai/cordis`) provides services, typed events, and reversible effects on a shared `Context`. A running `dsh` is a plugin tree composed from ordered layers: each bundle's `cordis.patch.yml` in profile order, then the profile's own `cordis.patch.yml`, then the home-level patch, then any `--patch` overlay (`docs/architecture.md`, "Profiles and bundles"). Profiles live in `$DSH_HOME/profiles/<name>` with a `package.json` whose `dsh.profile.bundles` lists bundles. `dsh --profile web --dump-config` prints the effective tree.

Third-party path. A third party publishes an npm package whose `package.json` declares `dsh.bundle.patch` pointing at a `cordis.patch.yml` that inserts rows (`docs/user/develop/basic/publish.md`). Users install it with `dsh plugin --profile <name> add <spec>` (a pnpm pass-through) or through the Web sidebar **Plugins** page (`packages/boot/plugin-manager`, `packages/client/ui-plugin-manager`). The plugin manager inspects a spec before installing, streams pnpm output, supports cancellation, restores `package.json`/`pnpm-lock.yaml` on failure, and asks for approval before running pnpm 11 blocked build scripts. There is also a model-facing `plugin_manager` tool, enabled in the "Creator" preset and gated by approval.

Maturity. High. Well tested, detailed failure tables, HMR support (`packages/boot/hmr`).

Strengths. There is no privileged core, and every row can be overridden by id. Installation is transactional where it matters. The out-of-tree authoring path is genuinely light: a plain `index.js` exporting `name` and `apply()` is a valid plugin.

Gaps and risks. There is no marketplace, registry index, search, ratings, version picker, or upgrade flow; the UI accepts a raw pnpm spec (`ui-plugin-manager` limits: "No version picker"). There is no signing, sandboxing, or capability declaration for installed plugins: a bundle runs in-process with full host permissions. Package replacement requires a process restart. Desktop package operations are owned separately by the Electron shell. YAML with `!!js` expressions is powerful but unfamiliar to end users.

Jarvis relevance: **Keep** the composition model; **extend** it with a curated catalog/marketplace index and a permission manifest for bundles.

### 2.2 packages/skill (skill, skill-filesystem, tool-skill, skill-office, skill-badge)

What it does. It provides a skill registry (`ctx.skills`) with pluggable providers. `skill-filesystem` discovers `<root>/<name>/SKILL.md` or flat `<root>/<name>.md` with YAML frontmatter under `<project>/.dsh/skills`, `<project>/.agents/skills`, custom roots, `~/.dsh/skills`, `~/.agents/skills`, and a bundled root (`packages/skill/skill-filesystem/src/index.ts`, lines 245–264), and watches them for changes. `tool-skill` injects a durable catalog of names and capped descriptions before the first request and exposes a `skill` tool that loads the full body on demand. Users can invoke `/name` for skills marked `user-invocable`; `disable-model-invocation` is also parsed.

Maturity. High for the core; `skill-office` ships Word/PowerPoint/Excel workflows.

Strengths. This is real progressive disclosure: the catalog holds only descriptions, and the body loads on demand, which matches the Claude Code model closely. Skills can come from non-filesystem providers (remote, embedded). Catalog changes are logged durably, which is consistent with the rule that anything model-visible is logged.

Gaps and risks. `.claude/skills` is not a default root, although a custom root can be configured. Discovery is only one level deep. Referenced resource files are not enumerated or attached; the model has to read them itself. There is no `allowed-tools` frontmatter (no tool scoping per skill). Loaded bodies have no size cap. Malformed skills disappear with only a log warning (`packages/skill/*/README.md` limits).

Jarvis relevance: **Keep and extend.** Add `.claude/skills` compatibility, per-skill tool scoping, and a skill-pack distribution format.

### 2.3 subagent and experimental/agent-team

What it does. `dsh-subagent` delegates tasks to named children through interchangeable backends: fresh in-process, history-forked in-process, ACP, DSH SDK, Codex, and Claude Code (`packages/subagent/*`). Children can be one-shot or continuable, with `tool-subagent-control` for messaging and interruption. `experimental/agent-team` adds a durable Lead/teammate roster, mailbox, and shared task board on top of continuable subagents.

Maturity. Subagents: high. Agent Teams: explicitly experimental, "no stability promise" (`packages/experimental/agent-team/README.md`).

Strengths. Heterogeneous delegation (a Claude Code or Codex child next to a native child) is unusual and valuable. Child sessions are traceable in the parent corpus, and depth limits and per-instance personas and tool filters are supported.

Gaps and risks. Subagent kinds are defined as `cordis.yml` rows (one tool instance per persona/tool filter), not as Markdown agent files. Residency is process-local, with no cross-process mailbox. Agent Teams share one checkout, with no worktree isolation and only advisory write scopes. The Claude Code child is one-shot, with no human interaction path.

Jarvis relevance: **Keep** subagents; **rethink** the authoring surface so a user-defined agent is a Markdown file with frontmatter that compiles to a subagent instance.

### 2.4 hooks (hook-protocol, hooks-claude-code, hooks-codex)

What it does. It runs existing Claude Code or Codex `hooks.json` command hooks at session start, prompt submit, pre/post tool use, stop, and (Claude Code) subagent events, by listening on `tools/pre-execute` and the `agent/*` events.

Maturity. Medium. It works, but the READMEs are frank about partial coverage: 23 of Claude Code's 30 hook events are unsupported (`packages/hooks/hooks-claude-code/README.md`), and 5 of Codex's 10. `PreToolUse` `allow` does not pre-approve, and `updatedInput` is parsed but not honored. Only `command` hooks run; `http`, `mcp_tool`, `prompt`, and `agent` hooks are skipped. `SessionStart` runs detached, so its context can miss the first request. The Codex bridge reduces non-shell tool arguments to `{ command }`.

Jarvis relevance: **Extend.** Hooks are the natural user-level automation surface. A native dsh hook dialect (not only bridges), plus the missing events (`Notification`, `PreCompact`, `SessionEnd`, `FileChanged`, `PermissionRequest`), would matter for an assistant.

### 2.5 mcp (mcp-client, mcp-resources)

What it does. It connects stdio or Streamable HTTP MCP servers configured as `cordis.yml` rows, exposes tools as `mcp__<server>__<tool>`, appends server instructions to the logged system prompt, and offers three shared resource tools (`packages/mcp/*/README.md`).

Maturity. High for the supported subset; reconnect and backoff are handled, and a generation swap is atomic (all or nothing).

Gaps and risks.
- **No schema pinning.** `syncTools` in `packages/mcp/mcp-client/src/tools.ts` (line 113 onward) calls `client.listTools(..., { cacheMode: 'refresh' })` and registers whatever the server returns now. It re-runs on `listChanged` notifications (`connection.ts`, lines 163–172 and 263). Descriptions and input schemas are trusted from the live `tools/list` with no hash, no first-seen record, and no diff approval, so a server can silently change a tool's description (a prompt-injection vector sometimes called "rug pull") or widen its schema between sessions.
- **No approval gate for MCP calls.** Searching the source shows `ctx.approval` is consumed by shell, filesystem sandbox escalation, plugin manager, and tool-cordis, but not by `mcp-client` (not verified exhaustively). MCP tool annotations (`readOnlyHint`, `destructiveHint`) are not read. The only interception points are hooks and the experimental Auto review.
- There is no OAuth for remote MCP servers (static `headers` only), no `.mcp.json` / Claude Desktop config import, and MCP prompts, subscriptions, and audio results are unsupported.

Jarvis relevance: **Keep and fix.** MCP is the cheapest ecosystem on-ramp, so pinning, approval, OAuth, and config import are priority items.

### 2.6 sandbox (sandbox, sandbox-local, sandbox-policy, sandbox-windows-acl)

What it does. It confines subprocesses to `read-only`, `workspace-write`, or `danger-full-access` using bubblewrap and Landlock on Linux, Seatbelt (`sandbox-exec`) on macOS, and restricted tokens with ACLs on Windows. It fails closed with `SANDBOX_UNAVAILABLE`, and a denied call may request a one-time escalation with human approval.

Maturity. High, with honest partial-enforcement reporting.

Gaps and risks. The policy covers file effects only: no network, process, device, or credential restrictions (`packages/sandbox/sandbox/README.md`). Windows enforcement is partial (the Everyone SID stays, and NTFS hard links alias files), and Landlock can be partial on older kernels. Seatbelt depends on the deprecated `sandbox-exec`. Credentials in `~/.dsh` are readable by sandboxed processes because they run as the same UID (`credentials-local` limits). MCP stdio servers and plugins are not confined by this seam (not verified).

Jarvis relevance: **Keep.** Add network policy before giving an assistant broad OS control.

### 2.7 interaction (user-approval, permission-presets, tool-ask-user, user-questions, commands)

What it does. `user-approval` gives one-shot `ask` / `never` decisions that fail closed and are audited in the session log. `permission-presets` names sandbox-plus-approval pairs. `ask_user_question` lets the model pause and ask the user. `commands` registers `/command` actions that never reach the model.

Maturity. High.

Gaps and risks. There is no `allow-always`, no remembered rule, no per-tool or per-pattern allow/deny list, and the approval request does not carry tool arguments (`packages/interaction/user-approval/README.md`). An answerer sees only the tool name and reason. That is a significant usability gap compared with Claude Code's permission rules and is dangerous for an assistant that runs many actions. Commands are TypeScript registrations; Markdown command files are not supported.

Jarvis relevance: **Rethink** the permission model (rule store, argument-aware prompts, per-tool policy, MCP annotations).

### 2.8 session, session-query, persistence format

What it does. There is an append-only `SessionEvent` log (`packages/core/session`) persisted as JSONL with Zstandard-compressed historical generations (`session-persistence-jsonl`). A catalogued adjacent-migration chain covers formats v0→v1→v2→v3; the latest released format is 3 (`docs/session-format-status.md`). Projections, titles, telemetry, and a checkpoint policy sit on top. `session-query` adds exact reads, traces, SQLite FTS5 search (opt-in), five model tools, and ZIP export.

Maturity. Very high. Crash recovery, kernel locks, and migration discipline are in place, and the rule "model-visible ⟺ logged" is enforced by a runtime invariant.

Gaps and risks. Nothing deletes session files, and there is no retention policy. FTS search is token-based, not semantic, and runs synchronously on the JS thread. Each index has a single process owner. The format rules (never rewrite committed generations; adjacent migrations only) add ceremony to every change to `SessionEventMap`.

Jarvis relevance: **Keep.** The log is the natural substrate for episodic memory; semantic indexing is missing.

### 2.9 compaction

What it does. It condenses older history into a summary under token pressure or on `/compact`, prunes oversized tool results first, and replaces images that the current route cannot send. Shadowed content stays in the log, so replay is deterministic.

Maturity. High and enabled by default in `dsh-base`.

Gaps and risks. There is no model-facing compaction tool. The token meter falls back to a character heuristic when provider usage is missing. The system prompt, tools, and session prefix cannot be shrunk.

Jarvis relevance: **Keep.**

### 2.10 context (agent-instructions, time-context, tmux-context, file-reference, session-reference)

What it does. `agent-instructions` loads user-global and project `AGENTS.md`/`CLAUDE.md` chains (plus `.local.md` overlays) within a byte budget. `time-context` (opt-in) appends a durable clock reading with the browser time zone. `tmux-context` (opt-in) reports the tmux pane location. `file-reference` offers `@file` completion.

Maturity. High; each is small and well scoped.

Gaps and risks. There are no `@path` imports and no `.claude/rules/`. `tmux-context` is the only environment-awareness plugin; there is nothing for the active window, clipboard, selected text, calendar, battery or network state, or open applications. These packages show the correct pattern for adding desktop context (a durable, source-attributed reading injected at step boundaries) but no desktop provider exists.

Jarvis relevance: **Extend**, and use `time-context`/`tmux-context` as templates for a `desktop-context` family.

### 2.11 workflow, ralph, workflow-ptc

What it does. The `workflow` tool runs a plain JavaScript orchestration script with `agent()`, `parallel()`, `pipeline()`, `phase()`, and `log()` in a fresh Node process under the session's file policy (`workflow-ptc`). `ralph` runs a fixed sequence of fresh agents toward one objective.

Maturity. Medium: foreground only, with no journaling or resume, no saved or nested workflows, no token budgets, and self-declared completion (`packages/workflow/*/README.md`).

Jarvis relevance: **Extend** later with saved, named workflows ("routines") and background runs; not a first priority.

### 2.12 jobs

What it does. Tools can start background work with a stable `<kind>-N` id; the owning agent reads output, waits, or cancels, and completion arrives as an in-session notice.

Maturity. High, but the contract is in-process (`packages/jobs/jobs/README.md`); a durable or cross-process backend would need a redesign.

Jarvis relevance: **Keep.**

### 2.13 schedule

What it does. It provides durable reminders (one-time or fixed interval, at least 5 minutes) delivered as follow-up messages in the same conversation, and survives restarts.

Gaps and risks. Delivery requires the original session to be live; a cold session gets nothing until it is resumed. There are no cron or calendar rules, and no OS, email, or push notifications (`packages/schedule/schedule/README.md`).

Jarvis relevance: **Extend substantially.** An assistant needs a daemon-level scheduler that can wake a session (or create a new one) and raise OS notifications.

### 2.14 webhook

What it does. `ctx.webhookRuntime` turns trusted external events into a new root session in a Web Workspace; `webhook-github` verifies GitHub signatures.

Gaps and risks. It is process-local fire-and-forget: no queue, replay, deduplication, or completion result, and no TLS (a reverse proxy is expected).

Jarvis relevance: **Keep** as the seed of an "ambient trigger" bus; generalize beyond GitHub.

### 2.15 goal, plan, todo, guard

- `goal`: a single durable objective per session with compare-and-set edits and a round cap; `goal-round-driver` continues work automatically. Budgets are round counts only, with no evaluator. **Keep.**
- `plan-mode`: `/plan` with a reviewed exit; guidance only, not enforced (all tools remain available). **Keep.**
- `tool-todo`: a whole-list-replacement task list owned by a single agent. **Keep.**
- `guard`: `repeat-tool-reminder` and cooperative `timeout-policy`. The shipped `bash`, `read`, `write`, and `edit` tools declare no timeout. **Keep**, and consider hard timeouts.

### 2.16 extensions (runtime self-modification)

What it does. `tool-cordis` lets agents inspect live Host and Client APIs (read-only). `cordis-host-runner`/`cordis-client-runner` run process-local dynamic definitions in a `node:vm` realm and the browser. Persistent changes go through the Plugin Manager in "Creator" mode.

Gaps and risks. Dynamic definitions vanish on restart. `vmTimeoutMs` bounds only synchronous code. Runs with a browser half suspend indefinitely without a connected page. The trust model is cooperative, not isolating.

Jarvis relevance: **Keep** as a differentiator ("the assistant can extend itself"), but only behind strong approval.

### 2.17 browser-use and computer-use (and experimental backends)

What it does. The core packages only reserve a single provider slot each and add no tools. All real backends are experimental: `browser-use-playwright-mcp`, `browser-use-chrome-devtools-mcp`, `browser-use-stagehand-native`, `browser-use-runtime`, and `computer-use-cua-driver-mcp`/`-native` (`packages/experimental/*`).

Gaps and risks. There is no stable browser or desktop control, and tool schemas follow pinned upstream packages "with no DSH stability promise". Playwright MCP supports Chromium only. The desktop is shared and unreserved, and cancellation does not undo input. Platform coverage for the Cua Driver is macOS-oriented in the docs (Linux and Windows support not verified).

Jarvis relevance: **Rethink or promote.** OS device control is central to a Jarvis product and currently sits entirely in the experimental tier.

### 2.18 web

What it does. `web_search` (Exa, Perplexity, or DeepSeek providers) and `web_fetch` (anonymous HTTP(S)).

Gaps and risks. There is no content extraction, per-URL policy, or local or self-hosted search provider (for example SearXNG).

Jarvis relevance: **Keep and extend** with a privacy-friendly search provider.

### 2.19 llm (llm, llm-deepseek, llm-pi-ai, llm-retry, token-meter)

What it does. A provider-neutral streaming vocabulary with adapters. `llm-deepseek` speaks DeepSeek Messages or Chat Completions. `llm-pi-ai` routes to pi-ai catalog providers and to custom gateways speaking `openai-completions`, `openai-responses`, or `anthropic-messages`, with OAuth or key sign-in (`packages/llm/llm-pi-ai/README.md`; `docs/user/guide/providers.md`).

Local models. Ollama, LM Studio, and vLLM expose OpenAI-compatible Chat Completions endpoints, so a custom `openai-completions` provider pointed at `http://localhost:11434/v1` should work. The README explicitly mentions self-hosted servers and a `vllmPriority` knob. An end-to-end Ollama run was not verified, and tool-calling quality with small local models is an open question.

Gaps and risks. There is no `tool_choice`, `top_p`, or penalty controls, no prompt-cache hints, and no response caching or rate limiting. The default model is `deepseek-official` / `deepseek-flash` (`packages/bundle/base/cordis.patch.yml`, lines 82–86).

Jarvis relevance: **Keep**; make local and Anthropic/OpenAI routes first-class in onboarding.

### 2.20 credentials, settings, identity

What it does. `credentials` resolves key names (such as `DEEPSEEK_API_KEY`) and stores per-plugin records; `credentials-local` keeps them in a private file under `$DSH_HOME`, with precedence launch environment, then stored file, then project `.env`, then home `.env`. `settings` layers schema defaults, composition, and user overrides with revision checks. `anonymous-user-id` stores a random UUID in `$DSH_HOME/.anonymous-user-id`.

Gaps and risks. There is no OS keychain provider (deferred), and secrets are readable by same-UID agent processes. `redactSecrets` is "not a proven wire boundary" (`packages/settings/settings/README.md`). The anonymous id is sent as a header to any configured DeepSeek gateway regardless of telemetry mode (`packages/identity/anonymous-user-id/README.md`).

Jarvis relevance: **Extend** with a keychain provider; **review** identity and telemetry defaults (section 3.4).

### 2.21 Clients (Web, Desktop, CLI) and the api/ remote BFF

What it does. The Web GUI is a large family of `packages/client/ui-*` plugins (chat, approvals, plan review, subagents, jobs, schedule, file and terminal sidebars, plugin manager, settings) served by `host/webserver` and assembled by `apps/web` (Vite). `apps/desktop` is an Electron shell around the same Web application, with a private `apps/desktop-host` running the profile in Electron's Node mode, signed updates, and a reserved `desktop` profile. The CLI (`apps/cli`) is a launcher for profiles (`web`, `headless`, `sdk`, `sdk-minimal`, `acp`). There is no interactive terminal UI in the repository; the CLI README mentions a `tui` profile only as a hypothetical installed profile (not found in the tree). `packages/api/*` is a typed Remote/RPC layer (Typert gateway over WebSocket) between Client and Host; it is a local BFF, not a multi-tenant cloud API.

Gaps and risks. The desktop app has no tray, global hotkey, quick-launch palette, OS notifications beyond update prompts, clipboard integration, or voice (a search for `globalShortcut`, `Tray`, `clipboard`, and speech APIs across `apps/desktop/src` and the client packages found none). All client copy must go through typed locale dictionaries (`verify-client-ui-i18n`). Desktop signing and notarization need a production release environment.

Jarvis relevance: **Keep** the Web and Desktop architecture; **build new** assistant-grade shell features (tray, hotkey, overlay window, voice, notifications). A terminal UI is **build new** if Claude Code parity matters.

### 2.22 sdk, Python SDK, acp

What it does. Newline-delimited JSON-RPC over stdio (`packages/sdk/*`), with a TypeScript client and a Python SDK (`python/sdk`, `python/sdk-runtime`, the latter bundling the `dsh` executable per platform). `dsh-acp` serves the Agent Client Protocol for automation (create, resume, cancel sessions; attach MCP servers).

Maturity. High, but deliberately narrow: ACP omits forks, transcript replay, modes, commands, terminals, and elicitation.

Jarvis relevance: **Keep.** ACP makes the product usable from Zed and other ACP editors, and the Python SDK suits a university evaluation harness.

### 2.23 bundle and preset

What it does. `bundle/base` is the shared first layer (models, tools, persistence, sandbox, approval, settings, telemetry); `web-app`, `headless`, `sdk-app`, `acp-app`, and `sdk-minimal` stack on top. `preset/agent-presets` mounts per-session agent compositions from `agent.cordis.yml` plus `preset.yml` (shipped: `standard`, `ptc`, `cordis`, `minimal`; user presets under `$DSH_HOME/.agent-presets`). `persona` shadows the system prompt per preset.

Gaps and risks. A preset cannot change after the session produces output. Superseded preset generations are never reclaimed until restart. Presets are Cordis YAML, powerful but not end-user friendly.

Jarvis relevance: **Keep.** Presets are the right place for "Assistant", "Coder", and "Researcher" modes.

## 3. Cross-cutting questions

### 3.1 Can agents, skills, commands, and hooks be plain Markdown/YAML files?

| Claude Code concept | dsh equivalent | Status |
|---|---|---|
| `skills/*/SKILL.md` with frontmatter | `skill-filesystem`: `.dsh/skills`, `.agents/skills`, `~/.dsh/skills`, `~/.agents/skills`, custom roots; `SKILL.md` or `<name>.md` | **Exists.** Progressive disclosure works; `user-invocable` and `disable-model-invocation` are honored. Missing: `.claude/skills` default, `allowed-tools`, resource enumeration. |
| `CLAUDE.md` / `AGENTS.md` | `agent-instructions` | **Exists**, including `.local.md` overlays. Missing: `@path` imports, `.claude/rules/`. |
| `.claude/agents/*.md` (subagent definitions) | `tool-subagent` rows in `cordis.yml`; presets in `agent.cordis.yml` | **Missing as Markdown.** Achievable only by editing YAML composition. |
| `.claude/commands/*.md` (slash commands) | `ctx.commands` (TypeScript); user-invocable skills via `/name` | **Partially covered.** A user-invocable skill behaves like a prompt command, but there are no argument placeholders and no dedicated commands directory. |
| `hooks.json` / settings hooks | `hooks-claude-code`, `hooks-codex` | **Exists as bridges** with partial event coverage; no native dsh hook file format. |
| `.mcp.json` / Claude Desktop config | `mcp-client` rows in `cordis.yml` | **Missing import.** Each server is a YAML row. |
| Plugins with a marketplace | npm packages with `dsh.bundle`, installed via `dsh plugin` or the Plugins page | **Install flow exists; marketplace missing** (no index, discovery, versions, trust metadata). |

Conclusion: skills and instructions are at parity; agents, commands, MCP config, and marketplace are the gaps. A thin "file-convention" plugin that maps `.claude/agents/*.md`, `.claude/commands/*.md`, `.mcp.json`, and `.claude/settings.json` hooks onto the existing seams would close most of the distance without touching the core.

### 3.2 Minimum path for a third-party developer, and how heavy it is

There are three paths, from lightest to heaviest:

1. **Skill file.** Write `~/.agents/skills/<name>/SKILL.md`. No build, no config; it is picked up live. This is the lightest path and matches Claude Code.
2. **MCP server.** Write a server in any language and add one `mcp-client` row via a `--patch` overlay or profile patch. It requires YAML knowledge and has no approval or pinning (section 2.5), but no TypeScript.
3. **Out-of-tree TypeScript/JS plugin.** Create an npm package with `dsh.bundle.patch`, a `cordis.patch.yml`, and an `apply(ctx)` function (`docs/user/develop/basic/tool.md`, `publish.md`), then run `dsh plugin add <spec>`. This is moderate: the author must learn Cordis `inject`, `ctx.tools.register(defineTool(...))`, and the patch format. None of the in-repo gates apply to out-of-tree packages.

Contributing **inside the monorepo** is much heavier. `docs/cookbook/adding-a-package.md` and the gates require: bilingual `README.md` plus `README.zh.md` with a `README.i18n.yaml` blob-hash pairing record (`verify-translation-pairing`); a fixed README template with Summary, Model Experience (token and KV-cache effects), and Known Limitations (`verify-package-readme-*`); JSDoc on every export (`verify-export-jsdoc`); per-file 100% coverage; a runtime invariant companion or a written justification for omitting it; recorded-session snapshot updates for model-visible changes, including TypeScript and Python SDK expected outputs for loop changes; locale dictionaries for UI copy; word budgets (`verify-doc-budgets`); and prose rules (for example the banned-term rule and `verify-concrete-terms`).

Assessment: the out-of-tree path is acceptable for an open-source ecosystem, provided the product advertises it as the main extension route and ships starter templates. The in-tree bar is appropriate for a core team but would deter casual contributors; a fork that wants community contributions should keep core changes rare and push features into out-of-tree bundles, skills, and MCP servers. For a final-year project, the in-tree bar is also a schedule risk: every new package needs Chinese documentation unless the fork relaxes that gate.

### 3.3 What is missing for a Jarvis assistant

- **Long-term memory.** No memory package exists. The session log plus FTS5 search (`session-query-sqlite`) gives keyword recall over past sessions, and `docs/user/guide/mcp-memory.md` shows default-off overlays for third-party memory MCP servers (Memorix, the MCP reference memory server, Engram). There is no first-party semantic memory, user profile, preference store, or automatic "remember this" extraction. **Build new**, ideally as a seam (Service Definition, Provider, and memory tools plus a context injector) so it follows the log-first rule.
- **Desktop context.** Only `tmux-context` and `time-context` exist. There is no clipboard, active window or app, selected text, screen summary, calendar, or system state (battery, network, focus mode). **Build new** as `context/desktop-*` plugins modeled on `time-context` (durable, source-attributed readings).
- **Voice.** No speech-to-text, text-to-speech, wake word, or microphone path was found in the client or desktop code. **Build new** (Electron renderer capture plus a local Whisper or cloud STT provider seam, and a TTS seam).
- **OS device control.** Only experimental computer-use and browser-use backends. There are no first-party tools for app launch, window management, volume, notifications, file open, or system settings. **Promote and build**, with per-action approval.
- **Proactive and ambient triggers.** `schedule` delivers only into a live session; `webhook` is process-local and GitHub-only; there is no filesystem-watch trigger, calendar trigger, OS event trigger, or background daemon that survives closing the window. **Build new** trigger bus plus a resident background process (tray agent).
- **MCP tool schema pinning.** Confirmed missing: `syncTools` trusts the live `tools/list` (`packages/mcp/mcp-client/src/tools.ts`), re-syncs on `listChanged`, and ignores annotations. **Fix:** hash each tool's name, description, and input schema on first approval, store the hash per server, require re-approval on drift, and gate calls by `readOnlyHint`/`destructiveHint` plus a user rule store.
- **Permission rules.** No allow-always, no argument-aware prompts, no per-tool rules (section 2.7). For an assistant that acts on the OS, this is a prerequisite.
- **Notifications, tray, hotkey, quick-entry window.** Absent from `apps/desktop`.

### 3.4 Top 10 strengths and top 10 weaknesses

Strengths worth advertising:

1. All-plugin architecture with no privileged core; every capability, including the loop, is replaceable from YAML.
2. A durable, replayable, append-only session log with versioned migrations, crash recovery, and the rule that anything the model sees is logged, which makes behavior auditable.
3. Real OS sandboxing on all three platforms (bwrap/Landlock, Seatbelt, Windows ACL) that fails closed and reports partial enforcement honestly.
4. Heterogeneous subagents: native, forked, ACP, SDK, Codex, and Claude Code children behind one interface.
5. Progressive-disclosure skills compatible with the SKILL.md convention, loaded live from disk.
6. Multi-provider LLM routing (DeepSeek, pi-ai catalog, custom OpenAI/Anthropic-protocol gateways, self-hosted endpoints) with live settings changes.
7. A transactional plugin install flow from the GUI and CLI, including an agent-facing `plugin_manager` tool and runtime API inspection (self-extension).
8. Hooks compatibility with existing Claude Code and Codex `hooks.json`, and delegation to Claude Code itself.
9. Multiple front doors from one runtime: Web, Electron Desktop, headless, a JSON-RPC SDK (TypeScript and Python), and ACP.
10. Exceptional engineering hygiene: per-file 100% coverage, recorded-session snapshots, about 60 verification gates, and honest per-package limitation documentation. MIT license.

Weaknesses and risks:

1. **Complexity and onboarding cost.** 291 packages, Cordis realms and isolates, waterfall events, typert codegen, and a dense prose standard make the learning curve steep for students and contributors.
2. **In-tree contribution friction.** Bilingual READMEs with hash pairing, invariants, snapshots, 100% coverage, and doc word budgets.
3. **Upstream-merge cost.** Upstream is extremely active (about 18,000 commits; release cadence of alpha tags) and refactors broadly; any fork edit to core packages or shared YAML will conflict often.
4. **DeepSeek-specific coupling.** The `@deepseek-ai/dsh-*` scope; `deepseek-official`/`deepseek-flash` as the default route; `session-log-deepseek` in `dsh-base` uploads a session-log suffix to the official DeepSeek API by default; `plugin-package-inventory-deepseek` sends the active plugin list; telemetry defaults to `FEEDBACK_ONLY` exporting to `harness-telemetry.deepseeksvc.com` after explicit feedback; the anonymous id header is sent to DeepSeek gateways; `ui-brand-official` branding; `web-search-deepseek`. A privacy-positioned personal assistant must review and flip these defaults.
5. **Computer and browser control are experimental only**, with upstream-pinned schemas and no stability promise.
6. **Weak permission UX.** One-shot approvals without arguments, no remembered rules, and no MCP gating.
7. **MCP supply-chain exposure.** No schema pinning, no OAuth, no annotation use, and stdio MCP servers are not confined by the sandbox seam (not verified).
8. **Windows and macOS parity gaps.** Windows sandbox enforcement is partial; bash is disabled on Windows in favor of pwsh; Seatbelt relies on deprecated `sandbox-exec`; the desktop Linux directory picker falls back without zenity or kdialog; release signing requires production infrastructure.
9. **No personal-assistant layer.** No memory, desktop context, voice, tray or hotkey, or ambient triggers; schedule only fires into live sessions.
10. **Process-local runtime assumptions.** Jobs, subagent residency, Agent Teams mailboxes, webhooks, and the SQLite index assume one process, which complicates a resident daemon plus a UI process design. Import cycles exist in core (`packages/core/tools/src/index.ts` with `schema.ts`, `ptc.ts`, `testing.ts`; `packages/boot/app-boot/src/index.ts` with `profile.ts`; see `graphify-out/GRAPH_REPORT.md`, "Import Cycles").

### 3.5 Upstream relationship: adding features while keeping merges cheap

Observed state: `git remote -v` shows only `origin` (`HXMAN76/AIR-harness`); no `upstream` remote is configured, and recent merges come from `deepseek-harness/*` branches.

Recommendations:

1. Add an `upstream` remote for the deepseek-harness repository and keep `master` a clean mirror of it. Do product work on a long-lived `air/main` branch that merges `master` regularly (weekly), rather than rebasing, so conflict resolution happens in small increments.
2. **Build features as out-of-tree bundles, not in-tree edits.** Put new packages in a separate top-level directory (for example `air/packages/*`) or a separate repository, each publishing `dsh.bundle` and installed into an `air` profile. The composition model is designed for this: a patch layer can insert rows and override any row by id without editing upstream files.
3. **Own a product profile and a product bundle** (for example `@air/dsh-air-bundle`) that disables DeepSeek-specific rows (`session-log-deepseek`, `plugin-package-inventory-deepseek`, telemetry), sets default models, and mounts AIR plugins. This keeps coupling fixes in one YAML file rather than as edits to `packages/bundle/base/cordis.patch.yml`.
4. **Reserve core edits for genuine seam gaps** (for example an MCP pinning hook point or a rules-based approval provider) and write them as upstreamable pull requests in upstream style: bilingual docs, tests, invariants. Upstreaming removes them from the fork's merge surface.
5. Keep the Electron shell changes in `apps/desktop` minimal and isolated in new files (tray, hotkey, voice window), because `apps/desktop` also carries release-signing and updater logic that upstream changes often.
6. Pin to upstream release tags (`dsh-v*`) for the university deliverable, so the demo is not destabilized by mid-cycle refactors, and treat Session format bumps upstream as merge checkpoints.
7. Decide deliberately whether the fork keeps the repository's gates (bilingual docs, 100% coverage) for its own packages. Recommendation: keep coverage and README templates for AIR packages, but drop the Chinese-pairing requirement for out-of-tree packages, since the upstream gates will not scan them anyway.

## 4. Keep / Extend / Rethink / Build new

| Area | Verdict | Note |
|---|---|---|
| Cordis plugins, profiles, overlays, bundles | Keep | Core architectural asset; build AIR as bundles on top. |
| Plugin Manager install flow | Extend | Add catalog/marketplace index, versions, and permission manifests. |
| Skills (SKILL.md, progressive disclosure) | Keep / Extend | Add `.claude/skills`, `allowed-tools`, resource enumeration. |
| Agent instructions (AGENTS.md/CLAUDE.md) | Keep | Add `@path` imports. |
| Subagents | Keep | Add Markdown agent definitions (`.claude/agents/*.md` mapper). |
| Agent Teams (experimental) | Defer | Useful later; worktree isolation missing. |
| Hooks bridges | Extend | Native hook format and missing events. |
| MCP client and resources | Keep / Fix | Schema pinning, approval gating, OAuth, `.mcp.json` import. |
| Sandbox | Keep | Add network policy; keychain for secrets. |
| Approval and permission presets | Rethink | Rule store, allow-always, argument-aware prompts. |
| Session log, persistence, query | Keep | Substrate for episodic memory. |
| Compaction | Keep | Works by default. |
| time-context / tmux-context | Keep | Templates for desktop context. |
| Workflow / Ralph | Extend later | Saved routines, background runs. |
| Jobs, goal, plan, todo, guard | Keep | Mature and small. |
| Schedule | Extend | Wake cold sessions, OS notifications, cron rules. |
| Webhook | Extend | Generic ambient trigger bus. |
| Runtime extensions (tool-cordis, runners) | Keep | Differentiator; gate behind approval. |
| Browser-use / computer-use | Rethink / Promote | Pick one backend per OS, harden, and make first-class. |
| Web search/fetch | Extend | Add a self-hostable search provider. |
| LLM adapters | Keep | Make local (Ollama) and Anthropic/OpenAI first-class in onboarding. |
| Credentials, settings, identity, telemetry | Extend / Review | Keychain provider; disable DeepSeek-bound uploads by default in the AIR profile. |
| Web GUI and Desktop shell | Keep / Extend | Add tray, hotkey, quick-entry overlay, notifications. |
| Terminal UI | Build new (optional) | None in the repository. |
| SDK, Python SDK, ACP | Keep | Good for evaluation and editor integration. |
| Long-term memory | Build new | First-party memory seam, not only third-party MCP. |
| Desktop context (clipboard, active window, system state) | Build new | `context/desktop-*` plugins. |
| Voice (STT, TTS, wake word) | Build new | Desktop renderer capture plus provider seams. |
| OS device control tools | Build new | Approval-gated, per-platform. |
| Proactive/ambient trigger daemon | Build new | Resident process that survives closing the window. |
| Markdown agents/commands, `.mcp.json` import | Build new | One compatibility bundle mapping file conventions to existing seams. |
