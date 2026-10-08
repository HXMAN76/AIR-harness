# AIR-harness Research: Building an Open, Local-First, Verifiable Personal Agent

Date: 2026-09-28. Status: synthesis v1.7, fourteen notes merged; upstream base is now `dsh 0.2.1-alpha.1` (section 2b lists what each sync changed). Notes 01–07 were written against `dsh 0.1.6-alpha.2`; where they disagree with section 2b, section 2b wins. Detailed evidence, sources, and file citations live in `research/notes/`:

| Note | Topic |
|---|---|
| [01-harness-audit.md](notes/01-harness-audit.md) | Every AIR-harness subsystem: keep / extend / rethink / build new |
| [02-air-extraction.md](notes/02-air-extraction.md) | Every component of the earlier Python AIR project, verdicts, lessons |
| [03-competitors.md](notes/03-competitors.md) | Claude Code, Claude Desktop/Cowork, Qoder, Cursor, Codex, Antigravity (ex-Gemini CLI), Kiro, OpenCode, Goose, Cline, OpenHands, Hermes, OpenClaw, Manus; why Markdown-as-configuration works; feature matrix |
| [04-mcp-security.md](notes/04-mcp-security.md) | MCP threat model, prior art on tool pinning, concrete pinning design, defense roadmap |
| [05-memory-context.md](notes/05-memory-context.md) | Long-term memory and desktop context design |
| [06-voice-os-ambient.md](notes/06-voice-os-ambient.md) | Voice pipeline, OS control, computer use, proactive triggers, secret handoff |
| [07-product-fyp-strategy.md](notes/07-product-fyp-strategy.md) | Research questions, evaluation, roadmap, open-source launch, branding |
| [09-desktop-cross-os.md](notes/09-desktop-cross-os.md) | Desktop app on Linux, macOS, Windows: upstream packaging, Linux gaps, AIR-owned Electron shell, signing and distribution |
| [10-local-models-rig.md](notes/10-local-models-rig.md) | Local models on the project laptop: measured VRAM, speed, context and tool-call probes; model shortlist; Ollama settings; evaluation time estimates |
| [11-upstream-permission-modes.md](notes/11-upstream-permission-modes.md) | What upstream's permission presets, Auto review, and agent presets do; what the `air` profile gets; which parts of the AIR permissions plan to keep or defer |
| [12-hybrid-local-cloud.md](notes/12-hybrid-local-cloud.md) | Using local and cloud models together: literature, harness extension points, privacy analysis, a proposed research question, prices |
| [13-desktop-shell-practice.md](notes/13-desktop-shell-practice.md) | How comparable desktop apps package and supervise a local backend; staging spike results; signing, updates, CI practice |
| [14-feature-opportunities.md](notes/14-feature-opportunities.md) | What upstream's newest additions enable, recent competitor features, ranked new-feature candidates, suggested cuts |
| [08-dev-contrib-guide.md](notes/08-dev-contrib-guide.md) | Development guide: setup, local Ollama route, three extension paths, `air` profile and bundle, in-tree rules checklist, per-feature template packages, repository layout and branching, doc contradictions |

## 1. Vision

AIR-harness turns the deepseek-harness fork into an open-source personal agent ("Jarvis-class", but not named Jarvis) that runs locally first, is extended through plain files and plugins, and whose security properties can be checked rather than trusted. It competes with Claude Desktop, Claude Code, and Qoder on openness, local control, and verifiability, not on model quality.

Positioning statement: *an open, local-first personal agent whose every model-visible input is logged, whose tool surface is pinned and reviewable, and whose capabilities are added by dropping in Markdown files, MCP servers, or plugin bundles.*

## 2. Starting point

**What the harness already gives (note 01).** An all-plugin Cordis architecture with no privileged core; a durable, replayable, append-only session log with the rule "model-visible ⟺ logged"; real OS sandboxing on Linux, macOS, and Windows; heterogeneous subagents (native, forked, ACP, SDK, Codex, Claude Code); SKILL.md skills with progressive disclosure; multi-provider LLM routing (DeepSeek, pi-ai catalog, OpenAI- and Anthropic-protocol gateways, self-hosted endpoints such as Ollama); transactional plugin install; Claude Code / Codex hook bridges; Web, Electron desktop, headless, JSON-RPC SDK (TypeScript and Python), and ACP front doors; very strong engineering hygiene (about 60 verify gates, per-file 100% coverage).

**What it lacks for a personal agent (as of 0.2.0-rc.1, see 2b).** Long-term memory; desktop context beyond tmux and time; text-to-speech, wake word, and a hands-free voice loop (speech-to-text input now exists as an experimental bundle); OS device control (computer and browser use are experimental only); ambient event triggers (`schedule` now handles cron and cold sessions, but `webhook` is GitHub-only and process-local and there is no local signal source); MCP tool-surface pinning (`syncTools` trusts live `tools/list`); argument-aware, remembered permission rules (approval is one-shot, and requests do not carry tool arguments); a tray on macOS and Linux, a global hotkey, a quick-entry overlay, OS notifications; Markdown-defined agents and commands; `.mcp.json` import; a plugin marketplace.

**Coupling to remove in an AIR product profile** (updated for 0.2.0-rc.1 in 2b). Default route `deepseek-flash`; `session-log-deepseek` uploads a session-log suffix to the DeepSeek API when the official API is used (now a user switch in Settings → General, still mounted by default); DeepSeek account login and product-usage telemetry packages added in 0.2; `plugin-package-inventory-deepseek` sends the active plugin list; telemetry `FEEDBACK_ONLY` exports to a DeepSeek endpoint; the anonymous install id is sent as a header to DeepSeek gateways; official branding.

