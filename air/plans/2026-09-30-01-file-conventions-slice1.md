# File Conventions Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository or home folder configured for Claude Code works in the `air` profile on day one: its skills, command files, `CLAUDE.md` imports and rules, and `.mcp.json` servers load, while unrelated user-level skills stay out of the catalog unless the user opts in.

**Architecture:** Five out-of-tree packages under `air/packages/`. `@air/dsh-convention-core` is a plain library (project root, homes, frontmatter, Markdown discovery, a grouped polling watcher, tool-name table). `@air/dsh-skill-conventions` and `@air/dsh-instruction-conventions` are mounted inside a new agent preset `preset-air` (a copy of the upstream `standard` preset, including its clock and reminder rows, whose `skill-filesystem` has `includeDefaultRoots: false`), and `agent-preset-registry` is patched to `default: air`. `@air/dsh-mcp-conventions` and `@air/dsh-command-conventions` are host rows that mount per-Agent children through `createScope(ctx, agent)`, the pattern upstream uses in `packages/experimental/browser-use-runtime/src/mcp.ts`.

**Tech Stack:** TypeScript 6 (strict, ESM), Cordis plugins, `@deepseek-ai/schemastery` for Config, `yaml` 2.9, `picomatch` 4, Vitest 4, tsdown, pnpm 11.7.0. Every command runs unchanged in PowerShell and bash.

**Spec:** [spikes/02-file-conventions.md](spikes/02-file-conventions.md) (primary; §0, §1, §3, §4, §5, §9), [spikes/01-toolchain.md](spikes/01-toolchain.md) (package templates, native Loader test, pitfalls), [research/research.md §5.1](../../research/research.md), [research/notes/03-competitors.md §5](../../research/notes/03-competitors.md). Depends on [plan 00](2026-09-30-00-workspace-foundation.md) being done.

## Execution record (2026-10-09, Fedora)

All nine tasks were executed on branch `air/feat/01-file-conventions` (stacked on the plan 00 branch); the checkboxes below are left as written. Result: five packages, 196 tests passing (187 in packages at 100% coverage, 9 workspace-level), build, typecheck, lint, the composition check (8 of 8), and the profile smoke all pass. The upstream extension points the plan assumed (skill providers, `agent/pre-step`, the command registry, per-Agent MCP mounts) matched `0.2.1-alpha.1`; no design change was needed.

Corrections to the plan's code found during execution:

- **Frontmatter:** YAML lines keep a trailing carriage return in files saved with CRLF line endings; the parser strips it.
- **Watcher:** a path that was absent at listing time was reported as changed on the first poll; absent and unreadable paths are now ignored on that poll, and a path created later is still detected.
- **MCP mounts with `reviewTools: true`:** `ctx.plugin` resolves while the child is still pending on the reviewer service, so `/mcp approve` reported a start although nothing was mounted. The mount now waits for the startup timeout unless the child is active, and the message says the reviewer is required and not loaded. Two consequences for plan 02: the active state is compared with the literal `2` because upstream's fiber-state enum is a `const` enum (add a test that fails if upstream renumbers it), and a reviewer that becomes available after the child is created is reported as a timeout (plan 02 must load the reviewer before the convention plugin or revisit this wait).
- **Tests:** a session header `cwd` must be absolute; upstream starts a stdio MCP server twice per Agent (a probe, then the mount), so process counts are lower bounds.
- **Lint-driven changes:** `\u` escapes instead of literal non-ASCII characters, `Object.assign` instead of spreading `Config`-typed values, extracted strings instead of `expect.stringContaining` inside object matchers.

Not run: anything on native Windows (Windows branches are covered only by tests that stub the platform); the manual Web UI checks of Task 9 Step 9, which need a browser and a running local model.

## Revision log

**2026-10-08.** The plan was written against `dsh-v0.2.0-rc.2`, and its code has never been compiled. The fork is now at `dsh-v0.2.1-alpha.1`. Each entry gives the change and the reason.

1. **Upstream APIs re-verified against the new base.** The source of `skill`, `skill-filesystem`, `mcp-client`, `scope`, `commands`, `home-paths`, `brand`, `tools`, `agent-instructions`, and `time-context` is byte-identical between the two release tags; `agent`, `session`, `agent-preset-registry`, and `app-boot` changed only in comments, removed invariant files, and unrelated code. Line references in the table above moved for `agent`, `session`, `agent-preset-registry`, and `app-boot` and were corrected. The removal of runtime invariants and the new plugin display metadata (locale files and `<subpath>/icon`) need no change here: AIR packages never had an `./invariant` export, and the display rule applies to subpath plugins, while every AIR package is a package-root plugin that keeps its `package.json` text. The peer range `^0.2.0-rc.1` does not satisfy `0.2.1-alpha.1` under plain semver (checked with the `semver` package), but the profile loader checks peers with `includePrerelease`, which accepts it (`packages/boot/app-boot/src/plugin-compatibility.ts`); the smoke in Task 9 is the gate.
2. **`preset-air` regenerated from the new `standard` preset** (Task 9). Upstream added `time-context`, `tool-schedule`, and a `toolFilter` that denies the four `schedule_*` tools to the `subagent` and `subagent_fork` rows. AIR keeps all of them (reminders and a clock reading suit a personal assistant); Task 9 has a keep-or-drop table and the drift test names the "keeps clock and reminders" decision. The YAML block was generated from the upstream file by a script, not retyped, and the drift test's comparison was run against it (the deep comparison held; the file-level run of the test itself needs the packages built).
3. **Corrected a limitation.** With `includeDefaultRoots: false` the upstream `skill-filesystem` still scans its `customSkillDirs` and the bundled skill directory. The README no longer claims bundled skills disappear; `~/.dsh/skills` and `~/.agents/skills` do.
4. **The skill provider no longer reads `.claude/commands`** (Tasks 3 and 9). In the bundle those files had to be hidden (`commandsUserInvocable: false`), so the code path could only produce a duplicate or a model-invocable command by accident, and the same file had two readers. `@air/dsh-command-conventions` is the only reader. A flat `<name>.md` in a skill root now counts as a skill only when its frontmatter has a `description`, so a `README.md` in a skills folder is not listed. Duplicate-name handling stays with the registry (which already warns and keeps the lower rank).
5. **Watcher redesigned** (Tasks 2 and 3). The per-path `fs.watchFile` wrapper evicted single paths past a limit, which could leave a cached catalog with one root unwatched, and it baselined after listing, so a change during listing was missed. `PollWatcher` has one timer, groups paths by project, evicts whole projects (and invalidates once when it does), takes a `listedAt` timestamp so a change during listing is caught, and exposes `pollOnce()` so tests do not depend on timers.
6. **`@path` import safety** (Tasks 4 and 5). Imports are now checked by real path (a symbolic link inside the project cannot reach a file outside it), credential-like files are refused (`.env*`, SSH keys, `.pem`/`.key`, anything under `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.npmrc`, `.netrc`), and a file larger than the byte budget is skipped without being read. Each refusal appears as a `<skipped reason=.../>` line.
7. **The instruction baseline is composed once per turn** (step 1 of `agent/pre-step`) instead of at every step, so a mid-turn edit cannot break the provider's prompt cache, and a read failure now logs and lets the turn continue instead of failing it. Rule globs match with POSIX rules on every platform.
8. **`$ARGUMENTS` edge cases** (Task 8). A backslash now escapes only quotes and whitespace, so Windows paths (`C:\Users\me\a.txt`, `\\server\share`) survive; tests cover single-pass insertion (an argument that contains `$1` is not expanded again), `$&`-style text, multi-line input, `$10`, and an unterminated `$ARGUMENTS[`. A failure to read a command folder no longer fails Agent creation.
9. **`.mcp.json` consent redesigned** (Tasks 6 and 7). The approval key now covers the entry as written (variables unexpanded), so rotating a token does not force a new approval while any edit of the command, arguments, URL, or variable names does, and no expanded secret is part of the hash input. The approvals store serializes writes, uses a unique temporary file per write, and tolerates a failed write; an unreadable approvals file or `.mcp.json` approves nothing and shows as a `Problem:` line in `/mcp` instead of failing Agent creation. `/mcp` tells the person to approve before the first message, and the session logs a note when servers await approval. A byte-order mark in `.mcp.json` (written by some Windows editors) is accepted.
10. **MCP review switch** (Task 7, cross-plan obligation). `air-mcp-conventions` has a `reviewTools` Config field (default `false`). When `true`, each mounted `mcp-client` child is the upstream plugin with `inject` extended by `mcpToolReview`, so it stays pending until plan 02's reviewer exists. This plan does not depend on plan 02; plan 02's bundle task sets `reviewTools: true` on the `air-mcp-conventions` row. Tests cover the pending case, the satisfied case, and the default.
11. **Windows** (all tasks). Every command step now runs unchanged in PowerShell and bash: no absolute home paths, no `&&` chains, no `ls`, `grep`, `printf`, `mktemp`, or `pgrep`. The bash blocks of Task 9 became two Node scripts (`check-air-composition.ts`, `make-demo-project.ts`), and the process-leak check of Task 7 became a pid-file check inside the test. Code takes `node:path` objects as an optional argument (`isInside`, `expandHome`, `directoriesBetween`, `toPosixRelative`), so Windows rules (case-insensitive paths, drive letters, backslashes) are tested on Linux through `path.win32`. Tests no longer hard-code POSIX paths, use file names Windows rejects, or assume symbolic links, POSIX modes, or an absolute path without spaces.
12. **Claude Code mods bridge evaluated** (see the Deferred table): it does not affect this slice.
13. **Verified by running while revising:** the semver check in entry 1, the `git diff` of each cited package between the two release tags, the `picomatch` `windows` option, the YAML equality of `preset-air` and the upstream `standard` preset with the declared changes, and the JavaScript quoting of the new `node -e` commands. **Read, not run:** the `cross-spawn` use in the upstream MCP stdio transport, the skill registry's duplicate handling, and every package's code and tests, which are still uncompiled; Windows execution is untested.

## Global Constraints

- **Windows and Linux.** Four teammates develop on native Windows PowerShell. Commands in this plan use only `pnpm`, `node`, and `git`, run from the repository root, with relative paths and no bash syntax (`mktemp`, `printf`, `grep`, `ls`, pipes into tools, `$(...)`). Code builds paths with `node:path`, never string concatenation with `/`; tests build expected paths with `join`/`resolve` instead of literals such as `/p/a`; Windows-specific behavior (case-insensitive paths, drive letters, backslashes) is tested through `node:path`'s `win32` object so it runs on Linux CI too; tests that need symbolic links or POSIX file modes skip on `win32`.
- Node `^22.19 || >=24`; pnpm `11.7.0` (`air/package.json` `packageManager`); ESM only; TypeScript strict.
- Packages live in `air/packages/<pkg>`, named `@air/dsh-<pkg>`. dsh packages are peers with range `^0.2.0-rc.1` plus `link:../../../packages/<group>/<pkg>` devDependencies (vendor packages: `link:../../../vendor/<pkg>`). `workspace:*` is used only between AIR packages.
- Plan 00 provides: `air/package.json` devDependencies (`typescript`, `tsdown`, `vitest`, `@vitest/coverage-v8`, `@types/node`, `tsx`, the oxlint set) and scripts `build`, `typecheck`, `lint`, `test`, `smoke`; `air/pnpm-workspace.yaml` with `autoInstallPeers: false`; `air/tsconfig.base.json`; `air/.oxlintrc.json`; `air/.gitignore` (ignores `lib/`, `coverage/`, `.loader-*/`); `air/scripts/smoke-profile.ts` (run through `pnpm -C air run smoke`; plan 00 owns it and it runs on Windows and Linux).
- Each package: `tsconfig.build.json` extends `../../tsconfig.base.json` and sets `rootDir: src`, `outDir: lib/types`, `include: ["src"]`; `tsconfig.json` extends `./tsconfig.build.json` with `rootDir: "."`, `noEmit: true`, `include: ["src", "tests"]`; `vitest.config.ts` includes `tests/**/*.spec.ts`.
- Test commands: `pnpm -C air/packages/<pkg> test`; coverage `pnpm -C air/packages/<pkg> exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`. Coverage must reach 100% per package; close a gap with a test, and use a `/* v8 ignore next -- <reason> */` comment only for a branch that needs a concurrent filesystem change to reach.
- Build order matters: the root `pnpm run build` must have finished before any AIR install, build, or test; an AIR package that imports `@air/dsh-convention-core` resolves its built `lib/`, so run `pnpm -C air/packages/convention-core build` before testing dependents. A native Loader test imports the package's own `lib/`, so run that package's `build` before its tests.
- Registrations are effects (`ctx.effect`, `ctx.on`; a registry `register()` returns the disposer). Deployment-varying choices are Config fields, not constants. Misconfiguration fails loud. Opaque cross-boundary ids are branded. No `as unknown` casts (the root `verify-no-unknown-casts` gate scans `air/`). Waterfall listeners call `next()`.
- No new session event types. Model-visible input enters as injected user messages with AIR source kinds (extending `MessageSourceMap`) or as tool results; AIR state and audit data go to files under `dshHomePath('air', ...)`.
- Each product-visible plugin has unit tests, one native-resolution Loader test (the `cordis.yml` is written inside the package directory), a `README.md` with Summary, Model Experience, and Known Limitations sections (English only), and JSDoc on every export.
- Markdown written by this plan never uses the banned origin word listed in the root `AGENTS.md` ("Ban ..." rule), contains no git commit hashes, and no URLs under the upstream organisation's GitHub path.
- Any edit outside `air/` and `research/` is recorded in `air/UPSTREAM-DELTA.md`. Goal for this plan: none.

## Decisions fixed by this plan

1. **Skill ranks.** Lower wins inside one layer. Project `.dsh/skills` 100, project `.agents/skills` 200, project `.claude/skills` 220, each `extraProjectRoots` entry 240, `<airHome>/skills` 350, and, only with `includeUserRoots: true`, `<agentsHome>/skills` 500 and `<claudeHome>/skills` 520. Spike 02 §1.2 proposed 150/160 for the `.claude` roots; this plan follows the research priority order (product-native, `.agents`, `.claude`), which is also the order in the task brief. The skill registry already drops a same-name lower-priority candidate with a warning, so the provider does no cross-root deduplication.
2. **Host filesystem only.** The AIR plugins read convention files with `node:fs`, not through `ctx.fs`. Remote or sandboxed filesystem providers are a later slice.
3. **Watching is one grouped poll timer.** `PollWatcher` keeps one interval timer for all retained paths, groups paths by project, and evicts whole projects (least recently listed first) so a retained catalog is never left half-watched; an evicted project invalidates the catalog once. Paths that do not exist yet are watched too. No chokidar dependency. (The first draft wrapped `fs.watchFile` per path and evicted single paths, which could leave a cached catalog with no watch on one of its roots.)
4. **`/mcp` lives in `@air/dsh-mcp-conventions`.** Spike 02 §9 lists it under the command package; the package that owns the approvals file also owns the command that edits it, so the two packages do not depend on each other.
5. **Commands in slice 1 substitute arguments only.** `@file` expansion and `` !`cmd` `` execution from spike 02 §3.2 are deferred; they stay literal text in the prompt and are listed under Known Limitations.
6. **Import approval is an allowlist.** An `@path` import outside the project root is skipped with a note unless its path is under a Config `allowedImportRoots` entry (spike 02 §4.2: no open turn exists to ask in).
7. **User roots stay off in the bundle.** `includeUserRoots` defaults to `false` in every package and the bundle leaves it there; a user turns it on in the profile patch.
8. **Command files are commands only.** `@air/dsh-command-conventions` is the single reader of `.claude/commands`. The skill provider no longer lists command files as skills: in the bundle it had to hide them anyway (`commandsUserInvocable: false`), which left a code path that could only produce a duplicate or a model-invocable command by accident. Claude Code's merge of commands into skills is deferred with `$ARGUMENTS` on the skill path.
9. **The instruction baseline is composed once per turn,** at step 1 of `agent/pre-step`. Mid-turn edits to convention files reach the model on the next turn, and the provider's prompt cache is not invalidated inside a turn.
10. **Imports are contained by real path.** An `@path` import must resolve (after symbolic links) inside the project root or an `allowedImportRoots` entry, must not be a credential-like file, and must not exceed the baseline byte budget.
11. **`.mcp.json` approval is keyed by the definition as written** (the raw entry, `${VAR}` unexpanded), not by expanded values: a rotated token does not need a new approval, and a changed command, argument, URL, or variable name does. A file edit that changes any of those needs a new approval.
12. **MCP review is a Config switch, not a dependency.** `air-mcp-conventions` has `reviewTools` (default `false`). When `true`, each mounted `mcp-client` child declares `inject: ['mcpToolReview']` and waits for plan 02's reviewer. This plan does not depend on plan 02; the bundle turns the switch on when plan 02 lands.
13. **`preset-air` keeps every upstream `standard` row** except the changes listed in Task 9 (the clock reading `time-context` and the reminder tools `tool-schedule` stay, because AIR is a personal assistant and reminders are part of that product).

## File Structure

```
air/
  package.json                                   (modify: add yaml devDependency for the drift test)
  README.md                                      (modify: packages list, known issues)
  bundles/air/
    package.json                                 (modify: dependencies on the four plugin packages)
    cordis.patch.yml                             (modify: preset-air, registry default, two host rows)
  scripts/tests/preset-air-drift.spec.ts         (create: preset-air equals upstream standard plus declared changes)
  scripts/check-air-composition.ts               (create: dump the air profile and check the AIR rows; runs on Windows and Linux)
  scripts/make-demo-project.ts                   (create: scratch project for the manual check; runs on Windows and Linux)
  packages/
    convention-core/                             @air/dsh-convention-core (library, no plugin)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               re-exports
      src/paths.ts                               homes, project root, containment, POSIX-relative paths
      src/names.ts                               kebab-case names
      src/tool-names.ts                          Claude Code <-> dsh tool-name table
      src/frontmatter.ts                         YAML frontmatter and typed field readers
      src/files.ts                               text reads, real-path lookup, directory and Markdown-tree listing
      src/watch.ts                               PollWatcher (one grouped poll timer)
      tests/{paths,names,tool-names,frontmatter,files,watch}.spec.ts
    skill-conventions/                           @air/dsh-skill-conventions (preset row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, provider, apply
      src/roots.ts                               root list and ranks
      src/parse.ts                               skill file parsing
      tests/{parse,roots,provider,native-loader}.spec.ts
    instruction-conventions/                     @air/dsh-instruction-conventions (preset row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, source kind, pre-step and post-execute listeners
      src/imports.ts                             @path import resolver
      src/rules.ts                               .claude/rules loader and glob matcher
      src/baseline.ts                            baseline text assembly and budget
      tests/harness.ts                           stub Agent
      tests/{imports,rules,baseline,plugin,native-loader}.spec.ts
    mcp-conventions/                             @air/dsh-mcp-conventions (host row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, per-Agent mounts, /mcp command
      src/config.ts                              .mcp.json parser, ${VAR} expansion
      src/approvals.ts                           approval key and approvals file
      tests/harness.ts                           stub Agent
      tests/fixtures/echo-server.mjs             stdio MCP server with one tool
      tests/{config,approvals,plugin,native-loader}.spec.ts
    command-conventions/                         @air/dsh-command-conventions (host row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, source kind, scoped command registration
      src/args.ts                                argument splitting and substitution
      tests/harness.ts                           stub Agent
      tests/{args,plugin,native-loader}.spec.ts
```

Upstream APIs this plan relies on (re-verified at `dsh-v0.2.1-alpha.1` by diffing the source of each cited package between the two release tags; line numbers are the current ones):

| API | Location |
|---|---|
| `ctx.skills.registerProvider(create)`, `SkillProvider`, `SkillCandidate`, `SkillDefinition`, `SkillProviderControl`, layer and rank rules | `packages/skill/skill/src/index.ts` L40-97, L247-275, L345-355, L390-425 |
| `skill-filesystem` Config `includeDefaultRoots`, roots and ranks; with `includeDefaultRoots: false` the `customSkillDirs` and the bundled skill directory are still scanned | `packages/skill/skill-filesystem/src/index.ts` L53, L78, L244-262 |
| Preset row schema (`id`, `name`, `description`, `order`, `plugins`), registry Config (`default` and the volatile `selectedDefault`) | `packages/preset/agent-preset/src/index.ts`, `packages/preset/agent-preset-registry/src/index.ts` L54-57 |
| Upstream `standard` preset list (now with `time-context`, `tool-schedule`, and `toolFilter` on the two subagent rows) | `packages/bundle/web-app/presets/standard.patch.yml` |
| `agent/created` (serial, awaited before queued input; a throw fails Agent creation and skips later listeners), `agent/disposed`, `agent/pre-step` (waterfall), `PreStepDecision`, `Agent.followup` | `packages/core/agent/src/runtime-types.ts` PreStepDecision L112, followup L222, created L252-261, disposed L270, pre-step L320 |
| `tools/post-execute` waterfall, `PostToolDecision.additionalContexts` | `packages/core/tools/src/index.ts` L165-176, L617-620, L1781-1820 |
| `MessageSourceMap` (merge-extensible), `createUserMessage` | `packages/llm/llm/src/message.ts` L103-115, L236-246 |
| `Session.deriveMessages()`, `CreateSessionOptions.meta.cwd`, `session.header.cwd` | `packages/core/session/src/index.ts` L856, `packages/core/session/src/types.ts` L105, L152 |
| `createScope(ctx, key)`, `Scope.dispose()` | `packages/core/scope/src/index.ts` L104-146 |
| `mcp-client` `Config` validator and `apply` | `packages/mcp/mcp-client/src/index.ts` L51-142, L154 |
| Per-Agent `mcp-client` child precedent | `packages/experimental/browser-use-runtime/src/mcp.ts` L100-160 |
| `ctx.commands.register`, `find`, `execute`, `CommandInvocation`, `CommandResult` | `packages/interaction/commands/src/index.ts` L41-80, L285-292, L328-330, L361-431; `types.ts` |
| `dshHomePath(...segments)` | `packages/util/home-paths/src/index.ts` L98 |
| `Branded<B>` | `packages/util/brand/src/index.ts` L18 |
| Runtime resolution supplies the packages of the installation and of selected bundles to Node resolution | `packages/boot/app-boot/src/profile.ts` L16-22 (header comment) |
| `@deepseek-ai/dsh-time-context`, `@deepseek-ai/dsh-tool-schedule` preset rows | `packages/context/time-context`, `packages/schedule/tool-schedule` |
| `cross-spawn` resolves `npx` to `npx.cmd` for stdio MCP servers on Windows | `@modelcontextprotocol/client` `dist/stdio.mjs` (used by `packages/mcp/mcp-client/src/transport.ts`) |

---

### Task 1: `@air/dsh-convention-core` — paths, names, tool-name table

**Files:**
- Create: `air/packages/convention-core/package.json`
- Create: `air/packages/convention-core/tsconfig.build.json`
- Create: `air/packages/convention-core/tsconfig.json`
- Create: `air/packages/convention-core/tsdown.config.ts`
- Create: `air/packages/convention-core/vitest.config.ts`
- Create: `air/packages/convention-core/src/paths.ts`
- Create: `air/packages/convention-core/src/names.ts`
- Create: `air/packages/convention-core/src/tool-names.ts`
- Create: `air/packages/convention-core/src/index.ts`
- Test: `air/packages/convention-core/tests/paths.spec.ts`
- Test: `air/packages/convention-core/tests/names.spec.ts`
- Test: `air/packages/convention-core/tests/tool-names.spec.ts`

**Interfaces:**
- Consumes: plan 00 workspace (`air/tsconfig.base.json`, root devDependencies).
- Produces (all exported from `@air/dsh-convention-core`):
  - `AIR_HOME_ENV = 'AIR_HOME'`, `AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'`
  - `interface UserHomeConfig { airHome?: string; claudeHome?: string; agentsHome?: string }`
  - `interface UserHomes { readonly airHome: string; readonly claudeHome: string; readonly agentsHome: string }`
  - `expandHome(path: string, home?: string, pathApi?: PlatformPath): string` (`~`, `~/`, and, for Windows rules, `~\`)
  - `resolveUserHomes(config?: UserHomeConfig, env?: Readonly<Record<string, string | undefined>>, home?: string): UserHomes`
  - `pathExists(path: string): Promise<boolean>`
  - `findProjectRoot(cwd: string, markers?: readonly string[]): Promise<string>` (nearest ancestor containing a marker, default `['.git']`; falls back to `cwd`; stops at `/` or a drive root)
  - `isInside(root: string, candidate: string, pathApi?: PlatformPath): boolean` (case-insensitive for `path.win32`; another drive is outside)
  - `directoriesBetween(root: string, cwd: string, pathApi?: PlatformPath): string[]` (root first, cwd last; `[cwd]` when cwd is outside root)
  - `toPosixRelative(root: string, candidate: string, pathApi?: PlatformPath): string` (forward slashes, for glob matching)
  - `toKebabName(input: string): string | undefined`
  - `CLAUDE_TO_DSH_TOOL_NAMES: Readonly<Record<string, string>>`
  - `toDshToolName(claudeName: string): string | undefined`
  - `toClaudeToolNames(dshName: string): string[]`
  - `translateToolNames(claudeNames: readonly string[]): { names: string[]; unknown: string[] }`

- [ ] **Step 1: Create the package scaffold**

`air/packages/convention-core/package.json`:

```json
{
  "name": "@air/dsh-convention-core",
  "description": "Shared discovery helpers for the AIR file-convention plugins",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "yaml": "^2.9.0"
  }
}
```

`air/packages/convention-core/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/convention-core/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/convention-core/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies stay external. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

`air/packages/convention-core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; `air/packages/convention-core/node_modules/yaml` exists.

- [ ] **Step 2: Write the failing tests**

`air/packages/convention-core/tests/paths.spec.ts`:

```ts
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath, { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  directoriesBetween,
  expandHome,
  findProjectRoot,
  isInside,
  pathExists,
  resolveUserHomes,
  toPosixRelative,
} from '../src/index.ts'

const { win32 } = nodePath
const created: string[] = []

/** An absolute path on the current platform's current drive, so expectations hold on Windows and Linux. */
function abs(...segments: string[]): string {
  return resolve(sep, ...segments)
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-paths-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('expandHome', () => {
  const home = abs('home', 'u')

  it('expands a bare tilde and a tilde prefix', () => {
    expect(expandHome('~', home)).toBe(home)
    expect(expandHome('~/x/y', home)).toBe(join(home, 'x', 'y'))
  })

  it('leaves other paths unchanged', () => {
    expect(expandHome('/abs/x', home)).toBe('/abs/x')
    expect(expandHome('~other/x', home)).toBe('~other/x')
  })

  it('accepts a backslash after the tilde only for Windows paths', () => {
    expect(expandHome('~\\notes\\a.md', 'C:\\Users\\u', win32)).toBe('C:\\Users\\u\\notes\\a.md')
    expect(expandHome('~\\notes', home)).toBe('~\\notes')
  })
})

describe('resolveUserHomes', () => {
  const home = abs('home', 'u')

  it('uses defaults under the operating-system home', () => {
    expect(resolveUserHomes({}, {}, home)).toEqual({
      airHome: join(home, '.air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, '.agents'),
    })
  })

  it('reads AIR_HOME and DSH_AGENTS_HOME and ignores blank values', () => {
    expect(resolveUserHomes({}, { AIR_HOME: abs('data', 'air'), DSH_AGENTS_HOME: '~/shared' }, home)).toEqual({
      airHome: abs('data', 'air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, 'shared'),
    })
    expect(resolveUserHomes({}, { AIR_HOME: '  ', DSH_AGENTS_HOME: '' }, home).airHome).toBe(join(home, '.air'))
  })

  it('prefers explicit configuration over the environment', () => {
    const homes = resolveUserHomes(
      { airHome: '~/a', claudeHome: abs('c'), agentsHome: abs('g') },
      { AIR_HOME: abs('ignored'), DSH_AGENTS_HOME: abs('ignored') },
      home,
    )
    expect(homes).toEqual({ airHome: join(home, 'a'), claudeHome: abs('c'), agentsHome: abs('g') })
  })

  it('falls back to process.env and the real home', () => {
    expect(resolveUserHomes().claudeHome.endsWith('.claude')).toBe(true)
  })
})

describe('findProjectRoot', () => {
  it('returns the nearest ancestor that contains a marker', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    expect(await findProjectRoot(join(root, 'a', 'b'))).toBe(root)
    expect(await pathExists(join(root, '.git'))).toBe(true)
    expect(await pathExists(join(root, 'missing'))).toBe(false)
  })

  it('accepts custom markers', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'pkg', 'src'), { recursive: true })
    await mkdir(join(root, 'pkg', '.hg'))
    expect(await findProjectRoot(join(root, 'pkg', 'src'), ['.hg'])).toBe(join(root, 'pkg'))
  })

  it('falls back to the resolved cwd when no ancestor has a marker', async () => {
    const root = await tempDir()
    expect(await findProjectRoot(root, ['.air-marker-that-does-not-exist'])).toBe(resolve(root))
  })
})

describe('isInside', () => {
  const project = abs('p')

  it('accepts the root and its descendants only', () => {
    expect(isInside(project, project)).toBe(true)
    expect(isInside(project, join(project, 'a', 'b'))).toBe(true)
    expect(isInside(project, join(project, '..', 'q'))).toBe(false)
    expect(isInside(project, abs())).toBe(false)
    expect(isInside(project, `${project}q`)).toBe(false)
  })

  it('compares Windows paths without regard to case and rejects another drive', () => {
    expect(isInside('C:\\p', 'c:\\P\\a', win32)).toBe(true)
    expect(isInside('C:\\p', 'D:\\p\\a', win32)).toBe(false)
    expect(isInside('C:\\p', 'C:\\pq', win32)).toBe(false)
    expect(isInside('C:\\p', 'C:\\p\\..\\q', win32)).toBe(false)
  })
})

describe('directoriesBetween', () => {
  const project = abs('p')

  it('lists directories from the root down to the cwd', () => {
    expect(directoriesBetween(project, join(project, 'a', 'b'))).toEqual([project, join(project, 'a'), join(project, 'a', 'b')])
    expect(directoriesBetween(project, project)).toEqual([project])
    expect(directoriesBetween('C:\\p', 'C:\\p\\a\\b', win32)).toEqual(['C:\\p', 'C:\\p\\a', 'C:\\p\\a\\b'])
  })

  it('returns only the cwd when it is outside the root', () => {
    expect(directoriesBetween(project, abs('q', 'r'))).toEqual([abs('q', 'r')])
  })
})

describe('toPosixRelative', () => {
  it('joins the relative path with forward slashes on every platform', () => {
    expect(toPosixRelative(abs('p'), join(abs('p'), 'src', 'a.ts'))).toBe('src/a.ts')
    expect(toPosixRelative('C:\\p', 'C:\\p\\src\\a.ts', win32)).toBe('src/a.ts')
  })
})
```

`air/packages/convention-core/tests/names.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toKebabName } from '../src/index.ts'

describe('toKebabName', () => {
  it.each([
    ['fix-issue', 'fix-issue'],
    ['Fix Issue', 'fix-issue'],
    ['frontend:component', 'frontend-component'],
    ['  My_Skill.v2 ', 'my-skill-v2'],
    ['Résumé', 'resume'],
  ])('normalises %j to %j', (input, expected) => {
    expect(toKebabName(input)).toBe(expected)
  })

  it('returns undefined when nothing usable remains', () => {
    expect(toKebabName('***')).toBeUndefined()
    expect(toKebabName('')).toBeUndefined()
  })
})
```

`air/packages/convention-core/tests/tool-names.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_TO_DSH_TOOL_NAMES,
  toClaudeToolNames,
  toDshToolName,
  translateToolNames,
} from '../src/index.ts'

