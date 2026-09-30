# Spike 01: out-of-tree toolchain for AIR plugin packages

Date: 2026-09-30. Upstream base: `dsh-v0.2.0-rc.2` (the fork moved from `dsh-v0.2.0-rc.1` to `dsh-v0.2.0-rc.2` while this spike ran; every result below was re-run on `dsh-v0.2.0-rc.2` after the root `pnpm install && pnpm run build`). Runtime version reported by `getDshRuntimeVersion()`: `0.2.0-rc.2`. Node 22.23.1; root pnpm 11.7.0.

The spike built a throwaway package `air/packages/_spike-hello` (`@air/dsh-spike-hello`) that registers one tool (`spike_greet`) through `ctx.tools.register(defineTool(...))` with one Config field (`greeting`), tested it, installed it into a temporary profile through a code-carrying bundle, booted the Web profile, and served a browser half. All spike files, the temporary profile, and the generated lockfile were removed afterwards.

## Summary of answers

| Question | Answer |
|---|---|
| 1. Minimal toolchain | `link:` dev dependencies to the fork's built packages, semver peer ranges, a standalone `tsconfig` (no `extends` of the root base), `tsc` emit plus `tsdown` bundle, per-package `vitest`, and an AIR-owned oxlint config. Unit test and a native-resolution Loader test both pass. |
| 2. Bundle with code | Works. A bundle that depends on AIR packages with `workspace:*` installs with `dsh plugin add <abs path>`, its rows resolve, the tool registers at Web boot, and its Config is applied. The AIR workspace must be installed and built first. |
| 3. Peer ranges | Only `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peers are checked, with `semver.satisfies(..., { includePrerelease: true })`. Use `^0.2.0-rc.1` (or `^0.2.0-rc.2`); `link:` in `peerDependencies` is denied. `compatibility.json` exemptions work and are exact-version only. |
| 4. Root gates | Root `lint` scans `air/` but applies no rules there; `typecheck`, `test`, coverage and `duplication` do not see `air/`. Three root gates do reject `air/` content: `verify-translation-pairing` (already fails on `air/README.md`), `verify-no-unknown-casts`, and the two repository-wide text gates. |
| 5. Client plugins | Works with one caveat: the host serves an out-of-tree package's `lib/client.js` when its row's `package.json` declares `dsh.client` and exports `./client`, but upstream's `clientBundle` build preset only accepts packages under `packages/*/*`, so AIR needs its own client tsdown config (template below). |
| 6. CI | A job template is at the end of this note. |

## 1. Package toolchain

### How `@deepseek-ai/*` references resolve

| Specifier in an `air/packages/<pkg>/package.json` | Result |
|---|---|
| `link:../../../packages/<group>/<pkg>` (dev dependency) | Works. pnpm creates `node_modules/@deepseek-ai/<pkg>` symlinks to the fork's package directories, whose `exports` point at the built `lib/`. Requires a root `pnpm run build` first. |
| `link:../../../vendor/<pkg>` (cordis, loader, include, schemastery) | Works the same way. |
| `workspace:*` | Does not resolve: the fork's packages are not members of the `air/` workspace. |
| Published versions (`^0.2.0-rc.2` from npm) | Resolvable (npm has `@deepseek-ai/dsh-tools` `0.2.0-rc.1` and `0.2.0-rc.2`, `@deepseek-ai/cordis` `4.0.4`), but they are separate copies of what the fork builds, so fork-local changes would not be seen. Keep for a future npm release path only. |

Module identity holds with `link:`: the test's `@deepseek-ai/cordis` and the one `dsh-tools` imports both realpath to `vendor/cordis/lib/index.js`, and a Loader-imported plugin shares the test's `Context` (the native Loader test below proves it).

### Templates that worked

`air/packages/<pkg>/package.json`:

```json
{
  "name": "@air/dsh-spike-hello",
  "description": "Spike: one tool and one Config field",
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
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-system-prompt": "link:../../../packages/core/system-prompt",
    "@deepseek-ai/dsh-tools": "link:../../../packages/core/tools",
    "@types/node": "^22.20.0",
    "tsdown": "^0.22.2",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

Upstream's published manifests use `~4.0.4` for the cordis peer; either range works because dsh does not check the cordis peer. In the real layout, move `@types/node`, `tsdown`, `typescript`, and `vitest` to `air/package.json` devDependencies (the spike could not edit that file, so it declared them per package).

`tsconfig.build.json` (emit; standalone, does not extend the root base):

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "rootDir": "src",
    "outDir": "lib/types",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`tsconfig.json` (typecheck of sources and tests; also the program type-aware oxlint uses):

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

In the real layout, put the shared compiler options in `air/tsconfig.base.json` and have each package's `tsconfig.build.json` extend it.

`tsdown.config.ts` (same two-step layout as upstream: tsc emits `lib/types`, tsdown bundles it):

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dsh packages stay external as peers. */
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

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

