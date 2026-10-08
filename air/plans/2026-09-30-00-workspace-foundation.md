# AIR Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the out-of-tree `air/` pnpm workspace a pinned toolchain, shared compiler settings, a lint configuration derived from upstream's rules, a profile smoke script, and a CI job, so every later AIR package plan can build, typecheck, lint, and test with one command each, on native Windows and Linux.

**Architecture:** `air/` is a separate pnpm workspace outside upstream's `packages/*/*` globs. Its root `package.json` pins pnpm and declares every build and test tool once; packages extend `air/tsconfig.base.json`. The AIR lint config is generated from the root `.oxlintrc.json` by a script, so upstream rule changes flow into AIR at every sync without hand edits. A shell smoke script composes and boots an `air` profile under an isolated `DSH_HOME`; CI runs the same script.

**Tech Stack:** pnpm 11.7.0, TypeScript 6, tsdown 0.22, Vitest 4, oxlint 1.76 with oxlint-tsgolint, tsx, GitHub Actions.

> **Revision log (2026-10-08).** (1) The profile smoke is now `air/scripts/smoke-profile.ts`, run by tsx, because four teammates develop on native Windows without bash; it was run on Fedora and passes in about 8 seconds. (2) Every command step uses `pnpm`, `node`, or `git` only, with no absolute home path, so steps run unchanged in PowerShell and bash; run them from the repository root unless a step says otherwise. (3) The lint generator keeps `apps/*` globs and the lint script covers `air/apps`, for the desktop workspaces of plan 07. (4) The CI job builds, typechecks, and tests only `packages/*` and `bundles/*`; plan 07's own workflow owns `apps/*`, which would otherwise download Electron on every run. (5) Upstream base is now `dsh-v0.2.1-alpha.1`; the peer range `^0.2.0-rc.1` still matches it.

**Spec:** [air/plans/spikes/01-toolchain.md](spikes/01-toolchain.md) (verified templates, root gate behavior, CI job), [research/notes/08-dev-contrib-guide.md](../../research/notes/08-dev-contrib-guide.md) §5.

## Global Constraints

- Node `^22.19.0 || >=24.0.0`; pnpm `11.7.0` through `"packageManager": "pnpm@11.7.0"`.
- ESM only (`"type": "module"`); TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- AIR packages are `air/packages/<pkg>` named `@air/dsh-<pkg>`; upstream packages are referenced as `link:../../../packages/<group>/<pkg>` or `link:../../../vendor/<pkg>` devDependencies plus semver peers `^0.2.0-rc.1`; `workspace:*` only between AIR packages.
- `air/pnpm-workspace.yaml` sets `autoInstallPeers: false`.
- No `as unknown` casts anywhere under `air/` (root gate `verify-no-unknown-casts` scans it).
- Markdown under `air/`: English only, never the banned origin-label word checked by `verify-concrete-terms`, no git commit hashes, no URLs under the upstream working organization.
- Every file changed outside `air/` and `research/` is listed in `air/UPSTREAM-DELTA.md`.
- AIR build and test run only after a finished root `pnpm run build` (linked `lib/` directories are missing during a root rebuild).

---

## File Structure

| File | Responsibility |
|---|---|
| `air/package.json` | Pinned package manager, shared devDependencies, workspace scripts |
| `air/pnpm-workspace.yaml` | Workspace members and `autoInstallPeers: false` |
| `air/pnpm-lock.yaml` | Committed lockfile (generated) |
| `air/tsconfig.base.json` | Shared compiler options every package extends |
| `air/.gitignore` | Build outputs, Loader test scratch dirs, coverage |
| `air/vitest.config.ts` | Tests for workspace scripts under `air/scripts/` |
| `air/scripts/gen-oxlintrc.ts` | Derives `air/.oxlintrc.json` from the root `.oxlintrc.json` |
| `air/scripts/tests/gen-oxlintrc.spec.ts` | Tests for the generator |
| `air/.oxlintrc.json` | Generated lint config (committed; `--check` detects drift) |
| `air/scripts/smoke-profile.ts` | Compose and boot an AIR profile under an isolated `DSH_HOME` (runs on Windows and Linux) |
| `.github/workflows/air.yml` | CI job for `air/main` (in-tree file, listed in UPSTREAM-DELTA) |
| `air/README.md` | Toolchain and command reference (modified) |
| `air/UPSTREAM-DELTA.md` | Adds the workflow file (modified) |

