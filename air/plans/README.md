# AIR development roadmap

Date: 2026-09-30. Upstream base: `dsh-v0.2.0-rc.2`. Product name: placeholder ("AIR", see [../BRANDING.md](../BRANDING.md)).

This page orders the work, names each plan, and lists what is still unplanned. The reasoning behind every choice is in [research/research.md](../../research/research.md); the exact APIs and verified commands are in the [spikes](spikes/).

## Principles that shape every plan

1. **Out of tree.** AIR code lives in the `air/` pnpm workspace as `@air/dsh-*` packages loaded by the `air` bundle. Upstream takes no pull requests, so every in-tree edit is carried forever and listed in [../UPSTREAM-DELTA.md](../UPSTREAM-DELTA.md). Known unavoidable edits: the translation-pairing exclusion (done), the MCP review hook (plan 02), and the CI workflow (plan 00).
2. **No custom session event types.** Out-of-tree plugins cannot write events older builds may skip, and an unknown type makes a session unresumable ([spike 03](spikes/03-mcp-trust.md) finding 1, [spike 04](spikes/04-memory-context-permissions.md)). Model-visible input enters as injected user messages with AIR source kinds (`air-memory-core`, `air-memory-recall`, `air-desktop-context`, `air-voice`, `air-command`, `air-instructions`); audit data goes to JSONL files under `$DSH_HOME/air/`.
3. **Files for behavior, plugins for capabilities.** Skills, agents, commands, rules, routines, and memory are Markdown files users can read and edit; capabilities are plugins behind Service Definition / Provider / Consumer seams.
4. **Deterministic security.** Pinning, capability scopes, approval, and sandboxing enforce; Markdown only advises.
5. **Local first.** Ollama is the default model route; every feature has an offline path; upstream-vendor uploads and telemetry are off in the `air` bundle.

## Plans

| # | Plan | Status | Depends on | Spec |
|---|---|---|---|---|
| 00 | [Workspace foundation](2026-09-30-00-workspace-foundation.md): toolchain, lint, smoke, CI | Written | Root build | [spike 01](spikes/01-toolchain.md) |
| 01 | [File conventions, slice 1](2026-09-30-01-file-conventions-slice1.md): AIR preset, skill roots, instructions, `.mcp.json`, commands | Written | 00 | [spike 02](spikes/02-file-conventions.md) |
| 02 | [MCP trust](2026-09-30-02-mcp-trust.md): review hook, lockfile, guard, `air-mcp` CLI profile | Written | 00 | [spike 03](spikes/03-mcp-trust.md) |
| 03 | [Permissions](2026-09-30-03-permissions.md): `Tool(pattern)` rule store, capability scopes, approval answerer with audit log, `/allow` and `/deny`, sudo guard | Written (Always-allow button and argument detail UI deferred to a follow-up plan) | 00, 01 through Task 2 (`toDshToolName`, `expandHome`, `isRecord`) | [spike 04](spikes/04-memory-context-permissions.md) §7 |
| 04 | [Memory core](2026-09-30-04-memory-core.md): Markdown store with git history, FTS5 + vector index, embedding seam, four memory tools, pinned core | Written (auto-recall, priors, extraction, consolidation deferred to follow-up plans) | 00; 01 Task 9 when wiring into `preset-air` | [spike 04](spikes/04-memory-context-permissions.md) §1–5 |
| 05 | [Evaluation pilot](2026-09-30-05-eval-pilot.md): eval bundle and uv project, session-log metrics, RQ1 five-server mini-corpus, token/latency table, LongMemEval 10-question smoke | Written (code run in a scratch copy: 40 tests pass) | 00; 02 for the shared digest golden file | [spike 06](spikes/06-evaluation.md) |
| 06 | AgentDojo banking pilot: MCP bridge, eval answerer plugin, native vs undefended harness | Not written (design and 4–5 day estimate in plan 05 "Follow-up plans") | 05 | [spike 06](spikes/06-evaluation.md) §1 |