describe('tool-name table', () => {
  it('maps Claude Code names to dsh names', () => {
    expect(CLAUDE_TO_DSH_TOOL_NAMES).toEqual({
      Bash: 'bash',
      Read: 'read',
      Write: 'write',
      Edit: 'edit',
      MultiEdit: 'edit',
      Glob: 'glob',
      Grep: 'grep',
      WebFetch: 'web_fetch',
      WebSearch: 'web_search',
      TodoWrite: 'todo_write',
      Task: 'agent',
      Agent: 'agent',
      AskUserQuestion: 'ask_user_question',
    })
  })

  it('passes MCP names through and rejects unknown names', () => {
    expect(toDshToolName('Edit')).toBe('edit')
    expect(toDshToolName('mcp__github__create_issue')).toBe('mcp__github__create_issue')
    expect(toDshToolName('NotebookEdit')).toBeUndefined()
    expect(toDshToolName('toString')).toBeUndefined()
  })

  it('maps a dsh name back to every Claude Code name', () => {
    expect(toClaudeToolNames('edit')).toEqual(['Edit', 'MultiEdit'])
    expect(toClaudeToolNames('agent')).toEqual(['Task', 'Agent'])
    expect(toClaudeToolNames('mcp__a__b')).toEqual(['mcp__a__b'])
    expect(toClaudeToolNames('jobs')).toEqual([])
  })

  it('translates a list, strips Tool(pattern) suffixes, dedups, and reports unknown names', () => {
    expect(translateToolNames(['Bash(git add:*)', 'Read', 'Edit', 'MultiEdit', 'Nope', 'mcp__x__y'])).toEqual({
      names: ['bash', 'read', 'edit', 'mcp__x__y'],
      unknown: ['Nope'],
    })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C air/packages/convention-core test`
Expected: FAIL, all three files, with `Failed to load url ../src/index.ts` (the module does not exist).

- [ ] **Step 4: Implement the modules**

`air/packages/convention-core/src/paths.ts`:

```ts
/** Home directories, project-root lookup, and path containment for the AIR convention plugins. */
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import nodePath, { type PlatformPath } from 'node:path'

/** Environment variable that overrides the AIR home directory (default `~/.air`). */
export const AIR_HOME_ENV = 'AIR_HOME'

/** Environment variable upstream `skill-filesystem` reads for the shared agents home. */
export const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

/** Optional overrides for the user-level directories the convention plugins read. */
export interface UserHomeConfig {
  /** AIR-owned home. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Shared agents home. Defaults to `$DSH_AGENTS_HOME`, then `~/.agents`. */
  agentsHome?: string
}

/** Absolute user-level directories after defaulting. */
export interface UserHomes {
  readonly airHome: string
  readonly claudeHome: string
  readonly agentsHome: string
}

/**
 * Expand a leading `~`, `~/`, or (for Windows paths) `~\` against a home directory.
 * @param path - configured path.
 * @param home - home directory; defaults to the operating-system home.
 * @param pathApi - path module used to join; pass `path.win32` to apply Windows rules on any host.
 * @returns the expanded path, or the input when it has no supported prefix.
 */
export function expandHome(path: string, home: string = homedir(), pathApi: PlatformPath = nodePath): string {
  if (path === '~') return home
  if (path.startsWith('~/') || (pathApi.sep === '\\' && path.startsWith('~\\'))) return pathApi.join(home, path.slice(2))
  return path
}

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

/**
 * Resolve the user-level directories. Precedence: explicit configuration, environment, default.
 * @param config - explicit overrides.
 * @param env - environment mapping read for `AIR_HOME` and `DSH_AGENTS_HOME`.
 * @param home - operating-system home used for defaults and `~` expansion.
 * @returns absolute directories.
 */
export function resolveUserHomes(
  config: UserHomeConfig = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): UserHomes {
  const absolute = (path: string): string => nodePath.resolve(expandHome(path, home))
  return {
    airHome: absolute(config.airHome ?? nonBlank(env[AIR_HOME_ENV]) ?? nodePath.join(home, '.air')),
    claudeHome: absolute(config.claudeHome ?? nodePath.join(home, '.claude')),
    agentsHome: absolute(config.agentsHome ?? nonBlank(env[AGENTS_HOME_ENV]) ?? nodePath.join(home, '.agents')),
  }
}

/**
 * Test whether a host path exists.
 * @param path - path to probe.
 * @returns true when the path is reachable.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Any access failure means this caller cannot use the path.
    return false
  }
}

/**
 * Find the nearest ancestor of `cwd` that contains one of the markers. The walk ends at the file
 * system root (`/`, or a drive root such as `C:\`).
 * @param cwd - directory to start from.
 * @param markers - entry names that identify a project root.
 * @returns the project root, or the resolved `cwd` when no ancestor has a marker.
 */
export async function findProjectRoot(cwd: string, markers: readonly string[] = ['.git']): Promise<string> {
  const start = nodePath.resolve(cwd)
  let current = start
  while (true) {
    for (const marker of markers) {
      if (await pathExists(nodePath.join(current, marker))) return current
    }
    const parent = nodePath.dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/**
 * Test whether `candidate` is `root` or a path below it, after normalisation. Symbolic links are not
 * resolved; use `realpathIfPresent` first when a link could leave the root. Windows paths compare
 * without regard to case, and a path on another drive is outside.
 * @param root - containing directory.
 * @param candidate - path to test.
 * @param pathApi - path module; pass `path.win32` to apply Windows rules on any host.
 * @returns true when the candidate does not leave the root.
 */
export function isInside(root: string, candidate: string, pathApi: PlatformPath = nodePath): boolean {
  const rel = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel))
}

/**
 * List every directory from `root` down to `cwd`.
 * @param root - project root.
 * @param cwd - working directory.
 * @param pathApi - path module; pass `path.win32` to apply Windows rules on any host.
 * @returns directories ordered root first; only `cwd` when it lies outside `root`.
 */
export function directoriesBetween(root: string, cwd: string, pathApi: PlatformPath = nodePath): string[] {
  const top = pathApi.resolve(root)
  const bottom = pathApi.resolve(cwd)
  if (!isInside(top, bottom, pathApi)) return [bottom]
  const directories = [top]
  let current = top
  for (const segment of pathApi.relative(top, bottom).split(pathApi.sep).filter(part => part.length > 0)) {
    current = pathApi.join(current, segment)
    directories.push(current)
  }
  return directories
}

/**
 * Express `candidate` relative to `root` with forward slashes, the form glob matching expects.
 * @param root - containing directory.
 * @param candidate - path below the root.
 * @param pathApi - path module; pass `path.win32` to apply Windows rules on any host.
 * @returns the relative path, for example `src/a.ts`.
 */
export function toPosixRelative(root: string, candidate: string, pathApi: PlatformPath = nodePath): string {
  return pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate)).split(pathApi.sep).join('/')
}
```

`air/packages/convention-core/src/names.ts`:

```ts
/** Name normalisation shared by skill and command discovery. */

/**
 * Convert a file stem, directory name, or namespaced command path into a kebab-case name.
 * @param input - raw name, for example `frontend:component` or `My Skill`.
 * @returns a name matching `^[a-z0-9]+(-[a-z0-9]+)*$`, or undefined when no letter or digit remains.
 */
export function toKebabName(input: string): string | undefined {
  const name = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return name.length > 0 ? name : undefined
}
```

`air/packages/convention-core/src/tool-names.ts`:

```ts
/** Claude Code tool names and their dsh equivalents, shared by skills, agents, hooks, and permission rules. */

/** Claude Code tool name to dsh tool name. MCP names (`mcp__server__tool`) are identical on both sides. */
export const CLAUDE_TO_DSH_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Bash: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'todo_write',
  Task: 'agent',
  Agent: 'agent',
  AskUserQuestion: 'ask_user_question',
})

const MCP_PREFIX = 'mcp__'

/**
 * Translate one Claude Code tool name.
 * @param claudeName - bare tool name without a `(pattern)` suffix.
 * @returns the dsh tool name, or undefined when the table has no entry.
 */
export function toDshToolName(claudeName: string): string | undefined {
  if (claudeName.startsWith(MCP_PREFIX)) return claudeName
  return Object.hasOwn(CLAUDE_TO_DSH_TOOL_NAMES, claudeName) ? CLAUDE_TO_DSH_TOOL_NAMES[claudeName] : undefined
}

/**
 * List the Claude Code names that map to one dsh tool name.
 * @param dshName - dsh tool name.
 * @returns matching Claude Code names in table order; empty when none map to it.
 */
export function toClaudeToolNames(dshName: string): string[] {
  if (dshName.startsWith(MCP_PREFIX)) return [dshName]
  return Object.entries(CLAUDE_TO_DSH_TOOL_NAMES)
    .filter(([, mapped]) => mapped === dshName)
    .map(([claudeName]) => claudeName)
}

/**
 * Translate a list of Claude Code tool entries such as `Read` or `Bash(git add:*)`.
 * @param claudeNames - entries from `allowed-tools`, `tools`, or a permission rule list.
 * @returns distinct dsh names in first-seen order, plus the entries the table does not know.
 */
export function translateToolNames(claudeNames: readonly string[]): { names: string[]; unknown: string[] } {
  const names: string[] = []
  const unknown: string[] = []
  for (const entry of claudeNames) {
    const open = entry.indexOf('(')
    const bare = (open < 0 ? entry : entry.slice(0, open)).trim()
    const mapped = toDshToolName(bare)
    if (mapped === undefined) unknown.push(entry)
    else if (!names.includes(mapped)) names.push(mapped)
  }
  return { names, unknown }
}
```

`air/packages/convention-core/src/index.ts`:

```ts
/**
 * Shared discovery helpers for the AIR file-convention plugins.
 * @module @air/dsh-convention-core
 */
export * from './paths.ts'
export * from './names.ts'
export * from './tool-names.ts'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C air/packages/convention-core test`
Expected: `Test Files 3 passed (3)`.

- [ ] **Step 6: Typecheck**

Run: `pnpm -C air/packages/convention-core typecheck`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```sh
git add air/packages/convention-core air/pnpm-lock.yaml
git commit -m "feat(air): add convention-core paths, names, and tool-name table"
```

---

### Task 2: `@air/dsh-convention-core` — frontmatter, file listing, watcher, README

**Files:**
- Create: `air/packages/convention-core/src/frontmatter.ts`
- Create: `air/packages/convention-core/src/files.ts`
- Create: `air/packages/convention-core/src/watch.ts`
- Modify: `air/packages/convention-core/src/index.ts`
- Create: `air/packages/convention-core/README.md`
- Test: `air/packages/convention-core/tests/frontmatter.spec.ts`
- Test: `air/packages/convention-core/tests/files.spec.ts`
- Test: `air/packages/convention-core/tests/watch.spec.ts`

**Interfaces:**
- Consumes: Task 1 package scaffold.
- Produces (exported from `@air/dsh-convention-core`):
  - `interface ParsedDocument { readonly data: Record<string, unknown>; readonly body: string; readonly hasFrontmatter: boolean }`
  - `parseFrontmatter(raw: string): ParsedDocument` (no frontmatter returns `data: {}` and the whole text as body; invalid YAML or a non-mapping throws)
  - `isRecord(value: unknown): value is Record<string, unknown>`
  - `stringField(data, key): string | undefined`
  - `booleanField(data, key): boolean | undefined` (throws `TypeError` for other values)
  - `stringListField(data, key): string[] | undefined` (YAML list, or a string split on commas and whitespace outside parentheses; throws `TypeError` otherwise)
  - `readTextFile(path: string): Promise<string | undefined>` (undefined when absent or not a regular file)
  - `fileSize(path: string): Promise<number | undefined>` (bytes of a regular file; undefined when absent or not a regular file)
  - `realpathIfPresent(path: string): Promise<string | undefined>` (symbolic links and, on Windows, letter case resolved; undefined when the path is absent)
  - `interface DirectoryEntry { readonly name: string; readonly path: string; readonly kind: 'directory' | 'file' }`
  - `listDirectory(root: string): Promise<DirectoryEntry[]>` (sorted by name; absent root returns `[]`; symbolic links are followed; broken links are skipped)
  - `interface MarkdownEntry { readonly path: string; readonly segments: readonly string[] }`
  - `listMarkdownTree(root: string, maxDepth: number): Promise<MarkdownEntry[]>` (`segments` is the relative path without the `.md` suffix; `maxDepth` 1 lists only the root)
  - `interface PollWatcherOptions { readonly intervalMs: number; readonly maxGroups: number; readonly onChange: () => void; readonly onError: (error: unknown) => void }`
  - `class PollWatcher { constructor(options: PollWatcherOptions); retain(group: string, paths: Iterable<string>, listedAt: number): void; get groups(): string[]; pollOnce(): Promise<void>; close(): void }` (one timer; groups are projects; the oldest group is released past `maxGroups`)

- [ ] **Step 1: Write the failing tests**

`air/packages/convention-core/tests/frontmatter.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { booleanField, isRecord, parseFrontmatter, stringField, stringListField } from '../src/index.ts'

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from the body', () => {
    const parsed = parseFrontmatter('---\nname: demo\ndescription: A demo\n---\n# Body\ntext\n')
    expect(parsed).toEqual({ data: { name: 'demo', description: 'A demo' }, body: '# Body\ntext\n', hasFrontmatter: true })
  })

  it('accepts CRLF line endings and a byte-order mark', () => {
    const parsed = parseFrontmatter('﻿---\r\nname: demo\r\n---\r\nbody')
    expect(parsed.data).toEqual({ name: 'demo' })
    expect(parsed.body).toBe('body')
  })

  it('returns the whole text as body when there is no frontmatter', () => {
    expect(parseFrontmatter('Just text\n')).toEqual({ data: {}, body: 'Just text\n', hasFrontmatter: false })
    expect(parseFrontmatter('---\nname: unterminated\n')).toEqual({
      data: {},
      body: '---\nname: unterminated\n',
      hasFrontmatter: false,
    })
  })

  it('treats an empty frontmatter block as no fields', () => {
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body', hasFrontmatter: true })
  })

  it('throws for invalid YAML and for a non-mapping document', () => {
    expect(() => parseFrontmatter('---\nname: [unclosed\n---\nbody')).toThrow()
    expect(() => parseFrontmatter('---\n- a\n- b\n---\nbody')).toThrow('frontmatter must be a YAML mapping')
  })
})

describe('field readers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('stringField returns non-empty strings only', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x')
    expect(stringField({ a: '' }, 'a')).toBeUndefined()
    expect(stringField({ a: 3 }, 'a')).toBeUndefined()
    expect(stringField({}, 'a')).toBeUndefined()
  })

  it('booleanField reads booleans and their string spellings', () => {
    expect(booleanField({ a: true }, 'a')).toBe(true)
    expect(booleanField({ a: 'false' }, 'a')).toBe(false)
    expect(booleanField({ a: 'TRUE' }, 'a')).toBe(true)
    expect(booleanField({}, 'a')).toBeUndefined()
    expect(() => booleanField({ a: 'maybe' }, 'a')).toThrow('frontmatter field "a" must be a boolean')
    expect(() => booleanField({ a: 1 }, 'a')).toThrow(TypeError)
  })

  it('stringListField reads YAML lists and separated strings', () => {
    expect(stringListField({ a: ['x', ' y ', ''] }, 'a')).toEqual(['x', 'y'])
    expect(stringListField({ a: 'Bash(git add:*, git commit:*), Read  Grep' }, 'a')).toEqual([
      'Bash(git add:*, git commit:*)',
      'Read',
      'Grep',
    ])
    expect(stringListField({ a: 'weird)name' }, 'a')).toEqual(['weird)name'])
    expect(stringListField({}, 'a')).toBeUndefined()
    expect(stringListField({ a: null }, 'a')).toBeUndefined()
    expect(() => stringListField({ a: [1] }, 'a')).toThrow('frontmatter field "a" must be a string or a list of strings')
    expect(() => stringListField({ a: 7 }, 'a')).toThrow(TypeError)
  })
})
```

`air/packages/convention-core/tests/files.spec.ts`:

```ts
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileSize, listDirectory, listMarkdownTree, readTextFile, realpathIfPresent } from '../src/index.ts'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-files-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('readTextFile', () => {
  it('reads a regular file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await readTextFile(join(dir, 'a.md'))).toBe('hello')
  })

  it('returns undefined for a missing path, a directory, and a path below a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await readTextFile(join(dir, 'missing.md'))).toBeUndefined()
    expect(await readTextFile(dir)).toBeUndefined()
    expect(await readTextFile(join(dir, 'a.md', 'child'))).toBeUndefined()
  })

  it('rethrows failures other than absence', async () => {
    await expect(readTextFile('bad\0path')).rejects.toThrow()
  })
})

describe('fileSize and realpathIfPresent', () => {
  it('reports the size of a regular file only', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await fileSize(join(dir, 'a.md'))).toBe(5)
    expect(await fileSize(dir)).toBeUndefined()
    expect(await fileSize(join(dir, 'missing.md'))).toBeUndefined()
  })

  it('resolves an existing path and returns undefined for an absent one', async () => {
    const dir = await tempDir()
    expect(await realpathIfPresent(dir)).toBe(await realpath(dir))
    expect(await realpathIfPresent(join(dir, 'missing'))).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('resolves a symbolic link to its target', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'real'))
    await symlink(join(dir, 'real'), join(dir, 'link'))
    expect(await realpathIfPresent(join(dir, 'link'))).toBe(await realpath(join(dir, 'real')))
  })

  it('rethrows failures other than absence', async () => {
    await expect(realpathIfPresent('bad\0path')).rejects.toThrow()
  })
})

describe('listDirectory', () => {
  it('lists files and directories sorted by name', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    expect(await listDirectory(dir)).toEqual([
      { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
      { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
    ])
  })

  it.skipIf(process.platform === 'win32')('follows symbolic links and skips broken ones', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    await symlink(join(dir, 'zeta'), join(dir, 'link'))
    await symlink(join(dir, 'nowhere'), join(dir, 'broken'))
    expect(await listDirectory(dir)).toEqual([
      { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
      { name: 'link', path: join(dir, 'link'), kind: 'directory' },
      { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
    ])
  })

  it('returns an empty list for a missing root and for a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'a')
    expect(await listDirectory(join(dir, 'missing'))).toEqual([])
    expect(await listDirectory(join(dir, 'a.md'))).toEqual([])
  })
})

describe('listMarkdownTree', () => {
  it('lists Markdown files with path segments up to the depth limit', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'frontend', 'deep'), { recursive: true })
    await writeFile(join(dir, 'fix.md'), 'x')
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(dir, 'frontend', 'component.md'), 'x')
    await writeFile(join(dir, 'frontend', 'deep', 'too-deep.md'), 'x')
    expect(await listMarkdownTree(dir, 2)).toEqual([
      { path: join(dir, 'fix.md'), segments: ['fix'] },
      { path: join(dir, 'frontend', 'component.md'), segments: ['frontend', 'component'] },
    ])
    expect(await listMarkdownTree(dir, 1)).toEqual([{ path: join(dir, 'fix.md'), segments: ['fix'] }])
  })

  it('returns an empty list for a missing root', async () => {
    expect(await listMarkdownTree(join(await tempDir(), 'missing'), 4)).toEqual([])
  })
})
```

`air/packages/convention-core/tests/watch.spec.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PollWatcher } from '../src/index.ts'

const created: string[] = []
const watchers: PollWatcher[] = []

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-watch-'))
  created.push(dir)
  return dir
}

function watcher(onChange: () => void, options: { maxGroups?: number; onError?: (error: unknown) => void } = {}): PollWatcher {
  const subject = new PollWatcher({ intervalMs: 20, maxGroups: options.maxGroups ?? 8, onChange, onError: options.onError ?? (() => {}) })
  watchers.push(subject)
  return subject
}

