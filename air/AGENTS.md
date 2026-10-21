# AGENTS.md — AIR workspace

Instructions for coding agents (and people) working on AIR in this fork. The repository root `AGENTS.md` describes the upstream harness and still applies to everything under `packages/`, `apps/`, `vendor/`, and `scripts/`. This file adds what is specific to AIR.

## What this project is

AIR (working name; the product name is on hold) is a local-first personal agent built on a fork of an MIT-licensed upstream agent harness. It is a final-year university project. The upstream project accepts no external pull requests, so this fork carries its own work on the `air/main` branch.

Read in this order:

1. [ONBOARDING.md](ONBOARDING.md): setup, daily workflow, and where things are.
2. [plans/README.md](plans/README.md): roadmap, owner decisions, plan index, open decisions.
3. [../research/research.md](../research/research.md): the synthesis of all research; notes 01–14 under `../research/notes/` hold the evidence.
4. [plans/spikes/](plans/spikes/): exact upstream APIs and verified commands for each feature area.
5. [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md) and [BRANDING.md](BRANDING.md).

## Current state

Plans 00, 01, and 02 are executed and merged. The product runs as the AIR bundle inside upstream's Electron desktop app (profile `desktop`, plus `bundles/air-desktop`), which is the primary surface; the Web UI (profile `air`) must keep working; headless (upstream's headless profile plus `bundles/air-headless`) is for evaluation and scripted runs. A separate AIR Electron shell (plan 07 as written) was dropped, and macOS is out of scope. Follow-up work is done too: the `air-lean` preset, per-model compaction policies, chronological compaction summaries, a visible compaction row, preset selection by model, and an effort pick that applies to one session. Plan 04 (memory, trimmed: no embeddings) and plans 08 and 09 (the voice agent, with the `open` tool and `apps/voice`) are executed on the branch `air/feat/voice-agent`. Plans 03, 05, and 06 are written but not executed; do not execute a later plan until the owner says to. Plan 07 needs a rewrite around upstream's desktop app.

Checked by hand on Fedora only ([CHECKS.md](CHECKS.md)). Nobody has run anything on native Windows; the Windows CI leg is the only signal. There is no installer on any OS.

What exists: fifteen `@air/dsh-*` packages under [packages](packages), one app ([apps/voice](apps/voice), `@air/voice`), and five bundles under [bundles](bundles) (`air`, `air-desktop`, `air-headless`, `air-mcp`, `mcp-servers`), described in [README.md](README.md#layout-of-the-air-workspace).

Generated files: the `preset-air-lean` plugin list comes from `scripts/gen-preset-air-lean.ts` (`pnpm -C air run gen:lean`), and the compaction `modelPolicies` blocks come from `scripts/gen-compaction-policies.ts` (`gen:policies`). Edit the sources, not the generated blocks; `pnpm -C air run lint` fails when they are stale.

In-tree edits outside `air/`, all listed in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md) with re-check steps: the MCP client review hook (`packages/mcp/mcp-client`), the Linux development target (`apps/desktop/scripts`), the Linux target narrowing in the desktop retention script, and one `groupTree` argument in `packages/client/ui-chat` that makes the compaction row visible. The CI workflow file and small repository-gate adjustments are also listed there.

CI: the fork's own `air` job (Linux and Windows) is the signal for AIR work. Upstream's `CI` workflow leaves a red "all checks passed" mark that is expected; ignore it. Never edit, disable, or change settings of workflows.

## Rules

- **Stay out of tree.** AIR code goes in `air/` as `@air/dsh-*` packages loaded by the `air` bundle. Do not edit upstream files unless a plan says the edit is unavoidable; list every such edit in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md).
- **Branches.** `master` mirrors upstream and only fast-forwards to upstream release tags. Work happens on feature branches off `air/main`, merged by pull request into `air/main`. Never push work to `master`.
- **In-tree review hook.** Plan 02 edits upstream's MCP client in `packages/mcp/mcp-client` (the review hook, listed in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md)). After every upstream sync, follow the re-check steps for it in that file.
- **No custom session event types.** An out-of-tree plugin cannot write event types that older builds may skip; an unknown type makes a session unresumable. Model-visible input enters as injected user messages with an AIR source kind, or as tool results; audit data goes to files under `$DSH_HOME/air/`.
- **Security is enforced, not advised.** Markdown instructions shape model behavior; pinning, permission rules, approval, and the sandbox enforce.
- **Product form.** The product is delivered as the AIR bundle running in upstream's desktop app (`apps/desktop`, profile `desktop`, plus `air/bundles/air-desktop`) and in the Web UI, and headless serves evaluation; desktop is primary; in-tree edits under `apps/desktop` are allowed when unavoidable and must be listed in `UPSTREAM-DELTA.md`; macOS is out of scope; scripts must run on native Windows and Linux (Node or tsx, not bash).
- **Permissions.** Product defaults are upstream's permission presets; AIR adds only the `sudo` guard, gating of MCP tool calls, and saved rules (plan 03 as amended in the roadmap).
- **Placeholders.** The product name and the desktop identifiers are on hold; use the placeholders in [BRANDING.md](BRANDING.md).
- **Local first.** The default model route is local Ollama. Do not add a dependency on a hosted service to a default code path.
- **Repository text gates scan `air/` and `research/`.** Do not write the banned origin-label word checked by `verify-concrete-terms` (say "source" or "origin"), git commit hashes (cite release tags), or URLs under the upstream working organization. No `as unknown` casts in code.
- **Documentation is English only** under `air/` and `research/`.
- **Report honestly.** Say what was run and what was not; label estimates as estimates.

## Finding code

A graphify knowledge graph speeds up navigation of the upstream packages. It is not committed (about 180 MB); build it once per checkout:

```sh
graphify update .          # AST-only, no API cost; writes graphify-out/
graphify query "where are MCP tools registered"
graphify explain "SessionId"
graphify path "AgentLoop" "ToolRuntime"
```

Use `graphify query` before grepping across `packages/`. Rebuild after each upstream merge.

## After an upstream sync

```sh
git fetch upstream --tags
git switch master && git merge --ff-only upstream/master
git switch air/main && git merge master
pnpm install && pnpm run clean && pnpm run build     # clean removes residue of packages deleted upstream
graphify update .
pnpm dsh --profile air --dump-config > /dev/null     # stderr must show no unmatched patch targets
```

Then re-run the re-checks that [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md) lists: regenerate the lean preset and policies (`pnpm -C air run gen:lean`, `gen:policies`) and run `pnpm -C air run lint`; the desktop build-path tests; the MCP client tests; and the chat UI tests. Then read new guides under `docs/upgrade-guide/`, bump AIR peer ranges if the minor version changed, and note relevant upstream changes in `research/research.md` section 2b.
