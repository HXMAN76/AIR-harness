# AIR development roadmap

Date: 2026-09-30. Upstream base: `dsh-v0.2.1-alpha.1` (plans were written against `dsh-v0.2.0-rc.2`; see "Changes the 2026-10-08 upstream sync requires"). Product name: placeholder ("AIR", see [../BRANDING.md](../BRANDING.md)).

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
| 06 | [AgentDojo banking pilot](2026-10-03-06-agentdojo-pilot.md): native AgentDojo pipeline vs the undefended harness, MCP bridge, eval-only approval answerer, route as a parameter, off-device token count | Written (code run in a scratch copy on the local route: 52 tests pass, both arms ran on 5 episodes each; hosted route not run) | 00; 05 Tasks 1–4 | [spike 06](spikes/06-evaluation.md) §1 |
| 07 | [Desktop shell](2026-10-03-07-desktop-shell.md): AIR-owned Electron app for Windows and Linux (staging script, Host entry, main process, close/tray policy, hotkey, packaging, updates, CI) | Written (plan code typechecked and 111 unit tests run in a scratch copy; staging and Host boot verified on Fedora; Windows and packaging not run) | 00 | [research note 09](../../research/notes/09-desktop-cross-os.md), [research note 13](../../research/notes/13-desktop-shell-practice.md) |

## Cross-plan obligations