`src/index.ts`:

```ts
/** Spike plugin: registers a `spike_greet` tool whose greeting is a Config field. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'air-spike-hello'
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /** Word placed before the name in the tool result. */
  greeting: string
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello').description('Word placed before the name in the tool result.'),
})

/**
 * Register the `spike_greet` tool.
 * @param ctx - plugin context with the `tools` service injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'spike_greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      return Promise.resolve(`${config.greeting}, ${args.name}!`)
    },
  }))
}
```

`tests/hello.spec.ts` (unit test; in-process `Context`):

```ts
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as hello from '../src/index.ts'

async function mount(config?: hello.Config): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(hello, config)
  return ctx
}

function call(ctx: Context, name: string) {
  return ctx.tools.execute({
    name: 'spike_greet',
    arguments: { name },
    callId: ToolCallId('spike-call'),
    signal: new AbortController().signal,
  })
}

describe('spike_greet', () => {
  it('uses the schema default greeting', async () => {
    const ctx = await mount()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['spike_greet'])
    const result = await call(ctx, 'Ada')
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Hello, Ada!' }])
  })

  it('uses the configured greeting', async () => {
    const ctx = await mount({ greeting: 'Hi' })
    expect((await call(ctx, 'Ada')).content).toEqual([{ type: 'text', text: 'Hi, Ada!' }])
  })

  it('removes the tool when the plugin unloads', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(hello)
    expect(ctx.tools.schemas()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })
})
```

