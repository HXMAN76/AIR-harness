# AIR workspace

AIR-owned code for the AIR local-first personal agent, built on a fork of an MIT-licensed upstream agent harness. The plan and its evidence live in [research/research.md](../research/research.md); the development guide is [research/notes/08-dev-contrib-guide.md](../research/notes/08-dev-contrib-guide.md).

New here? Start with [ONBOARDING.md](ONBOARDING.md); coding agents start with [AGENTS.md](AGENTS.md).

## Layout

```
air/
  pnpm-workspace.yaml     separate pnpm workspace (bundles/*, packages/*)
  bundles/air/            @air/dsh-air-bundle: product defaults as a Cordis patch
  bundles/air-desktop/    @air/dsh-air-desktop-bundle: layered after air in the desktop profile; keeps the two rows the desktop app needs at boot
  bundles/air-headless/   @air/dsh-air-headless-bundle: the AIR defaults and plugins for a profile made from the headless template (scripted runs)
  packages/convention-core/          shared discovery library for the convention plugins
  packages/skill-conventions/        skill provider: .claude/skills, project skill roots, ~/.air/skills
  packages/instruction-conventions/  .claude/CLAUDE.md, @path imports, .claude/rules
  packages/mcp-conventions/          .mcp.json servers per Agent, with approval (/mcp)
  packages/command-conventions/      .claude/commands with $ARGUMENTS
  packages/preset-by-model/          picks air-lean or air from the selected model's context window
  packages/compaction-log/           compaction engine whose summaries keep a numbered chronological log and the first request
  packages/effort-session-only/      keeps a reasoning-effort pick in the session instead of saving it as the default
  apps/                   AIR desktop app and its Host entry (plan 07; not built yet)
  plans/                  roadmap, implementation plans, and API spikes
  examples/               profile-patch examples, e.g. the local Ollama route
  UPSTREAM-DELTA.md       every file AIR changes outside air/ and research/
```

This directory sits outside the upstream workspace globs (`packages/*/*`, `apps/*`), so upstream's workspace constraints, coverage, and bilingual-documentation gates do not apply here. Two repository-wide text gates still scan it: `verify-concrete-terms` and `verify-repository-references`.

## Branches

- `master` mirrors upstream (`upstream` remote) and is fast-forwarded only at upstream release tags.
- `air/main` carries AIR work and merges `master` at each upstream release tag.

After each merge: `pnpm install`, `pnpm run build`, bump AIR peer ranges, run `pnpm dsh --profile air --dump-config` and check stderr for unmatched patch targets, boot once, run AIR tests.

## The `air` profile

```sh
pnpm dsh --profile air --from-default-profile web     # create the profile from the Web template
pnpm dsh plugin --profile air add "$PWD/air/bundles/air"
cp air/examples/ollama.profile.cordis.patch.yml ~/.dsh/profiles/air/cordis.patch.yml
echo 'OLLAMA_API_KEY=ollama' >> ~/.dsh/.env
pnpm dsh --profile air --dump-config                  # inspect the composed tree
pnpm dsh --profile air                                # boot the Web UI
```

The example patch declares two variants of `qwen3:8b` and makes `qwen3-8b-32k` the default model. Neither exists until you create it. After `ollama pull qwen3:8b`, create both once from Modelfiles, because Ollama's default 4,096-token context truncates the agent's prompt silently:

```sh
cat > Modelfile <<'EOF'
FROM qwen3:8b
PARAMETER num_ctx 32768
EOF
ollama create qwen3-8b-32k -f Modelfile
cat > Modelfile <<'EOF'
FROM qwen3:8b
PARAMETER num_ctx 16384
EOF
ollama create qwen3-8b-16k -f Modelfile
```

`qwen3-8b-32k` is the default because the fixed prompt plus the 4,096-token reply reserve leaves too little room on 16K. `qwen3-8b-16k` is faster (about 33 versus 15 tokens per second on an 8 GB GPU) and can be selected in the app. The bundle default in `bundles/air/cordis.patch.yml` is also `qwen3-8b-32k`, because plain `qwen3:8b` runs at a 4,096-token context and truncates.

### Local model variants

