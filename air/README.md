# AIR workspace

New here? Read [ONBOARDING.md](ONBOARDING.md) first. On native Windows, follow [WINDOWS.md](WINDOWS.md). Coding agents start with [AGENTS.md](AGENTS.md).

## What AIR is

AIR is the working name of a local-first personal agent. It is built on a fork of an MIT-licensed upstream agent harness and delivered as a set of plugins and bundles that run inside the upstream project's Electron desktop app. The default model runs on your own machine through Ollama, project files written for other agents (a `.claude` folder and `.mcp.json`) are read unchanged, and project MCP servers are pinned and reviewed before their tools reach the model. The plan and its evidence are in [research/research.md](../research/research.md).

## Status

Last verification dates and the environment of each check are in [CHECKS.md](CHECKS.md). On native Windows only setup and a first prompt in the desktop app were run by hand (2026-10-20); the Windows row below says what else is covered.

| Capability | Desktop app | Web UI | Headless | Checked how |
|---|---|---|---|---|
| Launch with the AIR bundle and local model | Works on Linux from source | Works | Works | Run by hand on Fedora (2026-10-12) |
| Skills, instructions, rules, commands, `.mcp.json` | Works | Works | Works | Run by hand on Fedora; headless by one scripted task |
| MCP trust (approve, diff, pin) | Works | Works | Pre-pin only | Run by hand on Fedora |
| Preset `air-lean` by default, `air` by hand or by model | Works | Works | Lean only | Run by hand; selection logic also unit tested |
| Compaction with a chronological log, visible row | Works | Same client | Compaction only | Run by hand on `qwen3-8b-32k` |
| Thinking off by default, "Medium" per session | Works | Works | Off | Run by hand |
| Voice agent (preview) | Windows only; not on Linux | n/a | n/a | Unit tests and parts run by hand on Windows; the four review scenarios are not recorded ([apps/voice/README.md](apps/voice/README.md)) |
| Memory (trimmed plan 04) | Rows in the `air` bundle | Same | Not checked | Unit tests |
| Windows | Launch and first prompt work; features not checked by hand | Not yet run by a person | Not yet run by a person | Run by hand once (2026-10-20); Windows CI leg: install, build, typecheck, lint, tests, profile smokes |
| Installer, tray, menus, updater | Not done | n/a | n/a | No installer on any OS; tray, menus, and updater unchecked on Linux |
| Hosted (cloud) models | Untested | Untested | Untested | Not run |

## Quick start: desktop app

