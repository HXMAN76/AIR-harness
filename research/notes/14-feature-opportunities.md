# Feature opportunities, competitor movement, and scope cuts

Date: 2026-10-08. Upstream base: `dsh-v0.2.1-alpha.1`. Status: research only; nothing here changes a plan until the owner decides.

This note answers five questions: what the newest upstream additions make possible that the roadmap ignores, what comparable products shipped in August to October 2026, which new features are worth proposing, what to cut for a five-person final-year team, and a ranked list with a do-not-build list.

**Evidence labels.** *Verified-today* means read from a file in this checkout or fetched from a cited page on 2026-10-08. *Recalled* means from earlier knowledge or a search snippet that I did not open; treat as unconfirmed. Effort sizes (S under 1 week of one person, M 1 to 3 weeks, L over 3 weeks) are estimates, not measurements. Where a competitor was not checked, the text says so.

## 1. What upstream's newest additions make possible

Sources for this section are the package READMEs and docs in this checkout (verified-today, read as summaries only; I did not run any of these packages). The roadmap already uses: the speech-to-text seam (voice item), Schedule (routines item), and `config-editor` only as a possible settings backend.

### 1.1 Claude Code mods bridge (`packages/experimental/claude-code-mods`)

*Verified-today:* `docs/subsystems/claude-code-mods.md` states that a mod is a plugin (`defineMod({ name, version, root, userConfig, register })`), that hooks can guard tool calls, rewrite prompts, add commands and tools, and draw a band above the prompt, and that the page was written against Claude Code 2.1.287 and the mods reference at https://code.claude.com/docs/en/plugins/mods/reference. It also says mods run in-process with the host's full authority and no sandbox, and that `plugin.json` and `hooks.json` are not read.

**Opportunity.** Plan 01's later slice wants a hook engine with the full Claude Code event set. The bridge already covers a subset of events, so AIR can adopt it instead of writing its own hook plugin, and gain a plugin format that also runs under `claude --plugin-dir`. The same bridge can host AIR's smaller policy hooks (the sudo guard, a "why blocked" explainer) as mods rather than bespoke plugins. It also gives the project a cheap RQ4 data point: a capability added with zero harness change.
**Effort:** S to evaluate, M to adopt for two or three AIR hooks. **Risk:** alpha status; in-process authority means a third-party mod is arbitrary code, which is the opposite of AIR's pinning claim. AIR must treat mods as trusted-code plugins and say so in `SAFETY.md`. Do not promise to load arbitrary marketplace mods.

### 1.2 Session inspector and inspector-profile

*Verified-today:* the READMEs describe a virtualized raw session-log table and a chat group/node view reachable from the Sidebar, plus an embedded Node inspector, shipped as an optional bundle that is off by default.

**Opportunity.** It is a ready-made reader for the session log, which is the evidence base of RQ1 to RQ3 and RQ5. Use it for debugging episodes now, and as the starting point for a user-facing "what did the model see" view (section 3, item C3). **Effort:** S to enable in the `air` profile for developers. **Risk:** experimental UI that will churn; do not build a product feature as a fork of it until it settles.

### 1.3 Schedule in the Web composition and reminder tools

*Verified-today (roadmap, research.md 2b):* `schedule` and `ui-schedule` are mounted by the Web app, and the `standard`, `cordis` and `ptc` presets declare four `schedule_*` tools; reminders are denied to delegated children; cold sessions are restored when a reminder is due.

**Opportunity.** "Remind me", "check this every morning", and recurring summaries need no new package. The Markdown-routine idea (unplanned item 6) can be a thin layer: a routine file compiles to `schedule_*` calls. **Effort:** S to keep the tools in `preset-air`; M for routine files. **Risk:** unattended runs under the default permission preset. A scheduled run that hits an approval has no one to answer; define the policy (deny, or queue until the user returns) before shipping.

### 1.4 `--public-url` and trusted hosts

*Verified-today:* `docs/user/guide/public-deployments.md` says `--public-url` only advertises the address and grants no trust; browsers must also be named with `--trusted-host`; TLS must end at a proxy; the printed URL carries a process credential; the listening port itself is not protected.