## Cross-plan obligations

- **Plan 01 after plan 02:** every `mcp-client` child that plan 01 mounts from `.mcp.json` must declare `inject: [mcpToolReview]`, so imported servers cannot register tools unreviewed. Plan 02's bundle test checks only static patches; add the inject and a test in whichever plan lands second.
- **Plan 02 edits a plan 00 file:** its last task adds the `air/bundles/mcp-servers` bundle to `air/scripts/smoke-profile.sh`.
- **Plan 01 edits a plan 00 file:** it adds `yaml` to `air/package.json` devDependencies.
- **Plan 04 edits a plan 01 file:** its bundle task updates `air/scripts/tests/preset-air-drift.spec.ts` (expected AIR rows and row-package count).
- **Eval arm patches (plan 05) disable memory by row id:** host rows `air-memory-store`, `air-embedding`, `air-memory-index`; per-Agent rows `air-tool-memory`, `air-memory-context`. The `sdk-minimal` eval composition has no approval service, so a writing arm sets `confirmTypes: [feedback]`.
- **Plan 03 imports from plan 01:** the Claude-to-dsh tool-name table exported by `@air/dsh-convention-core`.
- **Plan 02 carried upstream changes:** the review hook in `packages/mcp/mcp-client` and the regenerated cordis catalog docs go into [../UPSTREAM-DELTA.md](../UPSTREAM-DELTA.md).
- **Plan sizes:** plans 01 and 02 are long (about 6,000 lines each) because every step carries full code. Execute them task by task with a fresh worker per task; the code in them has not been compiled, so the first failing step of each task is where assumptions get corrected.

## Phase-1 review cut

Target: a working, honest demo plus early numbers, not the finished system.

- **Must have:** plan 00; plan 01 slice 1 (fixes the stray-skills problem seen with the local model); plan 02 through the lockfile, review hook, and `pin`/`diff` commands; plan 05 (RQ1 mini-corpus, token/latency table, LongMemEval smoke).
- **Should have:** plan 04 memory core (explicit writes, `memory_search`, pinned core; no auto-recall yet); plan 06 (AgentDojo banking, labelled "no AIR defences").
- **Demo script:** launch the desktop app with the `air` profile on the local model; show a Claude Code skill and a `.mcp.json` server working unchanged; pin that server, mutate its tool description, show the server quarantined and the diff; remember a fact and recall it in a new session; show the pilot tables.

## Unplanned work, in intended order

Each item gets its own plan after the plans above land. The spike section that already answers its API questions is linked.