**What AIR (Python) contributes (note 02).** Ideas, not code: pinning, capability scopes with install-time vs per-call confirmation, hybrid recall, desktop context providers, verify-after-set device tools, fake-tool-call detection, a declarative workflow model, and an honest evaluation habit. Most of AIR's core (kernel, tool gateway, approval, audit, config, event bus, SDK, UI) is already better in the harness.

## 2b. Upstream delta after the fork sync (0.1.6-alpha.2 to 0.2.0-rc.1)

The fork was synced on 2026-09-28: 2,224 upstream commits, about 7,000 files changed, 291 to 316 packages. Findings that change this plan:

**Now provided upstream (build on it instead of from scratch):**
- **Speech-to-text seam (experimental).** `experimental/speech-to-text` (Service Definition `ctx.speechToText`), `speech-to-text-sensevoice` (SenseVoiceSmall ONNX plus Silero VAD on the Host CPU through the sherpa-onnx Node package, no Python), `api-speech-to-text` (a `speech` Remote for complete browser recordings), `client-ui-voice-input` (microphone button, level meter, transcribe into the draft), and `voice-input-bundle` composing them. Off in shipped profiles. macOS signed builds now request microphone access (`apps/desktop/src/microphone-permissions.ts`). This matches the stack recommended in note 06, so section 5.6 now extends this seam.
- **Schedule grew into a real scheduler.** One-shot, fixed-rate, daily, weekly, and cron wall-clock reminders; the Host restores a cold Session when delivery is due; recurring tasks deliver only the latest missed occurrence (`packages/schedule/schedule/README.md`). Shipped as the optional `experimental/schedule-bundle` (time-context, schedule, ui-schedule). Note 01's "delivery requires a live session" is no longer true.
- **Desktop tray, Windows only.** `apps/desktop/src/tray.ts` gives open and quit entries on Windows. No macOS/Linux tray, no global hotkey (`client/shortcuts` customizes in-app bindings per device, not OS-wide shortcuts), no quick-entry overlay.
- **Declarative agent presets.** `preset/agent-preset` and `preset/agent-preset-registry` replace `agent-presets`: tools, prompt sections, and skills per preset in Cordis YAML, several compositions per process. Good home for "Assistant", "Coder", "Researcher" modes; still YAML, not Markdown agent files.
- **Config editor.** `boot/config-editor` saves plugin configuration into the active profile patch with validation and HMR. Useful for a settings UI for AIR plugins.
- **Session format v4.** `session-format-v3-to-v4` adds the V3 to V4 edge. New session events for memory, desktop context, and MCP trust must target V4 rules.

**Unchanged (gaps confirmed still open at 0.2.0-rc.1):**
- MCP tool-surface pinning: `syncTools` still trusts live `tools/list`; the only SHA-256 is the name hash in `publicToolName`.
- Approval outcomes still `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'` (no allow-always, no rule store); explanations are now localized.
- Claude Code hook bridge still supports 7 of 30 events; `allow` and `updatedInput` still not honored.
- Skill roots still `.dsh/skills`, `.agents/skills`, user equivalents; `.claude/skills` still not scanned by default.
- No memory package, no desktop-context provider, no text-to-speech, no wake word, no OS-control tools; computer and browser use still experimental.

**DeepSeek coupling, updated:**
- `session-log-deepseek` is still mounted in `bundle/base`, but upload is now a user switch ("Upload Session Log when using the official model API") in Settings → General (`client/ui-settings-session-log`). The AIR profile should still remove the row or default the switch off.
- New DeepSeek account login (`credentials/deepseek-account`, `deepseek-account-platform`, `llm/llm-deepseek-account`, `api/account-controller`) next to API-key auth (`llm-deepseek-api-key`). Keep out of the AIR profile unless DeepSeek models are chosen.
- New `host/product-telemetry-otel` and `client/product-analytics` for product usage events (explicit submission only, best effort). Disable in the AIR profile; publish the telemetry policy.
- Default model still `deepseek-flash` in `bundle/base`.

**Second sync, 0.2.0-rc.1 to 0.2.0-rc.2 (2026-09-29).** 187 upstream commits, about 1,000 files, no packages added or removed. Areas this plan builds on (bundles, MCP client, approval, skills, hooks, speech-to-text, context) changed only in package versions. Relevant changes: due Schedule reminders are now framed as scheduled user messages; `user-questions` supports timed waits and late replies; the desktop app can install and manage a bundled `dsh` command; the model picker gained fuzzy search and grouping; upstream added `docs/upgrade-guide/<version>/` guides for breaking surface changes, which AIR should read at every sync (current guides: optional schedule bundle, legacy transcript view). The `air` profile composes unchanged on rc.2.