describe('PollWatcher', () => {
  it('reports a change to a retained file and nothing while it is unchanged', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    await sleep(120)
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now())
    await subject.pollOnce()
    await subject.pollOnce()
    expect(onChange).not.toHaveBeenCalled()
    await writeFile(file, 'one two three')
    await subject.pollOnce()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports a retained path that appears after it was listed as absent', async () => {
    const dir = await tempDir()
    const file = join(dir, 'later.md')
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now())
    await subject.pollOnce()
    expect(onChange).not.toHaveBeenCalled()
    await writeFile(file, 'now present')
    await subject.pollOnce()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports a file modified between listing and the first poll, and ignores an older one', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'content')
    const stale = vi.fn()
    watcher(stale).retain('project', [file], Date.now() + 10_000)
    const early = vi.fn()
    const subject = watcher(early)
    subject.retain('project', [file], Date.now() - 10_000)
    await subject.pollOnce()
    expect(early).toHaveBeenCalledTimes(1)
    const quiet = watcher(stale)
    quiet.retain('project', [file], Date.now() + 10_000)
    await quiet.pollOnce()
    expect(stale).not.toHaveBeenCalled()
  })

  it('polls on its own timer', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now() + 10_000)
    await subject.pollOnce()
    await writeFile(file, 'one two three four')
    await vi.waitFor(() => { expect(onChange).toHaveBeenCalled() }, { timeout: 5000 })
  })

  it('evicts the least recently retained project and invalidates once', async () => {
    const onChange = vi.fn()
    const subject = watcher(onChange, { maxGroups: 2 })
    subject.retain('a', ['pa'], 0)
    subject.retain('b', ['pb'], 0)
    subject.retain('a', ['pa'], 0)
    expect(subject.groups).toEqual(['b', 'a'])
    subject.retain('c', ['pc'], 0)
    expect(subject.groups).toEqual(['a', 'c'])
    await vi.waitFor(() => { expect(onChange).toHaveBeenCalledTimes(1) })
  })

  it('treats an unreadable path as unchanged', async () => {
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', ['bad\0path'], Date.now())
    await subject.pollOnce()
    await subject.pollOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('passes a failing change callback to onError', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onError = vi.fn()
    const subject = watcher(() => { throw new Error('boom') }, { onError })
    subject.retain('project', [file], Date.now() + 10_000)
    await subject.pollOnce()
    await writeFile(file, 'one two three four')
    await vi.waitFor(() => { expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' })) }, { timeout: 5000 })
  })

  it('stops on close, ignores later retains, and does not report a poll that finished after close', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onChange = vi.fn()
    const subject = watcher(onChange)
    subject.retain('project', [file], Date.now() + 10_000)
    await subject.pollOnce()
    await writeFile(file, 'one two three four')
    const pending = subject.pollOnce()
    subject.close()
    await pending
    expect(onChange).not.toHaveBeenCalled()
    expect(subject.groups).toEqual([])
    subject.retain('project', [file], 0)
    expect(subject.groups).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C air/packages/convention-core test`
Expected: the three new files FAIL with `parseFrontmatter is not a function`, `readTextFile is not a function`, and `PollWatcher is not a constructor`; the three Task 1 files pass.

- [ ] **Step 3: Implement the modules**

`air/packages/convention-core/src/frontmatter.ts`:

```ts
/** YAML frontmatter parsing and typed field readers for Markdown convention files. */
import { parse as parseYaml } from 'yaml'

/** A Markdown document split into frontmatter fields and body. */
export interface ParsedDocument {
  /** Frontmatter mapping; empty when the document has none. */
  readonly data: Record<string, unknown>
  /** Text after the closing `---`, or the whole text when there is no frontmatter. */
  readonly body: string
  /** Whether a complete frontmatter block was present. */
  readonly hasFrontmatter: boolean
}

/**
 * Narrow a value to a plain object.
 * @param value - value to test.
 * @returns true for non-null, non-array objects.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Split a Markdown document into YAML frontmatter and body.
 * @param raw - file content.
 * @returns the parsed fields and body; a document without a complete block has no fields.
 * @throws when the block is not valid YAML or is not a mapping.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw
  const lines = text.split('\n')
  const first = lines[0]
  if (first === undefined || stripCarriageReturn(first) !== '---') return { data: {}, body: text, hasFrontmatter: false }
  const close = lines.findIndex((line, index) => index > 0 && stripCarriageReturn(line) === '---')
  if (close < 0) return { data: {}, body: text, hasFrontmatter: false }
  const body = lines.slice(close + 1).join('\n')
  const parsed: unknown = parseYaml(lines.slice(1, close).join('\n'))
  if (parsed === null || parsed === undefined) return { data: {}, body, hasFrontmatter: true }
  if (!isRecord(parsed)) throw new TypeError('frontmatter must be a YAML mapping')
  return { data: parsed, body, hasFrontmatter: true }
}

/**
 * Read a non-empty string field.
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns the string, or undefined when absent, empty, or not a string.
 */
export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read a boolean field.
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns the boolean, or undefined when absent.
 * @throws TypeError when the value is neither a boolean nor the text `true` or `false`.
 */
export function booleanField(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const text = value.toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function splitList(value: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (char === ',' || /\s/u.test(char))) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  items.push(current)
  return items
}

/**
 * Read a list-of-strings field. Claude Code writes these either as a YAML list or as one string
 * separated by commas or spaces; separators inside parentheses belong to the item (`Bash(git add:*)`).
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns trimmed non-empty items, or undefined when the field is absent or null.
 * @throws TypeError when the value is neither a string nor a list of strings.
 */
export function stringListField(data: Record<string, unknown>, key: string): string[] | undefined {
  const value = data[key]
  if (value === undefined || value === null) return undefined
  let items: string[]
  if (typeof value === 'string') items = splitList(value)
  else if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) items = value
  else throw new TypeError(`frontmatter field "${key}" must be a string or a list of strings`)
  return items.map(item => item.trim()).filter(item => item.length > 0)
}
```

`air/packages/convention-core/src/files.ts`:

```ts
/** Host-filesystem reads and listings for convention files. Absence is a normal result, not an error. */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch (error: unknown) {
    if (isAbsent(error)) return undefined
    throw error
  }
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Read a UTF-8 text file.
 * @param path - absolute file path.
 * @returns the content, or undefined when the path is absent or not a regular file.
 */
export async function readTextFile(path: string): Promise<string | undefined> {
  const info = await statIfPresent(path)
  if (info === undefined || !info.isFile()) return undefined
  return await readFile(path, 'utf8')
}

/**
 * Read the size of a regular file without reading its content.
 * @param path - absolute file path.
 * @returns the size in bytes, or undefined when the path is absent or not a regular file.
 */
export async function fileSize(path: string): Promise<number | undefined> {
  const info = await statIfPresent(path)
  return info?.isFile() === true ? info.size : undefined
}

/**
 * Resolve symbolic links (and, on Windows, drive and letter case) of an existing path.
 * @param path - absolute path.
 * @returns the canonical path, or undefined when the path is absent.
 */
export async function realpathIfPresent(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch (error: unknown) {
    if (isAbsent(error)) return undefined
    throw error
  }
}

/** One entry of a listed directory, with symbolic links resolved to their target kind. */
export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/**
 * List the files and directories directly under `root`.
 * @param root - directory to list.
 * @returns entries sorted by name; empty when `root` is absent or not a directory. Broken links and special files are omitted.
 */
export async function listDirectory(root: string): Promise<DirectoryEntry[]> {
  const rootInfo = await statIfPresent(root)
  if (rootInfo === undefined || !rootInfo.isDirectory()) return []
  const entries: DirectoryEntry[] = []
  for (const name of (await readdir(root)).sort(compareText)) {
    const path = join(root, name)
    const info = await statIfPresent(path)
    if (info === undefined) continue
    if (info.isDirectory()) entries.push({ name, path, kind: 'directory' })
    else if (info.isFile()) entries.push({ name, path, kind: 'file' })
  }
  return entries
}

/** A Markdown file found under a root, with its relative path split into segments. */
export interface MarkdownEntry {
  readonly path: string
  /** Relative path segments; the last one has no `.md` suffix. */
  readonly segments: readonly string[]
}

/**
 * List `.md` files under `root`, descending at most `maxDepth` directory levels.
 * @param root - directory to walk.
 * @param maxDepth - number of directory levels including `root`; 1 lists only the root.
 * @returns entries in directory order, each directory sorted by name.
 */
export async function listMarkdownTree(root: string, maxDepth: number): Promise<MarkdownEntry[]> {
  const found: MarkdownEntry[] = []
  const walk = async (directory: string, prefix: readonly string[]): Promise<void> => {
    for (const entry of await listDirectory(directory)) {
      if (entry.kind === 'directory') {
        if (prefix.length + 1 < maxDepth) await walk(entry.path, [...prefix, entry.name])
      } else if (entry.name.endsWith('.md')) {
        found.push({ path: entry.path, segments: [...prefix, entry.name.slice(0, -3)] })
      }
    }
  }
  await walk(root, [])
  return found
}
```

`air/packages/convention-core/src/watch.ts`:

```ts
/** Polling change detection for convention files and directories, grouped by project. */
import { stat, type Stats } from 'node:fs/promises'

/**
 * File systems and the clock used for `listedAt` can disagree by a few milliseconds; a file whose
 * modification time is within this margin of the listing counts as modified after it.
 */
const CLOCK_SLACK_MS = 50

/** Settings for one {@link PollWatcher}. */
export interface PollWatcherOptions {
  /** Milliseconds between polls. */
  readonly intervalMs: number
  /** Maximum number of retained groups; the least recently retained group is released first. */
  readonly maxGroups: number
  /** Called once per poll in which a retained path was created, modified, or removed, and once after a group was released. */
  readonly onChange: () => void
  /** Receives an error thrown by `onChange` during a timer-driven poll. */
  readonly onError: (error: unknown) => void
}

interface Group {
  /** Millisecond timestamp taken before the group's files were listed. */
  readonly listedAt: number
  /** Path to its last fingerprint; undefined until the first poll. */
  readonly paths: Map<string, string | undefined>
}

interface Fingerprint {
  readonly key: string
  readonly modifiedMs: number
}

async function fingerprint(path: string): Promise<Fingerprint> {
  let info: Stats | undefined
  let code: unknown
  try {
    info = await stat(path)
  } catch (error: unknown) {
    // Absence is a normal state; any other failure is a state that must not look like a change.
    code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  }
  if (info !== undefined) return { key: `${info.mtimeMs}:${info.size}`, modifiedMs: info.mtimeMs }
  return { key: code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unreadable', modifiedMs: 0 }
}

/**
 * Watches the paths of a bounded number of project groups with one timer. A path that does not exist
 * yet is reported when it appears. The timer does not keep the process alive, and each poll costs one
 * `stat` per retained path.
 */
export class PollWatcher {
  private readonly retained = new Map<string, Group>()
  private timer: NodeJS.Timeout | undefined
  private closed = false

  /** @param options - poll interval, group limit, and callbacks. */
  constructor(private readonly options: PollWatcherOptions) {}

  /**
   * Replace the paths of one group and mark the group as the most recently used. Releasing the oldest
   * group when the limit is exceeded schedules one `onChange`, because a catalog built from a released
   * group is no longer watched.
   * @param group - key of the project the paths belong to.
   * @param paths - absolute paths of files or directories, existing or not.
   * @param listedAt - `Date.now()` taken before the files were listed; a path modified after it counts as changed.
   */
  retain(group: string, paths: Iterable<string>, listedAt: number): void {
    if (this.closed) return
    this.retained.delete(group)
    this.retained.set(group, { listedAt, paths: new Map([...paths].map(path => [path, undefined])) })
    let released = false
    for (const key of this.retained.keys()) {
      if (this.retained.size <= this.options.maxGroups) break
      this.retained.delete(key)
      released = true
    }
    if (released) queueMicrotask(() => { if (!this.closed) this.options.onChange() })
    this.schedule()
  }

  /** Keys of the retained groups, least recently retained first. */
  get groups(): string[] {
    return [...this.retained.keys()]
  }

  /**
   * Compare every retained path with its last fingerprint and call `onChange` once when any differs.
   * The timer calls this method; tests call it directly.
   */
  async pollOnce(): Promise<void> {
    let changed = false
    for (const group of [...this.retained.values()]) {
      for (const [path, previous] of [...group.paths]) {
        const current = await fingerprint(path)
        const differs = previous === undefined
          ? current.modifiedMs > group.listedAt - CLOCK_SLACK_MS
          : previous !== current.key
        if (differs) changed = true
        group.paths.set(path, current.key)
      }
    }
    if (changed && !this.closed) this.options.onChange()
  }

  /** Stop the timer and release every group. Later `retain` calls do nothing. */
  close(): void {
    this.closed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.retained.clear()
  }

  private schedule(): void {
    if (this.timer !== undefined || this.closed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.pollOnce()
        .catch((error: unknown) => { this.options.onError(error) })
        .finally(() => { this.schedule() })
    }, this.options.intervalMs)
    this.timer.unref()
  }
}
```

Replace `air/packages/convention-core/src/index.ts` with:

```ts
/**
 * Shared discovery helpers for the AIR file-convention plugins.
 * @module @air/dsh-convention-core
 */
export * from './paths.ts'
export * from './names.ts'
export * from './tool-names.ts'
export * from './frontmatter.ts'
export * from './files.ts'
export * from './watch.ts'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C air/packages/convention-core test`
Expected: `Test Files 6 passed (6)`.

- [ ] **Step 5: Check coverage, typecheck, build, lint**

Run: `pnpm -C air/packages/convention-core exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: every `src/*.ts` row shows 100 in all four columns; exit 0.

Run: `pnpm -C air/packages/convention-core typecheck`, then `pnpm -C air/packages/convention-core build`, then `node -e "console.log(require('fs').existsSync('air/packages/convention-core/lib/index.js'))"`
Expected: the first two exit 0; the last prints `true`.

Run: `pnpm -C air run lint`
Expected: exit 0. If oxlint reports a rule violation in the new files, change the code to satisfy the rule (do not add a disable comment) and rerun Steps 4 and 5.

- [ ] **Step 6: Write the README**

`air/packages/convention-core/README.md`:

```markdown
# @air/dsh-convention-core

## Summary

A library, not a plugin. It holds the code every AIR file-convention plugin needs: user-home and project-root resolution, YAML frontmatter parsing with typed field readers, Markdown file discovery, a polling path watcher, kebab-case name normalisation, and the table that maps Claude Code tool names to dsh tool names.

| Export | Use |
|---|---|
| `resolveUserHomes`, `expandHome` | `~/.air` (or `$AIR_HOME`), `~/.claude`, `~/.agents` (or `$DSH_AGENTS_HOME`) |
| `findProjectRoot`, `isInside`, `directoriesBetween`, `toPosixRelative` | nearest ancestor containing `.git`; containment checks; forward-slash relative paths for globs |
| `parseFrontmatter`, `stringField`, `booleanField`, `stringListField` | skill, command, and rule files |
| `readTextFile`, `fileSize`, `realpathIfPresent`, `listDirectory`, `listMarkdownTree` | discovery and containment checks; an absent path is an empty result |
| `PollWatcher` | one timer that invalidates a catalog when a watched file or directory of a project changes |
| `toKebabName` | `frontend/component.md` becomes `frontend-component` |
| `toDshToolName`, `toClaudeToolNames`, `translateToolNames` | `Edit` and `MultiEdit` become `edit`; `mcp__*` names pass through |

## Model Experience

None directly. The model sees the results through the plugins that use this library: skill names and descriptions, instruction text, and tool names.

## Known Limitations

- Files are read from the host filesystem with `node:fs`. A remote or sandboxed filesystem provider is not consulted.
- `isInside` compares normalised paths and does not resolve symbolic links; call `realpathIfPresent` on both sides when a link could leave the root. Windows rules (case-insensitive, drive letters) apply on Windows and are tested on every host through `path.win32`.
- `PollWatcher` runs one timer; a change is seen after at most one interval, each retained path costs one `stat` per interval, and a file deleted between listing and the first poll is noticed only when the registry fails to load it.
- The tool-name table covers the tools listed in the export; a Claude Code tool with no dsh equivalent (for example `NotebookEdit`) is reported as unknown.
```

- [ ] **Step 7: Commit**

```sh
git add air/packages/convention-core
git commit -m "feat(air): add convention-core frontmatter, file listing, and path watcher"
```

---

### Task 3: `@air/dsh-skill-conventions` — skill provider

**Files:**
- Create: `air/packages/skill-conventions/package.json`
- Create: `air/packages/skill-conventions/tsconfig.build.json`
- Create: `air/packages/skill-conventions/tsconfig.json`
- Create: `air/packages/skill-conventions/tsdown.config.ts`
- Create: `air/packages/skill-conventions/vitest.config.ts`
- Create: `air/packages/skill-conventions/src/parse.ts`
- Create: `air/packages/skill-conventions/src/roots.ts`
- Create: `air/packages/skill-conventions/src/index.ts`
- Create: `air/packages/skill-conventions/README.md`
- Test: `air/packages/skill-conventions/tests/parse.spec.ts`
- Test: `air/packages/skill-conventions/tests/roots.spec.ts`
- Test: `air/packages/skill-conventions/tests/provider.spec.ts`
- Test: `air/packages/skill-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `PollWatcher`, `findProjectRoot`, `isRecord`, `listDirectory`, `readTextFile`, `resolveUserHomes`, `UserHomes`, `parseFrontmatter`, `stringField`, `booleanField`, `stringListField`, `toKebabName`.
- Consumes from upstream: `ctx.skills.registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void`; `SkillCandidate`, `SkillDefinition`, `SkillLookupOptions`, `SkillInvocationPolicy`, `SkillSource` from `@deepseek-ai/dsh-skill`.
- Produces:
  - Cordis plugin module `@air/dsh-skill-conventions`: `name = 'air-skill-conventions'`, `inject = ['skills']`, `Config`, `apply(ctx, config)`.
  - `interface Config { providerName?: string; airHome?: string; claudeHome?: string; agentsHome?: string; includeUserRoots?: boolean; extraProjectRoots?: string[]; descriptionMaxChars?: number; watchIntervalMs?: number; watchMaxProjects?: number }` with defaults `'air-conventions'`, homes from `resolveUserHomes`, `false`, `[]`, `1500`, `3000`, `32`.
  - `resolveConfig(config: Config): ResolvedConfig` (throws `TypeError` on invalid values).
  - `class ConventionSkillProvider implements SkillProvider`.
  - Skill sources: `project-dsh`, `project-agents`, `project-claude`, `project-extra`, `user-air`, `user-agents`, `user-claude`.
  - `SkillCandidate.metadata.claudeCode` keys (present only when the file sets them): `allowedTools: string[]`, `disallowedTools: string[]`, `arguments: string[]`, `paths: string[]`, `model: string`, `context: string`, `agent: string`, `argumentHint: string`.
  - Bundle row used in Task 9: `{ id: air-skill-conventions, name: '@air/dsh-skill-conventions' }` (no config).

- [ ] **Step 1: Create the package scaffold**

`air/packages/skill-conventions/package.json`:

```json
{
  "name": "@air/dsh-skill-conventions",
  "description": "Skill provider for .claude/skills, .claude/commands, project skill roots, and the AIR home",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@air/dsh-convention-core": "workspace:*",
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-skill": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-skill": "link:../../../packages/skill/skill"
  }
}
```

`air/packages/skill-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/skill-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/skill-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

`air/packages/skill-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C air install`, then `pnpm -C air/packages/convention-core build`
Expected: exit 0; `air/packages/skill-conventions/node_modules/@air/dsh-convention-core/lib/index.js` exists; `air/packages/skill-conventions/node_modules/@deepseek-ai/dsh-skill/lib/index.js` exists.

- [ ] **Step 2: Write the failing parser and root tests**

`air/packages/skill-conventions/tests/parse.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSkillText, type ParseOptions } from '../src/parse.ts'

const skill: ParseOptions = { fallbackName: 'from-dir', flat: false, descriptionMaxChars: 1500 }
const flat: ParseOptions = { ...skill, flat: true }

describe('parseSkillText', () => {
  it('reads name, description, when_to_use, and body', () => {
    expect(parseSkillText('---\nname: pdf-tools\ndescription: Work with PDFs\nwhen_to_use: For PDF files\n---\n\n# PDF\nSteps.\n', skill)).toEqual({
      name: 'pdf-tools',
      description: 'Work with PDFs',
      whenToUse: 'For PDF files',
      invocation: { modelInvocable: true, userInvocable: true },
      body: '# PDF\nSteps.',
    })
  })

  it('accepts the camelCase whenToUse spelling', () => {
    expect(parseSkillText('---\ndescription: D\nwhenToUse: Sometimes\n---\nB', skill)?.whenToUse).toBe('Sometimes')
  })

  it('defaults the name to the directory name, normalised to kebab-case', () => {
    expect(parseSkillText('---\ndescription: D\n---\nB', { ...skill, fallbackName: 'My Skill' })?.name).toBe('my-skill')
    expect(parseSkillText('---\nname: Fancy Name\ndescription: D\n---\nB', skill)?.name).toBe('fancy-name')
  })

  it('defaults the description to the first body paragraph without heading marks', () => {
    expect(parseSkillText('\n\n# Deploy helper\nruns the deploy\n\nSecond paragraph.', skill)?.description).toBe('Deploy helper runs the deploy')
  })

  it('caps the description', () => {
    const parsed = parseSkillText(`---\ndescription: ${'x'.repeat(40)}\n---\nB`, { ...skill, descriptionMaxChars: 10 })
    expect(parsed?.description).toBe(`${'x'.repeat(9)}…`)
  })

  it('reads the invocation flags', () => {
    const parsed = parseSkillText('---\ndescription: D\ndisable-model-invocation: true\nuser-invocable: false\n---\nB', skill)
    expect(parsed?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it('keeps metadata and records Claude Code fields under metadata.claudeCode', () => {
    const parsed = parseSkillText([
      '---',
      'description: D',
      'metadata:',
      '  author: someone',
      'allowed-tools: Bash(git add:*), Read',
      'disallowed-tools: [Write]',
      'arguments: issue branch',
      'paths: ["src/**/*.ts"]',
      'model: sonnet',
      'context: fork',
      'agent: reviewer',
      'argument-hint: "[issue]"',
      '---',
      'B',
    ].join('\n'), skill)
    expect(parsed?.metadata).toEqual({
      author: 'someone',
      claudeCode: {
        allowedTools: ['Bash(git add:*)', 'Read'],
        disallowedTools: ['Write'],
        arguments: ['issue', 'branch'],
        paths: ['src/**/*.ts'],
        model: 'sonnet',
        context: 'fork',
        agent: 'reviewer',
        argumentHint: '[issue]',
      },
    })
  })

  it('throws for an unusable name, a missing description, and a bad flag', () => {
    expect(() => parseSkillText('---\nname: "***"\ndescription: D\n---\nB', skill)).toThrow('invalid skill name "***"')
    expect(() => parseSkillText('---\nname: x\n---\n', skill)).toThrow('no description in frontmatter or body')
    expect(() => parseSkillText('---\ndescription: D\nuser-invocable: perhaps\n---\nB', skill)).toThrow('must be a boolean')
  })

  it('accepts a flat file only when its frontmatter has a description', () => {
    expect(parseSkillText('# Project notes\nNot a skill.', flat)).toBeUndefined()
    expect(parseSkillText('---\nname: x\n---\nBody', flat)).toBeUndefined()
    expect(parseSkillText('---\ndescription: A flat skill\n---\nBody', flat)?.name).toBe('from-dir')
  })
})
```

`air/packages/skill-conventions/tests/roots.spec.ts`:

```ts
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skillRoots } from '../src/roots.ts'

const base = (...segments: string[]): string => resolve(sep, ...segments)
const homes = { airHome: base('h', '.air'), claudeHome: base('h', '.claude'), agentsHome: base('h', '.agents') }

describe('skillRoots', () => {
  it('lists project roots and the AIR home, without user roots by default', () => {
    const projectRoot = base('p')
    expect(skillRoots({ projectRoot, homes, includeUserRoots: false, extraProjectRoots: ['.opencode/skills'] })).toEqual([
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 },
      { path: join(projectRoot, '.claude', 'skills'), source: 'project-claude', rank: 220 },
      { path: join(projectRoot, '.opencode', 'skills'), source: 'project-extra', rank: 240 },
      { path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350 },
    ])
  })

  it('adds the user roots only on request and omits project roots without a project', () => {
    expect(skillRoots({ projectRoot: undefined, homes, includeUserRoots: true, extraProjectRoots: ['x'] })).toEqual([
      { path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350 },
      { path: join(homes.agentsHome, 'skills'), source: 'user-agents', rank: 500 },
      { path: join(homes.claudeHome, 'skills'), source: 'user-claude', rank: 520 },
    ])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C air/packages/skill-conventions exec vitest run tests/parse.spec.ts tests/roots.spec.ts`
Expected: FAIL with `Failed to load url ../src/parse.ts` and `Failed to load url ../src/roots.ts`.

- [ ] **Step 4: Implement the parser and the root list**

`air/packages/skill-conventions/src/parse.ts`:

```ts
/** Parses skill files into skill metadata. */
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import {
  booleanField,
  isRecord,
  parseFrontmatter,
  stringField,
  stringListField,
  toKebabName,
} from '@air/dsh-convention-core'

/** Inputs that depend on where the file was found and on plugin configuration. */
export interface ParseOptions {
  /** Directory name or file stem used when the file declares no name. */
  readonly fallbackName: string
  /** True for `<name>.md` directly in a skill root; such a file is a skill only when its frontmatter has a `description`, so `README.md` is not listed. */
  readonly flat: boolean
  /** Longest description kept; longer text ends with an ellipsis. */
  readonly descriptionMaxChars: number
}

/** A parsed skill file. */
export interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly metadata?: Record<string, unknown>
  /** Trimmed Markdown body with placeholders left as written. */
  readonly body: string
}

const LIST_FIELDS = [
  ['allowed-tools', 'allowedTools'],
  ['disallowed-tools', 'disallowedTools'],
  ['arguments', 'arguments'],
  ['paths', 'paths'],
] as const

const STRING_FIELDS = [
  ['model', 'model'],
  ['context', 'context'],
  ['agent', 'agent'],
  ['argument-hint', 'argumentHint'],
] as const

function firstParagraph(body: string): string | undefined {
  for (const block of body.split(/\n\s*\n/u)) {
    const text = block.replace(/^\s*#+\s*/u, '').replace(/\s+/gu, ' ').trim()
    if (text.length > 0) return text
  }
  return undefined
}

function claudeCodeFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [key, target] of LIST_FIELDS) {
    const value = stringListField(data, key)
    if (value !== undefined) fields[target] = value
  }
  for (const [key, target] of STRING_FIELDS) {
    const value = stringField(data, key)
    if (value !== undefined) fields[target] = value
  }
  return fields
}

/**
 * Parse one skill file.
 * @param raw - file content.
 * @param options - fallback name, whether the file is flat, and the description limit.
 * @returns name, description, invocation policy, recorded Claude Code fields, and body; undefined for a flat file that is not a skill.
 * @throws when the YAML is invalid, a flag is not a boolean, no usable name remains, or no description can be derived.
 */
export function parseSkillText(raw: string, options: ParseOptions): ParsedSkillFile | undefined {
  const { data, body } = parseFrontmatter(raw)
  if (options.flat && stringField(data, 'description') === undefined) return undefined
  const declared = stringField(data, 'name') ?? options.fallbackName
  const name = toKebabName(declared)
  if (name === undefined) throw new Error(`invalid skill name "${declared}"`)
  const description = stringField(data, 'description') ?? firstParagraph(body)
  if (description === undefined) throw new Error('no description in frontmatter or body')
  const invocation: SkillInvocationPolicy = {
    modelInvocable: booleanField(data, 'disable-model-invocation') !== true,
    userInvocable: booleanField(data, 'user-invocable') !== false,
  }
  const whenToUse = stringField(data, 'when_to_use') ?? stringField(data, 'whenToUse')
  const claudeCode = claudeCodeFields(data)
  const declaredMetadata = data['metadata']
  const metadata: Record<string, unknown> = {
    ...isRecord(declaredMetadata) ? declaredMetadata : {},
    ...Object.keys(claudeCode).length > 0 ? { claudeCode } : {},
  }
  return {
    name,
    description: description.length <= options.descriptionMaxChars
      ? description
      : `${description.slice(0, options.descriptionMaxChars - 1)}…`,
    ...whenToUse !== undefined ? { whenToUse } : {},
    invocation,
    ...Object.keys(metadata).length > 0 ? { metadata } : {},
    body: body.trim(),
  }
}
```

`air/packages/skill-conventions/src/roots.ts`:

```ts
/** The skill roots this provider scans and their precedence ranks. */
import { join } from 'node:path'
import type { SkillSource } from '@deepseek-ai/dsh-skill'
import type { UserHomes } from '@air/dsh-convention-core'

/** One directory scanned for skills: `<dir>/SKILL.md` and flat `<name>.md`, one level. Lower `rank` wins a duplicate name inside one registry layer. */
export interface SkillRoot {
  readonly path: string
  readonly source: SkillSource
  readonly rank: number
}

/** Inputs for {@link skillRoots}. */
export interface RootOptions {
  /** Project root of the lookup cwd; undefined for a lookup without a cwd. */
  readonly projectRoot: string | undefined
  readonly homes: UserHomes
  /** Whether `~/.agents/skills` and `~/.claude/skills` are scanned. */
  readonly includeUserRoots: boolean
  /** Extra skill directories relative to the project root, for example `.opencode/skills`. */
  readonly extraProjectRoots: readonly string[]
}

/**
 * List the roots for one lookup. Ranks match upstream `skill-filesystem` for `.dsh/skills` (100) and
 * `.agents/skills` (200); the remaining roots follow in the documented priority order.
 * @param options - project root, homes, and opt-in flags.
 * @returns roots in ascending rank order.
 */
export function skillRoots(options: RootOptions): SkillRoot[] {
  const { projectRoot, homes } = options
  const roots: SkillRoot[] = []
  if (projectRoot !== undefined) {
    roots.push(
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 },
      { path: join(projectRoot, '.claude', 'skills'), source: 'project-claude', rank: 220 },
    )
    for (const relativeRoot of options.extraProjectRoots) {
      roots.push({ path: join(projectRoot, relativeRoot), source: 'project-extra', rank: 240 })
    }
  }
  roots.push({ path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350 })
  if (options.includeUserRoots) {
    roots.push(
      { path: join(homes.agentsHome, 'skills'), source: 'user-agents', rank: 500 },
      { path: join(homes.claudeHome, 'skills'), source: 'user-claude', rank: 520 },
    )
  }
  return roots
}
```

- [ ] **Step 5: Run the parser and root tests to verify they pass**

Run: `pnpm -C air/packages/skill-conventions exec vitest run tests/parse.spec.ts tests/roots.spec.ts`
Expected: `Test Files 2 passed (2)`.

- [ ] **Step 6: Write the failing provider tests**

`air/packages/skill-conventions/tests/provider.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as skillConventions from '../src/index.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  project: string
  home: string
  config: skillConventions.Config
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-skill-'))
  created.push(base)
  const project = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  return {
    project,
    home,
    config: {
      airHome: join(home, '.air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, '.agents'),
      watchIntervalMs: 0,
    },
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

function skillText(description: string, extra = '', body = 'Body.'): string {
  return `---\ndescription: ${description}\n${extra}---\n${body}\n`
}

async function mount(config: skillConventions.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(skillConventions, config)
  return { ctx, fiber }
}

async function names(ctx: Context, cwd: string | undefined): Promise<string[]> {
  return (await ctx.skills.list({ cwd })).map(skill => skill.name).sort()
}

describe('air-skill-conventions provider', () => {
  it('lists project roots and the AIR home and leaves user roots and command files out by default', async () => {
    const { project, home, config } = await world()
    await write(join(project, '.dsh/skills/alpha/SKILL.md'), skillText('Alpha', 'name: alpha\n'))
    await write(join(project, '.agents/skills/beta/SKILL.md'), skillText('Beta'))
    await write(join(project, '.claude/skills/gamma/SKILL.md'), skillText('Gamma'))
    await write(join(project, '.claude/skills/flat.md'), skillText('Flat'))
    await write(join(project, '.claude/skills/README.md'), '# Skills in this project\nNot a skill.')
    await write(join(project, '.claude/skills/notes.txt'), 'not a skill')
    await write(join(project, '.claude/skills/empty-dir/readme.txt'), 'no SKILL.md here')
    await write(join(project, '.claude/commands/frontend/component.md'), 'Create a component named $ARGUMENTS')
    await write(join(home, '.air/skills/delta.md'), skillText('Delta'))
    await write(join(home, '.agents/skills/decoy/SKILL.md'), skillText('Decoy'))
    await write(join(home, '.claude/skills/decoy-two/SKILL.md'), skillText('Decoy two'))
    const { ctx } = await mount(config)
    expect(await names(ctx, project)).toEqual(['alpha', 'beta', 'delta', 'flat', 'gamma'])
    expect(await names(ctx, undefined)).toEqual(['delta'])
  })

  it('includes the user skill roots on request', async () => {
    const { project, home, config } = await world()
    await write(join(home, '.agents/skills/shared/SKILL.md'), skillText('Shared'))
    await write(join(home, '.claude/skills/personal/SKILL.md'), skillText('Personal'))
    await write(join(home, '.claude/commands/standup.md'), 'Write my standup')
    const { ctx } = await mount({ ...config, includeUserRoots: true })
    expect(await names(ctx, project)).toEqual(['personal', 'shared'])
  })

  it('scans extra project roots', async () => {
    const { project, config } = await world()
    await write(join(project, '.opencode/skills/extra/SKILL.md'), skillText('Extra'))
    const { ctx } = await mount({ ...config, extraProjectRoots: ['.opencode/skills'] })
    const [skill] = await ctx.skills.list({ cwd: project })
    expect(skill).toMatchObject({ name: 'extra', source: 'project-extra', provider: 'air-conventions' })
  })

  it('lets the lower rank win a duplicate name', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/same/SKILL.md'), skillText('From claude'))
    await write(join(project, '.dsh/skills/same/SKILL.md'), skillText('From dsh'))
    const { ctx } = await mount(config)
    const [skill] = await ctx.skills.list({ cwd: project })
    expect(skill).toMatchObject({ name: 'same', description: 'From dsh', source: 'project-dsh' })
  })

  it('loads a body with the skill directory substituted and $ARGUMENTS left literal', async () => {
    const { project, config } = await world()
    const directory = join(project, '.claude/skills/tool')
    await write(join(directory, 'SKILL.md'), skillText('Tool', 'allowed-tools: Read\n', 'Run ${CLAUDE_SKILL_DIR}/run.sh with $ARGUMENTS'))
    const { ctx } = await mount(config)
    const definition = await ctx.skills.get('tool', { cwd: project })
    expect(definition).toMatchObject({
      name: 'tool',
      provider: 'air-conventions',
      source: 'project-claude',
      content: `Run ${directory}/run.sh with $ARGUMENTS`,
      resourceBase: { kind: 'directory', path: directory },
      metadata: { claudeCode: { allowedTools: ['Read'] } },
    })
  })

  it('drops a file with invalid frontmatter and keeps the rest', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/bad/SKILL.md'), '---\nname: [unclosed\n---\nBody')
    await write(join(project, '.claude/skills/good/SKILL.md'), skillText('Good', 'when_to_use: Always\n'))
    const { ctx } = await mount(config)
    const listed = await ctx.skills.list({ cwd: project })
    expect(listed.map(skill => skill.name)).toEqual(['good'])
    expect(listed[0]?.whenToUse).toBe('Always')
  })

  it('drops a skill that is neither model- nor user-invocable', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/hidden/SKILL.md'), skillText('Hidden', 'disable-model-invocation: true\nuser-invocable: false\n'))
    const { ctx } = await mount(config)
    expect(await names(ctx, project)).toEqual([])
  })

  it('removes its skills when the plugin unloads', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/gone/SKILL.md'), skillText('Gone'))
    const { ctx, fiber } = await mount({ ...config, watchIntervalMs: 20 })
    expect(await names(ctx, project)).toEqual(['gone'])
    await fiber.dispose()
    expect(await names(ctx, project)).toEqual([])
  })

  it('refreshes the catalog when a watched root gains a skill', async () => {
    const { project, config } = await world()
    const { ctx } = await mount({ ...config, watchIntervalMs: 20 })
    expect(await names(ctx, project)).toEqual([])
    await write(join(project, '.claude/skills/late/SKILL.md'), skillText('Late'))
    await vi.waitFor(async () => { expect(await names(ctx, project)).toEqual(['late']) }, { timeout: 5000 })
  })

  it('refreshes the catalog when a listed skill file changes', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/edited/SKILL.md')
    await write(file, skillText('First wording'))
    const { ctx } = await mount({ ...config, watchIntervalMs: 20 })
    expect((await ctx.skills.list({ cwd: project }))[0]?.description).toBe('First wording')
    await write(file, skillText('Second wording, which is longer'))
    await vi.waitFor(async () => { expect((await ctx.skills.list({ cwd: project }))[0]?.description).toBe('Second wording, which is longer') }, { timeout: 5000 })
  })
})

describe('ConventionSkillProvider.get', () => {
  const control = { signal: new AbortController().signal, invalidate: () => {} }

  it('returns undefined for a candidate it did not create and for a deleted file', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/temp/SKILL.md')
    await write(file, skillText('Temp'))
    const provider = new skillConventions.ConventionSkillProvider({ warn: () => {} }, control, skillConventions.resolveConfig(config))
    const [candidate] = await provider.list({ cwd: project })
    if (candidate === undefined) throw new Error('expected one candidate')
    const foreign: SkillCandidate = { ...candidate, locator: 'not-a-locator' }
    expect(await provider.get(foreign)).toBeUndefined()
    await rm(file)
    expect(await provider.get(candidate)).toBeUndefined()
    provider.dispose()
  })
})

describe('ConventionSkillProvider change notification', () => {
  it('logs a failing invalidate callback', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/temp/SKILL.md')
    await write(file, skillText('Temp'))
    const warn = vi.fn()
    const invalidate = (): void => { throw new Error('boom') }
    const provider = new skillConventions.ConventionSkillProvider({ warn }, { signal: new AbortController().signal, invalidate }, skillConventions.resolveConfig({ ...config, watchIntervalMs: 20 }))
    await provider.list({ cwd: project })
    await write(file, skillText('Temp with a longer description'))
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom')) }, { timeout: 5000 })
    provider.dispose()
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    const homes = { airHome: resolve(sep, 'a'), claudeHome: resolve(sep, 'c'), agentsHome: resolve(sep, 'g') }
    expect(skillConventions.resolveConfig(homes)).toEqual({
      providerName: 'air-conventions',
      homes,
      includeUserRoots: false,
      extraProjectRoots: [],
      descriptionMaxChars: 1500,
      watchIntervalMs: 3000,
      watchMaxProjects: 32,
    })
  })

  it('rejects invalid values', () => {
    expect(() => skillConventions.resolveConfig({ descriptionMaxChars: 0 })).toThrow('descriptionMaxChars must be a positive integer')
    expect(() => skillConventions.resolveConfig({ watchIntervalMs: -1 })).toThrow('watchIntervalMs must be a non-negative integer')
    expect(() => skillConventions.resolveConfig({ watchMaxProjects: 0.5 })).toThrow('watchMaxProjects must be a positive integer')
    for (const root of ['/abs', 'C:\\abs', 'a/../../b', 'a\\..\\..\\b']) {
      expect(() => skillConventions.resolveConfig({ extraProjectRoots: [root] })).toThrow('must be a relative path inside the project')
    }
  })
})
```

- [ ] **Step 7: Run the provider tests to verify they fail**

Run: `pnpm -C air/packages/skill-conventions exec vitest run tests/provider.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 8: Implement the plugin**

`air/packages/skill-conventions/src/index.ts`:

```ts
/**
 * Skill provider for the file conventions other agents use: project `.dsh/skills`, `.agents/skills`,
 * `.claude/skills`, extra project roots, the AIR home, and opt-in user roots. `.claude/commands` files
 * are not skills here; `@air/dsh-command-conventions` registers them as slash commands.
 * Mount it in the same agent preset as upstream `skill-filesystem` so both register in one layer.
 *
 * @module @air/dsh-skill-conventions
 */
import { join, posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import {
  PollWatcher,
  findProjectRoot,
  isRecord,
  listDirectory,
  readTextFile,
  resolveUserHomes,
  type UserHomes,
} from '@air/dsh-convention-core'
import { parseSkillText, type ParsedSkillFile } from './parse.ts'
import { skillRoots } from './roots.ts'

export const name = 'air-skill-conventions'
export const inject = ['skills']

/** Plugin configuration. */
export interface Config {
  /** Unique provider name in the skill registry layer. Defaults to `air-conventions`. */
  providerName?: string
  /** AIR home; its `skills` directory is always scanned. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home, read only with `includeUserRoots`. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Shared agents home, read only with `includeUserRoots`. Defaults to `$DSH_AGENTS_HOME`, then `~/.agents`. */
  agentsHome?: string
  /** Whether `<agentsHome>/skills` and `<claudeHome>/skills` are scanned. Defaults to false. */
  includeUserRoots?: boolean
  /** Extra skill directories relative to the project root, for example `.opencode/skills`. */
  extraProjectRoots?: string[]
  /** Longest skill description kept in the catalog. Defaults to 1500. */
  descriptionMaxChars?: number
  /** Milliseconds between polls of scanned roots and skill files; 0 disables watching. Defaults to 3000. */
  watchIntervalMs?: number
  /** Maximum number of projects whose roots stay watched. Defaults to 32. */
  watchMaxProjects?: number
}

export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default('air-conventions').description('Unique provider name in the skill registry layer.'),
  airHome: Schema.string().description('AIR home; defaults to $AIR_HOME, then ~/.air.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  agentsHome: Schema.string().description('Shared agents home; defaults to $DSH_AGENTS_HOME, then ~/.agents.'),
  includeUserRoots: Schema.boolean().default(false).description('Scan ~/.agents/skills and ~/.claude/skills.'),
  extraProjectRoots: Schema.array(Schema.string()).default([]).description('Extra skill directories relative to the project root.'),
  descriptionMaxChars: Schema.number().default(1500).description('Longest skill description kept in the catalog.'),
  watchIntervalMs: Schema.number().default(3000).description('Milliseconds between polls of scanned paths; 0 disables watching.'),
  watchMaxProjects: Schema.number().default(32).description('Maximum number of projects whose skill roots stay watched.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly providerName: string
  readonly homes: UserHomes
  readonly includeUserRoots: boolean
  readonly extraProjectRoots: readonly string[]
  readonly descriptionMaxChars: number
  readonly watchIntervalMs: number
  readonly watchMaxProjects: number
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? 'air-conventions',
    homes: resolveUserHomes(config),
    includeUserRoots: config.includeUserRoots ?? false,
    extraProjectRoots: config.extraProjectRoots ?? [],
    descriptionMaxChars: config.descriptionMaxChars ?? 1500,
    watchIntervalMs: config.watchIntervalMs ?? 3000,
    watchMaxProjects: config.watchMaxProjects ?? 32,
  }
  if (!Number.isInteger(resolved.descriptionMaxChars) || resolved.descriptionMaxChars < 1) {
    throw new TypeError('air-skill-conventions: descriptionMaxChars must be a positive integer')
  }
  if (!Number.isInteger(resolved.watchIntervalMs) || resolved.watchIntervalMs < 0) {
    throw new TypeError('air-skill-conventions: watchIntervalMs must be a non-negative integer')
  }
  if (!Number.isInteger(resolved.watchMaxProjects) || resolved.watchMaxProjects < 1) {
    throw new TypeError('air-skill-conventions: watchMaxProjects must be a positive integer')
  }
  for (const root of resolved.extraProjectRoots) {
    // Both path flavors are checked so a profile patch shared between Windows and Linux fails the same way on each.
    if (posix.isAbsolute(root) || win32.isAbsolute(root) || root.split(/[\\/]/u).includes('..')) {
      throw new TypeError(`air-skill-conventions: extraProjectRoots entry "${root}" must be a relative path inside the project`)
    }
  }
  return resolved
}

interface SkillFile {
  readonly path: string
  /** Directory that `${CLAUDE_SKILL_DIR}` and relative resources resolve against. */
  readonly directory: string
  readonly fallbackName: string
  /** True for `<name>.md` directly in a root. */
  readonly flat: boolean
}

function isLocator(value: unknown): value is SkillFile {
  return isRecord(value)
    && typeof value['path'] === 'string'
    && typeof value['directory'] === 'string'
    && typeof value['fallbackName'] === 'string'
    && typeof value['flat'] === 'boolean'
}

async function skillFiles(rootPath: string): Promise<SkillFile[]> {
  const files: SkillFile[] = []
  for (const entry of await listDirectory(rootPath)) {
    if (entry.kind === 'directory') {
      files.push({ path: join(entry.path, 'SKILL.md'), directory: entry.path, fallbackName: entry.name, flat: false })
    } else if (entry.name.endsWith('.md')) {
      files.push({ path: entry.path, directory: rootPath, fallbackName: entry.name.slice(0, -3), flat: true })
    }
  }
  return files
}

/** Skill provider over the convention roots. One instance serves every lookup cwd. */
export class ConventionSkillProvider implements SkillProvider {
  readonly name: string
  private readonly watcher: PollWatcher | undefined

  /**
   * @param logger - receives warnings about unreadable skill files and failed change notifications.
   * @param control - registration lifecycle; `invalidate` is called when a watched path changes.
   * @param config - resolved configuration.
   */
  constructor(
    private readonly logger: Pick<Context['logger'], 'warn'>,
    control: SkillProviderControl,
    private readonly config: ResolvedConfig,
  ) {
    this.name = config.providerName
    this.watcher = config.watchIntervalMs > 0
      ? new PollWatcher({
        intervalMs: config.watchIntervalMs,
        maxGroups: config.watchMaxProjects,
        onChange: control.invalidate,
        onError: (error: unknown) => { logger.warn(`air-skill-conventions: change notification failed: ${String(error)}`) },
      })
      : undefined
    control.signal.addEventListener('abort', () => { this.dispose() }, { once: true })
  }

  /**
   * Discover skill candidates for one lookup.
   * @param options - lookup options; `cwd` selects the project roots.
   * @returns candidates from every configured root; files that fail to parse are logged and omitted.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const listedAt = Date.now()
    const projectRoot = options.cwd === undefined ? undefined : await findProjectRoot(options.cwd)
    const roots = skillRoots({
      projectRoot,
      homes: this.config.homes,
      includeUserRoots: this.config.includeUserRoots,
      extraProjectRoots: this.config.extraProjectRoots,
    })
    const candidates: SkillCandidate[] = []
    const watched: string[] = []
    for (const root of roots) {
      watched.push(root.path)
      for (const file of await skillFiles(root.path)) {
        watched.push(file.path)
        const parsed = await this.parse(file)
        if (parsed === undefined) continue
        if (!parsed.invocation.modelInvocable && !parsed.invocation.userInvocable) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          provider: this.name,
          source: root.source,
          rank: root.rank,
          locator: file,
          resourceBase: { kind: 'directory', path: file.directory },
          path: file.path,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        })
      }
    }
    this.watcher?.retain(projectRoot ?? '', watched, listedAt)
    return candidates
  }

  /**
   * Load the body of a candidate this provider listed.
   * @param candidate - winning candidate from {@link list}.
   * @returns the definition with `${CLAUDE_SKILL_DIR}` replaced by the skill directory, or undefined when the file is gone or no longer parses.
   */
  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator
    if (!isLocator(locator)) return undefined
    const parsed = await this.parse(locator)
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      content: parsed.body.replaceAll('${CLAUDE_SKILL_DIR}', locator.directory),
    }
  }

  /** Stop watching. Safe to call more than once. */
  dispose(): void {
    this.watcher?.close()
  }

  private async parse(file: SkillFile): Promise<ParsedSkillFile | undefined> {
    const raw = await readTextFile(file.path)
    if (raw === undefined) return undefined
    try {
      return parseSkillText(raw, {
        fallbackName: file.fallbackName,
        flat: file.flat,
        descriptionMaxChars: this.config.descriptionMaxChars,
      })
    } catch (error: unknown) {
      this.logger.warn(`air-skill-conventions: ${file.path} ignored: ${(error as Error).message}`)
      return undefined
    }
  }
}

/**
 * Register the convention skill provider in the calling context's skill-registry layer.
 * @param ctx - plugin context with the `skills` service injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  let provider: ConventionSkillProvider | undefined
  ctx.skills.registerProvider((control) => {
    provider = new ConventionSkillProvider(ctx.logger, control, resolved)
    return provider
  })
  ctx.effect(() => () => { provider?.dispose() }, 'air-skill-conventions.watcher')
}
```

- [ ] **Step 9: Run all unit tests to verify they pass**

Run: `pnpm -C air/packages/skill-conventions exec vitest run tests/parse.spec.ts tests/roots.spec.ts tests/provider.spec.ts`
Expected: `Test Files 3 passed (3)`.

If `ctx.logger.warn` is reported as not callable, compare with `packages/skill/skill-filesystem/src/index.ts` (it calls `ctx.logger.warn(message)` the same way) and check that `@deepseek-ai/cordis` resolves to `vendor/cordis`: `node -e "console.log(require('fs').realpathSync('air/packages/skill-conventions/node_modules/@deepseek-ai/cordis'))"` must print a path ending in `vendor/cordis` (or `vendor\cordis` on Windows).

- [ ] **Step 10: Write the native Loader test**

`air/packages/skill-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-skill'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-skill-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude', 'skills', 'hello'), { recursive: true })
  await writeFile(join(project, '.claude', 'skills', 'hello', 'SKILL.md'), '---\ndescription: Say hello\n---\nGreet the user.\n')
  await mkdir(join(home, '.agents', 'skills', 'decoy'), { recursive: true })
  await writeFile(join(home, '.agents', 'skills', 'decoy', 'SKILL.md'), '---\ndescription: Decoy\n---\nUnrelated.\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    '- id: air-skill-conventions',
    "  name: '@air/dsh-skill-conventions'",
    '  config:',
    `    airHome: ${JSON.stringify(join(home, '.air'))}`,
    `    claudeHome: ${JSON.stringify(join(home, '.claude'))}`,
    `    agentsHome: ${JSON.stringify(join(home, '.agents'))}`,
    '    watchIntervalMs: 0',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const skills = await context.skills.list({ cwd: project })
  expect(skills.map(skill => skill.name)).toEqual(['hello'])
  expect(skills[0]).toMatchObject({ provider: 'air-conventions', source: 'project-claude' })
  expect((await context.skills.get('hello', { cwd: project }))?.content).toBe('Greet the user.')
})
```

- [ ] **Step 11: Build, then run the whole suite with coverage**

Run: `pnpm -C air/packages/skill-conventions build`, then `pnpm -C air/packages/skill-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 4 passed (4)`; `index.ts`, `parse.ts`, and `roots.ts` at 100 in every column.

Run: `pnpm -C air/packages/skill-conventions typecheck`, then `pnpm -C air run lint`
Expected: exit 0 for both.

- [ ] **Step 12: Write the README**

`air/packages/skill-conventions/README.md`:

```markdown
# @air/dsh-skill-conventions

## Summary

A skill provider (`air-conventions`) for the directories other agents already use. It registers through `ctx.skills.registerProvider` and must be mounted in the same agent preset as upstream `skill-filesystem`, because the preset layer wins duplicate names over host-level providers. The AIR preset sets `skill-filesystem` to `includeDefaultRoots: false`, so this provider is the only source of project and user skill directories. Upstream still lists its `customSkillDirs` and the bundled skill directory (`DSH_BUNDLED_SKILL_DIR`), which this provider does not touch.

| Root | Source | Rank | Scanned |
|---|---|---|---|
| `<project>/.dsh/skills` | `project-dsh` | 100 | always |
| `<project>/.agents/skills` | `project-agents` | 200 | always |
| `<project>/.claude/skills` | `project-claude` | 220 | always |
| each `extraProjectRoots` entry | `project-extra` | 240 | when configured |
| `<airHome>/skills` | `user-air` | 350 | always |
| `<agentsHome>/skills` | `user-agents` | 500 | `includeUserRoots: true` |
| `<claudeHome>/skills` | `user-claude` | 520 | `includeUserRoots: true` |

`<project>` is the nearest ancestor of the session cwd that contains `.git`. A lower rank wins a duplicate name; the registry logs the one it dropped. A skill is `<root>/<dir>/SKILL.md`, or `<root>/<name>.md` when that file's frontmatter has a `description` (a plain `README.md` in a skills folder is not a skill). `.claude/commands` files are not skills; `@air/dsh-command-conventions` registers them as slash commands.

Differences from upstream `skill-filesystem` parsing: `name` defaults to the directory or file name; `description` defaults to the first body paragraph for a `SKILL.md`; `when_to_use` is accepted; a `SKILL.md` without frontmatter is valid. The Claude Code fields `allowed-tools`, `disallowed-tools`, `arguments`, `paths`, `model`, `context`, `agent`, and `argument-hint` are recorded under `metadata.claudeCode` for other AIR plugins and have no effect here.

Config: `providerName`, `airHome`, `claudeHome`, `agentsHome`, `includeUserRoots` (default `false`), `extraProjectRoots` (default `[]`; relative, no `..`), `descriptionMaxChars` (default 1500), `watchIntervalMs` (default 3000; 0 disables), `watchMaxProjects` (default 32).

## Model Experience

The model sees these skills in the same catalog and loads them with the same `skill` tool as any other skill. A loaded body has `${CLAUDE_SKILL_DIR}` replaced with the absolute skill directory. `$ARGUMENTS` and `$1` placeholders stay literal on the skill path.

## Known Limitations

- Skills written for Claude Code may name tools that do not exist here (`NotebookEdit`) or use Claude Code tool names (`Bash`, `Edit`); the model sees those names unchanged.
- `allowed-tools`, `context: fork`, `agent`, `model`, and `paths` are recorded but not enforced.
- `` !`cmd` `` lines and `@file` references in a skill body are not expanded.
- A command file cannot be invoked by the model, and Claude Code's merge of commands into skills is not reproduced.
- Files are read from the host filesystem, not through `ctx.fs`.
- Nested `<subdir>/.claude/skills` directories below the project root are not scanned.
- With `includeDefaultRoots: false` on upstream `skill-filesystem`, `~/.dsh/skills` and `~/.agents/skills` are not listed; put harness-native skills in `~/.air/skills` or `<project>/.dsh/skills`.
- A changed description is seen after at most one `watchIntervalMs`; a body edit is always read fresh. Only the `watchMaxProjects` most recently listed projects are watched; a project released from the watch list causes one catalog rebuild.
```

- [ ] **Step 13: Commit**

```sh
git add air/packages/skill-conventions air/pnpm-lock.yaml
git commit -m "feat(air): add the convention skill provider with opt-in user roots"
```

---

### Task 4: `@air/dsh-instruction-conventions` — imports, rules, baseline text

**Files:**
- Create: `air/packages/instruction-conventions/package.json`
- Create: `air/packages/instruction-conventions/tsconfig.build.json`
- Create: `air/packages/instruction-conventions/tsconfig.json`
- Create: `air/packages/instruction-conventions/tsdown.config.ts`
- Create: `air/packages/instruction-conventions/vitest.config.ts`
- Create: `air/packages/instruction-conventions/src/imports.ts`
- Create: `air/packages/instruction-conventions/src/rules.ts`
- Create: `air/packages/instruction-conventions/src/baseline.ts`
- Test: `air/packages/instruction-conventions/tests/imports.spec.ts`
- Test: `air/packages/instruction-conventions/tests/rules.spec.ts`
- Test: `air/packages/instruction-conventions/tests/baseline.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `directoriesBetween`, `expandHome`, `fileSize`, `isInside`, `listMarkdownTree`, `parseFrontmatter`, `readTextFile`, `realpathIfPresent`, `stringListField`.
- Produces (package-internal modules used by Task 5):
  - `imports.ts`: `MAX_IMPORT_HOPS = 4`; `interface InstructionFile { readonly path: string; readonly content: string }`; `interface SkippedImport { readonly path: string; readonly reason: 'outside-project' | 'max-hops' | 'sensitive' | 'too-large' }`; `interface ImportOptions { readonly projectRoot: string; readonly allowedRoots: readonly string[]; readonly home: string; readonly maxFileBytes: number }`; `isSensitivePath(path: string): boolean`; `findImportPaths(text: string): string[]`; `resolveImports(seeds: readonly InstructionFile[], options: ImportOptions): Promise<{ files: InstructionFile[]; skipped: SkippedImport[] }>`.
  - `rules.ts`: `interface Rule { readonly path: string; readonly relativePath: string; readonly content: string; readonly globs: readonly string[]; readonly digest: string }`; `loadClaudeRules(projectRoot: string): Promise<{ rules: Rule[]; problems: string[] }>`; `matchingRules(rules: readonly Rule[], relativeFilePath: string): Rule[]`.
  - `baseline.ts`: `interface BaselineInput { readonly cwd: string; readonly projectRoot: string; readonly claudeHome: string; readonly home: string; readonly includeUserRoots: boolean; readonly allowedImportRoots: readonly string[]; readonly maxBytes: number }`; `interface Baseline { readonly text: string; readonly digest: string }`; `composeBaseline(input: BaselineInput): Promise<{ baseline: Baseline | undefined; problems: string[] }>`.

What the baseline contains, in order: `<project>/.claude/CLAUDE.md`; `<claudeHome>/CLAUDE.md` when `includeUserRoots`; every file reached through `@path` imports from those two files and from the `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` files between the project root and the cwd (upstream `agent-instructions` already injects those four files themselves, so they are import seeds only); every `.claude/rules/**/*.md` file without `paths:`. Identical content is included once. A file that would exceed `maxBytes` is left out and named in a `<skipped reason="budget"/>` line. An import is also skipped, and named with its reason, when its real path (symbolic links resolved) leaves the project and the allowed roots, when it looks like a credential file (`.env*`, SSH keys, `.pem`/`.key` files, anything under `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.npmrc`, `.netrc`), or when it is larger than `maxBytes`.

- [ ] **Step 1: Create the package scaffold**

`air/packages/instruction-conventions/package.json`:

```json
{
  "name": "@air/dsh-instruction-conventions",
  "description": "Loads .claude/CLAUDE.md, @path imports, and .claude/rules as injected instructions",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@air/dsh-convention-core": "workspace:*",
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery",
    "picomatch": "^4.0.4"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-agent": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-llm": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-agent-loop-testkit": "link:../../../packages/test-support/agent-loop-testkit",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session",
    "@deepseek-ai/dsh-system-prompt": "link:../../../packages/core/system-prompt",
    "@deepseek-ai/dsh-tools": "link:../../../packages/core/tools",
    "@types/picomatch": "^4.0.2"
  }
}
```

`air/packages/instruction-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/instruction-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/instruction-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