- **Plan 02 turns on review for imported servers:** plan 01's `air-mcp-conventions` row has a `reviewTools` Config field (default false) that adds `inject: [mcpToolReview]` to every `mcp-client` child mounted from `.mcp.json`. Plan 02's bundle task sets it to true; plan 01 does not depend on plan 02.
- **Order between plans 01 and 02:** plan 02's bundle test asserts `reviewTools: true` on plan 01's row, so plan 01 Task 9 lands first.
- **Servers imported from `.mcp.json` and the `air-mcp` command profile:** the command profile cannot see servers that plan 01 imports per project; they are approved through the in-session prompt. A shared server list and a slash command are plan 02 follow-ups.
- **Plan 07 and MCP trust:** the desktop app should show each server's trust state (`ctx.mcpTrust.servers()`), and a packaged app needs its own value for plan 02's `cliCommand` Config field (the bundle default is the developer form `pnpm dsh --profile air-mcp`).
- **Plan 02 edits a plan 00 file:** its last task adds the `air/bundles/mcp-servers` bundle to the profile smoke, which is now `air/scripts/smoke-profile.ts`.
- **Plan 01 edits a plan 00 file:** it adds `yaml` to `air/package.json` devDependencies.
- **Plan 04 edits plan 00 and plan 01 files:** `air/package.json` gains scripts `memory:transfer` and `web:isolated`; plan 01's `air/scripts/tests/preset-air-drift.spec.ts` and `check-air-composition.ts` gain the memory rows. Plan 04's bundle task assumes plan 01 Task 9 has landed.
- **Memory and model routes:** the `air-memory-store` row's `shareWith` Config field defaults to `['ollama']`, so the pinned core and memory tool results go only to the local route; an evaluation arm on another provider must add it. A session that starts local and later switches to a cloud route keeps the core already in its log.
- **Memory and approvals:** memory writes ask only when the session's approval policy can ask; under Full access a non-feedback write is stored as agent-inferred and feedback writes and hard deletes are refused.
- **Eval arm patches (plan 05) disable memory by row id:** host rows `air-memory-store`, `air-embedding`, `air-memory-index`; per-Agent rows `air-tool-memory`, `air-memory-context`. The `sdk-minimal` eval composition has no approval service, so a writing arm sets `confirmTypes: [feedback]`.
- **Plan 07 edits plan 00 files:** it adds `apps/*` to `air/pnpm-workspace.yaml` and entries to `air/.gitignore` (edits, not replacements). Plan 00's lint already covers `apps`, and its CI builds and tests only `packages/*` and `bundles/*`. Once `apps/*` is a workspace member, plan 00's CI install must use `pnpm -C air install --frozen-lockfile --ignore-scripts`, or it downloads Electron on every run.
- **Plan 07 packaging finding:** `pnpm deploy --prod` of the CLI package leaves out the workspace packages that are only peers (28 at `dsh-v0.2.1-alpha.1`; the staging script computes the list) and copies them in (research note 13 section 2). Windows staging is untested and is the first gate of plan 07.
- **Plans 05 and 06 on Windows:** both use only shell-neutral commands. The Python SDK starts the runtime without a shell, so Windows needs a `.cmd` launcher shim (written, untested). The RQ1 collector is Linux-only (it sandboxes servers with bubblewrap); Windows teammates replay snapshots collected on Linux.
- **Evaluation and permission rules:** the undefended arm must not load `air-permission-rules`; plan 06's runner refuses to run if it does. Later defended arms opt in explicitly, and an arm under approval policy `never` is labelled ungated, because plan 03 turns the default MCP ask into an allow there.
- **Plans 05 and 06 stay separate files** with a shared-module list and one task order written in each.
- **Plan 06 leaves one Ollama model behind:** `air-eval-qwen25` (qwen2.5:7b-instruct, temperature 0, seed 7, 16k context), the model plan 05 Task 4 also creates; remove with `ollama rm air-eval-qwen25`.
- **Peer ranges:** the loader checks ranges with prerelease versions included, so `^0.2.0-rc.1` accepts `0.2.1-alpha.1` (verified with the loader's own options); plain semver tools report a mismatch, so plan 03 writes `^0.2.0-rc.1 || ^0.2.1-alpha.1`. Use that form in all plans for clarity.
- **Plans 02 and 03 prompt order:** plan 03's MCP ask can appear before plan 02's trust guard denies an unapproved server; a per-server trust level that skips the per-call ask is a plan 03 follow-up.
- **Plan 03 imports from plan 01:** the Claude-to-dsh tool-name table exported by `@air/dsh-convention-core`.
- **Plan 02 carried upstream changes:** the review hook in `packages/mcp/mcp-client` and the regenerated cordis catalog docs go into [../UPSTREAM-DELTA.md](../UPSTREAM-DELTA.md).
- **From executing plan 01 to plan 02:** the MCP approval key now includes the working directory, `/mcp` shows unexpanded env and header text, and a mount with `reviewTools: true` fails at once when the reviewer service is absent (the fiber-state constant is pinned by a test). Plan 02's lockfile and review hook must use the same key inputs and load the reviewer before the convention plugin mounts servers; it should also decide how to keep expanded commands out of upstream's MCP client log lines. Plan 01's "Review and fix round" section lists everything that changed after the plan text was written.
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
9. **Full evaluation** (plan 06's "Follow-up plans" table lists the arms: MCP trust, permission rules, the RQ7 local-versus-cloud route study, qwen3 thinking as a covariate, the 949-pair study, the adaptive attacker): AgentDojo v1.2.2 full runs on `deepseek-flash`, MCPTox and MSB attack sets, the 40-server drift corpus, LongMemEval 100-question study with the GPT-4o judge and MemOS arm, statistics ([spike 06](spikes/06-evaluation.md) E-tasks).
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
| Close button on GNOME | Follow the platform convention | GNOME has no tray by default, and its convention is that closing the last window quits the app. Default: close quits. Opt-in setting "Keep running in the background": close hides the window; the app sends the XDG Background portal request, shows a notification, and is reopened from the app grid or the global hotkey; Quit is in the menu. GNOME's Background Apps list is expected to show only sandboxed (Flatpak) apps, so the rpm build will probably not appear there ([research note 13](../../research/notes/13-desktop-shell-practice.md)). On Windows, close hides to the tray. |
| Models for product and research | Use this laptop for local inference where possible (Ryzen AI 9 HX 370, 30 GiB RAM, RTX 4060 Laptop 8 GiB, Ollama 0.32.7) | Model shortlist, runtime settings, and evaluation time estimates come from [research note 10](../../research/notes/10-local-models-rig.md); hosted runs only where local runs are infeasible. The owner pulls the candidate models listed in [../ONBOARDING.md](../ONBOARDING.md) section 7; Ollama context settings may be changed for testing. |
| Permission defaults | Use what upstream already offers (permission presets, Auto review, access modes) for now | Plan 03's ask-by-default behaviour is not the product default. [Research note 11](../../research/notes/11-upstream-permission-modes.md) lists upstream's modes and which parts of plan 03 are deferred, kept, or opt-in. |
| Team | Push `air/main` so teammates can work from it; keep all context in the repository | [../AGENTS.md](../AGENTS.md) for agents, [../ONBOARDING.md](../ONBOARDING.md) for people, `.claude/rules/air.md` as the pointer Claude Code loads automatically. |
| Team size and tracking | The owner plus four teammates; GitHub Issues and a project board come later, after the plan is settled with the team | Until then the roadmap table and the plan checkboxes are the progress record. |
| Development OS | Teammates develop on native Windows without WSL | Upstream supports native Windows development ([docs/development.md](../../docs/development.md), section "Windows and WSL 2"); WSL is optional. AIR scripts must not assume bash: the profile smoke script in plan 00 needs a PowerShell or Node equivalent before Windows teammates run it. |
| Installer contents | Do what upstream does | Bundle the full dependency tree in the app and ship the standalone Node, pnpm, and Python-with-Office runtime as a payload installed offline on first use ([research note 09](../../research/notes/09-desktop-cross-os.md) section 1). |
| Code signing | Sign where it is legal and feasible | Windows: apply to SignPath Foundation (free for open-source projects) or buy an individual code-signing certificate; unsigned builds remain the fallback. macOS is out of scope. |
| Local and cloud models | Research focus is the local harness; also study local and cloud together | [Research note 12](../../research/notes/12-hybrid-local-cloud.md) covers hybrid routing designs and how to make local, cloud, and hybrid an experimental factor. The owner has hosted-model API keys. |
| Desktop identifiers | On hold until the product name is final | Plan 07 keeps app id, URL scheme, `desktopName`, and release tag format as placeholders read from the brand file; no release is published under provisional identifiers, because changing them later resets user data and the hotkey consent. |
| Desktop updates on Fedora | rpm builds notify with a download link; Windows and AppImage update automatically | As written in plan 07. |
| Phase-1 installer contents | Partial parity with upstream is accepted | Full dependency tree in the app; the Node/pnpm/Python runtime payload behind an opt-in flag; Office skills and the LibreOffice engine are a follow-up. |
| Windows signing order | First release unsigned, then apply to SignPath Foundation | SignPath requires a published release and names SignPath Foundation as publisher. |
| Desktop release gate | No release until identifiers are final | Plan 07's brand file carries `identifiersFinal: false`; packaging for release fails until the owner sets the final identifiers and flips it. Start at login moved out of phase 1. |
| Sequencing | No implementation yet; research in depth first | Plans 00–05 stay unexecuted until the owner starts the build. |

## Changes the 2026-10-02 research requires in the written plans

Apply these when the build starts; the plan files are unchanged for now.

- **Plan 03 (permissions):** done in the 2026-10-08 revision. Before: remove ask-by-default for `shell.execute` and `fs.write`; keep the `sudo` guard and MCP default-ask; aim rules, `/allow`, `/deny`, and the audit file at MCP tools and sandbox escalation prompts; add a listener-order test with Auto review loaded ([research note 11](../../research/notes/11-upstream-permission-modes.md)).
- **`air` bundle:** optionally pin the default preset to Workspace Write so an ambient `DSH_PERMISSION_MODE` cannot start sessions in Full access; add a startup check that the loaded Ollama context is large enough ([research note 10](../../research/notes/10-local-models-rig.md): the default 4,096-token context silently truncates the harness prompt).
- **Plan 05 (evaluation pilot):** use the measured local timings and the local/hosted split from research note 10; record the full runtime configuration with every result.
- **New plan needed:** the desktop shell (item 8 below).

## Plan revision status (2026-10-08 review)

| Plan | Revised for `0.2.1-alpha.1`, Windows teammates, and owner decisions |
|---|---|
| 00 | Done, and **executed on 2026-10-09** on branch `air/feat/00-workspace-foundation` (Fedora only; the plan file's execution record lists four deviations; native Windows and the GitHub workflow not yet run) |
| 01 | Done, and **executed on 2026-10-09** on branch `air/feat/01-file-conventions` (Fedora only): five packages, then a security and quality review with a fix round; 298 tests, 100% package coverage, composition check and profile smoke pass; the plan file's execution record and review section list the changes. Native Windows and the manual Web UI checks not yet run |
| 02 | Done (lockfile module run in a scratch copy with five concurrent writers; the rest read, not compiled; Windows untested): upstream lines re-verified, first-use prompt saves the pin, every denial names the server, changed fields, and the exact command, an unreadable lockfile quarantines instead of only logging, Windows-safe steps |
| 03 | Done (222 tests run in a scratch copy on Linux, including the real Auto review plugin in both load orders; Windows paths untested): built-in tools allow by default, only MCP tools ask; every ask and denial explains itself; Windows elevation blocked; escalation answering opt-in |
| 04 | Done (142 tests at 100% coverage and benchmarks run in a scratch copy on Linux; Loader test, profile smoke, Ollama integration, and Windows not run): git optional, index and scan costs measured and reduced, Ollama failure causes reported to the user, writes ask only when the session can ask, memory shared only with local model routes by default, export and import command |
| 05, 06 | Done (re-run on Fedora at `0.2.1-alpha.1`: 54 keyless tests pass, composition check clean, one live test passes; native Windows untested): no bash-only steps, a Python composition check, a Windows launcher shim, a per-arm permission table, and a guard that stops the undefended arm from being gated |
| 07 | Done: dynamic port, release gate, per-line log redaction, 116 unit tests pass in a scratch copy |

## Parked feature candidates (research note 14)

From [research note 14](../../research/notes/14-feature-opportunities.md). The owner parked these on 2026-10-09: none is planned or scheduled, and none blocks the build. Revisit them after the phase-1 plans land.

- First-run setup that checks Ollama, pulls models with consent, and verifies the loaded context size (ranked first: the default 4,096-token context silently truncates the agent's prompt).
- "Why was this blocked" explanations on every denied tool call (folded into plan 03's revision).
- Privacy ledger: a local record of every model, web, and MCP request that left the machine.
- Read-only session replay viewer on upstream's experimental session inspector.
- Latency and token dashboard for local inference.
- Skill usage report derived from session logs.
- No-code wins from upstream: enable the voice-input bundle for dictation; reminder tools already ship in the presets; settings and first-run on upstream's config editor.

Note 14 also recommends cuts for a five-person team (reduce the phase-1 desktop work to Linux only, drop the permission rule store, merge plans 05 and 06, move the AgentDojo pilot out of phase 1). The Linux-only suggestion conflicts with the owner's Windows requirement and is not adopted; the others await the owner (open decision 4).

## Changes the 2026-10-08 upstream sync requires in the written plans

All of these were applied to the plan files in the 2026-10-08 revision (see "Plan revision status"); the list is kept as a record. Detail is in [research.md](../../research/research.md) section 2b.

- **Plan 01:** done in the 2026-10-08 revision. Before: its `preset-air` row list was generated from the old `standard.patch.yml`. The standard preset now also declares `time-context` and the `schedule/tool-schedule` row; regenerate the list (the plan's drift test detects this) and decide whether AIR's preset keeps the reminder tools. Before writing AIR's hook plugin in a later slice, evaluate upstream's new experimental Claude Code mods bridge.
- **Plan 04:** done in the 2026-10-08 revision. Before: `time-context` is a preset row now; the memory-context row sits beside it in `preset-air`, and wording that calls it a top-level row is outdated.
- **Plans 05 and 06:** done in the 2026-10-08 revision (the eval composition's tool list is unchanged). Before: `sdk-minimal` no longer has the five invariant rows, and Schedule tools exist in non-minimal presets; re-check the eval bundle's disabled-row list and the expected model-visible tool list. The experimental session inspector can help debug episodes.
- **Plan 07:** done in the 2026-10-08 revision (dynamic port, origin handling, release gate, start-at-login moved to follow-ups).
- **All plans:** version strings and line references cite `0.2.0-rc.2`; re-verify line numbers at the first step of each task. Peer range `^0.2.0-rc.1` still matches `0.2.1-alpha.1`.
- **Spikes 01, 03, 05:** mentions of the schedule bundle as a template refer to a package that no longer exists; use `packages/experimental/voice-input-bundle` or `auto-review` as the bundle template.

## Open decisions for the project owner

1. Department rubric and deadlines (owner will supply).
2. Lanes for the four teammates (suggested: runtime and security, memory and context, desktop and voice, evaluation).
3. Final product name; it unblocks branding and the desktop identifiers.
4. Scope cuts from research note 14: drop the permission rule store, merge plans 05 and 06, move the AgentDojo pilot out of phase 1.
5. When to start the build (plan 00 first).
