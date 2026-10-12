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

The example patch routes to the model `qwen3-8b-16k`, which does not exist until you create it. After `ollama pull qwen3:8b`, create it once from a Modelfile, because Ollama's default 4,096-token context truncates the agent's prompt silently:

```sh
cat > Modelfile <<'EOF'
FROM qwen3:8b
PARAMETER num_ctx 16384
EOF
ollama create qwen3-8b-16k -f Modelfile
```

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

`desktop:setup` works on the harness home the development launcher uses: `$DSH_HOME` if set, otherwise `apps/desktop/.desktop-build/development/home` inside the checkout (the development launcher never uses `~/.dsh`). It adds two `link:` dependencies and two names to `dsh.profile.bundles` in the profile's `package.json`, runs `pnpm install` in the profile directory, writes the Ollama route from `examples/ollama.profile.cordis.patch.yml` when the profile patch is absent or empty (otherwise it prints what to add), and adds `OLLAMA_API_KEY=ollama` to `$DSH_HOME/.env` when the variable is absent. Every file it changes is first copied to `<name>.bak-<timestamp>`, and it prints each change. It refuses, changing nothing, when the profile's `package.json` is not a profile manifest it understands. Create the model `qwen3-8b-16k` first, as described under [The `air` profile](#the-air-profile).

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

New sessions use the `air` agent preset, a copy of the upstream `standard` preset with the convention plugins added (`bundles/air/cordis.patch.yml`). After every upstream merge, run `pnpm -C air exec vitest run scripts/tests/preset-air-drift.spec.ts`; a failure names the upstream row to re-copy into `preset-air`, and `pnpm -C air run check:composition` confirms the composed profile.

User-level folders written for other agents (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/CLAUDE.md`) are not read by default, because a large unrelated skill catalog derails small local models. `~/.air/skills` and `~/.air/commands` are always read. To opt in, add to `$DSH_HOME/profiles/air/cordis.patch.yml`:

```yaml
- id: air-command-conventions
  config:
    includeUserRoots: true
```

and copy the `preset-air` row from the bundle patch into the same file with `includeUserRoots: true` added to the `air-skill-conventions` and `air-instruction-conventions` configs (a patch replaces a row's whole `config`, so the full plugin list must be repeated).

Project MCP servers from `.mcp.json` start only after `/mcp approve <server>`; run it before the first message of a session. Approvals are stored in `$DSH_HOME/air/mcp-approvals.json`.

## MCP trust

The `air` bundle loads the MCP trust plugin and sets `reviewTools: true` on the MCP conventions row, so every server imported from a project's `.mcp.json` waits for the reviewer and registers only tool definitions that match a reviewed lockfile (`$DSH_HOME/air/mcp-lock.json`). The shipped mode is `enforce`: a server with no pin registers nothing until you approve it. The `air-mcp` command-line profile lists `air/bundles/mcp-servers`, which holds the same trust row, so both profiles share one lockfile and one audit directory (`$DSH_HOME/air/mcp-audit`). Every mcp-client row must declare `inject: [mcpToolReview]`; see [examples/mcp-filesystem.profile.cordis.patch.yml](examples/mcp-filesystem.profile.cordis.patch.yml).

The first turn after a server appears asks once whether to approve it; allowing it saves the pin. Inside a session, `/mcp-trust` shows status and diffs and pins a changed surface. To read the definitions first, or to approve from a terminal, run `pnpm dsh --profile air-mcp diff <server>`, then `pin <server>`; `verify --all` is the CI check and `revoke <server>` removes approvals. Details: [packages/mcp-trust/README.md](packages/mcp-trust/README.md) and [packages/mcp-trust-cli/README.md](packages/mcp-trust-cli/README.md). `pnpm -C air run smoke` boots the `air` profile with the trust row and then composes the `air-mcp` profile and checks its command exit codes, all under an isolated harness home.

## Quality bar

AIR packages keep ESM-only modules, the package README template (Summary, Model Experience, Known Limitations), REAL-composition Loader tests for product-visible plugins, and 100% per-file coverage. They do not require Chinese translation pairs.