`air/packages/instruction-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; `air/packages/instruction-conventions/node_modules/picomatch` exists.

- [ ] **Step 2: Write the failing tests**

`air/packages/instruction-conventions/tests/imports.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_IMPORT_HOPS, findImportPaths, isSensitivePath, resolveImports } from '../src/imports.ts'

const created: string[] = []
const MAX_FILE_BYTES = 1_000_000

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function world(): Promise<{ project: string; home: string; outside: string }> {
  const base = await mkdtemp(join(tmpdir(), 'air-imports-'))
  created.push(base)
  return { project: join(base, 'project'), home: join(base, 'home'), outside: join(base, 'outside') }
}

async function write(path: string, text: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

describe('findImportPaths', () => {
  it('finds @path tokens at the start of a line and after whitespace', () => {
    expect(findImportPaths('@README\nSee @docs/style.md, then @~/notes.md. Also @./a/b.md)')).toEqual([
      'README',
      'docs/style.md',
      '~/notes.md',
      './a/b.md',
    ])
  })

  it('accepts CRLF line endings', () => {
    expect(findImportPaths('@a.md\r\nText @b.md\r\n')).toEqual(['a.md', 'b.md'])
  })

  it('ignores code spans, fenced blocks, addresses, and a bare @', () => {
    const text = [
      'Mail me at someone@example.com or ping @ later.',
      'Inline `@not/imported.md` is code.',
      '```',
      '@inside/fence.md',
      '```',
      '~~~',
      '@inside/tilde.md',
      '~~~',
      '@real.md',
    ].join('\n')
    expect(findImportPaths(text)).toEqual(['real.md'])
  })
})

describe('isSensitivePath', () => {
  it.each([
    ['/home/u/project/.env', true],
    ['/home/u/project/.env.production', true],
    ['C:\\Users\\u\\.ssh\\config', true],
    ['/home/u/.aws/credentials', true],
    ['/home/u/project/id_ed25519', true],
    ['/home/u/project/server.pem', true],
    ['/home/u/project/.npmrc', true],
    ['/home/u/project/docs/environment.md', false],
    ['/home/u/project/notes.md', false],
  ])('classifies %s', (path, expected) => {
    expect(isSensitivePath(path)).toBe(expected)
  })
})

describe('resolveImports', () => {
  it('follows imports relative to the importing file, in document order', async () => {
    const { project, home } = await world()
    const seed = await write(join(project, 'CLAUDE.md'), 'Read @docs/a.md and @docs/b.md')
    await write(join(project, 'docs/a.md'), 'A imports @nested/c.md')
    await write(join(project, 'docs/nested/c.md'), 'C')
    await write(join(project, 'docs/b.md'), 'B')
    const result = await resolveImports([{ path: seed, content: 'Read @docs/a.md and @docs/b.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES })
    expect(result.files.map(file => file.content)).toEqual(['A imports @nested/c.md', 'C', 'B'])
    expect(result.skipped).toEqual([])
  })

  it('includes each file once, does not re-include a seed, and ignores missing files and directories', async () => {
    const { project, home } = await world()
    const seed = await write(join(project, 'CLAUDE.md'), '@a.md @a.md @AGENTS.md @missing.md @docs')
    const agents = await write(join(project, 'AGENTS.md'), 'Agents imports @a.md')
    await write(join(project, 'a.md'), 'A imports @CLAUDE.md')
    await mkdir(join(project, 'docs'), { recursive: true })
    const result = await resolveImports([
      { path: seed, content: '@a.md @a.md @AGENTS.md @missing.md @docs' },
      { path: agents, content: 'Agents imports @a.md' },
    ], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES })
    expect(result.files).toEqual([{ path: join(project, 'a.md'), content: 'A imports @CLAUDE.md' }])
    expect(result.skipped).toEqual([])
  })

  it('stops after the hop limit', async () => {
    const { project, home } = await world()
    expect(MAX_IMPORT_HOPS).toBe(4)
    for (let hop = 1; hop <= 5; hop += 1) await write(join(project, `h${hop}.md`), `hop ${hop} @h${hop + 1}.md`)
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@h1.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES })
    expect(result.files.map(file => file.path)).toEqual([1, 2, 3, 4].map(hop => join(project, `h${hop}.md`)))
    expect(result.skipped).toEqual([{ path: join(project, 'h5.md'), reason: 'max-hops' }])
  })

  it('skips imports outside the project unless an allowed root contains them', async () => {
    const { project, home, outside } = await world()
    await write(join(outside, 'shared.md'), 'Shared')
    await write(join(home, 'notes.md'), 'Notes')
    await mkdir(project, { recursive: true })
    const seed = { path: join(project, 'CLAUDE.md'), content: '@../outside/shared.md @~/notes.md' }
    const options = { projectRoot: project, home, maxFileBytes: MAX_FILE_BYTES }
    const denied = await resolveImports([seed], { ...options, allowedRoots: [] })
    expect(denied.files).toEqual([])
    expect(denied.skipped).toEqual([
      { path: join(outside, 'shared.md'), reason: 'outside-project' },
      { path: join(home, 'notes.md'), reason: 'outside-project' },
    ])
    const allowed = await resolveImports([seed], { ...options, allowedRoots: [outside, home] })
    expect(allowed.files.map(file => file.content)).toEqual(['Shared', 'Notes'])
    expect(allowed.skipped).toEqual([])
  })

  it('reports an outside path that does not exist without reading it', async () => {
    const { project, home } = await world()
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@../nowhere.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES })
    expect(result).toEqual({ files: [], skipped: [{ path: join(dirname(project), 'nowhere.md'), reason: 'outside-project' }] })
  })

  it.skipIf(process.platform === 'win32')('does not follow a link inside the project to a file outside it', async () => {
    const { project, home, outside } = await world()
    await write(join(outside, 'secret.md'), 'Secret')
    await mkdir(project, { recursive: true })
    await symlink(join(outside, 'secret.md'), join(project, 'link.md'))
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@link.md' }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: MAX_FILE_BYTES })
    expect(result).toEqual({ files: [], skipped: [{ path: join(project, 'link.md'), reason: 'outside-project' }] })
  })

  it('skips credential-like files and files over the size limit', async () => {
    const { project, home } = await world()
    await write(join(project, '.env'), 'TOKEN=abc')
    await write(join(project, '.ssh/config'), 'Host *')
    await write(join(project, 'big.md'), 'x'.repeat(50))
    await write(join(project, 'small.md'), 'ok')
    const content = '@.env @.ssh/config @big.md @small.md'
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content }], { projectRoot: project, allowedRoots: [], home, maxFileBytes: 10 })
    expect(result.files).toEqual([{ path: join(project, 'small.md'), content: 'ok' }])
    expect(result.skipped).toEqual([
      { path: join(project, '.env'), reason: 'sensitive' },
      { path: join(project, '.ssh', 'config'), reason: 'sensitive' },
      { path: join(project, 'big.md'), reason: 'too-large' },
    ])
  })
})
```

`air/packages/instruction-conventions/tests/rules.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadClaudeRules, matchingRules } from '../src/rules.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-rules-'))
  created.push(dir)
  return dir
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('loadClaudeRules', () => {
  it('loads always rules and path-scoped rules from nested directories', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/general.md'), 'Be concise.\n')
    await write(join(root, '.claude/rules/frontend/ts.md'), '---\npaths:\n  - "**/*.ts"\n  - "web/**"\n---\nUse strict TypeScript.\n')
    await write(join(root, '.claude/rules/py.md'), '---\npaths: "**/*.py"\n---\nUse type hints.\n')
    const { rules, problems } = await loadClaudeRules(root)
    expect(problems).toEqual([])
    expect(rules.map(rule => ({ relativePath: rule.relativePath, globs: rule.globs, content: rule.content }))).toEqual([
      { relativePath: '.claude/rules/frontend/ts.md', globs: ['**/*.ts', 'web/**'], content: 'Use strict TypeScript.' },
      { relativePath: '.claude/rules/general.md', globs: [], content: 'Be concise.' },
      { relativePath: '.claude/rules/py.md', globs: ['**/*.py'], content: 'Use type hints.' },
    ])
    expect(rules[0]?.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect(rules[0]?.path).toBe(join(root, '.claude/rules/frontend/ts.md'))
  })

  it('reports an unparsable rule file and skips an empty one', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    await write(join(root, '.claude/rules/empty.md'), '---\npaths: "**/*.md"\n---\n\n')
    const { rules, problems } = await loadClaudeRules(root)
    expect(rules).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(join(root, '.claude/rules/bad.md'))
  })

  it('returns nothing for a project without rules', async () => {
    expect(await loadClaudeRules(await project())).toEqual({ rules: [], problems: [] })
  })
})

describe('matchingRules', () => {
  it('returns path-scoped rules whose globs match the project-relative path', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/general.md'), 'Always.')
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nTypeScript.')
    await write(join(root, '.claude/rules/dot.md'), '---\npaths: ".github/**"\n---\nWorkflows.')
    const { rules } = await loadClaudeRules(root)
    expect(matchingRules(rules, 'src/deep/a.ts').map(rule => rule.content)).toEqual(['TypeScript.'])
    expect(matchingRules(rules, '.github/workflows/ci.yml').map(rule => rule.content)).toEqual(['Workflows.'])
    expect(matchingRules(rules, 'README.md')).toEqual([])
  })
})
```

`air/packages/instruction-conventions/tests/baseline.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeBaseline, type BaselineInput } from '../src/baseline.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function world(): Promise<BaselineInput> {
  const base = await mkdtemp(join(tmpdir(), 'air-baseline-'))
  created.push(base)
  const projectRoot = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(projectRoot, 'pkg'), { recursive: true })
  return {
    cwd: join(projectRoot, 'pkg'),
    projectRoot,
    claudeHome: join(home, '.claude'),
    home,
    includeUserRoots: false,
    allowedImportRoots: [],
    maxBytes: 32768,
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('composeBaseline', () => {
  it('returns nothing when the workspace has no convention files', async () => {
    expect(await composeBaseline(await world())).toEqual({ baseline: undefined, problems: [] })
  })

  it('assembles .claude/CLAUDE.md, imports from the instruction chain, and always rules', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory. @../docs/style.md')
    await write(join(root, 'docs/style.md'), 'Style guide.')
    await write(join(root, 'CLAUDE.md'), 'Root file, injected upstream. @docs/build.md')
    await write(join(root, 'docs/build.md'), 'Build steps.')
    await write(join(root, 'pkg/AGENTS.local.md'), 'Local file, injected upstream. @notes.md')
    await write(join(root, 'pkg/notes.md'), 'Package notes.')
    await write(join(root, '.claude/rules/general.md'), 'Be concise.')
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nScoped rule.')
    const { baseline, problems } = await composeBaseline(input)
    expect(problems).toEqual([])
    expect(baseline?.text).toBe([
      '<air_instructions>',
      'These project convention files apply to this workspace. Follow them together with the other workspace instructions.',
      `<file path="${join(root, '.claude/CLAUDE.md')}">`,
      'Project memory. @../docs/style.md',
      '</file>',
      `<file path="${join(root, 'docs/style.md')}">`,
      'Style guide.',
      '</file>',
      `<file path="${join(root, 'docs/build.md')}">`,
      'Build steps.',
      '</file>',
      `<file path="${join(root, 'pkg/notes.md')}">`,
      'Package notes.',
      '</file>',
      `<file path="${join(root, '.claude/rules/general.md')}">`,
      'Be concise.',
      '</file>',
      '</air_instructions>',
    ].join('\n'))
    expect(baseline?.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect((await composeBaseline(input)).baseline?.digest).toBe(baseline?.digest)
  })

  it('reads the user CLAUDE.md and its imports only on request', async () => {
    const input = await world()
    await write(join(input.claudeHome, 'CLAUDE.md'), 'User memory. @~/.claude/extra.md')
    await write(join(input.claudeHome, 'extra.md'), 'User extra.')
    expect((await composeBaseline(input)).baseline).toBeUndefined()
    const { baseline } = await composeBaseline({ ...input, includeUserRoots: true })
    expect(baseline?.text).toContain('User memory.')
    expect(baseline?.text).toContain('User extra.')
  })

  it('includes identical or empty content once and notes skipped imports', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Same text. @../../air-outside.md')
    await write(join(root, '.claude/rules/dup.md'), 'Same text. @../../air-outside.md')
    await write(join(root, '.claude/rules/blank.md'), '   \n')
    const { baseline } = await composeBaseline(input)
    expect(baseline?.text.match(/Same text\./gu)).toHaveLength(1)
    expect(baseline?.text).toContain(`<skipped path="${join(dirname(root), 'air-outside.md')}" reason="outside-project"/>`)
  })

  it('leaves out a file that exceeds the byte budget and names it', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Short.')
    await write(join(root, '.claude/rules/we&ird.md'), 'x'.repeat(400))
    const { baseline } = await composeBaseline({ ...input, maxBytes: 200 })
    expect(baseline?.text).toContain('Short.')
    expect(baseline?.text).not.toContain('xxxx')
    expect(baseline?.text).toContain(`<skipped path="${join(root, '.claude/rules/we&amp;ird.md')}" reason="budget"/>`)
  })

  it('does not import a credential file named in a convention file', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory. @../.env')
    await write(join(root, '.env'), 'API_TOKEN=do-not-send')
    const { baseline } = await composeBaseline(input)
    expect(baseline?.text).not.toContain('do-not-send')
    expect(baseline?.text).toContain(`<skipped path="${join(root, '.env')}" reason="sensitive"/>`)
  })

  it('returns rule problems', async () => {
    const input = await world()
    await write(join(input.projectRoot, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    const { baseline, problems } = await composeBaseline(input)
    expect(baseline).toBeUndefined()
    expect(problems).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C air/packages/instruction-conventions test`
Expected: FAIL, three files, each with `Failed to load url ../src/<module>.ts`.

- [ ] **Step 4: Implement the modules**

`air/packages/instruction-conventions/src/imports.ts`:

```ts
/** Resolves Claude Code `@path` imports found in instruction files. */
import { dirname, resolve } from 'node:path'
import { expandHome, fileSize, isInside, readTextFile, realpathIfPresent } from '@air/dsh-convention-core'

/** Claude Code follows imports at most this many files deep from the file that starts the chain. */
export const MAX_IMPORT_HOPS = 4

/** An instruction file with its content. */
export interface InstructionFile {
  readonly path: string
  readonly content: string
}

/** An import that was found but not read. */
export interface SkippedImport {
  readonly path: string
  readonly reason: 'outside-project' | 'max-hops' | 'sensitive' | 'too-large'
}

/** Containment and size settings for {@link resolveImports}. */
export interface ImportOptions {
  readonly projectRoot: string
  /** Absolute directories outside the project whose files may be imported. */
  readonly allowedRoots: readonly string[]
  /** Home directory used to expand `@~/...`. */
  readonly home: string
  /** Largest imported file in bytes; a larger file is skipped without being read. */
  readonly maxFileBytes: number
}

const FENCE = /^(?:```|~~~)/u
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u
/** Directories that hold credentials; any path through one is never imported. */
const SENSITIVE_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])
const SENSITIVE_FILES = /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.npmrc|\.netrc|credentials|.*\.(?:pem|key|p12|pfx))$/iu

/**
 * Test whether a path looks like a credential file: an `.env*` file, an SSH key, a certificate or key
 * file, `.npmrc`, `.netrc`, or any file under `.ssh`, `.aws`, `.gnupg`, `.kube`, or `.docker`.
 * @param path - absolute path with `/` or `\` separators.
 * @returns true when the file must not be sent to a model through an import.
 */
export function isSensitivePath(path: string): boolean {
  const segments = path.split(/[\\/]/u)
  const name = segments.at(-1) ?? ''
  return segments.slice(0, -1).some(segment => SENSITIVE_DIRECTORIES.has(segment.toLowerCase())) || SENSITIVE_FILES.test(name)
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * List the `@path` tokens in Markdown text. A token starts a line or follows whitespace.
 * Fenced code blocks and inline code spans are ignored.
 * @param text - instruction file content.
 * @returns paths as written, without the `@` and without trailing punctuation.
 */
export function findImportPaths(text: string): string[] {
  const paths: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line.trimStart())) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const token of line.replace(/`[^`]*`/gu, ' ').split(/\s+/u)) {
      if (!token.startsWith('@')) continue
      const path = token.slice(1).replace(TRAILING_PUNCTUATION, '')
      if (path.length > 0) paths.push(path)
    }
  }
  return paths
}

/**
 * Read every file reachable through `@path` imports from the seed files.
 * Relative paths resolve against the importing file's directory. A file is read once; seed files
 * are never returned. A path that is absent or not a regular file is ignored. A file is read only
 * when its path and its real path (symbolic links resolved) are inside the project root or an allowed
 * root, it is not a credential-like file, and it is no larger than `maxFileBytes`.
 * @param seeds - files whose content starts the import chains (hop 0).
 * @param options - project root, extra allowed roots, home directory, and size limit.
 * @returns imported files in depth-first document order, plus the imports that were not read.
 */
export async function resolveImports(
  seeds: readonly InstructionFile[],
  options: ImportOptions,
): Promise<{ files: InstructionFile[]; skipped: SkippedImport[] }> {
  const files: InstructionFile[] = []
  const skipped: SkippedImport[] = []
  const visited = new Set(seeds.map(seed => pathKey(resolve(seed.path))))
  const lexicalRoots = [options.projectRoot, ...options.allowedRoots]
  const realRoots = await Promise.all(lexicalRoots.map(async root => (await realpathIfPresent(root)) ?? root))
  const permitted = (roots: readonly string[], path: string): boolean => roots.some(root => isInside(root, path))
  const visit = async (file: InstructionFile, hop: number): Promise<void> => {
    for (const written of findImportPaths(file.content)) {
      const target = resolve(dirname(file.path), expandHome(written, options.home))
      if (visited.has(pathKey(target))) continue
      visited.add(pathKey(target))
      if (!permitted(lexicalRoots, target)) {
        skipped.push({ path: target, reason: 'outside-project' })
        continue
      }
      const real = await realpathIfPresent(target)
      if (real === undefined) continue
      visited.add(pathKey(real))
      if (!permitted(realRoots, real)) {
        skipped.push({ path: target, reason: 'outside-project' })
        continue
      }
      if (isSensitivePath(target) || isSensitivePath(real)) {
        skipped.push({ path: target, reason: 'sensitive' })
        continue
      }
      const size = await fileSize(real)
      if (size === undefined) continue
      if (size > options.maxFileBytes) {
        skipped.push({ path: target, reason: 'too-large' })
        continue
      }
      if (hop + 1 > MAX_IMPORT_HOPS) {
        skipped.push({ path: target, reason: 'max-hops' })
        continue
      }
      const content = await readTextFile(real)
      /* v8 ignore next -- the size was read a moment ago; only a concurrent delete reaches this. */
      if (content === undefined) continue
      const imported = { path: target, content }
      files.push(imported)
      await visit(imported, hop + 1)
    }
  }
  for (const seed of seeds) await visit(seed, 0)
  return { files, skipped }
}
```

`air/packages/instruction-conventions/src/rules.ts`:

```ts
/** Loads Markdown rule files under .claude/rules and matches path-scoped rules against touched files. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { listMarkdownTree, parseFrontmatter, readTextFile, stringListField } from '@air/dsh-convention-core'

/** Directory levels walked under `.claude/rules`. */
const RULE_TREE_DEPTH = 6

/** One rule file. A rule without globs applies always; a rule with globs applies after a matching file is touched. */
export interface Rule {
  readonly path: string
  /** Path relative to the project root with `/` separators, used as the rule's identity in message sources. */
  readonly relativePath: string
  readonly content: string
  /** `paths:` globs relative to the project root; empty for an always rule. */
  readonly globs: readonly string[]
  /** First 16 hex digits of the SHA-256 of `content`. */
  readonly digest: string
}

/**
 * Load every rule file of a project.
 * @param projectRoot - project root directory.
 * @returns rules with non-empty bodies, and one problem line per file that failed to parse.
 */
export async function loadClaudeRules(projectRoot: string): Promise<{ rules: Rule[]; problems: string[] }> {
  const rules: Rule[] = []
  const problems: string[] = []
  for (const entry of await listMarkdownTree(join(projectRoot, '.claude', 'rules'), RULE_TREE_DEPTH)) {
    const raw = await readTextFile(entry.path)
    /* v8 ignore next -- the file was listed a moment ago; only a concurrent delete reaches this. */
    if (raw === undefined) continue
    try {
      const { data, body } = parseFrontmatter(raw)
      const globs = stringListField(data, 'paths') ?? []
      const content = body.trim()
      if (content.length === 0) continue
      rules.push({
        path: entry.path,
        relativePath: `.claude/rules/${entry.segments.join('/')}.md`,
        content,
        globs,
        digest: createHash('sha256').update(content).digest('hex').slice(0, 16),
      })
    } catch (error: unknown) {
      problems.push(`${entry.path}: ${(error as Error).message}`)
    }
  }
  return { rules, problems }
}

/**
 * Select the path-scoped rules that apply to one file.
 * @param rules - rules from {@link loadClaudeRules}.
 * @param relativeFilePath - file path relative to the project root with `/` separators (`toPosixRelative`); globs follow POSIX rules on every platform and match case-sensitively.
 * @returns rules with at least one matching glob; always rules are never returned.
 */
export function matchingRules(rules: readonly Rule[], relativeFilePath: string): Rule[] {
  return rules.filter(rule => rule.globs.length > 0 && picomatch.isMatch(relativeFilePath, [...rule.globs], { dot: true, windows: false }))
}
```

`air/packages/instruction-conventions/src/baseline.ts`:

```ts
/** Assembles the model-facing text for the convention files that apply from the first request. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { directoriesBetween, readTextFile } from '@air/dsh-convention-core'
import { resolveImports, type InstructionFile, type SkippedImport } from './imports.ts'
import { loadClaudeRules } from './rules.ts'

/** Files upstream `agent-instructions` injects itself; here they only start import chains. */
const CHAIN_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']

const PREAMBLE = 'These project convention files apply to this workspace. Follow them together with the other workspace instructions.'

/** Inputs for {@link composeBaseline}. */
export interface BaselineInput {
  /** Session working directory. */
  readonly cwd: string
  readonly projectRoot: string
  /** Claude Code home (`~/.claude`). */
  readonly claudeHome: string
  /** Home directory used to expand `@~/...` imports. */
  readonly home: string
  /** Whether `<claudeHome>/CLAUDE.md` is read and `claudeHome` is an allowed import root. */
  readonly includeUserRoots: boolean
  /** Absolute directories outside the project whose files may be imported. */
  readonly allowedImportRoots: readonly string[]
  /** UTF-8 byte budget for included file blocks. */
  readonly maxBytes: number
}

/** The assembled text and its identity. */
export interface Baseline {
  readonly text: string
  /** First 16 hex digits of the SHA-256 of `text`; a changed digest means the text must be injected again. */
  readonly digest: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function attribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

async function readExisting(paths: readonly string[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  for (const path of paths) {
    const content = await readTextFile(path)
    if (content !== undefined) files.push({ path, content })
  }
  return files
}

function render(files: readonly InstructionFile[], skipped: readonly SkippedImport[], maxBytes: number): Baseline | undefined {
  const seen = new Set<string>()
  const blocks: string[] = []
  const notes = skipped.map(item => `<skipped path="${attribute(item.path)}" reason="${item.reason}"/>`)
  let bytes = 0
  for (const file of files) {
    const content = file.content.trim()
    const identity = sha256(content)
    if (content.length === 0 || seen.has(identity)) continue
    seen.add(identity)
    const block = `<file path="${attribute(file.path)}">\n${content}\n</file>`
    const size = Buffer.byteLength(block)
    if (bytes + size > maxBytes) {
      notes.push(`<skipped path="${attribute(file.path)}" reason="budget"/>`)
      continue
    }
    bytes += size
    blocks.push(block)
  }
  if (blocks.length === 0 && notes.length === 0) return undefined
  const text = ['<air_instructions>', PREAMBLE, ...blocks, ...notes, '</air_instructions>'].join('\n')
  return { text, digest: sha256(text).slice(0, 16) }
}

/**
 * Read the convention files that apply to a session from its first request and render them.
 * @param input - workspace location, user-root opt-in, import allowlist, and byte budget.
 * @returns the baseline, or undefined when no file applies; plus rule-file parse problems.
 */
export async function composeBaseline(input: BaselineInput): Promise<{ baseline: Baseline | undefined; problems: string[] }> {
  const included = await readExisting([
    join(input.projectRoot, '.claude', 'CLAUDE.md'),
    ...input.includeUserRoots ? [join(input.claudeHome, 'CLAUDE.md')] : [],
  ])
  const chain = await readExisting(
    directoriesBetween(input.projectRoot, input.cwd).flatMap(directory => CHAIN_FILES.map(file => join(directory, file))),
  )
  const imports = await resolveImports([...included, ...chain], {
    projectRoot: input.projectRoot,
    allowedRoots: [...input.allowedImportRoots, ...input.includeUserRoots ? [input.claudeHome] : []],
    home: input.home,
    maxFileBytes: input.maxBytes,
  })
  const ruleSet = await loadClaudeRules(input.projectRoot)
  const always = ruleSet.rules
    .filter(rule => rule.globs.length === 0)
    .map(rule => ({ path: rule.path, content: rule.content }))
  return {
    baseline: render([...included, ...imports.files, ...always], imports.skipped, input.maxBytes),
    problems: ruleSet.problems,
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C air/packages/instruction-conventions test`
Expected: `Test Files 3 passed (3)`.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm -C air/packages/instruction-conventions typecheck`
Expected: exit 0. (`src/index.ts` does not exist yet; `tsc -p tsconfig.json` checks the three modules and the tests.)

```sh
git add air/packages/instruction-conventions air/pnpm-lock.yaml
git commit -m "feat(air): resolve @path imports and .claude/rules into an instruction baseline"
```

---

### Task 5: `@air/dsh-instruction-conventions` — plugin, Loader test, README

**Files:**
- Create: `air/packages/instruction-conventions/src/index.ts`
- Create: `air/packages/instruction-conventions/tests/harness.ts`
- Create: `air/packages/instruction-conventions/README.md`
- Test: `air/packages/instruction-conventions/tests/plugin.spec.ts`
- Test: `air/packages/instruction-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from Task 4: `composeBaseline(input: BaselineInput)`, `loadClaudeRules(projectRoot)`, `matchingRules(rules, relativeFilePath)`, `Rule`.
- Consumes from upstream: `ctx.on('agent/pre-step', (payload: { agent; messages: UserMessage[]; turn; step; signal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>)`; `ctx.on('tools/post-execute', (exec: ToolExecution, result, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>)`; `createUserMessage({ content, source })`; `agent.session.header.cwd`; `agent.session.deriveMessages(): Message[]`.
- Produces:
  - Cordis plugin module `@air/dsh-instruction-conventions`: `name = 'air-instruction-conventions'`, `Config`, `apply(ctx, config)`. No `inject`.
  - `interface Config { maxBytes: number; claudeHome?: string; includeUserRoots?: boolean; allowedImportRoots?: string[]; projectRootMarkers?: string[] }` (defaults: `~/.claude`, `false`, `[]`, `['.git']`; `maxBytes` is required).
  - `resolveConfig(config: Config): ResolvedConfig`.
  - Message source kind `air-instructions`: `interface AirInstructionSource { readonly kind: 'air-instructions'; readonly form: 'instructions'; readonly baseline?: true; readonly rule?: string; readonly digest: string }`. A baseline message has `baseline: true`; a path-scoped rule message has `rule` set to the rule's project-relative path.
  - Bundle row used in Task 9: `{ id: air-instruction-conventions, name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } }`.

- [ ] **Step 1: Write the test harness**

`air/packages/instruction-conventions/tests/harness.ts`:

```ts
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
```

This mirrors `stubAgent` in `packages/goal/command-goal/tests/command-goal.spec.ts` (compared member by member at `dsh-v0.2.1-alpha.1`); if the `Agent` interface has gained a member since, copy the addition from that file.

- [ ] **Step 2: Write the failing plugin tests**

`air/packages/instruction-conventions/tests/plugin.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as instructionConventions from '../src/index.ts'
import { loadClaudeRules } from '../src/rules.ts'
import { stubAgent } from './harness.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'air-instructions-'))
  created.push(base)
  await mkdir(join(base, '.git'))
  return base
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

// Test doubles follow the `defineTool` form verified in spike 01; each is written out so the
// parameter names stay literal types.
function registerTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Test double for read.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'File to read' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.resolve('done')
    },
  }))
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Test double for write that always fails.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'File to write' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.reject<string>(new Error('disk full'))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Test double for bash.',
    parameters: {
      command: { type: 'string', required: true, description: 'Command line' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.resolve('done')
    },
  }))
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(instructionConventions, { maxBytes: 32768, claudeHome: '/air-test-no-such-home/.claude' })
  registerTools(ctx)
  return ctx
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function preStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
  options: { step?: number; decision?: PreStepDecision; signal?: AbortSignal } = {},
): Promise<PreStepDecision> {
  return ctx.waterfall(
    'agent/pre-step',
    { agent, messages, turn: 1, step: options.step ?? 1, signal: options.signal ?? new AbortController().signal },
    () => Promise.resolve<PreStepDecision>(options.decision ?? { kind: 'enter', messages }),
  )
}

function entered(decision: PreStepDecision): UserMessage[] {
  if (decision.kind !== 'enter') throw new Error('expected the step to enter')
  return decision.messages
}

let calls = 0
function run(ctx: Context, name: string, args: Record<string, string>, agent?: Agent) {
  calls += 1
  return ctx.tools.execute({
    name,
    arguments: args,
    callId: ToolCallId(`air-call-${calls}`),
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
}

describe('baseline injection on agent/pre-step', () => {
  it('adds one air-instructions message after the claimed prompt', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const first = prompt('hello')
    const messages = entered(await preStep(ctx, agent, [first]))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBe(first)
    expect(messages[1]?.source).toMatchObject({ kind: 'air-instructions', form: 'instructions', baseline: true })
    expect(messages[1]?.content).toEqual([{ type: 'text', text: expect.stringContaining('Project memory.') }])
  })

  it('does not repeat a baseline that the session already holds, and repeats it after the files change', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const [, baseline] = entered(await preStep(ctx, agent, [prompt('one')]))
    if (baseline === undefined) throw new Error('expected a baseline message')
    agent.session.append('user/message', baseline, { surfaceOp: 'append' })
    expect(entered(await preStep(ctx, agent, [prompt('two')]))).toHaveLength(1)
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory, revised.')
    const refreshed = entered(await preStep(ctx, agent, [prompt('three')]))
    expect(refreshed).toHaveLength(2)
    expect(refreshed[1]?.source).not.toEqual(baseline.source)
  })

  it('leaves the decision unchanged when there is nothing to add', async () => {
    const root = await project()
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const only = prompt('hello')
    expect(entered(await preStep(ctx, agent, [only]))).toEqual([only])
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    expect(await preStep(ctx, agent, [only], { decision: { kind: 'reject' } })).toEqual({ kind: 'reject' })
    expect(entered(await preStep(ctx, agent, [], { step: 1 }))).toEqual([])
    const { agent: detached } = stubAgent(ctx, undefined)
    expect(entered(await preStep(ctx, detached, [only]))).toEqual([only])
  })

  it('reads the convention files at step 1 only, once per turn', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const later = prompt('later step')
    expect(entered(await preStep(ctx, agent, [later], { step: 2 }))).toEqual([later])
    expect(entered(await preStep(ctx, agent, [later], { step: 1 }))).toHaveLength(2)
  })

  it('lets the turn continue when a convention file cannot be read', async () => {
    const ctx = await mount()
    const { agent } = stubAgent(ctx, 'bad\0cwd')
    const only = prompt('hello')
    expect(entered(await preStep(ctx, agent, [only]))).toEqual([only])
  })

  it('stops when the turn was cancelled while files were read', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const controller = new AbortController()
    controller.abort(new Error('turn cancelled'))
    await expect(preStep(ctx, agent, [prompt('hello')], { signal: controller.signal })).rejects.toThrow('turn cancelled')
  })

  it('keeps working when a rule file does not parse', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    await write(join(root, '.claude/rules/good.md'), 'Be concise.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    expect(entered(await preStep(ctx, agent, [prompt('one')]))).toHaveLength(2)
    expect(entered(await preStep(ctx, agent, [prompt('two')]))).toHaveLength(2)
  })
})