Each local model needs its own Ollama variant (a Modelfile with `FROM <base>` and `PARAMETER num_ctx <context>`), a model row in the profile patch whose `contextWindow` equals that `num_ctx`, and an entry in the compaction table in `scripts/gen-compaction-policies.ts`. The ids below have a compaction entry.

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

Any other local model needs its own variant and, until compaction settings are derived from the model's window, an entry in that table to get compaction. Only `qwen3-8b-16k` and `qwen3-8b-32k` on the lean preset were run; the other rows use the same arithmetic.

### Compaction on local models

Conversation compaction (`@deepseek-ai/dsh-compaction-basic`) never ran on local models before 2026-10-12. Its default headroom of 65,536 tokens makes the threshold `min(window x thresholdRatio, window - reservedOutput - headroomTokens)` negative for 16K and 32K windows; that throws, is warned once, and compaction is skipped. Without compaction the provider library cut the reply budget (`max_tokens = min(maxTokens, window - estimate - 4096)`) to 1 token and replies were cut off.

The `modelPolicies` block of `compaction-basic` now overrides `headroomTokens`, `retainTokens`, and `maxTokens` (the summary's output limit) per exact provider and model, in both presets. The values come from one table in `scripts/gen-compaction-policies.ts`, which writes the blocks between marker comments; `scripts/gen-preset-air-lean.ts` calls it, and `pnpm -C air run lint` checks both. As measured on the lean preset:

- Compaction runs on the listed local models. The lean preset on 16K starts compaction at about 9,000 tokens, so replies are capped near 3,000 tokens, and history is pruned and summarised about every three turns when tool results are large. At 32K the threshold is 20,000 tokens and replies keep 4,096 tokens.
- Once the threshold is crossed, a tool result over 8,192 characters is cut to its head and tail. The original stays in the session log.
- After compaction the 8B model's summary loses early details; in the test it named the wrong first file. The compaction rows therefore run `@air/dsh-compaction-log` (same row id `compaction-basic`, same policies), which appends one section to the summary instruction: a numbered Chronological Log of every user request and tool call in order, carried forward from earlier summaries and capped at `logMaxEntries` (default 60, oldest merged), plus a verbatim First request line cut to `firstRequestMaxChars` (default 300). A replay of a saved summary request listed all four files in order. Summaries are longer by the log, about 160 tokens in that case.
- The app shows a "Context compacted" row when compaction happens (an in-tree `ui-chat` change makes it visible outside the collapsed tool groups; see `UPSTREAM-DELTA.md`).
- The full preset on a 16K window is not recommended: its fixed prompt is about 9,500 tokens and no threshold can both fit it and keep a full reply. The full-preset values and the 24K values were derived, not run.
- Models not in the table get no compaction. Hosted models keep the upstream defaults, which suit large windows, and were not tested.

The example patch turns thinking off for this model (`reasoning: off` on the route, `reasoningEfforts` mapping `off` to `none` and `medium` to `medium`, and `compat.supportsReasoningEffort: true`). With thinking on, Qwen 3 emitted a stray `/think` on short prompts and spent seconds reasoning; with the setting, one test showed short replies in 0.3 to 0.4 seconds instead of 2.6 to 4.4. Choose "medium" in the app's effort control to turn thinking on for a session. An effort pick applies to that session only: `@air/dsh-effort-session-only` saves the picked provider and model as the default, as upstream does, but keeps the effort configured in the `agent-default-model` row (or the provider's `reasoning` setting), so a one-off "medium" does not become the default of later sessions.

### Cloud models

A user can add an API key and select a hosted model. Hosted models have large context windows, so the full `air` preset is the appropriate choice there. The `air-preset-by-model` plugin chooses it automatically: a new session, and a blank session whose model is changed in the composer, gets `air-lean` for a model whose context window is below 65,536 tokens and `air` otherwise. A preset the user picks in the composer, a default set in Settings, or a preset requested at session creation always wins, and nothing changes once the first message is sent. When the window of a model is unknown the default stays. See [packages/preset-by-model](packages/preset-by-model/README.md) for the rules and limits.

For browser automation of the Web UI, start it with `pnpm dsh --profile air --patch apps/web/tests/pin-browse-picker.overlay.yml`; "Add workspace" then opens an in-page folder picker instead of a native dialog.

