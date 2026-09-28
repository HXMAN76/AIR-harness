# 08 — Development and Contribution Guide for Building AIR on dsh

This note turns everything dsh says about developing, extending, and contributing into a working guide for the AIR features planned in [research.md](../research.md) sections 4, 5, and 7. It was written against the fork after its sync to the upstream release `dsh-v0.2.0-rc.1` (root `package.json` version `0.2.0-rc.1`). Repository paths are relative links from this file; online sources are full URLs. Upstream statements are cited to their owning file so they can be re-checked after the next sync.

Two repository gates scan every tracked or untracked, non-ignored file, including `research/`: `scripts/verify-concrete-terms.ts` rejects one banned origin-label word, and `scripts/verify-repository-references.ts` rejects commit identifiers and URLs under the upstream working organization's GitHub path. AIR notes, READMEs, and packages must follow both rules even when they live outside `packages/` ([verify-concrete-terms.ts](../../scripts/verify-concrete-terms.ts), [verify-repository-references.ts](../../scripts/verify-repository-references.ts)). This note therefore cites release tags instead of commits and names that organization without a URL.

## 1. Environment setup

### 1.1 Prerequisites

- **Node.js** `^22.19.0 || >=24.0.0` (root `package.json` `engines`); CI covers 22.19, 24, and 26 ([development.md](../../docs/development.md#prerequisites)). Fedora 44 ships a suitable Node 22 or 24.
- **pnpm through Corepack.** The repository pins `pnpm@11.7.0`; run `corepack enable` if `pnpm --version` does not resolve through Corepack.
- **Git 2.26+**, because hook setup enables worktree-specific configuration.
- **Optional keys.** `DEEPSEEK_API_KEY` (and optional `DEEPSEEK_BASE_URL`) in the environment or a gitignored root `.env` enables real-API e2e tests and the DeepSeek route. AIR's local-first default does not need it.

### 1.2 Install, build, and run from source

```sh
corepack enable
pnpm install            # also installs worktree-local Lefthook hooks
pnpm run typecheck      # setup is complete when this exits 0
pnpm run build          # tsc emits lib/types, tsdown bundles runtime, then the Web build
pnpm dsh web            # serve the Web UI on http://127.0.0.1:3080
```

`pnpm dsh` runs `node --import tsx/esm apps/cli/src/bin.ts`, so the launcher runs from source but profile boot still needs built Typert host artifacts and built client bundles. The launcher does not check freshness: stale bundles run older browser code until `pnpm run build` is repeated ([CLI reference, source execution](../../apps/cli/reference/README.md#source-execution)). If hooks are missing after a cached install, run `node scripts/install-lefthook.mjs` ([development.md](../../docs/development.md#first-time-setup)).

Other entry points ([apps/cli/README.md](../../apps/cli/README.md#entry-modes)):

```sh
pnpm dsh --profile headless "summarize this workspace"   # one-shot, prints final answer
pnpm run demo:ptc -- "summarize this workspace"          # headless with PTC mode
pnpm dsh --profile web --dump-config                     # composed tree, no boot
pnpm dsh --profile web --dump-config-schema              # JSON Schema of every row's Config
pnpm dsh web --patch ./my-overlay.cordis.yml             # add an overlay layer
```

For isolated AIR development, point the Harness home at a scratch directory so sessions, credentials, and profiles do not mix with your normal `~/.dsh`: `DSH_HOME=$PWD/.air-home pnpm dsh ...`. `DSH_*` variables must be exported, not placed in `.env` files; `.env` layers reject start-up variables such as `PATH`, `DSH_*`, and `XDG_*` ([app-boot README](../../packages/boot/app-boot/README.md#profiles)).

### 1.3 Web and Desktop development

```sh
pnpm run dev:web            # complete build, serve, and rebuild client bundles on edits
pnpm run dev:web --no-open --port 3081
pnpm run dev:web --skip-build
pnpm run dev:web --no-serve # only the rebuild watchers, beside a dsh started elsewhere
pnpm run start:web          # serve existing artifacts (same launch as pnpm dsh web)
pnpm run dev:desktop        # build, then launch Electron with an isolated dev home
pnpm run start:desktop
```

`dev:web` always boots the `web` profile. To work on a custom `air` profile with live client rebuilds, run `pnpm run dev:web --no-serve` in one terminal and `pnpm dsh --profile air` in another ([development.md, application commands](../../docs/development.md#application-commands); [CLI reference, Web profile](../../apps/cli/reference/README.md#web-profile)). For browser automation or GIF recording, the root [AGENTS.md](../../AGENTS.md) asks for `pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml` so the in-page directory picker replaces the native one.

Desktop development keeps its Harness state in `apps/desktop/.desktop-build/development/home` unless `DSH_HOME` is set, opens DevTools automatically, and listens for debuggers on ports 9229, 9222, and 9230 ([Desktop README](../../apps/desktop/README.md)).

### 1.4 Run with a local model (Ollama)

No official page documents Ollama. The documented mechanism is a hand-declared `dsh-llm-pi-ai` route with an explicit protocol and base URL ([providers.md, custom model API](../../docs/user/guide/providers.md#add-a-custom-model-api); [llm-pi-ai README](../../packages/llm/llm-pi-ai/README.md#configure-provider-routes)). The installed pi-ai catalog (`@earendil-works/pi-ai` 0.85.1) has no `ollama` provider, so the route must declare `api`, `baseURL`, and `models`. Two ways to create it:

1. **Web UI.** Settings → Models → Add model provider → Custom model API. Provider ID `ollama`, base URL `http://127.0.0.1:11434/v1`, protocol OpenAI Chat Completions, then "Fetch available models" (Ollama serves `GET /v1/models`) or enter ids by hand. The page writes the route into `$DSH_HOME/profiles/<profile>/cordis.patch.yml`.
2. **Patch file.** Add to the profile patch (or an AIR bundle patch, see section 2.4):

```yaml
- id: llm-pi-ai
  config:
    providers:
      ollama:
        displayName: Ollama (local)
        apiKeyEnv: OLLAMA_API_KEY        # any non-empty value; Ollama ignores it
        api: openai-completions
        baseURL: http://127.0.0.1:11434/v1
        compat:
          supportsDeveloperRole: false   # most local servers reject role "developer"
          maxTokensField: max_tokens
        models:
          - id: qwen3:8b
            contextWindow: 32768
            maxTokens: 8192

- id: agent-default-model
  config:
    provider: ollama
    model: qwen3:8b
```

Put `OLLAMA_API_KEY=ollama` in `$DSH_HOME/.env` or store it through the Models page. The source explains why a placeholder is safer than omitting `apiKeyEnv`: a named reference that resolves to nothing fails with `MISSING_CREDENTIAL`, while an omitted reference defers to pi-ai's ambient discovery, which is only defined for catalog providers ([llm-pi-ai/src/index.ts](../../packages/llm/llm-pi-ai/src/index.ts)). A resolved key must be non-blank and header-safe (`assertUsableApiKey` in [llm/src/index.ts](../../packages/llm/llm/src/index.ts)). If a proxy is set through `HTTP_PROXY`/`HTTPS_PROXY`, add `NO_PROXY=127.0.0.1,localhost` in `$DSH_HOME/.env`, the only `.env` layer that accepts proxy names ([app-boot README](../../packages/boot/app-boot/README.md#profiles); [network-proxy guide](../../docs/user/guide/network-proxy.md)). Reasoning levels and image input for hand-declared models need explicit `reasoningEfforts` and `input` ([providers.md](../../docs/user/guide/providers.md#reasoning-effort)); `vllmPriority` and `thinkingTokenBudgetField` exist for self-hosted vLLM servers.

Two cautions. First, a patch replaces a row's entire `config`, so a `llm-pi-ai` row in an AIR bundle is replaced wholesale as soon as the user saves any provider through the Models page, which writes the profile layer. Keep the default local route in the user's profile patch, or accept that the Models page owns the complete provider table. Second, `agent-default-model` in `dsh-base` defaults to `deepseek-official`/`deepseek-flash`; a saved Settings selection overrides the configured default at agent creation.

### 1.5 Platform caveats

- **Linux sandbox.** `sandbox-local` probes `bwrap` first, then Landlock; with neither usable it fails closed with `SANDBOX_UNAVAILABLE`, and Landlock may report `enforcement: 'partial'` on older kernel ABIs ([sandbox-local README](../../packages/sandbox/sandbox-local/README.md)). Fedora ships `bubblewrap`; confirm unprivileged user namespaces are enabled. `bwrap` hides host processes through a private PID namespace, so AIR OS-control commands that query other processes (for example `playerctl`, `wpctl`, D-Bus callers) behave differently under `workspace-write` than under `danger-full-access`.
- **Wayland.** No dsh document covers Wayland. The Linux Desktop directory picker falls back to browse mode without `zenity` or `kdialog`.
- **Desktop on Linux.** The Desktop README states that Linux is not a supported Desktop release target, and the tray in [apps/desktop/src/tray.ts](../../apps/desktop/src/tray.ts) is Windows-only ([Desktop README](../../apps/desktop/README.md)). AIR's Linux tray and hotkey (research.md 5.10) are new work, not a configuration change.
- **Host sandbox during development.** When a required `gh`, `pnpm`, build, test, or generator command fails because the agent's host sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry the same command with the narrowest host escalation, with evidence that the sandbox caused the failure; never bypass a real test failure or the product sandbox ([AGENTS.md, host sandbox failures](../../AGENTS.md#host-sandbox-failures)).
- **Windows/WSL.** Keep checkout, `node_modules`, and toolchain in one OS environment ([development.md](../../docs/development.md#windows-and-wsl-2)); `pnpm run check:windows-wine` exists only for diagnosing known Windows failures.

### 1.6 Which tests to run per change type

The upstream rule is "smallest check that would fail for the regression; CI owns the matrix" ([dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md); [testing.md](../../docs/testing.md)). Git hooks only lint staged files, check whitespace, guard vendored sources, and run `pnpm run typecheck` on push ([development.md, Git integrations](../../docs/development.md#git-integrations)).

| Change | Commands |
|---|---|
| Package or script behavior | `pnpm exec vitest run packages/<g>/<p>/tests/<x>.spec.ts --coverage --coverage.include='packages/<g>/<p>/src/**/*.ts'` (per-file 100% applies inside the selected scope) |
| Unsure which tests own a file | `pnpm exec vitest related <src file> --run --coverage --coverage.include=<src file>` |
| Product-visible plugin | the package's REAL-composition Loader test (`*.e2e.ts` using `runLoaderSmoke`) |
| Model-, CLI-, or UI-visible output | focused snapshot, e.g. `pnpm run test:snapshot snapshots/session/headless.snapshot.ts -t '<name>'`; re-record with `pnpm run test:snapshot:record` (needs key) |
| Web rendering | `pnpm run test:web` (Chromium; replay only in CI) |
| Profile/CLI process behavior | `pnpm run test:expected` |
| Docs, Agent Notes, catalogs | `pnpm run doc-sync`; `pnpm run test:docs` for quick checks |
| Package manifests, exports, build | `pnpm run build && pnpm run hygiene`, `pnpm run constraints` |
| Real provider behavior | `pnpm run test:e2e` (self-skips without keys) |
| New or changed persisted type | `pnpm --silent run verify-persistence-changes --json`, then the acknowledgement cookbook |

Pass Vitest filters directly after the script name; a standalone `--` reaches Vitest and can disable `-t` filtering.

## 2. The three extension paths

The earlier audit ([01-harness-audit.md](01-harness-audit.md) section 3.2) ranked three paths by weight. The official site states the design goal directly: developers "can select, swap, or extend any capability in configuration without changing the DeepSeek Harness source code" (https://www.deepseek.com/harness/en/).

### 2.1 Path 1: a skill file

`dsh-skill-filesystem` discovers skills in this order: project `.dsh/skills`, project `.agents/skills`, configured `customSkillDirs`, user `$DSH_HOME/skills` (`~/.dsh/skills`), user `$DSH_AGENTS_HOME/skills` (`~/.agents/skills`), then a bundled root ([skill-filesystem/src/index.ts](../../packages/skill/skill-filesystem/src/index.ts)). A skill is a directory `<name>/SKILL.md` or a flat `<name>.md` at the top of a root; nested `**/SKILL.md` files are not discovered. Frontmatter requires kebab-case `name` and `description`, with optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable` ([skill-filesystem README](../../packages/skill/skill-filesystem/README.md)).

```markdown
---
name: morning-briefing
description: Summarize today's calendar, unread mail counts, and weather when the user asks for a briefing.
---

1. Call the calendar tool for today's events.
2. ...
```

Save as `~/.agents/skills/morning-briefing/SKILL.md`. Roots are watched, so the skill reaches the next model step without restart. Invalid frontmatter is skipped with a host warning only; the model catalog does not report the failure. In the Web profile, skill discovery moves into agent presets (the base host `skill-filesystem` row is disabled by `dsh-web-app`), so a customized `skill-filesystem` configuration must be applied to the preset row, not the base row ([web-app cordis.patch.yml](../../packages/bundle/web-app/cordis.patch.yml)). `.claude/skills` is not a default root; this gap is what the AIR file-convention loader (research.md 5.1) closes.

### 2.2 Path 2: an MCP server row

`@deepseek-ai/dsh-mcp-client` runs one server per row and exposes its tools as `mcp__<serverName>__<tool>`. The CLI ships the package as a dependency, but no server is enabled by default because each command is trusted code outside the agent sandbox ([CLI reference, shared deployment behavior](../../apps/cli/reference/README.md#shared-deployment-behavior)). Minimal overlay, from [mcp-memory.md](../../docs/user/guide/mcp-memory.md#bring-another-mcp-server):

```yaml
- insert:
    - id: mcp-air-calendar
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: air-calendar          # [A-Za-z0-9_-]{1,32}, unique
        transport: stdio
        command: air-calendar-mcp
        args: []
        env: {}                           # added on top of a scrubbed environment
        cwd: !!js process.cwd()
```

Run once with `pnpm dsh web --patch "$PWD/air-calendar.cordis.yml"`, or merge the `insert` into `$DSH_HOME/profiles/<name>/cordis.patch.yml` (one profile) or `$DSH_HOME/cordis.patch.yml` (every profile). Do not overwrite an existing patch file, and never leave it empty or comments-only: an empty file fails boot, so write `[]` instead ([app-boot README](../../packages/boot/app-boot/README.md#profiles)). Remote servers use `transport: streamable-http`, `url`, and `headers`. The stdio bridge removes credential-looking and `DSH_*` variables before launch; pass secrets through `config.env`. Discovery is asynchronous, and a crashed child reconnects with backoff until the budget is spent. Creator mode can write and install such a configuration-only bundle from a prompt through `plugin_manager install_bundle` ([dynamic-cordis.md](../../docs/user/develop/practice/dynamic-cordis.md)). The pinned example overlays live in [apps/cli/config/examples/mcp-memory/](../../apps/cli/config/examples/mcp-memory/memorix.cordis.yml).

### 2.3 Path 3: an out-of-tree plugin bundle

This follows the official tutorial chain: [first plugin](../../docs/user/develop/basic/index.md) → [tool](../../docs/user/develop/basic/tool.md) → [config](../../docs/user/develop/basic/config.md) → [package and install](../../docs/user/develop/basic/publish.md), with the [Cordis tutorial](../../docs/cordis-tutorial/index.md) as a keyless background course.

**Step 1: plugin module.** A function plugin named-exports `name`, optional `inject`, `Config`, and `apply`, and has no default export; a service plugin default-exports its class. Mixing the forms makes the Loader drop the function plugin's namespace ([packages/AGENTS.md](../../packages/AGENTS.md); [postmortem 0001](../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'air-greet'
export const inject = ['tools']

export interface Config { greeting: string }
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
})

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: { name: { type: 'string', required: true, description: 'The name to greet' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) { return `${config.greeting}, ${args.name}!` },
  }))
}
```

`ctx.tools.register()` returns the disposer and is tracked by the plugin fiber, so HMR and unload remove the tool. Anything else that needs cleanup goes through `ctx.effect(() => { ...; return dispose })`.

**Step 2: try it as an overlay.** `index.md` inserts the module by absolute path and runs `pnpm dsh web --patch ./scratch-plugin/cordis.yml`. Under `pnpm dsh`, the tsx hook can load a `.ts` path; an installed `dsh` cannot, so installable packages ship built JavaScript.

**Step 3: package as a bundle.** The package declares `dsh.bundle.patch` and ships a patch whose rows name the package:

```json
{
  "name": "@air/dsh-air-greet",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib/index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": { "@deepseek-ai/schemastery": "^0.2.0-rc.1" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "scripts": { "build": "tsdown", "prepare": "tsdown" }
}
```

```yaml
- insert:
    - id: air-greet
      name: '@air/dsh-air-greet'
```

Declare dsh packages whose instances must be shared with the host under both `peerDependencies` and `devDependencies`; keep independent third-party libraries under `dependencies` ([publish.md](../../docs/user/develop/basic/publish.md#install-into-a-profile)). The version ranges above are placeholders: check each published package's actual version and range before copying them. Before import, dsh checks every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer range against the running runtime version, with prereleases participating in range matching; a mismatch denies the row unless the user grants an exact-version exemption in the profile's `compatibility.json` ([app-boot README](../../packages/boot/app-boot/README.md#profiles); [plugin-manager README](../../packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions)). This means AIR packages must widen or bump their dsh peer ranges at every upstream sync.

**Step 4: install into a profile.**

```sh
pnpm dsh plugin --profile demo add ./air-greet   # links the checkout, appends the bundle
pnpm dsh --profile demo --dump-config            # shows a "# == @air/dsh-air-greet" layer
pnpm dsh --profile demo
pnpm dsh plugin --profile demo remove @air/dsh-air-greet
```

`dsh plugin` forwards to pnpm inside `$DSH_HOME/profiles/<name>`; every successful run reconciles `dsh.profile.bundles` against installed packages that declare `dsh.bundle`. Bundle membership changes need a restart; edits to the profile or home patch hot-reload when `dsh-hmr` is enabled ([CLI reference, plugin management](../../apps/cli/reference/README.md#plugin-management)). Git installs (`github:you/pkg#<commit>`) fetch sources, so the author ships a self-contained `prepare` build and the user adds the printed key to the profile's `pnpm-workspace.yaml` `allowBuilds`; that allowance executes the package's code at install time outside any sandbox. Publishing to npm or shipping a `pnpm pack` tarball avoids the allowance ([publish.md](../../docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)). Upstream asks community plugins to use the `dsh-plugin` GitHub topic ([CONTRIBUTING.md](../../CONTRIBUTING.md)).

### 2.4 An `air` product profile and bundle

**Layer order.** The effective tree is composed over an empty root: each bundle in `dsh.profile.bundles` order, then the profile's `cordis.patch.yml`, then `$DSH_HOME/cordis.patch.yml`, then each `--patch` in argv order. Later layers win per row; a patch replaces a row's whole `config` and may insert rows ([architecture.md](../../docs/architecture.md#profiles-and-bundles); [CLI reference](../../apps/cli/reference/README.md#profile-boot)). An AIR bundle appended after `dsh-base` and `dsh-web-app` can therefore override any upstream row by `id` without editing upstream YAML.

**Create the profile.**

```sh
pnpm dsh --profile air --from-default-profile web      # copies base + web-app bundle list
pnpm dsh plugin --profile air add ./air/bundles/air    # appends the AIR bundle
pnpm dsh --profile air --dump-config                   # inspect before booting
pnpm dsh --profile air --no-open                       # app flags follow launcher flags
```

`--from-default-profile` copies the template's bundle list into a new manifest with empty dependencies and an empty user patch; it records no inheritance, so later template changes do not propagate ([CLI reference](../../apps/cli/reference/README.md#profile-boot)). `desktop` is reserved for Electron and cannot be managed from the CLI.

**The AIR bundle patch.** Row ids come from [bundle/base/cordis.patch.yml](../../packages/bundle/base/cordis.patch.yml) and [bundle/web-app/cordis.patch.yml](../../packages/bundle/web-app/cordis.patch.yml):

```yaml
# @air/dsh-air-bundle: local-first defaults over dsh-base and dsh-web-app.

# DeepSeek-coupled rows. `disabled` is row metadata and may be a boolean or a
# !!js expression; a patch can always set it even where a Config field cannot.
- id: session-log-deepseek            # uploads unaccepted log suffixes with DeepSeek requests
  disabled: true
- id: plugin-package-inventory-deepseek
  disabled: true
- id: session-telemetry-otel          # feedback-gated OTel export to the DeepSeek collector
  disabled: true
- id: deepseek-account
  disabled: true
- id: web-search-deepseek             # needs DEEPSEEK_API_KEY; replace with a self-hosted provider later
  disabled: true

# Local default model (the route itself lives in llm-pi-ai; see section 1.4).
- id: agent-default-model
  config:
    provider: ollama
    model: qwen3:8b

# AIR capabilities.
- insert:
    - id: air-file-conventions
      name: '@air/dsh-file-conventions'
    - id: air-memory
      name: '@air/dsh-memory'
      config:
        root: !!js dshHomePath('air', 'memory')
```

Desktop product telemetry and client product analytics in `dsh-web-app` are already disabled unless the profile is named `desktop`, so they are off for `air`. `DSH_TELEMETRY_DISABLED` (any non-empty value) and `DSH_TELEMETRY_MODE=DISABLED` are process-level alternatives ([CLI reference, shared deployment behavior](../../apps/cli/reference/README.md#shared-deployment-behavior)). Disabling a row that another row injects as a required service leaves that row pending; the startup report under `$DSH_HOME/logs/startup-*.log` names failed and pending plugins and missing services ([CLI reference, startup diagnostics](../../apps/cli/reference/README.md#startup-diagnostics)). Verify each disabled row with `--dump-config` and one boot, and add the check to the bundle's own test (the [schedule-bundle patch test](../../packages/experimental/schedule-bundle/tests/patch.spec.ts) parses its patch with `entryListSchema`; copy that shape). `dshHomePath(...)` is the helper that base uses inside `!!js` for home-relative paths.

**Overlays, `--patch`, and `!!js`.** `@deepseek-ai/cordis-plugin-include` parses `!!js` scalars into expressions. The Loader evaluates an entry's `config` after that entry's declared `inject` services activate, against the plugin context, and evaluates `disabled` at each mount decision against the Loader context; other metadata stays literal, so conditional plugin selection belongs in overlays ([cordis-primer.md](../../docs/cordis-primer.md#loader-configuration)). The root AGENTS.md adds the spelling rule: `!!js`, never `!js`. Common idioms from base are `disabled: !!js process.platform === 'win32'`, `disabled: !!js "!ctx.get('profileContext')"`, `root: !!js dshHomePath('sessions')`, and `cwd: !!js process.cwd()`. A row that reads app arguments injects the startup service and keeps a fallback, as in `port: !!js ctx.webStartup.port ?? 3080`; a user patch that replaces that `config` with literals removes the runtime read ([CLI reference, app arguments](../../apps/cli/reference/README.md#app-arguments)). A bundle can give itself a command line by mounting a provider that injects `cmdlineArgs` and calls `parseCmdline` from `dsh-cmdline` ([publish.md](../../docs/user/develop/basic/publish.md#give-a-surface-bundle-its-own-command-line)).

**HMR.** Whether configuration hot-reloads is decided by the YAML: base enables config-only `dsh-hmr` (when a profile context exists); headless, SDK, and ACP disable it. An enabled `dsh-hmr` watches the profile manifest and both patch files and reapplies valid edits transactionally; configuration edits hot-replace the plugin, which is why every registration must be an effect ([config.md](../../docs/user/develop/basic/config.md#work-with-hmr); [app-boot README](../../packages/boot/app-boot/README.md#profiles)).

**Optional bundles in the Plugins page.** The installation ships four optional bundles (`agent-team-profile`, `voice-input-bundle`, `auto-review`, `schedule-bundle`) that the Web Plugins page offers switched off. They are listed in `OPTIONAL_BUNDLES` in [app-boot/src/profile.ts](../../packages/boot/app-boot/src/profile.ts) and must declare `dsh.bundle.patch`, an `icon`, and `./locale/*.json` metadata. Out-of-tree AIR bundles cannot join that list without editing upstream source; they install through `dsh plugin` or the Plugin Manager install view instead.

## 3. In-tree contribution rules

### 3.1 Policy context

Upstream's [CONTRIBUTING.md](../../CONTRIBUTING.md) states that the project cannot accept external pull requests at present and invites plugins, bug reports in GitHub Discussions, and ecosystem work instead. "Upstreamable" in the audit therefore means "written to upstream's standard so it could be proposed through Discussions or adopted later, and so it merges cleanly", not "expected to be merged". The consequence for AIR is stronger than the audit's: every in-tree change is permanent fork surface. Prefer extension points and out-of-tree packages even where an in-tree edit looks small.

### 3.2 The rules a feature must satisfy

These come from the root [AGENTS.md](../../AGENTS.md#conventions), [packages/AGENTS.md](../../packages/AGENTS.md), [testing.md](../../docs/testing.md), [docs/AGENTS.md](../../docs/AGENTS.md), and the [dsh-code-review](../../.agents/skills/dsh-code-review/SKILL.md) blocking list.

- **Capability seam roles.** A swappable capability has a Service Definition, one or more Service Providers, and Consumers (commonly a tool). A package may combine roles, but one role alone is not a seam; split packages only when the roles evolve independently ([glossary](../../docs/glossary.md#capability-seam); [practice/index.md](../../docs/user/develop/practice/index.md); [capability-seams.md](../../docs/capability-seams.md)). The Definition owns request and result types; Provider and Consumer never depend on each other. Name the role that exists, using the naming table in [adding-a-package.md](../../docs/cookbook/adding-a-package.md#name-the-role-that-exists) (`Registry`, `Store`, `Runtime`, `Policy`, `Provider`, and so on); singular `ctx` keys for one engine or policy, plural for registries.
- **Registrations are effects.** Every contribution goes through `ctx.effect()` or `ctx.on()`, and a registry's `register()` returns its disposer. Every registry needs an HMR-safety test: dispose the contributing fiber and observe removal.
- **Optional services use `ctx.get(name)`**; `ctx.<name>` is reserved for declared injections.
- **Branded ids.** Opaque cross-boundary ids use `Branded<B>` from `dsh-brand` (for example `SpeechProviderId = Branded<'SpeechProviderId'>` in [speech-to-text/src/types.ts](../../packages/experimental/speech-to-text/src/types.ts)).
- **Config, not constants.** Any value two deployments may set differently is a validated Schemastery `Config` field changeable from `cordis.yml`; a `DEFAULT_*` constant or test hook does not count. Protocol constants, external specs, and security invariants stay fixed.
- **Fail loud.** Self-contained misconfiguration fails at load (time-context throws on an invalid IANA zone; SenseVoice throws on a non-absolute path); otherwise fail at the earliest resolvable point, never silently skip a missing referent.
- **Explicit defaulting.** Defaults are resolved in an explicit `resolve(request): Spec` step, never a hidden `?? default` inside `run()`; `dsh-shell` is the template.
- **Trust TypeScript inside the process.** Validate at parser, config, model or tool JSON, durable file, worker, process, and wire boundaries only.
- **Waterfalls call `next()`.** A listener that returns without `next()` short-circuits the chain; that is correct only for a policy that owns the decision ([cordis-primer.md](../../docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Plugins, not loop changes.** New behavior attaches to an extension point in [architecture.md, where new behavior goes](../../docs/architecture.md#where-new-behavior-goes); changing `agent-loop` requires updating architecture.md.
- **Model-visible ⟺ logged.** Anything that reaches a model request must be reconstructable from the session log, and a runtime invariant checks it. A new model-visible input needs a session event. `SessionEventMap` members are extended by declaration merging and are required-on-read unless the envelope carries `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION`. The accepted baseline is format V4 ([session-format-status.md](../../docs/session-format-status.md#finalization-record)); backward-compatible persisted-type changes need an acknowledgement record ([reviewing-persistence-type-changes.md](../../docs/cookbook/reviewing-persistence-type-changes.md)).
- **Typed events.** Event JSDoc carries `@mode` (emit, waterfall, parallel, serial, bail) and payload `@param`; closed unions end in `assertNever`.
- **Enforcement lives in the operation.** Schema omission, prompt text, facades, and listener order are not enforcement when another caller can bypass them; test denial through the executor. Use `tools/pre-execute` for reorderable allow/deny/ask, `ctx.tools.guard()` for a monotonic final deny, `tools/execute` to wrap dispatch, `tools/post-execute` to transform, `tools/result` to observe ([adding-a-tool.md](../../docs/cookbook/adding-a-tool.md#execution-policy-and-observation)).
- **Publish state only at its commit point**, and apply byte, token, item, and time bounds to the complete emitted value.
- **Tool design.** Return one canonical JSON value from `execute`, render model text in `output.render`, keep UI data in `presentationMeta`, keep presenters pure, honor `exec.signal`, and gate background work through `ctx.jobs.start()` ([adding-a-tool.md](../../docs/cookbook/adding-a-tool.md)). Write tool text from the model's perspective and measure first-turn prompt tokens before and after ([agent-experience skill](../../.agents/skills/agent-experience/SKILL.md)).
- **Package layout.** `packages/<group>/<pkg>/` with `package.json` (private, root version, ESM, `lib/` exports, `@deepseek-ai/cordis` as peer and dev dependency), `tsconfig.json` registered in exactly one of `tsconfig.host.json` or `tsconfig.client.json`, `src/types.ts` types only, tests under `tests/`, optional `locale/en.json` and `locale/zh.json` display metadata ([adding-a-package.md](../../docs/cookbook/adding-a-package.md)).
- **README template.** YAML frontmatter with a `kind`, Summary, Table of Contents, user section, implementation section, Further Exploration, `## Model Experience` (per entry: What the model sees, Token effect, KV Cache effect, verbatim stable prompt text in an H5 plus fence), `## Known Limitations and Deferred Work` (or an allowlist entry), then Dev Note ([adding-a-package.md, section 4](../../docs/cookbook/adding-a-package.md#4-write-the-package-readme)). `time-context` is a compact reference.
- **Bilingual docs.** Every maintained doc has a `.zh.md` counterpart and an `.i18n.yaml` pairing record updated in the same change (`verify-translation-pairing`), with line-aligned structure ([docs/AGENTS.md](../../docs/AGENTS.md)). One physical line per paragraph (`verify-md-wrap`), compiling `ts` fences (`doc-typecheck`), word budgets for standing docs, and current-state prose.
- **JSDoc gates.** Every module and export has JSDoc for its non-obvious contract; function-like exports need `@param` and `@returns` (`verify-export-jsdoc`); remaining `any` explains why.
- **Coverage and tests.** Per-file 100% line coverage on `packages/*/*/src` (`pnpm run test:coverage`); a non-unit REAL-composition test for every product-visible plugin (boot a test-only `cordis.yml` through the Loader, mock only external or nondeterministic inputs, assert model-visible, durable, or user-visible output); specs own every port, path, and child process because they run concurrently.
- **Invariants.** Publish `./invariant` only when independent observations of an owned relationship can diverge; otherwise omit it and record why in the README. Empty installers and presence checks fail `verify-package-invariants`.
- **Snapshots and SDK projections.** Every non-trivial model-, protocol-, or human-visible change adds or updates a keyless recorded-session scenario under `snapshots/`. Agent-loop, session-lifecycle, and `SessionEventMap` changes update both `snapshots/sdk/` (TypeScript) and `scripts/snapshots/python-sdk-single-exe/` (Python) ([testing.md](../../docs/testing.md#when-a-snapshot-test-is-required)).
- **Client UI.** Product copy goes through typed locale dictionaries and `t` (`verify-client-ui-i18n`); reuse tokens and primitives; font weight at most 500; toasts held by a host that outlives the reporting surface ([dsh-client-ui-ux](../../.agents/skills/dsh-client-ui-ux/SKILL.md)).
- **Experimental packages.** Use the `@deepseek-ai/dsh-experimental-*` prefix; release packages must not depend on them; experimental status relaxes no requirement ([experimental AGENTS.md](../../packages/experimental/AGENTS.md)).
- **PRs and history.** One `kind/*` label (`feature`, `bug-fix`, `doc`, `testing`, `cleanup`, `dependency`) and every material `area/*` label; rewrites use `--force-with-lease=<branch>:<oid>`, never raw `--force`.
- **Agent Notes** only for lasting decision rationale that code and docs do not explain; mechanical and local UI changes are exempt; archived notes are frozen ([.agents/notes/README.md](../../.agents/notes/README.md#when-to-write-one)).
- **Prose.** Concrete terms, no metaphors, `contract` only for real obligations, no reasoning transcripts ([dsh-prose-standard](../../.agents/skills/dsh-prose-standard/SKILL.md)).

### 3.3 Checklist

1. Extension point identified in architecture.md; no agent-loop edit, or architecture.md updated.
2. Seam roles decided; packages named by role; `ctx` key singular or plural as appropriate.
3. Function plugin exports are named only, or a service class is the default export.
4. Every registration is an effect; HMR-safety test disposes the fiber and observes removal.
5. All tunables are validated `Config` fields; misconfiguration throws at load.
6. Cross-boundary ids are branded.
7. Model-visible inputs are logged; new events declared on `SessionEventMap`, marked `ignorable: true` when informational, persisted-type change acknowledged.
8. Unit tests at 100% per-file coverage; REAL-composition Loader test; snapshot scenario for model-visible output; both SDK expected outputs when loop or lifecycle changes.
9. Invariant companion justified or omitted with a README reason.
10. README with Model Experience and Known Limitations; `.zh.md` pair and `.i18n.yaml` record; JSDoc complete.
11. Client copy in locale dictionaries.
12. `pnpm run doc-sync`, `constraints`, `typecheck`, `lint`, focused tests, `build` and `hygiene` when manifests change.
13. One `kind/*` and the right `area/*` labels; Agent Note only for durable rationale.

## 4. Per-feature templates to copy

Common layout of the templates below: `package.json`, `tsconfig.json`, often `tsdown.config.ts` (tsdown bundles `lib/types/*.js` into `lib/`), `src/index.ts`, optional `src/types.ts` and `src/invariant.ts`, `tests/*.spec.ts`, and `tests/*.e2e.ts` with `tests/fixtures/*.patch.yml`. The REAL-composition pattern is [time-context.e2e.ts](../../packages/context/time-context/tests/time-context.e2e.ts): it calls `runLoaderSmoke` from `dsh-loader-smoke` with a fixture patch over the shipped headless profile ([time-context.patch.yml](../../packages/context/time-context/tests/fixtures/time-context.patch.yml)) that disables `headless-startup` and `headless-runner`, points `agent-loop` at a mock LLM row, writes sessions to `./.sessions` uncompressed, inserts the plugin, and then asserts on the JSONL session log.

| AIR feature | Closest package(s) | Key files | What to reuse | Pitfalls |
|---|---|---|---|---|
| File-convention loader: skills, `.claude/commands` | [skill-filesystem](../../packages/skill/skill-filesystem/README.md), [skill](../../packages/skill/skill/README.md), [commands](../../packages/interaction/commands/README.md) | `skill-filesystem/src/index.ts` (`roots()`, frontmatter parse, `SkillWatchManager`) | Register a second provider on `ctx.skills` with its own `providerName` for `.claude/skills` and commands-as-skills; Chokidar watch config fields; project-root discovery through `ctx.fs` | Nested `SKILL.md` is deliberately not discovered; invalid files only warn; in Web the provider must be mounted inside presets, not the host plane |
| Loader: hooks | [hooks-claude-code](../../packages/hooks/hooks-claude-code/README.md), [hook-protocol](../../packages/hooks/hook-protocol/README.md) | `src/config.ts` (7 `CLAUDE_EVENTS`, `substituteCommand`), `src/index.ts` (`ctx.on('agent/created'|'agent/pre-step'|'tools/pre-execute'|'tools/post-execute'|'agent/turn-stopping')`) | Matcher-group parsing, `${CLAUDE_PROJECT_DIR}` handling, `hook/result` logging with capped stderr | `configPath` is process-level, read once (a TODO notes per-session discovery); only command hooks run; extending events means editing or forking this package |
| Loader: `.claude/agents` | [subagent](../../packages/subagent/subagent/README.md), [agent-preset-registry](../../packages/preset/agent-preset-registry/README.md) | web-app `presets/*.patch.yml` | Compile an agent file into a preset declaration or a subagent provider configuration | Presets are Loader rows with `isolate` realms; services a row outside the realm reads must stay host-plane |
| Loader: `.mcp.json` | [mcp-client](../../packages/mcp/mcp-client/README.md) | `src/index.ts` (`StdioConfig`, `StreamableHttpConfig`) | Generate one mcp-client row per server, or mount mcp-client instances from a loader plugin with `ctx.plugin` inside an effect | `serverName` must match `[A-Za-z0-9_-]{1,32}` and be unique; project `.mcp.json` is untrusted executable config and needs approval before launch |
| MCP surface pinning (`mcp-trust`) | mcp-client | `src/tools.ts` `syncTools` (phase 1 builds definitions from `listTools`, phase 2 swaps registrations), `src/connection.ts` (serialized re-syncs) | Hash definitions in phase 1; withhold or quarantine before phase 2; call-time check via `ctx.tools.guard()` | No hook exists between phase 1 and phase 2, so registration-time withholding needs either a forked client package or a small upstream extension point; a guard-only design still shows drifted descriptions to the model |
| Permissions and rule store | [user-approval](../../packages/interaction/user-approval/README.md), [permission-presets](../../packages/interaction/permission-presets/README.md), extension-cookbook permission gate | `ApprovalService` (`ctx.approval`, `policy: ask|never`), `ApprovalOutcome` closed union, `PermissionPresetService` preset table | Add rules as a `tools/pre-execute` listener that returns allow/deny/ask; answerers via the approval waterfall; presets as Config | `ApprovalOutcome` is closed (`allowed-once`, `rejected`, `cancelled`, `unavailable`), so "allow always" belongs in a separate store; `custom` and `auto` preset names are reserved |
| Long-term memory index | [session-query-sqlite](../../packages/session-query/session-query-sqlite/README.md), [storage-sqlite](../../packages/storage/storage-sqlite/README.md) | `schema.ts` (`SESSION_QUERY_SQLITE_SCHEMA_VERSION`, derived-schema reset on mismatch), `query.ts` (FTS5 phrase quoting, predicate budget), `node:sqlite` `DatabaseSync` | Rebuildable derived index with `PRAGMA user_version`; owner-only file modes; single process owner per path; `openAt` choice | Markdown stays the source of truth; memory recall text must reach the model as a logged message, not an ignorable event |
| Desktop context | [time-context](../../packages/context/time-context/README.md), [tmux-context](../../packages/context/tmux-context/README.md) | `time-context/src/index.ts`: `MessageSourceMap` merge, `ctx.sessionProjections.register({key, stateVersion, stateSchema, init, apply})`, prepended `agent/pre-step` waterfall appending a `createUserMessage` with `source: {kind, form: 'snapshot', sections}` | Change-only injection throttled by a projection; source-attributed durable readings; failed queries add nothing | Call `next()` first and return its decision; respect `signal.aborted`; a per-step reading costs tokens and breaks nothing in the KV prefix only because it is appended |
| Voice (STT providers, TTS seam) | [speech-to-text](../../packages/experimental/speech-to-text/README.md), [speech-to-text-sensevoice](../../packages/experimental/speech-to-text-sensevoice/README.md), [voice-input-bundle](../../packages/experimental/voice-input-bundle/README.md), [api-speech-to-text](../../packages/experimental/api-speech-to-text/README.md), [client-ui-voice-input](../../packages/experimental/client-ui-voice-input/README.md) | Definition: `SpeechToText extends Service`, `register(provider)` returning an async disposer, `Volatile` config with `loader/volatile-update`. Provider: `inject = ['speechToText','subprocess']`, registration inside `ctx.effect`, worker process, no downloads at activation | Copy the provider shape for Parakeet or faster-whisper; copy the Definition shape for a `textToSpeech` service; bundle rows like `voice-input-bundle/cordis.patch.yml` | The Remote accepts complete recordings only; streaming needs new Definition methods; experimental packages must stay out of release dependencies |
| Routines and triggers | [schedule](../../packages/schedule/schedule/README.md), [schedule-bundle](../../packages/experimental/schedule-bundle/README.md), [webhook](../../packages/webhook/webhook/README.md) | `schedule/src/index.ts`: `ctx.effect` init, per-agent tool attachment on `agent/created`/`agent/disposed`, `workspace/session-activity` waterfall; `schedule-bundle` patch plus `tests/patch.spec.ts` | Deliver via follow-up into the original session; storage-backed task store with delivery history; a patch-only bundle for enabling | Scheduling stops when the Host stops; delivery is not exactly-once; session restore relies on the running Host |
| Modes (Assistant, Coder, Researcher) | [agent-preset-registry](../../packages/preset/agent-preset-registry/README.md), web-app presets | [presets/minimal.patch.yml](../../packages/bundle/web-app/presets/minimal.patch.yml) | Insert `@deepseek-ai/dsh-agent-preset` rows with `id`, `order`, `plugins` (persona, tool groups) | Web editor saves override `config.plugins` by id from the profile patch; failed definitions stay visible rather than failing boot |
| AIR plugin settings UI | [config-editor](../../packages/boot/config-editor/README.md), [adding-a-settings-card.md](../../docs/cookbook/adding-a-settings-card.md) | config-editor writes validated candidates to the active profile patch | Expose AIR Config fields for live editing instead of a bespoke settings store | Higher-layer overrides (home patch, `--patch`) leave the file unchanged; Client packages need their own tsconfig face and i18n |
| Install flow, curated index | [plugin-manager](../../packages/boot/plugin-manager/README.md) | `src/operations.ts`, `src/install-spec.ts`, `src/build-approval.ts`, `src/tools.ts` | Transactional pnpm operations under the profile write lock; version-exemption records; agent-facing `plugin_manager` tool | Install view reads npm registry metadata, not locale metadata; git builds need explicit allowance |
| Secret handoff | user-approval (answerer model), [defensive-patterns.md](../../docs/defensive-patterns.md) | approval waterfall | A separate service beside `ctx.approval` for a secret prompt | The secret must never enter a session event; untrusted output must not receive the ambient environment or predictable paths |

README template: every template above uses the same skeleton; copy [time-context/README.md](../../packages/context/time-context/README.md) (frontmatter `kind: "package-reference"`, Summary, Use this package, Understand the implementation, Further Exploration, Model Experience with H5 verbatim blocks, Known Limitations, Dev Note). Patch-only bundles copy [schedule-bundle](../../packages/experimental/schedule-bundle/package.json): an empty `src/index.ts` (`export {}`), `icon.svg`, `locale/*.json`, `cordis.patch.yml`, and every inserted row's package in `dependencies` so rows resolve from the bundle.

### 4.1 Out-of-tree session events

A detail the audit did not record affects every AIR feature that logs something. `KNOWN_SESSION_EVENT_TYPES` in [core/session/src/known-event-types.ts](../../packages/core/session/src/known-event-types.ts) is generated from `SessionEventMap` declarations found in this repository, and the persistence read path refuses a log containing a type outside that set unless the event carries `ignorable: true`. Out-of-repo plugin events are outside the set by construction. An AIR package that appends a required event such as `mcp/drift` would therefore make its own sessions unreadable, including by the AIR build. The rules that follow:

- Mark every AIR-defined event `ignorable: true` and keep it informational (audit records such as pin verdicts, hook decisions, trigger firings).
- Carry anything model-visible through existing events: an `agent.inject()` or pre-step `user/message` with a source kind declared by merging `MessageSourceMap` (time-context), or a `plugin` source kind. Memory recall, desktop readings, and voice transcripts fall here.
- If an AIR event must become required, it has to be declared in-tree so the generator includes it, which is an upstream format change.

## 5. Repository layout and branching for AIR

### 5.1 How the workspace and gates treat locations

- `pnpm-workspace.yaml` includes `vendor/*`, `packages/*/*`, `native/system` and its packages, `apps/*`, `benchmarks`, `website`, and `python/sdk-runtime`. Anything under `packages/<group>/<pkg>` joins the workspace.
- `scripts/check-workspace-constraints.ts` reads every member declared by `pnpm-workspace.yaml`, so a workspace member must meet the in-tree manifest rules (private, root version, `lib/` exports, peers).
- Vitest runs `packages/*/*/tests/**/*.spec.{ts,tsx}`, `apps/*/tests`, `scripts/**/*.spec.ts`, and `website/tests`; coverage is measured on `packages/*/*/src` ([vitest.config.ts](../../vitest.config.ts)).
- `verify-md-links` scans root READMEs, `docs/`, `.agents/`, and `packages/` Markdown; `verify-concrete-terms` and `verify-repository-references` scan all tracked and (for the latter) untracked non-ignored files.
- Typecheck covers only projects referenced by `tsconfig.host.json` or `tsconfig.client.json`.

### 5.2 Recommended layout

```
AIR-harness/
  packages/ ...            upstream, untouched
  air/                     AIR-owned, outside the upstream workspace globs
    pnpm-workspace.yaml    separate workspace: packages/*, bundles/*
    package.json           private root with its own scripts (build, test, lint)
    tsconfig.base.json     own compiler settings
    vitest.config.ts       own tests and coverage thresholds
    packages/<pkg>/        @air/dsh-<pkg> plugins (src, tests, README.md)
    bundles/air/           @air/dsh-air-bundle: package.json + cordis.patch.yml
    skills/                example skills shipped with AIR
    examples/              opt-in overlays (calendar MCP, bluetooth MCP)
  research/                notes (subject to the two repo-wide text gates)
```

Rationale: a directory outside `packages/*/*` keeps the upstream workspace, constraints, coverage, and bilingual-doc gates from applying to AIR code, while one small nested workspace gives AIR its own build and tests. pnpm uses the nearest `pnpm-workspace.yaml`, so commands run inside `air/` operate on the AIR workspace only. Two ways to resolve `@deepseek-ai/*` imports from AIR packages:

1. **Published packages (recommended for the release path).** Depend on the published `@deepseek-ai/dsh-*` versions matching the fork's release tag as peer and dev dependencies. Types and runtime then match what users install with `npx @deepseek-ai/dsh`.
2. **Local link (for development against unreleased fork changes).** Use `link:../../packages/<group>/<pkg>` dev dependencies after `pnpm run build` at the root, because upstream package exports point at built `lib/`.

At runtime, packages installed with `dsh plugin --profile air add ./air/bundles/air` are linked into the profile; the source launch selects linked profile resolution so profile plugins share the installation's Cordis instance ([CLI reference, source execution](../../apps/cli/reference/README.md#source-execution); [publish.md](../../docs/user/develop/basic/publish.md#install-into-a-profile)). Put the AIR bundle's plugin packages in its `dependencies` so rows resolve from the bundle, as schedule-bundle does.

Keep AIR's own quality bar explicit in `air/README.md`: the audit's recommendation to keep 100% coverage, the README template, and REAL-composition tests while dropping Chinese pairing still fits. Keep AIR packages ESM and free of CJS-only exports, because the `pnpm dsh` launch uses tsx's ESM-only hook.

A separate repository for `air/` is the alternative if the fork should track upstream byte-for-byte; the in-fork directory is simpler for a final-year project because one checkout builds both.

### 5.3 Where in-tree edits are unavoidable

Keep a list in `air/UPSTREAM-DELTA.md` of every file changed outside `air/` and `research/`, with the reason. Candidates from research.md: an MCP definition-review hook between `syncTools` phases, streaming methods on the speech-to-text Definition, Linux tray and hotkey files in `apps/desktop/src/`, and additional events in `hooks-claude-code`. Write each as new files where possible, and follow section 3 so the change can be offered upstream through Discussions.

### 5.4 Branching and upstream merges

1. `git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git && git fetch upstream --tags` (the fork currently has only `origin`).
2. Keep `master` as a clean mirror of upstream; fast-forward it to release tags (`dsh-v0.2.0-rc.1` now).
3. Do AIR work on `air/main`, merging `master` at each upstream release tag rather than on every upstream commit; release tags carry published Session-format obligations and give stable peer versions for AIR packages.
4. After each merge: `pnpm install`, `pnpm run build`, bump AIR peer ranges, run `pnpm dsh --profile air --dump-config` and look for "unmatched patch target" warnings on stderr (renamed upstream row ids silently stop AIR overrides), boot once, then run AIR tests.
5. Feature branches off `air/main`; rewrite only with `--force-with-lease`.
6. Check the local profile manifest after syncs. The existing `~/.dsh/profiles/web/package.json` on this machine carries `"patchReload": "live"`, which no current source file reads; HMR is now controlled by the YAML composition. Recreate stale profiles rather than editing them by hand.

## 6. Gaps and contradictions

1. **External contributions.** [CONTRIBUTING.md](../../CONTRIBUTING.md) does not accept external pull requests, while the audit and research.md plan "upstreamable PRs". Treat in-tree changes as permanent fork surface.
2. **Relative versus absolute overlay paths.** [basic/index.md](../../docs/user/develop/basic/index.md) says an inserted plugin path in a `--patch` file must be absolute because a patch does not change the profile directory used for resolution, yet [basic/config.md](../../docs/user/develop/basic/config.md) shows `name: './src/my-plugin.ts'` in the same file, and the CLI reference says relative names in inserted rows resolve beside their patch file for `--dump-config`. Use absolute paths in overlays and package names in bundles until this is tested.
3. **No local-model guide.** Neither the repo nor the website documents Ollama or keyless hand-declared routes; [providers.md](../../docs/user/guide/providers.md) covers gateways only. The behavior of a hand-declared route without `apiKeyEnv` is not documented.
4. **"SDK" wording.** The website's page metadata describes the project in Chinese as a plugin-based SDK for building agent harnesses (https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart), while [adding-a-package.md](../../docs/cookbook/adding-a-package.md#name-the-role-that-exists) says DeepSeek Harness is an agent harness, not an SDK project.
5. **Online docs coverage.** The official site (https://deepseek-harness.github.io/deepseek-harness/en/) projects `docs/user/` (Guide, Development, Cordis tutorial) and a Reference section with the primer, seams, catalogs, cookbooks, and subsystems. Contributor docs (`development.md`, `testing.md`, `defensive-patterns.md`, the session-format cookbook) and all package READMEs are not on the site. The pages checked (quickstart, publish) match the repository text for this release. The landing page (https://www.deepseek.com/harness/en/) adds `npx @deepseek-ai/dsh web`, links a Cordis paper (https://arxiv.org/abs/2608.25512), and describes the four Web modes (Standard, Code, Minimal, Creator).
6. **Desktop on Linux.** Upstream Desktop does not target Linux releases and its tray is Windows-only, while research.md 5.10 assumes an extendable tray.
7. **Hooks bridge scope.** [hooks-claude-code](../../packages/hooks/hooks-claude-code/README.md) handles seven Claude Code events and command hooks only, from one process-level `configPath`; the extension cookbook presents hooks as covered by the bridges.
8. **Skill roots.** `.claude/skills` is not a default root although the package targets the SKILL.md convention; `customSkillDirs` are absolute and global, not per project.
9. **Out-of-tree events.** The model-visible ⟺ logged rule assumes in-tree event declarations; out-of-tree plugins can only add ignorable events (section 4.1). No user-facing doc states this; it is found only in the generated `known-event-types.ts` comment.
10. **"Config cannot disable a row."** A comment in [bundle/base/cordis.patch.yml](../../packages/bundle/base/cordis.patch.yml) says telemetry config cannot disable its row, meaning a Config field cannot; a patch's `disabled: true` can.
11. **Real-API test policy.** [testing.md](../../docs/testing.md#the-with-key-policy-inference-is-cheap-here) says not to ration real-API tests because inference is cheap for the upstream team; for AIR the cost is the student's, so prefer keyless snapshots and local models for most runs.
12. **Community plugins.** The `dsh-plugin` topic (https://github.com/topics/dsh-plugin) is large and noisy, mixing real plugins (desktop shells, web plugin aggregators, the `awesome-dsh-plugin` list) with unrelated projects that only add the tag. MemOS claims "DeepSeek Harness support" in its description; third-party blog posts list plugins with install commands. None of these are official, and none were verified here.

## Sources

- Repository: [CONTRIBUTING.md](../../CONTRIBUTING.md), [AGENTS.md](../../AGENTS.md), [packages/AGENTS.md](../../packages/AGENTS.md), [docs/AGENTS.md](../../docs/AGENTS.md), [architecture.md](../../docs/architecture.md), [development.md](../../docs/development.md), [testing.md](../../docs/testing.md), [defensive-patterns.md](../../docs/defensive-patterns.md), [cordis-primer.md](../../docs/cordis-primer.md), [glossary.md](../../docs/glossary.md), [extension-cookbook.md](../../docs/cookbook/extension-cookbook.md), [adding-a-package.md](../../docs/cookbook/adding-a-package.md), [adding-a-tool.md](../../docs/cookbook/adding-a-tool.md), [reviewing-persistence-type-changes.md](../../docs/cookbook/reviewing-persistence-type-changes.md), [user develop docs](../../docs/user/develop/basic/index.md), [user guides](../../docs/user/guide/index.md), [CLI README](../../apps/cli/README.md), [CLI reference](../../apps/cli/reference/README.md), [bundle group](../../packages/bundle/README.md), [experimental group](../../packages/experimental/README.md), skills under [.agents/skills/](../../.agents/skills/dsh-pre-push-checks/SKILL.md), [website AGENTS.md](../../website/AGENTS.md).
- Online (official): https://github.com/deepseek-ai/deepseek-harness, https://www.deepseek.com/harness/en/, https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart, https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish, https://deepseek-harness.github.io/deepseek-harness/en/reference/.
- Online (community, not authoritative): https://github.com/topics/dsh-plugin.