Prerequisites: Linux, Node `^22.19` or `>=24`, Git 2.26 or newer, pnpm exactly `11.28.5` (a globally installed pnpm 12 rewrites `package.json` and the lockfile; install the pinned one with `npm install -g pnpm@11.28.5`), about 10 GB of free disk, and [Ollama](https://ollama.com). The AIR workspace pins pnpm `11.7.0` and selects it by itself. Native Windows teammates use [WINDOWS.md](WINDOWS.md).

```sh
git clone git@github.com:HXMAN76/AIR-harness.git
cd AIR-harness
git switch air/main
pnpm install && pnpm run build           # root build; several minutes
pnpm -C air install && pnpm -C air run build
```

Create the local model once (details under [Local models](#local-models)):

```sh
ollama pull qwen3:8b
printf 'FROM qwen3:8b\nPARAMETER num_ctx 32768\n' > Modelfile
ollama create qwen3-8b-32k -f Modelfile
```

Then run the two commands:

```sh
pnpm -C air run desktop:setup            # idempotent; adds the AIR bundles to the desktop profile
pnpm -C air run desktop                  # upstream's development launcher
```

`desktop:setup` works on the harness home the development launcher uses: `$DSH_HOME` if set, otherwise `apps/desktop/.desktop-build/development/home` inside the checkout. The launcher never uses `~/.dsh`, so this home is separate from the Web profile's. The script adds two `link:` dependencies and two names to `dsh.profile.bundles` in the profile's `package.json`, runs `pnpm install` in the profile directory, writes the Ollama route from `examples/ollama.profile.cordis.patch.yml` when the profile patch is absent or empty (otherwise it prints what to add), and adds `OLLAMA_API_KEY=ollama` to `$DSH_HOME/.env` when the variable is absent. Every file it changes is first copied to `<name>.bak-<timestamp>`, and it prints each change. It refuses, changing nothing, when the profile's `package.json` is not a profile manifest it understands.

The first launch downloads and builds a Node, pnpm, and Python runtime payload: about 128 MB downloaded and about 455 MB on disk under `apps/desktop/.desktop-build`, which git ignores. Later launches reuse it.

What you should see: a window with the composer and no sign-in wall, the preset "AIR Lean", the model `qwen3-8b-32k`, and effort Off. The window shows upstream's name and icon, because the product name is undecided ([BRANDING.md](BRANDING.md)). The app creates a default workspace under the system Documents folder (`<Documents>/deepseek-harness/default-workspace` on Linux). To move it, set `documentsDirectory` in the profile patch (`$DSH_HOME/profiles/desktop/cordis.patch.yml`):

```yaml
- id: workspace-controller
  config:
    documentsDirectory: /absolute/path/to/a/folder
```

Why a script and a second bundle: upstream refuses `dsh plugin add` for the `desktop` profile because the app manages that profile, and the app keeps a `package.json` edited this way across restarts. The AIR bundle turns off `deepseek-account` and `account-controller`, but the desktop app reads the account state while it starts; without them the window shows "desktop welcome: Web request failed". The bundle `air-desktop` turns those two rows back on and nothing else. Signed out they answer from the local credential store and contact no vendor service.

On Linux this is a development launch from source, not an installed app: there is no installer, no menu entry, and the checkout must stay in place. The in-tree edit that lets upstream's launcher accept Linux is listed in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md).

## Web UI

The Web UI must keep working beside the desktop app. It uses the `air` profile under `~/.dsh`:

```sh
pnpm dsh --profile air --from-default-profile web --dump-config > /dev/null   # create the profile from the Web template; rerunning it resets the profile
pnpm dsh plugin --profile air add "$PWD/air/bundles/air"
cp air/examples/ollama.profile.cordis.patch.yml ~/.dsh/profiles/air/cordis.patch.yml
echo 'OLLAMA_API_KEY=ollama' >> ~/.dsh/.env
pnpm dsh --profile air --dump-config                  # inspect the composed tree
pnpm dsh --profile air                                # boot the Web UI on http://127.0.0.1:3080
```

For browser automation of the Web UI, add `--patch apps/web/tests/pin-browse-picker.overlay.yml`; "Add workspace" then opens an in-page folder picker instead of a native dialog. The bundle disables the upstream rows that send data to, or depend on accounts with, the upstream vendor's services, and makes a local Ollama model the default; see [bundles/air/cordis.patch.yml](bundles/air/cordis.patch.yml).

## Headless profile

The headless profile runs one task per command-line invocation, for evaluations and scripted runs: no window and no server. It is made from upstream's `headless` template plus the bundle `bundles/air-headless`, added INSTEAD of `bundles/air`. Upstream's headless composition has no agent-preset registry, so three patch targets of the `air` bundle do not exist there (`account-controller`, `ui-settings-account`, `agent-preset-registry`) and `preset-air` would wait forever.

```sh
pnpm dsh --profile air-headless --from-default-profile headless --dump-config
pnpm dsh plugin --profile air-headless add "$PWD/air/bundles/air-headless"
cp air/examples/ollama.profile.cordis.patch.yml ~/.dsh/profiles/air-headless/cordis.patch.yml
echo OLLAMA_API_KEY=ollama >> ~/.dsh/.env                                  # once
pnpm dsh --profile air-headless "Create notes.md with one line saying the project started today."
pnpm dsh --profile air-headless --json "task"                              # newline-delimited events
```

Run from the repository root of a source checkout; the agent works in the launcher's current directory. To work in another project, set `TSX_TSCONFIG_PATH` to the root `tsconfig.json`, change into that project, and call `node --import <repo>/node_modules/tsx/dist/esm/index.mjs <repo>/apps/cli/src/bin.ts --profile air-headless "task"` (checked on Linux). The permission mode is upstream's default (Workspace Write).

- The convention plugins and MCP trust are rows of the composition itself, not entries of a preset, so the one-shot agent reads `.claude/CLAUDE.md`, `.claude/rules`, `.claude/skills`, and `.claude/commands` as the other surfaces do.
- The lean tool set is the default (no goal, subagent, or workflow tools; the composition has no schedule tool). A test checks the list against `scripts/gen-preset-air-lean.ts`. To get the full set, set `disabled: false` on those rows in the profile patch.
- The default model is `qwen3-8b-32k`. Headless has no model option; change `agent-default-model` in the profile patch to run another model. The compaction policies come from the same table as the other surfaces.
- Nobody can answer the first-use MCP approval prompt, so a project server with no pin registers no tools. Pin it before the run with `pnpm dsh --profile air-mcp pin <server>` and approve it (see [MCP trust](#mcp-trust)). A server whose tool definitions change after pinning is rejected, not asked about.
- No agent presets, no preset switching, no schedule tool, no interactive follow-up. The `--session-id` resume path refuses sessions recorded under an agent preset.

## Presets

Two agent presets are registered, both copies of the upstream `standard` preset with the convention plugins added ([bundles/air/cordis.patch.yml](bundles/air/cordis.patch.yml)).

| Preset | Label | Omits | Measured request (2026-10-12) |
|---|---|---|---|
| `air-lean` (default) | AIR Lean | schedule tools, delegation (`subagent`, `subagent_fork`, `list_agents`, `send_message`, `interrupt_agent`, workflow tool), goal command and tool | 19 tools, 4,426 prompt tokens |
| `air` | AIR | nothing | 32 to 36 tools, about 7,700 to 8,100 prompt tokens |

The `preset-air-lean` plugin list is generated from `preset-air` by `scripts/gen-preset-air-lean.ts`, because a YAML anchor cannot drop items from a list. After editing `preset-air`, run `pnpm -C air run gen:lean`; `pnpm -C air run lint` checks that the generated block is current. After every upstream merge, run `pnpm -C air exec vitest run scripts/tests/preset-air-drift.spec.ts`; a failure names the upstream row to re-copy into `preset-air`. `pnpm -C air run check:composition` confirms the composed profile.

Automatic selection (`@air/dsh-preset-by-model`, see [its README](packages/preset-by-model/README.md)): a new session, and a blank session whose model is changed in the composer, gets `air-lean` for a model whose context window is below 65,536 tokens and `air` otherwise. A preset the user picks in the composer, a default set in Settings, or a preset requested at session creation always wins, and nothing changes once the first message is sent. When a model's window is unknown, the default stays.

## Local models

Ollama's default context is 4,096 tokens, and a request longer than that is truncated silently. The agent's fixed prompt alone is 4,400 tokens or more, so every local model needs its own Ollama variant: a Modelfile with `FROM <base>` and `PARAMETER num_ctx <context>`. The profile patch needs a model row whose `contextWindow` equals that `num_ctx`, and `scripts/gen-compaction-policies.ts` needs an entry for the id. The ids below have all three.

| Variant id | Base model | Context |
|---|---|---|
| `qwen3-8b-32k` (default) | `qwen3:8b` | 32,768 |
| `qwen3-8b-16k` | `qwen3:8b` | 16,384 |
| `qwen35-4b-32k` | `qwen3.5:4b` | 32,768 |
| `qwen35-9b-24k` | `qwen3.5:9b` | 24,576 |
| `qwen25-7b-32k` | `qwen2.5:7b-instruct` | 32,768 |
| `gemma4-e4b-32k` | `gemma4:e4b-it-qat` | 32,768 |
| `granite42-8b-16k` | `granite4.2:8b` | 16,384 |
| `granite42-3b-32k` | `granite4.2:3b` | 32,768 |
| `llama31-8b-16k` | `llama3.1:8b` | 16,384 |

Only `qwen3-8b-16k` and `qwen3-8b-32k` on the lean preset were run; the other rows use the same arithmetic. Create the second default-candidate variant like the first:

```sh
printf 'FROM qwen3:8b\nPARAMETER num_ctx 16384\n' > Modelfile
ollama create qwen3-8b-16k -f Modelfile
```

Speed and context trade-off (8 GB GPU): `qwen3-8b-32k` is the default and runs at about 15 tokens per second. `qwen3-8b-16k` runs at about 33 tokens per second but is tight, because the fixed prompt plus the 4,096-token reply reserve leaves little room. The bundle default in `bundles/air/cordis.patch.yml` is `qwen3-8b-32k`.

Thinking: Qwen 3 models have thinking off by default in AIR (the route sets `reasoning: off`, `reasoningEfforts` maps `off` to `none` and `medium` to `medium`, and `compat.supportsReasoningEffort` is true). With thinking on, Qwen 3 emitted a stray `/think` on short prompts and spent seconds reasoning; with it off, one test showed short replies in 0.3 to 0.4 seconds instead of 2.6 to 4.4. Choose "Medium" in the model menu to turn thinking on for the current session. `@air/dsh-effort-session-only` saves the picked provider and model as the default, as upstream does, but not the effort, so a one-off "Medium" does not become the default of later sessions. A default effort that an earlier pick already saved in a profile has to be removed by hand.

Compaction and its limits:

- Before 2026-10-12 compaction never ran on local models: its default headroom of 65,536 tokens made the threshold `min(window x thresholdRatio, window - reservedOutput - headroomTokens)` negative for 16K and 32K windows, it was skipped, and replies were cut off. The `modelPolicies` block of `compaction-basic` now overrides `headroomTokens`, `retainTokens`, and `maxTokens` (the summary's output limit) per exact provider and model, in both presets and the headless bundle. The values come from `scripts/gen-compaction-policies.ts`, which writes the blocks between marker comments; `scripts/gen-preset-air-lean.ts` calls it, and `pnpm -C air run lint` checks both.
- Measured on the lean preset: at 16K, compaction starts at about 9,000 tokens, replies are capped near 3,000 tokens, and history is pruned and summarised about every three turns when tool results are large. At 32K the threshold is 20,000 tokens and replies keep 4,096 tokens.
- Once the threshold is crossed, a tool result over 8,192 characters is cut to its head and tail in the model's view. The original stays in the session log. The app does not show this trimming.
- The compaction rows run `@air/dsh-compaction-log` (row id `compaction-basic`), which appends to the summary instruction a numbered Chronological Log of every user request and tool call (capped at `logMaxEntries`, default 60, oldest merged) and a verbatim First request line (cut to `firstRequestMaxChars`, default 300). Without it the 8B model's summary lost early details and named the wrong first file. The log is written by the small model, so a long session can still lose steps.
- The app shows a "Context compacted" row. An in-tree one-line `ui-chat` change keeps it outside collapsed tool groups ([UPSTREAM-DELTA.md](UPSTREAM-DELTA.md)).
- The full preset on a 16K window is not recommended: its fixed prompt is about 9,500 tokens. The full-preset values and the 24K values were derived, not run. Models not in the table get no compaction. Hosted models keep upstream defaults and were not tested.

## Project conventions

AIR reads the folders other coding agents use, so a project works unchanged:

| File or folder | Read as |
|---|---|
| `.claude/CLAUDE.md` (with `@path` imports) | Project instructions |
| `.claude/rules/*.md` | Rules, including path-scoped ones |
| `.claude/skills/<name>/SKILL.md` | Skills |
| `.claude/commands/<name>.md` | Slash commands with `$ARGUMENTS` |
| `.mcp.json` | Project MCP servers, each needing approval |

A minimal example project (`pnpm -C air run demo` creates a scratch project with a skill, a command, instructions, a rule, and a `.mcp.json` server; the file contents below are illustrative):

```text
my-project/
  .claude/CLAUDE.md                 "Reply in one sentence. See @notes.md."
  .claude/skills/hello/SKILL.md     name: hello, description, "Greet the user by name."
  .claude/commands/issue.md         "Summarise issue $ARGUMENTS in one sentence."
  notes.md                          project facts imported by CLAUDE.md
  .mcp.json                         { "mcpServers": { "demo": { "command": "node", "args": ["server.mjs"] } } }
```

User-level folders written for other agents (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/CLAUDE.md`) are not read by default, because a large unrelated skill catalog derails small local models. `~/.air/skills` and `~/.air/commands` are always read. To opt in, add `includeUserRoots: true` to the `air-command-conventions` row in the profile patch, and copy the `preset-air` row (and `preset-air-lean`) from the bundle patch into the same file with `includeUserRoots: true` on the `air-skill-conventions` and `air-instruction-conventions` configs. A patch replaces a row's whole `config`, so the full plugin list must be repeated.

## MCP trust

Servers from a project's `.mcp.json` need two approvals before the model sees their tools.

1. Approve that the server may start: `/mcp approve <server>`. Run it before the first message of a session. Approvals are stored in `$DSH_HOME/air/mcp-approvals.json`.
2. Approve the tool list. Either answer the prompt at the first use, or run `/mcp-trust diff <server>` and then the `/mcp-trust pin ...` command it prints (the command carries a short surface code, so a surface that changed after you read it cannot be pinned by mistake).

`/mcp-trust status` lists the state of every server. The shipped mode is `enforce`: a server with no pin registers nothing, and a pinned server whose tool definitions change is quarantined until reviewed. Pins live in `$DSH_HOME/air/mcp-lock.json` and audit records in `$DSH_HOME/air/mcp-audit`. Every mcp-client row must declare `inject: [mcpToolReview]`; see [examples/mcp-filesystem.profile.cordis.patch.yml](examples/mcp-filesystem.profile.cordis.patch.yml).

From the command line, the `air-mcp` profile uses the bundle `bundles/mcp-servers`, which holds the same trust row and shares the lockfile: `pnpm dsh --profile air-mcp diff <server>`, then `pin <server>`; `verify --all` is the CI check and `revoke <server>` removes approvals. Details: [packages/mcp-trust/README.md](packages/mcp-trust/README.md) and [packages/mcp-trust-cli/README.md](packages/mcp-trust-cli/README.md).

## Layout of the `air/` workspace

`air/` is a separate pnpm workspace outside upstream's workspace globs, so upstream's workspace constraints, coverage, and bilingual-documentation gates do not apply to it. Two repository-wide text gates still scan it: `verify-concrete-terms` and `verify-repository-references`.

| Path | Purpose |
|---|---|
| `packages/convention-core` | Shared discovery library for the convention plugins |
| `packages/skill-conventions` | Skill provider: `.claude/skills`, project skill roots, `~/.air/skills` |
| `packages/instruction-conventions` | `.claude/CLAUDE.md`, `@path` imports, `.claude/rules` |
| `packages/mcp-conventions` | `.mcp.json` servers per Agent, with approval (`/mcp`) |
| `packages/command-conventions` | `.claude/commands` with `$ARGUMENTS` |
| `packages/mcp-trust` | Review hook provider: lockfile, pinning, guard, `/mcp-trust` |
| `packages/mcp-trust-cli` | `diff`, `pin`, `verify`, `revoke` command line |
| `packages/preset-by-model` | Picks `air-lean` or `air` from the selected model's context window |
| `packages/effort-session-only` | Keeps a reasoning-effort pick in the session, not in the saved default |
| `packages/compaction-log` | Compaction engine whose summaries keep a chronological log and the first request |
| `packages/memory-store` | Memory files: Markdown with frontmatter in a git repository |
| `packages/memory-index` | Derived SQLite FTS5 index with BM25 keyword search |
| `packages/tool-memory` | memory_search, memory_read, memory_write, memory_forget |
| `packages/tool-open` | `open` tool (app, url, search) and the app and URL whitelist shared with the voice app |
| `packages/memory-context` | Pinned memory core, injected once per session |
| `bundles/air` | Product defaults as a Cordis patch (Web and desktop) |
| `bundles/air-desktop` | Layered after `air` in the desktop profile; keeps the two account rows the desktop app needs at boot |
| `bundles/air-headless` | AIR defaults and plugins for a profile made from the headless template |
| `bundles/air-mcp` | The `air-mcp` command-line profile |
| `bundles/mcp-servers` | The MCP trust row shared by `air` and `air-mcp` |
| `apps/voice` | Wake-word voice companion: Electron, keyword spotter, Parakeet and IndicConformer, Windows SAPI |
| `scripts/` | Generators, smoke tests, `setup-desktop-profile.ts`, `desktop-drive.mjs` |
| `examples/` | Profile-patch examples, such as the local Ollama route |
| `plans/` | Roadmap, implementation plans, and API spikes |
| `UPSTREAM-DELTA.md` | Every file AIR changes outside `air/` and `research/` |

## Toolchain

Run the root build first; AIR packages link to its `lib/` outputs. Branches: `master` mirrors upstream and is fast-forwarded only at upstream release tags; `air/main` carries AIR work.

```sh
pnpm install && pnpm run build        # repository root
pnpm -C air install                   # AIR workspace (pnpm 11.7.0, lockfile committed)
pnpm -C air run build                 # every AIR package
pnpm -C air run typecheck
pnpm -C air run lint                  # fails if a generated file is stale; regenerate with lint:gen, gen:lean, gen:policies
pnpm -C air run test
pnpm -C air run smoke                 # isolated DSH_HOME: compose and boot the AIR bundle, air-mcp, and air-headless
pnpm -C air run check:composition
```

New packages follow the templates in [plans/spikes/01-toolchain.md](plans/spikes/01-toolchain.md). AIR packages keep ESM-only modules, the package README template (Summary, Model Experience, Known Limitations), real-composition Loader tests for product-visible plugins, and 100% per-file coverage. They do not need Chinese translation pairs. CI: the fork's own `air` workflow runs on Linux and Windows and is the signal for AIR work; see [ONBOARDING.md](ONBOARDING.md) for the expected red mark from upstream's workflow.

## Testing the desktop app

`air/scripts/desktop-drive.mjs` is a manual test aid that drives a running desktop app through Electron's renderer debugging port; it is not part of the product. Start the app with `DSH_DESKTOP_RENDERER_DEBUG_PORT` set, and set `AIR_DESKTOP_DEBUG_PORT` to the same value when it is not the default 9222. Run it with no arguments to list its subcommands.

```sh
node air/scripts/desktop-drive.mjs title
node air/scripts/desktop-drive.mjs send "/mcp-trust status"
```

## Memory

AIR remembers through files. Each note is a Markdown file with frontmatter under `$DSH_HOME/air/memory/` (default `~/.dsh/air/memory/`, `%USERPROFILE%\.dsh\air\memory\` on Windows), and that directory is a git repository with one commit per write: `git -C <that folder> log -p` is the audit trail, `git revert` the undo. If git is missing or fails, notes are still saved as plain files and the tool result says so. The search index at `$DSH_HOME/cache/air/memory-index.sqlite` is derived and can be deleted.

The model writes a note only through `memory_write`. In the Read Only, Workspace Write, and Auto review access modes the user confirms each write and each `memory_forget` in the approval panel; in Full access nobody can be asked, so notes are stored as low-trust (`agent-inferred`), `feedback` notes and permanent deletes are refused. Every session starts with a pinned core of the user's notes (about 1,500 tokens at most, frozen for the session); deeper recall goes through `memory_search`, which uses keyword (BM25) ranking through the FTS5 index.

Memory text is sent to the active model, so it is shared only with the model routes in `shareWith` on the `air-memory-store` row (default: the local `ollama` route). A session on a hosted model gets no pinned core and cannot search or read notes until its provider id is added there.

Back up or move notes with `pnpm -C air run memory:transfer export <file>` and `import <file>`. Rows: `air-memory-store`, `air-memory-index` (host), `air-tool-memory`, `air-memory-context` (inside the `air` preset). Forgetting a note does not remove text that already entered a session log; delete the session for that.

## Voice agent (preview)

A voice companion that captures the microphone, spots the wake word "Jarvis" with a small keyword model (speech without it is never transcribed), transcribes the command after it (English: Parakeet; Tamil: IndicConformer), sends it to a dsh session through the SDK, and speaks the reply through Windows SAPI. The default route is local Ollama; the cloud routes (Ollama Cloud, model `minimax-m3.1-flash`, with computer use on the screen route) are opt-in and need `OLLAMA_CLOUD_KEY`.

```powershell
pnpm -C air/apps/voice install
pnpm -C air/apps/voice exec tsx scripts/fetch-models.ts
pnpm -C air/apps/voice exec tsx scripts/setup-home.ts
pnpm -C air/apps/voice build
pnpm -C air run voice
```

Models live in `%USERPROFILE%\.air\voice-models\<name>\` and are never downloaded at launch. The voice home is `%USERPROFILE%\.air\voice-home` (separate from the desktop app); the agent works in `<Documents>\AIR Voice`.

Four voice commands are handled by the app itself (the model never sees them):

| Command | Phrases |
|---|---|
| Switch route | "use the local model", "use the cloud model", "use the screen model" |
| New conversation | "new conversation", "start a new conversation" |
| Cancel | "cancel", "cancel that", "never mind" |
| Memory sharing | "share memory with the cloud", "stop sharing memory" |

Simple PC commands ("open notepad", "volume up", "lock screen") run locally without the model; closing an app and locking the screen ask for a spoken "yes" first. Anything else after the wake word ("Jarvis", "hey Jarvis", "OK Jarvis") is sent to the agent. The model's reply is spoken aloud and shown in the transcript pane.

Windows only; requires SAPI voices and microphone permissions. Details, setup for cloud routes, and troubleshooting: [apps/voice/README.md](apps/voice/README.md).

## Known limitations

- On native Windows the desktop app was launched and answered one prompt (2026-10-20); MCP trust, skills, commands, compaction, and the Web UI are not checked there. macOS is out of scope.
- On Linux the desktop app is a development launch from source. There is no installer on any OS, no menu entry, and the window shows upstream's name and icon. Tray, menus, and updater are unchecked on Linux.
- The desktop app keeps its data in its own development home, separate from the Web profile's `~/.dsh`.
- Hosted (cloud) models are untested.
- Each request is about 4,400 tokens on the lean preset and 7,700 to 8,100 on the full preset before any conversation, which is a large share of a 16K window.
- Large tool results are trimmed to head and tail in the model's view after the compaction threshold, and the app does not show it.
- A compaction summary written by a small model can still lose steps in a long session.
- Models not listed in the variants table get no compaction until they have a table entry.
- One reply in one 7-turn session was cut off with "Output token limit reached" (before the compaction fixes); it did not repeat and its cause is not known.
- Headless: no presets, no schedule tool, no answerable MCP prompt, no resume of preset sessions.
- The voice agent is a Windows-only preview: the wake word is a general keyword model, not one trained for "Jarvis", the cloud and screen routes are untested by a person, and nobody can answer an approval prompt by voice.
- Not covered by any check: path-scoped rules, `revoke` in the app, a pinned server that later changes its tools, and the benchmark raw data from 2026-10-10, which was lost (the figures are summaries).

## Where to read more

- [ONBOARDING.md](ONBOARDING.md): first-day checklist and how the team works.
- [CHECKS.md](CHECKS.md): dated verification log.
- [plans/README.md](plans/README.md): roadmap, decisions, plan index.
- [../research/research.md](../research/research.md) and `../research/notes/`: evidence.
- [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md), [BRANDING.md](BRANDING.md), [AGENTS.md](AGENTS.md).