**Third sync, 0.2.0-rc.2 to 0.2.1-alpha.1 (2026-10-08).** 266 upstream commits, about 4,200 files, 316 to 319 packages. The `air` profile composes with no unmatched patch targets and the build passes; the AIR peer range `^0.2.0-rc.1` still admits this version. Changes that matter here:
- **Runtime invariants removed.** `@deepseek-ai/dsh-invariants` and every package's `./invariant` export are gone, and `sdk-minimal` loses its five invariant rows ([upgrade guide](../docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.md)). Most of the deleted lines in session, tools, agent-loop, context, hooks, and webhook are this removal. AIR plans never referenced invariants; the in-tree rule about invariant companions no longer applies.
- **Schedule is part of the Web composition.** The optional schedule bundle is retired; `@deepseek-ai/dsh-web-app` mounts `schedule` and `ui-schedule`, and the `standard`, `cordis`, and `ptc` presets declare the clock reading and four `schedule_*` tools from the new `schedule/tool-schedule` package ([upgrade guide](../docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md)). `time-context` is now a preset row, not a top-level row. Reminder tools are denied to delegated children.
- **Claude Code mods bridge (experimental, new).** `experimental/claude-code-mods` runs Claude Code "mods" (function-hook plugins) inside agent runs: hooks can guard tool calls, rewrite prompts, add commands and tools, and draw a band above the prompt; `client-ui-claude-code-mods` renders the band. It is an alpha compatibility demonstration with a documented difference list (`docs/subsystems/claude-code-mods.md`). This overlaps the hook part of AIR's file-convention loader: evaluate it before writing AIR's own hook plugin (later slice of plan 01).
- **Session inspector and developer tools (experimental, new).** `experimental/session-inspector` and `inspector-profile` show raw session logs and grouped chat structure, and embed the Node inspector; useful for debugging AIR plugins and for evaluation.
- **Desktop Host uses a dynamic port.** Upstream's Host now passes `--port 0` instead of a fixed port. Plan 07's fixed port and port-conflict error dialog can be replaced by the same approach.
- **Web `--public-url`.** The Web profile can advertise a public HTTP(S) root behind a proxy; it grants no trust. Not needed for the desktop app.
- **Plugin display metadata.** Subpath plugins read title and description from locale files and their image from an exported `<subpath>/icon`, never from a subpath `package.json` ([upgrade guide](../docs/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.md)); relevant when AIR bundles appear on the Plugins page.
- **Unchanged:** MCP client (no pinning, no review hook), approval outcomes, Claude Code hook-bridge coverage, skill roots, speech-to-text seam, Auto review. Out-of-tree plugins still cannot write skippable session events.

## 2c. Owner decisions of 2026-10-02 and what the follow-up research found

Decisions: product name on hold; a desktop app on every operating system; local inference on the project laptop where possible; upstream's permission modes as the default for now; research before building. Detail and evidence are in notes 09–11; implementation plans are in [air/plans/](../air/plans/README.md).

**Desktop on every OS (note 09).** Upstream's Electron app accepts only macOS and Windows build targets, and its development launcher rejects `linux-x64`, so it cannot be used on Linux as is (this corrects the earlier assumption that the dev app runs on Linux). The layers underneath are Linux-ready: bundled runtimes, the native addon, and the `bwrap` then Landlock sandbox chain. Recommendation: an AIR-owned Electron shell in `air/apps/desktop` with a small AIR Host entry that calls the exported profile boot with the `air` profile, leaving `apps/desktop` untouched; estimated one to two weeks to a Linux demo, with a two-day packaging spike first. Electron 44 is Wayland-native; the global hotkey needs an installed `.desktop` file, so the Linux demo installs an rpm; GNOME has no tray without the AppIndicator extension, so the shell needs its own close-button policy. GitHub Releases can serve updates; macOS auto-update requires a signed app. Because the profile is not named `desktop`, upstream's desktop telemetry rows stay off.

**Local models on the laptop (note 10; Ryzen AI 9 HX 370, 30 GiB RAM, RTX 4060 Laptop 8 GiB, Ollama 0.32.7).** Measured: Ollama's default context here is 4,096 tokens and the OpenAI-compatible endpoint silently truncated a 7.9k-token prompt to 2,050 tokens, dropping the system prompt; the harness prompt is about 5k tokens, so every AIR route needs a larger context setting and a startup check. `qwen2.5:7b-instruct` stays fully on the GPU up to a 32k context at 40–48 tokens/s; `qwen3:8b` fits at 8k, and spills to the CPU at 16k and 32k (20–35 tokens/s) with the default cache type. Prefix reuse works: a cached 7.9k-token prefix costs 0.03–0.04 s instead of 3.4–4.9 s. Native tool calls succeeded once for each installed chat model. `qwen3` thinking multiplies output tokens four to five times per step. Recommended (not yet applied or measured): `qwen3:8b` at 16k with an 8-bit KV cache as the product default, `qwen2.5:7b-instruct` at 32k as the long-context fallback and local judge, speech models on the CPU, `nomic-embed-text` kept for embeddings. Evaluation estimates: one AgentDojo v1.2.2 arm takes roughly 4–8 hours locally, so the full 13-run design is not feasible on the laptop; run each main arm once locally and keep repeats and ablations on a cheap hosted model. Small local models may show a floor effect in injection studies (MCPTox reports Qwen3-8b at 14% attack success without reasoning and 41.8% with it), so results must report utility, utility under attack, attack success, and tool-call rate together.

**Upstream permission modes (note 11).** Upstream ships three presets, Read Only, Workspace Write (the default), and Full access, plus an optional model-based Auto review that rates each tool call with the session's own model and runs without a file sandbox. No upstream preset asks on every shell or write call; under Workspace Write the only prompt is a sandbox escalation. The `air` profile already gets these defaults unchanged. Remaining gaps: MCP tool calls are not gated, grants are one-time, approval requests carry no arguments, the sandbox has no network policy, MCP servers run unsandboxed, and `sudo` has no special handling. Consequence for plan 03: drop ask-by-default for shell and file writes; keep the `sudo` guard and asking before MCP tool calls; aim the rule store at MCP tools and escalation prompts. Auto review will run on a local 7–8B model but should not be the safety mechanism there until measured.

**Desktop shell practice and plan (note 13, 2026-10-03).** The owner approved the AIR-owned Electron shell and narrowed the targets to Windows and Linux (Fedora rpm first); macOS is out of scope. A scratch test showed that `pnpm deploy --prod` of the CLI package omits 27 workspace packages that are only peers; copying them in gives a self-contained tree from which the AIR Host reached ready in 2.5 s under Node and 1.8 s under Electron 44 in Node mode. Cherry Studio already ships these harness packages in an Electron app with an rpm target and is the closest packaging precedent. GNOME's Background Apps list is expected to show only sandboxed apps, so the rpm build's opt-in background mode relies on a notification, the app grid, and the hotkey. Decisions: desktop identifiers stay placeholders until the product name is final; rpm updates notify with a link; the first Windows release is unsigned, then SignPath Foundation. Windows staging and installer builds are untested. Plan: `air/plans/2026-10-03-07-desktop-shell.md`.