describe('path-scoped rules on tools/post-execute', () => {
  async function scoped(): Promise<{ ctx: Context; root: string }> {
    const root = await project()
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nUse strict TypeScript.')
    return { ctx: await mount(), root }
  }

  it('attaches a matching rule once per session', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const first = await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)
    expect(first.isError).toBe(false)
    expect(first.additionalContexts).toHaveLength(1)
    const context = first.additionalContexts?.[0]
    expect(context?.source).toMatchObject({ kind: 'air-instructions', form: 'instructions', rule: '.claude/rules/ts.md' })
    expect(context?.content).toEqual([{
      type: 'text',
      text: '<air_rule path=".claude/rules/ts.md">\nUse strict TypeScript.\n</air_rule>',
    }])
    const second = await run(ctx, 'read', { file_path: join(root, 'src/b.ts') }, agent)
    expect(second.additionalContexts).toBeUndefined()
  })

  it('does not attach a rule the resumed session already holds', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const [rule] = (await loadClaudeRules(root)).rules
    if (rule === undefined) throw new Error('expected one rule')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'earlier rule text' }],
      source: { kind: 'air-instructions', form: 'instructions', rule: rule.relativePath, digest: rule.digest },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', prompt('unrelated'), { surfaceOp: 'append' })
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)).additionalContexts).toBeUndefined()
  })

  it('attaches nothing for other tools, other files, failures, and calls without a workspace', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const { agent: detached } = stubAgent(ctx, undefined)
    expect((await run(ctx, 'bash', { command: 'ls src/a.ts' }, agent)).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'README.md' }, agent)).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: resolve(root, '..', 'air-outside', 'a.ts') }, agent)).additionalContexts).toBeUndefined()
    const failed = await run(ctx, 'write', { file_path: 'src/a.ts' }, agent)
    expect(failed.isError).toBe(true)
    expect(failed.additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' })).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' }, detached)).additionalContexts).toBeUndefined()
  })
})

describe('resolveConfig', () => {
  it('applies defaults and expands allowed import roots', () => {
    const claudeHome = resolve(sep, 'c')
    const shared = resolve(sep, 'shared')
    const resolved = instructionConventions.resolveConfig({ maxBytes: 100, claudeHome, allowedImportRoots: [shared] })
    expect(resolved).toMatchObject({
      maxBytes: 100,
      claudeHome,
      includeUserRoots: false,
      allowedImportRoots: [shared],
      projectRootMarkers: ['.git'],
    })
    expect(instructionConventions.resolveConfig({ maxBytes: 1, allowedImportRoots: ['~/notes'] }).allowedImportRoots).toEqual([join(homedir(), 'notes')])
  })

  it('rejects invalid values', () => {
    expect(() => instructionConventions.resolveConfig({ maxBytes: 0 })).toThrow('maxBytes must be a positive integer')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, allowedImportRoots: ['relative/dir'] })).toThrow('must be an absolute path or start with ~/')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
```

- [ ] **Step 3: Run the plugin tests to verify they fail**

Run: `pnpm -C air/packages/instruction-conventions exec vitest run tests/plugin.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 4: Implement the plugin**

`air/packages/instruction-conventions/src/index.ts`:

```ts
/**
 * Companion to upstream `agent-instructions`. It injects the convention files upstream does not read:
 * `.claude/CLAUDE.md`, the user's `~/.claude/CLAUDE.md` (opt-in), files reached through `@path`
 * imports, and `.claude/rules`. Rules without `paths:` enter with the baseline, which is composed once per
 * turn at step 1; rules with `paths:` are attached to the result of the first `read`, `write`, or `edit`
 * call on a matching file.
 * Every injected text is a user message with source kind `air-instructions`, so it is in the session log.
 *
 * @module @air/dsh-instruction-conventions
 */
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { expandHome, findProjectRoot, isInside, resolveUserHomes, toPosixRelative } from '@air/dsh-convention-core'
import { composeBaseline } from './baseline.ts'
import { loadClaudeRules, matchingRules, type Rule } from './rules.ts'

export const name = 'air-instruction-conventions'

/** Durable source of every message this plugin injects. */
export interface AirInstructionSource {
  readonly kind: 'air-instructions'
  /** The text is instructions read out of files. */
  readonly form: 'instructions'
  /** Present on the message that carries the baseline files. */
  readonly baseline?: true
  /** Project-relative path of the rule file, on a path-scoped rule message. */
  readonly rule?: string
  /** Identity of the injected text; a different digest means different text. */
  readonly digest: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Convention files injected by `@air/dsh-instruction-conventions`. */
    'air-instructions': AirInstructionSource
  }
}

/** Plugin configuration. */
export interface Config {
  /** UTF-8 byte budget for the baseline file blocks. Required. */
  maxBytes: number
  /** Claude Code home. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Whether `<claudeHome>/CLAUDE.md` is read and may import files under `claudeHome`. Defaults to false. */
  includeUserRoots?: boolean
  /** Directories outside the project whose files `@path` imports may read; absolute or starting with `~/`. */
  allowedImportRoots?: string[]
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
}

export const Config: Schema<Config> = Schema.object({
  maxBytes: Schema.number().required().description('UTF-8 byte budget for the baseline file blocks.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  includeUserRoots: Schema.boolean().default(false).description('Read ~/.claude/CLAUDE.md and allow imports under ~/.claude.'),
  allowedImportRoots: Schema.array(Schema.string()).default([]).description('Directories outside the project that @path imports may read.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly maxBytes: number
  readonly claudeHome: string
  readonly home: string
  readonly includeUserRoots: boolean
  readonly allowedImportRoots: readonly string[]
  readonly projectRootMarkers: readonly string[]
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!Number.isInteger(config.maxBytes) || config.maxBytes < 1) {
    throw new TypeError('air-instruction-conventions: maxBytes must be a positive integer')
  }
  const home = homedir()
  const allowedImportRoots = (config.allowedImportRoots ?? []).map((root) => {
    const expanded = expandHome(root, home)
    if (!isAbsolute(expanded)) {
      throw new TypeError(`air-instruction-conventions: allowedImportRoots entry "${root}" must be an absolute path or start with ~/`)
    }
    return resolve(expanded)
  })
  const projectRootMarkers = config.projectRootMarkers ?? ['.git']
  if (projectRootMarkers.length === 0) {
    throw new TypeError('air-instruction-conventions: projectRootMarkers must not be empty')
  }
  return {
    maxBytes: config.maxBytes,
    claudeHome: resolveUserHomes(config).claudeHome,
    home,
    includeUserRoots: config.includeUserRoots ?? false,
    allowedImportRoots,
    projectRootMarkers,
  }
}

const FILE_TOOLS = new Set(['read', 'write', 'edit'])

function touchedPath(exec: ToolExecution): string | undefined {
  const args = exec.arguments
  if (FILE_TOOLS.has(exec.name) && typeof args === 'object' && args !== null && 'file_path' in args && typeof args.file_path === 'string') {
    return args.file_path
  }
  return undefined
}

function latestBaselineDigest(history: readonly Message[]): string | undefined {
  for (const message of history.toReversed()) {
    if (message.source.kind === 'air-instructions' && message.source.baseline === true) return message.source.digest
  }
  return undefined
}

function ruleKey(relativePath: string, digest: string): string {
  return `${relativePath}:${digest}`
}

/**
 * Register the baseline and path-scoped rule injection.
 * @param ctx - plugin context; in a preset its listeners receive only that preset's Agents.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const reported = new Set<string>()
  const delivered = new WeakMap<Agent['session'], Set<string>>()

  const report = (problems: readonly string[]): void => {
    for (const problem of problems) {
      if (reported.has(problem)) continue
      reported.add(problem)
      ctx.logger.warn(`air-instruction-conventions: ${problem}`)
    }
  }

  const deliveredRules = (session: Agent['session']): Set<string> => {
    let keys = delivered.get(session)
    if (keys === undefined) {
      keys = new Set()
      for (const message of session.deriveMessages()) {
        if (message.source.kind === 'air-instructions' && message.source.rule !== undefined) {
          keys.add(ruleKey(message.source.rule, message.source.digest))
        }
      }
      delivered.set(session, keys)
    }
    return keys
  }

  const ruleMessage = (rule: Rule) => {
    const source: AirInstructionSource = { kind: 'air-instructions', form: 'instructions', rule: rule.relativePath, digest: rule.digest }
    return createUserMessage({
      content: [{ type: 'text', text: `<air_rule path="${rule.relativePath}">\n${rule.content}\n</air_rule>` }],
      source,
    })
  }

  /** Compose the baseline; a read failure is reported and the turn continues without it. */
  const compose = async (cwd: string): Promise<Awaited<ReturnType<typeof composeBaseline>> | undefined> => {
    try {
      const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
      return await composeBaseline({
        cwd,
        projectRoot,
        claudeHome: resolved.claudeHome,
        home: resolved.home,
        includeUserRoots: resolved.includeUserRoots,
        allowedImportRoots: resolved.allowedImportRoots,
        maxBytes: resolved.maxBytes,
      })
    } catch (error: unknown) {
      report([`convention files could not be read: ${(error as Error).message}`])
      return undefined
    }
  }

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    // Compose once per turn: later steps of the turn keep the files they started with, and the provider's
    // prompt cache survives an edit made mid-turn. An empty first step owns a no-step turn; adding context
    // would turn it into a request.
    if (step !== 1 || decision.kind === 'reject' || decision.messages.length === 0) return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const composed = await compose(cwd)
    signal.throwIfAborted()
    if (composed === undefined) return decision
    const { baseline, problems } = composed
    report(problems)
    if (baseline === undefined) return decision
    if (latestBaselineDigest([...agent.session.deriveMessages(), ...decision.messages]) === baseline.digest) return decision
    const source: AirInstructionSource = { kind: 'air-instructions', form: 'instructions', baseline: true, digest: baseline.digest }
    const message = createUserMessage({ content: [{ type: 'text', text: baseline.text }], source })
    // Place the context right after the messages the step claimed, before context other listeners appended.
    const lastClaimed = decision.messages.findLastIndex(entry => messages.includes(entry))
    return { ...decision, messages: decision.messages.toSpliced(lastClaimed + 1, 0, message) }
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const agent = exec.agent
    const filePath = touchedPath(exec)
    if (result.isError || agent === undefined || filePath === undefined || decision.kind !== 'accept') return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const absolute = resolve(cwd, filePath)
    if (!isInside(projectRoot, absolute)) return decision
    const ruleSet = await loadClaudeRules(projectRoot)
    report(ruleSet.problems)
    const keys = deliveredRules(agent.session)
    const fresh = matchingRules(ruleSet.rules, toPosixRelative(projectRoot, absolute))
      .filter(rule => !keys.has(ruleKey(rule.relativePath, rule.digest)))
    if (fresh.length === 0) return decision
    for (const rule of fresh) keys.add(ruleKey(rule.relativePath, rule.digest))
    return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], ...fresh.map(ruleMessage)] }
  })
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm -C air/packages/instruction-conventions exec vitest run tests/imports.spec.ts tests/rules.spec.ts tests/baseline.spec.ts tests/plugin.spec.ts`
Expected: `Test Files 4 passed (4)`.

Two places depend on upstream runtime details; if a test fails there, check these first:
- `ctx.tools.execute` reaching `tools/post-execute` for the test-double tools: `packages/core/tools/tests/tools.spec.ts` shows the accepted `execute` input and `defineTool` fields.
- `session.append('user/message', message, { surfaceOp: 'append' })`: `packages/api/session-controller/tests/controller.host.spec.ts` L103 uses the same call.

- [ ] **Step 6: Write the native Loader test**

`air/packages/instruction-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-instruction-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude'), { recursive: true })
  await writeFile(join(project, '.claude', 'CLAUDE.md'), 'Loader project memory. @notes.md')
  await writeFile(join(project, '.claude', 'notes.md'), 'Imported notes.')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    '- id: air-instruction-conventions',
    "  name: '@air/dsh-instruction-conventions'",
    '  config:',
    '    maxBytes: 4096',
    `    claudeHome: ${JSON.stringify(join(root, 'home', '.claude'))}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent } = stubAgent(context, project)
  const first = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  const decision = await context.waterfall(
    'agent/pre-step',
    { agent, messages: [first], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [first] }),
  )
  if (decision.kind !== 'enter') throw new Error('expected the step to enter')
  expect(decision.messages).toHaveLength(2)
  expect(decision.messages[1]?.source).toMatchObject({ kind: 'air-instructions', baseline: true })
  const [block] = decision.messages[1]?.content ?? []
  expect(block).toMatchObject({ type: 'text', text: expect.stringContaining('Imported notes.') })
})
```

- [ ] **Step 7: Build, then run the whole suite with coverage**

Run: `pnpm -C air/packages/instruction-conventions build`, then `pnpm -C air/packages/instruction-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 5 passed (5)`; `baseline.ts`, `imports.ts`, `index.ts`, `rules.ts` at 100 in every column.

Run: `pnpm -C air/packages/instruction-conventions typecheck`, then `pnpm -C air run lint`
Expected: exit 0 for both.

- [ ] **Step 8: Write the README**

`air/packages/instruction-conventions/README.md`:

```markdown
# @air/dsh-instruction-conventions

## Summary

A companion to upstream `agent-instructions`, mounted in the same agent preset. Upstream keeps loading `AGENTS.md` and `CLAUDE.md` chains; this plugin adds what upstream does not interpret:

| Input | When it is injected |
|---|---|
| `<project>/.claude/CLAUDE.md` | baseline |
| `<claudeHome>/CLAUDE.md` | baseline, only with `includeUserRoots: true` |
| `@path` imports found in the two files above and in `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` between the project root and the cwd | baseline |
| `.claude/rules/**/*.md` without `paths:` | baseline |
| `.claude/rules/**/*.md` with `paths:` | after the first successful `read`, `write`, or `edit` on a matching file |

Imports follow Claude Code semantics: at most 4 hops, each file once, code spans and fenced blocks ignored, relative paths resolved against the importing file. An import is read only when both its path and its real path (symbolic links resolved) are inside the project root or an `allowedImportRoots` entry (or under `claudeHome` with `includeUserRoots`), it is not a credential-like file (`.env*`, SSH keys, `.pem`/`.key`, anything under `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.npmrc`, `.netrc`), and it is no larger than `maxBytes`; otherwise the baseline names it in a `<skipped reason="outside-project|sensitive|too-large|max-hops"/>` line.

The baseline is one user message with source `{ kind: 'air-instructions', form: 'instructions', baseline: true, digest }`, added on `agent/pre-step` after the messages the step claimed, at step 1 of each turn only. It is added again only when the digest of the assembled text differs from the latest baseline in the session, which also covers resume and compaction. A convention file that cannot be read is logged and the turn continues without the baseline. A path-scoped rule is a user message with source `{ kind: 'air-instructions', form: 'instructions', rule, digest }`, returned as `additionalContexts` from `tools/post-execute`, once per session and rule content.

Config: `maxBytes` (required; the AIR bundle sets 32768), `claudeHome`, `includeUserRoots` (default `false`), `allowedImportRoots` (default `[]`), `projectRootMarkers` (default `['.git']`).

## Model Experience

Before its first request the model receives an `<air_instructions>` block listing each file as `<file path="...">` with its text, followed by `<skipped .../>` lines for imports that were not read. After touching a file that matches a rule's `paths:` globs, the model receives `<air_rule path=".claude/rules/...">` with the rule text along with that tool result.

## Known Limitations

- `.cursor/rules/*.mdc` and `.kiro/steering/*.md` are not read yet.
- Outside-project imports use an allowlist, not an approval prompt.
- The files upstream injects (`AGENTS.md`, `CLAUDE.md` and their local variants) keep their `@path` text; the imported content arrives in the separate `<air_instructions>` block.
- Identical text is removed only inside this plugin's block. A file that upstream also injects under another path can appear twice.
- A file larger than the remaining `maxBytes` budget is left out whole and named in a `<skipped reason="budget"/>` line.
- Convention files are re-read once per turn; a changed file causes a new baseline message, which invalidates the provider's prompt cache from that point. An edit made during a turn is seen on the next turn.
- The credential-file list is a name heuristic, not a scanner; keep secrets out of folders you import from.
- Files are read from the host filesystem, not through `ctx.fs`. Path-scoped rules match case-sensitively with POSIX glob rules on every platform, including Windows.
```

- [ ] **Step 9: Commit**

```sh
git add air/packages/instruction-conventions
git commit -m "feat(air): inject .claude/CLAUDE.md, imports, and rules as air-instructions messages"
```

---

### Task 6: `@air/dsh-mcp-conventions` — `.mcp.json` parser and approvals file

**Files:**
- Create: `air/packages/mcp-conventions/package.json`
- Create: `air/packages/mcp-conventions/tsconfig.build.json`
- Create: `air/packages/mcp-conventions/tsconfig.json`
- Create: `air/packages/mcp-conventions/tsdown.config.ts`
- Create: `air/packages/mcp-conventions/vitest.config.ts`
- Create: `air/packages/mcp-conventions/src/config.ts`
- Create: `air/packages/mcp-conventions/src/approvals.ts`
- Test: `air/packages/mcp-conventions/tests/config.spec.ts`
- Test: `air/packages/mcp-conventions/tests/approvals.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `isRecord`, `readTextFile`. From upstream: `Branded<B>` (`@deepseek-ai/dsh-brand`).
- Produces (package-internal modules used by Task 7):
  - `config.ts`:
    - `type ServerSpec = { readonly transport: 'stdio'; readonly serverName: string; readonly command: string; readonly args: string[]; readonly env: Record<string, string>; readonly cwd: string; readonly definition: string } | { readonly transport: 'streamable-http'; readonly serverName: string; readonly url: string; readonly headers: Record<string, string>; readonly definition: string }` (`definition` is the entry as written, `${VAR}` unexpanded, in canonical JSON)
    - `interface ParseOptions { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }`
    - `canonicalJson(value: unknown): string` (object keys sorted at every depth)
    - `expandEnv(value: string, env: Readonly<Record<string, string | undefined>>): string` (`${VAR}` and `${VAR:-default}`; throws when a variable without a default is unset)
    - `parseMcpJson(text: string, options: ParseOptions): { servers: ServerSpec[]; problems: string[] }`
  - `approvals.ts`:
    - `type McpApprovalKey = Branded<'McpApprovalKey'>`
    - `approvalKey(projectRoot: string, spec: ServerSpec): McpApprovalKey` (SHA-256 over the project root, the server name, and `spec.definition`; lower-cased project root on Windows)
    - `interface ApprovalRecord { readonly projectRoot: string; readonly server: string; readonly approvedAt: string }`
    - `class ApprovalStore { constructor(file: string); has(key: McpApprovalKey): Promise<boolean>; add(key: McpApprovalKey, record: ApprovalRecord): Promise<void>; remove(key: McpApprovalKey): Promise<void> }` (writes from one process run one at a time; each write goes through a uniquely named temporary file and a rename)
    - File format: `{ "version": 1, "approved": { "<key>": ApprovalRecord } }`, mode `0600` on POSIX.

- [ ] **Step 1: Create the package scaffold**

`air/packages/mcp-conventions/package.json`:

```json
{
  "name": "@air/dsh-mcp-conventions",
  "description": "Imports project .mcp.json servers as approved per-Agent MCP clients",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@air/dsh-convention-core": "workspace:*",
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-agent": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-brand": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-commands": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-home-paths": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-mcp-client": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-scope": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-agent-loop-testkit": "link:../../../packages/test-support/agent-loop-testkit",
    "@deepseek-ai/dsh-brand": "link:../../../packages/util/brand",
    "@deepseek-ai/dsh-commands": "link:../../../packages/interaction/commands",
    "@deepseek-ai/dsh-home-paths": "link:../../../packages/util/home-paths",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-mcp-client": "link:../../../packages/mcp/mcp-client",
    "@deepseek-ai/dsh-scope": "link:../../../packages/core/scope",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session",
    "@deepseek-ai/dsh-system-prompt": "link:../../../packages/core/system-prompt",
    "@deepseek-ai/dsh-tools": "link:../../../packages/core/tools"
  }
}
```

`air/packages/mcp-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/mcp-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/mcp-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

`air/packages/mcp-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; `air/packages/mcp-conventions/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js` exists.

- [ ] **Step 2: Write the failing tests**

`air/packages/mcp-conventions/tests/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canonicalJson, expandEnv, parseMcpJson } from '../src/config.ts'

const options = { cwd: '/work/project', env: { TOKEN: 'secret', HOST: 'example.test' } }

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1]},"b":1}')
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })
})

describe('expandEnv', () => {
  it('substitutes set variables and defaults', () => {
    expect(expandEnv('Bearer ${TOKEN}', options.env)).toBe('Bearer secret')
    expect(expandEnv('${MISSING:-fallback}/${HOST:-unused}', options.env)).toBe('fallback/example.test')
    expect(expandEnv('${MISSING:-}', options.env)).toBe('')
    expect(expandEnv('no variables', options.env)).toBe('no variables')
  })

  it('throws for an unset variable without a default', () => {
    expect(() => expandEnv('${MISSING}', options.env)).toThrow('environment variable MISSING is not set')
  })
})

describe('parseMcpJson', () => {
  it('parses stdio and http servers and records each definition as written', () => {
    const entries = {
      files: { command: 'npx', args: ['-y', 'server-files', '${HOST}'], env: { API_TOKEN: '${TOKEN}' } },
      bare: { type: 'stdio', command: 'my-server' },
      remote: { type: 'http', url: 'https://${HOST}/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
      inferred: { url: 'https://example.test/other' },
      named: { type: 'streamable-http', url: 'https://example.test/third' },
    }
    expect(parseMcpJson(JSON.stringify({ mcpServers: entries }), options)).toEqual({
      servers: [
        { transport: 'stdio', serverName: 'files', command: 'npx', args: ['-y', 'server-files', 'example.test'], env: { API_TOKEN: 'secret' }, cwd: '/work/project', definition: canonicalJson(entries.files) },
        { transport: 'stdio', serverName: 'bare', command: 'my-server', args: [], env: {}, cwd: '/work/project', definition: canonicalJson(entries.bare) },
        { transport: 'streamable-http', serverName: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' }, definition: canonicalJson(entries.remote) },
        { transport: 'streamable-http', serverName: 'inferred', url: 'https://example.test/other', headers: {}, definition: canonicalJson(entries.inferred) },
        { transport: 'streamable-http', serverName: 'named', url: 'https://example.test/third', headers: {}, definition: canonicalJson(entries.named) },
      ],
      problems: [],
    })
  })

  it('keeps ${VAR} text in the definition so a rotated value does not change it', () => {
    const text = JSON.stringify({ mcpServers: { files: { command: 'npx', env: { API_TOKEN: '${TOKEN}' } } } })
    const first = parseMcpJson(text, options).servers[0]
    const second = parseMcpJson(text, { ...options, env: { TOKEN: 'rotated' } }).servers[0]
    expect(first?.definition).toBe(second?.definition)
    expect(first?.definition).toContain('${TOKEN}')
  })

  it('reports each invalid server and keeps the valid ones', () => {
    const text = JSON.stringify({
      mcpServers: {
        ok: { command: 'server' },
        'bad name!': { command: 'server' },
        legacy: { type: 'sse', url: 'https://example.test/sse' },
        scalar: 'npx server',
        nocommand: { type: 'stdio' },
        nourl: { type: 'http' },
        badargs: { command: 'server', args: 'one two' },
        badenv: { command: 'server', env: { PORT: 8080 } },
        badheaders: { url: 'https://example.test', headers: ['a'] },
        unset: { command: '${NOT_SET}' },
      },
    })
    const { servers, problems } = parseMcpJson(text, options)
    expect(servers.map(server => server.serverName)).toEqual(['ok'])
    expect(problems).toEqual([
      'bad name!: server name must match [A-Za-z0-9_-]{1,32}',
      'legacy: transport type "sse" is not supported; use stdio or http',
      'scalar: server entry must be an object',
      'nocommand: a stdio server requires a "command" string',
      'nourl: an http server requires a "url" string',
      'badargs: "args" must be a list of strings',
      'badenv: "env.PORT" must be a string',
      'badheaders: "headers" must be an object of strings',
      'unset: environment variable NOT_SET is not set',
    ])
  })

  it('reports an unreadable document', () => {
    expect(parseMcpJson('{ not json', options).problems[0]).toMatch(/^\.mcp\.json is not valid JSON: /u)
    expect(parseMcpJson('[]', options)).toEqual({ servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] })
    expect(parseMcpJson('{"mcpServers": []}', options)).toEqual({ servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] })
  })

  it('accepts a byte-order mark and CRLF line endings', () => {
    const text = '﻿{\r\n  "mcpServers": { "ok": { "command": "server" } }\r\n}\r\n'
    expect(parseMcpJson(text, options).servers.map(server => server.serverName)).toEqual(['ok'])
  })
})
```