`tests/native-loader.spec.ts` (REAL-composition Loader test: a real `cordis.yml`, the real Loader and Include, and native Node resolution of every row, including the AIR package itself through its own `exports`):

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

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
// must live inside this package; `@air/dsh-spike-hello` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    '- id: air-spike-hello',
    "  name: '@air/dsh-spike-hello'",
    '  config:',
    "    greeting: 'Howdy'",
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  expect(context.tools.schemas().map(schema => schema.name)).toEqual(['spike_greet'])
  const result = await context.tools.execute({
    name: 'spike_greet',
    arguments: { name: 'Ada' },
    callId: ToolCallId('native-call'),
    signal: new AbortController().signal,
  })
  expect(result.content).toEqual([{ type: 'text', text: 'Howdy, Ada!' }])
})
```

Add `.loader-*/` to `air/.gitignore` if a crashed run can leave the directory behind.

### Commands and results

| Command (cwd) | Result |
|---|---|
| `pnpm install` (`air/`) | Exit 0. 69 packages; `node_modules/@deepseek-ai/*` in the package are symlinks into `vendor/` and `packages/`. The first run took 10 min 43 s because of a 13 KiB/s registry download; later installs reuse the store. |
| `pnpm run typecheck` (package) | Exit 0 (`tsc -p tsconfig.json`). |
| `pnpm run build` (package) | Exit 0. `lib/index.js` 0.97 kB, externals `@deepseek-ai/schemastery` and `@deepseek-ai/dsh-tools`. |
| `pnpm test` (package) | `Test Files 2 passed (2)`, `Tests 4 passed (4)`, 0.8 s. |
| `pnpm exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100` | 100% statements, branches, functions, lines. The coverage provider resolved from the repository root's `node_modules` (see pitfalls). |
| `node node_modules/oxlint/bin/oxlint --config <air oxlint config> <pkg>/src <pkg>/tests` (repo root) | Exit 0 after two fixes (see pitfalls); a deliberately bad file produced errors, so the rules were active. |

### `dsh-loader-smoke` and other test-support packages

Any fork package can be linked the same way (`link:../../../packages/test-support/loader-smoke`), and the in-process pattern above needs only cordis, loader, include, and the service packages. `runLoaderSmoke` was not run: it spawns an application bin with a `cordis.yml`, which the repository rule on application launch reserves for `dsh` profiles, and its production-profile helper (`tests/fixtures/production-profile.ts`) is repository-internal, not an export. For a profile-level test, boot a real profile under an isolated `DSH_HOME` instead (verified in section 2).

## 2. A bundle with code

The spike could not create a second bundle under `air/bundles/`, so it reproduced the AIR workspace in the scratch directory (`pnpm-workspace.yaml` with `bundles/*` and `packages/*`; the plugin package with absolute `link:` paths and the built `lib/`) and added this bundle:

```json
{
  "name": "@air/dsh-air-spike-bundle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "files": ["cordis.patch.yml"],
  "dependencies": { "@air/dsh-spike-hello": "workspace:*" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
- insert:
    - id: air-spike-hello
      name: '@air/dsh-spike-hello'
      config:
        greeting: Howdy
```

| Step | Command | Result |
|---|---|---|
| Install the AIR workspace | `pnpm install --offline` | `bundles/air-spike/node_modules/@air/dsh-spike-hello` links to `packages/hello`. |
| Create profile | `pnpm dsh --profile air-spike --from-default-profile web --dump-config` | Exit 0; bundles `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`. |
| Install bundle | `pnpm dsh plugin --profile air-spike add <abs>/bundles/air-spike` | Exit 0; profile dependency `link:<abs path>`; bundle appended to `dsh.profile.bundles`. |
| Inspect | `pnpm dsh --profile air-spike --dump-config` | Exit 0; empty stderr apart from the pnpm script echo; ends with `# == @air/dsh-air-spike-bundle` and the `air-spike-hello` row. |
| Boot | `timeout 60 pnpm dsh --profile air-spike --no-open --port 3187` | Exit 124 (timeout) with `dsh web: http://127.0.0.1:3187/?token=...` and no pending, failed, or denied rows on stderr. With a temporary `console.error` added to the scratch copy of `lib/index.js`: `[air-spike-hello] registered: true greeting=Howdy`. |
| Isolated home | Same three steps with `DSH_HOME=<scratch>/dshhome` | Exit 0 each; the dump shows the AIR layer; nothing written under `~/.dsh`. |

Findings:

- `dsh plugin add` of a `link:` path does not install the linked package's own dependencies. The bundle's `node_modules/@air/*` links come from the AIR workspace install, so `pnpm -C air install && pnpm -C air -r build` must run before `dsh plugin add` and after every AIR dependency change.
- Rows name plugin packages by package name; the runtime resolution follows the bundle's `dependencies`, as `schedule-bundle` does. Keep every row's package in the bundle's `dependencies`.
- The existing `air` profile already links `air/bundles/air`, so adding `dependencies` there needs no reinstall into the profile; a restart applies bundle-membership changes.
- `autoInstallPeers` defaults to true in the AIR workspace. A package whose peers are not also dev dependencies made `pnpm install --offline` try to fetch `@deepseek-ai/cordis@^4.0.4` from the registry; online it would install a second cordis from npm. Set `autoInstallPeers: false` in `air/pnpm-workspace.yaml`, as dsh profiles do.

## 3. Peer ranges and exemptions

Implementation: `packages/boot/app-boot/src/plugin-compatibility.ts`. Only peers named `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` are checked; `@deepseek-ai/cordis` is ignored; `workspace:^`, `workspace:~`, `workspace:*` mean "the running version"; any other non-semver string (for example `link:...`) is incompatible. Evaluated with `evaluatePluginCompatibility` against several runtime versions:

| Peer range | 0.2.0-rc.1 | 0.2.0-rc.2 | 0.2.0 | 0.2.1 | 0.3.0-rc.1 |
|---|---|---|---|---|---|
| `^0.2.0-rc.2` | deny | ok | ok | ok | deny |
| `^0.2.0-rc.1` | ok | ok | ok | ok | deny |
| `>=0.2.0-rc.1 <0.3.0` | ok | ok | ok | ok | ok (prerelease below 0.3.0) |
| `~0.2.0-0` | ok | ok | ok | ok | deny |
| `^0.2.0` | deny | deny | ok | ok | deny |
| `>=0.2.0` | deny | deny | ok | ok | ok |
| `0.2.0-rc.2` | deny | ok | deny | deny | deny |
| `link:../../../packages/core/tools` | deny | deny | deny | deny | deny |

Recommended: `^0.2.0-rc.1` for every dsh peer now (accepts both release candidates and 0.2.x), and bump the lower bound to the merged tag at each upstream sync. Avoid `>=x <0.3.0`, which admits `0.3.0` prereleases.

Boot behavior, verified in `air-spike`: with `"@deepseek-ai/dsh-tools": "^0.1.7"` the launcher printed `dsh: disabling profile plugin row "air-spike-hello": Plugin @air/dsh-spike-hello@0.1.0 is incompatible with dsh 0.2.0-rc.2 ...` and the Web app still booted. `pnpm dsh plugin --profile air-spike allow-version @air/dsh-spike-hello@0.1.0 --dsh-version 0.2.0-rc.2 --accept-risk` wrote `compatibility.json` as `{"@air/dsh-spike-hello@0.1.0": ["0.2.0-rc.2"]}`, and the next boot loaded the row. The check applies to row packages at boot and to the bundle package's own peers at install and profile load; `dsh plugin add` of a local path reads only that path's `package.json`, so a bad range in a plugin package behind the bundle is first reported at boot.

## 4. Which root gates see `air/`

| Gate | Sees `air/`? | Evidence |
|---|---|---|
| `pnpm run lint` (`run-oxlint.ts .`) | Scans it, applies no rules. | `.oxlintrc.json` has no top-level rules and every rule override is scoped to `packages/*/*`, `apps/*`, `scripts/**`, `examples/**`, `website/**`. `tsx scripts/run-oxlint.ts air` exits 0 with the spike present. |
| lefthook `lint (staged)` | Same as above. | `run-oxlint.ts --config .oxlintrc.staged.json <spike files>` exits 0. |
| lefthook `third-party notices (staged)` | Triggered by `air/**/package.json` (glob `*/*/*/package.json`) but does not read `air/`. | `gen-third-party-notices.ts --check` reported `up to date` with the spike present. |
| `pnpm run typecheck` | No. | Only projects referenced from `tsconfig.host.json` / `tsconfig.client.json`. |
| `pnpm run test`, `test:coverage` | No. | `vitest.config.ts` includes `packages/*/*/tests`, `apps/*/tests`, `scripts/**`, `website/tests`. |
| `pnpm run duplication` | No. | `jscpd ... packages scripts`. |
| `verify-export-jsdoc`, `verify-client-ui-i18n`, `verify-md-links`, `verify-md-wrap`, README summary gates | No. | Globs start with `packages/`; AIR code therefore gets no JSDoc or locale-copy enforcement unless AIR adds its own checks. |
| `verify-no-unknown-casts` (in `hygiene` and CI) | Yes. | Scans all tracked and untracked source files. It rejected the upstream-style Loader test that assigns `context.loader.internal = {...} as unknown as ...`; the native-resolution test above avoids the cast and passes (`no new assertions; 1445 existing assertions remain`). |
| `verify-translation-pairing` (in `test:docs` and `doc-sync`) | Yes, for any `README.md`. | `pnpm run test:docs` with the spike present: 20 passed, 1 failed: `air/README.md: in-scope documentation must merge bilingual`. This failure exists on `air/main` today, independent of the spike. Every future `air/packages/*/README.md` will hit it too. |
| `verify-concrete-terms`, `verify-repository-references` | Yes (known). | Both passed in `test:docs` with the spike present. |

Fix for the translation gate: add `"air/"` (directory entries end in `/`) to the `excluded` list in `scripts/translation-pairing.manifest.json` and record it in `air/UPSTREAM-DELTA.md`. That is an in-tree edit; the alternative is to name AIR package docs something other than `README.md`, which conflicts with the AIR README template.

AIR lint: the root oxlint config cannot be reused as is. A copy with each override's `packages/*/*/` prefix rewritten applied the upstream rules to the spike once two details were right: override globs are relative to the config file's directory, and the config must sit where `eslint-plugin-sonarjs` (a JS plugin the config loads) resolves, which the repository root's `node_modules` satisfies for any file under the checkout. Put `air/.oxlintrc.json` in place with globs `packages/*/src/**/*.{ts,tsx}` and `packages/*/tests/**/*.{ts,tsx}`, and run `node ../node_modules/oxlint/bin/oxlint --config .oxlintrc.json packages` from `air/`, or declare `oxlint`, `oxlint-tsgolint`, `@stylistic/eslint-plugin`, and `eslint-plugin-sonarjs` in `air/package.json`.

## 5. Client (browser) plugins

How the host finds a browser half (`packages/client/modules/src/index.ts`, `resolveMeta` and `locatePkgJson`): for every Loader row it resolves the row's package through the same Loader resolution, reads that `package.json`, and treats the row as a client row when `dsh.client.platform` is `web`; the served file is the package's `exports["./client"]`. Nothing restricts this to in-tree packages.

Verified: adding `"./client": "./lib/client.js"` to the exports and `"dsh": { "client": { "platform": "web" } }` to the scratch copy of the plugin, then booting `air-spike`, put `@air/dsh-spike-hello/client.js` into the first `plugins/??...` combo URL of the served page; fetching that combo URL returned status 200 and contained `id: "@air/dsh-spike-hello"` and the plugin's code. Execution in a browser was not checked.

Build: `packages/client/tsdown.client.ts` (`clientBundle`) cannot be used from `air/`. It looks up the package manifest with `globSync('packages/*/*/package.json')` and failed with `tsdown: no packages/*/*/package.json declares the name @air/dsh-spike-hello`. This AIR-owned config reproduces the artifact format the module loader expects (a `window.__ModuleLoader__.load({ id, factory })` wrapper around a CommonJS browser bundle whose baseline externals come from `PLATFORM_MODULES`) and built `lib/client.js` (0.53 kB):

```ts
import { defineConfig } from 'tsdown'
import { PLATFORM_MODULES } from '../../../packages/client/web/src/platform.ts'

