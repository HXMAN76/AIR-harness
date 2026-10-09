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

Research and plans 00–07 are done and were revised on 2026-10-08 for upstream `0.2.1-alpha.1` (the fork is now at `0.2.1-alpha.2`, merged 2026-10-09; see the 2026-10-09 section of `plans/README.md`), native-Windows teammates, and the owner's decisions (the roadmap has the revision status and what was run); the owner started the build on 2026-10-09. Executed so far, on Fedora only: plan 00 (workspace toolchain, lint config, profile smoke, CI job) on branch `air/feat/00-workspace-foundation`, and plan 01 (file conventions: skills, instructions, `.mcp.json`, commands, the `air` preset) on branch `air/feat/01-file-conventions`, stacked on the first. Each plan file starts with an execution record. Do not execute a later plan until the owner says to start it.

What exists and works: five `@air/dsh-*` packages under [packages](packages) (plan 01), and the `air` bundle ([bundles/air](bundles/air)), which loads them, turns off upstream-vendor uploads, accounts, and telemetry and makes a local Ollama model the default; and an `air` profile created by the commands in [README.md](README.md).

## Rules

- **Stay out of tree.** AIR code goes in `air/` as `@air/dsh-*` packages loaded by the `air` bundle. Do not edit upstream files unless a plan says the edit is unavoidable; list every such edit in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md).
- **Branches.** `master` mirrors upstream and only fast-forwards to upstream release tags. Work happens on feature branches off `air/main`, merged by pull request into `air/main`. Never push work to `master`.
- **No custom session event types.** An out-of-tree plugin cannot write event types that older builds may skip; an unknown type makes a session unresumable. Model-visible input enters as injected user messages with an AIR source kind, or as tool results; audit data goes to files under `$DSH_HOME/air/`.
- **Security is enforced, not advised.** Markdown instructions shape model behavior; pinning, permission rules, approval, and the sandbox enforce.
- **Product form.** A desktop app for Windows and Linux (Fedora first), built as an AIR-owned Electron shell under `air/apps/` (plan 07); upstream's `apps/desktop` is not modified. macOS is out of scope. Scripts must run on native Windows and Linux: write them in Node or tsx, not bash.
- **Permissions.** Product defaults are upstream's permission presets; AIR adds only the `sudo` guard, gating of MCP tool calls, and saved rules (plan 03 as amended in the roadmap).
- **Placeholders.** The product name and the desktop identifiers are on hold; use the placeholders in [BRANDING.md](BRANDING.md).
- **Local first.** The default model route is local Ollama. Do not add a dependency on a hosted service to a default code path.
- **Repository text gates scan `air/` and `research/`.** Do not write the banned origin-label word checked by `verify-concrete-terms` (say "source" or "origin"), git commit hashes (cite release tags), or URLs under the upstream working organization. No `as unknown` casts in code.
- **Documentation is English only** under `air/` and `research/`.
- **Report honestly.** Say what was run and what was not; label estimates as estimates.

## Finding code

A graphify knowledge graph speeds up navigation of the 331 upstream packages. It is not committed (about 180 MB); build it once per checkout:

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

Then read new guides under `docs/upgrade-guide/`, bump AIR peer ranges if the minor version changed, and note relevant upstream changes in `research/research.md` section 2b.