`air/packages/mcp-conventions/tests/approvals.spec.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { canonicalJson, type ServerSpec } from '../src/config.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function approvalsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-approvals-'))
  created.push(dir)
  return join(dir, 'nested', 'mcp-approvals.json')
}

const root = resolve(sep, 'p')
const stdioEntry = { command: 'npx', args: ['server'], env: { B: '${B}', A: '1' } }
const httpEntry = { type: 'http', url: 'https://example.test/mcp', headers: { Z: '1', A: '${A}' } }
const stdio: ServerSpec = { transport: 'stdio', serverName: 'files', command: 'npx', args: ['server'], env: { B: '2', A: '1' }, cwd: root, definition: canonicalJson(stdioEntry) }
const http: ServerSpec = { transport: 'streamable-http', serverName: 'remote', url: 'https://example.test/mcp', headers: { Z: '1', A: '2' }, definition: canonicalJson(httpEntry) }

describe('approvalKey', () => {
  it('is a stable SHA-256 of the project, server name, and definition as written', () => {
    const key = approvalKey(root, stdio)
    expect(key).toMatch(/^[0-9a-f]{64}$/u)
    expect(approvalKey(root, { ...stdio, cwd: join(root, 'sub') })).toBe(key)
    expect(approvalKey(root, { ...stdio, env: { A: '1', B: 'rotated' } })).toBe(key)
    expect(approvalKey(root, { ...http, headers: { A: 'rotated', Z: '1' } })).toBe(approvalKey(root, http))
  })

  it('changes with the project, the server name, and any edit of the definition', () => {
    const key = approvalKey(root, stdio)
    expect(approvalKey(resolve(sep, 'q'), stdio)).not.toBe(key)
    expect(approvalKey(root, { ...stdio, serverName: 'other' })).not.toBe(key)
    expect(approvalKey(root, { ...stdio, definition: canonicalJson({ ...stdioEntry, command: 'node' }) })).not.toBe(key)
    expect(approvalKey(root, { ...stdio, definition: canonicalJson({ ...stdioEntry, args: ['server', '--unsafe'] }) })).not.toBe(key)
    expect(approvalKey(root, { ...http, definition: canonicalJson({ ...httpEntry, url: 'https://evil.test/mcp' }) })).not.toBe(approvalKey(root, http))
  })

  it('treats a Windows project root without regard to letter case', () => {
    const lower = approvalKey(root, stdio)
    expect(approvalKey(root.toUpperCase(), stdio) === lower).toBe(process.platform === 'win32')
  })
})

describe('ApprovalStore', () => {
  it('records and removes approvals', async () => {
    const file = await approvalsFile()
    const store = new ApprovalStore(file)
    const key = approvalKey(root, stdio)
    const other = approvalKey(root, http)
    expect(await store.has(key)).toBe(false)
    await store.add(key, { projectRoot: root, server: 'files', approvedAt: '2026-10-01T00:00:00.000Z' })
    await store.add(other, { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' })
    expect(await store.has(key)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      approved: {
        [key]: { projectRoot: root, server: 'files', approvedAt: '2026-10-01T00:00:00.000Z' },
        [other]: { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' },
      },
    })
    await store.remove(key)
    expect(await store.has(key)).toBe(false)
    expect(await new ApprovalStore(file).has(other)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('writes a private file', async () => {
    const file = await approvalsFile()
    await new ApprovalStore(file).add(approvalKey(root, stdio), { projectRoot: root, server: 'files', approvedAt: '2026-10-01T00:00:00.000Z' })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps every approval when several are added at once', async () => {
    const store = new ApprovalStore(await approvalsFile())
    const specs = ['a', 'b', 'c', 'd'].map(serverName => ({ ...stdio, serverName }))
    await Promise.all(specs.map(spec => store.add(approvalKey(root, spec), { projectRoot: root, server: spec.serverName, approvedAt: '2026-10-01T00:00:00.000Z' })))
    for (const spec of specs) expect(await store.has(approvalKey(root, spec))).toBe(true)
  })

  it('keeps accepting writes after one failed', async () => {
    const file = await approvalsFile()
    const store = new ApprovalStore(file)
    await store.add(approvalKey(root, stdio), { projectRoot: root, server: 'files', approvedAt: '2026-10-01T00:00:00.000Z' })
    await writeFile(file, '{ truncated')
    await expect(store.add(approvalKey(root, http), { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' })).rejects.toThrow()
    await writeFile(file, '{"version": 1, "approved": {}}')
    await store.add(approvalKey(root, http), { projectRoot: root, server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' })
    expect(await store.has(approvalKey(root, http))).toBe(true)
  })

  it('fails loud on a file that is not an approvals file', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'air-approvals-')), 'mcp-approvals.json')
    created.push(join(file, '..'))
    const store = new ApprovalStore(file)
    await writeFile(file, '{ truncated')
    await expect(store.has(approvalKey(root, stdio))).rejects.toThrow()
    await writeFile(file, '{"version": 1, "approved": []}')
    await expect(store.has(approvalKey(root, stdio))).rejects.toThrow('is not an approvals file')
    await writeFile(file, '[]')
    await expect(store.has(approvalKey(root, stdio))).rejects.toThrow('is not an approvals file')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C air/packages/mcp-conventions test`
Expected: FAIL with `Failed to load url ../src/config.ts` and `Failed to load url ../src/approvals.ts`.

- [ ] **Step 4: Implement the modules**

`air/packages/mcp-conventions/src/config.ts`:

```ts
/** Parses Claude Code project `.mcp.json` files into MCP client specifications. */
import { isRecord } from '@air/dsh-convention-core'

/** One server to connect, with every `${VAR}` already expanded. */
export type ServerSpec =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: string[]
    readonly env: Record<string, string>
    /** Working directory of the server process: the session cwd. */
    readonly cwd: string
    /** The entry as written in the file (`${VAR}` unexpanded) in canonical JSON; the approval identity. */
    readonly definition: string
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Record<string, string>
    /** The entry as written in the file (`${VAR}` unexpanded) in canonical JSON; the approval identity. */
    readonly definition: string
  }

/** Values that are not part of the file. */
export interface ParseOptions {
  /** Session working directory, used as the cwd of stdio servers. */
  readonly cwd: string
  /** Environment read by `${VAR}` expansion. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Same grammar upstream `mcp-client` accepts for `serverName`. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu

/**
 * Serialize parsed JSON with object keys sorted at every depth, so two files that differ only in key
 * order produce the same text.
 * @param value - a value produced by `JSON.parse`.
 * @returns the canonical JSON text.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Expand `${VAR}` and `${VAR:-default}`.
 * @param value - text from the file.
 * @param env - environment mapping.
 * @returns the expanded text.
 * @throws when a variable without a default is unset.
 */
export function expandEnv(value: string, env: Readonly<Record<string, string | undefined>>): string {
  return value.replace(VARIABLE, (_match: string, variable: string, fallback: string | undefined) => {
    const resolved = env[variable] ?? fallback
    if (resolved === undefined) throw new Error(`environment variable ${variable} is not set`)
    return resolved
  })
}

function stringList(value: unknown, field: string, options: ParseOptions): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`"${field}" must be a list of strings`)
  }
  return value.map(item => expandEnv(item, options.env))
}

function stringMap(value: unknown, field: string, options: ParseOptions): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`"${field}" must be an object of strings`)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`"${field}.${key}" must be a string`)
    result[key] = expandEnv(item, options.env)
  }
  return result
}

function parseServer(serverName: string, raw: unknown, options: ParseOptions): ServerSpec {
  if (!SERVER_NAME.test(serverName)) throw new Error('server name must match [A-Za-z0-9_-]{1,32}')
  if (!isRecord(raw)) throw new Error('server entry must be an object')
  const definition = canonicalJson(raw)
  const url = raw['url']
  const command = raw['command']
  const type = raw['type'] ?? (typeof url === 'string' ? 'http' : 'stdio')
  if (type === 'stdio') {
    if (typeof command !== 'string') throw new Error('a stdio server requires a "command" string')
    return {
      transport: 'stdio',
      serverName,
      command: expandEnv(command, options.env),
      args: stringList(raw['args'], 'args', options),
      env: stringMap(raw['env'], 'env', options),
      cwd: options.cwd,
      definition,
    }
  }
  if (type === 'http' || type === 'streamable-http') {
    if (typeof url !== 'string') throw new Error('an http server requires a "url" string')
    return {
      transport: 'streamable-http',
      serverName,
      url: expandEnv(url, options.env),
      headers: stringMap(raw['headers'], 'headers', options),
      definition,
    }
  }
  throw new Error(`transport type ${JSON.stringify(type)} is not supported; use stdio or http`)
}

/**
 * Parse a `.mcp.json` document.
 * @param text - file content; a leading byte-order mark (written by some Windows editors) is ignored.
 * @param options - session cwd and environment.
 * @returns valid servers in file order, and one problem line per rejected entry or document error.
 */
export function parseMcpJson(text: string, options: ParseOptions): { servers: ServerSpec[]; problems: string[] } {
  let document: unknown
  try {
    document = JSON.parse(text.replace(/^﻿/u, ''))
  } catch (error: unknown) {
    return { servers: [], problems: [`.mcp.json is not valid JSON: ${(error as Error).message}`] }
  }
  const table = isRecord(document) ? document['mcpServers'] : undefined
  if (!isRecord(table)) return { servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] }
  const servers: ServerSpec[] = []
  const problems: string[] = []
  for (const [serverName, raw] of Object.entries(table)) {
    try {
      servers.push(parseServer(serverName, raw, options))
    } catch (error: unknown) {
      problems.push(`${serverName}: ${(error as Error).message}`)
    }
  }
  return { servers, problems }
}
```

`air/packages/mcp-conventions/src/approvals.ts`:

```ts
/** The consent record for project MCP servers: which exact server definitions a person approved. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isRecord, readTextFile } from '@air/dsh-convention-core'
import type { ServerSpec } from './config.ts'

/** Identity of one approved server definition in one project. */
export type McpApprovalKey = Branded<'McpApprovalKey'>

function normalizedRoot(projectRoot: string): string {
  const absolute = resolve(projectRoot)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Compute the approval identity of a server. The key covers the project root, the server name, and
 * the entry exactly as written in `.mcp.json` (variables unexpanded), so editing the command,
 * arguments, URL, or any variable name requires a new approval, while rotating the value of a
 * `${VAR}` does not. On Windows the project root compares without regard to letter case.
 * @param projectRoot - absolute project root that holds the `.mcp.json`.
 * @param spec - parsed server.
 * @returns a 64-digit hex SHA-256.
 */
export function approvalKey(projectRoot: string, spec: ServerSpec): McpApprovalKey {
  const canonical = [normalizedRoot(projectRoot), spec.serverName, spec.definition]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex') as McpApprovalKey
}

/** What is stored beside a key so a person can read the file. */
export interface ApprovalRecord {
  readonly projectRoot: string
  readonly server: string
  /** ISO 8601 timestamp. */
  readonly approvedAt: string
}

/**
 * Reads and rewrites the approvals file. Reads see edits by another process. Writes from this process
 * run one at a time, so concurrent approvals do not overwrite each other; two processes writing at the
 * same instant can still lose one approval, which then has to be given again.
 */
export class ApprovalStore {
  private queue: Promise<unknown> = Promise.resolve()

  /** @param file - absolute path of the approvals file; it is created on the first approval. */
  constructor(private readonly file: string) {}

  /**
   * Test whether a key is approved.
   * @param key - approval identity.
   * @returns true when the file lists the key.
   * @throws when the file exists but is not an approvals file.
   */
  async has(key: McpApprovalKey): Promise<boolean> {
    return Object.hasOwn(await this.read(), key)
  }

  /**
   * Record an approval.
   * @param key - approval identity.
   * @param record - readable description stored with the key.
   */
  async add(key: McpApprovalKey, record: ApprovalRecord): Promise<void> {
    await this.serialized(async () => { await this.write({ ...await this.read(), [key]: record }) })
  }

  /**
   * Remove an approval.
   * @param key - approval identity.
   */
  async remove(key: McpApprovalKey): Promise<void> {
    await this.serialized(async () => {
      const approved = await this.read()
      await this.write(Object.fromEntries(Object.entries(approved).filter(([existing]) => existing !== key)))
    })
  }

  private serialized(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task)
    // A failed write is reported to its own caller; the queue only orders the writes after it.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async read(): Promise<Record<string, unknown>> {
    const text = await readTextFile(this.file)
    if (text === undefined) return {}
    const document: unknown = JSON.parse(text)
    const approved = isRecord(document) ? document['approved'] : undefined
    if (!isRecord(approved)) throw new Error(`air-mcp-conventions: ${this.file} is not an approvals file`)
    return approved
  }

  private async write(approved: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    // Mode 0600 applies on POSIX; on Windows the file inherits the private ACL of the user profile.
    await writeFile(temporary, `${JSON.stringify({ version: 1, approved }, undefined, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C air/packages/mcp-conventions test`
Expected: `Test Files 2 passed (2)`.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm -C air/packages/mcp-conventions typecheck`
Expected: exit 0.

```sh
git add air/packages/mcp-conventions air/pnpm-lock.yaml
git commit -m "feat(air): parse .mcp.json and record per-project MCP server approvals"
```

---

### Task 7: `@air/dsh-mcp-conventions` — per-Agent mounts, `/mcp` command, Loader test, README

**Files:**
- Create: `air/packages/mcp-conventions/src/index.ts`
- Create: `air/packages/mcp-conventions/tests/harness.ts`
- Create: `air/packages/mcp-conventions/tests/fixtures/echo-server.mjs`
- Create: `air/packages/mcp-conventions/README.md`
- Test: `air/packages/mcp-conventions/tests/plugin.spec.ts`
- Test: `air/packages/mcp-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from Task 6: `parseMcpJson`, `ServerSpec`, `ApprovalStore`, `approvalKey`.
- Consumes from upstream: `ctx.on('agent/created', ({ agent }) => Promise<undefined>)` (serial; awaited before the Agent's queued input runs); `ctx.on('agent/disposed', ({ agent }) => void)`; `createScope(ctx, agent): Scope` with `scope.ctx.plugin(...)` and `scope.dispose(): Promise<void>`; `import * as McpClient from '@deepseek-ai/dsh-mcp-client'` with `McpClient.Config(input)`; `ctx.commands.register(definition): () => void`; `dshHomePath(...segments): string`.
- Produces:
  - Cordis plugin module `@air/dsh-mcp-conventions`: `name = 'air-mcp-conventions'`, `inject = ['agents', 'tools', 'commands']`, `Config`, `apply(ctx, config)`.
  - `interface Config { approvalsFile?: string; startupTimeoutMs?: number; toolCallTimeoutMs?: number; projectRootMarkers?: string[]; reviewTools?: boolean }` with defaults `dshHomePath('air', 'mcp-approvals.json')`, `15000`, `60000`, `['.git']`, `false`. With `reviewTools: true` each mounted `mcp-client` child is the upstream plugin with `inject` extended by `mcpToolReview`, so it stays pending until plan 02's reviewer exists; plan 01 does not depend on plan 02.
  - `resolveConfig(config: Config): ResolvedConfig`.
  - Global command `/mcp`: no input lists servers; `approve <server>` records approval and starts the server for the calling Agent; `revoke <server>` removes approval and stops it. Run it before the first message and the tools exist for the first request; an unreadable approvals file or `.mcp.json` approves nothing and never fails Agent creation.
  - Model-facing tools `mcp__<server>__<tool>` registered in the Agent's scope by upstream `mcp-client`.
  - Bundle row used in Task 9: `{ id: air-mcp-conventions, name: '@air/dsh-mcp-conventions' }`.

- [ ] **Step 1: Write the harness and the fixture server**

`air/packages/mcp-conventions/tests/harness.ts`:

```ts
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
```

`air/packages/mcp-conventions/tests/fixtures/echo-server.mjs`:

```js
/** Line-delimited JSON-RPC MCP server over stdio with one tool, `echo`. */
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// Tests set ECHO_PID_FILE to learn which processes this server started and to check that they exit.
if (process.env.ECHO_PID_FILE) writeFileSync(`${process.env.ECHO_PID_FILE}.${process.pid}`, '')

const reply = (id, body) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`)

process.stdin.once('end', () => process.exit(0))

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  // Notifications carry no id and need no reply.
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize':
      reply(request.id, {
        result: {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'air-echo', version: '1' },
        },
      })
      break
    case 'tools/list':
      reply(request.id, {
        result: {
          tools: [{
            name: 'echo',
            description: 'Return the text argument.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          }],
        },
      })
      break
    case 'tools/call':
      reply(request.id, { result: { content: [{ type: 'text', text: `echo: ${request.params.arguments.text}` }] } })
      break
    default:
      reply(request.id, { error: { code: -32601, message: 'Method not found' } })
  }
})
```

The reply to unknown methods matters: the upstream client first probes `server/discover` and falls back to `initialize` on error `-32601`, as `packages/mcp/mcp-client/tests/fixtures/negotiation-lifecycle.mjs` shows.

- [ ] **Step 2: Write the failing plugin tests**

`air/packages/mcp-conventions/tests/plugin.spec.ts`:

```ts
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpConventions from '../src/index.ts'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { stubAgent } from './harness.ts'

const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
const created: string[] = []
const contexts: Context[] = []

// A plain string selects the untyped `provide` overload: the reviewer service is declared by the MCP trust plan, not by this one.
const REVIEW_SERVICE: string = 'mcpToolReview'

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  approvalsFile: string
}

async function world(mcpJson?: unknown): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-mcp-'))
  created.push(base)
  const root = join(base, 'project')
  await mkdir(join(root, '.git'), { recursive: true })
  if (mcpJson !== undefined) {
    await writeFile(join(root, '.mcp.json'), typeof mcpJson === 'string' ? mcpJson : JSON.stringify(mcpJson))
  }
  return { root, approvalsFile: join(base, 'state', 'mcp-approvals.json') }
}

const demo = { mcpServers: { demo: { command: process.execPath, args: [echoServer] } } }

async function mount(approvalsFile: string, startupTimeoutMs = 15_000, extra: mcpConventions.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(mcpConventions, { approvalsFile, startupTimeoutMs, ...extra })
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined): Promise<Agent> {
  const { agent } = stubAgent(ctx, cwd)
  await ctx.agents.register(agent)
  return agent
}

async function command(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
  return execution.result
}

function toolNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name)
}

async function approveInFile(approvalsFile: string, root: string, mcpJson: unknown): Promise<void> {
  const { servers } = parseMcpJson(JSON.stringify(mcpJson), { cwd: root, env: process.env })
  for (const spec of servers) {
    await new ApprovalStore(approvalsFile).add(approvalKey(root, spec), {
      projectRoot: root,
      server: spec.serverName,
      approvedAt: '2026-10-01T00:00:00.000Z',
    })
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // Signal 0 throws ESRCH once the process has exited, on Windows as on POSIX.
    return false
  }
}

describe('air-mcp-conventions', () => {
  it('does not start a project server that nobody approved', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.kind).toBe('success')
    expect(listed.text).toContain(`demo (stdio: ${process.execPath} ${echoServer}): not approved`)
    expect(listed.text).toContain('/mcp approve <server>')
  })

  it('approves, starts, and revokes a server for the calling Agent', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: 'Approved and started "demo".' })
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
    const result = await ctx.tools.execute({
      name: 'mcp__demo__echo',
      arguments: { text: 'hi' },
      callId: ToolCallId('air-mcp-call'),
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('echo: hi')
    expect((await command(ctx, agent, '/mcp')).text).toContain('): running')
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: '"demo" is already running.' })

    const second = await live(ctx, root)
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])

    expect(await command(ctx, agent, '/mcp revoke demo')).toEqual({
      kind: 'success',
      text: 'Revoked "demo"; its tools are removed from this session.',
    })
    expect(toolNames(ctx, agent)).toEqual([])
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
    expect((await command(ctx, agent, '/mcp revoke demo')).kind).toBe('success')
  })

  it('stops server processes when the Agent is disposed and when the plugin unloads', async () => {
    const { root, approvalsFile } = await world()
    const base = dirname(root)
    const withPid = { mcpServers: { demo: { command: process.execPath, args: [echoServer], env: { ECHO_PID_FILE: join(base, 'echo.pid') } } } }
    await writeFile(join(root, '.mcp.json'), JSON.stringify(withPid))
    const pids = async (): Promise<number[]> => (await readdir(base))
      .filter(name => name.startsWith('echo.pid.'))
      .map(name => Number(name.slice('echo.pid.'.length)))
    await approveInFile(approvalsFile, root, withPid)
    const { ctx, fiber } = await mount(approvalsFile)
    const first = await live(ctx, root)
    const second = await live(ctx, root)
    const detached = await live(ctx, undefined)
    expect(toolNames(ctx, first)).toEqual(['mcp__demo__echo'])
    expect(await pids()).toHaveLength(2)
    ctx.emit('agent/disposed', { agent: first })
    ctx.emit('agent/disposed', { agent: detached })
    await vi.waitFor(() => { expect(toolNames(ctx, first)).toEqual([]) }, { timeout: 5000 })
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
    await fiber.dispose()
    expect(toolNames(ctx, second)).toEqual([])
    await vi.waitFor(async () => { expect((await pids()).some(isAlive)).toBe(false) }, { timeout: 5000 })
  })

  it('reports a server that fails to start, times out, or is unreachable', async () => {
    const servers = {
      mcpServers: {
        exits: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
        silent: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
        remote: { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      },
    }
    const { root, approvalsFile } = await world(servers)
    const { ctx } = await mount(approvalsFile, 500)
    const agent = await live(ctx, root)
    const exits = await command(ctx, agent, '/mcp approve exits')
    expect(exits.kind).toBe('error')
    expect(exits.text).toContain('Approved "exits", but it did not start: ')
    const silent = await command(ctx, agent, '/mcp approve silent')
    expect(silent).toEqual({ kind: 'error', text: 'Approved "silent", but it did not start: did not start within 500 ms' })
    expect((await command(ctx, agent, '/mcp approve remote')).kind).toBe('error')
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.text).toContain('): approved, not running')
    expect(listed.text).toContain('remote (streamable-http: http://127.0.0.1:1/mcp)')

    const next = await live(ctx, root)
    expect(toolNames(ctx, next)).toEqual([])
  })

  it('keeps the Agent usable when the approvals file is corrupt and says so in /mcp', async () => {
    const { root, approvalsFile } = await world(demo)
    await mkdir(dirname(approvalsFile), { recursive: true })
    await writeFile(approvalsFile, '{ truncated')
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.text).toContain('): not approved')
    expect(listed.text).toMatch(/Problem: the approvals file could not be read: /u)
    expect((await command(ctx, agent, '/mcp')).text.match(/Problem: the approvals file/gu)).toHaveLength(1)
  })

  it('does not fail Agent creation when the project file cannot be read', async () => {
    const { approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, 'bad\0cwd')
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('lists problems and projects without servers', async () => {
    const broken = await world('{ not json')
    const first = await mount(broken.approvalsFile)
    const agent = await live(first.ctx, broken.root)
    expect((await command(first.ctx, agent, '/mcp')).text).toMatch(/Problem: \.mcp\.json is not valid JSON/u)

    const empty = await world()
    const second = await mount(empty.approvalsFile)
    const other = await live(second.ctx, empty.root)
    expect((await command(second.ctx, other, '/mcp')).text).toContain(`No servers are declared in ${join(empty.root, '.mcp.json')}.`)
  })

  it('rejects unknown input and sessions without a working directory', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const usage = 'Usage: /mcp [approve <server> | revoke <server>]'
    expect(await command(ctx, agent, '/mcp start demo')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve demo extra')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve other')).toEqual({
      kind: 'error',
      text: `No server named "other" is declared in ${join(root, '.mcp.json')}. ${usage}`,
    })
    const detached = await live(ctx, undefined)
    expect(await command(ctx, detached, '/mcp')).toEqual({
      kind: 'error',
      text: 'This session has no working directory, so no .mcp.json was read.',
    })
  })
})

describe('reviewTools', () => {
  it('keeps a server pending until the MCP tool reviewer exists', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 500, { reviewTools: true })
    const agent = await live(ctx, root)
    const pending = await command(ctx, agent, '/mcp approve demo')
    expect(pending.kind).toBe('error')
    expect(pending.text).toContain('did not start within 500 ms')
    expect(pending.text).toContain('MCP tool reviewer')
    expect(toolNames(ctx, agent)).toEqual([])
  })

  it('starts the server once the MCP tool reviewer exists', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 15_000, { reviewTools: true })
    ctx.provide(REVIEW_SERVICE, {})
    const agent = await live(ctx, root)
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: 'Approved and started "demo".' })
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
  })

  it('does not wait for a reviewer by default', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile, 500)
    const agent = await live(ctx, root)
    expect((await command(ctx, agent, '/mcp approve demo')).kind).toBe('success')
  })
})

describe('resolveConfig', () => {
  it('applies defaults under the harness home', () => {
    const resolved = mcpConventions.resolveConfig({})
    expect(resolved.approvalsFile.endsWith(join('air', 'mcp-approvals.json'))).toBe(true)
    expect(resolved).toMatchObject({ startupTimeoutMs: 15000, toolCallTimeoutMs: 60000, projectRootMarkers: ['.git'], reviewTools: false })
  })

  it('rejects invalid values', () => {
    expect(() => mcpConventions.resolveConfig({ startupTimeoutMs: 0 })).toThrow('startupTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ toolCallTimeoutMs: 1.5 })).toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
```

- [ ] **Step 3: Run the plugin tests to verify they fail**

Run: `pnpm -C air/packages/mcp-conventions exec vitest run tests/plugin.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 4: Implement the plugin**

`air/packages/mcp-conventions/src/index.ts`:

```ts
/**
 * Imports Claude Code project `.mcp.json` files. For every Agent it reads `<project>/.mcp.json`,
 * and for each server a person approved it mounts one upstream `mcp-client` in that Agent's scope,
 * so the server's tools exist before the Agent's first request and disappear with the Agent.
 * Approvals are stored in an AIR-owned file, keyed by project and exact server definition.
 *
 * @module @air/dsh-mcp-conventions
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'
import { findProjectRoot, readTextFile } from '@air/dsh-convention-core'
import { ApprovalStore, approvalKey } from './approvals.ts'
import { parseMcpJson, type ServerSpec } from './config.ts'

export const name = 'air-mcp-conventions'
export const inject = ['agents', 'tools', 'commands']

const USAGE = 'Usage: /mcp [approve <server> | revoke <server>]'

/** Service the MCP trust plan provides; an `mcp-client` child that must be reviewed waits for it. */
const REVIEW_SERVICE = 'mcpToolReview'

/** Plugin configuration. */
export interface Config {
  /** Approvals file. Defaults to `<DSH_HOME>/air/mcp-approvals.json`. */
  approvalsFile?: string
  /** Milliseconds a server may take to connect and list its tools before it is abandoned. Defaults to 15000. */
  startupTimeoutMs?: number
  /** Milliseconds allowed per tool call or resource request. Defaults to 60000. */
  toolCallTimeoutMs?: number
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
  /** Whether each mounted `mcp-client` child declares `inject: ['mcpToolReview']` and waits for the MCP trust plan's reviewer. Defaults to false. */
  reviewTools?: boolean
}

export const Config: Schema<Config> = Schema.object({
  approvalsFile: Schema.string().description('Approvals file; defaults to <DSH_HOME>/air/mcp-approvals.json.'),
  startupTimeoutMs: Schema.number().default(15000).description('Milliseconds a server may take to start.'),
  toolCallTimeoutMs: Schema.number().default(60000).description('Milliseconds allowed per tool call.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
  reviewTools: Schema.boolean().default(false).description('Hold each server until the MCP tool reviewer service exists, so its tools are reviewed before they register.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly approvalsFile: string
  readonly startupTimeoutMs: number
  readonly toolCallTimeoutMs: number
  readonly projectRootMarkers: readonly string[]
  readonly reviewTools: boolean
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    approvalsFile: config.approvalsFile ?? dshHomePath('air', 'mcp-approvals.json'),
    startupTimeoutMs: config.startupTimeoutMs ?? 15000,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60000,
    projectRootMarkers: config.projectRootMarkers ?? ['.git'],
    reviewTools: config.reviewTools ?? false,
  }
  if (!Number.isInteger(resolved.startupTimeoutMs) || resolved.startupTimeoutMs < 1) {
    throw new TypeError('air-mcp-conventions: startupTimeoutMs must be a positive integer')
  }
  if (!Number.isInteger(resolved.toolCallTimeoutMs) || resolved.toolCallTimeoutMs < 1) {
    throw new TypeError('air-mcp-conventions: toolCallTimeoutMs must be a positive integer')
  }
  if (resolved.projectRootMarkers.length === 0) {
    throw new TypeError('air-mcp-conventions: projectRootMarkers must not be empty')
  }
  return resolved
}

interface AgentState {
  readonly projectRoot: string
  readonly servers: readonly ServerSpec[]
  /** File problems and approvals-file problems, shown by `/mcp`. */
  readonly problems: string[]
  /** Running servers by name; each scope owns one `mcp-client` child. */
  readonly mounted: Map<string, Scope>
}

/**
 * Mount project MCP servers per Agent and register `/mcp`.
 * @param ctx - host-level plugin context with `agents`, `tools`, and `commands` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const approvals = new ApprovalStore(resolved.approvalsFile)
  const states = new Map<Agent, AgentState>()
  // Declaring the reviewer service in `inject` keeps the child pending until the service exists. The
  // object repeats the merge the Loader performs for a row-level `inject`.
  const client = resolved.reviewTools
    ? { name: 'mcp-client-reviewed', inject: [...McpClient.inject, REVIEW_SERVICE], apply: McpClient.apply }
    : McpClient

  /** An unreadable approvals file approves nothing and is shown by `/mcp`; it never fails Agent creation. */
  const isApproved = async (state: AgentState, spec: ServerSpec): Promise<boolean> => {
    try {
      return await approvals.has(approvalKey(state.projectRoot, spec))
    } catch (error: unknown) {
      const problem = `the approvals file could not be read: ${(error as Error).message}`
      if (!state.problems.includes(problem)) state.problems.push(problem)
      return false
    }
  }

  /** Start one server in the Agent's scope. Returns the failure text, or undefined on success. */
  const mount = async (agent: Agent, state: AgentState, spec: ServerSpec): Promise<string | undefined> => {
    const scope = createScope(ctx, agent)
    const common = { toolCallTimeoutMs: resolved.toolCallTimeoutMs, failOnStartupError: true }
    const clientConfig = spec.transport === 'stdio'
      ? McpClient.Config({ transport: 'stdio', serverName: spec.serverName, command: spec.command, args: spec.args, env: spec.env, cwd: spec.cwd, ...common })
      : McpClient.Config({ transport: 'streamable-http', serverName: spec.serverName, url: spec.url, headers: spec.headers, ...common })
    const start = async (): Promise<void> => { await scope.ctx.plugin(client, clientConfig) }
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        start(),
        new Promise<never>((_resolve, reject) => {
          const reason = resolved.reviewTools ? '; MCP tool review is required and its reviewer is not loaded' : ''
          timer = setTimeout(() => { reject(new Error(`did not start within ${resolved.startupTimeoutMs} ms${reason}`)) }, resolved.startupTimeoutMs)
        }),
      ])
      state.mounted.set(spec.serverName, scope)
      return undefined
    } catch (error: unknown) {
      await scope.dispose()
      return (error as Error).message
    } finally {
      clearTimeout(timer)
    }
  }

  const release = async (agent: Agent): Promise<void> => {
    const state = states.get(agent)
    if (state === undefined) return
    states.delete(agent)
    await Promise.all([...state.mounted.values()].map(scope => scope.dispose()))
  }

  const describeServers = async (state: AgentState): Promise<string> => {
    const lines: string[] = []
    for (const spec of state.servers) {
      const target = spec.transport === 'stdio' ? [spec.command, ...spec.args].join(' ') : spec.url
      let status = 'not approved'
      if (state.mounted.has(spec.serverName)) status = 'running'
      else if (await isApproved(state, spec)) status = 'approved, not running'
      lines.push(`${spec.serverName} (${spec.transport}: ${target}): ${status}`)
    }
    if (lines.length === 0) lines.push(`No servers are declared in ${join(state.projectRoot, '.mcp.json')}.`)
    for (const problem of state.problems) lines.push(`Problem: ${problem}`)
    lines.push('Use /mcp approve <server> to start a server from this project, or /mcp revoke <server> to stop trusting it. Approve before your first message so the tools exist for the first request.')
    return lines.join('\n')
  }

  const runCommand = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const state = states.get(invocation.agent)
    if (state === undefined) {
      return { kind: 'error', text: 'This session has no working directory, so no .mcp.json was read.' }
    }
    const parts = invocation.rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
    const action = parts[0]
    if (action === undefined) return { kind: 'success', text: await describeServers(state) }
    if ((action !== 'approve' && action !== 'revoke') || parts.length !== 2) return { kind: 'error', text: USAGE }
    const spec = state.servers.find(server => server.serverName === parts[1])
    if (spec === undefined) {
      return { kind: 'error', text: `No server named "${String(parts[1])}" is declared in ${join(state.projectRoot, '.mcp.json')}. ${USAGE}` }
    }
    const key = approvalKey(state.projectRoot, spec)
    if (action === 'revoke') {
      await approvals.remove(key)
      const scope = state.mounted.get(spec.serverName)
      state.mounted.delete(spec.serverName)
      await scope?.dispose()
      return { kind: 'success', text: `Revoked "${spec.serverName}"; its tools are removed from this session.` }
    }
    await approvals.add(key, { projectRoot: state.projectRoot, server: spec.serverName, approvedAt: new Date().toISOString() })
    if (state.mounted.has(spec.serverName)) return { kind: 'success', text: `"${spec.serverName}" is already running.` }
    const failure = await mount(invocation.agent, state, spec)
    return failure === undefined
      ? { kind: 'success', text: `Approved and started "${spec.serverName}".` }
      : { kind: 'error', text: `Approved "${spec.serverName}", but it did not start: ${failure}` }
  }

  /** Read `.mcp.json` and start the approved servers. A failure is logged and never fails Agent creation. */
  const attach = async (agent: Agent, cwd: string): Promise<void> => {
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const text = await readTextFile(join(projectRoot, '.mcp.json'))
    const parsed = text === undefined ? { servers: [], problems: [] } : parseMcpJson(text, { cwd, env: process.env })
    const state: AgentState = { projectRoot, servers: parsed.servers, problems: parsed.problems, mounted: new Map() }
    states.set(agent, state)
    for (const problem of state.problems) ctx.logger.warn(`air-mcp-conventions: ${problem}`)
    let pending = 0
    // Servers start in parallel.
    await Promise.all(state.servers.map(async (spec) => {
      if (!await isApproved(state, spec)) {
        pending += 1
        return
      }
      const failure = await mount(agent, state, spec)
      if (failure !== undefined) ctx.logger.warn(`air-mcp-conventions: server "${spec.serverName}" did not start: ${failure}`)
    }))
    if (pending > 0) ctx.logger.info(`air-mcp-conventions: ${pending} server(s) in ${join(projectRoot, '.mcp.json')} await approval; run /mcp in the session`)
  }

  ctx.on('agent/created', async ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    try {
      await attach(agent, cwd)
    } catch (error: unknown) {
      ctx.logger.warn(`air-mcp-conventions: ${(error as Error).message}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void release(agent)
  })

  ctx.effect(() => async () => {
    await Promise.all([...states.keys()].map(agent => release(agent)))
  }, 'air-mcp-conventions.servers')

  ctx.commands.register({
    name: 'mcp',
    description: 'List, approve, or revoke MCP servers declared in this project\'s .mcp.json',
    input: { hint: '[approve <server> | revoke <server>]' },
    handler: runCommand,
  })
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm -C air/packages/mcp-conventions exec vitest run tests/config.spec.ts tests/approvals.spec.ts tests/plugin.spec.ts`
Expected: `Test Files 3 passed (3)`.

If the `demo` server does not start, run the fixture by hand to see the handshake the upstream client sends (the command works in PowerShell and bash):
`node -e "const c=require('node:child_process').spawn(process.execPath,['air/packages/mcp-conventions/tests/fixtures/echo-server.mjs']);c.stdout.pipe(process.stdout);c.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n')"`
Expected: two JSON lines, the second listing `echo`. Then compare the request methods with `packages/mcp/mcp-client/tests/fixtures/negotiation-lifecycle.mjs` and add a `case` for any method the client requires.

- [ ] **Step 6: Write the native Loader test**

`air/packages/mcp-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-mcp-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  const approvalsFile = join(root, 'state', 'mcp-approvals.json')
  await mkdir(join(project, '.git'), { recursive: true })
  const mcpJson = JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [echoServer] } } })
  await writeFile(join(project, '.mcp.json'), mcpJson)
  const [spec] = parseMcpJson(mcpJson, { cwd: project, env: process.env }).servers
  if (spec === undefined) throw new Error('expected one server')
  await new ApprovalStore(approvalsFile).add(approvalKey(project, spec), {
    projectRoot: project,
    server: 'demo',
    approvedAt: '2026-10-01T00:00:00.000Z',
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-agent'",
    '- id: air-mcp-conventions',
    "  name: '@air/dsh-mcp-conventions'",
    '  config:',
    `    approvalsFile: ${JSON.stringify(approvalsFile)}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent } = stubAgent(context, project)
  await context.agents.register(agent)
  expect(context.tools.schemas(agent).map(schema => schema.name)).toEqual(['mcp__demo__echo'])
  const listed = await context.commands.execute(agent, '/mcp', [], new AbortController().signal)
  expect(listed?.result.text).toContain('): running')
})
```

- [ ] **Step 7: Build, then run the whole suite with coverage**

Run: `pnpm -C air/packages/mcp-conventions build`, then `pnpm -C air/packages/mcp-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 4 passed (4)`; `approvals.ts`, `config.ts`, `index.ts` at 100 in every column.

Run: `pnpm -C air/packages/mcp-conventions typecheck`, then `pnpm -C air run lint`
Expected: exit 0 for both.

- [ ] **Step 8: Write the README**

`air/packages/mcp-conventions/README.md`:

```markdown
# @air/dsh-mcp-conventions