**Opportunity.** A phone companion without writing a mobile app: run the Web profile on the laptop and reach it over a LAN or a tunnel the user controls. **Effort:** S for a documented recipe, M for a safe in-app toggle. **Risk:** high. The launch token is a bearer credential, the port is unprotected, and a mobile browser on cellular exposes the agent's shell tools. Ship as an advanced, documented recipe behind a tunnel with its own authentication, not as a one-click switch. Do not make it a phase-1 item.

### 1.5 Agent preset registry (`preset/agent-preset-registry`)

*Verified-today (research.md 2b):* declarative presets give tools, prompt sections, and skills per preset in Cordis YAML, with several compositions per process.

**Opportunity.** "Assistant", "Researcher", "Coder" modes as presets, each with a different tool surface and a different permission default. This also gives RQ2 a clean experimental factor: the same task under a narrow preset versus a wide one. **Effort:** S to M. **Risk:** low; presets are YAML, so the "files for behavior" principle holds only partly. Keep Markdown agent files (plan 01 later slice) as the user-facing layer and compile to presets.

### 1.6 Config editor (`packages/boot/config-editor`)

*Verified-today:* saves plugin configuration into the active profile patch, validates the whole candidate before touching disk, serializes with HMR, and refuses writes that a higher layer overrides.

**Opportunity.** The backend of AIR's settings page and first-run wizard: choose model, context size, permission preset, and memory on/off, with validation. **Effort:** S per settings group. **Risk:** low. Cross-check that the `air` bundle's patches are not "higher-layer overrides" that make a write silently refuse.

### 1.7 `tool-workspace-dependencies`

*Verified-today:* the `load_workspace_dependencies` tool returns absolute paths to a bundled Python, Node.js and pnpm payload, copied under the harness home on first use.

**Opportunity.** Matches the owner's decision to ship the runtime payload behind an opt-in flag. It gives local models a reliable interpreter for skills with scripts instead of discovering system Python (a common failure with small models). **Effort:** S once the payload exists (plan 07). **Risk:** installer size; already accepted as opt-in.

### 1.8 `voice-input-bundle`

*Verified-today:* composes a speech Service Definition, the local SenseVoice provider on CPU, an authenticated Remote, and a browser microphone control; off in shipped profiles.

**Opportunity.** Push-to-talk dictation into the prompt box is available now with no new code, enabling the `air` profile row. Hands-free and text-to-speech are the real work (unplanned item 4). **Effort:** S for dictation; L for hands-free with TTS. **Risk:** browser microphone permission inside Electron on Linux; test early.

### 1.9 Auto review

*Verified-today:* the current agent's model assesses each native or PTC inner tool call before it runs with Full access; a denial asks the user; shipped switched off.

**Opportunity.** A deployable middle ground between asking every time and bypassing. With a local 7 to 8B model as the reviewer, its quality is an open research question and a good RQ2/RQ7 arm (local reviewer versus hosted reviewer). **Effort:** S to enable; M to measure. **Risk:** a weak local reviewer approving unsafe calls; it also runs without a file sandbox, per note 11. Keep it off by default.

### 1.10 Agent team (`agent-team`, `tool-agent-team`)

*Verified-today:* a Lead agent creates named teammates, exchanges durable messages, and tracks a shared task board; nine tools; survives crashes and reloads.

**Opportunity.** Mostly a coding-workflow feature. For a personal assistant on an 8 GB GPU, several concurrent model sessions are slow. **Effort:** S to enable. **Risk:** wasted effort; not recommended for AIR's core story.

### 1.11 Webworker runtime and `ptc-runtime-python`

*Verified-today:* the webworker runtime runs the whole plugin tree in a browser worker for preview deployments; `ptc-runtime-python` runs model-written Python in a fresh CPython 3.10+ subprocess with resource budgets and process-group teardown.

**Opportunity.** PTC (programmatic tool calling) lets a model do multi-step work in one code block, which cuts round trips and tokens, directly relevant to RQ5 and to small local models with long tool catalogs. Webworker has no clear AIR use. **Effort:** M to evaluate PTC with a local model. **Risk:** small models often write worse code than they call tools; measure before adopting. Skip webworker.

### 1.12 Browser-use and computer-use experimental backends

*Verified-today:* a Stagehand-native browser backend (separately configured inference model), Playwright MCP and Chrome DevTools MCP variants, and a Cua Driver native computer-use backend with durable screenshots, requiring the launching host's desktop permissions.