const id = '@air/dsh-spike-hello'
const shared = new Set<string>(PLATFORM_MODULES)

/** Browser half in the host's closure-factory format (mirrors packages/client/tsdown.client.ts). */
export default defineConfig({
  name: `${id}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: (s: string) => shared.has(s), alwaysBundle: (s: string) => !shared.has(s) },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: chunk => `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
```

What this copy omits compared with the upstream preset: CSS Modules and `?inline` CSS compilation through lightningcss, `dsh.client.external` requests, experimental-input isolation, and the `DSH_CLIENT_*` build defines. A UI plugin with styles needs the CSS part ported, or a small in-tree change that lets `workspaceManifest` accept a package directory outside `packages/*/*` (recorded in `air/UPSTREAM-DELTA.md` if chosen). The client source follows `packages/client/AGENTS.md`: `inject: ['slots']`, registrations through `ctx.slots.register` inside `ctx.slots.inject`, React and cordis from the baseline, types from `@deepseek-ai/dsh-client-ui-*` as `link:` dev dependencies. Two upstream rules have no gate outside `packages/`: locale-owned UI copy (`verify-client-ui-i18n`) and client dependency declaration (`verify-client-packages`); AIR must follow them by review. The root build's client artifact record covers only upstream packages; the host serves AIR's `lib/client.js` without consulting it, and the source launcher does not check freshness, so rebuild the client half before each boot.

## 6. Proposed CI job

```yaml
name: air
on:
  push:
    branches: [air/main]
  pull_request:
    branches: [air/main]

jobs:
  air:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      DSH_HOME: ${{ runner.temp }}/dsh-home
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          cache-dependency-path: |
            pnpm-lock.yaml
            air/pnpm-lock.yaml

      - name: Install fork
        run: pnpm install --frozen-lockfile
      - name: Build fork
        run: pnpm run build

      - name: Install AIR workspace
        run: pnpm -C air install --frozen-lockfile
      - name: Build AIR packages
        run: pnpm -C air -r run build
      - name: Typecheck AIR packages
        run: pnpm -C air -r run typecheck
      - name: Lint AIR packages
        working-directory: air
        run: node ../node_modules/oxlint/bin/oxlint --config .oxlintrc.json packages
      - name: Test AIR packages
        run: pnpm -C air -r run test

      - name: Root gates that scan air/
        run: |
          pnpm run verify-no-unknown-casts
          pnpm run verify-concrete-terms
          pnpm run verify-repository-references
          pnpm run verify-translation-pairing

      - name: Compose and boot the AIR profile
        run: |
          pnpm dsh --profile air-ci --from-default-profile web --dump-config > /dev/null
          pnpm dsh plugin --profile air-ci add "$PWD/air/bundles/air"
          pnpm dsh --profile air-ci --dump-config > "$RUNNER_TEMP/dump.yml" 2> "$RUNNER_TEMP/dump.err"
          ! grep -Ei 'unmatched|incompatible|failed' "$RUNNER_TEMP/dump.err"
          set +e
          timeout 60 pnpm dsh --profile air-ci --no-open --port 3187 > "$RUNNER_TEMP/boot.out" 2> "$RUNNER_TEMP/boot.err"
          code=$?
          set -e
          test "$code" -eq 124
          grep -q 'dsh web: http://127.0.0.1:3187/' "$RUNNER_TEMP/boot.out"
          ! grep -Ei 'disabling profile plugin row|failed|error' "$RUNNER_TEMP/boot.err"
```

Notes: `verify-translation-pairing` stays red until the manifest exclusion in section 4 lands. The boot step was verified only with the spike bundle over the Web template; with the real `air` bundle, `agent-default-model` names the `ollama` route that only the example profile patch declares, so the job may need `cp air/examples/ollama.profile.cordis.patch.yml "$DSH_HOME/profiles/air-ci/cordis.patch.yml"` before booting. The fork also inherits upstream's `.github/workflows/*`, which run on pushes to the fork unless disabled there.

## Pitfalls hit and fixes

1. The root build was replaced mid-spike (`dsh-v0.2.0-rc.1` to `dsh-v0.2.0-rc.2` with `pnpm run clean`). Linked `lib/` directories are missing during a root rebuild; AIR build and test must run after the root build finishes.
2. `air/` has no `packageManager` field, so `pnpm` there resolved to a global pnpm 12.4.1 while the root uses 11.7.0; the generated lockfile came from pnpm 12. Add `"packageManager": "pnpm@11.7.0"` to `air/package.json`.
3. `autoInstallPeers` (default true) tried to fetch peers from the registry; set `autoInstallPeers: false`.
4. A Loader row resolves from the directory of the `cordis.yml` that contains it, not from `ctx.baseUrl`. A `cordis.yml` in the system temp directory left every row silently unloaded (entry state `undefined`, no logger output). Writing the file inside the package fixed it.
5. The native Loader test imports the built `lib/index.js` through the package's self-reference, so it fails before `pnpm run build`; run build before test.
6. `execute` declared `async` without `await` violates the upstream `require-await` rule, and a synchronous `execute` fails `defineTool`'s type (`Promise<string>` expected); return `Promise.resolve(...)`.
7. The upstream Loader test pattern (`context.loader.internal = {...} as unknown as ...`) fails `verify-no-unknown-casts` outside the upstream baseline; use native resolution.
8. With `include: ["src"]` only, type-aware oxlint reported tests as `error` typed values; the typecheck `tsconfig.json` must include `tests`.
9. `@vitest/coverage-v8` was never declared in the spike yet resolved from the repository root's `node_modules` (4.1.8 against vitest 4.1.11). Node's ancestor lookup leaks root dependencies into `air/`; declare every tool AIR uses in `air/package.json` so CI does not depend on the leak.
10. Upstream's `clientBundle` preset rejects packages outside `packages/*/*` (section 5).

## Recommended toolchain

- `air/package.json`: `private`, `"type": "module"`, `"packageManager": "pnpm@11.7.0"`, devDependencies `typescript`, `tsdown`, `vitest`, `@vitest/coverage-v8`, `@types/node`, and the oxlint set; scripts `build` (`pnpm -r run build`), `typecheck`, `test`, `lint`.
- `air/pnpm-workspace.yaml`: `packages: [bundles/*, packages/*]` plus `autoInstallPeers: false`.
- Commit `air/pnpm-lock.yaml` and install with `--frozen-lockfile` in CI. The `link:` entries record relative paths, so the lockfile is stable across checkouts; without it CI resolves tool versions afresh on every run.
- Each package: the templates in section 1; `@air/dsh-<name>`; dsh packages as semver peers plus `link:` dev dependencies; stateless libraries such as schemastery under `dependencies` (`link:` to `vendor/` now, a registry range if AIR is ever published).
- Tests: in-process unit tests plus one native-resolution Loader test per product-visible plugin; 100% per-file coverage through the AIR vitest config; profile-level smoke under an isolated `DSH_HOME`.
- Bundle: `air/bundles/air` lists every AIR plugin package in `dependencies` with `workspace:*` and inserts their rows by package name; install and build `air/` before `dsh plugin add`.
- Peers: `^0.2.0-rc.1` today; bump at each upstream tag merge.
- In-tree changes to record in `air/UPSTREAM-DELTA.md`: the `air/` exclusion in `scripts/translation-pairing.manifest.json`, and optionally a preset change so `clientBundle` accepts `air/packages/*`.