**Local and cloud together (note 12, 2026-10-03).** The harness already has the extension points: the `agent/request` waterfall lets a plugin replace provider, model, and reasoning effort for a step; a retry from `agent/request-error` can use a different route (fallback or cascade); the `llm/stream` waterfall wraps every model call (the place for an egress gate); subagents accept their own provider and model. The route taken is already in the session log; only the reason for a routing decision needs an AIR audit file. Not yet verified: listener order with upstream's model selection and retry plugins, and whether `llm/stream` listeners see subagent and compaction calls with a usable session id (half-day spike). Security: escalation sends the whole context off the machine and a stronger cloud model is more likely to carry out an injected instruction, so escalation triggers must not depend on untrusted content; redaction must happen on logged channels; Ollama cloud models go through the local daemon address, so an egress gate cannot key on host. Recommended product steps: first an egress ledger (what left the machine, per request) and a local-only session lock; later a user-invoked cloud consult through a tool-less subagent and cloud-to-local failure fallback; no automatic router unless the experiment justifies it. Proposed RQ7, privacy-aware hybrid routing: run always-local and always-cloud arms with and without AIR defences on the 286-episode AgentDojo subset, and compute random, oracle, rule, and cascade routers offline from those logs, adding off-device tokens and local energy as outcome metrics (estimated about three days of work and a few dollars of hosted calls). Several literature figures in the note are recalled, not fetched, and are marked for checking before they are quoted.

## 2a. Competitive landscape (note 03)

| Product | Open source | Local models | Linux desktop | Enforced plugin permissions | Relevance |
|---|---|---|---|---|---|
| Claude Code | No | No | CLI only | Hooks, rules, sandbox (not per-skill) | Reference design for Markdown conventions |
| Claude Desktop / Cowork | No | No | No build | No | Moving toward cloud execution |
| Qoder | No | No | IDE | No | Copies Claude Code layout under `.qoder/` |
| Cursor | No | Partial | IDE | Manual marketplace review | Agent Plugins backer |
| Codex CLI / app | CLI yes, app no | Reported | CLI | Sandbox | Agent Plugins backer |
| Antigravity (ex-Gemini CLI) | Reported closed | No | CLI | ? | Consumer access withdrawn 2026-06-18 |
| OpenCode | Yes | Yes | TUI | Permission rules | Reads `.claude/skills` |
| Goose | Apache-2.0 | Ollama | Desktop | Sandbox mode | Recipes, extensions |
| Hermes Agent | MIT | Custom endpoints | Yes | No | Closest "Jarvis": self-written memory and skills, 20+ messaging apps, cron, voice |
| OpenClaw | Reported open | Reported | Yes | No | Cautionary tale: 800+ malicious skills, RCE CVE |

Gaps nobody fills well (note 03 §4): skill and plugin security the user can verify; a local-first, model-agnostic, Linux-first desktop agent; enforcement compiled from Markdown; measuring whether skills trigger; transparent, portable, git-backed memory with each entry traceable to the session event that created it; cross-prompt-injection resistance for personal automation; one loader for every ecosystem's formats; voice and ambient use on an audited core. AIR-harness targets all eight.

## 3. Key corrections to earlier assumptions

1. **Tool pinning is not novel.** At least seven systems pin or fingerprint MCP tool definitions (Invariant mcp-scan, Trail of Bits mcp-context-protector, Pipelock, MCPProxy, MCPTrust, Vercel AI SDK `detectToolDrift`, Microsoft agent-governance-toolkit), and OWASP recommends it (note 04). AIR's implementation also hashed only `inputSchema`, so the classic description rug pull passed undetected. The defensible contribution is narrower: in-client, generation-atomic enforcement before registration; a per-session audit record of the approved surface the model saw; a diffable lockfile holding full approved definitions; pins bound to capability scopes; and RFC 8785 canonicalization so Python and TypeScript produce identical digests.
2. **AIR's evaluation is weak evidence.** RQ2's 10/10 drift detection is guaranteed by hashing and ran against a mock server; RQ3 used five records; RQ4 broke after M12; RQ5 missed the dominant per-call process spawn (note 02).
3. **AIR violated its own logging rule.** Recalled memory and desktop context reached the prompt unlogged. The harness rule forces every such input to be a session event.
4. **Detection-based prompt-injection defenses are weak.** Twelve published defenses were bypassed above 90% attack success ("The Attacker Moves Second", USENIX Security 2026). Security must come from deterministic policy (capability scopes, approval, egress control, taint), not classifiers (notes 04, 07).
5. **Memory is an attack surface.** MINJA, FARMA, and "Bad Memory" show high-success memory poisoning. Automatic memory writes from untrusted content must be quarantined (note 05).
6. **Licenses matter.** Piper TTS moved to GPL-3.0 (October 2025); XTTS weights are non-commercial. Prefer Kokoro for an MIT product (note 06).
7. **Trademark.** "DeepSeek Harness" is a DeepSeek trademark; "built on DeepSeek Harness" is allowed; keep the MIT notice; avoid "Jarvis" as a product name; search trademarks before settling on "AIR" (note 07).
8. **Skills do not trigger reliably.** In Vercel's January 2026 evals a skill was never invoked in 56% of cases and scored the same as no docs (53%); a compressed index kept in always-on `AGENTS.md` scored 100%. Critical guidance must be always loaded; procedures can be on demand (note 03 §2.2).
9. **Third-party skills are a real supply-chain risk.** 26.1% of 31,132 marketplace skills had at least one vulnerability (arXiv 2601.10338); OpenClaw's ClawHub hosted more than 800 malicious skills in February 2026. An open registry without verification is a liability (note 03 §2.2, §1.16).
10. **The ecosystem is volatile.** Gemini CLI was replaced by Antigravity CLI and consumer accounts were cut off (2026-06-18); Roo Code shut down (2026-05-15); ChatGPT Atlas was discontinued (2026-08-09); Cowork moved from a local VM toward cloud execution. Build on open standards (AGENTS.md and MCP under the Agentic AI Foundation, agentskills.io, Agent Plugins, MCPB), not on any single vendor's CLI (note 03 §5.7).
11. **Plugin packaging split in two.** Agent Plugins (`plugin.json` with `skills/` and `mcp.json`, launched 2026-08-07, backed by Amazon, Cursor, Microsoft, OpenAI, Vercel) competes with Claude Code's `.claude-plugin/` format. Read both (note 03 §1.4, §5.5).
12. **Upstream accepts no external pull requests** (`CONTRIBUTING.md`: "we cannot accept external pull requests at the moment"). "Upstreamable" can only mean "written to upstream's standard"; every in-tree edit stays in the fork and must be carried across every sync (note 08).
13. **Out-of-tree session events must be `ignorable: true`.** The reader's known-event list is generated only from in-repo declarations (`packages/core/session/src/known-event-types.ts`); a log carrying an undeclared, non-ignorable event is refused, even by the AIR build. So `mcp/surface`, `mcp/drift`, and hook decisions are audit-only events, and model-visible inputs (memory recall, desktop readings, voice transcripts) reach the model as ordinary source-labelled injected messages, the `time-context` pattern, which also keeps them in the log (note 08).
14. **Pinning cannot be a pure plugin.** `syncTools` fetches and registers with no hook between the two phases; withholding changed tools before the model sees them needs a small hook added to `mcp-client` (a fork-carried in-tree edit). A call-time guard alone still leaves poisoned descriptions in context (notes 04, 08).
15. **Linux desktop is new work.** "Linux is not a supported Desktop release target" (`apps/desktop/README.md`), and the tray is Windows-only. A Linux-first desktop, a stated differentiator, means owning Linux packaging (note 08).
16. **Ollama is not a catalog provider.** It needs a hand-declared `llm-pi-ai` route (`openai-completions`, `http://127.0.0.1:11434/v1`, placeholder `apiKeyEnv`), placed in the profile patch, because saving any provider in the Models page replaces the whole `llm-pi-ai` config (note 08 §1).
17. **Peer ranges break every sync.** Plugin loading checks declared `@deepseek-ai/dsh-*` version ranges against the running host; AIR packages must bump ranges at every upstream sync (note 08). MemOS's `<0.2.0` range is a live example (section 5.4).