## Summary

A host-level plugin that imports Claude Code project MCP configuration. When an Agent is created it reads `<project>/.mcp.json` (the project is the nearest ancestor of the session cwd that contains `.git`) and, for each server a person has approved, mounts one upstream `mcp-client` in that Agent's scope. The mount is awaited inside `agent/created`, so the tools exist for the first request. Servers start in parallel; a server that fails or exceeds `startupTimeoutMs` is logged and skipped, and Agent creation continues.

Supported entries: `command`, `args`, `env` (stdio) and `url`, `headers` with `type: "http"` (Streamable HTTP). `${VAR}` and `${VAR:-default}` are expanded from the process environment in `command`, `args`, `env`, `url`, and `headers`. A stdio server runs with the session cwd as its working directory.

Consent: a repository file can name any command, so nothing in `.mcp.json` runs until a person approves it. Approvals are stored in `<DSH_HOME>/air/mcp-approvals.json` (mode 0600 on POSIX; on Windows the file inherits the private ACL of the user profile), keyed by a SHA-256 over the project root, the server name, and the entry exactly as written in `.mcp.json`. Editing the command, arguments, URL, or any `${VAR}` name requires a new approval; rotating the value of a `${VAR}` does not. Run `/mcp approve <server>` before the first message of a session so the tools exist for the first request; the session logs a note at creation when servers await approval.

| Command | Effect |
|---|---|
| `/mcp` | list each declared server with its command line or URL and its state: `running`, `approved, not running`, `not approved`; list file problems |
| `/mcp approve <server>` | record approval and start the server for this session |
| `/mcp revoke <server>` | remove approval and stop the server in this session |

Config: `approvalsFile`, `startupTimeoutMs` (default 15000), `toolCallTimeoutMs` (default 60000), `projectRootMarkers` (default `['.git']`), `reviewTools` (default `false`). With `reviewTools: true` every mounted `mcp-client` waits for the `mcpToolReview` service of the MCP trust plan, so imported servers cannot register tools unreviewed; the AIR bundle turns it on when that plan is installed.

## Model Experience

The model sees each approved server's tools as `mcp__<server>__<tool>`, plus the server instructions upstream `mcp-client` attributes to that server. It sees nothing for a server that is not approved. `/mcp` output is shown to the person and is not sent to the model.

## Known Limitations

- Only the project `.mcp.json` is read, as UTF-8 (a UTF-8 byte-order mark is accepted; a UTF-16 file saved by Windows PowerShell 5 is not). `~/.claude.json`, Claude Desktop configuration, and `.mcpb` bundles are not imported.
- On Windows a bare `npx` or `uvx` command works because the upstream client launches servers through `cross-spawn`; a server inherits only a small set of environment variables plus the `env` it declares.
- `type: "sse"` servers and OAuth are not supported (upstream `mcp-client` has neither).
- An approval covers expanded env and header values, so rotating a token referenced through `${VAR}` requires a new approval.
- Every Agent starts its own server processes, including delegated child Agents working in the same project.
- `.mcp.json` is read once, when the Agent is created; edit the file and start a new session to pick up changes. Revoking in one session does not stop the server in other running sessions.
- A corrupt approvals file approves nothing: `/mcp` shows a problem line that names the file, and servers do not start until the file is repaired or deleted. Two processes writing the file at the same instant can lose one approval.
- Tool definitions are not pinned or reviewed here; that is the MCP trust plan.
```

- [ ] **Step 9: Commit**

```sh
git add air/packages/mcp-conventions
git commit -m "feat(air): mount approved .mcp.json servers per Agent and add the /mcp command"
```

---

### Task 8: `@air/dsh-command-conventions` — `.claude/commands` with `$ARGUMENTS`

**Files:**
- Create: `air/packages/command-conventions/package.json`
- Create: `air/packages/command-conventions/tsconfig.build.json`
- Create: `air/packages/command-conventions/tsconfig.json`
- Create: `air/packages/command-conventions/tsdown.config.ts`
- Create: `air/packages/command-conventions/vitest.config.ts`
- Create: `air/packages/command-conventions/src/args.ts`
- Create: `air/packages/command-conventions/src/index.ts`
- Create: `air/packages/command-conventions/tests/harness.ts`
- Create: `air/packages/command-conventions/README.md`
- Test: `air/packages/command-conventions/tests/args.spec.ts`
- Test: `air/packages/command-conventions/tests/plugin.spec.ts`
- Test: `air/packages/command-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `findProjectRoot`, `listMarkdownTree`, `parseFrontmatter`, `readTextFile`, `resolveUserHomes`, `stringField`, `stringListField`, `toKebabName`, `UserHomes`.
- Consumes from upstream: `ctx.on('agent/created' | 'agent/disposed', ...)`; `createScope(ctx, agent)`; `scope.ctx.commands.register({ name, description, input: { hint }, handler }): () => void`; `ctx.commands.find(agent, name): CommandDefinition | undefined`; `CommandInvocation { agent, rawInput }`; `CommandResult`; `agent.followup(message: UserMessage): void`; `createUserMessage({ content, source })`.
- Produces:
  - Cordis plugin module `@air/dsh-command-conventions`: `name = 'air-command-conventions'`, `inject = ['agents', 'commands']`, `Config`, `apply(ctx, config)`.
  - `interface Config { airHome?: string; claudeHome?: string; includeUserRoots?: boolean; projectRootMarkers?: string[]; positionalBase?: number }` with defaults from `resolveUserHomes`, `false`, `['.git']`, `0`.
  - `resolveConfig(config: Config): ResolvedConfig`.
  - `splitArguments(raw: string): string[]`; `substituteArguments(body: string, rawInput: string, names: readonly string[], positionalBase: number): string`.
  - Message source kind `air-command`: `interface AirCommandSource { readonly kind: 'air-command'; readonly name: string; readonly form: 'instructions' }`.
  - Bundle row used in Task 9: `{ id: air-command-conventions, name: '@air/dsh-command-conventions' }`.

Argument rules (Claude Code skill and command placeholders): `$ARGUMENTS` is the whole input, trimmed; `$ARGUMENTS[N]` and `$N` are one argument after shell-like splitting, counted from `positionalBase` (0 matches current Claude Code; set 1 for command files written for the older `$1` convention); `$name` is the argument at the position of `name` in the frontmatter `arguments:` list. A missing argument becomes an empty string. When the body has no placeholder and the input is not empty, `ARGUMENTS: <input>` is appended. Substitution is a single pass: placeholder text inside an argument is inserted literally and never expanded again, and `$&`-style replacement patterns in the input stay literal. Splitting treats a backslash as an escape only before a quote or whitespace, so Windows paths such as `C:\Users\me\a.txt` and `\\server\share` survive.

- [ ] **Step 1: Create the package scaffold**

`air/packages/command-conventions/package.json`:

```json
{
  "name": "@air/dsh-command-conventions",
  "description": "Registers .claude/commands files as slash commands with argument substitution",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@air/dsh-convention-core": "workspace:*",
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-agent": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-commands": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-llm": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-scope": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-agent-loop-testkit": "link:../../../packages/test-support/agent-loop-testkit",
    "@deepseek-ai/dsh-commands": "link:../../../packages/interaction/commands",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-scope": "link:../../../packages/core/scope",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session"
  }
}
```

`air/packages/command-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/command-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/command-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

`air/packages/command-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; `air/packages/command-conventions/node_modules/@deepseek-ai/dsh-commands/lib/index.js` exists.

- [ ] **Step 2: Write the failing argument tests**

`air/packages/command-conventions/tests/args.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { splitArguments, substituteArguments } from '../src/args.ts'

describe('splitArguments', () => {
  it.each([
    ['', []],
    ['   ', []],
    ['123 high', ['123', 'high']],
    ['  "two words"  \'single quoted\' plain ', ['two words', 'single quoted', 'plain']],
    ['a\\ b c', ['a b', 'c']],
    ['say \\"hi\\"', ['say', '"hi"']],
    ['C:\\Users\\me\\f.txt "D:\\my dir\\x"', ['C:\\Users\\me\\f.txt', 'D:\\my dir\\x']],
    ['\\\\server\\share', ['\\\\server\\share']],
    ['"" x', ['', 'x']],
    ['pre"fix ed"post', ['prefix edpost']],
    ['"unterminated rest', ['unterminated rest']],
    ['trailing\\', ['trailing\\']],
  ])('splits %j', (raw, expected) => {
    expect(splitArguments(raw)).toEqual(expected)
  })
})

describe('substituteArguments', () => {
  it('replaces $ARGUMENTS with the trimmed input', () => {
    expect(substituteArguments('Fix issue $ARGUMENTS now', '  123 high ', [], 0)).toBe('Fix issue 123 high now')
  })

  it('replaces indexed and numbered placeholders from the configured base', () => {
    expect(substituteArguments('$ARGUMENTS[0]/$ARGUMENTS[1]/$0/$1/$2', 'a "b c"', [], 0)).toBe('a/b c/a/b c/')
    expect(substituteArguments('$ARGUMENTS[1]/$1/$2/$3', 'a "b c"', [], 1)).toBe('a/a/b c/')
    expect(substituteArguments('$0', 'a', [], 1)).toBe('')
  })

  it('replaces named placeholders declared in arguments and leaves other dollar words', () => {
    expect(substituteArguments('Issue $issue on $branch costs $HOME', '42 main', ['issue', 'branch'], 0))
      .toBe('Issue 42 on main costs $HOME')
    expect(substituteArguments('Issue $issue then $branch', '42', ['issue', 'branch'], 0)).toBe('Issue 42 then ')
  })

  it('inserts the input literally and in one pass', () => {
    expect(substituteArguments('A: $ARGUMENTS B: $1', '$0 x', [], 0)).toBe('A: $0 x B: x')
    expect(substituteArguments('Run $ARGUMENTS', '$& $\'', [], 0)).toBe('Run $& $\'')
    expect(substituteArguments('All: $ARGUMENTS', 'a\nb', [], 0)).toBe('All: a\nb')
    expect(substituteArguments('Tenth: $10 or $ARGUMENTS[10]', 'a', [], 0)).toBe('Tenth:  or ')
    expect(substituteArguments('Open bracket: $ARGUMENTS[ now', 'x', [], 0)).toBe('Open bracket: x[ now')
  })

  it('appends the input when the body has no placeholder', () => {
    expect(substituteArguments('Review the diff.', 'only tests', [], 0)).toBe('Review the diff.\n\nARGUMENTS: only tests')
    expect(substituteArguments('Review the diff for $USER.', 'only tests', [], 0)).toBe('Review the diff for $USER.\n\nARGUMENTS: only tests')
    expect(substituteArguments('Review the diff.', '   ', [], 0)).toBe('Review the diff.')
  })
})
```

- [ ] **Step 3: Run the argument tests to verify they fail**

Run: `pnpm -C air/packages/command-conventions exec vitest run tests/args.spec.ts`
Expected: FAIL with `Failed to load url ../src/args.ts`.

- [ ] **Step 4: Implement argument handling**

`air/packages/command-conventions/src/args.ts`:

```ts
/** Argument splitting and placeholder substitution for command files. */

/** Characters a backslash may escape; any other backslash is literal, which keeps Windows paths intact. */
const ESCAPABLE = /["'\s]/u

/**
 * Split command input into arguments. Whitespace separates arguments; single or double quotes
 * group text, and a backslash before a quote or whitespace keeps that character. Any other backslash is
 * literal, so `C:\Users\me\a.txt` is one argument. An unterminated quote runs to the end.
 * @param raw - text typed after the command name.
 * @returns the arguments in order.
 */
export function splitArguments(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let started = false
  let quote: string | undefined
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index)
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === '\'') {
      quote = char
      started = true
    } else if (char === '\\' && ESCAPABLE.test(raw.charAt(index + 1))) {
      index += 1
      current += raw.charAt(index)
      started = true
    } else if (/\s/u.test(char)) {
      if (started) parts.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) parts.push(current)
  return parts
}

const PLACEHOLDER = /\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS|\$(\d+)|\$([A-Za-z_][A-Za-z0-9_]*)/gu

/**
 * Substitute argument placeholders in a command body.
 * @param body - command file body.
 * @param rawInput - text typed after the command name.
 * @param names - frontmatter `arguments:` names; `$name` maps to the argument at the same position.
 * @param positionalBase - index of the first argument for `$ARGUMENTS[N]` and `$N` (0 or 1).
 * @returns the prompt text. When no placeholder was replaced and the input is not empty, the input is appended as `ARGUMENTS: <input>`.
 */
export function substituteArguments(
  body: string,
  rawInput: string,
  names: readonly string[],
  positionalBase: number,
): string {
  const all = rawInput.trim()
  const positional = splitArguments(all)
  let replaced = false
  const text = body.replace(PLACEHOLDER, (
    match: string,
    indexed: string | undefined,
    numbered: string | undefined,
    named: string | undefined,
  ) => {
    if (named !== undefined) {
      const position = names.indexOf(named)
      if (position < 0) return match
      replaced = true
      return positional[position] ?? ''
    }
    replaced = true
    const index = indexed ?? numbered
    return index === undefined ? all : positional[Number(index) - positionalBase] ?? ''
  })
  return replaced || all.length === 0 ? text : `${text}\n\nARGUMENTS: ${all}`
}
```

- [ ] **Step 5: Run the argument tests to verify they pass**

Run: `pnpm -C air/packages/command-conventions exec vitest run tests/args.spec.ts`
Expected: `Test Files 1 passed (1)`.

- [ ] **Step 6: Write the harness and the failing plugin tests**

`air/packages/command-conventions/tests/harness.ts`:

```ts
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
```

`air/packages/command-conventions/tests/plugin.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import * as commandConventions from '../src/index.ts'
import { stubAgent, type StubAgent } from './harness.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  home: string
  config: commandConventions.Config
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-commands-'))
  created.push(base)
  const root = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(root, '.git'), { recursive: true })
  return { root, home, config: { airHome: join(home, '.air'), claudeHome: join(home, '.claude') } }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

async function mount(config: commandConventions.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.commands.register({ name: 'compact', description: 'Host command', handler: () => ({ kind: 'success' }) })
  const fiber = await ctx.plugin(commandConventions, config)
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined): Promise<StubAgent> {
  const stub = stubAgent(ctx, cwd)
  await ctx.agents.register(stub.agent)
  return stub
}

function names(ctx: Context, stub: StubAgent): string[] {
  return ctx.commands.list(stub.agent).map(command => command.name)
}

async function command(ctx: Context, stub: StubAgent, line: string) {
  const execution = await ctx.commands.execute(stub.agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
  return execution.result
}

describe('air-command-conventions', () => {
  it('registers project command files for the Agent with description and hint', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/fix-issue.md'), '---\ndescription: Fix a GitHub issue\nargument-hint: "[issue] [priority]"\n---\nFix issue $ARGUMENTS.')
    await write(join(root, '.claude/commands/frontend/component.md'), '# Create a component\nName it $0.')
    await write(join(root, '.claude/commands/terse.md'), '#\nDo the thing.')
    await write(join(root, '.claude/commands/long.md'), 'x'.repeat(200))
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(ctx.commands.list(stub.agent)).toEqual([
      { name: 'compact', description: 'Host command' },
      { name: 'fix-issue', description: 'Fix a GitHub issue', input: { hint: '[issue] [priority]' } },
      { name: 'frontend-component', description: 'Create a component', input: { hint: '[arguments]' } },
      { name: 'long', description: `${'x'.repeat(119)}…`, input: { hint: '[arguments]' } },
      { name: 'terse', description: 'Project command file', input: { hint: '[arguments]' } },
    ])
  })

  it('sends the substituted body to the model as an air-command message', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/fix-issue.md'), '---\narguments: issue priority\n---\nFix issue $issue with priority $priority.\nAll: $ARGUMENTS')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(await command(ctx, stub, '/fix-issue 123 high')).toEqual({ kind: 'success', text: 'Sent /fix-issue to the model.' })
    expect(stub.followups).toHaveLength(1)
    expect(stub.followups[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Fix issue 123 with priority high.\nAll: 123 high' }],
      source: { kind: 'air-command', name: 'fix-issue', form: 'instructions' },
    })
  })

  it('counts positional placeholders from the configured base', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/greet.md'), 'Greet $1.')
    const { ctx } = await mount({ ...config, positionalBase: 1 })
    const stub = await live(ctx, root)
    await command(ctx, stub, '/greet Ada')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Greet Ada.' }])
  })

  it('reads the latest file content and reports a deleted file', async () => {
    const { root, config } = await world()
    const file = join(root, '.claude/commands/review.md')
    await write(file, 'Review the diff.')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    await write(file, 'Review the diff carefully.')
    await command(ctx, stub, '/review')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Review the diff carefully.' }])
    await rm(file)
    expect(await command(ctx, stub, '/review')).toEqual({ kind: 'error', text: `/review: ${file} can no longer be read.` })
    expect(stub.followups).toHaveLength(1)
  })

  it('prefers project files over the AIR home and reads user files only on request', async () => {
    const { root, home, config } = await world()
    await write(join(root, '.claude/commands/deploy.md'), 'Project deploy.')
    await write(join(home, '.air/commands/deploy.md'), 'AIR home deploy.')
    await write(join(home, '.air/commands/standup.md'), 'AIR home standup.')
    await write(join(home, '.claude/commands/personal.md'), 'Personal command.')
    const first = await mount(config)
    const stub = await live(first.ctx, root)
    expect(names(first.ctx, stub)).toEqual(['compact', 'deploy', 'standup'])
    await command(first.ctx, stub, '/deploy')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Project deploy.' }])
    const second = await mount({ ...config, includeUserRoots: true })
    expect(names(second.ctx, await live(second.ctx, root))).toEqual(['compact', 'deploy', 'personal', 'standup'])
  })

  it('skips files it cannot register and never shadows an existing command', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/123.md'), 'Starts with a digit.')
    await write(join(root, '.claude/commands/+++.md'), 'No usable name.')
    await write(join(root, '.claude/commands/compact.md'), 'Tries to replace a host command.')
    await write(join(root, '.claude/commands/broken.md'), '---\narguments: [unclosed\n---\nBody')
    await write(join(root, '.claude/commands/empty.md'), '---\ndescription: Nothing here\n---\n\n')
    await write(join(root, '.claude/commands/good.md'), 'Works.')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(names(ctx, stub)).toEqual(['compact', 'good'])
    expect(await command(ctx, stub, '/compact')).toEqual({ kind: 'success' })
  })

  it('does not fail Agent creation when a command folder cannot be read', async () => {
    const { config } = await world()
    const { ctx } = await mount(config)
    const stub = await live(ctx, 'bad\0cwd')
    expect(names(ctx, stub)).toEqual(['compact'])
  })

  it('scopes commands to the Agent and removes them on disposal and unload', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/local.md'), 'Local.')
    const other = await world()
    const { ctx, fiber } = await mount(config)
    const here = await live(ctx, root)
    const there = await live(ctx, other.root)
    const detached = await live(ctx, undefined)
    const again = await live(ctx, root)
    expect(names(ctx, here)).toEqual(['compact', 'local'])
    expect(names(ctx, there)).toEqual(['compact'])
    expect(names(ctx, detached)).toEqual(['compact'])
    ctx.emit('agent/disposed', { agent: here.agent })
    ctx.emit('agent/disposed', { agent: there.agent })
    await vi.waitFor(() => { expect(names(ctx, here)).toEqual(['compact']) }, { timeout: 5000 })
    expect(names(ctx, again)).toEqual(['compact', 'local'])
    await fiber.dispose()
    expect(names(ctx, again)).toEqual(['compact'])
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    expect(commandConventions.resolveConfig({ airHome: resolve(sep, 'a'), claudeHome: resolve(sep, 'c') })).toMatchObject({
      homes: { airHome: resolve(sep, 'a'), claudeHome: resolve(sep, 'c') },
      includeUserRoots: false,
      projectRootMarkers: ['.git'],
      positionalBase: 0,
    })
  })

  it('rejects invalid values', () => {
    expect(() => commandConventions.resolveConfig({ positionalBase: 2 })).toThrow('positionalBase must be 0 or 1')
    expect(() => commandConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
```

- [ ] **Step 7: Run the plugin tests to verify they fail**

Run: `pnpm -C air/packages/command-conventions exec vitest run tests/plugin.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 8: Implement the plugin**

`air/packages/command-conventions/src/index.ts`:

```ts
/**
 * Registers Claude Code command files (`.claude/commands/**` Markdown) as slash commands scoped to
 * the Agent whose project contains them. Running a command substitutes its arguments into the file
 * body and queues the result as a user message with source kind `air-command`, so the prompt the
 * model receives is in the session log.
 *
 * @module @air/dsh-command-conventions
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import {
  findProjectRoot,
  listMarkdownTree,
  parseFrontmatter,
  readTextFile,
  resolveUserHomes,
  stringField,
  stringListField,
  toKebabName,
  type UserHomes,
} from '@air/dsh-convention-core'
import { substituteArguments } from './args.ts'

export { splitArguments, substituteArguments } from './args.ts'

export const name = 'air-command-conventions'
export const inject = ['agents', 'commands']

/** Same grammar the upstream command registry accepts. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u
/** Directory levels walked under a commands root. */
const COMMAND_TREE_DEPTH = 4
const DESCRIPTION_MAX_CHARS = 120

/** Durable source of the user message a command file produces. */
export interface AirCommandSource {
  readonly kind: 'air-command'
  /** Command name without the slash. */
  readonly name: string
  /** The text is instructions read out of a file. */
  readonly form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A command file rendered by `@air/dsh-command-conventions`. */
    'air-command': AirCommandSource
  }
}

/** Plugin configuration. */
export interface Config {
  /** AIR home; its `commands` directory is always scanned. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home, read only with `includeUserRoots`. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Whether `<claudeHome>/commands` is scanned. Defaults to false. */
  includeUserRoots?: boolean
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
  /** Index of the first argument for `$ARGUMENTS[N]` and `$N`: 0 or 1. Defaults to 0. */
  positionalBase?: number
}