---

### Task 1: Workspace root toolchain

**Files:**
- Modify: `air/package.json`
- Modify: `air/pnpm-workspace.yaml`
- Create: `air/tsconfig.base.json`
- Create: `air/.gitignore`
- Create: `air/vitest.config.ts`
- Create: `air/pnpm-lock.yaml` (generated)

**Interfaces:**
- Consumes: root build outputs under `packages/*/*/lib` and `vendor/*/lib`.
- Produces: `air/tsconfig.base.json` (every package's `tsconfig.build.json` uses `"extends": "../../tsconfig.base.json"` and sets only `rootDir`, `outDir`, `include`); workspace scripts `pnpm -C air run build|typecheck|lint|test`; devDependencies available to all packages: `typescript`, `tsdown`, `vitest`, `@vitest/coverage-v8`, `@types/node`, `tsx`, `oxlint`, `oxlint-tsgolint`, `@stylistic/eslint-plugin`, `eslint-plugin-sonarjs`.

- [ ] **Step 1: Confirm the root build is present**

Run (repository root): `node -e "const fs=require('fs');console.log(['vendor/cordis/lib/index.js','packages/core/tools/lib/index.js'].every(f=>fs.existsSync(f))?'ok':'missing')"`
Expected: `ok`. If not, run `pnpm install && pnpm run build` at the repository root first.

- [ ] **Step 2: Replace `air/package.json`**

```json
{
  "name": "@air/root",
  "private": true,
  "type": "module",
  "license": "MIT",
  "packageManager": "pnpm@11.7.0",
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  },
  "scripts": {
    "build": "pnpm -r --if-present run build",
    "typecheck": "pnpm -r --if-present run typecheck",
    "lint": "tsx scripts/gen-oxlintrc.ts --check && oxlint --config .oxlintrc.json --type-aware packages apps",
    "lint:gen": "tsx scripts/gen-oxlintrc.ts",
    "test": "vitest run && pnpm -r --if-present run test",
    "smoke": "tsx scripts/smoke-profile.ts"
  },
  "devDependencies": {
    "@stylistic/eslint-plugin": "^5.10.0",
    "@types/node": "^22.20.0",
    "@vitest/coverage-v8": "^4.1.8",
    "eslint-plugin-sonarjs": "^4.1.0",
    "oxlint": "1.76.0",
    "oxlint-tsgolint": "7.0.2001",
    "tsdown": "^0.22.2",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 3: Replace `air/pnpm-workspace.yaml`**

```yaml
packages:
  - bundles/*
  - packages/*

# Peers such as @deepseek-ai/cordis come from the fork through link: dev
# dependencies; auto-installing them would fetch a second copy from npm.
autoInstallPeers: false
```

- [ ] **Step 4: Create `air/tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
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
  }
}
```

- [ ] **Step 5: Create `air/.gitignore`**

```gitignore
node_modules/
lib/
coverage/
.loader-*/
```

- [ ] **Step 6: Create `air/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

/** Workspace-level tests cover air/scripts only; each package runs its own Vitest config. */
export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

- [ ] **Step 7: Install and generate the lockfile**

Run: `pnpm -C air install`
Expected: exits 0; `pnpm --version` inside `air/` prints `11.7.0`; `air/pnpm-lock.yaml` exists; `air/node_modules/.bin/tsc` exists.

- [ ] **Step 8: Verify the pinned tools resolve from `air/`**

Run, one command at a time: `pnpm -C air exec tsc --version`, `pnpm -C air exec vitest --version`, `pnpm -C air exec pnpm --version`
Expected: `Version 6.x`, `vitest/4.x`, `11.7.0`.

- [ ] **Step 9: Commit**

```bash
git add air/package.json air/pnpm-workspace.yaml air/pnpm-lock.yaml air/tsconfig.base.json air/.gitignore air/vitest.config.ts
git commit -m "build(air): pin the AIR workspace toolchain and shared compiler options"
```

---

### Task 2: Lint config generated from upstream rules

**Files:**
- Create: `air/scripts/gen-oxlintrc.ts`
- Create: `air/scripts/tests/gen-oxlintrc.spec.ts`
- Create: `air/.oxlintrc.json` (generated)

**Interfaces:**
- Consumes: root `.oxlintrc.json` (JSON with comments), `typescript` for comment-tolerant parsing.
- Produces: `deriveAirOxlintConfig(root: OxlintConfig): OxlintConfig` and the CLI `tsx scripts/gen-oxlintrc.ts [--check]` (writes `air/.oxlintrc.json`, or exits 1 when it is stale).

Mapping rules, applied to each override's `files`:
- `packages/*/*/<rest>` becomes `packages/*/<rest>` (AIR packages sit one level shallower).
- `packages/**/<rest>` is kept unchanged.
- `apps/*/<rest>` is kept unchanged (AIR's desktop workspaces live in `air/apps/*`, plan 07).
- Every other glob (examples, scripts, website, and paths to specific upstream packages) is dropped.
- Overrides left with no `files` are dropped.
- `ignorePatterns` keeps only entries starting with `**/`.
- `$schema` points at `./node_modules/oxlint/configuration_schema.json` (AIR's own install).

- [ ] **Step 1: Write the failing test**

`air/scripts/tests/gen-oxlintrc.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveAirOxlintConfig, parseJsonWithComments } from '../gen-oxlintrc.ts'

describe('deriveAirOxlintConfig', () => {
  it('rewrites package globs and drops non-package globs', () => {
    const derived = deriveAirOxlintConfig({
      $schema: './node_modules/oxlint/configuration_schema.json',
      ignorePatterns: ['**/lib/**', 'vendor/**', '**/*.js'],
      overrides: [
        { files: ['packages/*/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'], rules: { 'no-console': 'error' } },
        { files: ['packages/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'], rules: { eqeqeq: 'error' }, jsPlugins: ['eslint-plugin-sonarjs'] },
        { files: ['packages/typert/generator/tests/fixtures/type-model/**/*.{ts,tsx}'], rules: { 'typescript/no-explicit-any': 'off' } },
        { files: ['website/**/*.{ts,tsx}'], rules: { curly: 'error' } },
      ],
    })
    expect(derived.$schema).toBe('./node_modules/oxlint/configuration_schema.json')
    expect(derived.ignorePatterns).toEqual(['**/lib/**', '**/*.js'])
    expect(derived.overrides).toEqual([
      { files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'], rules: { 'no-console': 'error' } },
      { files: ['packages/**/*.{ts,tsx}'], rules: { eqeqeq: 'error' }, jsPlugins: ['eslint-plugin-sonarjs'] },
    ])
  })

  it('keeps top-level fields other than overrides and ignorePatterns', () => {
    const derived = deriveAirOxlintConfig({ options: { typeAware: true }, categories: { correctness: 'off' }, overrides: [] })
    expect(derived.options).toEqual({ typeAware: true })
    expect(derived.categories).toEqual({ correctness: 'off' })
    expect(derived.overrides).toEqual([])
  })
})

describe('parseJsonWithComments', () => {
  it('accepts line comments and trailing commas', () => {
    expect(parseJsonWithComments('{ "a": [1, 2,], // note\n "b": "x//y" }')).toEqual({ a: [1, 2], b: 'x//y' })
  })

  it('throws on invalid input', () => {
    expect(() => parseJsonWithComments('{ "a": ')).toThrow(/gen-oxlintrc/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C air exec vitest run scripts/tests/gen-oxlintrc.spec.ts`
Expected: FAIL with `Failed to load url ../gen-oxlintrc.ts` (module does not exist).

- [ ] **Step 3: Implement the generator**

`air/scripts/gen-oxlintrc.ts`:

```ts
/** Derives air/.oxlintrc.json from the repository's root .oxlintrc.json. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/** Subset of the oxlint configuration this generator reads and writes. */
export interface OxlintConfig {
  $schema?: string
  ignorePatterns?: string[]
  overrides?: OxlintOverride[]
  [key: string]: unknown
}

/** One oxlint override block. */
export interface OxlintOverride {
  files: string[]
  [key: string]: unknown
}

const UPSTREAM_PACKAGE_PREFIX = 'packages/*/*/'
const ANY_PACKAGE_PREFIX = 'packages/**/'
const APP_PREFIX = 'apps/'
const AIR_SCHEMA = './node_modules/oxlint/configuration_schema.json'

function mapGlob(glob: string): string | undefined {
  if (glob.startsWith(UPSTREAM_PACKAGE_PREFIX)) return `packages/*/${glob.slice(UPSTREAM_PACKAGE_PREFIX.length)}`
  if (glob.startsWith(ANY_PACKAGE_PREFIX)) return glob
  if (glob.startsWith(APP_PREFIX)) return glob
  return undefined
}

/**
 * Map root lint rules onto the AIR layout: `air/packages/<pkg>` instead of `packages/<group>/<pkg>`; `apps/*` globs carry over to `air/apps/*`.
 * @param root - parsed root configuration.
 * @returns the configuration to write to air/.oxlintrc.json.
 */
export function deriveAirOxlintConfig(root: OxlintConfig): OxlintConfig {
  const overrides: OxlintOverride[] = []
  for (const override of root.overrides ?? []) {
    const files = override.files.map(mapGlob).filter((glob): glob is string => glob !== undefined)
    if (files.length > 0) overrides.push({ ...override, files })
  }
  const derived: OxlintConfig = { ...root, $schema: AIR_SCHEMA, overrides }
  if (root.ignorePatterns !== undefined) {
    derived.ignorePatterns = root.ignorePatterns.filter(pattern => pattern.startsWith('**/'))
  }
  return derived
}

/**
 * Parse JSON that may contain comments and trailing commas (the root config's format).
 * @param text - file contents.
 * @returns the parsed value.
 */
export function parseJsonWithComments(text: string): OxlintConfig {
  const result = ts.parseConfigFileTextToJson('.oxlintrc.json', text)
  if (result.error !== undefined) {
    throw new Error(`gen-oxlintrc: ${ts.flattenDiagnosticMessageText(result.error.messageText, '\n')}`)
  }
  return result.config as OxlintConfig
}

function main(argv: readonly string[]): number {
  const airDir = join(import.meta.dirname, '..')
  const rootConfig = parseJsonWithComments(readFileSync(join(airDir, '..', '.oxlintrc.json'), 'utf8'))
  const next = `${JSON.stringify(deriveAirOxlintConfig(rootConfig), null, 2)}\n`
  const target = join(airDir, '.oxlintrc.json')
  if (argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(target, 'utf8')
    } catch (error) {
      // A missing target is reported as stale below; nothing else to recover.
      void error
    }
    if (current !== next) {
      console.error('gen-oxlintrc: air/.oxlintrc.json is stale; run `pnpm -C air run lint:gen`.')
      return 1
    }
    return 0
  }
  writeFileSync(target, next)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C air exec vitest run scripts/tests/gen-oxlintrc.spec.ts`
Expected: `Tests 4 passed (4)`.

- [ ] **Step 5: Generate the config and confirm `--check` passes**

Run (from `air/`): `pnpm run lint:gen` then `pnpm exec tsx scripts/gen-oxlintrc.ts --check`
Expected: `air/.oxlintrc.json` exists; `exit 0`. `node -e "const c=require('./.oxlintrc.json');const f=c.overrides.flatMap(o=>o.files);console.log(f.some(g=>g.startsWith('packages/*/src')), f.some(g=>g.startsWith('scripts/')||g.startsWith('website/')))"` prints `true false`.

- [ ] **Step 6: Prove the rules are active on AIR code**

Run:

```bash
node -e "const fs=require('fs');fs.mkdirSync('air/packages/_lint-probe/src',{recursive:true});fs.writeFileSync('air/packages/_lint-probe/tsconfig.json',JSON.stringify({extends:'../../tsconfig.base.json',compilerOptions:{rootDir:'src',noEmit:true},include:['src']}));fs.writeFileSync('air/packages/_lint-probe/src/index.ts','export async function probe(): Promise<number> {\n  return 1\n}\n')"
pnpm -C air exec oxlint --config .oxlintrc.json --type-aware packages
node -e "require('fs').rmSync('air/packages/_lint-probe',{recursive:true,force:true})"
```

Expected: the second command prints a `require-await` diagnostic for `packages/_lint-probe/src/index.ts` and exits non-zero, showing upstream rules apply under `air/packages/*`. The probe directory is removed.

- [ ] **Step 7: Commit**

```bash
git add air/scripts/gen-oxlintrc.ts air/scripts/tests/gen-oxlintrc.spec.ts air/.oxlintrc.json
git commit -m "build(air): derive the AIR lint config from upstream oxlint rules"
```

---

### Task 3: Profile smoke script

**Files:**
- Create: `air/scripts/smoke-profile.ts`

**Interfaces:**
- Consumes: `air/bundles/air`, `air/examples/ollama.profile.cordis.patch.yml`, the source launcher `apps/cli/src/bin.ts` run as `node --import tsx/esm`.
- Produces: `pnpm -C air run smoke` (exit 0 when the `air-smoke` profile composes without unmatched targets and boots to its ready line without disabled, failed, or pending rows). Environment: `DSH_HOME` (defaults to a fresh temp dir), `AIR_SMOKE_PORT` (default `3187`), `AIR_SMOKE_SECONDS` (default `90`, the ready-line deadline).

The script is TypeScript run by tsx so it works on native Windows and Linux; it calls the launcher through `process.execPath` instead of `pnpm`, which avoids shell differences. It stops the app as soon as the ready line appears, so a passing run takes about 8 seconds (measured 2026-10-08 on Fedora, 7.9 s).

- [ ] **Step 1: Write the script**

`air/scripts/smoke-profile.ts`:

```ts
/** Compose and boot the AIR bundle in a throwaway profile under an isolated DSH_HOME (Windows and Linux). */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const home = process.env.DSH_HOME ?? mkdtempSync(join(tmpdir(), 'air-smoke-'))
const port = process.env.AIR_SMOKE_PORT ?? '3187'
const timeoutMs = Number(process.env.AIR_SMOKE_SECONDS ?? '90') * 1000
const profile = 'air-smoke'
const env = { ...process.env, DSH_HOME: home }
const launcher = ['--import', 'tsx/esm', join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')]
const PROBLEM = /unmatched|incompatible|failed|disabling profile plugin row|did not activate|pending/i

function fail(message: string, detail = ''): never {
  console.error(`smoke: ${message}`)
  if (detail !== '') console.error(detail)
  process.exit(1)
}

function dsh(args: readonly string[]): { stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [...launcher, ...args], { cwd: repoRoot, env, encoding: 'utf8' })
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
if (PROBLEM.test(dump.stderr)) fail('composition problems:', dump.stderr)
if (!dump.stdout.includes('patched by @air/dsh-air-bundle')) fail('AIR bundle layer missing from the composed tree')

const child = spawn(process.execPath, [...launcher, '--profile', profile, '--no-open', '--port', port], { cwd: repoRoot, env })
let out = ''
let err = ''
child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString() })
const ready = `dsh web: http://127.0.0.1:${port}/`
const started = Date.now()
const timer = setInterval(() => {
  if (out.includes(ready)) {
    clearInterval(timer)
    child.kill()
    if (PROBLEM.test(err)) fail('boot problems:', err)
    console.log(`smoke: ok (${home})`)
    process.exit(0)
  }
  if (child.exitCode !== null) {
    clearInterval(timer)
    fail(`boot exited early with code ${String(child.exitCode)}`, err)
  }
  if (Date.now() - started > timeoutMs) {
    clearInterval(timer)
    child.kill()
    fail(`no ready line within ${String(timeoutMs / 1000)} s`, err)
  }
}, 250)
```

- [ ] **Step 2: Run it**

Run: `pnpm -C air run smoke`
Expected: last line `smoke: ok (<temp dir>)`; nothing written under the user's `.dsh` directory.

- [ ] **Step 3: Check that the script fails on a broken bundle**

Append a row that names a package that does not exist, run the smoke, then restore the file with git:

```sh
node -e "require('fs').appendFileSync('air/bundles/air/cordis.patch.yml', '\n- insert:\n    - id: air-probe\n      name: \'@air/dsh-missing\'\n')"
pnpm -C air run smoke
git checkout -- air/bundles/air/cordis.patch.yml
git status --short air/bundles/air/cordis.patch.yml
```

Expected: the smoke prints `smoke: composition problems:` or `smoke: boot problems:` naming `air-probe` or `@air/dsh-missing` and exits 1; after the checkout, `git status` prints nothing. If the smoke exits 0 instead, the launcher reported the failure with wording the `PROBLEM` pattern does not cover: read the captured stderr, add the wording to the pattern, and re-run this step.

- [ ] **Step 4: Commit**

```bash
git add air/scripts/smoke-profile.ts
git commit -m "test(air): add a cross-platform compose and boot smoke for the AIR bundle"
```

---

### Task 4: CI job and documentation

**Files:**
- Create: `.github/workflows/air.yml`
- Modify: `air/UPSTREAM-DELTA.md`
- Modify: `air/README.md`

**Interfaces:**
- Consumes: `pnpm -C air run build|typecheck|lint|test`, `air/scripts/smoke-profile.ts`, root gates `verify-no-unknown-casts`, `verify-concrete-terms`, `verify-repository-references`, `verify-translation-pairing`.
- Produces: a CI signal on pushes and pull requests to `air/main`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/air.yml`:

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
        run: pnpm -C air --filter "./packages/*" --filter "./bundles/*" run build
      - name: Typecheck AIR packages
        run: pnpm -C air --filter "./packages/*" --filter "./bundles/*" run typecheck
      - name: Lint AIR packages
        run: pnpm -C air run lint
      - name: Test AIR workspace
        run: pnpm -C air exec vitest run && pnpm -C air --filter "./packages/*" --filter "./bundles/*" run test

      - name: Root gates that scan air/
        run: |
          pnpm run verify-no-unknown-casts
          pnpm run verify-concrete-terms
          pnpm run verify-repository-references
          pnpm run verify-translation-pairing

      - name: Compose and boot the AIR profile
        env:
          DSH_HOME: ${{ runner.temp }}/dsh-home
        run: pnpm -C air run smoke
```

- [ ] **Step 2: Validate the workflow syntax locally**

Run (repository root): `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/air.yml','utf8')); console.log('yaml ok')"`
Expected: `yaml ok` (`js-yaml` is a root devDependency).

- [ ] **Step 3: Add the workflow to `air/UPSTREAM-DELTA.md`**

Append this row to the table:

```markdown
| `.github/workflows/air.yml` | New file | CI for `air/main`: builds the fork, then builds, typechecks, lints, tests, and smoke-boots the AIR workspace |
```

- [ ] **Step 4: Add a toolchain section to `air/README.md`**

Insert before `## Known issues`:

````markdown
## Toolchain

Run the root build first; AIR packages link to its `lib/` outputs.

```sh
pnpm install && pnpm run build        # repository root
pnpm -C air install                   # AIR workspace (pnpm 11.7.0, lockfile committed)
pnpm -C air run build                 # every AIR package
pnpm -C air run typecheck
pnpm -C air run lint                  # fails if air/.oxlintrc.json is stale; regenerate with lint:gen
pnpm -C air run test
pnpm -C air run smoke                 # isolated DSH_HOME: compose and boot the AIR bundle
```

New packages follow the templates in [plans/spikes/01-toolchain.md](plans/spikes/01-toolchain.md): `tsconfig.build.json` extends `../../tsconfig.base.json`, upstream packages are `link:` devDependencies with `^0.2.0-rc.1` peers, and each product-visible plugin has a native-resolution Loader test whose `cordis.yml` is written inside the package directory.

Upstream workflows under `.github/workflows/` also run on pushes to this fork; disable the ones that need upstream secrets in the fork's Actions settings.
````

- [ ] **Step 5: Run the gates that scan `air/`**

Run (repository root), one command at a time: `pnpm run verify-concrete-terms`, `pnpm run verify-repository-references`, `pnpm run verify-translation-pairing`, `pnpm run verify-no-unknown-casts`
Expected: each prints its success line.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/air.yml air/UPSTREAM-DELTA.md air/README.md
git commit -m "ci(air): build, lint, test, and smoke-boot the AIR workspace on air/main"
```

---

## Self-Review

- Windows: no step needs bash, `chmod`, or a POSIX path; the smoke script and the lint probe use Node file APIs.
- Spec coverage (spike 01 "Recommended toolchain"): pinned pnpm (Task 1), `autoInstallPeers: false` (Task 1), shared tools declared once (Task 1), committed lockfile with `--frozen-lockfile` in CI (Tasks 1, 4), shared tsconfig (Task 1), AIR lint config (Task 2), isolated-home profile smoke (Task 3), CI job with the root gates that scan `air/` (Task 4), UPSTREAM-DELTA entry (Task 4). The client build config for browser halves is deferred to the first plan that ships a client plugin (plan 03 permissions), which copies spike 01 §5.
- No placeholders: every file has full content; every step has a command and expected output.
- Names used by later plans: `air/tsconfig.base.json`, scripts `build`, `typecheck`, `lint`, `test`, `smoke`; later plans extend these without renaming.