1. **File conventions, later slices:** agents from `.claude/agents/*.md` (one `agent` tool with `subagent_type`), permission-rule import, hooks with the full Claude Code event set, Claude and Agent Plugins manifests ([spike 02](spikes/02-file-conventions.md)).
2. **Memory tiers 2 and 3:** end-of-session extraction with quarantine, nightly consolidation, Web memory panel, poisoning red-team tests ([spike 04](spikes/04-memory-context-permissions.md) §5, [research note 05](../../research/notes/05-memory-context.md) §2.5, §2.8).
3. **Desktop context:** tier-0 system state through `busctl`/`wl-paste`, tier-1 focus through an AIR GNOME Shell extension exporting `org.air.Desktop1`, redaction ([spike 04](spikes/04-memory-context-permissions.md) §6).
4. **Voice:** `@air/dsh-speech-stream`, sherpa Parakeet with VAD, Kokoro text-to-speech, the `air-voice` source kind, hands-free client ([spike 05](spikes/05-voice-os-triggers-shell.md)). First confirm the Web view accepts an unknown user source kind.
5. **OS control:** read/set/verify capabilities with risk tiers over `wpctl` and `busctl`, brightness through logind plus `/sys/class/backlight` ([spike 05](spikes/05-voice-os-triggers-shell.md)).
6. **Signals, triggers, routines:** local signals through `ctx.webhookRuntime.dispatch`, Markdown routines on `ctx.schedule.create`; add the webhook row to the `air` bundle ([spike 05](spikes/05-voice-os-triggers-shell.md)).
7. **Secret handoff:** `privileged_run` through `pkexec` or `sudo -A` with a password dialog on the Host; the plain-`sudo` guard ships in plan 03 ([spike 05](spikes/05-voice-os-triggers-shell.md)).
8. **Desktop app on every OS (required by the owner):** an AIR-owned Electron shell in `air/apps/desktop` plus an AIR Host entry, rpm and AppImage on Linux first, then macOS and Windows; packaging spike first ([research note 09](../../research/notes/09-desktop-cross-os.md), which supersedes spike 05's desktop section: upstream's dev launcher does not run on Linux).
9. **Full evaluation:** AgentDojo v1.2.2 full runs on `deepseek-flash`, MCPTox and MSB attack sets, the 40-server drift corpus, LongMemEval 100-question study with the GPT-4o judge and MemOS arm, statistics ([spike 06](spikes/06-evaluation.md) E-tasks).
10. **Branding:** brand plugin with `{{PRODUCT_NAME}}` placeholders, `en-x-air` locale variant for brand strings, `air` launcher, page title ([../BRANDING.md](../BRANDING.md)); after the name is final.

## Cross-cutting work not yet covered by any plan

- **First-run experience:** check Ollama is running, pull `qwen3:8b` and `nomic-embed-text` with consent, write the profile patch; today this is the manual README procedure.
- **Local-model quality:** tool-calling reliability of 7–8B models (fake tool calls, derailing on long catalogs); decide whether to port AIR's fake-tool-call guard ([research note 02](../../research/notes/02-air-extraction.md) §2.8) after measuring in the pilot.
- **Safety documentation:** an AIR `SAFETY.md` with the threat model, what the sandbox does not cover (network, MCP children), and the privacy statement for local data.
- **Data lifecycle:** session retention and deletion, memory export, backup of `$DSH_HOME/air/`.
- **Release path:** how users install AIR (clone plus scripts now; npm packages for the `@air/*` bundle later), version pinning to upstream tags, release notes.
- **Upstream sync routine:** a script wrapping fetch, fast-forward `master`, merge into `air/main`, install, clean, build, `graphify update`, smoke, and a reminder to read `docs/upgrade-guide/`.
- **Fork CI hygiene:** decide which inherited upstream workflows to disable in the fork (they need upstream secrets and runners).

## Owner decisions (2026-10-02)