**Opportunity.** Screen and browser control without writing a driver; Cua Driver's platform coverage was not checked, so Linux/Wayland support is unknown. **Effort:** M to evaluate per backend. **Risk:** large; these need image-capable models, which a small local model is not, and desktop permission prompts differ per OS. Phase 2 at the earliest; the vision item in section 3 depends on this.

### 1.13 Subagent backends (Claude Code, Codex, ACP)

*Verified-today:* the `packages/subagent` tree contains `subagent-claude-code`, `subagent-codex`, `subagent-acp`, `subagent-dsh-sdk`, and fork/in-process drivers.

**Opportunity.** A local-first assistant could delegate heavy coding tasks to an installed Claude Code or Codex under the user's own account, behind an explicit consent card. That gives users cloud quality for hard tasks without AIR holding keys. It also feeds the RQ7 hybrid study (delegation as a routing mode). **Effort:** S to enable, M to wrap with an egress notice. **Risk:** delegated agents run with their own permissions, outside AIR's pinning; label as an escape hatch.

## 2. What comparable products shipped, August to October 2026

Method: one search per group plus fetches of Claude Code's weekly digest, Home Assistant's 2026.9 post, and Hermes Agent's release page. Coverage is uneven; gaps are named.

### Claude Code, Desktop, Cowork

*Verified-today* from https://code.claude.com/docs/en/whats-new.md (weeks 32 to 37, 2026-08-03 to 2026-09-11):

- `/skill-doctor` (week 36): shows each skill's context cost and how often it is used. See https://code.claude.com/docs/en/whats-new/2026-w36. This is the skill-telemetry feature AIR listed as a stretch; the competitor now ships it, and AIR's local session log can do the same offline.
- `claude plugin eval` (week 37): runs a plugin against test cases, scores results, and compares with a no-plugin baseline. Same idea as skill evals.
- Auto mode as the default permission mode for new sessions on paid plans from 2026-08-14 (week 32), and in week 36 the classifier blocks more cases (cloud metadata credential requests) and asks before the first read outside the working directories. The trend is classifier-gated autonomy, which upstream's Auto review mirrors.
- Cross-session messaging, `@` mention of another session, and device cards for `claude remote-control` on a phone (weeks 32 to 34): multi-session coordination and phone-initiated sessions are now expected.
- Resume terminal sessions in Desktop (week 35), pop-out panes (week 37), live `/diff` panel (week 36), in-app browser and an iOS simulator pane (weeks 28, 30), background computer use on macOS (week 36).
- `--restricted` mode for evaluation harnesses (week 35), `--safe-mode` (week 24), `PreModelSwitch` hook (week 36), `managedMcpServers` for organization-wide MCP lists (week 36), prompt-cache statistics in `/cost` (week 36).
- Claude Desktop on Linux in beta on Ubuntu and Debian (week 27, outside the window but relevant: Fedora and rpm are not named).
- Screen reader mode (week 29): a plain linear text interface.

### Codex and Cursor