The bundle disables the upstream rows that send data to, or depend on accounts with, the upstream vendor's services, and makes a local Ollama model the default. See [bundles/air/cordis.patch.yml](bundles/air/cordis.patch.yml).

## Desktop app

The AIR bundle runs inside upstream's existing Electron desktop app (profile `desktop`); AIR does not ship its own shell. The window shows the AIR preset, the local Ollama model, and the composer, with no account wall. Steps for a teammate, from the repository root:

```sh
pnpm install && pnpm run build           # root build; the desktop app launches from these outputs
pnpm -C air install && pnpm -C air run build
pnpm -C air run desktop:setup            # makes the desktop profile carry the AIR bundles; safe to run again
pnpm -C air run desktop                  # upstream's development launcher
```

`desktop:setup` works on the harness home the development launcher uses: `$DSH_HOME` if set, otherwise `apps/desktop/.desktop-build/development/home` inside the checkout (the development launcher never uses `~/.dsh`). It adds two `link:` dependencies and two names to `dsh.profile.bundles` in the profile's `package.json`, runs `pnpm install` in the profile directory, writes the Ollama route from `examples/ollama.profile.cordis.patch.yml` when the profile patch is absent or empty (otherwise it prints what to add), and adds `OLLAMA_API_KEY=ollama` to `$DSH_HOME/.env` when the variable is absent. Every file it changes is first copied to `<name>.bak-<timestamp>`, and it prints each change. It refuses, changing nothing, when the profile's `package.json` is not a profile manifest it understands. Create the models `qwen3-8b-32k` and `qwen3-8b-16k` first, as described under [The `air` profile](#the-air-profile).

Why a script: upstream refuses `dsh plugin add` for the `desktop` profile, because the app manages that profile; the app keeps a `package.json` edited this way across restarts. Why a second bundle: the AIR bundle turns off `deepseek-account` and `account-controller`, and the desktop app reads the account state over the account Remote namespace while it starts; without them the window shows "desktop welcome: Web request failed". The desktop variant bundle turns those two rows back on and nothing else. Signed out they answer from the local credential store and contact no vendor service; none of the AIR default paths sign in.

First launch: the launcher downloads and builds a Node, pnpm, and Python runtime payload (about 128 MB downloaded, about 455 MB on disk under `apps/desktop/.desktop-build`, which git ignores). Later launches reuse it. The app creates a default workspace under the system Documents folder (`<Documents>/deepseek-harness/default-workspace` on Linux); to move it, set `documentsDirectory` in the profile patch:

```yaml
- id: workspace-controller
  config:
    documentsDirectory: /absolute/path/to/a/folder
```

Known limits:

- On Linux this is a development launch from source, not an installed app: no installer, no menu entry, and the checkout must stay in place.
- The window keeps upstream's name and icon (placeholder branding is in [BRANDING.md](BRANDING.md)).
- Upstream publishes no Linux installer; the tray and the updater were not tested on Linux.
- The setup script and launch path were run on Fedora only; the Windows and macOS paths are untested by us.
- The edit that lets the launcher accept Linux is listed in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md) with its re-check steps.

### Checked on 2026-10-12

Setup: Fedora 44, Wayland session, upstream's desktop app run from source with the AIR bundle and `air/bundles/air-desktop`, model `qwen3-8b-16k`, a demo project as the default workspace, driven by `air/scripts/desktop-drive.mjs`.

What passed:

- The app starts with no failed or pending rows, and the window is usable with no sign-in wall.
- The AIR preset and the local model are shown.
- A plain prompt got a reply in 35 seconds at about 30 tokens per second.
- `.claude/CLAUDE.md` with its `@notes.md` import reached the model.
- `/mcp` listed the project server as not approved, and `/mcp approve demo` started it.
- `/mcp-trust status` showed it unpinned.
- Asking the model to use the server's tool raised the approval prompt; after "Reject" the tool stayed unavailable.
- `list_mcp_resources` for the declined server was denied.
- `/mcp-trust diff demo` showed the tool's description, its input, and the exact pin command.
- The pin command pinned one tool, and status then showed approved.
- The tool call then returned `echo: mango`.
- `/issue 42` sent "Summarise issue 42 in one sentence." to the model, confirmed in the Trajectory view.
- "Use the hello skill to greet Sam." called the `skill` tool with name `hello`, and the model answered "Hello Sam!".

