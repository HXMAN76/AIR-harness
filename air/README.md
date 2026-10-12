# AIR workspace

AIR-owned code for the AIR local-first personal agent, built on a fork of an MIT-licensed upstream agent harness. The plan and its evidence live in [research/research.md](../research/research.md); the development guide is [research/notes/08-dev-contrib-guide.md](../research/notes/08-dev-contrib-guide.md).

New here? Start with [ONBOARDING.md](ONBOARDING.md); coding agents start with [AGENTS.md](AGENTS.md).

## Layout

```
air/
  pnpm-workspace.yaml     separate pnpm workspace (bundles/*, packages/*)
  bundles/air/            @air/dsh-air-bundle: product defaults as a Cordis patch
  bundles/air-desktop/    @air/dsh-air-desktop-bundle: layered after air in the desktop profile; keeps the two rows the desktop app needs at boot
  packages/convention-core/          shared discovery library for the convention plugins
  packages/skill-conventions/        skill provider: .claude/skills, project skill roots, ~/.air/skills
  packages/instruction-conventions/  .claude/CLAUDE.md, @path imports, .claude/rules
  packages/mcp-conventions/          .mcp.json servers per Agent, with approval (/mcp)
  packages/command-conventions/      .claude/commands with $ARGUMENTS
  packages/preset-by-model/          picks air-lean or air from the selected model's context window
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
- After compaction the 8B model's summary loses early details; in the test it named the wrong first file.
- The app shows no notice when compaction happens.
- The full preset on a 16K window is not recommended: its fixed prompt is about 9,500 tokens and no threshold can both fit it and keep a full reply. The full-preset values and the 24K values were derived, not run.
- Models not in the table get no compaction. Hosted models keep the upstream defaults, which suit large windows, and were not tested.

The example patch turns thinking off for this model (`reasoning: off` on the route, `reasoningEfforts` mapping `off` to `none` and `medium` to `medium`, and `compat.supportsReasoningEffort: true`). With thinking on, Qwen 3 emitted a stray `/think` on short prompts and spent seconds reasoning; with the setting, one test showed short replies in 0.3 to 0.4 seconds instead of 2.6 to 4.4. Choose "medium" in the app's effort control to turn thinking on for a session.

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

## Quality bar

AIR packages keep ESM-only modules, the package README template (Summary, Model Experience, Known Limitations), REAL-composition Loader tests for product-visible plugins, and 100% per-file coverage. They do not require Chinese translation pairs.