*Recalled from a search snippet, not opened:* Codex moved into the ChatGPT desktop app on macOS and Windows on 2026-07-09 (https://www.scriptbyai.com/codex-timeline/); a snippet reported Cursor's acquisition by SpaceX completing on 2026-08-14. I did not verify either and found no feature-level detail for August to October. Do not cite these without checking.

### Goose

*Recalled from a search snippet:* Goose v1.36.0 (2026-05-28) and v1.43.0 (2026-07-14) added session search, scheduling, encrypted sharing, usage and cost tracking, and ACP reconnect after sleep (https://releasebot.io/updates/aaif-goose). Both predate the window; no August to October release was found.

### Hermes Agent

*Verified-today (page summary only):* v2026.9.7 (2026-09-07) lists desktop session controls, browser annotations, MCP authorization improvements, cron fixes, and delegation reliability (https://newreleases.io/project/github/NousResearch/hermes-agent/release/v2026.9.7). Full notes were said to ship in the next release.

### Home Assistant voice

*Verified-today:* release 2026.9 (2026-09-02) switched cloud speech-to-text to a new provider (Soniox), offered it through Labs with a no-logging statement, prefixed LLM tool names with the integration domain, and added audio tones for chart navigation by keyboard (https://home-assistant.io/blog/2026/09/02/release-20269). The accessibility item is a useful pattern; the cloud STT is the opposite of AIR's direction. *Recalled:* the local Whisper, Piper, Wyoming stack described at https://www.kunalganglani.com/blog/local-ai-voice-assistant-whisper-piper-ollama is the common pattern for a local voice loop.

### Not checked

Qoder, OpenCode, Jan, Open WebUI, Cherry Studio, and Claude Cowork produced no usable results for August to October in my searches. Treat any claim about them as unknown. Note 03 holds the earlier comparison.

### What users appear to value, and where AIR can do better locally

From the verified items: (1) less approval friction without losing safety (classifier modes); (2) seeing what a skill or plugin costs; (3) resuming and moving sessions across devices; (4) plugin quality measured against a baseline; (5) accessibility modes. A local product can do (2), (4) and a "what left the machine" view better because it owns the log and no remote service is needed. It cannot match cloud classifiers or large-model quality, so it should not compete on autonomy.

## 3. Candidate features

Scores are my estimates. Value and research fit: H/M/L. Fit with local-first and verifiable positioning: H/M/L. Effort: S/M/L (see the definition at the top). RQs: RQ1 surface integrity, RQ2 deterministic policy versus injection, RQ3 memory, RQ4 extensibility, RQ5 overhead, RQ6 usability, RQ7 local versus cloud.

| ID | Feature | User value | Research fit | Positioning fit | Effort | Depends on |
|---|---|---|---|---|---|---|
| C1 | MCP marketplace with pinned lockfile entries | M | H (RQ1) | H | M | Plan 02 |
| C2 | "Explain why blocked" permission UX | H | H (RQ6) | H | S to M | Plans 02, 03 |
| C3 | Session replay viewer on the inspector | M | H (RQ5, evidence) | H | M | Inspector, none of the plans |
| C4 | Skill trigger telemetry and evals | M | M (RQ4) | H | S to M | Plan 01 |
| C5 | Local RAG over user documents with citations | H | M (RQ3 adjacent) | H | L | Plan 04 embedding seam |
| C6 | Screenshot and vision context | M | L | M | L | Vision model; experimental backends |
| C7 | Clipboard and selection quick actions | H | L | H | M | Plan 07 hotkey |
| C8 | Phone companion over `--public-url` | M | L | M | M | Plan 07 |
| C9 | Multi-agent presets (Assistant, Researcher, Coder) | M | M (RQ2 factor) | H | S to M | Plan 01 |
| C10 | Claude Code mods as AIR's plugin format | M | M (RQ4) | M | S to M | Mods bridge |
| C11 | Offline-first onboarding that pulls models with consent | H | L | H | M | Config editor; plan 07 |
| C12 | Energy and latency dashboard for local inference | M | H (RQ5, RQ7) | H | S to M | Session log |
| C13 | Privacy ledger: what left the machine | H | H (RQ7) | H | M | Hybrid routing design (note 12) |
| C14 | Backup and export of memory and sessions | H | L | H | S | Plan 04 |
| C15 | Accessibility | M | L | M | S to M | Client UI |
| C16 | Internationalisation | L | L | L | M | Client UI i18n |

Judgments:

**C1 MCP marketplace with pinned entries.** Plan 02 already produces the lockfile; a curated list of pinned servers turns it into a feature users can see. Keep it to a static, signed-by-nothing JSON index in the repository (no hosted service). The research value is the drift corpus. Do not build a ranking or review service.

**C2 "Explain why blocked".** The strongest small feature. Every denial (pin mismatch, sudo guard, rule, sandbox) already has a reason code inside AIR's own code; surface it in one sentence plus the rule that fired and a button to allow once. It directly serves RQ6 and demonstrates the claim "verifiable". Note: upstream approval requests carry no arguments (note 11), so the UI must read arguments from the tool call itself.

**C3 Session replay viewer.** Built on the inspector, it shows model-visible input per step, which is the "model-visible equals logged" property made visible. Use it as the demo and the evidence exhibit. Do not build time-travel that re-executes tools; read-only replay only.

**C4 Skill telemetry and evals.** Count triggers from session logs offline; the competitor shipped the cost report in week 36 and a plugin eval in week 37. For AIR's 7 to 8B models, skill triggering reliability is a real, measurable problem. Do a log-derived report first; defer an eval runner.

**C5 Local RAG with citations.** High user value, but a new indexing pipeline, chunking, file watchers, and citation rendering is large. AIR's memory plan already has an FTS5 and vector index; extend it to a user-selected folder, read-only, citing file and line. Phase 2 only, after memory ships. Risk: prompt injection through ingested documents must go through the same untrusted-content path as web pages.

**C6 Vision context.** An 8 GB GPU already holds the chat model; a local vision model competes for VRAM. The Cua and browser backends need image-capable models. Defer; revisit only with a measured small vision model.

**C7 Clipboard and selection actions.** The global hotkey is already in plan 07. Selected-text quick actions on Wayland need portal or compositor support that I did not verify. Ship "send clipboard to AIR" first (user presses a key, content is pasted into a new prompt); skip selection capture.

**C8 Phone companion.** See 1.4. Document the recipe; do not build.

**C9 Presets.** See 1.5. Two presets are enough: a narrow default and a broad "Coder".

**C10 Mods as plugin format.** Only for AIR-authored policy hooks. Do not market it as an ecosystem.

**C11 Offline-first onboarding.** Already listed as an uncovered cross-cutting gap, and the measured Ollama context truncation (4,096 tokens default, note 10) makes it a correctness issue, not polish. Must be in the phase-1 demo path.

**C12 Energy and latency dashboard.** Latency and token counts come from the session log; GPU power needs vendor tools (`nvidia-smi` on this laptop) and differs on the AMD iGPU, Windows, and teammates' machines. Ship latency and tokens per turn and route (local versus cloud); treat energy as an optional research measurement on the project laptop only.

**C13 Privacy ledger.** A file under `$DSH_HOME/air/` listing each outbound model call (route, bytes, redacted preview) plus MCP and web fetches. It follows the egress-gate idea in note 12 and the rule that audit data goes to files. This is AIR's clearest product difference from Claude Desktop and Codex. Limits: it can log only what passes through harness hooks; MCP child processes and `shell` network calls are not covered, and the ledger must say so.

**C14 Backup and export.** Small, expected, and cheap if memory is Markdown in git. Do it with plan 04.

**C15, C16.** Accessibility: a plain-text, screen-reader-friendly mode and keyboard-complete approval cards are cheap if done early and expensive to retrofit; do keyboard and labels now, a full audit later. Internationalisation: upstream's client already owns locale dictionaries (the root rules reject hardcoded copy), so AIR strings added to the client must go through them; do not translate.

## 4. Cuts, merges, and reordering for five people

Assumptions: the rubric and deadlines are not known (owner open decision 1); the existing roadmap runs October 2026 to May 2027; the team has four lanes plus the owner; nothing is built yet. Everything below is opinion.

**Phase-1 review cut (keep the roadmap's list, with these edits).**
- Must: plan 00; plan 01 slice 1; plan 02 through lockfile, review hook, `pin`/`diff`; plan 05 pilot; plan 07 reduced to "Linux AppImage or dev launch runs the `air` profile" (no Windows installer, no signing, no auto-update).
- Add: C11 first-run check (Ollama present, context size correct, model pulled with consent) and C2 "explain why blocked" for the pin quarantine only.
- Should: plan 04 explicit memory (search, write, pinned core) with C14 export.
- Move plan 06 out of phase 1. Two pilots (05 and 06) in the first review splits a small evaluation lane; plan 05's pilot is enough to show numbers.

**Cut.**
- Plan 03 as a full rule store: the owner already chose upstream presets. Keep only the sudo guard, MCP-call gating, and the denial explanation (C2). Defer saved rules, `/allow`, `/deny` and the audit file unless RQ6 needs them.
- Unplanned item 7 (secret handoff via `pkexec`): high effort, narrow use. Cut; keep the plain-`sudo` guard.
- Unplanned item 5 (OS control): cut to a read-only set (volume, brightness, battery) with no set-and-verify tiers. If the team wants one demo of "verify after set", pick volume through `wpctl` only.
- Unplanned item 3, tier 1 (an AIR GNOME Shell extension): cut. Tier 0 (system state) only; the extension is Linux-GNOME-specific, costs a separate release process, and Windows teammates cannot test it.
- Unplanned item 10 (branding): already on hold; stays off the schedule.
- Windows installer signing and the SignPath application: leave until after a first unsigned release exists.

**Merge.**
- Plans 05 and 06 into one evaluation lane with one harness; plan 06 reuses plan 05 Tasks 1 to 4 already.
- Unplanned item 6 (signals, triggers, routines) into the Schedule bundle work: routines are Markdown files over `schedule_*`; defer local signals and the webhook row.
- Memory tiers 2 and 3 into one item: end-of-session extraction with a quarantine gate, because the poisoning comparison (RQ3) needs only that gate. Defer nightly consolidation.

**Reorder.**
1. Foundation, convention loader, MCP trust (RQ1), evaluation pilot, first-run, desktop dev launch.
2. Memory core and the quarantine gate (RQ3); privacy ledger and the replay view (evidence for RQ5, RQ7).
3. Voice dictation (enable the upstream bundle) before hands-free, which is stretch.
4. Full evaluation runs start by February; leave March to May for runs, statistics, and writing. The existing roadmap puts AgentDojo runs in March; with local inference at the speeds in note 10, that leaves little slack.

**Realistic year plan (October 2026 to May 2027; revise when the rubric arrives).**

| Window | Target |
|---|---|
| Oct 2026 | Owner starts build; plan 00; plan 01 slice 1; first-run check; team lanes agreed |
| Nov 2026 | Plan 02 lockfile and review hook; plan 05 pilot tables; desktop dev launch on Linux and Windows |
| Dec 2026 | **Phase-1 review**: demo script from the roadmap plus first-run and explain-why-blocked; pilot numbers labelled as pilot |
| Jan 2027 | Memory core and export; drift corpus; privacy ledger; presets |
| Feb 2027 | Quarantine gate; voice dictation; replay viewer; start the full evaluation runs (RQ1, RQ3) |
| Mar 2027 | RQ2 runs (AgentDojo subset); RQ7 local versus cloud runs; packaging for Linux |
| Apr 2027 | Small usability study (RQ6, n about 8 to 12); freeze features; write-up |
| May 2027 | Release, viva demo; Windows installer if time remains |

Dates are an estimate against the assumed April to May 2027 end, not a commitment.

## 5. Ranked top 10 and do-not-build list

**Top 10.**
1. **Offline-first onboarding with context check (C11).** Without it the default Ollama context silently truncates the harness prompt; every demo depends on it.
2. **MCP trust lockfile and review hook (plan 02, with C1 as a pinned index).** The core of RQ1 and the clearest claim.
3. **Explain why blocked (C2).** Cheap, visible, and the basis of the RQ6 study.
4. **Convention loader slice 1 (plan 01).** Fixes stray skills and lets users bring existing Claude Code files.
5. **Evaluation pilot (plan 05, merged with 06).** The numbers every other item is judged by.
6. **Privacy ledger (C13).** The product's differentiator and the logging half of RQ7.
7. **Memory core with export (plan 04 and C14).** User-visible value and RQ3.
8. **Session replay viewer on the inspector (C3).** Makes "model-visible equals logged" demonstrable.
9. **Voice dictation via the upstream bundle.** A near-free enable that users notice.
10. **Latency and token dashboard (C12, latency only).** Cheap from the log; feeds RQ5 and RQ7.

Close runners-up: presets (C9), skill telemetry from logs (C4), clipboard send (C7).

**Do not build.**
- A hosted MCP marketplace, ranking, or review service: needs operations the team cannot staff and breaks local-first.
- A phone app or one-click public tunnel: unprotected port and bearer-token risk (section 1.4).
- Agent team and multi-session coordination: unsuited to an 8 GB GPU and off the research questions.
- A full local RAG product in phase 1; and local vision before a measured small vision model exists.
- Auto-approve classifiers as a default, or arbitrary third-party Claude Code mods as a trusted ecosystem.
- Selection capture on Wayland, a GNOME extension, secret handoff, wake word, and macOS support (all already out or deferred by the owner).
- A full translation of the UI.

## 6. What was verified and what was recalled

Verified-today: package READMEs and docs listed in section 1 (read as summaries, nothing executed); the roadmap and research text; the Claude Code weekly digests for weeks 13 to 37 and the week 36 page; the Home Assistant 2026.9 post; the Hermes Agent v2026.9.7 page summary.

Recalled or from unopened search snippets: Codex and Cursor items, Goose release contents, the local voice stack article, and everything about Qoder, OpenCode, Jan, Open WebUI, Cherry Studio and Cowork (not found). All effort sizes, scores, and the year plan are estimates.