What is open or not covered:

- Once, in a session of 7 turns, a reply was cut off after 1 second with "Output token limit reached". It did not repeat in a new session, and the cause is not known.
- Each request to the model is about 8,500 tokens before any conversation, which is 52 to 54 percent of the 16,384-token context of the default model. Little room is left for a long conversation, and the default context size needs to be re-decided with this figure. Whether this caused the cut-off is not established.
- One reply ended with the stray text "/think", which suggests the thinking switch for Qwen 3 models leaks into the output.
- Not covered: path-scoped rules, revoke, a pinned server that later changes its tools, tray, menus, updater, and anything on Windows or macOS.

Local-model tuning, checked the same day (default model `qwen3-8b-32k`, Ollama behind a recording proxy):

- E1: the app starts with no failed, pending, or invalid-compaction lines in the log, and the composer is shown.
- E2: a new session shows preset "AIR Lean" and model `qwen3-8b-32k`.
- E3: the reply was exactly "still here" with no `/think`, in 8 seconds; the request carried `reasoning_effort: "none"`.
- E4: the lean request had 19 tools and 4,426 prompt tokens, with none of the schedule, goal, delegation, or workflow tools; the full preset's earlier capture had 36 tools and 8,113 prompt tokens.
- E5: choosing "AIR" by hand sent 32 tools and 7,686 prompt tokens, and the page showed "AIR".
- E6: on a blank session, choosing a model with a 200,000-token window changed the preset to "AIR" within 1 second, and choosing `qwen3-8b-32k` again changed it back to "AIR Lean", with no reload.
- E7: a preset picked by hand stayed "AIR" after the model changed to `qwen3-8b-16k`.
- E8: with whole-file reads of about 11,000 tokens each, prompts fell from 18,200 to 11,607, from 22,649 to 13,905, from 20,567 to 13,599 (through a summary request limited to 2,048 output tokens), and from 24,564 to 15,844; every other request kept `max_tokens` 4096, and "Output token limit reached" never appeared.
- E9: the composer's model menu has an effort control; "Medium" sent `reasoning_effort: "medium"`, and the reply was 391 in 26 seconds.

### Follow-up fixes, checked 2026-10-12

- F1: after the fixes the app starts with no failed, pending, or invalid-compaction lines in the log; the composer is shown, and a new session shows "AIR Lean", `qwen3-8b-32k`, and effort Off.
- F2: choosing effort "Medium" sent `reasoning_effort: "medium"` (reply 391) and left no `reasoningEffort` key in the profile's `agent-default-model` row; a new session showed effort Off and sent `reasoning_effort: "none"`.
- F3: choosing `qwen3-8b-16k` wrote `model: qwen3-8b-16k` as the default without a `reasoningEffort` key; choosing `qwen3-8b-32k` again returned the default.
- F4: over 11 file-read messages two summary requests (2,048 output tokens) were recorded; the last summary instruction contained "Chronological Log" and "First request", and the summary (957 tokens) listed f1.txt to f8.txt in order. "Which file did you read first?" was answered "f1.txt", and the ordered list of read files was right for all 10 files. The "Context compacted" row was at the top level with the "Completed in Ns" disclosures collapsed, and expanding it showed the summary with its log. No "Output token limit" message appeared and every other request kept `max_tokens` 4096.
- F5: the headless profile steps above created a profile under an empty `DSH_HOME`, and one task from a project with `.claude/CLAUDE.md` created `notes.md` whose first line was `# AIR`.

### Driving the app in a test

`air/scripts/desktop-drive.mjs` is a manual test aid that drives a running desktop app through Electron's renderer debugging port; it is not part of the product. Start the app with `DSH_DESKTOP_RENDERER_DEBUG_PORT` set, and set `AIR_DESKTOP_DEBUG_PORT` to the same value when it is not the default 9222. Run `node air/scripts/desktop-drive.mjs` with no arguments to list its subcommands.

```sh
node air/scripts/desktop-drive.mjs title
node air/scripts/desktop-drive.mjs send "/mcp-trust status"
```

## Toolchain

Run the root build first; AIR packages link to its `lib/` outputs.