## 4. Design principles

1. **Files first, enforcement underneath.** Anything a user extends is a plain file: Markdown with YAML frontmatter for skills, agents, commands, rules, memory, routines; JSON/YAML for MCP config and lockfiles. Claude Code's Markdown model "works rather than failing" for eight reasons (note 03 §2.1):
   - progressive disclosure (about 100 tokens of name and description always loaded, body under about 5,000 tokens on demand, scripts and references only when pointed to);
   - Markdown is the format models already read, with a tiny machine-parsed frontmatter;
   - text fits git (review, blame, revert; committed vs `.local` vs user scopes);
   - no build step, runtime, or API, so non-programmers and the agent itself can author files;
   - bundled scripts do the steps that must be exact;
   - pieces compose as folders (skills inside subagents inside plugins);
   - the same file works across 25–40+ tools;
   - **advice and enforcement are kept apart**: Markdown is context, and anything that must hold is a hook, permission rule, or sandbox.

   The failure modes are context bloat, conflicting instructions, skills not triggering, advice mistaken for enforcement, and third-party supply-chain risk. Mitigations: description and index caps, explicit precedence, a compressed always-on index for critical facts, explicit invocation (`/skill`, `@agent`), `paths:` auto-attach, trigger evals, and never treating Markdown as the security boundary.