export const Config: Schema<Config> = Schema.object({
  airHome: Schema.string().description('AIR home; defaults to $AIR_HOME, then ~/.air.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  includeUserRoots: Schema.boolean().default(false).description('Scan ~/.claude/commands.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
  positionalBase: Schema.number().default(0).description('Index of the first argument for $ARGUMENTS[N] and $N: 0 or 1.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly homes: UserHomes
  readonly includeUserRoots: boolean
  readonly projectRootMarkers: readonly string[]
  readonly positionalBase: number
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    homes: resolveUserHomes(config),
    includeUserRoots: config.includeUserRoots ?? false,
    projectRootMarkers: config.projectRootMarkers ?? ['.git'],
    positionalBase: config.positionalBase ?? 0,
  }
  if (resolved.positionalBase !== 0 && resolved.positionalBase !== 1) {
    throw new TypeError('air-command-conventions: positionalBase must be 0 or 1')
  }
  if (resolved.projectRootMarkers.length === 0) {
    throw new TypeError('air-command-conventions: projectRootMarkers must not be empty')
  }
  return resolved
}

interface LoadedCommand {
  readonly description: string
  readonly hint: string
  readonly argumentNames: readonly string[]
  readonly body: string
}

interface CommandFile extends LoadedCommand {
  readonly name: string
  readonly path: string
}

function firstLine(text: string): string {
  const end = text.indexOf('\n')
  const line = (end < 0 ? text : text.slice(0, end)).replace(/^#+\s*/u, '').trim()
  if (line.length === 0) return 'Project command file'
  return line.length <= DESCRIPTION_MAX_CHARS ? line : `${line.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
}

/**
 * Register command files per Agent.
 * @param ctx - host-level plugin context with `agents` and `commands` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const scopes = new Map<Agent, Scope>()

  /** Read and parse one command file; undefined when it is gone, empty, or does not parse. */
  const load = async (path: string): Promise<LoadedCommand | undefined> => {
    const raw = await readTextFile(path)
    if (raw === undefined) return undefined
    try {
      const { data, body } = parseFrontmatter(raw)
      const text = body.trim()
      if (text.length === 0) return undefined
      return {
        description: stringField(data, 'description') ?? firstLine(text),
        hint: stringField(data, 'argument-hint') ?? '[arguments]',
        argumentNames: stringListField(data, 'arguments') ?? [],
        body: text,
      }
    } catch (error: unknown) {
      ctx.logger.warn(`air-command-conventions: ${path} ignored: ${(error as Error).message}`)
      return undefined
    }
  }

  const discover = async (agent: Agent, cwd: string): Promise<CommandFile[]> => {
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const roots = [
      join(projectRoot, '.claude', 'commands'),
      join(resolved.homes.airHome, 'commands'),
      ...resolved.includeUserRoots ? [join(resolved.homes.claudeHome, 'commands')] : [],
    ]
    const found = new Map<string, CommandFile>()
    for (const root of roots) {
      for (const entry of await listMarkdownTree(root, COMMAND_TREE_DEPTH)) {
        const commandName = toKebabName(entry.segments.join('-'))
        if (commandName === undefined || !COMMAND_NAME.test(commandName)) {
          ctx.logger.warn(`air-command-conventions: ${entry.path} skipped: its path does not form a command name`)
          continue
        }
        if (found.has(commandName)) continue
        // A repository file must not replace a command the host or the preset already provides.
        if (ctx.commands.find(agent, commandName) !== undefined) {
          ctx.logger.warn(`air-command-conventions: ${entry.path} skipped: /${commandName} is already a command`)
          continue
        }
        const loaded = await load(entry.path)
        if (loaded === undefined) continue
        found.set(commandName, { ...loaded, name: commandName, path: entry.path })
      }
    }
    return [...found.values()]
  }

  const run = async (file: CommandFile, invocation: CommandInvocation): Promise<CommandResult> => {
    const loaded = await load(file.path)
    if (loaded === undefined) return { kind: 'error', text: `/${file.name}: ${file.path} can no longer be read.` }
    const text = substituteArguments(loaded.body, invocation.rawInput, loaded.argumentNames, resolved.positionalBase)
    const source: AirCommandSource = { kind: 'air-command', name: file.name, form: 'instructions' }
    invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source }))
    return { kind: 'success', text: `Sent /${file.name} to the model.` }
  }

  const release = async (agent: Agent): Promise<void> => {
    const scope = scopes.get(agent)
    if (scope === undefined) return
    scopes.delete(agent)
    await scope.dispose()
  }

  ctx.on('agent/created', async ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    let files: CommandFile[]
    try {
      files = await discover(agent, cwd)
    } catch (error: unknown) {
      // A command folder that cannot be read costs the Agent its commands, never its creation.
      ctx.logger.warn(`air-command-conventions: command files could not be read: ${(error as Error).message}`)
      return
    }
    if (files.length === 0) return
    const scope = createScope(ctx, agent)
    scopes.set(agent, scope)
    for (const file of files) {
      scope.ctx.commands.register({
        name: file.name,
        description: file.description,
        input: { hint: file.hint },
        handler: invocation => run(file, invocation),
      })
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void release(agent)
  })

  ctx.effect(() => async () => {
    await Promise.all([...scopes.keys()].map(agent => release(agent)))
  }, 'air-command-conventions.scopes')
}
```

- [ ] **Step 9: Run the unit tests to verify they pass**

Run: `pnpm -C air/packages/command-conventions exec vitest run tests/args.spec.ts tests/plugin.spec.ts`
Expected: `Test Files 2 passed (2)`.

- [ ] **Step 10: Write the native Loader test**

`air/packages/command-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-command-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude', 'commands'), { recursive: true })
  await writeFile(join(project, '.claude', 'commands', 'fix-issue.md'), 'Fix issue $ARGUMENTS.')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-agent'",
    '- id: air-command-conventions',
    "  name: '@air/dsh-command-conventions'",
    '  config:',
    `    airHome: ${JSON.stringify(join(root, 'home', '.air'))}`,
    `    claudeHome: ${JSON.stringify(join(root, 'home', '.claude'))}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent, followups } = stubAgent(context, project)
  await context.agents.register(agent)
  const execution = await context.commands.execute(agent, '/fix-issue 123', [], new AbortController().signal)
  expect(execution?.result).toEqual({ kind: 'success', text: 'Sent /fix-issue to the model.' })
  expect(followups[0]).toMatchObject({
    content: [{ type: 'text', text: 'Fix issue 123.' }],
    source: { kind: 'air-command', name: 'fix-issue', form: 'instructions' },
  })
  expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(expect.arrayContaining(['command/run', 'command/done']))
})
```

The last assertion uses `snapshotEvents`, which upstream marks deprecated for new production code; it is acceptable in a test (upstream's own `command-goal.spec.ts` uses it). If oxlint reports `typescript/no-deprecated` on that line, add `// oxlint-disable-next-line typescript/no-deprecated -- test reads the log to check the upstream command lifecycle events` above it.

- [ ] **Step 11: Build, then run the whole suite with coverage**

Run: `pnpm -C air/packages/command-conventions build`, then `pnpm -C air/packages/command-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 3 passed (3)`; `args.ts` and `index.ts` at 100 in every column.

Run: `pnpm -C air/packages/command-conventions typecheck`, then `pnpm -C air run lint`
Expected: exit 0 for both.

- [ ] **Step 12: Write the README**

`air/packages/command-conventions/README.md`:

```markdown
# @air/dsh-command-conventions

## Summary

A host-level plugin that turns Claude Code command files into slash commands. When an Agent is created it scans, in this order, `<project>/.claude/commands`, `<airHome>/commands`, and (only with `includeUserRoots: true`) `<claudeHome>/commands`, up to four directory levels deep. Each `.md` file becomes a command registered in that Agent's scope through `ctx.commands`; the first file found for a name wins. A nested path is joined with `-` (`frontend/component.md` is `/frontend-component`). A file whose name is already a command for that Agent (for example `/compact` or `/goal`) is skipped with a warning, so a repository cannot replace a built-in command.

Running a command reads the file again, substitutes arguments, and queues the text with `agent.followup` as a user message whose source is `{ kind: 'air-command', name, form: 'instructions' }`. The upstream registry logs `command/run` and `command/done` around it.

| Placeholder | Value |
|---|---|
| `$ARGUMENTS` | everything typed after the command name, trimmed |
| `$ARGUMENTS[N]`, `$N` | one argument after shell-like splitting (quotes group words), counted from `positionalBase` |
| `$name` | the argument at the position of `name` in the frontmatter `arguments:` list |

A missing argument becomes an empty string. When the body has no placeholder and input was typed, `ARGUMENTS: <input>` is appended. Frontmatter `description` (default: the first body line) and `argument-hint` (default `[arguments]`) appear in the `/` picker.

Config: `airHome`, `claudeHome`, `includeUserRoots` (default `false`), `projectRootMarkers` (default `['.git']`), `positionalBase` (default `0`; set `1` for files written for the older `$1` convention).

This plugin is the only reader of `.claude/commands`: `@air/dsh-skill-conventions` does not list command files as skills, so each file appears once in the `/` picker.

## Model Experience

The model receives the rendered command body as an ordinary user turn. It does not see the command name or the placeholders, and it has no tool for running these commands itself.

## Known Limitations

- `@file` references and `` !`cmd` `` lines in a command body are not expanded; the model sees them as written.
- `allowed-tools` and `model` in command frontmatter are ignored.
- Command files are discovered once, when the Agent is created. A new file needs a new session; an edited file is picked up on the next run.
- Command names lose the `:` namespace separator Claude Code uses (`frontend:component` is `/frontend-component`).
- A file whose path does not start with a letter after normalisation (for example `123.md`) is skipped.
- `$N` consumes any dollar sign followed by digits, so a body that spells a price as `$5` loses it; this matches Claude Code. Backslashes escape only quotes and whitespace in the input.
- A skill or built-in command with the same name is not detected for skills: a command file is skipped only when a registered slash command already has its name.
```

- [ ] **Step 13: Commit**

```sh
git add air/packages/command-conventions air/pnpm-lock.yaml
git commit -m "feat(air): register .claude/commands files as argument-substituting slash commands"
```

---

### Task 9: Bundle wiring — `preset-air`, registry default, host rows, profile verification

**Files:**
- Modify: `air/package.json` (add `yaml` to `devDependencies`; add the scripts `check:composition` and `demo`)
- Create: `air/scripts/tests/preset-air-drift.spec.ts`
- Create: `air/scripts/check-air-composition.ts`
- Create: `air/scripts/make-demo-project.ts`
- Modify: `air/bundles/air/package.json`
- Modify: `air/bundles/air/cordis.patch.yml`
- Modify: `air/README.md`

**Interfaces:**
- Consumes: the four plugin packages built in Tasks 3, 5, 7, 8 and their rows:
  - preset rows `{ id: air-instruction-conventions, name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } }` and `{ id: air-skill-conventions, name: '@air/dsh-skill-conventions' }`
  - host rows `{ id: air-mcp-conventions, name: '@air/dsh-mcp-conventions' }` and `{ id: air-command-conventions, name: '@air/dsh-command-conventions' }`
- Consumes from upstream: `packages/bundle/web-app/presets/standard.patch.yml` (row `preset-standard`, regenerated against `dsh-v0.2.1-alpha.1`); host row `agent-preset-registry` with Config `{ default: string }`; patch semantics (a patch replaces a row's whole `config`; `insert` adds rows); the profile's runtime resolution, which supplies the packages of selected bundles to row loading; the Web composition, which mounts the `schedule` service that the `tool-schedule` row needs; `air/scripts/smoke-profile.ts` from plan 00 (its launcher and problem pattern are repeated in `check-air-composition.ts`).
- Produces: the `air` profile composes an agent preset `air` (default for new sessions) with the convention plugins; `preset-standard` stays selectable. A drift test fails when the upstream `standard` preset changes without the same change in `preset-air`.

Why a copied preset: the live `skill-filesystem`, `tool-skill`, and `agent-instructions` rows sit inside `preset-standard`'s `config.plugins`, and a bundle patch cannot address nested rows of a non-group entry by id (spike 02 §0.1). Replacing `preset-standard`'s config would fork the upstream list under the upstream id, so the bundle adds its own preset and makes it the default.

**Rows of the upstream `standard` preset, and what `preset-air` does with each** (list regenerated from the `dsh-v0.2.1-alpha.1` file; the drift test fails when upstream adds or changes a row, which is the cue to extend this table):

| Upstream row | In `preset-air` | Reason |
|---|---|---|
| `persona`, `tool-bash`/`tool-pwsh` (by platform), `tool-fs`, `tool-fs-search`, `tool-jobs`, `tool-skill`, `command-goal`, `tool-goal`, `planning`, `compaction`, `tool-ask-user`, `tool-todo`, `tool-web`, `present`, `tool-plugin-manager` (disabled) | kept unchanged | AIR starts from upstream's coding-agent tools; AIR differs by additions, not removals |
| `agent-instructions` | kept; `air-instruction-conventions` follows it | upstream keeps the `AGENTS.md` and `CLAUDE.md` chain; AIR adds `.claude/CLAUDE.md`, imports, and rules |
| `time-context` (new upstream) | kept | the model needs the date and time for reminders and for judging how fresh a memory is; plan 04's memory-context row sits beside it |
| `tool-schedule` (new upstream: `schedule_create`, `schedule_delete`, `schedule_list`, `schedule_update`) | kept | reminders and follow-ups belong to a personal assistant; delegated children cannot call them (upstream's `toolFilter` on the `subagent` and `subagent_fork` rows, kept) |
| `skill-filesystem` | kept with `includeDefaultRoots: false`; `air-skill-conventions` follows it | stops `~/.agents/skills` and `~/.dsh/skills` from flooding a small local model's catalog; project roots and `~/.air/skills` come from the AIR provider |
| `delegation` group (`tool-subagent*`, `workflow-ptc`, `tool-workflow`, `tool-ralph`) | kept, including the disabled rows | later plans (agents slice, evaluation arms) toggle these by row id |

Dropped rows: none. A row AIR never wants (for example `tool-web` in an offline arm) is disabled by a patch on the row id inside the evaluation bundles, not by editing this list.

- [ ] **Step 1: Add the YAML parser for the drift test and the two scripts**

In `air/package.json`, add this entry to `devDependencies` (keep the keys sorted):

```json
    "yaml": "^2.9.0"
```

and add these entries to `scripts`:

```json
    "check:composition": "tsx scripts/check-air-composition.ts",
    "demo": "tsx scripts/make-demo-project.ts"
```

Run: `pnpm -C air install`
Then: `node -e "console.log(require('fs').existsSync('air/node_modules/yaml/package.json'))"`
Expected: install exits 0; the second command prints `true`.

- [ ] **Step 2: Write the failing drift test**

`air/scripts/tests/preset-air-drift.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const airDir = join(import.meta.dirname, '..', '..')
const bundleDir = join(airDir, 'bundles', 'air')
const airPatch = join(bundleDir, 'cordis.patch.yml')
const standardPatch = join(airDir, '..', 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Upstream patch files use `!!js <expression>`; keep the expression as text so both files compare equal.
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (source: string) => `!!js ${source}` }

function patches(file: string): Row[] {
  const parsed: unknown = parse(readFileSync(file, 'utf8'), { customTags: [jsTag] })
  if (!Array.isArray(parsed) || !parsed.every(isRow)) throw new Error(`${file}: expected a list of patch objects`)
  return parsed
}

function insertedRows(file: string): Row[] {
  return patches(file).flatMap((patch) => {
    const inserted = patch['insert']
    return Array.isArray(inserted) ? inserted.filter(isRow) : []
  })
}

function presetPlugins(file: string, rowId: string): Row[] {
  const row = insertedRows(file).find(candidate => candidate['id'] === rowId)
  const config = row?.['config']
  if (!isRow(config)) throw new Error(`${file}: no preset row ${rowId}`)
  const plugins = config['plugins']
  if (!Array.isArray(plugins) || !plugins.every(isRow)) throw new Error(`${file}: ${rowId} has no plugin list`)
  return plugins
}

function isAirRow(row: Row): boolean {
  const id = row['id']
  return typeof id === 'string' && id.startsWith('air-')
}

describe('AIR bundle composition', () => {
  it('keeps preset-air equal to the upstream standard preset plus the declared changes', () => {
    const standard = presetPlugins(standardPatch, 'preset-standard')
    const air = presetPlugins(airPatch, 'preset-air')
    expect(air.filter(isAirRow)).toEqual([
      { id: 'air-instruction-conventions', name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } },
      { id: 'air-skill-conventions', name: '@air/dsh-skill-conventions' },
    ])
    const expected = standard.map(row => (row['id'] === 'skill-filesystem' ? { ...row, config: { includeDefaultRoots: false } } : row))
    expect(air.filter(row => !isAirRow(row))).toEqual(expected)
  })

  it('places each AIR preset row directly after its upstream counterpart', () => {
    const ids = presetPlugins(airPatch, 'preset-air').map(row => row['id'])
    expect(ids[ids.indexOf('agent-instructions') + 1]).toBe('air-instruction-conventions')
    expect(ids[ids.indexOf('skill-filesystem') + 1]).toBe('air-skill-conventions')
  })

  it('keeps the clock reading and the reminder tools', () => {
    const ids = presetPlugins(airPatch, 'preset-air').map(row => row['id'])
    expect(ids).toEqual(expect.arrayContaining(['time-context', 'tool-schedule']))
  })

  it('makes the AIR preset the default and mounts the host rows', () => {
    expect(patches(airPatch)).toContainEqual({ id: 'agent-preset-registry', config: { default: 'air' } })
    const hostRows = insertedRows(airPatch).filter(isAirRow)
    expect(hostRows).toEqual([
      { id: 'air-mcp-conventions', name: '@air/dsh-mcp-conventions' },
      { id: 'air-command-conventions', name: '@air/dsh-command-conventions' },
    ])
  })

  it('declares every AIR row package as a bundle dependency', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
    const dependencies = isRow(manifest) && isRow(manifest['dependencies']) ? manifest['dependencies'] : {}
    const rowPackages = [...readFileSync(airPatch, 'utf8').matchAll(/name: '(@air\/[^']+)'/gu)].map(match => match[1])
    expect(rowPackages).toHaveLength(4)
    for (const packageName of rowPackages) expect(dependencies).toHaveProperty([String(packageName)], 'workspace:*')
  })
})
```

- [ ] **Step 3: Run the drift test to verify it fails**

Run: `pnpm -C air exec vitest run scripts/tests/preset-air-drift.spec.ts`
Expected: FAIL; the first, second, and third tests with `no preset row preset-air`, the fourth because the registry patch is absent, the fifth with `expected [] to have a length of 4`.

- [ ] **Step 4: Declare the bundle dependencies**

Replace `air/bundles/air/package.json` with:

```json
{
  "name": "@air/dsh-air-bundle",
  "description": "AIR product bundle: local-first defaults over the upstream Web composition",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "files": [
    "cordis.patch.yml"
  ],
  "dependencies": {
    "@air/dsh-command-conventions": "workspace:*",
    "@air/dsh-instruction-conventions": "workspace:*",
    "@air/dsh-mcp-conventions": "workspace:*",
    "@air/dsh-skill-conventions": "workspace:*"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Run: `pnpm -C air install`
Then: `node -e "console.log(require('fs').readdirSync('air/bundles/air/node_modules/@air').sort().join(' '))"`
Expected: install exits 0; the second command prints `dsh-command-conventions dsh-instruction-conventions dsh-mcp-conventions dsh-skill-conventions`.

- [ ] **Step 5: Add the preset, the host rows, and the registry default**

Append to `air/bundles/air/cordis.patch.yml` (after the existing `agent-default-model` patch). The `plugins` list is the upstream `standard` list (the file at `packages/bundle/web-app/presets/standard.patch.yml` of `dsh-v0.2.1-alpha.1`) with two changes: `skill-filesystem` gets `includeDefaultRoots: false`, and the AIR rows `air-instruction-conventions` and `air-skill-conventions` follow `agent-instructions` and `skill-filesystem`. Indentation is significant; copy the block as shown.

```yaml

# The AIR agent preset: the upstream `standard` plugin list
# (packages/bundle/web-app/presets/standard.patch.yml) with the AIR convention
# plugins added. A bundle patch cannot reach rows nested in `preset-standard`,
# so AIR ships its own preset and makes it the default; `standard` stays
# selectable. air/scripts/tests/preset-air-drift.spec.ts fails when the two
# lists differ by anything other than the changes below, which is the signal to
# re-copy after an upstream merge.
#   - skill-filesystem: includeDefaultRoots false, so ~/.dsh/skills and
#     ~/.agents/skills are not listed; the AIR provider owns project roots and
#     ~/.air/skills, and user roots are opt-in. Bundled skills stay.
#   - air-skill-conventions and air-instruction-conventions: added.
- insert:
    - id: preset-air
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: air
        name: AIR
        description: Standard coding tools plus Claude Code file conventions; user-level skill folders are opt-in.
        order: 0
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              suffix: Your working directory is {{cwd}}.
              prefix: You are a coding agent powered by the {{model}} model.
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: air-instruction-conventions
            name: '@air/dsh-instruction-conventions'
            config:
              maxBytes: 32768
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: tool-schedule
            name: '@deepseek-ai/dsh-tool-schedule'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              includeDefaultRoots: false
          - id: air-skill-conventions
            name: '@air/dsh-skill-conventions'
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: command-goal
            name: '@deepseek-ai/dsh-command-goal'
          - id: tool-goal
            name: '@deepseek-ai/dsh-tool-goal'
          - id: planning
            name: cordis:group
            group: true
            isolate:
              planMode: true
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
                config:
                  section: |
                    You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

                    Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

                    The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

                    Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

                    Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

                    When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'
              - id: tool-subagent-list-agents
                name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
              - id: tool-subagent
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: spawn
                  toolName: subagent
                  modelSelectionSettings: true
                  backgroundMode: continuable
                  toolFilter:
                    deny:
                      - schedule_create
                      - schedule_delete
                      - schedule_list
                      - schedule_update
              - id: tool-subagent-fork
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: fork
                  toolName: subagent_fork
                  backgroundMode: continuable
                  toolFilter:
                    deny:
                      - schedule_create
                      - schedule_delete
                      - schedule_list
                      - schedule_update
              - id: tool-subagent-codex
                name: '@deepseek-ai/dsh-tool-subagent'
                disabled: true
                config:
                  provider: codex
                  toolName: subagent_codex
                  backgroundMode: one-shot
                  maxDepth: provider-managed
              - id: tool-subagent-claude-code
                name: '@deepseek-ai/dsh-tool-subagent'
                disabled: true
                config:
                  provider: claude-code
                  toolName: subagent_claude_code
                  backgroundMode: one-shot
                  maxDepth: provider-managed
              - id: workflow-ptc
                name: '@deepseek-ai/dsh-workflow-ptc'
                config:
                  provider: spawn
              - id: tool-workflow
                name: '@deepseek-ai/dsh-tool-workflow'
              - id: tool-ralph
                name: '@deepseek-ai/dsh-tool-ralph'
                disabled: true
                config:
                  subagentProvider: spawn
                  maxRounds: 64
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
          - id: present
            name: '@deepseek-ai/dsh-tool-present'
          - id: tool-plugin-manager
            name: '@deepseek-ai/dsh-plugin-manager/tools'
            disabled: true

    # Host rows: each mounts per-Agent children through createScope.
    - id: air-mcp-conventions
      name: '@air/dsh-mcp-conventions'
    - id: air-command-conventions
      name: '@air/dsh-command-conventions'

# New sessions use the AIR preset. The registry row's only non-volatile Config
# field is `default`, so replacing its config loses nothing.
- id: agent-preset-registry
  config:
    default: air
```

To turn on user-level folders (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/CLAUDE.md`), a user copies the `preset-air` row into the profile patch (`$DSH_HOME/profiles/air/cordis.patch.yml`) as an id-targeted patch with `includeUserRoots: true` on the `air-skill-conventions` and `air-instruction-conventions` rows, and patches `air-command-conventions` with `config: { includeUserRoots: true }`. This is documented in Step 10.

- [ ] **Step 6: Run the drift test to verify it passes**

Run: `pnpm -C air exec vitest run scripts/tests/preset-air-drift.spec.ts`
Expected: `Tests 5 passed (5)`.

If the first test fails on a difference in an upstream row, the upstream file changed after this plan was written: re-copy that row from `packages/bundle/web-app/presets/standard.patch.yml` into `preset-air`, add it to the table above, and rerun.

- [ ] **Step 7: Build and test the whole AIR workspace**

Run: `pnpm -C air run build`, then `pnpm -C air run typecheck`, then `pnpm -C air run lint`, then `pnpm -C air run test`
Expected: each exits 0; the workspace-level test run reports the drift test and the plan-00 script tests, then each of the five packages reports all test files passed.

Run from the repository root: `pnpm run verify-no-unknown-casts`, `pnpm run verify-concrete-terms`, `pnpm run verify-repository-references`, `pnpm run verify-translation-pairing`
Expected: each exits 0. `verify-no-unknown-casts` reports no new assertions.

- [ ] **Step 8: Write the composition check and the demo-project script**

`air/scripts/check-air-composition.ts` composes the bundle in a throwaway profile under an isolated `DSH_HOME` (the same launcher and setup as plan 00's smoke, so it never touches a teammate's real profile) and checks the rows this plan adds:

```ts
/** Compose the AIR bundle in a throwaway profile and check the rows the file-conventions plan adds (Windows and Linux). */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const home = mkdtempSync(join(tmpdir(), 'air-check-'))
const profile = 'air-check'
const env = { ...process.env, DSH_HOME: home }
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]
const PROBLEM = /unmatched|incompatible|failed|disabling profile plugin row|did not activate|pending/i

function fail(message: string, detail = ''): never {
  console.error(`composition: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

function dsh(args: readonly string[]): { stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) fail(`dsh ${args.join(' ')} exited ${String(result.status)}`, result.stderr)
  return { stdout: result.stdout, stderr: result.stderr }
}

dsh(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
dsh(['plugin', '--profile', profile, 'add', join(repoRoot, 'air', 'bundles', 'air')])
copyFileSync(
  join(repoRoot, 'air', 'examples', 'ollama.profile.cordis.patch.yml'),
  join(home, 'profiles', profile, 'cordis.patch.yml'),
)
writeFileSync(join(home, '.env'), 'OLLAMA_API_KEY=ollama\n')

const dump = dsh(['--profile', profile, '--dump-config'])
if (PROBLEM.test(dump.stderr)) fail('problems while composing:', dump.stderr)

const text = dump.stdout
const count = (pattern: RegExp): number => text.match(pattern)?.length ?? 0
const presetAt = text.search(/id:\s*['"]?preset-air\b/u)
const presetText = presetAt < 0 ? '' : text.slice(presetAt, presetAt + 20_000)
const registryAt = text.search(/id:\s*['"]?agent-preset-registry\b/u)
const checks: readonly (readonly [string, boolean])[] = [
  ['one preset-air row', count(/id:\s*['"]?preset-air\b/gu) === 1],
  ['skill conventions mounted once', count(/@air\/dsh-skill-conventions/gu) === 1],
  ['instruction conventions mounted once', count(/@air\/dsh-instruction-conventions/gu) === 1],
  ['mcp conventions mounted once', count(/@air\/dsh-mcp-conventions/gu) === 1],
  ['command conventions mounted once', count(/@air\/dsh-command-conventions/gu) === 1],
  ['registry default is air', registryAt >= 0 && /default:\s*['"]?air\b/u.test(text.slice(registryAt, registryAt + 400))],
  ['skill-filesystem default roots off', count(/includeDefaultRoots:\s*false/gu) === 1],
  ['clock reading and reminder tools kept', presetText.includes('dsh-time-context') && presetText.includes('dsh-tool-schedule')],
]
let failed = false
for (const [label, passed] of checks) {
  console.log(`${passed ? 'ok' : 'FAILED'}: ${label}`)
  if (!passed) failed = true
}
if (failed) fail('see FAILED lines above; if the dump quotes names differently, adjust the patterns and keep the same eight checks')
console.log(`composition: ok (${home})`)
```

`air/scripts/make-demo-project.ts` creates the scratch project for the manual check:

```ts
/** Create a scratch project with a skill, a command, instructions, a rule, and a .mcp.json server (Windows and Linux). */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const demo = join(mkdtempSync(join(tmpdir(), 'air-demo-')), 'air-demo')

function put(relativePath: string, text: string): void {
  const target = join(demo, relativePath)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, text)
}

mkdirSync(demo, { recursive: true })
const init = spawnSync('git', ['init', '-q', demo], { encoding: 'utf8' })
if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
put('.claude/skills/hello/SKILL.md', '---\ndescription: Greet the user by name\n---\nSay hello to the person named in the request.\n')
put('.claude/commands/issue.md', 'Summarise issue $ARGUMENTS in one sentence.\n')
put('.claude/CLAUDE.md', 'Project memory: answer in British English. @notes.md\n')
put('.claude/notes.md', 'Imported note: the project is called Demo.\n')
put('.claude/rules/ts.md', '---\npaths: "**/*.ts"\n---\nTypeScript files use strict mode.\n')
put('.mcp.json', JSON.stringify({
  mcpServers: { demo: { command: process.execPath, args: [join(repoRoot, 'air', 'packages', 'mcp-conventions', 'tests', 'fixtures', 'echo-server.mjs')] } },
}, undefined, 2))
console.log(demo)
```

- [ ] **Step 9: Verify with a throwaway profile, then by hand**

Run: `pnpm -C air run check:composition`
Expected: eight lines starting `ok:`, then `composition: ok (<temp dir>)`, exit 0. A `FAILED:` line names the missing row.

Run: `pnpm -C air run smoke`
Expected: last line `smoke: ok (<temp dir>)`. The smoke boots under an isolated `DSH_HOME`, so a row that fails to load (for example a bad peer range: `disabling profile plugin row`) fails this step.

Then check behavior in the Web UI. The `air` profile already links `air/bundles/air` (see `air/README.md`). Create a scratch project and start the Web profile:

```sh
pnpm -C air run demo
pnpm dsh --profile air --no-open --port 3190
```

The first command prints the project directory. Open the URL the second command prints, start a session with that directory as its workspace, and confirm:

1. The `/` picker lists `hello` (skill), `issue` and `mcp` (commands), and none of the skills under `~/.agents/skills` or `~/.dsh/skills`.
2. `/mcp` prints `demo (stdio: ...echo-server.mjs): not approved`. `/mcp approve demo` prints `Approved and started "demo".`; `/mcp` then prints `running`. Approve before sending the first message.
3. `/issue 42` starts a turn whose user message is `Summarise issue 42 in one sentence.`
4. With the local model running (`ollama serve`, model `qwen3:8b`), send `What is this project called?`; the answer uses the imported note (`Demo`). The session's first request contains one `<air_instructions>` block (visible in the session event view as a user message with source `air-instructions`).
5. The approvals file exists: `node -e "const{join}=require('path');const p=join(process.env.DSH_HOME||join(require('os').homedir(),'.dsh'),'air','mcp-approvals.json');console.log(p,require('fs').existsSync(p))"` prints the path and `true`.

Stop the server with Ctrl-C. If a step cannot be checked because the local model is not installed, record which steps were checked in the commit message; steps 1, 2, 3, and 5 need no model response.

- [ ] **Step 10: Update `air/README.md`**

In the layout block, replace the line `  packages/<pkg>/         AIR plugins (added feature by feature)` with:

```
  packages/convention-core/          shared discovery library for the convention plugins
  packages/skill-conventions/        skill provider: .claude/skills, project skill roots, ~/.air/skills
  packages/instruction-conventions/  .claude/CLAUDE.md, @path imports, .claude/rules
  packages/mcp-conventions/          .mcp.json servers per Agent, with approval (/mcp)
  packages/command-conventions/      .claude/commands with $ARGUMENTS
```

Replace the whole `## Known issues` section with:

````markdown
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
````

(The fenced YAML block inside this section is part of the README text.)

- [ ] **Step 11: Confirm no upstream file changed, refresh the graph, commit**

Run: `git status --short -- . ':!air' ':!research'`
Expected: no output. `air/UPSTREAM-DELTA.md` needs no new row.

Run: `graphify update .`
Expected: exit 0 (the root `CLAUDE.md` asks for this after code changes; commit `graphify-out/` only if it is tracked: `git ls-files graphify-out` prints nothing when it is not).

```sh
git add air/package.json air/pnpm-lock.yaml air/scripts air/bundles/air air/README.md
git commit -m "feat(air): add the AIR agent preset and wire the file-convention plugins into the bundle"
```

---

## Deferred to later slices

These items are in the spec and deliberately outside this plan. Each is named in a README Known Limitations section.

| Item | Spec | Why not now |
|---|---|---|
| Agents from `.claude/agents/*.md`, permission rules, hooks, plugin manifests | spike 02 §2, §6, §7, §8 | later slices by the task brief (packages 6-9) |
| Claude Code mods bridge (`packages/experimental/claude-code-mods`, `docs/subsystems/claude-code-mods.md`) | upstream, new in `dsh-v0.2.1-alpha.1` | **Evaluated 2026-10-08: it does not affect slice 1.** The bridge runs Claude Code "mods" (function-hook plugins): it reads no skill, command, rule, `CLAUDE.md`, or `.mcp.json` file, so it replaces none of the five packages here. It matters only to the later hooks slice, where it is a separate, optional input: settings-file hooks are already served by the non-experimental `@deepseek-ai/dsh-hooks-claude-code` bridge, so AIR's hook plugin should build on that one, and decide on mods then. Facts to carry into that decision: the bridge is alpha and has a published difference list; mods run in the Host process with no sandbox and full process authority (`$.env`, `$.http.fetch`, `$.fs`); a `tool.call` hook cannot rewrite arguments; mods register commands and tools through the same registries, so `air-command-conventions` already skips a command file whose name a mod registered first |
| `allowed-tools` enforcement, `context: fork`, `agent`, `model`, `paths` on skills | spike 02 §1.2 | needs `@air/dsh-permission-rules` and the delegation tool |
| `@file` expansion and approved `` !`cmd` `` in commands | spike 02 §3.2 | `!cmd` is code execution from a repository file and needs the approval path designed in the permissions plan |
| `$ARGUMENTS` on the skill-invocation path (`/skill-name args`) and Claude Code's merge of commands into skills (a model-invocable command) | spike 02 §3.2 | depends on waterfall order against the preset-scoped `tool-skill` listener; needs a composition test |
| `.cursor/rules/*.mdc`, `.kiro/steering/*.md`, description-matched and manual rules | spike 02 §4.2 | slice 1 scope is `.claude/rules` with `paths:` |
| `~/.claude.json` and Claude Desktop MCP entries, `.mcpb`, UTF-16 `.mcp.json` | spike 02 §5.2, research §5.1 | project `.mcp.json` only |
| Approval before the first turn through a surface other than `/mcp` (a Web card, a CLI subcommand) | spike 02 §5 | no pre-session approval surface exists upstream; `/mcp approve` before the first message covers the case |
| Mock-LLM composition test over the shipped `web` profile | spike 02 §1.5 | the helper `production-profile.ts` is repository-internal; slice 1 verifies composition with the drift test, `check:composition`, and the plan-00 smoke boot |
| Reading through `ctx.fs` | spike 02 §1.1 | host filesystem only in slice 1 |

## Self-Review

**Spec coverage**

| Requirement | Task |
|---|---|
| AIR preset row `preset-air` from the current upstream `standard` list (with the clock and reminder rows kept), `agent-preset-registry` `default: air` | 9 |
| `skill-filesystem` `includeDefaultRoots: false` plus AIR skill provider in the preset layer | 3, 9 |
| `@air/dsh-convention-core`: project root, grouped file watching, frontmatter, tool-name table, Windows-safe path helpers | 1, 2 |
| Skill roots: project `.dsh/skills`, `.agents/skills`, `.claude/skills`, `~/.air/skills`; `~/.agents/skills` and `~/.claude/skills` opt-in through Config; command files are not skills | 3 |
| `~/.claude/CLAUDE.md`, `@path` imports (4 hops, real-path containment, allowlist outside the project, credential and size refusals), `.claude/rules` with `paths:` | 4, 5 |
| `.mcp.json` to per-Agent `mcp-client` children through `createScope` and `scope.ctx.plugin(...)`; consent file keyed by the definition as written; optional `mcpToolReview` wait (`reviewTools`) | 6, 7 |
| Commands with `$ARGUMENTS` through scoped `ctx.commands` and `agent.followup` with source `air-command` | 8 |
| Instructions companion with source `air-instructions`, composed once per turn | 5 |
| Bundle `dependencies` `workspace:*` and rows; verification with a throwaway profile (`check:composition`, smoke) and a demo project | 9 |
| Unit tests, native Loader test, README (Summary, Model Experience, Known Limitations), JSDoc per product-visible plugin | 3, 5, 7, 8 (and README for the library in 2) |
| Every command step and test runs on Windows and Linux | all |
| No new session event types; AIR state under `dshHomePath('air', ...)` | 5, 7, 8 |
| No upstream edits | 9 Step 11 |

**Placeholder scan:** every code step contains the full file content; every command has an expected result. The troubleshooting notes (Task 3 Step 9, Task 5 Step 5, Task 7 Step 5) name the exact upstream file or command to compare against.

**Type consistency:** `UserHomes`, `resolveUserHomes(config)`, `findProjectRoot(cwd, markers)`, `isInside(root, candidate, pathApi?)`, `toPosixRelative(root, candidate, pathApi?)`, `listMarkdownTree(root, maxDepth)`, `readTextFile(path)`, `fileSize(path)`, `realpathIfPresent(path)`, `parseFrontmatter(raw)`, `stringField`, `booleanField`, `stringListField`, `toKebabName`, and `PollWatcher.retain/pollOnce/close/groups` are defined in Tasks 1-2 and used with the same signatures in Tasks 3-8. `ServerSpec` (with `definition`), `canonicalJson`, `approvalKey(projectRoot, spec)`, and `ApprovalStore.has/add/remove` are defined in Task 6 and used in Task 7. Row ids and configs in Task 9 match the plugin names and Config fields of Tasks 3, 5, 7, 8 (`air-skill-conventions` has no config; `air-mcp-conventions` has no config until plan 02 sets `reviewTools: true`). The `stubAgent(ctx, cwd)` helper is repeated verbatim in three packages because test files do not cross package boundaries.

**Assumptions the executor should confirm at the first failing step, not before:** (1) `ctx.logger.warn(message)` and `ctx.logger.info(message)` are callable on a bare `Context` in unit tests (upstream plugins call them the same way); (2) the upstream MCP client accepts the fixture server's handshake; (3) the `--dump-config` output quotes row names in a way the patterns in `check-air-composition.ts` match; (4) a scoped child created with `createScope(ctx, agent)` sees a service provided on the host context (the `reviewTools` tests rely on it); (5) `ctx.provide('mcpToolReview', {})` is accepted by the untyped overload; (6) `Date.now()` and file modification times agree within the 50 ms slack the watcher uses on the machine that runs the tests. The `preset-air` YAML and the `customTags` handling of `!!js` were checked against the `dsh-v0.2.1-alpha.1` `standard` preset with `yaml` 2.9.0 while revising this plan: the two lists differ only by the declared changes.