```sh
pnpm install && pnpm run build        # repository root
pnpm -C air install                   # AIR workspace (pnpm 11.7.0, lockfile committed)
pnpm -C air run build                 # every AIR package
pnpm -C air run typecheck
pnpm -C air run lint                  # fails if air/oxlint.air.json is stale; regenerate with lint:gen
pnpm -C air run test
pnpm -C air run smoke                 # isolated DSH_HOME: compose and boot the AIR bundle
```

New packages follow the templates in [plans/spikes/01-toolchain.md](plans/spikes/01-toolchain.md): `tsconfig.build.json` extends `../../tsconfig.base.json`, upstream packages are `link:` devDependencies with `^0.2.0-rc.1` peers, and each product-visible plugin has a native-resolution Loader test whose `cordis.yml` is written inside the package directory.

Upstream workflows under `.github/workflows/` also run on pushes to this fork; disable the ones that need upstream secrets in the fork's Actions settings.

## File conventions

Two agent presets are registered, both copies of the upstream `standard` preset with the convention plugins added (`bundles/air/cordis.patch.yml`). `air-lean` ("AIR Lean", listed first) is the default for new sessions; `air` (full) stays selectable in the composer.

`air-lean` omits the schedule tools (`tool-schedule`), the delegation group (`delegation`: `subagent`, `subagent_fork`, `list_agents`, `send_message`, `interrupt_agent`, and the workflow tool), and the goal command and tool (`command-goal`, `tool-goal`). Local models run with 16K to 32K tokens of context, and one captured request put the tool definitions at about 6,200 of the 8,100 fixed tokens. Estimated from that one request, including their system-prompt lines, schedule costs about 1,170 tokens per request, delegation about 920, workflow about 780, and goal about 490. These are estimates, not measurements of the lean preset. The prompt text for plan mode and the other kept tools is not split per tool, so it is unchanged.

The `preset-air-lean` plugin list is generated from `preset-air` by `scripts/gen-preset-air-lean.ts`, because a YAML anchor cannot drop items from a list; run `pnpm -C air run gen:lean` after editing `preset-air`. `pnpm -C air run lint` checks that the generated block is current. After every upstream merge, run `pnpm -C air exec vitest run scripts/tests/preset-air-drift.spec.ts`; a failure names the upstream row to re-copy into `preset-air` (then regenerate the lean list), and `pnpm -C air run check:composition` confirms the composed profile.