2. **Plugins for capabilities, files for behavior.** New capabilities (memory, voice, OS control) are Cordis plugin bundles following the Service Definition / Provider / Consumer seam. Behavior and personalization (agents, skills, commands, routines, memory content) are files.
3. **Compatibility over invention.** Read existing conventions verbatim: `AGENTS.md`/`CLAUDE.md`, `.claude/skills` and `.agents/skills` SKILL.md (Agent Skills standard), `.claude/agents/*.md`, `.claude/commands/*.md`, `.mcp.json`, Claude Code `hooks.json`, MCPB bundles. Users inherit existing ecosystems on day one.
4. **Model-visible ⟺ logged.** Memory recall, desktop readings, pin verdicts, and voice transcripts are session events.
5. **Deterministic security.** Pin what the model sees; scope what tools may do; ask for side effects; cut egress; treat tool, desktop, and web content as untrusted.
6. **Verify after set.** State-changing device tools return requested value, value before, value after, verified flag, attempts.
7. **Local-first, cloud-optional.** Every feature has a local path (Ollama or vLLM models, local STT/TTS, local embeddings, local storage). Telemetry off by default.
8. **Out-of-tree by default.** AIR features live in a separate `air/` pnpm workspace outside `packages/*/*` (so upstream's workspace, manifest, coverage, and bilingual gates do not pick them up), shipped as bundles loaded by an `air` product profile. `master` stays a clean mirror of upstream; AIR work happens on `air/main`, merging upstream at release tags (now `dsh-v0.2.0-rc.1`). Core edits only where an extension point is genuinely missing (known so far: the `syncTools` verification hook), kept small because they are carried forever. Setup, profile/bundle drafts, and the per-feature template packages are in note 08.

## 5. Feature plan

Each item names the recommended design; the linked note carries the evidence.

### 5.1 Universal file-convention loader (build new, high value)
Goal: a user drops in a repository or `~/.claude` folder configured for another agent and it works on day one; the harness adds verification on top without changing formats (note 03 §5). One bundle, mapped onto existing seams, no core edits:

- **Instructions.** `AGENTS.md` with standard semantics (nested, closest wins); `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` with `@path` imports (max 4 hops, approval for imports outside the project).
- **Rules.** `.claude/rules/**/*.md` (`paths:`), `.cursor/rules/*.mdc` (`globs`, `alwaysApply`), `.kiro/steering/*.md` (`inclusion:`) normalized into one rule type with modes always / glob / description-matched / manual.
- **Skills.** Discovery order: product-native `.<product>/skills`, `.agents/skills`, `.claude/skills`, user-level equivalents, nested `.claude/skills`, plus `.opencode/`, `.cline/`, `.qoder/` skills. Validate against the agentskills.io spec. Honor Claude Code fields (`disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `context: fork`, `agent`, `model`, `paths`, `arguments`, `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `` !`cmd` `` routed through permission checks). Treat `.claude/commands/*.md` as user-invocable skills. Budget descriptions at about 1,500 characters with a total cap and `name-only`/`off` overrides.
- **Subagents.** `.claude/agents/*.md`, `~/.claude/agents/*.md`, `.qoder/agents/*.md` compiled to subagent instances, with `tools`, `disallowedTools`, `model` (mapped to local aliases), `permissionMode`, `skills`, `memory`, `maxTurns`, `isolation: worktree`, `background`, `mcpServers`, `hooks`.
- **Hooks.** Claude Code `hooks` JSON (event → matcher → handlers; `command`, `http`, `prompt`; exit code 2 blocks; `permissionDecision`/`updatedInput` honored), starting with `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `PreCompact`, `Notification`. Each hook decision is a logged session event. This extends today's partial bridge (7 of 30 events, `allow` and `updatedInput` ignored).
- **Plugins and MCP.** Both `.claude-plugin/plugin.json` + `marketplace.json` and Agent Plugins `plugin.json`; project `.mcp.json`; `.mcpb` bundles with `sensitive` user config stored in the OS keychain. Later: `gemini-extension.json`, Kiro Powers, Goose recipes.
- **Auto memory.** Claude Code layout (`MEMORY.md` index plus typed topic files, 200 lines / 25 KB) as the storage format of 5.4, with import from Claude, Cline Memory Bank, Qoder, Hermes.
- **Permission syntax.** Modes mirroring `default`, `acceptEdits`, `plan`, `auto`, with allow/ask/deny rules in `Tool(pattern)` syntax that Claude Code, Codex, and OpenCode users already know.

### 5.1a Differentiators on top of the formats
- **Enforcement compiled from Markdown.** A rule's frontmatter may declare `enforce:` constraints (deny path globs, deny commands, require confirmation) that compile into `tools/pre-execute` guard plugins. The prose stays advice for the model; the frontmatter becomes policy. No product offers this (note 03 §4.3).
- **Enforced permission manifests for skills and plugins.** `allowed-tools` plus a capability block (filesystem roots, network hosts, secrets) mapped onto the sandbox and guards; signed packages with a transparency log of hashes; a permissions diff shown before an update is accepted; install-time scanning; marketplace tiers (verified, community, local). Same treatment as MCP pinning (5.2), extended to skills and plugins.
- **Skill trigger telemetry and evals.** Record when a skill should have fired, did fire, or was invoked by hand; a `skills eval` command that replays keyless recorded sessions; suggestions to promote frequently needed skills into always-on context.

### 5.2 MCP trust: surface pinning (research core)
New `mcp-trust` seam plus lockfile `.dsh/mcp-lock.json`, keyed by local server name. Digest per tool over name, title, description, inputSchema (unresolved), outputSchema, annotations, execution; RFC 8785 JCS then SHA-256; no Unicode normalization. Enforced in `syncTools` phase 1 before registration. On drift: added tools withheld, changed pinned tool rejects the whole server generation (quarantine), removals accepted, instructions pinned too; drift never reuses "keep previous generation on failed refresh". Call-time guard denies calls whose digest no longer matches. Honor MCP 2026-07-28 `ttlMs` as re-verification cadence. `dsh mcp pin | diff | verify | revoke` for persistent approval; in-session one-shot acceptance through `user-approval`. Log-only session events `mcp/surface` and `mcp/drift`, declared `ignorable: true` because out-of-tree events cannot be required-on-read (correction 13). Needs one small hook added to `mcp-client` between fetch and registration (correction 14). Exact versions in launch args, artifact digests, MCPB signature checks, optional Sigstore-signed lockfile. 27 test scenarios (AIR's 10 plus 17 new, starting with a description-only change). (Note 04 §3.)

### 5.3 Permissions and defense in depth
Ranked: sandbox MCP stdio servers with the existing sandbox; per-tool capability scopes in `tools/pre-execute` with mandatory `scopeArgKeys` and granted scope shown in tool descriptions; argument-aware approval requests with category and risk; a persistent rule store (allow-always per tool and pattern) kept outside the closed `ApprovalOutcome` union; network egress control (new sandbox vocabulary); output taint that escalates side-effecting calls to `ask` once untrusted content is in context; secret blocking; CaMeL-style plan/data separation as a research track. (Notes 02 §2.3, 04 §4.)

### 5.4 Long-term memory
Markdown files with YAML frontmatter are the source of truth, in a git repository per user plus per-project folders; a rebuildable SQLite FTS5 index plus a JavaScript vector scan (sqlite-vec optional); EmbeddingGemma or nomic-embed locally. Three write tiers: explicit `memory_write`; end-of-session extraction with a trust gate that quarantines anything learned from untrusted content; nightly budgeted consolidation via `jobs`/`schedule` that supersedes rather than deletes. Reads: a frozen pinned core at session start (KV-cache friendly), a `memory_search` tool as the main path, optional auto-recall injected as a source-labelled message with the exact rendered text (the `time-context` pattern, so it is in the log), plus an optional `ignorable: true` audit event with ids and scores (correction 13). RRF fusion until a labelled set exists, then fitted weights; validity intervals filter superseded facts. User controls: view, edit, forget, restore, quarantine review, scopes, read-only and incognito. Poisoning defenses: taint by source, reject imperative candidates, render as quoted data, memory never authorizes actions, path confinement. (Note 05 §2.)

**MemOS check (verified 2026-09-29).** MemOS (MemTensor, Apache-2.0) ships two real DSH integrations, announced 2026-08-17 ([README](https://github.com/MemTensor/MemOS)):
- `@memtensor/memos-cloud-dsh-plugin`: MemOS Cloud; installed with `dsh plugin --profile web add`; recalls before the first model step and saves user and assistant messages after each successful turn; fail-open.
- `@memtensor/memos-local-plugin` DSH adapter ([adapter README](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/adapters/deepseek-harness/README.md)): an out-of-tree Cordis bundle (`dsh.bundle.patch`, row id `memos-local-memory`). Per accepted user turn it runs one automatic recall at `agent/pre-step` (deadline at most 3,000 ms, fail-open), appended as a user message with source `plugin/memos-local-memory/recall` inside `<memos_context>` and marked as untrusted historical data, so the recalled text is in the session log. It captures every completed turn in a per-session background queue from `session/event` and `turn/end`; stores SQLite with FTS5 plus local vector embeddings (Transformers.js on onnxruntime-node) under `$DSH_HOME/memos-plugin/`; registers six `memos_*` tools; borrows the active DSH provider through the public `llm` service for summaries; serves an in-process Memory Viewer on `127.0.0.1:18801` with no API key and password off by default.
- Limits relevant here: its stated DSH peer range is `>=0.1.0-rc.5 <0.2.0`, so it is **not declared compatible with the fork's `0.2.0-rc.1`**; it auto-captures every turn (tool arguments and results, reasoning, `cwd`), which is the bleed-through and poisoning pattern note 05 warns against; it has no trust gate or quarantine; memory lives in an opaque SQLite database, not user-editable files; native dependencies need reviewed pnpm build scripts and run outside the tool sandbox; restored sessions do not re-emit events, so crashes can leave turns uncaptured.

**Decision.** Do not duplicate MemOS's engine, and do not adopt it as the product memory either. Build the file-first, trust-gated memory of this section as the AIR contribution, reuse MemOS's proven DSH integration points (`agent/pre-step` recall with a hard deadline, source-labelled recall messages, `turn/end` background capture, host `llm` bridge for auxiliary calls, bounded disposal drain), and use the MemOS local plugin as a **baseline arm in RQ3** (once its peer range covers 0.2, or pinned to a 0.1.x host for the comparison) and as a target in the poisoning red team.

### 5.5 Desktop context
Pull-based, change-only, minimized readings following the `time-context`/`tmux-context` pattern, marked untrusted. Tier 0 system state on by default; tier 1 focus (app id, redacted title, recent files) opt-in; tier 2 content (clipboard, selection, accessibility text) only on user action. Never capture keystrokes, screenshots, audio, password fields, capture-protected windows. Honor password-manager clipboard markers. Per-OS providers behind one service (X11, Wayland GNOME/KDE/wlroots, macOS, Windows). No background recorder in v1. (Note 05 §3.)

### 5.6 Voice
Chained pipeline (STT, existing agent loop, TTS) so transcripts are logged; speech-to-speech models only as an experimental mode. **Extend upstream's experimental speech-to-text seam (2b) rather than build a parallel one:** add providers to `ctx.speechToText` (Parakeet or faster-whisper for GPU, Moonshine or whisper.cpp for CPU), and add what is missing — a `text-to-speech` Service Definition with a Kokoro provider on the same sherpa-onnx runtime, streaming recognition (the current Remote accepts only complete recordings), an onnxruntime turn detector and wake-word detector, barge-in, a Wyoming provider for external GPU servers, and a hands-free mode in the client next to the existing microphone button. Work toward promoting the bundle out of `experimental/` upstream. On an RTX 4060: openWakeWord, Silero VAD, Smart Turn, Parakeet-TDT-0.6B-v3 or faster-whisper, Kokoro-82M. CPU-only: Moonshine or whisper.cpp, Kokoro. Targets (design goals, not measured): 800 ms end-of-speech to first audio, 150 ms barge-in. Push-to-talk default, wake word opt-in, audio never stored, risky actions confirmed on screen, not by voice. (Note 06.)

### 5.7 OS control
`os-control` service with typed capabilities, each with read, set, verify, and a self-declared risk tier (read, reversible, disruptive, privileged) mapped to approval; per-OS providers; `tool-os-control` for model-facing tools. Linux via D-Bus (MPRIS, BlueZ, NetworkManager, UPower, logind), `wpctl`, `gsettings`, xdg-desktop-portal for Wayland. Computer use (portal screenshots, libei input, accessibility tree) is the last resort after typed capabilities and browser use. AIR's bluetooth, calendar, OCR, and voice MCP servers can be connected through `mcp-client` today as a stop-gap (smoke-test calendar first; add `ask` policies for side-effecting tools). (Notes 02 §5, 06.)

### 5.8 Proactive behavior and routines
`signals` (local event sources: file watch, calendar, battery, network, notifications), `triggers` (deterministic rules with cooldowns and quiet hours, starting sessions through the webhook path), `routines` (Markdown-defined briefings on `schedule`). A cheap non-LLM "should I act?" gate before any model call; proactive output lands in a silent inbox by default, runs under a restricted permission preset, and is mutable per rule. A resident background process (tray agent) so triggers survive closing the window. Time-based routines now sit directly on upstream `schedule` (cron, daily, weekly, cold-session restore) enabled through `schedule-bundle`; the new work is event-based signals and triggers. (Notes 01 §2.13–2.14, 06; section 2b.)

### 5.9 Secure secret handoff
`secret-prompt` next to user-approval. Preferred: polkit (PackageKit over D-Bus or `pkexec`) so the desktop's own dialog collects the password; alternatives: a `SUDO_ASKPASS` helper over a per-session socket, or a PTY mode that accepts input only from the user. The shell rejects plain `sudo` and `sudo -S`. The secret never becomes a session event. (Note 06.)

### 5.10 Desktop shell and distribution
Extend upstream's Windows-only tray (`apps/desktop/src/tray.ts`) to Linux and macOS; add an OS-wide global hotkey, a quick-entry overlay, and OS notifications in `apps/desktop` as isolated new files. Use `preset/agent-preset-registry` for Assistant/Coder/Researcher modes and `boot/config-editor` for AIR plugin settings. A curated plugin index with versions and trust metadata on top of the existing transactional installer; permission manifests for bundles. Optional terminal UI for Claude Code parity. (Note 01 §2.1, §2.21.)

### 5.11 Lower priority
Fast/deep model routing (only if evaluated), fake-tool-call guard for local models, saved background workflows, self-hosted search (SearXNG), keychain credential provider.

## 6. Research questions and evaluation (final-year project)

Proposed questions (details, metrics, baselines in note 07):

- **RQ1 Surface integrity.** Does full-surface pinning detect malicious drift better than description-only pinning, at an acceptable false-alert rate on real benign upgrades? Build a drift corpus from real MCP server release histories; measure detection, false alerts, time-to-detect (polling vs event-driven), and quarantine vs per-tool narrowing.
- **RQ2 Deterministic policy vs injection.** Do capability scopes, approval gating, taint escalation, and secret handoff reduce attack success on AgentDojo (97 tasks, 629 attacks) and MCPTox/MSB subsets, including an adaptive attacker, and at what utility cost? A planted canary secret must never appear in the log.
- **RQ3 Memory.** Does the file-first hybrid memory improve LongMemEval_S accuracy (about 100 stratified questions, seven arms plus a MemOS local-plugin arm) at a reported token and latency budget, and does the quarantine gate keep poisoning to zero committed memories without user approval, compared with MemOS's capture-every-turn design?
- **RQ4 Extensibility.** Are new capabilities added with zero agent-loop and system-prompt changes (diff counts per feature)?
- **RQ5 Overhead and latency.** Per-call cost of pinning and capability checks; voice end-to-end latency.
- **RQ6 Usability.** Small within-subjects study (n about 8–12): argument-aware approval prompts vs generic prompts, SUS, task success.

Budget estimate from note 07 (assumed token counts, replace after a pilot): about $4 per AgentDojo configuration run at `deepseek-flash` off-peak prices, about $50 for four configurations times three runs. OSWorld and full SWE-bench are out of scope.

## 7. Roadmap (October 2026 – May 2027)

| Month | Milestone |
|---|---|
| Oct 2026 | Add `upstream` remote; AIR product profile and bundle with DeepSeek coupling off and local model default; connect AIR calendar and bluetooth MCP servers; universal file-convention loader, first slice: skills, agents, commands, `.mcp.json`, hooks (5.1) |
| Nov 2026 | `mcp-trust` pinning (5.2) with the 27 tests; drift corpus collection |
| Dec 2026 | Capability scopes, argument-aware approval, rule store, MCP server sandboxing (5.3); RQ1 runs |
| Jan 2027 | Memory seam (5.4) and desktop context tier 0–1 (5.5); RQ3 runs |
| Feb 2027 | Voice: enable upstream `voice-input-bundle`, add GPU STT provider and Kokoro TTS seam (5.6); tray on Linux/macOS, global hotkey, notifications. **MVP cut line** |
| Mar 2027 | OS control Linux provider (5.7); secret handoff (5.9); RQ2 AgentDojo runs |
| Apr 2027 | Signals and triggers (5.8); Markdown routines on upstream `schedule`; RQ4–RQ6; write-up |
| May 2027 | Open-source launch, viva demo |

Stretch: Markdown-compiled enforcement and skill trigger evals (5.1a), egress control, taint escalation, CaMeL-style mode, signed plugin index, macOS/Windows providers, wake word, messaging gateway.

## 8. Open-source product checklist (summary of note 07)

One-command install; quickstart that works with a local model; clear SAFETY.md and published threat model; privacy statement for local data; CONTRIBUTING with the out-of-tree plugin path and starter templates; plugin and skill templates; example routines and skills; semantic versioning and release notes; issue and discussion channels; opt-in telemetry only; attribution to deepseek-harness and MIT notice kept; own product name and marks.

## 9. Open questions for the user

1. Department rubric and real submission deadlines (the roadmap assumes April–May 2027).
2. GPU access beyond the RTX 4060 laptop for local-model runs.
3. Target paper venue, if any.
4. User study design: comparison against a commercial assistant, or policy-on vs policy-off within subjects.
5. Product name (trademark search).
6. Whether AIR packages keep the upstream bilingual-documentation gate (recommendation: keep coverage and README templates, drop Chinese pairing for out-of-tree packages).

## 10. Immediate next tasks

1. Done: MemOS DSH integration checked (section 5.4).
2. Done: `research/` passes all `pnpm run test:docs` gates when tracked (translation pairing does not require pairs for it; the banned-term and commit-hash findings were fixed in the notes), so no gate exclusion is needed.
3. Add `upstream` remote, create `air/main` and the `air/` workspace, and create the `air` profile and bundle from note 08 §2 (coupling rows off, local Ollama route in the profile patch). Check `~/.dsh/profiles/web/package.json`: it carries `patchReload: "live"`, which no current source reads.
4. Smoke-test the AIR calendar MCP server through `mcp-client`.
5. Start `mcp-trust` with the description-only rug-pull test.