| Topic | Decision | Effect on the plans |
|---|---|---|
| Product name | On hold | Branding stays placeholder-only ([../BRANDING.md](../BRANDING.md)); no brand plugin or carried rename edits yet. |
| Rubric and deadlines | To be supplied by the owner | The research roadmap keeps its April–May 2027 assumption until then. |
| Delivery form | A desktop app on Windows and Linux (Fedora first); macOS dropped because a usable release needs a paid Apple Developer ID | Upstream does not release its Electron app for Linux and its tray is Windows-only. An AIR-owned Electron shell is the recommended route ([research note 09](../../research/notes/09-desktop-cross-os.md)). Targets: Windows NSIS installer, Fedora rpm; AppImage if it comes cheaply from the same build; deb only if needed later. The phase-1 demo runs in the desktop app on Fedora. |
| Close button on GNOME | Follow the platform convention | GNOME has no tray by default, and its convention is that closing the last window quits the app. Default: close quits. Opt-in setting "Keep running in the background" uses the XDG Background portal, so the app appears in GNOME's Background Apps list where the user can stop it; with that setting on, close hides the window and the global hotkey or launcher reopens it. On Windows, close hides to the tray (upstream's behaviour). |
| Models for product and research | Use this laptop for local inference where possible (Ryzen AI 9 HX 370, 30 GiB RAM, RTX 4060 Laptop 8 GiB, Ollama 0.32.7) | Model shortlist, runtime settings, and evaluation time estimates come from [research note 10](../../research/notes/10-local-models-rig.md); hosted runs only where local runs are infeasible. The owner pulls the candidate models listed in [../ONBOARDING.md](../ONBOARDING.md) section 7; Ollama context settings may be changed for testing. |
| Permission defaults | Use what upstream already offers (permission presets, Auto review, access modes) for now | Plan 03's ask-by-default behaviour is not the product default. [Research note 11](../../research/notes/11-upstream-permission-modes.md) lists upstream's modes and which parts of plan 03 are deferred, kept, or opt-in. |
| Team | Push `air/main` so teammates can work from it; keep all context in the repository | [../AGENTS.md](../AGENTS.md) for agents, [../ONBOARDING.md](../ONBOARDING.md) for people, `.claude/rules/air.md` as the pointer Claude Code loads automatically. |
| Team size and tracking | The owner plus four teammates; GitHub Issues and a project board come later, after the plan is settled with the team | Until then the roadmap table and the plan checkboxes are the progress record. |
| Development OS | Teammates develop on native Windows without WSL | Upstream supports native Windows development ([docs/development.md](../../docs/development.md), section "Windows and WSL 2"); WSL is optional. AIR scripts must not assume bash: the profile smoke script in plan 00 needs a PowerShell or Node equivalent before Windows teammates run it. |
| Installer contents | Do what upstream does | Bundle the full dependency tree in the app and ship the standalone Node, pnpm, and Python-with-Office runtime as a payload installed offline on first use ([research note 09](../../research/notes/09-desktop-cross-os.md) section 1). |
| Code signing | Sign where it is legal and feasible | Windows: apply to SignPath Foundation (free for open-source projects) or buy an individual code-signing certificate; unsigned builds remain the fallback. macOS is out of scope. |
| Local and cloud models | Research focus is the local harness; also study local and cloud together | [Research note 12](../../research/notes/12-hybrid-local-cloud.md) covers hybrid routing designs and how to make local, cloud, and hybrid an experimental factor. The owner has hosted-model API keys. |
| Sequencing | No implementation yet; research in depth first | Plans 00–05 stay unexecuted until the owner starts the build. |

## Changes the 2026-10-02 research requires in the written plans

Apply these when the build starts; the plan files are unchanged for now.

- **Plan 03 (permissions):** remove ask-by-default for `shell.execute` and `fs.write`; keep the `sudo` guard and MCP default-ask; aim rules, `/allow`, `/deny`, and the audit file at MCP tools and sandbox escalation prompts; add a listener-order test with Auto review loaded ([research note 11](../../research/notes/11-upstream-permission-modes.md)).
- **`air` bundle:** optionally pin the default preset to Workspace Write so an ambient `DSH_PERMISSION_MODE` cannot start sessions in Full access; add a startup check that the loaded Ollama context is large enough ([research note 10](../../research/notes/10-local-models-rig.md): the default 4,096-token context silently truncates the harness prompt).
- **Plan 05 (evaluation pilot):** use the measured local timings and the local/hosted split from research note 10; record the full runtime configuration with every result.
- **New plan needed:** the desktop shell (item 8 below).

## Open decisions for the project owner

1. Department rubric and deadlines (owner will supply).
2. Desktop shell: approve the AIR-owned Electron shell ([research note 09](../../research/notes/09-desktop-cross-os.md) option b) or choose patching upstream's app in place. Upstream publishes no desktop installers on GitHub and its release workflows publish npm packages only; its installers are built with local scripts that require the vendor's signing hardware and upload to the vendor's servers, so there is no release pipeline for a fork to reuse.
3. Lanes for the four teammates (suggested: runtime and security, memory and context, desktop and voice, evaluation).