User-level folders written for other agents (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/CLAUDE.md`) are not read by default, because a large unrelated skill catalog derails small local models. `~/.air/skills` and `~/.air/commands` are always read. To opt in, add to `$DSH_HOME/profiles/air/cordis.patch.yml`:

```yaml
- id: air-command-conventions
  config:
    includeUserRoots: true
```

and copy the `preset-air` row (and `preset-air-lean`, the default) from the bundle patch into the same file with `includeUserRoots: true` added to the `air-skill-conventions` and `air-instruction-conventions` configs (a patch replaces a row's whole `config`, so the full plugin list must be repeated).

Project MCP servers from `.mcp.json` start only after `/mcp approve <server>`; run it before the first message of a session. Approvals are stored in `$DSH_HOME/air/mcp-approvals.json`.

## MCP trust

The `air` bundle loads the MCP trust plugin and sets `reviewTools: true` on the MCP conventions row, so every server imported from a project's `.mcp.json` waits for the reviewer and registers only tool definitions that match a reviewed lockfile (`$DSH_HOME/air/mcp-lock.json`). The shipped mode is `enforce`: a server with no pin registers nothing until you approve it. The `air-mcp` command-line profile lists `air/bundles/mcp-servers`, which holds the same trust row, so both profiles share one lockfile and one audit directory (`$DSH_HOME/air/mcp-audit`). Every mcp-client row must declare `inject: [mcpToolReview]`; see [examples/mcp-filesystem.profile.cordis.patch.yml](examples/mcp-filesystem.profile.cordis.patch.yml).

The first turn after a server appears asks once whether to approve it; allowing it saves the pin. Inside a session, `/mcp-trust` shows status and diffs and pins a changed surface. To read the definitions first, or to approve from a terminal, run `pnpm dsh --profile air-mcp diff <server>`, then `pin <server>`; `verify --all` is the CI check and `revoke <server>` removes approvals. Details: [packages/mcp-trust/README.md](packages/mcp-trust/README.md) and [packages/mcp-trust-cli/README.md](packages/mcp-trust-cli/README.md). `pnpm -C air run smoke` boots the `air` profile with the trust row and then composes the `air-mcp` profile and checks its command exit codes, all under an isolated harness home.

## Headless profile

The headless profile runs one task per command-line invocation: evaluations and scripted runs, no window and no server. Upstream's `headless` template composes the agent directly from its base bundle and has no agent-preset registry, so the `air` bundle cannot apply to it: three of its patch targets (`account-controller`, `ui-settings-account`, `agent-preset-registry`) do not exist there, and `preset-air` would wait forever for the `agentPresets` service. The separate bundle `bundles/air-headless` is added INSTEAD of `bundles/air`. Create the profile and run a task (Windows PowerShell and Linux use the same commands apart from the copy command):

```sh
pnpm dsh --profile air-headless --from-default-profile headless --dump-config
pnpm dsh plugin --profile air-headless add "$PWD/air/bundles/air-headless"
cp air/examples/ollama.profile.cordis.patch.yml ~/.dsh/profiles/air-headless/cordis.patch.yml    # PowerShell: Copy-Item
echo OLLAMA_API_KEY=ollama >> ~/.dsh/.env                                                         # once
pnpm dsh --profile air-headless "Create notes.md with one line saying the project started today."
pnpm dsh --profile air-headless --json "task"                                                    # newline-delimited events
```

Run from the repository root with a source checkout: the source launcher resolves workspace imports through the root `tsconfig.json`, and the agent works in the launcher's current directory. To work in another project, set `TSX_TSCONFIG_PATH` to the root `tsconfig.json`, change into that project, and call `node --import <repo>/node_modules/tsx/dist/esm/index.mjs <repo>/apps/cli/src/bin.ts --profile air-headless "task"` (checked on Linux). The permission mode is upstream's default (Workspace Write); this bundle does not change it.

What differs from the Web and desktop composition:

- The plugins are rows of the composition itself, not entries of an agent preset: instruction conventions, skill conventions, command conventions, MCP conventions, and MCP trust. The one-shot agent therefore gets `.claude/CLAUDE.md`, `.claude/rules`, `.claude/skills`, and `.claude/commands` exactly as the `air` preset does.
- The lean tool set is the default, as in the `air-lean` preset: the goal command and tool, the subagent tools, and the workflow tools are disabled (a test checks the list against `scripts/gen-preset-air-lean.ts`). The headless composition has no schedule tool and no clock plugin. To get the full set, set `disabled: false` on those rows in the profile's `cordis.patch.yml`.
- The default model is the local `qwen3-8b-32k` row, set the same way as in the `air` bundle. Headless has no model option: change `agent-default-model` in the profile patch to run another model. The compaction `modelPolicies` use the lean values and come from the same table, `scripts/gen-compaction-policies.ts`, which writes this bundle's block as well; there is no preset switching by context window.
- The vendor-upload, telemetry, account, and DeepSeek web-search rows are disabled, the same set the `air` bundle disables, minus the Web-only rows.

MCP in a headless run: nobody can answer the first-use approval prompt, so a project `.mcp.json` server with no pin stays blocked and registers no tools. Pre-pin it before the run: `pnpm dsh --profile air-mcp pin <server>` writes `$DSH_HOME/air/mcp-lock.json`, which the headless profile shares, and the server's approval is stored in `$DSH_HOME/air/mcp-approvals.json`. An evaluation seeds both files, or runs the `air-mcp` command line once, before the first task. A server whose tool definitions change after pinning is rejected, not asked about.

Known limits: no agent presets and no preset switching; no schedule tool; no interactive follow-up; the `--session-id` resume path refuses sessions recorded under an agent preset (a Web or desktop session cannot be continued here). `pnpm -C air run check:composition` composes the profile and checks every row; `pnpm -C air run smoke` boots one task against an unreachable model route and fails on any failed or pending row.

## Quality bar

AIR packages keep ESM-only modules, the package README template (Summary, Model Experience, Known Limitations), REAL-composition Loader tests for product-visible plugins, and 100% per-file coverage. They do not require Chinese translation pairs.
