# AIR Desktop Shell (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Owner decision 2026-10-03: identifiers on hold.** The app id, URL scheme, `desktopName`, executable name, and release tag prefix are provisional placeholders until the product name is final. They live only in `air/apps/desktop/brand.json`; code, tests, and the workflow read them from there (the one unavoidable copy, `desktopName` in `package.json`, is checked against the brand file by a test). Release and publish steps are gated: `brand.json` carries `identifiersFinal: false`, a build with `AIR_DESKTOP_RELEASE=1` fails until the owner sets it to `true` after the name is final, and the release workflow cannot publish before that. Do not publish a release or ask users to install a build under the placeholders; changing them later resets user data and the global-hotkey consent.

> **Other owner decisions applied here.** rpm builds only notify about updates and link to the release page; Windows and AppImage update automatically. The first Windows release is unsigned. macOS is out of scope. Teammates develop on native Windows, so every command step uses `pnpm`, `node`, or `git` only.

**Goal:** Ship an AIR-owned Electron desktop app for Windows (NSIS) and Linux (rpm, AppImage) that boots the `air` profile from a bundled production tree and adds close/background policy, tray, global hotkey, quick entry, updates, and CI artifacts.

**Architecture:** Two out-of-tree workspaces. `air/apps/desktop-host` is a small Node entry that calls `runProfile` from `@deepseek-ai/dsh/profile-boot` with `--port 0` (the operating system picks a free loopback port, as upstream's own desktop Host does) and reports `{ type: 'ready', url }` with the real port over a Node IPC channel. `air/apps/desktop` is the Electron main process: it spawns the Host with `ELECTRON_RUN_AS_NODE=1` from a staged production tree shipped as `extraResources`, loads the authenticated loopback URL in a sandboxed window locked to that origin (the origin changes on every Host start, so the lock reads the current one), and owns all operating-system integration. Logic lives in Electron-free modules tested with fakes; files under `src/electron/` are thin adapters.

**Tech Stack:** Electron 44.0.0, electron-builder ^26.15.3, electron-updater ^6.8.9, TypeScript 6, tsdown 0.22, Vitest 4, Playwright (`_electron`), pnpm 11.7.0, GitHub Actions.

**Spec:** [research/notes/09-desktop-cross-os.md](../../research/notes/09-desktop-cross-os.md) (approved design, option b) and [research/notes/13-desktop-shell-practice.md](../../research/notes/13-desktop-shell-practice.md) (practices P1–P16 and the staging spike). Owner decisions: [README.md](README.md), section "Owner decisions".

## Revision log

Revised 2026-10-08 against upstream `dsh-v0.2.1-alpha.1` (the plan was written against `dsh-v0.2.0-rc.2`). Each entry gives the change and the reason.

1. **Dynamic Host port.** The fixed port 19487, `brand.hostPort`, `AIR_DESKTOP_PORT`, the Host's port argument, and the port-conflict error dialog are gone. The Host passes `--port 0` and reports the actual origin in the `ready` message. Reason: upstream's desktop Host made the same change between the two tags (`apps/desktop-host/src/index.ts`), a fixed port fails whenever another program or a second profile holds it, and it was the only startup failure the shell could not recover from. Consequences handled in the plan: the origin lock, permission checks, and the quick-entry window read the current origin instead of a captured one; a Host restart gets a new origin and a new token.
2. **Upstream calls re-verified at `dsh-v0.2.1-alpha.1`** by reading the tree: `@deepseek-ai/dsh/profile-boot` is still exported and `runProfile` takes the same options (`environment`, `profile`, `resolvedProfile`, `patchFiles`, `args`, `packageManager`); `initProfile`, `loadProfileDirectory`, `resolveProfileDir`, `PROFILE_TEMPLATES.web`, `reportSkippedBundles`, `loadLayeredEnv` keep their signatures (the only change is that `loadProfileDirectory` now drops retired bundles); `ctx.connection.authenticatedUrl` and `ctx.webServer.port` (the OS-assigned port when configured as 0) are unchanged; `@deepseek-ai/dsh-tool-workspace-dependencies` still takes `source` and `root`. Electron stays at 44.0.0, electron-builder at 26.15.3 and electron-updater at 6.8.x (the versions upstream's `apps/desktop` resolves to). Nothing was compiled again; see Self-Review.
3. **Peer fill is computed, not counted.** An offline count of the manifests at this tag finds 28 workspace packages that are required only as peers (27 at the earlier tag; invariant packages are gone, others were added). The text no longer promises a number: the staging script computes the list from the deployed tree and prints it. Reason: the count changes with every upstream sync.
4. **Windows-first.** `pnpm` is started through one shared helper (`scripts/pnpm.ts`) instead of two copies; the commit and tag steps no longer use `&&` (not valid in Windows PowerShell 5.1); fenced command blocks are no longer labeled `bash`; no step needs `mktemp`, `cp`, `rm`, or a POSIX shell. Linux-only checks (`gdbus`, `pgrep`, `dnf`) stay labeled as Fedora checks, each with a Windows counterpart where one exists.
5. **Identifiers only in the brand file, release gated.** `brand.json` gains `releaseTagPrefix` and `identifiersFinal`; tests derive expected identifiers from the brand file instead of literals; `package.ts` refuses release builds while `identifiersFinal` is `false`; a test checks that the workflow's tag filter matches `releaseTagPrefix`. Reason: the owner put the identifiers on hold, and a literal in a test or the workflow would survive the rename unnoticed.
6. **Alignment with plan 00.** Plan 00 already creates `air/pnpm-workspace.yaml`, `air/.gitignore`, the lint script (which covers `apps`), and the CI job (which excludes `apps/*`). Step 1 of Task 1 now edits those files instead of replacing them. `main.ts` writes its smoke markers with `process.stdout.write` because plan 00's lint config forbids `console` in `apps/*/src`. Plan 00's lint step already covers `apps`; Task 8 runs it once locally before the first push. Installing the workspace downloads Electron (about 110 MB); plan 00's CI job should install with `--ignore-scripts` (recorded in the roadmap obligations).
7. **Host supervision.** The supervisor redacts per line instead of per chunk (a token split across two output chunks used to reach `host.log`); reports a restart so the window shows a "restarting" page instead of a dead page; on Windows the shell ends the whole Host process tree with `taskkill` when the Host ignores a shutdown request (a plain kill left the agent's child processes running); the shell stops Host-load rejections from reaching standard error, where Electron prints the failing URL and its token.
8. **Navigation lock.** `lockToOrigin` takes a function that returns the current origin; with no Host ready, only external web links pass. The permission handlers and quick-entry window use the same current origin.
9. **Updates on unsigned builds.** `win.verifyUpdateCodeSignature` was `false` unconditionally, which would have kept update verification off after signing starts; it is now `false` only for unsigned builds (a signed build also needs `publisherName`, a Follow-up item). `air/SAFETY.md` and the README state the limit: update integrity rests on the SHA-512 values in the release's update files, so anyone who can publish a release to the update repository can replace the app on every machine that auto-updates. Windows and AppImage still update automatically, as the owner decided; the draft release step keeps a human between a build and the feed.
10. **Install size.** The staging script removes JavaScript and declaration source maps, prints the number of files, bytes, the largest packages, and the longest relative path (the Windows path-length risk), and electron-builder keeps only the `en-US` Chromium locales. The staged tree stays loose files; the larger reductions remain in Follow-up plans.
11. **Moved to Follow-up plans: start at login.** The Linux autostart file, the Windows login item, the `--hidden` launch flag, the setting, and the menu entry are removed from Tasks 3 to 6. Reason: no owner decision or demo step needs them, the Windows login item cannot be tested before a signed build exists, and they write to the user's startup configuration under placeholder identifiers.
12. **Smaller fixes.** The URL scheme handler registers only in packaged builds (a development run no longer registers `electron` for the placeholder scheme on a teammate's machine); a deep link only focuses the window, and routing a link to a conversation is a Follow-up plan; the quick-entry window is re-created when the Host origin changes; Electron tests no longer hard-code the port; the test-file counts in the "Expected" lines were recomputed.

## Global Constraints

- Node `^22.19.0 || >=24.0.0`; pnpm `11.7.0`; Electron `44.0.0` (the version upstream's `apps/desktop` resolves to); ESM only; TypeScript `strict`; no `as unknown` casts.
- All AIR code is under `air/`. New workspaces are `air/apps/desktop-host` and `air/apps/desktop`; `air/pnpm-workspace.yaml` gains `apps/*`. Upstream's `apps/desktop` and `apps/desktop-host` are not modified. The only in-tree file is `.github/workflows/air-desktop.yml`.
- Every script is a Node/tsx script that runs unchanged in PowerShell on Windows and in a POSIX shell on Fedora. No bash, no `cp`, no `rm`, no `test -f`. Commands in this plan are written to be run from the repository root in either shell.
- Security defaults: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, no remote module, the window navigates only to the Host's current loopback origin, the Host binds loopback only on an OS-assigned port, the token is never logged (output is redacted per line, and load errors are caught before Electron prints them).
- Brand values come only from `air/apps/desktop/brand.json` with `{{PLACEHOLDER}}` values resolved at build time. No upstream product name in user-facing strings. The upstream `LICENSE` and `THIRD_PARTY_NOTICES.md` ship in the packaged app under `resources/runtime/licenses/`.
- Out-of-tree plugins cannot add session event types. The shell writes its own logs under `<userData>/logs`.
- Every file changed outside `air/` and `research/` is listed in `air/UPSTREAM-DELTA.md`.
- Markdown: English only; never the banned origin-label word checked by `verify-concrete-terms`; no git commit hashes; no URLs under the upstream working organization (use `github.com/deepseek-ai/deepseek-harness`).
- Prerequisites: plan 00 is done through its Task 2 (`air/package.json` pins the toolchain, `air/tsconfig.base.json`, `air/pnpm-workspace.yaml`, `air/.gitignore`, and the lint configuration exist) and the root build is finished (`pnpm install` then `pnpm run build` at the repository root).
- Release gate: nothing in this plan publishes a release, creates a tag, or pushes a build while `identifiersFinal` in `brand.json` is `false`. Local and CI builds without `AIR_DESKTOP_RELEASE=1` stay allowed.

---

## File Structure

| File | Responsibility |
|---|---|
| `air/pnpm-workspace.yaml` | Plan 00's file; adds `apps/*` and `allowBuilds` for Electron (modified) |
| `air/.gitignore` | Plan 00's file; adds `.stage/`, `dist/`, `test-results/` (modified) |
| `air/apps/desktop/package.json` | App manifest, scripts, `desktopName` |
| `air/apps/desktop/brand.json` | Single source for product name, ids, scheme, release tag prefix, publish target, and the `identifiersFinal` release gate |
| `air/apps/desktop/scripts/pnpm.ts` | Starts pnpm from a script on Windows and POSIX |
| `air/apps/desktop/scripts/stage-lib.ts` | Target naming, missing-dependency check, workspace peer fill, pruning, source-map removal, size report |
| `air/apps/desktop/scripts/stage-runtime.ts` | CLI: `pnpm deploy`, fill, prune, copy Host, seed patch, licenses |
| `air/apps/desktop/scripts/verify-stage.ts` | Boot the Host from a staged tree and check ready, cookie exchange, shutdown |
| `air/apps/desktop/scripts/boot-probe.mjs` | Minimal Host used by `verify-stage` before the real Host exists |
| `air/apps/desktop/scripts/resolve-brand.ts` | Writes `lib/brand.resolved.json` from `brand.json` |
| `air/apps/desktop/scripts/gen-placeholder-icon.ts` | Writes a neutral placeholder `build/icon.png` |
| `air/apps/desktop/scripts/builder-config.ts` | electron-builder configuration factory |
| `air/apps/desktop/scripts/package.ts` | CLI: build, stage, run electron-builder |
| `air/apps/desktop/src/brand.ts` | Placeholder resolution and validation |
| `air/apps/desktop/src/paths.ts` | Runtime, Host entry, logs, and settings locations |
| `air/apps/desktop/src/settings.ts` | Settings file: parse, defaults, save |
| `air/apps/desktop/src/redact.ts` | Removes token values from text |
| `air/apps/desktop/src/log.ts` | Size-bounded log file writer |
| `air/apps/desktop/src/navigation.ts` | Origin lock and permission decisions, the reconnect page |
| `air/apps/desktop/src/host-supervisor.ts` | Start, ready timeout, restart policy, stop |
| `air/apps/desktop/src/single-instance.ts` | Second-instance argument parsing |
| `air/apps/desktop/src/close-policy.ts` | Quit or hide decision per platform |
| `air/apps/desktop/src/tray-support.ts` | StatusNotifier host detection |
| `air/apps/desktop/src/background-portal.ts` | Background portal request arguments |
| `air/apps/desktop/src/menu.ts` | Application and tray menu templates |
| `air/apps/desktop/src/hotkey.ts` | Accelerator validation and registration state |
| `air/apps/desktop/src/quick-entry.ts` | Quick-entry window options and URL |
| `air/apps/desktop/src/updates.ts` | Update mode per package type and updater wiring |
| `air/apps/desktop/src/electron/*.ts` | Thin Electron adapters for the modules above |
| `air/apps/desktop/src/main.ts` | Lifecycle wiring |
| `air/apps/desktop/tests/*.spec.ts` | Unit tests with fakes |
| `air/apps/desktop/tests/smoke/packaged.e2e.ts` | Playwright smoke against the unpacked build |
| `air/apps/desktop/tests/workflow.spec.ts` | Checks the workflow's tag filter against the brand file |
| `air/apps/desktop-host/src/{protocol,args,profile,run-host,boot,index}.ts` | Host entry and its pure parts |
| `air/apps/desktop-host/tests/*.spec.ts`, `tests/real-boot.e2e.ts` | Unit tests and one real boot |
| `.github/workflows/air-desktop.yml` | Matrix build, smoke, draft release (in-tree, listed in UPSTREAM-DELTA) |
| `air/apps/desktop/README.md`, `air/README.md`, `air/ONBOARDING.md`, `air/SAFETY.md`, `air/UPSTREAM-DELTA.md` | Documentation |

Staged tree layout produced by Task 1 (`air/apps/desktop/.stage/<target>/runtime/`, where `<target>` is `linux-x64` or `win-x64`):

```
runtime/
  package.json            the @deepseek-ai/dsh package (install anchor)
  lib/                    dsh CLI build output
  node_modules/           hoisted production tree, filled workspace peers, @air/dsh-air-bundle
  air-host/index.js       built AIR Host entry (Task 2)
  air-defaults/cordis.patch.yml   seed profile patch (local Ollama route)
  licenses/               upstream LICENSE and THIRD_PARTY_NOTICES.md
  stage.json              target, dsh version, filled packages, size report
```

The Host entry sits inside the deployed `@deepseek-ai/dsh` package directory, so `@deepseek-ai/dsh/profile-boot` resolves by package self-reference and every other `@deepseek-ai/*` import resolves from `runtime/node_modules` (verified in note 13 section 2).

---

### Task 1: Packaging spike as a staging script

Turns the passed scratch spike (note 13 section 2) into a repeatable script and repeats the boot check on each developer OS. Practices P1, P2.

**Pass criteria:** on Fedora and on native Windows, `pnpm -C air/apps/desktop run stage --verify` exits 0 and prints `boot ok`. **Fallbacks if it fails on Windows:** (1) if `pnpm deploy` fails on path length, stage into a short path with `--out C:\air-stage`; (2) if hoisted linking fails, re-run with `AIR_STAGE_LINKER=isolated` and report the symlink count, then stop and escalate, because NSIS cannot package junction trees reliably; (3) if neither works, port upstream's pack-and-install route (`apps/desktop/scripts/prepare-package-set.ts` and `prepare-dsh.ts`) as a follow-up plan.

**Files:**
- Modify: `air/pnpm-workspace.yaml` (created by plan 00)
- Modify: `air/.gitignore` (created by plan 00)
- Create: `air/apps/desktop/package.json`
- Create: `air/apps/desktop/tsconfig.build.json`, `air/apps/desktop/tsconfig.json`, `air/apps/desktop/vitest.config.ts`
- Create: `air/apps/desktop/scripts/pnpm.ts`, `scripts/stage-lib.ts`, `scripts/stage-runtime.ts`, `scripts/verify-stage.ts`, `scripts/boot-probe.mjs`
- Test: `air/apps/desktop/tests/stage-lib.spec.ts`

**Interfaces:**
- Consumes: root build outputs (`apps/cli/lib/profile-boot.js`), `air/bundles/air`, `air/examples/ollama.profile.cordis.patch.yml`.
- Produces:
  - `stageTarget(platform: NodeJS.Platform, arch: string): StageTarget` where `type StageTarget = 'linux-x64' | 'win-x64'`
  - `missingRequired(stageDir: string): Map<string, string[]>`
  - `fillFromWorkspace(stageDir: string, index: ReadonlyMap<string, string>, roots?: readonly string[]): { copied: string[]; external: string[] }`
  - `pruneStage(stageDir: string, target: StageTarget): string[]`; `removeSourceMaps(stageDir: string): number`; `sizeReport(stageDir: string, top?: number): SizeReport`
  - `pnpmArgs(args: readonly string[], windows: boolean): string[]` and `runPnpm(args: readonly string[], options: { cwd: string; capture?: boolean }): string` from `scripts/pnpm.ts`
  - `bootStage(options: BootStageOptions): Promise<StageBootResult>` from `scripts/verify-stage.ts`
  - Command `pnpm -C air/apps/desktop run stage [--verify] [--primary-runtime] [--out <dir>]` writing `air/apps/desktop/.stage/<target>/runtime/`
  - Host argument order used by every later task: `<hostEntry> <runtimeDir> <profile> [primaryRuntimeDir]` (the Host always asks for port 0 and reports its origin)

- [ ] **Step 1: Add the app workspaces**

Plan 00 created `air/pnpm-workspace.yaml` with `bundles/*`, `packages/*`, and `autoInstallPeers: false`. Add the `apps/*` member line and the Electron build approval so that the file reads:

```yaml
packages:
  - bundles/*
  - packages/*
  - apps/*

# Peers such as @deepseek-ai/cordis come from the fork through link: dev
# dependencies; auto-installing them would fetch a second copy from npm.
autoInstallPeers: false

# pnpm blocks dependency install scripts unless reviewed here. Electron's
# script downloads the Electron binary; the Squirrel helper is unused (NSIS).
allowBuilds:
  electron: true
  electron-winstaller: false
```

Append to `air/.gitignore` (plan 00 created it with `node_modules/`, `lib/`, `coverage/`, and `.loader-*/`):

```gitignore
.stage/
dist/
test-results/
```

The install now downloads the Electron binary (about 110 MB). A teammate who does not work on the desktop app can run `pnpm -C air install --ignore-scripts` instead; run `pnpm -C air rebuild electron` before the first desktop task.

- [ ] **Step 2: Create the app manifest and compiler configs**

`air/apps/desktop/package.json`:

```json
{
  "name": "@air/desktop",
  "description": "AIR desktop shell: Electron main process around the AIR Host",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/main.js",
  "scripts": {
    "stage": "tsx scripts/stage-runtime.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

`air/apps/desktop/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/apps/desktop/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "scripts", "tests"]
}
```

`air/apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

/** Unit tests only; the packaged smoke under tests/smoke runs through Playwright. */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; `air/apps/desktop` is listed by `pnpm -C air ls -r --depth -1`.

- [ ] **Step 3: Write the failing tests for the staging helpers**

`air/apps/desktop/tests/stage-lib.spec.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pnpmArgs } from '../scripts/pnpm.ts'
import {
  airPackageIndex, fillFromWorkspace, missingRequired, parseWorkspaceList, pruneStage, removeSourceMaps, sizeReport, stageTarget,
} from '../scripts/stage-lib.ts'

const roots: string[] = []

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'air-stage-'))
  roots.push(root)
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

const manifest = (value: object): string => JSON.stringify(value)

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('stageTarget', () => {
  it('names the two supported targets', () => {
    expect(stageTarget('linux', 'x64')).toBe('linux-x64')
    expect(stageTarget('win32', 'x64')).toBe('win-x64')
  })

  it('rejects other platforms', () => {
    expect(() => stageTarget('darwin', 'arm64')).toThrow('unsupported target darwin-arm64')
  })
})

describe('missingRequired', () => {
  it('reports absent dependencies and non-optional peers, and accepts the root package itself', () => {
    const stage = tree({
      'package.json': manifest({ name: 'root', dependencies: { a: '1' } }),
      'node_modules/a/package.json': manifest({
        name: 'a',
        dependencies: { b: '1' },
        peerDependencies: { c: '1', d: '1', root: '1' },
        peerDependenciesMeta: { d: { optional: true } },
      }),
      'node_modules/@s/e/package.json': manifest({ name: '@s/e', peerDependencies: { c: '1' } }),
    })
    // Packages are visited in sorted order: the root, then `@s/e`, then `a`.
    expect([...missingRequired(stage).entries()]).toEqual([
      ['c', ['@s/e', 'a']],
      ['b', ['a']],
    ])
  })
})

describe('fillFromWorkspace', () => {
  it('copies manifest and files entries, follows required names, and lists unknown names', () => {
    const workspace = tree({
      'c/package.json': manifest({ name: 'c', files: ['lib/*.js', 'assets'], dependencies: { f: '1' }, peerDependencies: { x: '1' } }),
      'c/lib/index.js': 'export {}',
      'c/lib/index.d.ts': 'export {}',
      'c/assets/a.txt': 'a',
      'c/src/index.ts': 'export {}',
      'f/package.json': manifest({ name: 'f' }),
      'f/lib/index.js': 'export {}',
      'bundle/package.json': manifest({ name: '@air/b', files: ['cordis.patch.yml'] }),
      'bundle/cordis.patch.yml': '[]',
    })
    const stage = tree({
      'package.json': manifest({ name: 'root' }),
      'node_modules/a/package.json': manifest({ name: 'a', peerDependencies: { c: '1' } }),
    })
    const index = new Map([['c', join(workspace, 'c')], ['f', join(workspace, 'f')], ['@air/b', join(workspace, 'bundle')]])
    const result = fillFromWorkspace(stage, index, ['@air/b'])
    expect(result).toEqual({ copied: ['@air/b', 'c', 'f'], external: ['x'] })
    const modules = join(stage, 'node_modules')
    expect(existsSync(join(modules, 'c', 'lib', 'index.js'))).toBe(true)
    expect(existsSync(join(modules, 'c', 'assets', 'a.txt'))).toBe(true)
    expect(existsSync(join(modules, 'c', 'lib', 'index.d.ts'))).toBe(false)
    expect(existsSync(join(modules, 'c', 'src'))).toBe(false)
    expect(existsSync(join(modules, 'f', 'lib', 'index.js'))).toBe(true)
    expect(existsSync(join(modules, '@air', 'b', 'cordis.patch.yml'))).toBe(true)
  })
})

describe('pruneStage', () => {
  it('removes .bin and native files of other platforms', () => {
    const stage = tree({
      'package.json': manifest({ name: 'root' }),
      'node_modules/.bin/tool': '',
      'node_modules/@deepseek-ai/node-addon-system/package.json': manifest({ name: '@deepseek-ai/node-addon-system' }),
      'node_modules/@deepseek-ai/node-addon-system-linux-x64/package.json': '{}',
      'node_modules/@deepseek-ai/node-addon-system-darwin-arm64/package.json': '{}',
      'node_modules/node-pty/prebuilds/linux-x64/pty.node': '',
      'node_modules/node-pty/prebuilds/win32-x64/conpty.node': '',
      'node_modules/node-pty/prebuilds/darwin-x64/pty.node': '',
    })
    expect(pruneStage(stage, 'linux-x64')).toEqual([
      '.bin',
      join('@deepseek-ai', 'node-addon-system-darwin-arm64'),
      join('node-pty', 'prebuilds', 'darwin-x64'),
      join('node-pty', 'prebuilds', 'win32-x64'),
    ])
    const modules = join(stage, 'node_modules')
    expect(existsSync(join(modules, '@deepseek-ai', 'node-addon-system'))).toBe(true)
    expect(existsSync(join(modules, '@deepseek-ai', 'node-addon-system-linux-x64'))).toBe(true)
    expect(existsSync(join(modules, 'node-pty', 'prebuilds', 'linux-x64', 'pty.node'))).toBe(true)
  })
})

describe('removeSourceMaps', () => {
  it('removes JavaScript and declaration source maps and keeps other .map files', () => {
    const stage = tree({
      'package.json': manifest({ name: 'root' }),
      'node_modules/a/index.js': '',
      'node_modules/a/index.js.map': '',
      'node_modules/a/index.d.ts.map': '',
      'node_modules/@s/b/lib/x.mjs.map': '',
      'node_modules/a/charmap.map': 'data',
    })
    expect(removeSourceMaps(stage)).toBe(3)
    const modules = join(stage, 'node_modules')
    expect(existsSync(join(modules, 'a', 'index.js'))).toBe(true)
    expect(existsSync(join(modules, 'a', 'index.js.map'))).toBe(false)
    expect(existsSync(join(modules, 'a', 'charmap.map'))).toBe(true)
    expect(removeSourceMaps(join(stage, 'missing'))).toBe(0)
  })
})

describe('sizeReport', () => {
  it('counts files and bytes, ranks packages, and finds the longest relative path', () => {
    const stage = tree({
      'package.json': manifest({ name: 'root' }),
      'node_modules/small/index.js': 'ab',
      'node_modules/@s/big/lib/deep/file.js': 'abcdefgh',
      'node_modules/@s/big/package.json': '{}',
    })
    const report = sizeReport(stage, 2)
    expect(report.files).toBe(4)
    expect(report.bytes).toBe(2 + 8 + 2 + manifest({ name: 'root' }).length)
    expect(report.largest.map(entry => entry.name)).toEqual(['(root)', '@s/big'])
    expect(report.longestPath).toBe(join('node_modules', '@s', 'big', 'lib', 'deep', 'file.js'))
  })
})

describe('pnpmArgs', () => {
  it('quotes arguments with spaces only on Windows, where pnpm runs through a shell', () => {
    expect(pnpmArgs(['--config.store-dir=C:\\My Store', 'run'], true)).toEqual(['"--config.store-dir=C:\\My Store"', 'run'])
    expect(pnpmArgs(['a b'], false)).toEqual(['a b'])
  })
})

describe('workspace indexes', () => {
  it('parses the pnpm workspace listing', () => {
    const index = parseWorkspaceList(JSON.stringify([{ name: 'a', path: '/w/a' }, { path: '/w/unnamed' }]))
    expect([...index.entries()]).toEqual([['a', '/w/a']])
  })

  it('indexes AIR bundles and packages by name', () => {
    const air = tree({
      'bundles/air/package.json': manifest({ name: '@air/dsh-air-bundle' }),
      'packages/x/package.json': manifest({ name: '@air/dsh-x' }),
      'packages/empty/readme.txt': '',
    })
    expect([...airPackageIndex(air).keys()].sort()).toEqual(['@air/dsh-air-bundle', '@air/dsh-x'])
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, `Failed to resolve import "../scripts/pnpm.ts"` (and `"../scripts/stage-lib.ts"`).

- [ ] **Step 5: Implement the staging helpers**

`air/apps/desktop/scripts/pnpm.ts` (the one place that starts pnpm; `stage-runtime.ts` and `package.ts` use it):

```ts
/** Start pnpm from a Node script on Windows and POSIX. */

import { spawnSync } from 'node:child_process'

/**
 * Arguments as `spawnSync` needs them. On Windows pnpm is a `.cmd` shim that only runs through a
 * shell, so an argument with a space (a store path under a user name) is quoted.
 * @param args - pnpm arguments.
 * @param windows - whether the script runs on Windows.
 * @returns the argument vector.
 */
export function pnpmArgs(args: readonly string[], windows: boolean): string[] {
  return windows ? args.map(arg => (/\s/u.test(arg) ? `"${arg}"` : arg)) : [...args]
}

/**
 * Run pnpm and wait for it.
 * @param args - pnpm arguments.
 * @param options - working directory, and whether to return standard output instead of streaming it.
 * @returns standard output when `capture` is set, otherwise empty text.
 * @throws when pnpm exits with a non-zero status.
 */
export function runPnpm(args: readonly string[], options: { cwd: string; capture?: boolean }): string {
  const windows = process.platform === 'win32'
  const capture = options.capture === true
  const result = spawnSync('pnpm', pnpmArgs(args, windows), {
    cwd: options.cwd, shell: windows, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (result.status !== 0) throw new Error(`air desktop: pnpm ${args.join(' ')} exited with ${String(result.status)}`)
  return capture ? result.stdout : ''
}
```

`air/apps/desktop/scripts/stage-lib.ts`:

```ts
/** Staging helpers for the desktop runtime tree: target naming, dependency checks, workspace fill, pruning. */

import { cpSync, existsSync, globSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

/** A platform and architecture the desktop app is packaged for. */
export type StageTarget = 'linux-x64' | 'win-x64'

/** The package.json fields the staging step reads. */
interface Manifest {
  name?: string
  version?: string
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/**
 * Name the staging target for a build host.
 * @param platform - `process.platform` of the build host.
 * @param arch - `process.arch` of the build host.
 * @returns the target name.
 * @throws when the host is not a supported desktop target.
 */
export function stageTarget(platform: NodeJS.Platform, arch: string): StageTarget {
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'win32' && arch === 'x64') return 'win-x64'
  throw new Error(`air desktop stage: unsupported target ${platform}-${arch}`)
}

/**
 * Read a package manifest.
 * @param dir - package directory.
 * @returns the parsed manifest fields used by staging.
 */
export function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
}

function requiredNames(manifest: Manifest): string[] {
  const peers = Object.keys(manifest.peerDependencies ?? {})
    .filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true)
  return [...Object.keys(manifest.dependencies ?? {}), ...peers]
}

function installedPackageDirs(stageDir: string): string[] {
  const modules = join(stageDir, 'node_modules')
  const dirs = [stageDir]
  if (!existsSync(modules)) return dirs
  for (const entry of readdirSync(modules).sort()) {
    if (entry.startsWith('.')) continue
    const path = join(modules, entry)
    if (!entry.startsWith('@')) {
      dirs.push(path)
      continue
    }
    for (const scoped of readdirSync(path).sort()) dirs.push(join(path, scoped))
  }
  return dirs.filter(dir => existsSync(join(dir, 'package.json')))
}

/**
 * List required packages that a staged tree does not contain. `pnpm deploy` installs
 * dependencies but not packages named only as peers, so a deployed tree can be incomplete.
 * @param stageDir - staged tree root (the deployed package directory).
 * @returns missing package name to the names of the packages that require it.
 */
export function missingRequired(stageDir: string): Map<string, string[]> {
  const modules = join(stageDir, 'node_modules')
  const rootName = readManifest(stageDir).name
  const missing = new Map<string, string[]>()
  for (const dir of installedPackageDirs(stageDir)) {
    const manifest = readManifest(dir)
    for (const name of requiredNames(manifest)) {
      if (name === rootName) continue
      if (existsSync(join(modules, name, 'package.json'))) continue
      if (existsSync(join(dir, 'node_modules', name, 'package.json'))) continue
      missing.set(name, [...(missing.get(name) ?? []), manifest.name ?? dir])
    }
  }
  return missing
}

/**
 * Copy a built workspace package: its manifest plus every `files` entry (default `lib`).
 * @param sourceDir - workspace package directory with build output present.
 * @param destinationDir - target directory under the staged `node_modules`.
 */
export function copyPackage(sourceDir: string, destinationDir: string): void {
  const manifest = readManifest(sourceDir)
  mkdirSync(destinationDir, { recursive: true })
  cpSync(join(sourceDir, 'package.json'), join(destinationDir, 'package.json'))
  for (const entry of manifest.files ?? ['lib']) {
    const absolute = join(sourceDir, entry)
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      cpSync(absolute, join(destinationDir, entry), { recursive: true, dereference: true })
      continue
    }
    for (const file of globSync(entry, { cwd: sourceDir })) {
      mkdirSync(dirname(join(destinationDir, file)), { recursive: true })
      cpSync(join(sourceDir, file), join(destinationDir, file), { recursive: true, dereference: true })
    }
  }
}

/**
 * Copy missing required packages, and the named roots, from workspace directories into the
 * staged `node_modules` until nothing a copied package requires is absent.
 * @param stageDir - staged tree root.
 * @param index - package name to built workspace directory.
 * @param roots - package names copied even though nothing in the tree requires them.
 * @returns names copied, and required names that no workspace provides (registry packages).
 */
export function fillFromWorkspace(
  stageDir: string, index: ReadonlyMap<string, string>, roots: readonly string[] = [],
): { copied: string[]; external: string[] } {
  const modules = join(stageDir, 'node_modules')
  const rootName = readManifest(stageDir).name
  const present = (name: string): boolean => name === rootName || existsSync(join(modules, name, 'package.json'))
  const queue = [...roots, ...missingRequired(stageDir).keys()]
  const copied: string[] = []
  const external = new Set<string>()
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (present(name)) continue
    const source = index.get(name)
    if (source === undefined) {
      external.add(name)
      continue
    }
    copyPackage(source, join(modules, name))
    copied.push(name)
    queue.push(...requiredNames(readManifest(source)).filter(dependency => !present(dependency)))
  }
  return { copied: copied.sort(), external: [...external].sort() }
}

const NODE_PTY_PREBUILD: Record<StageTarget, string> = { 'linux-x64': 'linux-x64', 'win-x64': 'win32-x64' }
const ADDON_SYSTEM_PACKAGE: Record<StageTarget, string | undefined> = {
  'linux-x64': 'node-addon-system-linux-x64',
  'win-x64': undefined,
}

/**
 * Remove files the packaged app never reads: `.bin` launchers (symlinks on POSIX) and native
 * files built for other platforms. Declaration files stay because type-graph metadata may read them.
 * @param stageDir - staged tree root.
 * @param target - the platform the tree is staged for.
 * @returns removed paths relative to `node_modules`, sorted.
 */
export function pruneStage(stageDir: string, target: StageTarget): string[] {
  const modules = join(stageDir, 'node_modules')
  const removed: string[] = []
  const remove = (relative: string): void => {
    const path = join(modules, relative)
    if (!existsSync(path)) return
    rmSync(path, { recursive: true, force: true })
    removed.push(relative)
  }
  remove('.bin')
  const scope = join(modules, '@deepseek-ai')
  if (existsSync(scope)) {
    for (const entry of readdirSync(scope)) {
      if (entry.startsWith('node-addon-system-') && entry !== ADDON_SYSTEM_PACKAGE[target]) remove(join('@deepseek-ai', entry))
    }
  }
  const prebuilds = join(modules, 'node-pty', 'prebuilds')
  if (existsSync(prebuilds)) {
    for (const entry of readdirSync(prebuilds)) {
      if (entry !== NODE_PTY_PREBUILD[target]) remove(join('node-pty', 'prebuilds', entry))
    }
  }
  return removed.sort()
}

const SOURCE_MAP = /\.(?:[cm]?js|d\.[cm]?ts)\.map$/u

/**
 * Remove JavaScript and declaration source maps. Nothing in the packaged app enables source-map
 * support, and the maps are a large share of many packages.
 * @param stageDir - staged tree root.
 * @returns the number of files removed.
 */
export function removeSourceMaps(stageDir: string): number {
  const modules = join(stageDir, 'node_modules')
  if (!existsSync(modules)) return 0
  let removed = 0
  for (const entry of readdirSync(modules, { recursive: true, encoding: 'utf8' })) {
    if (!SOURCE_MAP.test(entry)) continue
    rmSync(join(modules, entry), { force: true })
    removed += 1
  }
  return removed
}

/** What the staged tree weighs, for the install-size and path-length checks. */
export interface SizeReport {
  /** Number of files. */
  files: number
  /** Total size in bytes. */
  bytes: number
  /** The largest first-level packages (the staged root counts as `(root)`), biggest first. */
  largest: { name: string; bytes: number }[]
  /** The longest path relative to the tree root; Windows limits a full path to 260 characters unless long paths are enabled. */
  longestPath: string
}

function owningPackage(relative: string): string {
  const [first, second, third] = relative.split(sep)
  if (first !== 'node_modules' || second === undefined) return '(root)'
  return second.startsWith('@') && third !== undefined ? `${second}/${third}` : second
}

/**
 * Measure a staged tree.
 * @param stageDir - staged tree root.
 * @param top - how many packages to list.
 * @returns file count, bytes, the largest packages, and the longest relative path.
 */
export function sizeReport(stageDir: string, top = 8): SizeReport {
  const perPackage = new Map<string, number>()
  let files = 0
  let bytes = 0
  let longestPath = ''
  for (const entry of readdirSync(stageDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const relative = path.slice(stageDir.length + 1)
    const size = statSync(path).size
    files += 1
    bytes += size
    if (relative.length > longestPath.length) longestPath = relative
    const name = owningPackage(relative)
    perPackage.set(name, (perPackage.get(name) ?? 0) + size)
  }
  const largest = [...perPackage.entries()].map(([name, size]) => ({ name, bytes: size })).sort((a, b) => b.bytes - a.bytes).slice(0, top)
  return { files, bytes, largest, longestPath }
}

/**
 * Parse `pnpm ls -r --depth -1 --json` output.
 * @param json - the command's standard output.
 * @returns package name to workspace directory.
 */
export function parseWorkspaceList(json: string): Map<string, string> {
  const rows = JSON.parse(json) as { name?: string; path?: string }[]
  const index = new Map<string, string>()
  for (const row of rows) {
    if (row.name !== undefined && row.path !== undefined) index.set(row.name, row.path)
  }
  return index
}

/**
 * Index AIR bundles and plugin packages by package name.
 * @param airRoot - the `air/` directory.
 * @returns package name to directory.
 */
export function airPackageIndex(airRoot: string): Map<string, string> {
  const index = new Map<string, string>()
  for (const group of ['bundles', 'packages']) {
    const base = join(airRoot, group)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry)
      if (!existsSync(join(dir, 'package.json'))) continue
      const name = readManifest(dir).name
      if (name !== undefined) index.set(name, dir)
    }
  }
  return index
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 1 passed (1)`, `Tests 10 passed (10)`.

- [ ] **Step 7: Write the boot probe and the boot check**

`air/apps/desktop/scripts/boot-probe.mjs` (copied into a staged tree only while it is verified, and only when the real Host from Task 2 is not built yet):

```js
/** Minimal Host for verifying a staged tree: boots a profile and reports its URL over IPC. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  initProfile, loadLayeredEnv, loadProfileDirectory, PROFILE_TEMPLATES, reportSkippedBundles, resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'

const [runtimeDir, profileName] = process.argv.slice(2)
const installAnchor = join(runtimeDir, 'package.json')
const dir = resolveProfileDir(profileName)
if (!existsSync(join(dir, 'package.json'))) {
  initProfile(dir, [...PROFILE_TEMPLATES.web.bundles, '@air/dsh-air-bundle'])
}
const profile = loadProfileDirectory('dsh', dir, installAnchor)
reportSkippedBundles('dsh', profile)
const application = runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: profileName,
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ['--no-open', '--port', '0'],
})
let stopping
const stop = () => stopping ??= (async () => {
  const running = await application.catch(() => undefined)
  await running?.shutdown.shutdown(0)
  if (process.connected) {
    process.send({ type: 'shutdown-complete' })
    process.disconnect()
  }
})()
process.on('message', (message) => { if (message?.type === 'shutdown') void stop() })
process.once('disconnect', () => { void stop() })
const { ctx } = await application
const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
process.send?.({ type: 'ready', url })
```

`air/apps/desktop/scripts/verify-stage.ts`:

```ts
/** Boot the Host from a staged tree under an isolated Harness home and check ready, auth exchange, and shutdown. */

import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Inputs of {@link bootStage}. */
export interface BootStageOptions {
  /** Staged tree root (`.stage/<target>/runtime` or the packaged `resources/runtime`). */
  runtimeDir: string
  /** Host entry inside the staged tree. */
  hostEntry: string
  /** Executable that runs the Host; defaults to the current Node. */
  execPath?: string
  /** Deadline for the ready message. */
  timeoutMs?: number
}

/** What one boot of a staged tree showed. */
export interface StageBootResult {
  /** Milliseconds from fork to the ready message. */
  readyMs: number
  /** The loopback port the operating system gave the Host (the URL has no token here). */
  port: number
  /** HTTP status of the first request to the authenticated URL (303 when the token is exchanged). */
  redirectStatus: number
  /** Whether that response set a cookie. */
  cookieSet: boolean
  /** Host exit code after the shutdown message. */
  exitCode: number | null
}

/**
 * Boot the Host once and stop it.
 * @param options - tree, entry, executable, and deadline.
 * @returns timing and the observed auth exchange and exit code.
 * @throws when the Host exits or stays silent before the ready message.
 */
export async function bootStage(options: BootStageOptions): Promise<StageBootResult> {
  const home = mkdtempSync(join(tmpdir(), 'air-stage-home-'))
  const started = Date.now()
  const child = fork(options.hostEntry, [options.runtimeDir, 'air'], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    ...(options.execPath === undefined ? {} : { execPath: options.execPath, execArgv: [] }),
  })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
  const exited = new Promise<number | null>((resolve) => { child.once('close', code => { resolve(code) }) })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Host did not report ready in time')) }, options.timeoutMs ?? 90_000)
      child.on('message', (message: unknown) => {
        if (typeof message !== 'object' || message === null || !('type' in message)) return
        if (message.type === 'ready' && 'url' in message && typeof message.url === 'string') {
          clearTimeout(timer)
          resolve(message.url)
        }
      })
      void exited.then((code) => {
        clearTimeout(timer)
        reject(new Error(`Host exited with ${String(code)} before ready: ${stderr.trim()}`))
      })
    })
    const readyMs = Date.now() - started
    const response = await fetch(url, { redirect: 'manual' })
    child.send({ type: 'shutdown' })
    const exitCode = await exited
    return { readyMs, port: Number(new URL(url).port), redirectStatus: response.status, cookieSet: response.headers.has('set-cookie'), exitCode }
  } finally {
    if (child.exitCode === null) child.kill()
    await exited
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
```

- [ ] **Step 8: Write the staging command**

`air/apps/desktop/scripts/stage-runtime.ts`:

```ts
/** Stage the production tree the desktop app ships: dsh CLI package, workspace peers, AIR bundle, AIR Host. */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { runPnpm } from './pnpm.ts'
import {
  airPackageIndex, fillFromWorkspace, parseWorkspaceList, pruneStage, readManifest, removeSourceMaps, sizeReport, stageTarget,
} from './stage-lib.ts'
import { bootStage } from './verify-stage.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const AIR_ROOT = resolve(APP_ROOT, '..', '..')
const REPO_ROOT = resolve(AIR_ROOT, '..')
const AIR_BUNDLE = '@air/dsh-air-bundle'
/** Windows rejects full paths over 260 characters unless long paths are enabled; the install prefix takes about 90. */
const LONG_PATH_WARNING = 170

const pnpm = (args: readonly string[], capture: boolean): string => runPnpm(args, { cwd: REPO_ROOT, capture })

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'verify': { type: 'boolean', default: false },
      'primary-runtime': { type: 'boolean', default: false },
      'out': { type: 'string' },
    },
  })
  const target = stageTarget(process.platform, process.arch)
  const base = values.out === undefined ? join(APP_ROOT, '.stage', target) : resolve(values.out)
  const runtimeDir = join(base, 'runtime')
  if (!existsSync(join(REPO_ROOT, 'apps', 'cli', 'lib', 'profile-boot.js'))) {
    throw new Error('air desktop stage: the root build is missing; run `pnpm install` and then `pnpm run build` at the repository root')
  }
  rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  mkdirSync(base, { recursive: true })

  // The store the workspace install already filled; without it pnpm may pick an empty
  // store on the output drive and download every package again.
  const storeDir = dirname(pnpm(['store', 'path'], true).trim())
  pnpm([
    '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
    '--config.inject-workspace-packages=true',
    `--config.node-linker=${process.env.AIR_STAGE_LINKER ?? 'hoisted'}`,
    '--config.strict-dep-builds=false',
    `--config.store-dir=${storeDir}`,
    runtimeDir,
  ], false)
  console.log(`air desktop stage: deployed @deepseek-ai/dsh into ${runtimeDir}`)

  const index = parseWorkspaceList(pnpm(['ls', '-r', '--depth', '-1', '--json'], true))
  for (const [name, dir] of airPackageIndex(AIR_ROOT)) index.set(name, dir)
  const { copied, external } = fillFromWorkspace(runtimeDir, index, [AIR_BUNDLE])
  if (external.length > 0) {
    throw new Error(`air desktop stage: required packages are neither staged nor in a workspace: ${external.join(', ')}`)
  }
  console.log(`air desktop stage: filled ${String(copied.length)} workspace packages that only a peer dependency names (the count follows upstream; no fixed number is expected)`)
  console.log(`air desktop stage: pruned ${String(pruneStage(runtimeDir, target).length)} paths and ${String(removeSourceMaps(runtimeDir))} source maps`)
  const size = sizeReport(runtimeDir)
  console.log(`air desktop stage: ${String(size.files)} files, ${(size.bytes / 1_048_576).toFixed(0)} MiB; largest: ${size.largest.map(entry => `${entry.name} ${(entry.bytes / 1_048_576).toFixed(0)} MiB`).join(', ')}`)
  console.log(`air desktop stage: longest relative path ${String(size.longestPath.length)} characters`)
  if (size.longestPath.length > LONG_PATH_WARNING) {
    console.warn(`air desktop stage: warning, ${size.longestPath} may exceed the Windows path limit once installed`)
  }

  const hostBuild = join(AIR_ROOT, 'apps', 'desktop-host', 'lib', 'index.js')
  const hostEntry = join(runtimeDir, 'air-host', 'index.js')
  mkdirSync(dirname(hostEntry), { recursive: true })
  if (existsSync(hostBuild)) cpSync(hostBuild, hostEntry)
  mkdirSync(join(runtimeDir, 'air-defaults'), { recursive: true })
  cpSync(join(AIR_ROOT, 'examples', 'ollama.profile.cordis.patch.yml'), join(runtimeDir, 'air-defaults', 'cordis.patch.yml'))
  mkdirSync(join(runtimeDir, 'licenses'), { recursive: true })
  cpSync(join(REPO_ROOT, 'LICENSE'), join(runtimeDir, 'licenses', 'UPSTREAM-LICENSE.txt'))
  cpSync(join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md'), join(runtimeDir, 'licenses', 'THIRD_PARTY_NOTICES.md'))
  writeFileSync(join(runtimeDir, 'stage.json'), `${JSON.stringify({
    schemaVersion: 1, target, dshVersion: readManifest(runtimeDir).version, filled: copied, host: existsSync(hostEntry),
    files: size.files, bytes: size.bytes, longestPath: size.longestPath,
  }, undefined, 2)}\n`)

  if (values['primary-runtime']) {
    pnpm(['run', 'prepare:primary-runtime', '--target', target, '--output', join(base, 'primary-runtime')], false)
    console.log(`air desktop stage: prepared primary runtime payload for ${target}`)
  }

  if (values.verify) {
    const probe = join(runtimeDir, 'air-host', 'boot-probe.mjs')
    const entry = existsSync(hostEntry) ? hostEntry : probe
    if (entry === probe) cpSync(join(APP_ROOT, 'scripts', 'boot-probe.mjs'), probe)
    try {
      const boot = await bootStage({ runtimeDir, hostEntry: entry })
      if (boot.redirectStatus !== 303 || !boot.cookieSet || boot.exitCode !== 0 || boot.port < 1024) {
        throw new Error(`air desktop stage: boot check failed: ${JSON.stringify(boot)}`)
      }
      console.log(`air desktop stage: boot ok (ready in ${String(boot.readyMs)} ms on an OS-assigned port, redirect 303, exit 0)`)
    } finally {
      rmSync(probe, { force: true })
    }
  }
}

await main()
```

- [ ] **Step 9: Typecheck**

Run: `pnpm -C air/apps/desktop run typecheck`
Expected: exit 0, no output.

- [ ] **Step 10: Stage and verify on this machine**

Run: `pnpm -C air/apps/desktop run stage --verify`
Expected (the numbers are not fixed: the filled count follows the upstream manifests and was 27 upstream packages plus the AIR bundle in the scratch spike at the earlier tag, while an offline manifest count at `dsh-v0.2.1-alpha.1` gives 28 plus the bundle; the boot took 2.5 s in the spike):

```
air desktop stage: deployed @deepseek-ai/dsh into <repo>/air/apps/desktop/.stage/linux-x64/runtime
air desktop stage: filled <n> workspace packages that only a peer dependency names (the count follows upstream; no fixed number is expected)
air desktop stage: pruned <n> paths and <n> source maps
air desktop stage: <n> files, <n> MiB; largest: <name> <n> MiB, ...
air desktop stage: longest relative path <n> characters
air desktop stage: boot ok (ready in <n> ms on an OS-assigned port, redirect 303, exit 0)
```

Write the files, MiB, and longest-path figures into the README's "Known Limitations" size line when Task 9 writes it. A longest path over 170 characters prints a warning; on Windows it is the first thing to check if the installer fails.

If the command stops with `required packages are neither staged nor in a workspace`, a registry package is missing from the deployed tree; stop and report the names (this did not occur in the spike).

- [ ] **Step 11: Repeat on the other operating system**

On a Windows teammate's machine (PowerShell, after `pnpm install; pnpm run build` at the root and `pnpm -C air install`), run the same command.
Expected: the same lines with `win-x64`. Record the result (ready time, filled count, size, longest path, any fallback used) in `air/apps/desktop/README.md` when Task 9 writes it. If it fails, apply the fallbacks listed at the top of this task in order and record which one was needed.

- [ ] **Step 12: Commit**

```text
git add air/pnpm-workspace.yaml air/.gitignore air/pnpm-lock.yaml air/apps/desktop
git commit -m "build(air-desktop): stage the production runtime tree and verify it boots"
```

---

### Task 2: AIR Host entry (`air/apps/desktop-host`)

The Host is the Node process the shell spawns. It creates the `air` profile on first run (Web template bundles plus the AIR bundle, seeded with the local Ollama route), boots it with `runProfile`, and speaks a three-message protocol over the Node IPC channel. The upstream calls it depends on were read on 2026-10-03 at `dsh-v0.2.0-rc.2` and read again on 2026-10-08 at `dsh-v0.2.1-alpha.1` with no signature change: `runProfile`, `RunProfileOptions.resolvedProfile` (`apps/cli/src/profile-boot.ts`), `initProfile`, `loadProfileDirectory`, `resolveProfileDir`, `PROFILE_TEMPLATES`, `reportSkippedBundles`, `loadLayeredEnv` (`packages/boot/app-boot`), `ctx.connection.authenticatedUrl`, `ctx.webServer.port`, and the `source`/`root` Config of `@deepseek-ai/dsh-tool-workspace-dependencies`. Upstream's own desktop Host (`apps/desktop-host/src/index.ts`) changed from a fixed port to `--port 0` between the two tags and builds its URL from `ctx.webServer.port` after boot; this Host does the same, so it has no port argument and cannot collide with another program.

**Files:**
- Create: `air/apps/desktop-host/package.json`, `tsconfig.build.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `vitest.boot.config.ts`
- Create: `air/apps/desktop-host/src/protocol.ts`, `src/args.ts`, `src/profile.ts`, `src/run-host.ts`, `src/boot.ts`, `src/index.ts`
- Test: `air/apps/desktop-host/tests/protocol.spec.ts`, `tests/args.spec.ts`, `tests/profile.spec.ts`, `tests/run-host.spec.ts`, `tests/real-boot.e2e.ts`

**Interfaces:**
- Consumes: `bootStage` and `stageTarget` from Task 1; the staged tree at `air/apps/desktop/.stage/<target>/runtime`.
- Produces:
  - `type HostEvent = { type: 'ready'; url: string } | { type: 'fatal'; message: string; diagnostic: string } | { type: 'shutdown-complete' }`
  - `type HostCommand = { type: 'shutdown' }`
  - `isHostEvent(value: unknown): value is HostEvent`, `isHostCommand(value: unknown): value is HostCommand`, importable as `@air/desktop-host/protocol`
  - `parseHostArgs(argv: readonly string[]): HostArgs` with `interface HostArgs { runtimeDir: string; profile: string; primaryRuntimeDir?: string }`
  - `runHost(channel: ParentChannel, boot: () => Promise<BootedHost>): Promise<'ready' | 'failed'>`
  - Built entry `air/apps/desktop-host/lib/index.js`, copied by `stage-runtime.ts` to `runtime/air-host/index.js`

- [ ] **Step 1: Create the package files**

`air/apps/desktop-host/package.json`:

```json
{
  "name": "@air/desktop-host",
  "description": "AIR Host entry: boots the air profile and reports its URL to the desktop shell",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./protocol": {
      "types": "./lib/types/protocol.d.ts",
      "default": "./lib/types/protocol.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/protocol.js",
    "lib/types/protocol.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:boot": "vitest run --config vitest.boot.config.ts"
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-app-boot": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-home-paths": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tool-workspace-dependencies": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/dsh": "link:../../../apps/cli",
    "@deepseek-ai/dsh-app-boot": "link:../../../packages/boot/app-boot",
    "@deepseek-ai/dsh-client-connection": "link:../../../packages/client/connection",
    "@deepseek-ai/dsh-home-paths": "link:../../../packages/util/home-paths",
    "@deepseek-ai/dsh-host-webserver": "link:../../../packages/host/webserver",
    "@deepseek-ai/dsh-tool-workspace-dependencies": "link:../../../packages/skill/tool-workspace-dependencies"
  }
}
```

`air/apps/desktop-host/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/apps/desktop-host/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": "..", "noEmit": true },
  "include": ["src", "tests"]
}
```

(`rootDir` is the parent directory because the boot test imports `../../desktop/scripts/verify-stage.ts`.)

`air/apps/desktop-host/tsdown.config.ts`:

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

`air/apps/desktop-host/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

`air/apps/desktop-host/vitest.boot.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

/** Real boot from the staged tree; needs `pnpm -C air/apps/desktop run stage` first. */
export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.ts'],
    testTimeout: 120_000,
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; `air/apps/desktop-host/node_modules/@deepseek-ai/dsh` is a link to `apps/cli`.

- [ ] **Step 2: Write the failing protocol and argument tests**

`air/apps/desktop-host/tests/protocol.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isHostCommand, isHostEvent } from '../src/protocol.ts'

describe('Host protocol guards', () => {
  it('accepts the three Host events', () => {
    expect(isHostEvent({ type: 'ready', url: 'http://127.0.0.1:51234/?token=t' })).toBe(true)
    expect(isHostEvent({ type: 'fatal', message: 'm', diagnostic: 'd' })).toBe(true)
    expect(isHostEvent({ type: 'shutdown-complete' })).toBe(true)
  })

  it('rejects malformed events', () => {
    for (const value of [null, 'ready', {}, { type: 'ready' }, { type: 'ready', url: 1 }, { type: 'fatal', message: 'm' }, { type: 'other' }]) {
      expect(isHostEvent(value)).toBe(false)
    }
  })

  it('accepts only the shutdown command', () => {
    expect(isHostCommand({ type: 'shutdown' })).toBe(true)
    expect(isHostCommand({ type: 'ready', url: 'u' })).toBe(false)
    expect(isHostCommand(undefined)).toBe(false)
  })
})
```

`air/apps/desktop-host/tests/args.spec.ts`:

```ts
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHostArgs } from '../src/args.ts'

const runtime = join(tmpdir(), 'runtime')

describe('parseHostArgs', () => {
  it('parses runtime directory and profile', () => {
    expect(parseHostArgs([runtime, 'air'])).toEqual({ runtimeDir: runtime, profile: 'air' })
  })

  it('accepts an absolute primary runtime directory', () => {
    const primary = join(tmpdir(), 'primary-runtime')
    expect(parseHostArgs([runtime, 'air', primary]).primaryRuntimeDir).toBe(primary)
  })

  it('rejects a relative runtime directory', () => {
    expect(() => parseHostArgs(['runtime', 'air'])).toThrow('absolute runtime directory')
  })

  it('rejects profile names that are not lowercase identifiers', () => {
    expect(() => parseHostArgs([runtime, '../x'])).toThrow('profile name')
    expect(() => parseHostArgs([runtime])).toThrow('profile name')
  })

  it('rejects a relative primary runtime directory', () => {
    expect(() => parseHostArgs([runtime, 'air', 'primary'])).toThrow('primary runtime')
    // An argument vector of the earlier layout, with a port as the third argument, is refused.
    expect(() => parseHostArgs([runtime, 'air', '19487'])).toThrow('primary runtime')
  })
})
```

Run: `pnpm -C air/apps/desktop-host test`
Expected: FAIL, `Failed to resolve import "../src/protocol.ts"` and `"../src/args.ts"`.

- [ ] **Step 3: Implement the protocol and argument parser**

`air/apps/desktop-host/src/protocol.ts`:

```ts
/** Messages exchanged between the desktop shell and the AIR Host over the Node IPC channel. */

/** Sent by the Host to the shell. */
export type HostEvent =
  /** The profile is running; `url` carries the one-time token and must never be logged. */
  | { readonly type: 'ready'; readonly url: string }
  /** Startup failed; `diagnostic` is the inspected error, bounded in length. */
  | { readonly type: 'fatal'; readonly message: string; readonly diagnostic: string }
  /** The profile was shut down after a `shutdown` command or a parent disconnect. */
  | { readonly type: 'shutdown-complete' }

/** Sent by the shell to the Host. */
export interface HostCommand {
  readonly type: 'shutdown'
}

function typeOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'type' in value ? value.type : undefined
}

/**
 * Check an IPC message received by the shell.
 * @param value - the received message.
 * @returns whether it is a well-formed Host event.
 */
export function isHostEvent(value: unknown): value is HostEvent {
  if (typeof value !== 'object' || value === null) return false
  switch (typeOf(value)) {
    case 'ready':
      return 'url' in value && typeof value.url === 'string'
    case 'fatal':
      return 'message' in value && typeof value.message === 'string'
        && 'diagnostic' in value && typeof value.diagnostic === 'string'
    case 'shutdown-complete':
      return true
    default:
      return false
  }
}

/**
 * Check an IPC message received by the Host.
 * @param value - the received message.
 * @returns whether it is the shutdown command.
 */
export function isHostCommand(value: unknown): value is HostCommand {
  return typeOf(value) === 'shutdown'
}
```

`air/apps/desktop-host/src/args.ts`:

```ts
/** Command-line arguments of the AIR Host: `<runtimeDir> <profile> [primaryRuntimeDir]`. */

import { isAbsolute } from 'node:path'

/** Validated Host arguments. */
export interface HostArgs {
  /** Staged tree root; its `package.json` is the dsh installation anchor. */
  runtimeDir: string
  /** Profile name under the Harness home. */
  profile: string
  /** Bundled Node, pnpm, and Python payload, when the build ships one. */
  primaryRuntimeDir?: string
}

/**
 * Validate the Host's arguments.
 * @param argv - arguments after the entry path.
 * @returns the parsed arguments.
 * @throws when an argument is missing or malformed.
 */
export function parseHostArgs(argv: readonly string[]): HostArgs {
  const [runtimeDir, profile, primaryRuntimeDir] = argv
  if (runtimeDir === undefined || !isAbsolute(runtimeDir)) {
    throw new Error('air host: argument 1 must be the absolute runtime directory')
  }
  if (profile === undefined || !/^[a-z0-9][a-z0-9-]*$/u.test(profile)) {
    throw new Error('air host: argument 2 must be a profile name of lowercase letters, digits, and hyphens')
  }
  if (primaryRuntimeDir !== undefined && !isAbsolute(primaryRuntimeDir)) {
    throw new Error('air host: argument 3 must be the absolute primary runtime directory')
  }
  return { runtimeDir, profile, ...(primaryRuntimeDir === undefined ? {} : { primaryRuntimeDir }) }
}
```

Run: `pnpm -C air/apps/desktop-host test`
Expected: `Tests 8 passed (8)`.

- [ ] **Step 4: Write the failing profile and lifecycle tests**

`air/apps/desktop-host/tests/profile.spec.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AIR_BUNDLE, ensureAirProfile } from '../src/profile.ts'

const roots: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'air-host-profile-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ensureAirProfile', () => {
  it('creates the profile with the base bundles, the AIR bundle, and the seed patch', () => {
    const root = scratch()
    const seedPatch = join(root, 'seed.yml')
    writeFileSync(seedPatch, '- id: llm-pi-ai\n')
    const profileDir = join(root, 'profiles', 'air')
    expect(ensureAirProfile({ profileDir, baseBundles: ['base', 'web'], seedPatch })).toBe(true)
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual(['base', 'web', AIR_BUNDLE])
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('- id: llm-pi-ai\n')
  })

  it('leaves an existing profile unchanged', () => {
    const root = scratch()
    const profileDir = join(root, 'profiles', 'air')
    ensureAirProfile({ profileDir, baseBundles: ['base'], seedPatch: join(root, 'missing.yml') })
    const before = readFileSync(join(profileDir, 'package.json'), 'utf8')
    expect(ensureAirProfile({ profileDir, baseBundles: ['other'], seedPatch: join(root, 'missing.yml') })).toBe(false)
    expect(readFileSync(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    expect(existsSync(join(profileDir, 'cordis.patch.yml'))).toBe(true)
  })
})
```

`air/apps/desktop-host/tests/run-host.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { HostEvent } from '../src/protocol.ts'
import { runHost, type BootedHost, type ParentChannel } from '../src/run-host.ts'

class FakeChannel implements ParentChannel {
  readonly sent: HostEvent[] = []
  disconnects = 0
  private messageListener: ((message: unknown) => void) | undefined
  private disconnectListener: (() => void) | undefined

  send(event: HostEvent): Promise<void> {
    this.sent.push(event)
    return Promise.resolve()
  }

  onMessage(listener: (message: unknown) => void): void { this.messageListener = listener }
  onDisconnect(listener: () => void): void { this.disconnectListener = listener }
  disconnect(): void { this.disconnects += 1 }
  deliver(message: unknown): void { this.messageListener?.(message) }
  drop(): void { this.disconnectListener?.() }
}

function booted(url = 'http://127.0.0.1:51234/?token=t'): { host: BootedHost; shutdown: ReturnType<typeof vi.fn<() => Promise<void>>> } {
  const shutdown = vi.fn<() => Promise<void>>(() => Promise.resolve())
  return { host: { url, shutdown }, shutdown }
}

describe('runHost', () => {
  it('reports ready with the URL once the profile booted', async () => {
    const channel = new FakeChannel()
    const { host } = booted()
    await expect(runHost(channel, () => Promise.resolve(host))).resolves.toBe('ready')
    expect(channel.sent).toEqual([{ type: 'ready', url: host.url }])
  })

  it('shuts down once on a shutdown command and acknowledges it', async () => {
    const channel = new FakeChannel()
    const { host, shutdown } = booted()
    await runHost(channel, () => Promise.resolve(host))
    channel.deliver({ type: 'shutdown' })
    channel.deliver({ type: 'shutdown' })
    await vi.waitFor(() => { expect(channel.disconnects).toBe(1) })
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(channel.sent.at(-1)).toEqual({ type: 'shutdown-complete' })
  })

  it('shuts down when the parent disconnects', async () => {
    const channel = new FakeChannel()
    const { host, shutdown } = booted()
    await runHost(channel, () => Promise.resolve(host))
    channel.drop()
    await vi.waitFor(() => { expect(shutdown).toHaveBeenCalledTimes(1) })
  })

  it('ignores messages that are not commands', async () => {
    const channel = new FakeChannel()
    const { host, shutdown } = booted()
    await runHost(channel, () => Promise.resolve(host))
    channel.deliver({ type: 'ready', url: 'x' })
    channel.deliver('shutdown')
    await Promise.resolve()
    expect(shutdown).not.toHaveBeenCalled()
  })

  it('reports a startup failure as fatal and does not report ready', async () => {
    const channel = new FakeChannel()
    await expect(runHost(channel, () => Promise.reject(new Error('bundle missing')))).resolves.toBe('failed')
    expect(channel.sent).toHaveLength(1)
    const [event] = channel.sent
    expect(event).toMatchObject({ type: 'fatal', message: 'bundle missing' })
    expect(event?.type === 'fatal' && event.diagnostic.includes('bundle missing')).toBe(true)
    expect(channel.disconnects).toBe(1)
  })

  it('turns a synchronous boot throw into a fatal report', async () => {
    const channel = new FakeChannel()
    await expect(runHost(channel, () => { throw new Error('bad arguments') })).resolves.toBe('failed')
    expect(channel.sent[0]).toMatchObject({ type: 'fatal', message: 'bad arguments' })
  })

  it('waits for a boot in progress before shutting down, and then skips ready', async () => {
    const channel = new FakeChannel()
    const { host, shutdown } = booted()
    let finishBoot: (value: BootedHost) => void = () => {}
    const outcome = runHost(channel, () => new Promise<BootedHost>((resolve) => { finishBoot = resolve }))
    await Promise.resolve()
    channel.deliver({ type: 'shutdown' })
    expect(shutdown).not.toHaveBeenCalled()
    finishBoot(host)
    await outcome
    await vi.waitFor(() => { expect(channel.disconnects).toBe(1) })
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(channel.sent).toEqual([{ type: 'shutdown-complete' }])
  })
})
```

Run: `pnpm -C air/apps/desktop-host test`
Expected: FAIL, `Failed to resolve import "../src/profile.ts"` and `"../src/run-host.ts"`.

- [ ] **Step 5: Implement the profile step and the lifecycle**

`air/apps/desktop-host/src/profile.ts`:

```ts
/** First-run creation of the application-owned `air` profile directory. */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { initProfile } from '@deepseek-ai/dsh-app-boot'

/** The AIR product bundle every desktop profile loads after the Web template bundles. */
export const AIR_BUNDLE = '@air/dsh-air-bundle'

/** Inputs of {@link ensureAirProfile}. */
export interface EnsureProfileOptions {
  /** Profile directory under the Harness home. */
  profileDir: string
  /** Bundles of the shipped Web template, in order. */
  baseBundles: readonly string[]
  /** Profile patch copied into a new profile (the local Ollama route); skipped when absent. */
  seedPatch: string
}

/**
 * Create the profile when it has no manifest. An existing profile, including one created by
 * the `dsh` CLI, is left unchanged.
 * @param options - directory, base bundles, and seed patch.
 * @returns whether a profile was created.
 */
export function ensureAirProfile(options: EnsureProfileOptions): boolean {
  if (existsSync(join(options.profileDir, 'package.json'))) return false
  mkdirSync(options.profileDir, { recursive: true })
  const patch = join(options.profileDir, 'cordis.patch.yml')
  // initProfile writes an empty patch only when none exists, so the seed must land first.
  if (!existsSync(patch) && existsSync(options.seedPatch)) copyFileSync(options.seedPatch, patch)
  initProfile(options.profileDir, [...options.baseBundles, AIR_BUNDLE])
  return true
}
```

`air/apps/desktop-host/src/run-host.ts`:

```ts
/** Host lifecycle over an injected parent channel: ready or fatal on startup, shutdown on command or disconnect. */

import { inspect } from 'node:util'
import { isHostCommand, type HostEvent } from './protocol.ts'

/** The Host's side of the IPC channel to the shell. */
export interface ParentChannel {
  /** Send one event; resolves when it was handed to the channel, or at once when the parent is gone. */
  send(event: HostEvent): Promise<void>
  /** Subscribe to messages from the shell. */
  onMessage(listener: (message: unknown) => void): void
  /** Subscribe to loss of the parent. */
  onDisconnect(listener: () => void): void
  /** Close the channel so the process can exit; safe to call more than once. */
  disconnect(): void
}

/** A running profile. */
export interface BootedHost {
  /** Authenticated loopback URL for the first navigation. */
  readonly url: string
  /** Dispose the profile tree. */
  shutdown(): Promise<void>
}

/** Upper bound of the startup diagnostic carried over IPC. */
const MAX_DIAGNOSTIC_CHARS = 64 * 1024

/**
 * Run the Host protocol around one boot.
 * @param channel - connection to the shell.
 * @param boot - starts the profile; a throw or rejection is reported as `fatal`.
 * @returns `ready` after the ready event was sent or a shutdown overtook startup, `failed` after a fatal event.
 */
export async function runHost(channel: ParentChannel, boot: () => Promise<BootedHost>): Promise<'ready' | 'failed'> {
  const application = Promise.resolve().then(boot)
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    // A failed startup is reported below; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown()
    await channel.send({ type: 'shutdown-complete' })
    channel.disconnect()
  })()
  const requestStop = (): void => { stop().catch(() => { channel.disconnect() }) }
  channel.onMessage((message) => { if (isHostCommand(message)) requestStop() })
  channel.onDisconnect(requestStop)
  try {
    const running = await application
    if (stopping === undefined) await channel.send({ type: 'ready', url: running.url })
    return 'ready'
  } catch (error) {
    await channel.send({
      type: 'fatal',
      message: error instanceof Error ? error.message : String(error),
      diagnostic: inspect(error, { depth: 4, maxArrayLength: 50 }).slice(0, MAX_DIAGNOSTIC_CHARS),
    })
    channel.disconnect()
    return 'failed'
  }
}
```

Run: `pnpm -C air/apps/desktop-host test`
Expected: `Test Files 4 passed (4)`, `Tests 17 passed (17)`.

- [ ] **Step 6: Implement the real boot and the entry**

`air/apps/desktop-host/src/boot.ts`:

```ts
/** Boot the `air` profile from the staged dsh installation through upstream's public profile-boot export. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadLayeredEnv, loadProfileDirectory, PROFILE_TEMPLATES, reportSkippedBundles, resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { HostArgs } from './args.ts'
import { AIR_BUNDLE, ensureAirProfile } from './profile.ts'
import type { BootedHost } from './run-host.ts'

/**
 * Create the profile on first run, boot it, and mount the bundled dependency payload when present.
 * @param args - validated Host arguments.
 * @returns the authenticated URL and the shutdown function.
 * @throws when the AIR bundle does not load or the profile fails to boot.
 */
export async function bootAirProfile(args: HostArgs): Promise<BootedHost> {
  // Ollama ignores the key; a non-empty value stops the provider's ambient key discovery
  // (see air/examples/ollama.profile.cordis.patch.yml). A value from the user's .env still wins.
  process.env.OLLAMA_API_KEY ??= 'ollama'
  const installAnchor = join(args.runtimeDir, 'package.json')
  const web = PROFILE_TEMPLATES.web
  if (web === undefined) throw new Error('air host: the dsh installation has no web profile template')
  const profileDir = resolveProfileDir(args.profile)
  ensureAirProfile({
    profileDir,
    baseBundles: web.bundles,
    seedPatch: join(args.runtimeDir, 'air-defaults', 'cordis.patch.yml'),
  })
  const profile = loadProfileDirectory('dsh', profileDir, installAnchor)
  reportSkippedBundles('dsh', profile)
  if (!profile.layers.some(layer => layer.packageName === AIR_BUNDLE)) {
    throw new Error(
      `air host: profile ${JSON.stringify(args.profile)} did not load ${AIR_BUNDLE}; `
      + `add it to dsh.profile.bundles in ${join(profileDir, 'package.json')} or remove the profile directory`,
    )
  }
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: args.profile,
    resolvedProfile: { profile, installAnchor },
    patchFiles: [],
    // Port 0: the operating system picks a free loopback port; the URL below reports it.
    args: ['--no-open', '--port', '0'],
  })
  if (args.primaryRuntimeDir !== undefined && existsSync(join(args.primaryRuntimeDir, 'runtime.json'))) {
    await ctx.plugin(workspaceDependencies, {
      source: args.primaryRuntimeDir,
      root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
    })
  }
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  return { url, shutdown: async () => { await shutdown.shutdown(0) } }
}
```

`air/apps/desktop-host/src/index.ts`:

```ts
/** AIR Host entry: `<runtimeDir> <profile> [primaryRuntimeDir]`, spoken to over the Node IPC channel. */

import { parseHostArgs } from './args.ts'
import { bootAirProfile } from './boot.ts'
import { runHost, type ParentChannel } from './run-host.ts'

function processChannel(): ParentChannel {
  return {
    send: event => new Promise((resolve, reject) => {
      if (!process.connected || process.send === undefined) {
        resolve()
        return
      }
      process.send(event, (error: Error | null) => {
        if (error === null) resolve()
        else reject(error)
      })
    }),
    onMessage: (listener) => { process.on('message', listener) },
    onDisconnect: (listener) => { process.once('disconnect', listener) },
    disconnect: () => { if (process.connected) process.disconnect() },
  }
}

if (import.meta.main) {
  const outcome = await runHost(processChannel(), async () => bootAirProfile(parseHostArgs(process.argv.slice(2))))
  if (outcome === 'failed') process.exitCode = 1
}
```

Run: `pnpm -C air/apps/desktop-host run typecheck`
Expected: exit 0. If `PROFILE_TEMPLATES.web` or `profile.layers` has a different type at the merged upstream tag, read `packages/boot/app-boot/src/profile.ts` and adjust this one file; that is the upstream coupling note 09 names.

- [ ] **Step 7: Write the real boot test**

`air/apps/desktop-host/tests/real-boot.e2e.ts`:

```ts
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { stageTarget } from '../../desktop/scripts/stage-lib.ts'
import { bootStage } from '../../desktop/scripts/verify-stage.ts'

const runtimeDir = resolve(import.meta.dirname, '..', '..', 'desktop', '.stage', stageTarget(process.platform, process.arch), 'runtime')
const hostEntry = join(runtimeDir, 'air-host', 'index.js')

it('boots the air profile from the staged tree under an isolated Harness home', async () => {
  if (!existsSync(hostEntry)) {
    throw new Error(`staged Host is missing at ${hostEntry}; run "pnpm -C air/apps/desktop-host run build" and then "pnpm -C air/apps/desktop run stage"`)
  }
  const boot = await bootStage({ runtimeDir, hostEntry })
  expect(boot.port).toBeGreaterThanOrEqual(1024)
  expect(boot.redirectStatus).toBe(303)
  expect(boot.cookieSet).toBe(true)
  expect(boot.exitCode).toBe(0)
})
```

- [ ] **Step 8: Build, stage with the real Host, and run the boot test**

Run: `pnpm -C air/apps/desktop-host run build`
Expected: exit 0; `air/apps/desktop-host/lib/index.js` exists and its imports of `@deepseek-ai/*` packages are left as bare specifiers (external).

Run: `pnpm -C air/apps/desktop run stage --verify`
Expected: the lines from Task 1, now booting `air-host/index.js` (`stage.json` shows `"host": true`).

Run: `pnpm -C air/apps/desktop-host run test:boot`
Expected: `Tests 1 passed (1)`.

- [ ] **Step 9: Commit**

```text
git add air/apps/desktop-host air/pnpm-lock.yaml
git commit -m "feat(air-desktop): add the AIR Host entry with ready, fatal, and shutdown over IPC"
```

---

### Task 3: Main process core (`air/apps/desktop`)

Single instance, Host supervision, one sandboxed window locked to the Host origin, external links in the default browser, redacted logs. Practices P3–P7, P14, P16. Pure modules sit in `src/`; files in `src/electron/` import `electron` and stay thin.

**Files:**
- Modify: `air/apps/desktop/package.json`
- Create: `air/apps/desktop/brand.json`, `air/apps/desktop/tsdown.config.ts`, `air/apps/desktop/scripts/resolve-brand.ts`
- Create: `air/apps/desktop/src/brand.ts`, `src/paths.ts`, `src/settings.ts`, `src/redact.ts`, `src/log.ts`, `src/navigation.ts`, `src/host-supervisor.ts`, `src/single-instance.ts`
- Create: `air/apps/desktop/src/electron/shell.ts`, `src/electron/host-process.ts`, `src/electron/window.ts`, `src/electron/features.ts`, `src/main.ts`
- Test: `air/apps/desktop/tests/brand.spec.ts`, `tests/core.spec.ts`, `tests/settings.spec.ts`, `tests/host-supervisor.spec.ts`

**Interfaces:**
- Consumes: `isHostEvent`, `HostCommand` from `@air/desktop-host/protocol` (Task 2, built); the staged tree from Task 1; Host argument order `<hostEntry> <runtimeDir> <profile> [primaryRuntimeDir]`.
- Produces:
  - `interface Brand { productName: string; tagline: string; appId: string; executableName: string; desktopName: string; protocolScheme: string; releaseTagPrefix: string; identifiersFinal: boolean; profile: string; publish: { owner: string; repo: string } }`, `resolveBrand(raw: unknown, overrides?: Readonly<Record<string, string | undefined>>): Brand`, and `assertReleasable(brand: Brand, release: boolean): void`
  - `resolveShellPaths(input: ShellPathsInput): ShellPaths` with `interface ShellPaths { runtimeDir: string; hostEntry: string; primaryRuntimeDir: string; logsDir: string; settingsFile: string; updateConfig: string }`
  - `interface Settings { keepRunningInBackground: boolean; quickEntryHotkey: string; checkForUpdates: boolean; updateChannel: 'latest' | 'beta' }`, `DEFAULT_SETTINGS`, `class SettingsStore { get(): Settings; update(patch: Partial<Settings>): Settings; onChange(listener: (settings: Settings) => void): void }`
  - `redactTokens(text: string): string`; `createLogWriter(file: string, maxBytes?: number, now?: () => Date): (line: string) => void`
  - `decideNavigation(target: string, hostOrigin: string | undefined): 'allow' | 'external' | 'deny'`; `decidePermission(permission: string, requestingUrl: string, hostOrigin: string | undefined): boolean` (`undefined` while no Host is ready); `reconnectingUrl(productName: string): string`
  - `class HostSupervisor` with `start(): void`, `stop(): Promise<void>`, `status`; `interface HostChild`; `interface SupervisorHandlers { ready(url); failed(failure); restarting(delayMs) }`; `restartDelayMs(...)`
  - `parseLaunchArgs(argv: readonly string[], scheme: string): LaunchRequest` with `interface LaunchRequest { quickEntry: boolean; smoke: boolean; deepLink?: string }`
  - `interface Shell` (see `src/electron/shell.ts`) and `installFeatures(shell: Shell): Promise<void>` in `src/electron/features.ts`, the single place Tasks 4, 5, and 7 extend
  - Standard output line `AIR_HOST_READY` when the Host is ready (every start, including restarts), and `AIR_SMOKE_OK` then exit 0 under `--smoke`

- [ ] **Step 1: Replace the app manifest and add the brand file**

`air/apps/desktop/package.json`:

```json
{
  "name": "@air/desktop",
  "description": "AIR desktop shell: Electron main process around the AIR Host",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/main.js",
  "desktopName": "air-desktop.desktop",
  "scripts": {
    "build": "tsx scripts/resolve-brand.ts && tsc -p tsconfig.build.json && tsdown",
    "stage": "tsx scripts/stage-runtime.ts",
    "dev": "pnpm run build && electron .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@air/desktop-host": "workspace:*",
    "electron": "44.0.0"
  }
}
```

`air/apps/desktop/brand.json` (the only file to edit when the product name is decided; `AIR_PRODUCT_NAME` and `AIR_PRODUCT_TAGLINE` in the environment override the placeholder defaults at build time). `identifiersFinal` stays `false` until the owner has fixed the product name and these identifiers; it is the release gate described at the top of this plan:

```json
{
  "productName": "{{PRODUCT_NAME}}",
  "tagline": "{{PRODUCT_TAGLINE}}",
  "appId": "io.github.hxman76.air",
  "executableName": "air-desktop",
  "protocolScheme": "air",
  "releaseTagPrefix": "air-desktop-v",
  "identifiersFinal": false,
  "profile": "air",
  "publish": { "owner": "HXMAN76", "repo": "AIR-harness" },
  "placeholders": {
    "PRODUCT_NAME": "AIR",
    "PRODUCT_TAGLINE": "Local-first personal agent"
  }
}
```

`air/apps/desktop/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** One ESM main file with every dependency inlined except Electron, so the app archive needs no node_modules. */
export default defineConfig({
  entry: { main: 'lib/types/main.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (id: string) => id === 'electron',
    alwaysBundle: (id: string) => id !== 'electron' && !id.startsWith('node:'),
  },
})
```

Run: `pnpm -C air install`
Expected: exit 0; the Electron binary downloads once (about 110 MB); `pnpm -C air/apps/desktop exec electron --version` prints `v44.0.0`.

- [ ] **Step 2: Write the failing tests for brand, paths, redaction, log, navigation, and launch arguments**

`air/apps/desktop/tests/brand.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertReleasable, resolveBrand } from '../src/brand.ts'

/** The brand.json fields the tests compare against: expected identifiers come from the file, never from literals. */
interface BrandFile {
  appId: string
  executableName: string
  protocolScheme: string
  releaseTagPrefix: string
  profile: string
  publish: { owner: string; repo: string }
}

const appRoot = join(import.meta.dirname, '..')
const raw: BrandFile = JSON.parse(readFileSync(join(appRoot, 'brand.json'), 'utf8'))

describe('resolveBrand', () => {
  it('fills placeholders from the defaults and derives the desktop file name', () => {
    expect(resolveBrand(raw)).toEqual({
      productName: 'AIR',
      tagline: 'Local-first personal agent',
      appId: raw.appId,
      executableName: raw.executableName,
      desktopName: `${raw.executableName}.desktop`,
      protocolScheme: raw.protocolScheme,
      releaseTagPrefix: raw.releaseTagPrefix,
      identifiersFinal: false,
      profile: raw.profile,
      publish: raw.publish,
    })
  })

  it('prefers AIR_<PLACEHOLDER> overrides', () => {
    expect(resolveBrand(raw, { AIR_PRODUCT_NAME: 'Nimbus' }).productName).toBe('Nimbus')
  })

  it('rejects an unknown placeholder and malformed identifiers', () => {
    expect(() => resolveBrand({ ...raw, tagline: '{{MISSING}}' })).toThrow('unknown placeholder MISSING')
    expect(() => resolveBrand({ ...raw, appId: 'Not An Id' })).toThrow('appId')
    expect(() => resolveBrand({ ...raw, protocolScheme: 'A B' })).toThrow('protocolScheme')
    expect(() => resolveBrand({ ...raw, releaseTagPrefix: 'v 1' })).toThrow('releaseTagPrefix')
    expect(() => resolveBrand({ ...raw, identifiersFinal: 'yes' })).toThrow('identifiersFinal')
    expect(() => resolveBrand(null)).toThrow('brand file')
  })

  it('refuses a release build until the identifiers are final', () => {
    expect(() => assertReleasable(resolveBrand(raw), true)).toThrow('identifiersFinal')
    expect(() => assertReleasable(resolveBrand(raw), false)).not.toThrow()
    expect(() => assertReleasable(resolveBrand({ ...raw, identifiersFinal: true }), true)).not.toThrow()
  })

  it('matches desktopName in package.json, which Electron reads for the Wayland portal identity', () => {
    const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { desktopName: string }
    expect(manifest.desktopName).toBe(resolveBrand(raw).desktopName)
  })

  it('carries no upstream product name', () => {
    const brand = resolveBrand(raw)
    expect(`${brand.productName} ${brand.tagline}`.toLowerCase()).not.toMatch(/deepseek|dsh|harness/u)
  })
})
```

`air/apps/desktop/tests/core.spec.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogWriter } from '../src/log.ts'
import { decideNavigation, decidePermission, reconnectingUrl } from '../src/navigation.ts'
import { resolveShellPaths } from '../src/paths.ts'
import { redactTokens } from '../src/redact.ts'
import { parseLaunchArgs } from '../src/single-instance.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveShellPaths', () => {
  const input = { resourcesPath: join('opt', 'app', 'resources'), appRoot: join('repo', 'air', 'apps', 'desktop'), userData: join('home', 'data'), target: 'linux-x64' }

  it('reads the runtime from resources when packaged', () => {
    const paths = resolveShellPaths({ ...input, isPackaged: true })
    expect(paths.runtimeDir).toBe(join(input.resourcesPath, 'runtime'))
    expect(paths.hostEntry).toBe(join(input.resourcesPath, 'runtime', 'air-host', 'index.js'))
    expect(paths.primaryRuntimeDir).toBe(join(input.resourcesPath, 'primary-runtime'))
    expect(paths.updateConfig).toBe(join(input.resourcesPath, 'app-update.yml'))
  })

  it('reads the staged tree in development and keeps logs and settings in userData', () => {
    const paths = resolveShellPaths({ ...input, isPackaged: false })
    expect(paths.runtimeDir).toBe(join(input.appRoot, '.stage', 'linux-x64', 'runtime'))
    expect(paths.logsDir).toBe(join(input.userData, 'logs'))
    expect(paths.settingsFile).toBe(join(input.userData, 'settings.json'))
  })
})

describe('redactTokens', () => {
  it('removes token query values and auth cookie values', () => {
    expect(redactTokens('dsh web: http://127.0.0.1:51234/?token=abc-DEF_123&x=1')).toBe('dsh web: http://127.0.0.1:51234/?token=<redacted>&x=1')
    expect(redactTokens('set-cookie: dsh-auth-Ab_1=secret; HttpOnly')).toBe('set-cookie: dsh-auth-Ab_1=<redacted>; HttpOnly')
    expect(redactTokens('no secrets here')).toBe('no secrets here')
  })
})

describe('createLogWriter', () => {
  it('writes timestamped, redacted lines and rotates at the size limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'air-log-'))
    roots.push(dir)
    const file = join(dir, 'nested', 'shell.log')
    const write = createLogWriter(file, 120, () => new Date('2026-10-03T00:00:00.000Z'))
    write('ready at http://127.0.0.1:1/?token=abc')
    expect(readFileSync(file, 'utf8')).toBe('2026-10-03T00:00:00.000Z ready at http://127.0.0.1:1/?token=<redacted>\n')
    write('x'.repeat(100))
    write('after rotation')
    expect(readFileSync(file, 'utf8')).toBe('2026-10-03T00:00:00.000Z after rotation\n')
    expect(statSync(`${file}.1`).size).toBeGreaterThan(100)
  })
})

describe('decideNavigation', () => {
  const origin = 'http://127.0.0.1:51234'
  it.each([
    ['http://127.0.0.1:51234/', 'allow'],
    ['http://127.0.0.1:51234/session/1?x=1', 'allow'],
    ['http://127.0.0.1:51235/', 'external'],
    ['http://localhost:51234/', 'external'],
    ['https://example.org/docs', 'external'],
    ['mailto:someone@example.org', 'external'],
    ['file:///etc/passwd', 'deny'],
    ['javascript:alert(1)', 'deny'],
    ['air://open', 'deny'],
    ['not a url', 'deny'],
  ])('%s -> %s', (target, decision) => {
    expect(decideNavigation(target, origin)).toBe(decision)
  })

  it('treats web links as external and drops the rest while no Host is ready', () => {
    expect(decideNavigation(`${origin}/`, undefined)).toBe('external')
    expect(decideNavigation('file:///etc/passwd', undefined)).toBe('deny')
  })
})

describe('reconnectingUrl', () => {
  it('builds a self-contained page that names the product and escapes it', () => {
    const url = reconnectingUrl('A<B>&')
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1))
    expect(html).toContain('A&lt;B&gt;&amp;')
    expect(html).not.toContain('A<B>')
  })
})

describe('decidePermission', () => {
  const origin = 'http://127.0.0.1:51234'
  it('grants a short list to the Host origin only', () => {
    expect(decidePermission('media', `${origin}/`, origin)).toBe(true)
    expect(decidePermission('notifications', `${origin}/x`, origin)).toBe(true)
    expect(decidePermission('geolocation', `${origin}/`, origin)).toBe(false)
    expect(decidePermission('media', 'https://example.org/', origin)).toBe(false)
    expect(decidePermission('media', 'garbage', origin)).toBe(false)
    expect(decidePermission('media', `${origin}/`, undefined)).toBe(false)
  })
})

describe('parseLaunchArgs', () => {
  it('reads flags and the first deep link of the app scheme', () => {
    expect(parseLaunchArgs(['/opt/app/launcher', '--quick-entry', 'demo://open/1', 'other://x'], 'demo')).toEqual({
      quickEntry: true, smoke: false, deepLink: 'demo://open/1',
    })
    expect(parseLaunchArgs(['app', '--smoke'], 'demo')).toEqual({ quickEntry: false, smoke: true })
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, unresolved imports of `../src/brand.ts`, `../src/log.ts`, `../src/navigation.ts`, `../src/paths.ts`, `../src/redact.ts`, `../src/single-instance.ts`.

- [ ] **Step 3: Implement those modules**

`air/apps/desktop/src/brand.ts`:

```ts
/** Brand values for every user-facing surface, resolved from brand.json placeholders. */

/** Resolved brand. `desktopName` is `<executableName>.desktop`, the file electron-builder installs on Linux. */
export interface Brand {
  productName: string
  tagline: string
  appId: string
  executableName: string
  desktopName: string
  protocolScheme: string
  /** Prefix of the release tag; the tag is `<prefix><version>`. */
  releaseTagPrefix: string
  /** Whether the owner has fixed the product name and these identifiers; release builds need `true`. */
  identifiersFinal: boolean
  profile: string
  publish: { owner: string; repo: string }
}

function field(source: Record<string, unknown>, key: string, pattern: RegExp): string {
  const value = source[key]
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`air desktop brand: ${key} is missing or malformed`)
  return value
}

/**
 * Resolve `{{NAME}}` placeholders and validate identifiers.
 * @param raw - parsed brand.json (or an already resolved brand).
 * @param overrides - environment; `AIR_<NAME>` replaces the placeholder default.
 * @returns the resolved brand.
 * @throws when a field is malformed or a placeholder has no value.
 */
export function resolveBrand(raw: unknown, overrides: Readonly<Record<string, string | undefined>> = {}): Brand {
  if (typeof raw !== 'object' || raw === null) throw new Error('air desktop brand: brand file must be a JSON object')
  const source = raw as Record<string, unknown>
  const defaults = (typeof source.placeholders === 'object' && source.placeholders !== null ? source.placeholders : {}) as Record<string, unknown>
  const fill = (key: string): string => field(source, key, /\S/u).replace(/\{\{([A-Z_]+)\}\}/gu, (_match, name: string) => {
    const value = overrides[`AIR_${name}`] ?? defaults[name]
    if (typeof value !== 'string' || value === '') throw new Error(`air desktop brand: unknown placeholder ${name}`)
    return value
  })
  const publish = (typeof source.publish === 'object' && source.publish !== null ? source.publish : {}) as Record<string, unknown>
  const identifiersFinal = source.identifiersFinal
  if (typeof identifiersFinal !== 'boolean') throw new Error('air desktop brand: identifiersFinal must be true or false')
  const executableName = field(source, 'executableName', /^[a-z][a-z0-9-]*$/u)
  return {
    productName: fill('productName'),
    tagline: fill('tagline'),
    appId: field(source, 'appId', /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/u),
    executableName,
    desktopName: `${executableName}.desktop`,
    protocolScheme: field(source, 'protocolScheme', /^[a-z][a-z0-9+.-]*$/u),
    releaseTagPrefix: field(source, 'releaseTagPrefix', /^[a-z][a-z0-9-]*-v$/u),
    identifiersFinal,
    profile: field(source, 'profile', /^[a-z0-9][a-z0-9-]*$/u),
    publish: { owner: field(publish, 'owner', /^[\w.-]+$/u), repo: field(publish, 'repo', /^[\w.-]+$/u) },
  }
}

/**
 * Stop a release build that would publish under placeholder identifiers.
 * @param brand - the resolved brand.
 * @param release - whether this is a release build (`AIR_DESKTOP_RELEASE=1`).
 * @throws when `release` is true and the identifiers are not final.
 */
export function assertReleasable(brand: Brand, release: boolean): void {
  if (release && !brand.identifiersFinal) {
    throw new Error('air desktop: release builds need identifiersFinal: true in brand.json, which the owner sets after the product name and identifiers are final')
  }
}
```

`air/apps/desktop/src/paths.ts`:

```ts
/** Locations of the staged runtime, the Host entry, and shell-owned files. */

import { join } from 'node:path'

/** Facts the main process supplies. */
export interface ShellPathsInput {
  isPackaged: boolean
  /** `process.resourcesPath`. */
  resourcesPath: string
  /** The app directory (`air/apps/desktop` in development). */
  appRoot: string
  /** Electron's per-user data directory. */
  userData: string
  /** Staging target, `linux-x64` or `win-x64`. */
  target: string
}

/** Resolved locations. */
export interface ShellPaths {
  runtimeDir: string
  hostEntry: string
  primaryRuntimeDir: string
  logsDir: string
  settingsFile: string
  /** Written by electron-builder only for builds with a publish target. */
  updateConfig: string
}

/**
 * Resolve the locations for a packaged or development launch.
 * @param input - launch facts.
 * @returns absolute or input-relative paths; nothing is created.
 */
export function resolveShellPaths(input: ShellPathsInput): ShellPaths {
  const base = input.isPackaged ? input.resourcesPath : join(input.appRoot, '.stage', input.target)
  const runtimeDir = join(base, 'runtime')
  return {
    runtimeDir,
    hostEntry: join(runtimeDir, 'air-host', 'index.js'),
    primaryRuntimeDir: join(base, 'primary-runtime'),
    logsDir: join(input.userData, 'logs'),
    settingsFile: join(input.userData, 'settings.json'),
    updateConfig: join(input.resourcesPath, 'app-update.yml'),
  }
}
```

`air/apps/desktop/src/redact.ts`:

```ts
/** Remove Host credentials from text before it is logged or shown. */

/**
 * Replace `token=` query values and `dsh-auth-*` cookie values.
 * @param text - Host output or a diagnostic.
 * @returns the text with credential values replaced by `<redacted>`.
 */
export function redactTokens(text: string): string {
  return text
    .replace(/([?&]token=)[^\s&#"']+/gu, '$1<redacted>')
    .replace(/(dsh-auth-[\w-]+=)[^;\s]+/gu, '$1<redacted>')
}
```

`air/apps/desktop/src/log.ts`:

```ts
/** Size-bounded log files under the app's userData directory. */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { redactTokens } from './redact.ts'

/**
 * Create a line writer. Each line is redacted and prefixed with an ISO timestamp; when the file
 * would exceed `maxBytes` it is renamed to `<file>.1` (replacing the previous one) first.
 * @param file - log file path; its directory is created.
 * @param maxBytes - rotation threshold.
 * @param now - clock.
 * @returns the writer.
 */
export function createLogWriter(file: string, maxBytes = 1_000_000, now: () => Date = () => new Date()): (line: string) => void {
  mkdirSync(dirname(file), { recursive: true })
  return (line) => {
    const entry = `${now().toISOString()} ${redactTokens(line)}\n`
    if (existsSync(file) && statSync(file).size + Buffer.byteLength(entry) > maxBytes) renameSync(file, `${file}.1`)
    appendFileSync(file, entry)
  }
}
```

`air/apps/desktop/src/navigation.ts`:

```ts
/** Origin lock for the app window: where it may navigate and which permissions the page gets. */

/** `allow` stays in the window, `external` opens the default browser, `deny` is dropped. */
export type NavigationDecision = 'allow' | 'external' | 'deny'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const HOST_PERMISSIONS = new Set(['media', 'notifications', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'])

/**
 * Decide a navigation or window-open target.
 * @param target - requested URL.
 * @param hostOrigin - the Host's current loopback origin, e.g. `http://127.0.0.1:51234` (the port changes on every Host start), or `undefined` while no Host is ready.
 * @returns the decision; unparsable and non-web targets are denied.
 */
export function decideNavigation(target: string, hostOrigin: string | undefined): NavigationDecision {
  if (!URL.canParse(target)) return 'deny'
  const url = new URL(target)
  if (hostOrigin !== undefined && url.origin === hostOrigin) return 'allow'
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? 'external' : 'deny'
}

/**
 * Decide a permission request or check.
 * @param permission - Electron permission name.
 * @param requestingUrl - URL or origin of the requesting frame.
 * @param hostOrigin - the Host's current loopback origin, or `undefined` while no Host is ready (nothing is granted).
 * @returns whether to grant it.
 */
export function decidePermission(permission: string, requestingUrl: string, hostOrigin: string | undefined): boolean {
  return hostOrigin !== undefined && URL.canParse(requestingUrl)
    && new URL(requestingUrl).origin === hostOrigin && HOST_PERMISSIONS.has(permission)
}

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/**
 * Page shown while the Host restarts, as a `data:` URL so it needs no server.
 * @param productName - brand name, HTML-escaped before use.
 * @returns the URL; loading it replaces the dead page, and the next `ready` replaces it again.
 */
export function reconnectingUrl(productName: string): string {
  const name = productName.replace(/[&<>"]/gu, character => HTML_ESCAPES[character] ?? character)
  const html = `<!doctype html><meta charset="utf-8"><title>${name}</title>`
    + `<body style="font:16px system-ui;margin:3rem;color-scheme:light dark"><p>${name} lost its background process and is starting it again. This page is replaced when it is ready.</p></body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
```

`air/apps/desktop/src/single-instance.ts`:

```ts
/** Command-line requests of a first or second app instance. */

/** What a launch asks the running app to do. */
export interface LaunchRequest {
  /** Show the quick-entry window instead of the main window. */
  quickEntry: boolean
  /** Boot, load the page, print `AIR_SMOKE_OK`, and exit. */
  smoke: boolean
  /** First argument that uses the app's URL scheme. */
  deepLink?: string
}

/**
 * Parse an argument vector.
 * @param argv - `process.argv` or the `second-instance` command line.
 * @param scheme - the app's URL scheme without `://`.
 * @returns the request.
 */
export function parseLaunchArgs(argv: readonly string[], scheme: string): LaunchRequest {
  const deepLink = argv.find(arg => arg.startsWith(`${scheme}://`))
  return {
    quickEntry: argv.includes('--quick-entry'),
    smoke: argv.includes('--smoke'),
    ...(deepLink === undefined ? {} : { deepLink }),
  }
}
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 3 passed (3)`; all tests in `brand.spec.ts`, `core.spec.ts`, and `stage-lib.spec.ts` pass.

- [ ] **Step 4: Write the failing settings and supervisor tests**

`air/apps/desktop/tests/settings.spec.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings, SettingsStore } from '../src/settings.ts'

const roots: string[] = []
function file(): string {
  const root = mkdtempSync(join(tmpdir(), 'air-settings-'))
  roots.push(root)
  return join(root, 'nested', 'settings.json')
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('parseSettings', () => {
  it('returns defaults for anything that is not an object', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields and replaces invalid ones with defaults', () => {
    expect(parseSettings({ keepRunningInBackground: true, checkForUpdates: 'yes', quickEntryHotkey: '', updateChannel: 'nightly', unknownField: 1 }))
      .toEqual({ ...DEFAULT_SETTINGS, keepRunningInBackground: true, quickEntryHotkey: '' })
  })
})

describe('SettingsStore', () => {
  it('starts from defaults when the file is missing or corrupt', () => {
    const path = file()
    expect(new SettingsStore(path).get()).toEqual(DEFAULT_SETTINGS)
    new SettingsStore(path).update({})
    writeFileSync(path, '{not json')
    expect(new SettingsStore(path).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates and notifies listeners', () => {
    const path = file()
    const store = new SettingsStore(path)
    const seen: boolean[] = []
    store.onChange((settings) => { seen.push(settings.keepRunningInBackground) })
    expect(store.update({ keepRunningInBackground: true }).keepRunningInBackground).toBe(true)
    expect(seen).toEqual([true])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...DEFAULT_SETTINGS, keepRunningInBackground: true })
    expect(new SettingsStore(path).get().keepRunningInBackground).toBe(true)
  })
})
```

`air/apps/desktop/tests/host-supervisor.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { HostCommand } from '@air/desktop-host/protocol'
import { HostSupervisor, restartDelayMs, type HostChild, type HostFailure } from '../src/host-supervisor.ts'

class FakeChild implements HostChild {
  readonly sent: HostCommand[] = []
  kills = 0
  private message: ((message: unknown) => void) | undefined
  private exit: ((code: number | null) => void) | undefined
  private output: ((text: string) => void) | undefined
  send(command: HostCommand): void { this.sent.push(command) }
  kill(): void { this.kills += 1 }
  onMessage(listener: (message: unknown) => void): void { this.message = listener }
  onExit(listener: (code: number | null) => void): void { this.exit = listener }
  onOutput(listener: (text: string) => void): void { this.output = listener }
  emitMessage(message: unknown): void { this.message?.(message) }
  emitExit(code: number | null): void { this.exit?.(code) }
  emitOutput(text: string): void { this.output?.(text) }
}

interface Timer { delay: number; task: () => void; cancelled: boolean }

function harness() {
  const children: FakeChild[] = []
  const timers: Timer[] = []
  const ready: string[] = []
  const failed: HostFailure[] = []
  const restarting: number[] = []
  const logs: string[] = []
  const clock = { now: 0 }
  const supervisor = new HostSupervisor({
    spawn: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    now: () => clock.now,
    schedule: (delay, task) => {
      const timer: Timer = { delay, task, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    log: (line) => { logs.push(line) },
  }, {
    ready: (url) => { ready.push(url) },
    failed: (failure) => { failed.push(failure) },
    restarting: (delayMs) => { restarting.push(delayMs) },
  })
  const child = (index: number): FakeChild => {
    const found = children[index]
    if (found === undefined) throw new Error(`no child ${String(index)}`)
    return found
  }
  const runTimer = (delay: number): void => {
    const timer = timers.find(candidate => candidate.delay === delay && !candidate.cancelled)
    if (timer === undefined) throw new Error(`no pending ${String(delay)} ms timer`)
    timer.cancelled = true
    timer.task()
  }
  return { supervisor, children, child, timers, runTimer, ready, failed, restarting, logs, clock }
}

const READY = { type: 'ready', url: 'http://127.0.0.1:51234/?token=t' }

describe('restartDelayMs', () => {
  it('backs off and stops after the limit inside the window', () => {
    expect(restartDelayMs([], 0, 3, 60_000)).toBe(500)
    expect(restartDelayMs([0], 1000, 3, 60_000)).toBe(2000)
    expect(restartDelayMs([0, 1000], 2000, 3, 60_000)).toBe(5000)
    expect(restartDelayMs([0, 1000, 2000], 3000, 3, 60_000)).toBeUndefined()
    expect(restartDelayMs([0, 1000, 2000], 61_500, 3, 60_000)).toBe(2000)
  })
})

describe('HostSupervisor', () => {
  it('reports ready once', () => {
    const h = harness()
    h.supervisor.start()
    h.supervisor.start()
    expect(h.children).toHaveLength(1)
    h.child(0).emitMessage(READY)
    h.child(0).emitMessage(READY)
    expect(h.ready).toEqual([READY.url])
    expect(h.supervisor.status).toBe('ready')
  })

  it('treats a fatal event as final and does not restart', () => {
    const h = harness()
    h.supervisor.start()
    h.child(0).emitMessage({ type: 'fatal', message: 'bad profile', diagnostic: 'Error: bad profile ?token=abc' })
    h.child(0).emitExit(1)
    expect(h.failed).toEqual([{ message: 'bad profile', detail: 'Error: bad profile ?token=<redacted>' }])
    expect(h.children).toHaveLength(1)
    expect(h.supervisor.status).toBe('failed')
  })

  it('restarts after a crash and reports the new URL', () => {
    const h = harness()
    h.supervisor.start()
    h.child(0).emitMessage(READY)
    h.child(0).emitExit(1)
    expect(h.supervisor.status).toBe('restarting')
    expect(h.restarting).toEqual([500])
    h.runTimer(500)
    h.child(1).emitMessage({ type: 'ready', url: 'http://127.0.0.1:51235/?token=u' })
    expect(h.ready).toEqual([READY.url, 'http://127.0.0.1:51235/?token=u'])
  })

  it('redacts a token that arrives split across output chunks', () => {
    const h = harness()
    h.supervisor.start()
    h.child(0).emitOutput('listening on http://127.0.0.1:51234/?tok')
    h.child(0).emitOutput('en=abc')
    h.child(0).emitOutput('def\r\nnext line\n')
    expect(h.logs).toEqual(['listening on http://127.0.0.1:51234/?token=<redacted>', 'next line'])
  })

  it('logs an unfinished last line when the Host exits', () => {
    const h = harness()
    h.supervisor.start()
    h.child(0).emitOutput('partial ?token=zzz')
    h.child(0).emitExit(0)
    expect(h.logs[0]).toBe('partial ?token=<redacted>')
  })

  it('fails after three restarts inside one minute', () => {
    const h = harness()
    h.supervisor.start()
    for (const delay of [500, 2000, 5000]) {
      h.child(h.children.length - 1).emitExit(1)
      h.runTimer(delay)
    }
    h.child(3).emitOutput('boom http://x/?token=abc\n')
    h.child(3).emitExit(7)
    expect(h.failed).toEqual([{ message: 'The Host exited with code 7', detail: 'boom http://x/?token=<redacted>\n' }])
    expect(h.logs.at(-1)).toBe('boom http://x/?token=<redacted>')
    expect(h.logs.filter(line => line.includes('restarting in'))).toHaveLength(3)
  })

  it('fails and kills the child when ready does not arrive in time', () => {
    const h = harness()
    h.supervisor.start()
    h.runTimer(60_000)
    expect(h.child(0).kills).toBe(1)
    expect(h.failed[0]?.message).toBe('The Host did not become ready in time')
    h.child(0).emitExit(null)
    expect(h.children).toHaveLength(1)
  })

  it('stops with a shutdown command and resolves when the child exits', async () => {
    const h = harness()
    h.supervisor.start()
    h.child(0).emitMessage(READY)
    const stopped = h.supervisor.stop()
    expect(h.child(0).sent).toEqual([{ type: 'shutdown' }])
    h.child(0).emitExit(0)
    await stopped
    expect(h.supervisor.status).toBe('stopped')
    expect(h.failed).toEqual([])
  })

  it('kills a child that ignores shutdown, and stop without a child resolves', async () => {
    const h = harness()
    await h.supervisor.stop()
    const second = harness()
    second.supervisor.start()
    const stopped = second.supervisor.stop()
    second.runTimer(10_000)
    expect(second.child(0).kills).toBe(1)
    second.child(0).emitExit(null)
    await stopped
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, unresolved imports of `../src/settings.ts` and `../src/host-supervisor.ts`.

- [ ] **Step 5: Implement settings and the supervisor**

`air/apps/desktop/src/settings.ts`:

```ts
/** Shell settings stored as JSON in userData. The application menu is the phase-1 editor. */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** User-changeable shell behaviour. */
export interface Settings {
  /** Linux: closing the window hides it and the app keeps running. Windows always hides to the tray. */
  keepRunningInBackground: boolean
  /** Electron accelerator that opens the quick-entry window; empty text disables it. */
  quickEntryHotkey: string
  /** Check the release feed on start. */
  checkForUpdates: boolean
  /** `latest` takes stable releases; `beta` also takes prereleases. */
  updateChannel: 'latest' | 'beta'
}

/** Values used for missing or invalid fields. */
export const DEFAULT_SETTINGS: Settings = {
  keepRunningInBackground: false,
  quickEntryHotkey: 'Control+Shift+Space',
  checkForUpdates: true,
  updateChannel: 'latest',
}

/**
 * Validate stored settings. A hand-edited file must not stop the app, so invalid fields fall back.
 * @param raw - parsed JSON.
 * @returns complete settings.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const source = raw as Record<string, unknown>
  const flag = (key: 'keepRunningInBackground' | 'checkForUpdates'): boolean => {
    const value = source[key]
    return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key]
  }
  const hotkey = source.quickEntryHotkey
  return {
    keepRunningInBackground: flag('keepRunningInBackground'),
    quickEntryHotkey: typeof hotkey === 'string' ? hotkey : DEFAULT_SETTINGS.quickEntryHotkey,
    checkForUpdates: flag('checkForUpdates'),
    updateChannel: source.updateChannel === 'beta' ? 'beta' : DEFAULT_SETTINGS.updateChannel,
  }
}

/** Reads settings once and writes every update through a temporary file. */
export class SettingsStore {
  private current: Settings
  private readonly listeners: ((settings: Settings) => void)[] = []

  /** @param file - settings file path; its directory is created on first write. */
  constructor(private readonly file: string) {
    let raw: unknown
    try {
      raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
    } catch {
      // A corrupt settings file is replaced by defaults on the next update.
      raw = undefined
    }
    this.current = parseSettings(raw)
  }

  /** @returns the current settings. */
  get(): Settings {
    return { ...this.current }
  }

  /**
   * Merge, persist, and announce a change.
   * @param patch - fields to change.
   * @returns the new settings.
   */
  update(patch: Partial<Settings>): Settings {
    this.current = parseSettings({ ...this.current, ...patch })
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(`${this.file}.tmp`, `${JSON.stringify(this.current, undefined, 2)}\n`)
    renameSync(`${this.file}.tmp`, this.file)
    for (const listener of this.listeners) listener(this.get())
    return this.get()
  }

  /** @param listener - called after every update. */
  onChange(listener: (settings: Settings) => void): void {
    this.listeners.push(listener)
  }
}
```

`air/apps/desktop/src/host-supervisor.ts`:

```ts
/** Start, watch, restart, and stop the Host child through an injected process adapter. */

import { isHostEvent, type HostCommand } from '@air/desktop-host/protocol'
import { redactTokens } from './redact.ts'

/** The Host process as the supervisor sees it. */
export interface HostChild {
  send(command: HostCommand): void
  kill(): void
  onMessage(listener: (message: unknown) => void): void
  /** Called once when the process is gone; `null` when it was terminated or never started. */
  onExit(listener: (code: number | null) => void): void
  /** Standard output and standard error text. */
  onOutput(listener: (text: string) => void): void
}

/** Why the Host is not available. `detail` is redacted and safe to show and log. */
export interface HostFailure {
  readonly message: string
  readonly detail: string
}

/** Collaborators and limits. */
export interface SupervisorOptions {
  spawn(): HostChild
  now(): number
  /** Run `task` after `delayMs`; the returned function cancels it. */
  schedule(delayMs: number, task: () => void): () => void
  log(line: string): void
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  maxRestarts?: number
  restartWindowMs?: number
}

/** Receivers of supervisor outcomes. */
export interface SupervisorHandlers {
  /** A Host is ready; called again after each successful restart with a new URL. */
  ready(url: string): void
  /** Startup failed or restarts are exhausted; no further restart happens. */
  failed(failure: HostFailure): void
  /** The Host exited unexpectedly and starts again after `delayMs`; its origin and token are invalid until `ready` is called again. */
  restarting(delayMs: number): void
}

type Status = 'idle' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'stopped' | 'failed'

const RESTART_DELAYS_MS = [500, 2000, 5000]
const TAIL_CHARS = 8000
/** The Host prints short lines; an unterminated line this long is flushed whole so the buffer stays bounded. */
const MAX_PENDING_CHARS = 65_536

/**
 * Delay before the next restart.
 * @param restarts - times of earlier restarts.
 * @param now - current time.
 * @param maxRestarts - restarts allowed inside the window.
 * @param windowMs - window length.
 * @returns the delay, or `undefined` when the limit is reached.
 */
export function restartDelayMs(restarts: readonly number[], now: number, maxRestarts: number, windowMs: number): number | undefined {
  const recent = restarts.filter(at => now - at < windowMs).length
  if (recent >= maxRestarts) return undefined
  return RESTART_DELAYS_MS[recent] ?? 5000
}

/** Owns one Host child at a time. */
export class HostSupervisor {
  private state: Status = 'idle'
  private child: HostChild | undefined
  private cancelTimer: (() => void) | undefined
  private tail = ''
  /** Output after the last line break; redaction needs whole lines because a token can be split across chunks. */
  private pending = ''
  private readonly restarts: number[] = []
  private readonly exitWaiters: (() => void)[] = []

  /**
   * @param options - process adapter, clock, timers, log, limits.
   * @param handlers - outcome receivers.
   */
  constructor(private readonly options: SupervisorOptions, private readonly handlers: SupervisorHandlers) {}

  /** Current lifecycle state. */
  get status(): Status {
    return this.state
  }

  /** Start the first child; later calls do nothing. */
  start(): void {
    if (this.state === 'idle') this.launch()
  }

  /**
   * Ask the child to shut down, terminate it after the stop timeout, and wait for exit.
   * @returns when no child is left.
   */
  stop(): Promise<void> {
    this.clearTimer()
    const child = this.child
    if (child === undefined) {
      this.state = 'stopped'
      return Promise.resolve()
    }
    this.state = 'stopping'
    const exited = new Promise<void>((resolve) => { this.exitWaiters.push(resolve) })
    child.send({ type: 'shutdown' })
    this.cancelTimer = this.options.schedule(this.options.stopTimeoutMs ?? 10_000, () => { child.kill() })
    return exited
  }

  private launch(): void {
    this.state = 'starting'
    this.tail = ''
    this.pending = ''
    const child = this.options.spawn()
    this.child = child
    this.cancelTimer = this.options.schedule(this.options.readyTimeoutMs ?? 60_000, () => {
      this.fail('The Host did not become ready in time')
      child.kill()
    })
    child.onOutput((text) => {
      const lines = (this.pending + text).split(/\r?\n/u)
      this.pending = lines.pop() ?? ''
      if (this.pending.length > MAX_PENDING_CHARS) {
        lines.push(this.pending)
        this.pending = ''
      }
      for (const line of lines) this.record(line)
    })
    child.onMessage((message) => {
      if (!isHostEvent(message)) return
      if (message.type === 'ready' && this.state === 'starting') {
        this.clearTimer()
        this.state = 'ready'
        this.handlers.ready(message.url)
      } else if (message.type === 'fatal') {
        this.fail(message.message, redactTokens(message.diagnostic))
      }
    })
    child.onExit((code) => { this.exited(child, code) })
  }

  private exited(child: HostChild, code: number | null): void {
    if (this.child !== child) return
    this.child = undefined
    this.clearTimer()
    this.record(this.pending)
    this.pending = ''
    for (const resolve of this.exitWaiters.splice(0)) resolve()
    if (this.state === 'stopping') {
      this.state = 'stopped'
      return
    }
    if (this.state !== 'starting' && this.state !== 'ready') return
    const now = this.options.now()
    const delay = restartDelayMs(this.restarts, now, this.options.maxRestarts ?? 3, this.options.restartWindowMs ?? 60_000)
    if (delay === undefined) {
      this.fail(`The Host exited with code ${String(code)}`)
      return
    }
    this.restarts.push(now)
    this.state = 'restarting'
    this.options.log(`Host exited with code ${String(code)}; restarting in ${String(delay)} ms`)
    this.cancelTimer = this.options.schedule(delay, () => { this.launch() })
    this.handlers.restarting(delay)
  }

  private record(line: string): void {
    const safe = redactTokens(line)
    if (safe.trim() === '') return
    this.tail = `${this.tail}${safe}\n`.slice(-TAIL_CHARS)
    this.options.log(safe)
  }

  private fail(message: string, detail: string = this.tail): void {
    if (this.state === 'failed' || this.state === 'stopping' || this.state === 'stopped') return
    this.clearTimer()
    this.state = 'failed'
    this.handlers.failed({ message, detail })
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
  }
}
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 5 passed (5)`.

- [ ] **Step 6: Write the Electron adapters**

`air/apps/desktop/scripts/resolve-brand.ts`:

```ts
/** Resolve brand.json placeholders into lib/brand.resolved.json, the file the main process and the packager read. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveBrand } from '../src/brand.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const brand = resolveBrand(JSON.parse(readFileSync(join(APP_ROOT, 'brand.json'), 'utf8')), process.env)
mkdirSync(join(APP_ROOT, 'lib'), { recursive: true })
writeFileSync(join(APP_ROOT, 'lib', 'brand.resolved.json'), `${JSON.stringify(brand, undefined, 2)}\n`)
console.log(`air desktop: brand resolved for ${brand.productName}`)
```

`air/apps/desktop/src/electron/shell.ts`:

```ts
/** The object the main process hands to every feature installer. */

import type { BrowserWindow } from 'electron'
import type { Brand } from '../brand.ts'
import type { ShellPaths } from '../paths.ts'
import type { SettingsStore } from '../settings.ts'
import type { LaunchRequest } from '../single-instance.ts'

/** Main-process state and actions shared with features. */
export interface Shell {
  readonly brand: Brand
  readonly paths: ShellPaths
  readonly settings: SettingsStore
  /** The request of this (first) instance. */
  readonly launch: LaunchRequest
  /** Append a redacted line to `<userData>/logs/shell.log`. */
  log(line: string): void
  /** The Host's current loopback origin (it changes on every Host start); `undefined` before the first ready and while the Host restarts. */
  hostOrigin(): string | undefined
  /** The main window once the Host was ready at least once. */
  mainWindow(): BrowserWindow | undefined
  /** Show and focus the main window; does nothing before it exists (it shows itself when created). */
  showMainWindow(): void
  /** Stop the Host and quit. */
  quit(): void
  /** Whether a quit is in progress; close handlers must then let the window close. */
  isQuitting(): boolean
  /** Subscribe to creation of the main window. */
  onMainWindow(listener: (window: BrowserWindow) => void): void
  /** Set the action for a `--quick-entry` launch or second instance. */
  setQuickEntryAction(action: () => void): void
}
```

`air/apps/desktop/src/electron/host-process.ts`:

```ts
/** Spawn the AIR Host with Electron in Node mode and adapt it to the supervisor. */

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Brand } from '../brand.ts'
import type { HostChild } from '../host-supervisor.ts'
import type { ShellPaths } from '../paths.ts'

/**
 * Start one Host process.
 * @param paths - staged runtime and Host entry.
 * @param brand - profile name.
 * @returns the supervisor's view of the child; the Host chooses its own port and reports the URL.
 */
export function spawnHost(paths: ShellPaths, brand: Brand): HostChild {
  const primary = existsSync(join(paths.primaryRuntimeDir, 'runtime.json')) ? [paths.primaryRuntimeDir] : []
  const child = spawn(process.execPath, [paths.hostEntry, paths.runtimeDir, brand.profile, ...primary], {
    cwd: homedir(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  return {
    send: (command) => { if (child.connected) child.send(command) },
    kill: () => {
      // On Windows a plain kill ends only the Host; /T also ends the shells and servers it started.
      if (process.platform === 'win32' && child.pid !== undefined) {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => { if (error !== null) child.kill() })
      } else {
        child.kill()
      }
    },
    onMessage: (listener) => { child.on('message', listener) },
    onExit: (listener) => {
      let reported = false
      const report = (code: number | null): void => {
        if (reported) return
        reported = true
        listener(code)
      }
      child.once('close', report)
      // A spawn failure emits `error` and may never emit `close`.
      child.once('error', () => { report(null) })
    },
    onOutput: (listener) => {
      child.stdout?.on('data', listener)
      child.stderr?.on('data', listener)
    },
  }
}
```

`air/apps/desktop/src/electron/window.ts`:

```ts
/** The main window: sandboxed, isolated, and locked to the Host origin. */

import { app, BrowserWindow, shell, type WebContents } from 'electron'
import { decideNavigation } from '../navigation.ts'

/**
 * Keep a page on the Host origin: other web links open in the default browser, everything else is dropped.
 * Loads started by the shell (`loadURL`) are not checked; page-initiated navigations and redirects are.
 * @param contents - the window's web contents.
 * @param hostOrigin - returns the Host's current loopback origin, which changes on every Host start, or `undefined` while no Host is ready.
 */
export function lockToOrigin(contents: WebContents, hostOrigin: () => string | undefined): void {
  const guard = (event: { preventDefault(): void }, target: string): void => {
    const decision = decideNavigation(target, hostOrigin())
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') void shell.openExternal(target)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, hostOrigin()) === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
}

/**
 * Create the main window; the caller loads a page into it. The window is shown when it is ready.
 * @param title - product name; page title changes are ignored so no upstream string reaches the title bar.
 * @param hostOrigin - returns the Host's current loopback origin, or `undefined`.
 * @returns the window.
 */
export function createMainWindow(title: string, hostOrigin: () => string | undefined): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  })
  window.on('page-title-updated', (event) => { event.preventDefault() })
  lockToOrigin(window.webContents, hostOrigin)
  window.once('ready-to-show', () => { window.show() })
  return window
}
```

`air/apps/desktop/src/electron/features.ts` (Tasks 4, 5, and 7 add their installers here):

```ts
/** Installs optional shell features after the app is ready. */

import type { Shell } from './shell.ts'

/**
 * Install every feature. The core (single instance, Host, window) is already running.
 * @param shell - main-process state and actions.
 */
export async function installFeatures(shell: Shell): Promise<void> {
  shell.log('features: core only')
  await Promise.resolve()
}
```

`air/apps/desktop/src/main.ts`:

```ts
/** Electron main process: single instance, Host supervision, one origin-locked window, clean quit. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, crashReporter, dialog, session, type BrowserWindow } from 'electron'
import { resolveBrand } from './brand.ts'
import { installFeatures } from './electron/features.ts'
import { spawnHost } from './electron/host-process.ts'
import type { Shell } from './electron/shell.ts'
import { createMainWindow } from './electron/window.ts'
import { HostSupervisor } from './host-supervisor.ts'
import { createLogWriter } from './log.ts'
import { decidePermission, reconnectingUrl } from './navigation.ts'
import { resolveShellPaths } from './paths.ts'
import { SettingsStore } from './settings.ts'
import { parseLaunchArgs, type LaunchRequest } from './single-instance.ts'

const brand = resolveBrand(JSON.parse(readFileSync(join(import.meta.dirname, 'brand.resolved.json'), 'utf8')))
app.setName(brand.productName)
if (process.platform === 'linux') app.setDesktopName(brand.desktopName)
if (process.platform === 'win32') app.setAppUserModelId(brand.appId)

const launch = parseLaunchArgs(process.argv, brand.protocolScheme)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const target = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const paths = resolveShellPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    userData: app.getPath('userData'),
    target,
  })
  const log = createLogWriter(join(paths.logsDir, 'shell.log'))
  const hostLog = createLogWriter(join(paths.logsDir, 'host.log'))

  let window: BrowserWindow | undefined
  let origin: string | undefined
  let quitting = false
  let hostStopped = false
  let quickEntryAction: (() => void) | undefined
  const windowListeners: ((created: BrowserWindow) => void)[] = []

  // A rejected load names its URL, which carries the token; the log writer redacts it, Electron's default report does not.
  const loadPage = (target: BrowserWindow, url: string): void => {
    target.loadURL(url).catch((error: unknown) => { log(`load failed: ${error instanceof Error ? error.message : String(error)}`) })
  }

  const finishSmoke = (ok: boolean, message: string): void => {
    process.stdout.write(ok ? 'AIR_SMOKE_OK\n' : `AIR_SMOKE_FAILED ${message}\n`)
    void supervisor.stop().finally(() => { app.exit(ok ? 0 : 1) })
  }

  const supervisor = new HostSupervisor({
    spawn: () => spawnHost(paths, brand),
    now: () => Date.now(),
    schedule: (delayMs, task) => {
      const timer = setTimeout(task, delayMs)
      return () => { clearTimeout(timer) }
    },
    log: hostLog,
  }, {
    ready: (url) => {
      // The URL carries the token: never log it. The marker line is for smoke tests.
      process.stdout.write('AIR_HOST_READY\n')
      log('host ready')
      origin = new URL(url).origin
      if (window === undefined) {
        const created = createMainWindow(brand.productName, () => origin)
        window = created
        for (const listener of windowListeners) listener(created)
        if (launch.smoke) created.webContents.once('did-finish-load', () => { finishSmoke(true, '') })
      }
      loadPage(window, url)
    },
    restarting: (delayMs) => {
      // The old origin and token died with the Host: deny permissions and show a page that says so until the next ready.
      origin = undefined
      log(`host restarting in ${String(delayMs)} ms`)
      if (window !== undefined) loadPage(window, reconnectingUrl(brand.productName))
    },
    failed: (failure) => {
      log(`host failed: ${failure.message}\n${failure.detail}`)
      if (launch.smoke) {
        finishSmoke(false, failure.message)
        return
      }
      dialog.showErrorBox(brand.productName, `${failure.message}\n\n${failure.detail.slice(-2000)}`)
      shell.quit()
    },
  })

  const shell: Shell = {
    brand,
    paths,
    settings: new SettingsStore(paths.settingsFile),
    launch,
    log,
    hostOrigin: () => origin,
    mainWindow: () => window,
    showMainWindow: () => {
      if (window === undefined) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    },
    quit: () => { app.quit() },
    isQuitting: () => quitting,
    onMainWindow: (listener) => {
      windowListeners.push(listener)
      if (window !== undefined) listener(window)
    },
    setQuickEntryAction: (action) => { quickEntryAction = action },
  }

  const handleRequest = (request: LaunchRequest): void => {
    if (request.quickEntry && quickEntryAction !== undefined) quickEntryAction()
    else shell.showMainWindow()
  }

  app.on('second-instance', (_event, argv) => { handleRequest(parseLaunchArgs(argv, brand.protocolScheme)) })
  app.on('before-quit', (event) => {
    quitting = true
    if (hostStopped) return
    event.preventDefault()
    void supervisor.stop().finally(() => {
      hostStopped = true
      app.quit()
    })
  })

  crashReporter.start({ uploadToServer: false })
  void app.whenReady().then(async () => {
    log(`start ${app.getVersion()} packaged=${String(app.isPackaged)} target=${target}`)
    // A development run must not register `electron` as the handler of the placeholder scheme on a teammate's machine.
    if (app.isPackaged) app.setAsDefaultProtocolClient(brand.protocolScheme)
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(decidePermission(permission, details.requestingUrl, origin))
    })
    session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      decidePermission(permission, requestingOrigin, origin))
    supervisor.start()
    await installFeatures(shell)
    if (launch.quickEntry) handleRequest(launch)
  })
}
```

Until Task 4 installs the close policy, Electron's default applies: the app quits when its window closes on Linux and Windows (`window-all-closed` has no listener).

- [ ] **Step 7: Typecheck, build, and run from the staged tree**

Run: `pnpm -C air/apps/desktop run typecheck`
Expected: exit 0. Electron's listener parameter types can differ between minor versions; if `will-navigate` or `setPermissionRequestHandler` reports a parameter mismatch, follow the signature in `node_modules/electron/electron.d.ts` for 44.0.0 without changing behaviour.

Run: `pnpm -C air/apps/desktop run build`
Expected: `air desktop: brand resolved for AIR`; `air/apps/desktop/lib/main.js` and `lib/brand.resolved.json` exist.

Run (Fedora, inside the desktop session; on Windows the same command in PowerShell): `pnpm -C air/apps/desktop exec electron . --smoke`
Expected: standard output contains `AIR_HOST_READY` then `AIR_SMOKE_OK`; exit code 0; `shell.log` and `host.log` exist under the userData `logs` directory (`~/.config/AIR/logs` on Linux, `%APPDATA%\AIR\logs` on Windows) and neither contains `token=` followed by anything except `<redacted>`.

Run: `pnpm -C air/apps/desktop run dev`
Expected: a window titled `AIR` shows the conversation page. Check by hand: a link to an external site opens the default browser; the address is `http://127.0.0.1:<port>/` with no token, and the port differs from one start to the next; starting the command a second time focuses the first window and the second process exits.

Restart check: end the Host process while the window is open. Fedora: `pkill -f air-host/index.js`. Windows (PowerShell): `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object CommandLine -like '*air-host*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`.
Expected: the window shows the "starting it again" page for about half a second and then the conversation page on a new port; `host.log` has `Host exited with code` and `restarting in 500 ms`; `shell.log` has `host restarting in 500 ms` and a second `host ready`; neither file shows a token.

- [ ] **Step 8: Commit**

```text
git add air/apps/desktop air/pnpm-lock.yaml
git commit -m "feat(air-desktop): add the main process core with Host supervision and an origin-locked window"
```

---

### Task 4: Close and background policy, tray, application menu

Owner decision: on GNOME the close button quits by default; an opt-in setting keeps the app running and requests the XDG Background portal. On Windows the close button hides the window to the tray. A tray is created on Linux only when a StatusNotifier host is present. Practice P8. Note 13 section 1.5 records that GNOME lists only Flatpak apps under Background Apps, so the background mode also posts a notification and stays reachable from the launcher (a second launch shows the window) and the application menu.

**Files:**
- Modify: `air/apps/desktop/package.json` (build script), `air/apps/desktop/src/electron/features.ts`
- Create: `air/apps/desktop/scripts/gen-placeholder-icon.ts`
- Create: `air/apps/desktop/src/close-policy.ts`, `src/tray-support.ts`, `src/background-portal.ts`, `src/menu.ts`
- Create: `air/apps/desktop/src/electron/run-command.ts`, `src/electron/close.ts`, `src/electron/tray.ts`, `src/electron/menu.ts`
- Test: `air/apps/desktop/tests/policy.spec.ts`

**Interfaces:**
- Consumes: `Shell`, `Settings`, `SettingsStore` from Task 3.
- Produces:
  - `decideClose(input: CloseInput): 'close' | 'quit' | 'hide'`; `backgroundNotice(productName: string, platform: NodeJS.Platform, hotkey: string): string`
  - `type CommandRunner = (command: string, args: readonly string[]) => Promise<string>`; `trayAvailable(platform: NodeJS.Platform, run: CommandRunner): Promise<boolean>`
  - `backgroundRequestArgs(reason: string): string[]`; `requestBackground(reason: string, run: CommandRunner): Promise<boolean>`
  - `appMenuTemplate(input: AppMenuInput): MenuItem[]`; `trayMenuTemplate(productName: string, actions: Pick<MenuActions, 'showWindow' | 'quit'>): MenuItem[]`; `interface MenuActions { showWindow(): void; quit(): void; openLogs(): void; openSettingsFile(): void; update(patch: Partial<Settings>): void; checkForUpdates?: () => void }`
  - `runCommand: CommandRunner`; `installClosePolicy(shell: Shell, hasTray: boolean): void`; `installTray(shell: Shell): void`; `installMenu(shell: Shell, extra: { checkForUpdates?: () => void }): void`
  - `lib/icon.png` (512×512), written by the build

- [ ] **Step 1: Write the failing policy tests**

`air/apps/desktop/tests/policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { backgroundRequestArgs, requestBackground } from '../src/background-portal.ts'
import { backgroundNotice, decideClose } from '../src/close-policy.ts'
import { appMenuTemplate, trayMenuTemplate, type MenuActions, type MenuItem } from '../src/menu.ts'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings.ts'
import { trayAvailable } from '../src/tray-support.ts'

describe('decideClose', () => {
  const base = { quitting: false, keepRunningInBackground: false, trayAvailable: false }
  it.each([
    ['linux quits by default', { ...base, platform: 'linux' as const }, 'quit'],
    ['linux hides with the background setting', { ...base, platform: 'linux' as const, keepRunningInBackground: true }, 'hide'],
    ['windows hides to the tray', { ...base, platform: 'win32' as const, trayAvailable: true }, 'hide'],
    ['windows quits when no tray could be created', { ...base, platform: 'win32' as const }, 'quit'],
    ['a quit in progress lets the window close', { ...base, platform: 'win32' as const, trayAvailable: true, quitting: true }, 'close'],
    ['other platforms quit', { ...base, platform: 'darwin' as const, keepRunningInBackground: true }, 'quit'],
  ])('%s', (_name, input, action) => {
    expect(decideClose(input)).toBe(action)
  })
})

describe('backgroundNotice', () => {
  it('names the way back for each platform', () => {
    expect(backgroundNotice('AIR', 'win32', '')).toBe('AIR is still running. Use the tray icon to open or quit it.')
    expect(backgroundNotice('AIR', 'linux', 'Control+Shift+Space'))
      .toBe('AIR is still running in the background. Open it from the app grid or with Control+Shift+Space; quit from its menu.')
    expect(backgroundNotice('AIR', 'linux', '')).toBe('AIR is still running in the background. Open it from the app grid; quit from its menu.')
  })
})

describe('trayAvailable', () => {
  const answer = (text: string) => () => Promise.resolve(text)
  it('is always true on Windows and false on unsupported platforms', async () => {
    await expect(trayAvailable('win32', answer(''))).resolves.toBe(true)
    await expect(trayAvailable('darwin', answer('(true,)'))).resolves.toBe(false)
  })

  it('asks the session bus for a StatusNotifier watcher on Linux', async () => {
    const calls: string[][] = []
    const run = (command: string, args: readonly string[]): Promise<string> => {
      calls.push([command, ...args])
      return Promise.resolve('(true,)\n')
    }
    await expect(trayAvailable('linux', run)).resolves.toBe(true)
    expect(calls[0]?.[0]).toBe('gdbus')
    expect(calls[0]).toContain('org.freedesktop.DBus.NameHasOwner')
    expect(calls[0]?.at(-1)).toBe('org.kde.StatusNotifierWatcher')
    await expect(trayAvailable('linux', answer('(false,)'))).resolves.toBe(false)
    await expect(trayAvailable('linux', () => Promise.reject(new Error('gdbus missing')))).resolves.toBe(false)
  })
})

describe('background portal', () => {
  it('builds a RequestBackground call with an escaped reason', () => {
    const args = backgroundRequestArgs("AIR's agent keeps running")
    expect(args.slice(0, 8)).toEqual([
      'call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
      '--object-path', '/org/freedesktop/portal/desktop', '--method', 'org.freedesktop.portal.Background.RequestBackground',
    ])
    expect(args.slice(8)).toEqual(['', "{'reason': <'AIR\\'s agent keeps running'>, 'autostart': <false>}"])
  })

  it('reports whether the request was accepted by the bus', async () => {
    await expect(requestBackground('r', () => Promise.resolve("(objectpath '/org/freedesktop/portal/desktop/request/1_1/t',)"))).resolves.toBe(true)
    await expect(requestBackground('r', () => Promise.reject(new Error('no portal')))).resolves.toBe(false)
  })
})

describe('menus', () => {
  function actions(log: string[], patches: Partial<Settings>[]): MenuActions {
    return {
      showWindow: () => { log.push('show') },
      quit: () => { log.push('quit') },
      openLogs: () => { log.push('logs') },
      openSettingsFile: () => { log.push('settings') },
      update: (patch) => { patches.push(patch) },
    }
  }
  const labels = (items: MenuItem[]): string[] => items.flatMap(item => (item.label === undefined ? [] : [item.label]))
  const find = (items: MenuItem[], label: string): MenuItem => {
    const found = items.flatMap(item => [item, ...(item.submenu ?? [])]).find(item => item.label === label)
    if (found === undefined) throw new Error(`no menu item ${label}`)
    return found
  }

  it('builds the Linux application menu with the background toggle and no Updates menu', () => {
    const log: string[] = []
    const patches: Partial<Settings>[] = []
    const menu = appMenuTemplate({ productName: 'AIR', platform: 'linux', settings: DEFAULT_SETTINGS, actions: actions(log, patches) })
    expect(labels(menu)).toEqual(['AIR', 'Edit', 'View'])
    const toggle = find(menu, 'Keep running in the background')
    expect(toggle.type).toBe('checkbox')
    expect(toggle.checked).toBe(false)
    toggle.click?.()
    find(menu, 'Quit').click?.()
    find(menu, 'Open logs folder').click?.()
    expect(patches).toEqual([{ keepRunningInBackground: true }])
    expect(log).toEqual(['quit', 'logs'])
  })

  it('omits the background toggle on Windows and adds Updates when a check action exists', () => {
    const log: string[] = []
    const patches: Partial<Settings>[] = []
    const menu = appMenuTemplate({
      productName: 'AIR', platform: 'win32', settings: { ...DEFAULT_SETTINGS, updateChannel: 'beta' },
      actions: { ...actions(log, patches), checkForUpdates: () => { log.push('check') } },
    })
    expect(labels(menu)).toEqual(['AIR', 'Edit', 'View', 'Updates'])
    expect(() => find(menu, 'Keep running in the background')).toThrow('no menu item')
    expect(find(menu, 'Beta channel').checked).toBe(true)
    find(menu, 'Stable channel').click?.()
    find(menu, 'Check for updates on start').click?.()
    find(menu, 'Check for updates now').click?.()
    expect(patches).toEqual([{ updateChannel: 'latest' }, { checkForUpdates: false }])
    expect(log).toEqual(['check'])
  })

  it('builds the tray menu', () => {
    const log: string[] = []
    const menu = trayMenuTemplate('AIR', actions(log, []))
    expect(labels(menu)).toEqual(['Open AIR', 'Quit'])
    for (const item of menu) item.click?.()
    expect(log).toEqual(['show', 'quit'])
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, unresolved imports of `../src/background-portal.ts`, `../src/close-policy.ts`, `../src/menu.ts`, `../src/tray-support.ts`.

- [ ] **Step 2: Implement the pure modules**

`air/apps/desktop/src/close-policy.ts`:

```ts
/** What the window close button does on each platform. */

/** Facts at the time of a close request. */
export interface CloseInput {
  platform: NodeJS.Platform
  /** A quit is already in progress. */
  quitting: boolean
  /** The Linux opt-in setting. */
  keepRunningInBackground: boolean
  /** A tray icon exists. */
  trayAvailable: boolean
}

/**
 * Decide a close request: `close` lets the window close, `quit` quits the app, `hide` hides the window.
 * @param input - platform, settings, and tray facts.
 * @returns the action.
 */
export function decideClose(input: CloseInput): 'close' | 'quit' | 'hide' {
  if (input.quitting) return 'close'
  if (input.platform === 'win32') return input.trayAvailable ? 'hide' : 'quit'
  if (input.platform === 'linux') return input.keepRunningInBackground ? 'hide' : 'quit'
  return 'quit'
}

/**
 * Text of the notification shown the first time the window hides.
 * @param productName - brand name.
 * @param platform - current platform.
 * @param hotkey - the quick-entry accelerator, or empty text.
 * @returns one or two sentences naming how to reopen and quit.
 */
export function backgroundNotice(productName: string, platform: NodeJS.Platform, hotkey: string): string {
  if (platform === 'win32') return `${productName} is still running. Use the tray icon to open or quit it.`
  const shortcut = hotkey === '' ? '' : ` or with ${hotkey}`
  return `${productName} is still running in the background. Open it from the app grid${shortcut}; quit from its menu.`
}
```

`air/apps/desktop/src/tray-support.ts`:

```ts
/** Whether a tray icon would be visible on this desktop. */

/** Runs a command and resolves with its standard output; rejects on failure. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>

const WATCHER_QUERY = [
  'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
  '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher',
]

/**
 * Windows always has a notification area. On Linux a tray icon is shown only when a StatusNotifier
 * watcher owns its bus name (KDE Plasma, or GNOME with the AppIndicator extension).
 * @param platform - current platform.
 * @param run - command runner used for `gdbus`.
 * @returns whether to create a tray icon.
 */
export async function trayAvailable(platform: NodeJS.Platform, run: CommandRunner): Promise<boolean> {
  if (platform === 'win32') return true
  if (platform !== 'linux') return false
  try {
    return (await run('gdbus', WATCHER_QUERY)).trim() === '(true,)'
  } catch {
    // No gdbus or no session bus: there is no watcher to show an icon.
    return false
  }
}
```

`air/apps/desktop/src/background-portal.ts`:

```ts
/** XDG Background portal request through `gdbus` (Linux). The grant arrives on a signal this module does not wait for. */

import type { CommandRunner } from './tray-support.ts'

function gvariantString(text: string): string {
  return `'${text.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}

/**
 * Arguments of `gdbus` for `org.freedesktop.portal.Background.RequestBackground("", { reason, autostart: false })`.
 * @param reason - user-visible reason.
 * @returns the argument vector.
 */
export function backgroundRequestArgs(reason: string): string[] {
  return [
    'call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
    '--object-path', '/org/freedesktop/portal/desktop', '--method', 'org.freedesktop.portal.Background.RequestBackground',
    '', `{'reason': <${gvariantString(reason)}>, 'autostart': <false>}`,
  ]
}

/**
 * Send the request.
 * @param reason - user-visible reason.
 * @param run - command runner.
 * @returns whether the portal accepted the call; `false` when there is no portal or no `gdbus`.
 */
export async function requestBackground(reason: string, run: CommandRunner): Promise<boolean> {
  try {
    return (await run('gdbus', backgroundRequestArgs(reason))).includes('/org/freedesktop/portal/desktop/request/')
  } catch {
    // Desktops without the portal still honour the setting; the app only loses the portal record.
    return false
  }
}
```

`air/apps/desktop/src/menu.ts`:

```ts
/** Application and tray menu templates as plain data; the Electron adapter turns them into menus. */

import type { Settings } from './settings.ts'

/** The subset of Electron's menu item options the shell uses. */
export interface MenuItem {
  label?: string
  role?: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'reload' | 'resetZoom' | 'zoomIn' | 'zoomOut' | 'togglefullscreen'
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  accelerator?: string
  click?: () => void
  submenu?: MenuItem[]
}

/** What menu items do. `checkForUpdates` exists only when the updater is installed. */
export interface MenuActions {
  showWindow(): void
  quit(): void
  openLogs(): void
  openSettingsFile(): void
  update(patch: Partial<Settings>): void
  checkForUpdates?: () => void
}

/** Inputs of {@link appMenuTemplate}. */
export interface AppMenuInput {
  productName: string
  platform: NodeJS.Platform
  settings: Settings
  actions: MenuActions
}

const SEPARATOR: MenuItem = { type: 'separator' }

/**
 * Build the application menu. Settings appear as checkboxes because phase 1 has no settings page.
 * @param input - brand, platform, current settings, and actions.
 * @returns top-level menus.
 */
export function appMenuTemplate(input: AppMenuInput): MenuItem[] {
  const { settings, actions } = input
  const toggle = (label: string, checked: boolean, patch: Partial<Settings>): MenuItem => ({
    label, type: 'checkbox', checked, click: () => { actions.update(patch) },
  })
  const channel = (label: string, value: Settings['updateChannel']): MenuItem => ({
    label, type: 'radio', checked: settings.updateChannel === value, click: () => { actions.update({ updateChannel: value }) },
  })
  const check = actions.checkForUpdates
  return [
    {
      label: input.productName,
      submenu: [
        { label: `Show ${input.productName}`, click: actions.showWindow },
        SEPARATOR,
        ...(input.platform === 'linux'
          ? [toggle('Keep running in the background', settings.keepRunningInBackground, { keepRunningInBackground: !settings.keepRunningInBackground })]
          : []),
        SEPARATOR,
        { label: 'Open logs folder', click: actions.openLogs },
        { label: 'Open settings file', click: actions.openSettingsFile },
        SEPARATOR,
        { label: 'Quit', accelerator: 'CommandOrControl+Q', click: actions.quit },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, SEPARATOR, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, SEPARATOR, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, SEPARATOR, { role: 'togglefullscreen' }] },
    ...(check === undefined
      ? []
      : [{
          label: 'Updates',
          submenu: [
            toggle('Check for updates on start', settings.checkForUpdates, { checkForUpdates: !settings.checkForUpdates }),
            channel('Stable channel', 'latest'),
            channel('Beta channel', 'beta'),
            SEPARATOR,
            { label: 'Check for updates now', click: check },
          ],
        }]),
  ]
}

/**
 * Build the tray context menu.
 * @param productName - brand name.
 * @param actions - show and quit.
 * @returns two items.
 */
export function trayMenuTemplate(productName: string, actions: Pick<MenuActions, 'showWindow' | 'quit'>): MenuItem[] {
  return [
    { label: `Open ${productName}`, click: actions.showWindow },
    { label: 'Quit', click: actions.quit },
  ]
}
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 6 passed (6)`.

- [ ] **Step 3: Generate a placeholder icon at build time**

`air/apps/desktop/scripts/gen-placeholder-icon.ts` (a designed icon placed at `air/apps/desktop/build/icon.png` replaces the placeholder without code changes):

```ts
/** Write lib/icon.png: the designed build/icon.png when present, otherwise a neutral 512x512 placeholder. */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const APP_ROOT = resolve(import.meta.dirname, '..')
const SIZE = 512

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

/** A slate rounded square with a lighter centre square, RGBA, one filter byte per row. */
function placeholder(): Buffer {
  const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = y * (SIZE * 4 + 1) + 1 + x * 4
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y)
      const inner = x > 176 && x < 336 && y > 176 && y < 336
      const [red, green, blue, alpha] = edge < 24 ? [0, 0, 0, 0] : inner ? [226, 232, 240, 255] : [51, 65, 85, 255]
      rows.writeUInt8(red, offset)
      rows.writeUInt8(green, offset + 1)
      rows.writeUInt8(blue, offset + 2)
      rows.writeUInt8(alpha, offset + 3)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(join(APP_ROOT, 'lib'), { recursive: true })
const designed = join(APP_ROOT, 'build', 'icon.png')
if (existsSync(designed)) copyFileSync(designed, join(APP_ROOT, 'lib', 'icon.png'))
else writeFileSync(join(APP_ROOT, 'lib', 'icon.png'), placeholder())
console.log(`air desktop: icon ${existsSync(designed) ? 'copied from build/icon.png' : 'placeholder written'}`)
```

In `air/apps/desktop/package.json` change the `build` script to:

```json
    "build": "tsx scripts/resolve-brand.ts && tsx scripts/gen-placeholder-icon.ts && tsc -p tsconfig.build.json && tsdown",
```

- [ ] **Step 4: Write the Electron adapters and install them**

`air/apps/desktop/src/electron/run-command.ts`:

```ts
/** Run a short helper command (gdbus) with a deadline. */

import { execFile } from 'node:child_process'
import type { CommandRunner } from '../tray-support.ts'

/** Resolves with standard output; rejects when the command is missing, fails, or exceeds three seconds. */
export const runCommand: CommandRunner = (command, args) => new Promise((resolve, reject) => {
  execFile(command, [...args], { timeout: 3000, windowsHide: true }, (error, stdout) => {
    if (error === null) resolve(stdout)
    else reject(error)
  })
})
```

`air/apps/desktop/src/electron/close.ts`:

```ts
/** Apply the close policy to the main window and request the Background portal for the Linux opt-in. */

import { app, Notification } from 'electron'
import { requestBackground } from '../background-portal.ts'
import { backgroundNotice, decideClose } from '../close-policy.ts'
import { runCommand } from './run-command.ts'
import type { Shell } from './shell.ts'

/**
 * @param shell - main-process state and actions.
 * @param hasTray - whether a tray icon was created.
 */
export function installClosePolicy(shell: Shell, hasTray: boolean): void {
  let noticeShown = false
  const announceBackground = (): void => {
    if (process.platform !== 'linux' || !shell.settings.get().keepRunningInBackground) return
    void requestBackground(`${shell.brand.productName} keeps the agent running after its window closes.`, runCommand)
      .then((accepted) => { shell.log(`background portal request ${accepted ? 'accepted' : 'not available'}`) })
  }
  announceBackground()
  shell.settings.onChange(announceBackground)
  shell.onMainWindow((window) => {
    window.on('close', (event) => {
      const settings = shell.settings.get()
      const action = decideClose({
        platform: process.platform,
        quitting: shell.isQuitting(),
        keepRunningInBackground: settings.keepRunningInBackground,
        trayAvailable: hasTray,
      })
      if (action === 'close') return
      event.preventDefault()
      if (action === 'quit') {
        shell.quit()
        return
      }
      window.hide()
      if (noticeShown || !Notification.isSupported()) return
      noticeShown = true
      new Notification({
        title: shell.brand.productName,
        body: backgroundNotice(shell.brand.productName, process.platform, settings.quickEntryHotkey),
      }).show()
    })
  })
  app.on('window-all-closed', () => { shell.quit() })
}
```

`air/apps/desktop/src/electron/tray.ts`:

```ts
/** Tray icon with Open and Quit. Created on Windows, and on Linux only when a StatusNotifier host exists. */

import { join } from 'node:path'
import { Menu, nativeImage, Tray } from 'electron'
import { trayMenuTemplate } from '../menu.ts'
import type { Shell } from './shell.ts'

let tray: Tray | undefined

/** @param shell - main-process state and actions. */
export function installTray(shell: Shell): void {
  const image = nativeImage.createFromPath(join(import.meta.dirname, 'icon.png')).resize({ width: 32, height: 32 })
  tray = new Tray(image)
  tray.setToolTip(shell.brand.productName)
  // Linux StatusNotifier hosts may not deliver `click`; the context menu is the reliable control.
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(shell.brand.productName, {
    showWindow: () => { shell.showMainWindow() },
    quit: () => { shell.quit() },
  })))
  tray.on('click', () => { shell.showMainWindow() })
}
```

`air/apps/desktop/src/electron/menu.ts`:

```ts
/** Application menu built from settings; rebuilt whenever a setting changes. */

import { Menu, shell as electronShell } from 'electron'
import { appMenuTemplate } from '../menu.ts'
import type { Shell } from './shell.ts'

/**
 * @param shell - main-process state and actions.
 * @param extra - optional update action that adds the Updates menu.
 */
export function installMenu(shell: Shell, extra: { checkForUpdates?: () => void }): void {
  const build = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate({
      productName: shell.brand.productName,
      platform: process.platform,
      settings: shell.settings.get(),
      actions: {
        showWindow: () => { shell.showMainWindow() },
        quit: () => { shell.quit() },
        openLogs: () => { void electronShell.openPath(shell.paths.logsDir) },
        openSettingsFile: () => {
          shell.settings.update({})
          void electronShell.openPath(shell.paths.settingsFile)
        },
        update: (patch) => { shell.settings.update(patch) },
        ...(extra.checkForUpdates === undefined ? {} : { checkForUpdates: extra.checkForUpdates }),
      },
    })))
  }
  build()
  shell.settings.onChange(build)
}
```

Replace `air/apps/desktop/src/electron/features.ts`:

```ts
/** Installs optional shell features after the app is ready. */

import { trayAvailable } from '../tray-support.ts'
import { installClosePolicy } from './close.ts'
import { installMenu } from './menu.ts'
import { runCommand } from './run-command.ts'
import type { Shell } from './shell.ts'
import { installTray } from './tray.ts'

/**
 * Install every feature. The core (single instance, Host, window) is already running.
 * @param shell - main-process state and actions.
 */
export async function installFeatures(shell: Shell): Promise<void> {
  const hasTray = await trayAvailable(process.platform, runCommand)
  if (hasTray) installTray(shell)
  installClosePolicy(shell, hasTray)
  installMenu(shell, {})
  shell.log(`features: tray=${String(hasTray)}`)
}
```

- [ ] **Step 5: Typecheck, build, and check by hand**

Run: `pnpm -C air/apps/desktop run typecheck`
Expected: exit 0.

Run: `pnpm -C air/apps/desktop run dev`
Expected on Fedora GNOME (no AppIndicator extension): `shell.log` ends with `features: tray=false`; closing the window quits the app and no `electron` process remains (`pgrep -f air/apps/desktop` prints nothing). Tick "Keep running in the background" in the `AIR` menu, close the window: a notification appears, the process stays, and running `pnpm -C air/apps/desktop exec electron .` again shows the window. "Quit" in the menu ends both the shell and the Host.
Expected on Windows: a tray icon appears; closing the window hides it and shows the notification once; clicking the tray icon shows the window; tray "Quit" ends the process (`Get-Process electron` shows none).

- [ ] **Step 6: Commit**

```text
git add air/apps/desktop
git commit -m "feat(air-desktop): add per-platform close policy, conditional tray, and the application menu"
```

---

### Task 5: Global hotkey and quick-entry window

Practices P9, P10. On GNOME Wayland `globalShortcut` goes through the GlobalShortcuts portal, which needs an installed `.desktop` file whose name equals `desktopName` (`air-desktop.desktop`): the hotkey works from the installed rpm, not from `electron .` or a bare AppImage (note 09 section 2.4). The fallback is a GNOME custom shortcut that runs `air-desktop --quick-entry`; the second instance forwards the request. The quick-entry window loads the Host page in a small always-on-top window; a dedicated quick-entry client page is roadmap work. The window belongs to one Host start: its origin and authentication cookie die with that Host, so it is destroyed and re-created when the origin has changed.

**Files:**
- Modify: `air/apps/desktop/src/electron/features.ts`
- Create: `air/apps/desktop/src/hotkey.ts`, `src/quick-entry.ts`
- Create: `air/apps/desktop/src/electron/quick-entry.ts`, `src/electron/hotkey.ts`
- Test: `air/apps/desktop/tests/assistant.spec.ts`

**Interfaces:**
- Consumes: `Shell.setQuickEntryAction`, `Shell.hostOrigin`, `lockToOrigin` (Task 3); `Settings.quickEntryHotkey`.
- Produces:
  - `isAccelerator(text: string): boolean`; `class HotkeyManager { constructor(registrar: ShortcutRegistrar, action: () => void); apply(accelerator: string): HotkeyStatus; dispose(): void }`; `type HotkeyStatus = { state: 'disabled' } | { state: 'registered'; accelerator: string } | { state: 'failed'; accelerator: string; reason: string }`
  - `quickEntryUrl(hostOrigin: string): string`; `quickEntryBounds(workArea: Rectangle): Rectangle` with `interface Rectangle { x: number; y: number; width: number; height: number }`
  - `installQuickEntry(shell: Shell): () => void` (returns the toggle), `installHotkey(shell: Shell, toggle: () => void): void`

- [ ] **Step 1: Write the failing tests**

`air/apps/desktop/tests/assistant.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HotkeyManager, isAccelerator, type ShortcutRegistrar } from '../src/hotkey.ts'
import { quickEntryBounds, quickEntryUrl } from '../src/quick-entry.ts'

describe('isAccelerator', () => {
  it.each(['Control+Shift+Space', 'CommandOrControl+K', 'Alt+F12', 'Super+A', 'Ctrl+Alt+Shift+.'])('accepts %s', (text) => {
    expect(isAccelerator(text)).toBe(true)
  })
  it.each(['', 'Space', 'Control+', 'Control+Shift', 'Hyper+K', 'Control+K+J', 'Control + K'])('rejects %j', (text) => {
    expect(isAccelerator(text)).toBe(false)
  })
})

describe('HotkeyManager', () => {
  function registrar(accept: boolean | 'throw') {
    const registered = new Map<string, () => void>()
    const unregistered: string[] = []
    const api: ShortcutRegistrar = {
      register: (accelerator, callback) => {
        if (accept === 'throw') throw new Error('portal error')
        if (accept) registered.set(accelerator, callback)
        return accept
      },
      unregister: (accelerator) => {
        unregistered.push(accelerator)
        registered.delete(accelerator)
      },
    }
    return { api, registered, unregistered }
  }

  it('registers, fires the action, and replaces the previous shortcut', () => {
    const r = registrar(true)
    let fired = 0
    const manager = new HotkeyManager(r.api, () => { fired += 1 })
    expect(manager.apply('Control+Shift+Space')).toEqual({ state: 'registered', accelerator: 'Control+Shift+Space' })
    r.registered.get('Control+Shift+Space')?.()
    expect(fired).toBe(1)
    expect(manager.apply('Alt+F12')).toEqual({ state: 'registered', accelerator: 'Alt+F12' })
    expect(r.unregistered).toEqual(['Control+Shift+Space'])
    manager.dispose()
    expect(r.unregistered).toEqual(['Control+Shift+Space', 'Alt+F12'])
  })

  it('is disabled by empty text and fails loudly on invalid text or refusal', () => {
    expect(new HotkeyManager(registrar(true).api, () => {}).apply('')).toEqual({ state: 'disabled' })
    expect(new HotkeyManager(registrar(true).api, () => {}).apply('Space')).toEqual({
      state: 'failed', accelerator: 'Space', reason: 'not a valid accelerator (use for example Control+Shift+Space)',
    })
    const refused = { state: 'failed', accelerator: 'Alt+F12', reason: 'the system refused the shortcut: it is in use, or the app is not installed with its desktop file' }
    expect(new HotkeyManager(registrar(false).api, () => {}).apply('Alt+F12')).toEqual(refused)
    expect(new HotkeyManager(registrar('throw').api, () => {}).apply('Alt+F12')).toEqual(refused)
  })
})

describe('quick entry', () => {
  it('loads the Host origin with a marker fragment', () => {
    expect(quickEntryUrl('http://127.0.0.1:51234')).toBe('http://127.0.0.1:51234/#air-quick-entry')
  })

  it('centres a 720x480 window in the upper part of the work area and shrinks on small screens', () => {
    expect(quickEntryBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({ x: 600, y: 216, width: 720, height: 480 })
    expect(quickEntryBounds({ x: 100, y: 50, width: 600, height: 400 })).toEqual({ x: 120, y: 130, width: 560, height: 360 })
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, unresolved imports of `../src/hotkey.ts` and `../src/quick-entry.ts`.

- [ ] **Step 2: Implement the pure modules**

`air/apps/desktop/src/hotkey.ts`:

```ts
/** Global shortcut state: validation, replacement, and a reason when registration fails. */

/** The part of Electron's `globalShortcut` the manager uses. */
export interface ShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/** Result of applying a shortcut setting. */
export type HotkeyStatus =
  | { state: 'disabled' }
  | { state: 'registered'; accelerator: string }
  | { state: 'failed'; accelerator: string; reason: string }

const MODIFIER = /^(Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super|Meta)$/u
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Return|Escape|Esc|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Backspace|[`\-=\[\];',./])$/u

/**
 * Check accelerator text: one or more modifiers, then exactly one key, joined by `+` without spaces.
 * @param text - accelerator from settings.
 * @returns whether Electron would accept it as a global shortcut with a modifier.
 */
export function isAccelerator(text: string): boolean {
  const parts = text.split('+')
  const key = parts.at(-1)
  const modifiers = parts.slice(0, -1)
  return key !== undefined && KEY.test(key) && modifiers.length > 0 && modifiers.every(part => MODIFIER.test(part))
}

/** Holds at most one registered shortcut. */
export class HotkeyManager {
  private current: string | undefined

  /**
   * @param registrar - `globalShortcut` or a fake.
   * @param action - called when the shortcut fires.
   */
  constructor(private readonly registrar: ShortcutRegistrar, private readonly action: () => void) {}

  /**
   * Replace the registered shortcut.
   * @param accelerator - new accelerator; empty text disables the shortcut.
   * @returns what happened; a failure carries a reason to show the user.
   */
  apply(accelerator: string): HotkeyStatus {
    this.dispose()
    if (accelerator === '') return { state: 'disabled' }
    if (!isAccelerator(accelerator)) {
      return { state: 'failed', accelerator, reason: 'not a valid accelerator (use for example Control+Shift+Space)' }
    }
    let accepted: boolean
    try {
      accepted = this.registrar.register(accelerator, this.action)
    } catch {
      // Electron throws for some refusals and returns false for others; both mean "not registered".
      accepted = false
    }
    if (!accepted) {
      return { state: 'failed', accelerator, reason: 'the system refused the shortcut: it is in use, or the app is not installed with its desktop file' }
    }
    this.current = accelerator
    return { state: 'registered', accelerator }
  }

  /** Unregister the current shortcut, if any. */
  dispose(): void {
    if (this.current !== undefined) this.registrar.unregister(this.current)
    this.current = undefined
  }
}
```

`air/apps/desktop/src/quick-entry.ts`:

```ts
/** Geometry and address of the quick-entry window. */

/** Screen rectangle in device-independent pixels. */
export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Address the quick-entry window loads: the Host page with a fragment a later client plugin can read.
 * @param hostOrigin - the Host's current loopback origin (it changes on every Host start).
 * @returns the URL.
 */
export function quickEntryUrl(hostOrigin: string): string {
  return `${hostOrigin}/#air-quick-entry`
}

/**
 * Place the window: at most 720x480, at least 20 pixels from each edge, horizontally centred, one fifth down.
 * Wayland compositors ignore the position and centre the window themselves.
 * @param workArea - the display's work area.
 * @returns window bounds.
 */
export function quickEntryBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(720, workArea.width - 40)
  const height = Math.min(480, workArea.height - 40)
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.max(20, Math.round(workArea.height / 5)),
    width,
    height,
  }
}
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 7 passed (7)`.

- [ ] **Step 3: Write the Electron adapters and install them**

`air/apps/desktop/src/electron/quick-entry.ts`:

```ts
/** The quick-entry window: frameless, always on top, hidden on blur or Escape, re-created after a Host restart. */

import { BrowserWindow, screen } from 'electron'
import { quickEntryBounds, quickEntryUrl } from '../quick-entry.ts'
import type { Shell } from './shell.ts'
import { lockToOrigin } from './window.ts'

/**
 * @param shell - main-process state and actions.
 * @returns a function that shows the window, or hides it when it is focused.
 */
export function installQuickEntry(shell: Shell): () => void {
  let window: BrowserWindow | undefined
  let windowOrigin: string | undefined
  const toggle = (): void => {
    const origin = shell.hostOrigin()
    if (origin === undefined) {
      shell.showMainWindow()
      return
    }
    if (window !== undefined && !window.isDestroyed()) {
      if (windowOrigin === origin) {
        if (window.isVisible() && window.isFocused()) window.hide()
        else {
          window.show()
          window.focus()
        }
        return
      }
      // The Host restarted on another port; this window still points at the old one.
      window.destroy()
    }
    const created = new BrowserWindow({
      ...quickEntryBounds(screen.getPrimaryDisplay().workArea),
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: shell.brand.productName,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false },
    })
    window = created
    windowOrigin = origin
    created.on('page-title-updated', (event) => { event.preventDefault() })
    lockToOrigin(created.webContents, () => shell.hostOrigin())
    created.on('blur', () => { if (!created.isDestroyed()) created.hide() })
    created.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') created.hide()
    })
    created.once('ready-to-show', () => {
      created.show()
      created.focus()
    })
    created.loadURL(quickEntryUrl(origin)).catch((error: unknown) => { shell.log(`quick entry: load failed: ${error instanceof Error ? error.message : String(error)}`) })
  }
  shell.setQuickEntryAction(toggle)
  return toggle
}
```

`air/apps/desktop/src/electron/hotkey.ts`:

```ts
/** Register the quick-entry shortcut from settings and tell the user when it cannot be registered. */

import { app, globalShortcut, Notification } from 'electron'
import { HotkeyManager } from '../hotkey.ts'
import type { Shell } from './shell.ts'

/**
 * @param shell - main-process state and actions.
 * @param toggle - quick-entry toggle.
 */
export function installHotkey(shell: Shell, toggle: () => void): void {
  const manager = new HotkeyManager(globalShortcut, toggle)
  let applied: string | undefined
  const apply = (): void => {
    const accelerator = shell.settings.get().quickEntryHotkey
    if (accelerator === applied) return
    applied = accelerator
    const status = manager.apply(accelerator)
    shell.log(`hotkey: ${JSON.stringify(status)}`)
    if (status.state !== 'failed' || !Notification.isSupported()) return
    new Notification({
      title: shell.brand.productName,
      body: `The shortcut ${status.accelerator} is not active: ${status.reason}. You can bind a system shortcut to "${shell.brand.executableName} --quick-entry" instead.`,
    }).show()
  }
  apply()
  shell.settings.onChange(apply)
  app.on('will-quit', () => { manager.dispose() })
}
```

Replace the body of `installFeatures` in `air/apps/desktop/src/electron/features.ts` and add the two imports (`installHotkey` from `./hotkey.ts`, `installQuickEntry` from `./quick-entry.ts`):

```ts
export async function installFeatures(shell: Shell): Promise<void> {
  const hasTray = await trayAvailable(process.platform, runCommand)
  if (hasTray) installTray(shell)
  installClosePolicy(shell, hasTray)
  installHotkey(shell, installQuickEntry(shell))
  installMenu(shell, {})
  shell.log(`features: tray=${String(hasTray)}`)
}
```

- [ ] **Step 4: Typecheck, build, and check by hand**

Run: `pnpm -C air/apps/desktop run typecheck`
Expected: exit 0.

Run: `pnpm -C air/apps/desktop run dev`, then in a second terminal `pnpm -C air/apps/desktop exec electron . --quick-entry`
Expected: a frameless 720×480 window with the conversation page appears above other windows; Escape or clicking elsewhere hides it; `shell.log` has a `hotkey:` line. On Windows `Control+Shift+Space` toggles the window. On Fedora from `electron .` the line reads `"state":"failed"` and a notification explains the fallback; the portal path is checked after Task 6 installs the rpm.

- [ ] **Step 5: Commit**

```text
git add air/apps/desktop
git commit -m "feat(air-desktop): add the quick-entry window and global shortcut"
```

---

### Task 6: Packaging configuration

electron-builder through its programmatic API, driven by one factory that reads the resolved brand. The staged tree and the optional primary-runtime payload ship as `extraResources`; the application archive holds only `lib/main.js`, the brand, and the icon, so electron-builder never collects `node_modules` (practices P1, P12, P13, P16). Builds are unsigned unless a signing hook is configured. Commands and file names in this plan show the placeholder executable name `air-desktop`; after a rename, read the name from `brand.json`.

**Files:**
- Modify: `air/apps/desktop/package.json` (devDependency `electron-builder`, script `package`)
- Create: `air/apps/desktop/scripts/builder-config.ts`, `air/apps/desktop/scripts/package.ts`
- Test: `air/apps/desktop/tests/builder-config.spec.ts`

**Interfaces:**
- Consumes: `Brand`, `resolveBrand` (Task 3); `StageTarget`, `stageTarget` (Task 1); `lib/icon.png` (Task 4); staged tree `.stage/<target>/runtime` and optional `.stage/<target>/primary-runtime`.
- Produces:
  - `createBuilderConfig(input: BuilderInput): Configuration` (also sets `electronLanguages: ['en-US']`; `verifyUpdateCodeSignature` is on only for signed builds) with `interface BuilderInput { brand: Brand; target: StageTarget; appRoot: string; hasPrimaryRuntime: boolean; publish: boolean; signHook?: string }`
  - Command `pnpm -C air/apps/desktop run package [--dir] [--skip-stage] [--primary-runtime]` writing `air/apps/desktop/dist/`
  - Unpacked executables used by Task 8: `dist/linux-unpacked/air-desktop`, `dist/win-unpacked/air-desktop.exe`
  - Environment: `AIR_DESKTOP_RELEASE=1` embeds the GitHub update feed and fails until `identifiersFinal` is `true` in `brand.json`; `AIR_WIN_SIGN_HOOK=<path to a CommonJS module exporting sign(configuration)>` signs Windows files

- [ ] **Step 1: Add the dependency and script**

In `air/apps/desktop/package.json` add to `devDependencies`:

```json
    "electron-builder": "^26.15.3",
```

and to `scripts`:

```json
    "package": "tsx scripts/package.ts",
```

Run: `pnpm -C air install`
Expected: exit 0.

- [ ] **Step 2: Write the failing configuration test**

`air/apps/desktop/tests/builder-config.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBuilderConfig } from '../scripts/builder-config.ts'
import { resolveBrand } from '../src/brand.ts'

const appRoot = join(import.meta.dirname, '..')
const brand = resolveBrand(JSON.parse(readFileSync(join(appRoot, 'brand.json'), 'utf8')))
const base = { brand, appRoot, hasPrimaryRuntime: false, publish: false }

describe('createBuilderConfig', () => {
  it('takes every brand value from the brand file and marks unsigned artifacts', () => {
    const config = createBuilderConfig({ ...base, target: 'linux-x64' })
    expect(config.appId).toBe(brand.appId)
    expect(config.productName).toBe(brand.productName)
    expect(config.artifactName).toBe(`${brand.executableName}-` + '${version}-${os}-${arch}-unsigned.${ext}')
    expect(config.protocols).toEqual([{ name: brand.productName, schemes: [brand.protocolScheme] }])
    expect(config.extraMetadata).toEqual({ desktopName: brand.desktopName })
    expect(JSON.stringify(config).toLowerCase()).not.toContain('deepseek harness')
  })

  it('ships the staged tree as loose resources and keeps the archive free of node_modules', () => {
    const config = createBuilderConfig({ ...base, target: 'linux-x64' })
    expect(config.files).toEqual(['lib/main.js', 'lib/brand.resolved.json', 'lib/icon.png', 'package.json'])
    expect(config.extraResources).toEqual([{ from: join(appRoot, '.stage', 'linux-x64', 'runtime'), to: 'runtime' }])
    expect(config.npmRebuild).toBe(false)
    expect(config.asarUnpack).toEqual(['**/*.{node,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep-*/bin/rg*'])
    expect(config.electronFuses).toEqual({ runAsNode: true })
    expect(config.electronLanguages).toEqual(['en-US'])
  })

  it('adds the primary runtime payload when it was staged', () => {
    const config = createBuilderConfig({ ...base, target: 'win-x64', hasPrimaryRuntime: true })
    expect(config.extraResources).toEqual([
      { from: join(appRoot, '.stage', 'win-x64', 'runtime'), to: 'runtime' },
      { from: join(appRoot, '.stage', 'win-x64', 'primary-runtime'), to: 'primary-runtime' },
    ])
  })

  it('builds rpm and AppImage on Linux with the scheme handler and the build-id workaround', () => {
    const config = createBuilderConfig({ ...base, target: 'linux-x64' })
    expect(config.linux).toMatchObject({
      target: ['rpm', 'AppImage'],
      executableName: brand.executableName,
      mimeTypes: [`x-scheme-handler/${brand.protocolScheme}`],
      desktop: { entry: { Name: brand.productName, StartupWMClass: brand.executableName } },
    })
    expect(config.rpm).toEqual({ fpm: ['--rpm-rpmbuild-define=_build_id_links none'] })
  })

  it('builds a per-user NSIS installer on Windows, unsigned by default and signed through the hook', () => {
    const unsigned = createBuilderConfig({ ...base, target: 'win-x64' })
    expect(unsigned.win).toMatchObject({ target: ['nsis'], executableName: brand.executableName, forceCodeSigning: false, verifyUpdateCodeSignature: false })
    expect(unsigned.nsis).toMatchObject({ oneClick: false, perMachine: false })
    const signed = createBuilderConfig({ ...base, target: 'win-x64', signHook: 'C:\\hooks\\sign.cjs' })
    expect(signed.win).toMatchObject({ signtoolOptions: { sign: 'C:\\hooks\\sign.cjs' }, verifyUpdateCodeSignature: true })
    expect(signed.artifactName).toBe(`${brand.executableName}-` + '${version}-${os}-${arch}.${ext}')
  })

  it('embeds the GitHub feed only for release builds', () => {
    expect(createBuilderConfig({ ...base, target: 'linux-x64' }).publish).toBeNull()
    expect(createBuilderConfig({ ...base, target: 'linux-x64', publish: true }).publish).toEqual([
      { provider: 'github', owner: brand.publish.owner, repo: brand.publish.repo, releaseType: 'draft' },
    ])
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, `Failed to resolve import "../scripts/builder-config.ts"`.

- [ ] **Step 3: Implement the factory and the packaging command**

`air/apps/desktop/scripts/builder-config.ts`:

```ts
/** electron-builder configuration for the AIR desktop app, derived from the resolved brand. */

import { join } from 'node:path'
import type { Configuration } from 'electron-builder'
import type { Brand } from '../src/brand.ts'
import type { StageTarget } from './stage-lib.ts'

/** Inputs of {@link createBuilderConfig}. */
export interface BuilderInput {
  brand: Brand
  target: StageTarget
  /** `air/apps/desktop`. */
  appRoot: string
  /** Whether `.stage/<target>/primary-runtime` exists. */
  hasPrimaryRuntime: boolean
  /** Embed the GitHub Releases update feed (release builds only). */
  publish: boolean
  /** CommonJS module exporting `sign(configuration)`; when absent the build is unsigned. */
  signHook?: string
}

/**
 * Build the configuration.
 * @param input - brand, target, paths, and release switches.
 * @returns the electron-builder configuration object.
 */
export function createBuilderConfig(input: BuilderInput): Configuration {
  const { brand } = input
  const stage = join(input.appRoot, '.stage', input.target)
  const signed = input.signHook !== undefined
  return {
    appId: brand.appId,
    productName: brand.productName,
    // Unsigned artifacts carry a suffix so they can never pass for a signed release.
    artifactName: `${brand.executableName}-\${version}-\${os}-\${arch}${signed ? '' : '-unsigned'}.\${ext}`,
    directories: { output: join(input.appRoot, 'dist') },
    files: ['lib/main.js', 'lib/brand.resolved.json', 'lib/icon.png', 'package.json'],
    asar: true,
    // The archive holds no native files today; the list guards later additions.
    asarUnpack: ['**/*.{node,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep-*/bin/rg*'],
    npmRebuild: false,
    // Chromium ships about fifty locale packs; the app's pages are English only.
    electronLanguages: ['en-US'],
    // The Host runs as `ELECTRON_RUN_AS_NODE=1 <app executable> air-host/index.js`.
    electronFuses: { runAsNode: true },
    extraMetadata: { desktopName: brand.desktopName },
    extraResources: [
      { from: join(stage, 'runtime'), to: 'runtime' },
      ...(input.hasPrimaryRuntime ? [{ from: join(stage, 'primary-runtime'), to: 'primary-runtime' }] : []),
    ],
    protocols: [{ name: brand.productName, schemes: [brand.protocolScheme] }],
    icon: 'lib/icon.png',
    win: {
      target: ['nsis'],
      executableName: brand.executableName,
      forceCodeSigning: false,
      // An unsigned build has no publisher to verify; a signed one verifies updates (this also needs `publisherName`, set by the signing plan).
      verifyUpdateCodeSignature: signed,
      ...(input.signHook === undefined ? {} : { signtoolOptions: { sign: input.signHook } }),
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      shortcutName: brand.productName,
      uninstallDisplayName: brand.productName,
    },
    linux: {
      target: ['rpm', 'AppImage'],
      executableName: brand.executableName,
      category: 'Utility',
      synopsis: brand.tagline,
      mimeTypes: [`x-scheme-handler/${brand.protocolScheme}`],
      desktop: { entry: { Name: brand.productName, Comment: brand.tagline, StartupWMClass: brand.executableName } },
    },
    // Electron apps otherwise conflict on /usr/lib/.build-id links when two are installed.
    rpm: { fpm: ['--rpm-rpmbuild-define=_build_id_links none'] },
    generateUpdatesFilesForAllChannels: true,
    publish: input.publish
      ? [{ provider: 'github', owner: brand.publish.owner, repo: brand.publish.repo, releaseType: 'draft' }]
      : null,
  }
}
```

`air/apps/desktop/scripts/package.ts`:

```ts
/** Build both workspaces, stage the runtime, and run electron-builder for the current platform. */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { build } from 'electron-builder'
import { assertReleasable, resolveBrand } from '../src/brand.ts'
import { createBuilderConfig } from './builder-config.ts'
import { runPnpm } from './pnpm.ts'
import { stageTarget } from './stage-lib.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const AIR_ROOT = resolve(APP_ROOT, '..', '..')

const pnpm = (args: readonly string[], cwd: string): void => { runPnpm(args, { cwd }) }

const { values } = parseArgs({
  options: {
    'dir': { type: 'boolean', default: false },
    'skip-stage': { type: 'boolean', default: false },
    'primary-runtime': { type: 'boolean', default: false },
  },
})
const target = stageTarget(process.platform, process.arch)
const brand = resolveBrand(JSON.parse(readFileSync(join(APP_ROOT, 'brand.json'), 'utf8')), process.env)
const release = process.env.AIR_DESKTOP_RELEASE === '1'
// Fail before building anything: release builds embed the update feed under the brand identifiers.
assertReleasable(brand, release)
const version = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version
const tag = process.env.GITHUB_REF_NAME
if (tag !== undefined && tag.startsWith(brand.releaseTagPrefix) && tag !== `${brand.releaseTagPrefix}${version}`) {
  throw new Error(`air desktop package: tag ${tag} does not match package version ${version}`)
}

pnpm(['--filter', '@air/desktop-host', 'run', 'build'], AIR_ROOT)
pnpm(['run', 'build'], APP_ROOT)
if (!values['skip-stage']) {
  pnpm(['run', 'stage', '--verify', ...(values['primary-runtime'] ? ['--primary-runtime'] : [])], APP_ROOT)
}
const stage = join(APP_ROOT, '.stage', target)
if (!existsSync(join(stage, 'runtime', 'air-host', 'index.js'))) {
  throw new Error('air desktop package: the staged runtime has no Host entry; run without --skip-stage')
}

const signHook = process.env.AIR_WIN_SIGN_HOOK
const config = createBuilderConfig({
  brand,
  target,
  appRoot: APP_ROOT,
  hasPrimaryRuntime: existsSync(join(stage, 'primary-runtime', 'runtime.json')),
  publish: release,
  ...(signHook === undefined || signHook === '' ? {} : { signHook }),
})
const artifacts = await build({
  projectDir: APP_ROOT,
  config,
  dir: values.dir,
  x64: true,
  publish: 'never',
  ...(target === 'win-x64' ? { win: [] } : { linux: [] }),
})
console.log(`air desktop package: ${values.dir ? 'unpacked build' : `${String(artifacts.length)} artifact(s)`} in ${join(APP_ROOT, 'dist')}`)
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 8 passed (8)`.

Run: `pnpm -C air/apps/desktop run typecheck`
Expected: exit 0. If a field name is rejected by the `Configuration` type of the installed electron-builder (for example `signtoolOptions` or `desktop.entry`), read `node_modules/app-builder-lib/out/options/` for the 26.x name, change the factory and its test together, and note the change in the commit message.

- [ ] **Step 4: Build the unpacked app and boot it**

Run: `pnpm -C air/apps/desktop run package --dir`
Expected: the stage lines from Task 1, electron-builder output ending without errors, and `air desktop package: unpacked build in <repo>/air/apps/desktop/dist`. `dist/linux-unpacked/resources/runtime/air-host/index.js` (Linux) or `dist\win-unpacked\resources\runtime\air-host\index.js` (Windows) exists, and so does `resources/runtime/licenses/UPSTREAM-LICENSE.txt`.

Run (Linux): `air/apps/desktop/dist/linux-unpacked/air-desktop --smoke`
Run (Windows PowerShell): `.\air\apps\desktop\dist\win-unpacked\air-desktop.exe --smoke; echo $LASTEXITCODE`
Expected: `AIR_HOST_READY`, `AIR_SMOKE_OK`, exit code 0. This is the check that the packaged layout, not only the staged tree, boots.

- [ ] **Step 5: Build installers and check the installed app (Fedora and Windows)**

Fedora needs `rpm-build` once: `sudo dnf install -y rpm-build`.

Run: `pnpm -C air/apps/desktop run package --skip-stage`
Expected on Fedora: `dist/air-desktop-0.1.0-linux-x86_64-unsigned.rpm` and `dist/air-desktop-0.1.0-linux-x86_64-unsigned.AppImage` (electron-builder writes its own architecture names). Expected on Windows: `dist\air-desktop-0.1.0-win-x64-unsigned.exe`.

Fedora, installed check: `sudo dnf install -y ./air/apps/desktop/dist/air-desktop-0.1.0-linux-x86_64-unsigned.rpm`, then confirm:

- `ls /usr/share/applications/air-desktop.desktop` exists and contains `MimeType=x-scheme-handler/air;`. If the file has another name, set `executableName` in `brand.json` so that `<executableName>.desktop` equals it, rebuild, and reinstall: the Wayland portal identity depends on this match.
- Launch "AIR" from the GNOME app grid; the window icon and name in the top bar are AIR's.
- Press `Control+Shift+Space`: GNOME asks once to allow the shortcut; after allowing, the quick-entry window toggles, and `shell.log` shows `"state":"registered"`.
- `sudo dnf remove -y air-desktop` removes the app.

Windows, installed check: run the installer (SmartScreen: More info, Run anyway); the Start menu has "AIR"; the tray icon appears; uninstall from Settings, Apps removes it.

- [ ] **Step 6: Commit**

```text
git add air/apps/desktop air/pnpm-lock.yaml
git commit -m "build(air-desktop): package NSIS, rpm, and AppImage from the brand file and the staged runtime"
```

---

### Task 7: Updates

electron-updater with the GitHub provider reading the fork's Releases (practice P11). The mode depends on how the app was installed: NSIS and AppImage download and install on quit; rpm and deb only notify and link to the release page, because their update path needs a password prompt; development builds and builds without an embedded feed never check. The channel is a setting.

**Files:**
- Modify: `air/apps/desktop/package.json` (devDependency `electron-updater`), `air/apps/desktop/src/electron/features.ts`
- Create: `air/apps/desktop/src/updates.ts`, `air/apps/desktop/src/electron/updates.ts`
- Test: `air/apps/desktop/tests/updates.spec.ts`

**Interfaces:**
- Consumes: `Settings.checkForUpdates`, `Settings.updateChannel`, `ShellPaths.updateConfig`, `Brand.publish`, `installMenu(shell, { checkForUpdates })`.
- Produces:
  - `type LinuxPackage = 'appimage' | 'rpm' | 'deb' | 'unknown'`; `detectLinuxPackage(env: Readonly<Record<string, string | undefined>>, packageType: string | undefined): LinuxPackage`
  - `type UpdateMode = { kind: 'disabled'; reason: string } | { kind: 'auto' } | { kind: 'notify' }`; `decideUpdateMode(input: UpdateModeInput): UpdateMode`
  - `interface UpdaterLike { configure(options: UpdaterOptions): void; onAvailable(listener: (version: string) => void): void; onDownloaded(listener: (version: string) => void): void; onError(listener: (message: string) => void): void; check(): Promise<void> }`
  - `startUpdater(updater: UpdaterLike, mode: UpdateMode, channel: 'latest' | 'beta', hooks: UpdateHooks): () => void` (returns "check now")
  - `installUpdates(shell: Shell): () => void` (the manual check)

- [ ] **Step 1: Add the dependency and write the failing tests**

In `air/apps/desktop/package.json` add to `devDependencies` (it is bundled into `lib/main.js`, so it is not a runtime dependency of the package):

```json
    "electron-updater": "^6.8.9",
```

Run: `pnpm -C air install`

`air/apps/desktop/tests/updates.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideUpdateMode, detectLinuxPackage, startUpdater, type UpdaterLike, type UpdaterOptions } from '../src/updates.ts'

describe('detectLinuxPackage', () => {
  it('prefers the AppImage environment, then the package-type file', () => {
    expect(detectLinuxPackage({ APPIMAGE: '/home/u/AIR.AppImage' }, 'rpm')).toBe('appimage')
    expect(detectLinuxPackage({}, 'rpm\n')).toBe('rpm')
    expect(detectLinuxPackage({}, 'deb')).toBe('deb')
    expect(detectLinuxPackage({}, undefined)).toBe('unknown')
    expect(detectLinuxPackage({}, 'pacman')).toBe('unknown')
  })
})

describe('decideUpdateMode', () => {
  const base = { isPackaged: true, hasFeed: true, enabled: true, platform: 'win32' as NodeJS.Platform, linuxPackage: 'unknown' as const }
  it.each([
    ['development build', { ...base, isPackaged: false }, { kind: 'disabled', reason: 'development build' }],
    ['no feed', { ...base, hasFeed: false }, { kind: 'disabled', reason: 'this build carries no update feed' }],
    ['setting off', { ...base, enabled: false }, { kind: 'disabled', reason: 'turned off in settings' }],
    ['windows', base, { kind: 'auto' }],
    ['appimage', { ...base, platform: 'linux' as NodeJS.Platform, linuxPackage: 'appimage' as const }, { kind: 'auto' }],
    ['rpm', { ...base, platform: 'linux' as NodeJS.Platform, linuxPackage: 'rpm' as const }, { kind: 'notify' }],
    ['deb', { ...base, platform: 'linux' as NodeJS.Platform, linuxPackage: 'deb' as const }, { kind: 'notify' }],
    ['unknown linux install', { ...base, platform: 'linux' as NodeJS.Platform }, { kind: 'disabled', reason: 'unknown install type' }],
    ['other platform', { ...base, platform: 'darwin' as NodeJS.Platform }, { kind: 'disabled', reason: 'unsupported platform' }],
  ])('%s', (_name, input, mode) => {
    expect(decideUpdateMode(input)).toEqual(mode)
  })
})

describe('startUpdater', () => {
  function fake() {
    const state: { options?: UpdaterOptions; checks: number; available?: (v: string) => void; downloaded?: (v: string) => void; error?: (m: string) => void } = { checks: 0 }
    const updater: UpdaterLike = {
      configure: (options) => { state.options = options },
      onAvailable: (listener) => { state.available = listener },
      onDownloaded: (listener) => { state.downloaded = listener },
      onError: (listener) => { state.error = listener },
      check: () => {
        state.checks += 1
        return Promise.resolve()
      },
    }
    const events: string[] = []
    const hooks = {
      available: (version: string, kind: 'auto' | 'notify') => { events.push(`available ${version} ${kind}`) },
      downloaded: (version: string) => { events.push(`downloaded ${version}`) },
      error: (message: string) => { events.push(`error ${message}`) },
    }
    return { state, updater, events, hooks }
  }

  it('downloads and installs on quit in auto mode and checks at once', () => {
    const f = fake()
    const checkNow = startUpdater(f.updater, { kind: 'auto' }, 'latest', f.hooks)
    expect(f.state.options).toEqual({ autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: false, channel: 'latest' })
    expect(f.state.checks).toBe(1)
    f.state.available?.('0.2.0')
    f.state.downloaded?.('0.2.0')
    f.state.error?.('network')
    checkNow()
    expect(f.state.checks).toBe(2)
    expect(f.events).toEqual(['available 0.2.0 auto', 'downloaded 0.2.0', 'error network'])
  })

  it('only notifies in notify mode and allows prereleases on the beta channel', () => {
    const f = fake()
    startUpdater(f.updater, { kind: 'notify' }, 'beta', f.hooks)
    expect(f.state.options).toEqual({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: true, channel: 'beta' })
    f.state.available?.('0.2.0-beta.1')
    expect(f.events).toEqual(['available 0.2.0-beta.1 notify'])
  })

  it('does nothing when disabled and reports the reason on a manual check', () => {
    const f = fake()
    const checkNow = startUpdater(f.updater, { kind: 'disabled', reason: 'development build' }, 'latest', f.hooks)
    checkNow()
    expect(f.state.options).toBeUndefined()
    expect(f.state.checks).toBe(0)
    expect(f.events).toEqual(['error Updates are disabled: development build'])
  })

  it('reports a rejected check', async () => {
    const f = fake()
    f.updater.check = () => Promise.reject(new Error('offline'))
    startUpdater(f.updater, { kind: 'auto' }, 'latest', f.hooks)
    await Promise.resolve()
    await Promise.resolve()
    expect(f.events).toEqual(['error offline'])
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: FAIL, `Failed to resolve import "../src/updates.ts"`.

- [ ] **Step 2: Implement the update policy**

`air/apps/desktop/src/updates.ts`:

```ts
/** Update behaviour per install type, and updater wiring behind a small interface. */

/** How a Linux build was installed. */
export type LinuxPackage = 'appimage' | 'rpm' | 'deb' | 'unknown'

/** `auto` downloads and installs on quit; `notify` only tells the user; `disabled` never checks. */
export type UpdateMode = { kind: 'disabled'; reason: string } | { kind: 'auto' } | { kind: 'notify' }

/** Facts that decide the update mode. */
export interface UpdateModeInput {
  isPackaged: boolean
  /** `resources/app-update.yml` exists (written only for release builds). */
  hasFeed: boolean
  /** The "check for updates" setting. */
  enabled: boolean
  platform: NodeJS.Platform
  linuxPackage: LinuxPackage
}

/** Values applied to the updater. */
export interface UpdaterOptions {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  channel: 'latest' | 'beta'
}

/** The part of electron-updater the shell uses. */
export interface UpdaterLike {
  configure(options: UpdaterOptions): void
  onAvailable(listener: (version: string) => void): void
  onDownloaded(listener: (version: string) => void): void
  onError(listener: (message: string) => void): void
  check(): Promise<void>
}

/** User-facing reactions. */
export interface UpdateHooks {
  available(version: string, kind: 'auto' | 'notify'): void
  downloaded(version: string): void
  error(message: string): void
}

/**
 * Detect the Linux install type.
 * @param env - process environment; AppImage sets `APPIMAGE`.
 * @param packageType - content of `resources/package-type`, which electron-builder writes for rpm and deb.
 * @returns the install type.
 */
export function detectLinuxPackage(env: Readonly<Record<string, string | undefined>>, packageType: string | undefined): LinuxPackage {
  if (env.APPIMAGE !== undefined && env.APPIMAGE !== '') return 'appimage'
  const type = packageType?.trim()
  return type === 'rpm' || type === 'deb' ? type : 'unknown'
}

/**
 * Decide whether and how this installation updates.
 * @param input - build, settings, and install facts.
 * @returns the mode, with a reason when disabled.
 */
export function decideUpdateMode(input: UpdateModeInput): UpdateMode {
  if (!input.isPackaged) return { kind: 'disabled', reason: 'development build' }
  if (!input.hasFeed) return { kind: 'disabled', reason: 'this build carries no update feed' }
  if (!input.enabled) return { kind: 'disabled', reason: 'turned off in settings' }
  if (input.platform === 'win32') return { kind: 'auto' }
  if (input.platform !== 'linux') return { kind: 'disabled', reason: 'unsupported platform' }
  switch (input.linuxPackage) {
    case 'appimage': return { kind: 'auto' }
    case 'rpm':
    case 'deb': return { kind: 'notify' }
    case 'unknown': return { kind: 'disabled', reason: 'unknown install type' }
  }
}

/**
 * Configure the updater, check once, and return a manual check.
 * @param updater - electron-updater behind {@link UpdaterLike}.
 * @param mode - decided mode.
 * @param channel - update channel setting.
 * @param hooks - user-facing reactions.
 * @returns a function for "Check for updates now".
 */
export function startUpdater(updater: UpdaterLike, mode: UpdateMode, channel: 'latest' | 'beta', hooks: UpdateHooks): () => void {
  if (mode.kind === 'disabled') {
    return () => { hooks.error(`Updates are disabled: ${mode.reason}`) }
  }
  const auto = mode.kind === 'auto'
  updater.configure({ autoDownload: auto, autoInstallOnAppQuit: auto, allowPrerelease: channel === 'beta', channel })
  updater.onAvailable((version) => { hooks.available(version, mode.kind) })
  updater.onDownloaded(hooks.downloaded)
  updater.onError(hooks.error)
  const check = (): void => {
    updater.check().catch((error: unknown) => { hooks.error(error instanceof Error ? error.message : String(error)) })
  }
  check()
  return check
}
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 9 passed (9)`.

- [ ] **Step 3: Write the Electron adapter and install it**

`air/apps/desktop/src/electron/updates.ts`:

```ts
/** electron-updater against the fork's GitHub Releases, with notifications instead of dialogs. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, Notification, shell as electronShell } from 'electron'
import electronUpdater from 'electron-updater'
import { decideUpdateMode, detectLinuxPackage, startUpdater, type UpdaterLike } from '../updates.ts'
import type { Shell } from './shell.ts'

/**
 * @param shell - main-process state and actions.
 * @returns the manual check for the Updates menu.
 */
export function installUpdates(shell: Shell): () => void {
  const { autoUpdater } = electronUpdater
  const packageTypeFile = join(process.resourcesPath, 'package-type')
  const settings = shell.settings.get()
  const mode = decideUpdateMode({
    isPackaged: app.isPackaged,
    hasFeed: existsSync(shell.paths.updateConfig),
    enabled: settings.checkForUpdates,
    platform: process.platform,
    linuxPackage: detectLinuxPackage(process.env, existsSync(packageTypeFile) ? readFileSync(packageTypeFile, 'utf8') : undefined),
  })
  shell.log(`updates: ${JSON.stringify(mode)} channel=${settings.updateChannel}`)
  const notify = (body: string, onClick?: () => void): void => {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title: shell.brand.productName, body })
    if (onClick !== undefined) notification.on('click', onClick)
    notification.show()
  }
  const releases = `https://github.com/${shell.brand.publish.owner}/${shell.brand.publish.repo}/releases`
  const updater: UpdaterLike = {
    configure: (options) => {
      autoUpdater.autoDownload = options.autoDownload
      autoUpdater.autoInstallOnAppQuit = options.autoInstallOnAppQuit
      autoUpdater.allowPrerelease = options.allowPrerelease
      autoUpdater.channel = options.channel
    },
    onAvailable: (listener) => { autoUpdater.on('update-available', (info) => { listener(info.version) }) },
    onDownloaded: (listener) => { autoUpdater.on('update-downloaded', (info) => { listener(info.version) }) },
    onError: (listener) => { autoUpdater.on('error', (error) => { listener(error.message) }) },
    check: async () => { await autoUpdater.checkForUpdates() },
  }
  return startUpdater(updater, mode, settings.updateChannel, {
    available: (version, kind) => {
      shell.log(`updates: ${version} available (${kind})`)
      if (kind === 'notify') {
        notify(`Version ${version} is available. Click to open the download page.`, () => { void electronShell.openExternal(releases) })
      }
    },
    downloaded: (version) => {
      shell.log(`updates: ${version} downloaded`)
      notify(`Version ${version} will be installed when you quit ${shell.brand.productName}.`)
    },
    error: (message) => { shell.log(`updates: ${message}`) },
  })
}
```

Replace the body of `installFeatures` in `air/apps/desktop/src/electron/features.ts` and add the import of `installUpdates` from `./updates.ts`:

```ts
export async function installFeatures(shell: Shell): Promise<void> {
  const hasTray = await trayAvailable(process.platform, runCommand)
  if (hasTray) installTray(shell)
  installClosePolicy(shell, hasTray)
  installHotkey(shell, installQuickEntry(shell))
  installMenu(shell, { checkForUpdates: installUpdates(shell) })
  shell.log(`features: tray=${String(hasTray)}`)
}
```

A change of the update settings takes effect at the next start; the menu shows the stored values at once.

- [ ] **Step 4: Typecheck, build, and check the disabled paths**

Run: `pnpm -C air/apps/desktop run typecheck`
Expected: exit 0.

Run: `pnpm -C air/apps/desktop run package --dir --skip-stage`, then start the unpacked app with `--smoke`.
Expected: exit 0, and `shell.log` contains `updates: {"kind":"disabled","reason":"this build carries no update feed"}`. From `pnpm run dev` the reason is `development build`. The enabled path is exercised by the first tagged release in Task 8: install release N, publish release N+1, start the app, and expect `updates: <version> available (auto)` on Windows and AppImage and `(notify)` on the rpm.

- [ ] **Step 5: Commit**

```text
git add air/apps/desktop air/pnpm-lock.yaml
git commit -m "feat(air-desktop): add updates from GitHub Releases with a mode per install type"
```

---

### Task 8: CI workflow and packaged smoke test

One workflow builds unsigned artifacts on `windows-2025` and `ubuntu-24.04` for tags `air-desktop-v<version>` and on manual dispatch, runs the unit tests, boots the staged tree, runs a Playwright `_electron` smoke against the unpacked build, and attaches artifacts to a draft release (practices P2, P13, P15).

**Files:**
- Modify: `air/apps/desktop/package.json` (devDependency `@playwright/test`, script `test:smoke`)
- Create: `air/apps/desktop/playwright.config.ts`, `air/apps/desktop/tests/smoke/packaged.e2e.ts`
- Create: `.github/workflows/air-desktop.yml`
- Modify: `air/UPSTREAM-DELTA.md`

**Interfaces:**
- Consumes: `dist/linux-unpacked/air-desktop` or `dist/win-unpacked/air-desktop.exe` (Task 6); the `host ready` line in `<userData>/logs/shell.log` (Task 3).
- Produces: command `pnpm -C air/apps/desktop run test:smoke`; workflow `air-desktop` with artifacts `air-desktop-linux-x64` and `air-desktop-win-x64`.

- [ ] **Step 1: Add Playwright and write the smoke test**

In `air/apps/desktop/package.json` add to `devDependencies`:

```json
    "@playwright/test": "^1.62.1",
```

and to `scripts`:

```json
    "test:smoke": "playwright test",
```

Run: `pnpm -C air install` (no browser download is needed; the test drives the packaged Electron).

`air/apps/desktop/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

/** One packaged-app smoke; it needs `pnpm run package --dir` first. */
export default defineConfig({
  testDir: 'tests/smoke',
  testMatch: '*.e2e.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
})
```

`air/apps/desktop/tests/smoke/packaged.e2e.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const appRoot = resolve(import.meta.dirname, '..', '..')
const brand = JSON.parse(readFileSync(join(appRoot, 'lib', 'brand.resolved.json'), 'utf8')) as { executableName: string }
const executablePath = process.platform === 'win32'
  ? join(appRoot, 'dist', 'win-unpacked', `${brand.executableName}.exe`)
  : join(appRoot, 'dist', 'linux-unpacked', brand.executableName)

test('the packaged app boots the Host and shows the app page without a token in the address', async () => {
  expect(existsSync(executablePath), `run "pnpm -C air/apps/desktop run package --dir" first: ${executablePath}`).toBe(true)
  const home = mkdtempSync(join(tmpdir(), 'air-smoke-home-'))
  const userData = mkdtempSync(join(tmpdir(), 'air-smoke-data-'))
  const env: Record<string, string> = { DSH_HOME: home }
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && env[name] === undefined) env[name] = value
  }
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], env })
  try {
    const shellLog = join(userData, 'logs', 'shell.log')
    await expect.poll(() => (existsSync(shellLog) ? readFileSync(shellLog, 'utf8') : ''), { timeout: 120_000 }).toContain('host ready')
    const page = await app.firstWindow()
    // The token URL answers with a redirect to the app page; the client may then change the path.
    await expect.poll(() => page.url(), { timeout: 60_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/(?!\?token=)/u)
    expect(page.url()).not.toContain('token=')
    for (const name of ['shell.log', 'host.log']) {
      const file = join(userData, 'logs', name)
      const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
      expect(text.replaceAll('token=<redacted>', ''), `${name} must not contain a token`).not.toContain('token=')
    }
    expect(existsSync(join(home, 'profiles', 'air', 'package.json'))).toBe(true)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
```

- [ ] **Step 2: Run the smoke locally**

Run: `pnpm -C air/apps/desktop run package --dir` (skip if `dist/*-unpacked` is current), then `pnpm -C air/apps/desktop run test:smoke`
Expected: `1 passed`. On Fedora this runs in the desktop session; no display server wrapper is needed.

- [ ] **Step 3: Write the workflow**

`.github/workflows/air-desktop.yml`:

```yaml
name: air-desktop
on:
  push:
    # `<releaseTagPrefix>*` from brand.json; tests/workflow.spec.ts fails when they differ.
    tags: ['air-desktop-v*']
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-24.04
            target: linux-x64
          - os: windows-2025
            target: win-x64
    runs-on: ${{ matrix.os }}
    timeout-minutes: 120
    env:
      # A tag build is a release build: it fails in the package step until identifiersFinal is true in brand.json,
      # so the release job below cannot run under placeholder identifiers.
      AIR_DESKTOP_RELEASE: ${{ startsWith(github.ref, 'refs/tags/air-desktop-v') && '1' || '0' }}
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

      - name: Linux packaging and display tools
        if: runner.os == 'Linux'
        # rpm supplies rpmbuild for the rpm target. Ubuntu 24.04 restricts unprivileged user
        # namespaces, which stops the unpacked Electron's Chromium sandbox; the runner setting
        # is relaxed for the test instead of disabling the sandbox in the app.
        run: |
          sudo apt-get update
          sudo apt-get install -y rpm xvfb
          sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

      - name: Install and build the fork
        run: pnpm install --frozen-lockfile
      - run: pnpm run build

      - name: Install the AIR workspace
        run: pnpm -C air install --frozen-lockfile
      - name: Build and test the Host entry
        run: pnpm -C air/apps/desktop-host run build
      - run: pnpm -C air/apps/desktop-host test
      - name: Typecheck and test the shell
        run: pnpm -C air/apps/desktop run build
      - run: pnpm -C air/apps/desktop run typecheck
      - run: pnpm -C air/apps/desktop test

      - name: Stage, verify, and build the unpacked app
        run: pnpm -C air/apps/desktop run package --dir
      - name: Boot the staged tree
        run: pnpm -C air/apps/desktop-host run test:boot

      - name: Packaged smoke (Linux)
        if: runner.os == 'Linux'
        run: xvfb-run -a pnpm -C air/apps/desktop run test:smoke
      - name: Packaged smoke (Windows)
        if: runner.os == 'Windows'
        run: pnpm -C air/apps/desktop run test:smoke

      - name: Build installers
        run: pnpm -C air/apps/desktop run package --skip-stage

      - uses: actions/upload-artifact@v4
        with:
          name: air-desktop-${{ matrix.target }}
          if-no-files-found: error
          path: |
            air/apps/desktop/dist/*.exe
            air/apps/desktop/dist/*.exe.blockmap
            air/apps/desktop/dist/*.rpm
            air/apps/desktop/dist/*.AppImage
            air/apps/desktop/dist/*.yml

  release:
    if: startsWith(github.ref, 'refs/tags/air-desktop-v')
    needs: build
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - name: Create a draft release with the installers and update files
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" artifacts/* --repo "$GITHUB_REPOSITORY" --draft --title "$GITHUB_REF_NAME" --notes "Unsigned build. Windows shows a SmartScreen warning; see air/apps/desktop/README.md."
```

Publishing the draft by hand makes it the update feed: `latest.yml`, `latest-linux.yml`, and (for prerelease versions) `beta.yml` files are among the assets. The plan 00 job (`air.yml`) installs and tests only `packages/*` and `bundles/*` and lints `packages` and `apps`; this workflow owns the build and tests of `apps/*`.

`air/apps/desktop/tests/workflow.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBrand } from '../src/brand.ts'

const appRoot = join(import.meta.dirname, '..')
const brand = resolveBrand(JSON.parse(readFileSync(join(appRoot, 'brand.json'), 'utf8')))
const workflow = readFileSync(join(appRoot, '..', '..', '..', '.github', 'workflows', 'air-desktop.yml'), 'utf8')

describe('air-desktop workflow', () => {
  it('uses the release tag prefix of the brand file in its trigger, its release switch, and its release job', () => {
    expect(workflow).toContain(`tags: ['${brand.releaseTagPrefix}*']`)
    expect(workflow.match(new RegExp(`refs/tags/${brand.releaseTagPrefix}`, 'gu'))).toHaveLength(2)
  })
})
```

Run: `pnpm -C air/apps/desktop test`
Expected: `Test Files 10 passed (10)`.

- [ ] **Step 4: Record the in-tree file**

Add this row to the table in `air/UPSTREAM-DELTA.md`:

```markdown
| `.github/workflows/air-desktop.yml` | New file | Builds, smoke-tests, and drafts releases of the AIR desktop app on Windows and Linux runners |
```

In the "Candidates not yet made" paragraph of the same file, delete the item "Linux tray and global hotkey in `apps/desktop/src/`": the AIR-owned shell replaces it.

- [ ] **Step 5: Run the text gates, then commit**

Run: `pnpm -C air run lint`
Expected: exit 0. Plan 00's lint configuration forbids `console` in `apps/*/src` and applies its other rules to the two app workspaces; fix findings in the files that carry them.

Run: `pnpm run verify-concrete-terms` and `pnpm run verify-repository-references` and `pnpm run verify-no-unknown-casts`
Expected: each exits 0.

```text
git add .github/workflows/air-desktop.yml air/UPSTREAM-DELTA.md air/apps/desktop air/pnpm-lock.yaml
git commit -m "ci(air-desktop): build and smoke-test Windows and Linux installers and draft releases"
```

After the branch is merged to `air/main`, run the workflow once from the Actions tab (workflow_dispatch) and confirm both jobs pass and upload artifacts. This is not a release.

**Release gate.** Do not cut a release while `identifiersFinal` in `brand.json` is `false`; a tag build fails in the package step then. Once the owner has fixed the product name and set the identifiers and `identifiersFinal: true`, update `version` in `air/apps/desktop/package.json`, then run two separate commands (the tag is `<releaseTagPrefix><version>`, shown here with the placeholder prefix and version `0.1.0`):

```text
git tag air-desktop-v0.1.0
git push origin air-desktop-v0.1.0
```

---

### Task 9: Documentation

**Files:**
- Create: `air/apps/desktop/README.md`, `air/SAFETY.md`
- Modify: `air/README.md`, `air/ONBOARDING.md`, `air/BRANDING.md`

**Interfaces:**
- Consumes: commands and behaviour from Tasks 1–8; the Windows staging result recorded in Task 1 Step 11.
- Produces: user and developer documentation; no code.

- [ ] **Step 1: Write the app README**

`air/apps/desktop/README.md` (append the Windows staging result from Task 1 Step 11 as one line under "Commands" if a fallback was needed):

````markdown
# AIR desktop app

## Summary

An Electron shell around the AIR Host for Windows and Linux. The main process takes the single-instance lock, starts the Host (`air/apps/desktop-host`) with Electron in Node mode from the bundled runtime tree, and loads the Host's authenticated loopback address (an operating-system-assigned port, different on every start) in one sandboxed window that cannot leave that origin. It adds a close policy per platform, a tray icon where the desktop can show one, a global shortcut with a quick-entry window, and updates from GitHub Releases. Product name, application id, URL scheme, release tag prefix, and release repository come from [brand.json](brand.json); the identifiers are placeholders until the owner sets `identifiersFinal`.

## Commands

Run from the repository root, in PowerShell or a POSIX shell, after `pnpm install`, `pnpm run build`, and `pnpm -C air install`. The AIR install downloads Electron (about 110 MB); `pnpm -C air install --ignore-scripts` skips it for work outside the desktop app, and `pnpm -C air rebuild electron` fetches it later.

| Command | Result |
|---|---|
| `pnpm -C air/apps/desktop-host run build` | Builds the Host entry |
| `pnpm -C air/apps/desktop run stage --verify` | Stages the runtime tree under `.stage/<target>/runtime` and boots it once |
| `pnpm -C air/apps/desktop run dev` | Builds and starts the app from source against the staged tree |
| `pnpm -C air/apps/desktop test` | Unit tests |
| `pnpm -C air/apps/desktop run package --dir` | Unpacked app in `dist/` |
| `pnpm -C air/apps/desktop run test:smoke` | Playwright smoke against the unpacked app |
| `pnpm -C air/apps/desktop run package` | Installers: NSIS on Windows; rpm and AppImage on Linux (needs `rpm-build` on Fedora) |

Add `--primary-runtime` to `stage` or `package` to bundle the standalone Node, pnpm, and Python payload that the workspace-dependencies tool installs offline on first use. It downloads several hundred megabytes at build time.

## Behaviour

| | Windows | Linux (GNOME) |
|---|---|---|
| Close button | Hides to the tray | Quits; with "Keep running in the background" it hides, shows a notification once, and the app grid or the shortcut reopens it |
| Tray | Always | Only when a StatusNotifier host is running (KDE, or GNOME with the AppIndicator extension) |
| Quick-entry shortcut | `Control+Shift+Space` (setting `quickEntryHotkey`) | Same, through the GlobalShortcuts portal; installed rpm only. Fallback: bind a system shortcut to `air-desktop --quick-entry` |
| Updates | Download, install on quit | AppImage: same. rpm: notification with a link |

Settings live in `settings.json` in the app's data directory (`%APPDATA%\AIR` or `~/.config/AIR`) and are edited through the application menu. Logs are `logs/shell.log` and `logs/host.log` in the same directory; token values are replaced before writing.

## Signing

Builds are unsigned and carry `-unsigned` in the file name. Windows shows a SmartScreen warning on first run (More info, Run anyway). To sign, set `AIR_WIN_SIGN_HOOK` to a CommonJS module that exports `sign(configuration)`; electron-builder calls it for each file. The intended signer is SignPath Foundation after the first public release.

Updates of an unsigned build have no publisher check. electron-updater compares the SHA-512 values in the release's update files with the downloaded installer, and both come from the same release, so whoever can publish a release in the update repository can replace the app on every machine that updates automatically. The draft release step keeps a person between a build and the feed. A signed build turns on update signature verification (`verifyUpdateCodeSignature`), which also needs `publisherName`; the signing plan sets it.

## Releasing

Nothing is released while `identifiersFinal` in [brand.json](brand.json) is `false`: a build with `AIR_DESKTOP_RELEASE=1` and a tag build in CI fail in the package step. The owner sets it to `true` after the product name, application id, URL scheme, executable name, and release tag prefix are final. Changing any of them after a release resets users' data and the global-shortcut consent.

## Known Limitations

- Only `linux-x64` and `win-x64`. macOS, deb, and Flatpak are not built.
- GNOME's Background Apps list shows Flatpak apps; the rpm build does not appear there. The Background portal request is sent but gives no visible control.
- The global shortcut needs the installed desktop file. It does not register from `pnpm run dev` or a bare AppImage on GNOME Wayland.
- The Host's port and token change on every start and every Host restart. A bookmark or an external tool cannot rely on the address, and a restart returns the window to the conversation page but not to the same scroll position.
- Closing the window on GNOME quits the app, and quitting stops the Host without asking, even while an agent run is active. Upstream's desktop Host answers a quit-inspection request that the AIR Host does not implement yet.
- The URL scheme is registered only by packaged builds. A link of the scheme focuses the window; opening a given conversation from a link is not implemented.
- The app runs the plain Web client. Features that upstream's desktop app implements in its own preload (native directory picker, in-app update status, account views) are absent.
- Links that the page opens in a new window are sent to the default browser when they are web links and are otherwise dropped, including same-origin pop-ups.
- A GUI launch inherits the desktop session's environment, not the login shell's; tools on a `PATH` set only in shell profiles may be missing for agent commands.
- The staged tree is about 500 MB before compression (measured on `linux-x64` at the earlier tag; `stage` prints the current file count, size, largest packages, and longest path) and is installed as loose files, so installation is slower than for a single-archive app. Source maps and non-English Chromium locales are already removed.
- Update settings apply at the next start. rpm updates are manual.
- Office skills and the bundled LibreOffice engine are not wired; only the workspace-dependencies payload is mounted when it is bundled.

## After an upstream merge

Rebuild the root, then run `pnpm -C air/apps/desktop-host run build`, `pnpm -C air/apps/desktop run stage --verify`, and `pnpm -C air/apps/desktop-host run test:boot`. The Host depends on `runProfile` (with the `--port 0` argument), `loadProfileDirectory`, `initProfile`, `resolveProfileDir`, `PROFILE_TEMPLATES`, `ctx.connection.authenticatedUrl`, and `ctx.webServer.port`; a change to any of them is fixed in `air/apps/desktop-host/src/boot.ts`. Upstream's own Host in `apps/desktop-host/src/index.ts` is the reference for how it calls them. If staging reports required packages that are neither staged nor in a workspace, upstream added a registry dependency that only a peer names; report it before changing the script.
````

- [ ] **Step 2: Write the safety notes**

`air/SAFETY.md`:

```markdown
# AIR safety notes

Status: covers the desktop shell. The threat model for MCP servers, permissions, and memory is added by the plans that build those parts.

## What the desktop shell enforces

- The window runs with context isolation, the Chromium sandbox, no Node integration, and web security on. It has no preload script and no access to Electron or Node APIs.
- The window can navigate only to the Host's loopback origin. Other web links open in the default browser; other schemes are dropped; new windows and `<webview>` are denied.
- Page permission requests are granted only to the Host origin and only for microphone and camera capture, notifications, fullscreen, and clipboard access.
- The Host listens on `127.0.0.1` only, on a port the operating system picks at each start, and requires the per-start token, which the first navigation exchanges for an HttpOnly, SameSite=Strict cookie. The shell redacts tokens per output line before writing its logs, and catches load errors (whose text names the URL) before Electron can print them.
- One instance runs per user; a second launch forwards its arguments and exits.

## What the desktop shell does not sandbox

- **The Host and the agent.** The Host is an ordinary process with the user's permissions. Commands the agent runs are confined only by the harness's own sandbox backends (bubblewrap, then Landlock, on Linux; the harness's Windows backend on Windows) and by the permission mode in use. The shell adds no confinement.
- **Other local programs.** Any process of the same user can connect to the loopback port. The token and cookie protect the API; they do not hide that the port is open.
- **MCP servers and network access.** Child servers and outbound requests are outside the shell's control.
- **Installers and updates.** Builds are unsigned until a signing service is in place. Update integrity rests on HTTPS to GitHub and the SHA-512 values in the release's update files; there is no publisher signature check. Anyone who can publish a release in the update repository can replace the app on every machine that updates automatically (Windows and AppImage); rpm installs only show a notification.
- **Local files.** Sessions, memory, settings, and logs are stored unencrypted under the Harness home and the app's data directory.

## Privacy

The desktop shell sends nothing to AIR's authors. It contacts GitHub Releases to check for updates when that setting is on. The `air` bundle turns off the upstream vendor's uploads, accounts, and telemetry.
```

- [ ] **Step 3: Update the workspace README, onboarding, and branding notes**

In `air/README.md`, replace the `Layout` code block with:

````markdown
```
air/
  pnpm-workspace.yaml     separate pnpm workspace (bundles/*, packages/*, apps/*)
  bundles/air/            @air/dsh-air-bundle: product defaults as a Cordis patch
  packages/<pkg>/         AIR plugins (added feature by feature)
  apps/desktop-host/      Host entry the desktop app starts
  apps/desktop/           Electron desktop app for Windows and Linux (see its README)
  examples/               profile-patch examples, e.g. the local Ollama route
  SAFETY.md               what is and is not confined
  UPSTREAM-DELTA.md       every file AIR changes outside air/ and research/
```
````

and add after the section "The `air` profile":

```markdown
## The desktop app

The desktop app creates the `air` profile itself on first start and uses the same profile directory as the commands above. Build and run it with the commands in [apps/desktop/README.md](apps/desktop/README.md); they work in PowerShell and in a POSIX shell.
```

In `air/ONBOARDING.md`, add a section at the end:

````markdown
## Desktop app: first run on your machine

Prerequisites: the repository installed and built (`pnpm install`, `pnpm run build`), then `pnpm -C air install`. Ollama running with the model named in `air/examples/ollama.profile.cordis.patch.yml`.

Windows (PowerShell, no WSL):

```powershell
pnpm -C air/apps/desktop-host run build
pnpm -C air/apps/desktop run stage --verify
pnpm -C air/apps/desktop run dev
```

Fedora:

```sh
sudo dnf install -y rpm-build        # only for building the rpm
pnpm -C air/apps/desktop-host run build
pnpm -C air/apps/desktop run stage --verify
pnpm -C air/apps/desktop run dev
```

The workspace install downloads Electron (about 110 MB); if you do not work on the desktop app, run `pnpm -C air install --ignore-scripts` instead. `stage --verify` must end with `boot ok`. If it fails on Windows with a path-length error, stage into a short directory: `pnpm -C air/apps/desktop run stage --verify --out C:\air-stage`, and report it. Re-run `stage` after every root rebuild or change under `air/bundles` or `air/apps/desktop-host`. Logs are under `%APPDATA%\AIR\logs` or `~/.config/AIR/logs`.
````

In `air/BRANDING.md`, replace the Layer 3 bullet that begins "Desktop: product name, app id, icons" with:

```markdown
- Desktop: none. The AIR-owned shell reads every brand value from `air/apps/desktop/brand.json` (`{{PRODUCT_NAME}}`, `{{PRODUCT_TAGLINE}}`, application id, URL scheme, executable name, release tag prefix, and the `identifiersFinal` release gate); upstream's `apps/desktop` is not used.
```

- [ ] **Step 4: Run the text gates and commit**

Run: `pnpm run verify-concrete-terms` and `pnpm run verify-repository-references` and `pnpm run verify-translation-pairing`
Expected: each exits 0 (AIR documents are excluded from translation pairing by the manifest entry listed in `air/UPSTREAM-DELTA.md`).

```text
git add air/apps/desktop/README.md air/SAFETY.md air/README.md air/ONBOARDING.md air/BRANDING.md
git commit -m "docs(air-desktop): document the desktop app, onboarding on Windows and Fedora, and safety notes"
```

---

## Follow-up plans

Out of scope here; each is its own plan.

- **macOS build.** Needs an Apple Developer ID for a usable release (owner decision: dropped for now).
- **deb for Ubuntu** with the Chromium sandbox post-install step and an AppArmor profile; AppImage is known to fail on Ubuntu 24.04 without it (note 09 section 2.4).
- **Flatpak**, which is also the route to GNOME's Background Apps list; needs a design for running host commands from inside the Flatpak sandbox.
- **In-app AIR settings page** (client plugin plus an AIR preload) replacing the application-menu checkboxes and the settings file.
- **Quick-entry client page** (`@air/dsh-client-quick-entry`) reading the `#air-quick-entry` fragment; voice and overlay integration from roadmap items 3 and 4.
- **SignPath Foundation onboarding**: publish the first unsigned release, add a "Code signing policy" section and team roles to the project page, apply, then point `AIR_WIN_SIGN_HOOK` at a SignPath submit script and set `verifyUpdateCodeSignature` with the publisher name (note 13 section 1.9).
- **Office skills and LibreOffice engine** wiring in the Host, as upstream's private Host does.
- **Login-shell environment probe** for GUI launches on Linux.
- **rpm in-place updates** through electron-updater's package-manager path, once the password prompt is acceptable.
- **`utilityProcess` Host** so the `runAsNode` fuse can be disabled.
- **Size reduction** of the staged tree beyond source maps and locales (declaration files, unused optional providers) after confirming nothing reads them at run time.
- **Start at login** (Linux XDG autostart entry, Windows login item, a `--hidden` launch flag, a setting and menu entry). Moved out of phase 1: no owner decision or demo step needs it, it writes to the user's startup configuration under placeholder identifiers, and the Windows login item cannot be checked before there is a signed build.
- **Deep-link routing**: open a given conversation from a link of the app's URL scheme, building the address from the Host's current origin. Phase 1 registers the scheme in packaged builds and only focuses the window.
- **Quit inspection**: ask before quitting while an agent run is active, as upstream's desktop Host does through its quit-inspection message; needs a matching message in the AIR Host protocol.
- **Windows publisher name** for update verification, together with SignPath onboarding.
- **First-run checks** (Ollama running, model pulled) before the first conversation.

## Self-Review

- **Spec coverage.** Staging and boot check: Task 1. Host entry with ready, fatal, and shutdown over IPC and a real boot under an isolated home: Task 2. Single instance, supervision with restart policy, per-line redacted logs and a restarting page, dynamic Host port, sandboxed window, origin lock that follows the current origin, external links: Task 3. Close policy per OS, conditional tray, menu: Task 4. Hotkey and quick entry (re-created after a Host restart), `.desktop` identity documented: Task 5. electron-builder config from the brand file, NSIS, rpm, AppImage, `asarUnpack`, `extraResources`, unsigned default and signing hook, upstream license in the package: Tasks 1 and 6. Updates by package type with a channel setting, disabled in development and feed-less builds: Task 7. CI matrix, Playwright smoke, release gate and tag-prefix check, UPSTREAM-DELTA row: Task 8. README with Summary and Known Limitations, onboarding for PowerShell and Fedora, safety notes: Task 9. Deferred items are listed under Follow-up plans.
- **Deviations from the 2026-10-03 text, on purpose (2026-10-08).** Dynamic Host port instead of a fixed one; start at login moved to Follow-up plans; the release path gated on `identifiersFinal`. See the Revision log for the reasons.
- **Deviations from note 09, on purpose.** The staged tree ships as `extraResources` instead of inside the archive; `desktopName` is `air-desktop.desktop` (the file electron-builder installs) instead of a reverse-DNS file name; `pnpm deploy` alone is not enough and a workspace peer fill was added; the Background portal does not put the rpm build into GNOME's Background Apps list, so a notification and launcher path were added; rpm updates notify instead of installing.
- **Types across tasks.** `HostEvent`/`HostCommand` (Task 2) are used by `HostSupervisor` and `HostChild` (Task 3). `Shell` (Task 3) is the only parameter of every `install*` function (Tasks 4, 5, 7). `Settings` fields used later (`keepRunningInBackground`, `quickEntryHotkey`, `checkForUpdates`, `updateChannel`) are all defined in Task 3. `Brand.releaseTagPrefix` and `Brand.identifiersFinal` (Task 3) are used by `package.ts` (Task 6) and `tests/workflow.spec.ts` (Task 8). `SupervisorHandlers.restarting` (Task 3) is implemented in `main.ts`. `CommandRunner` is defined in `tray-support.ts` and reused by `background-portal.ts` and `run-command.ts`. `MenuActions.checkForUpdates` is optional in Task 4 and supplied in Task 7. `StageTarget` and `stageTarget` (Task 1) are used by Tasks 2 and 6. `bootStage` (Task 1) is used by Task 2's boot test.
- **Verified at the 2026-10-08 revision (Fedora, scratch copy outside the repository).** Every TypeScript file of the plan, as written after the revision, was extracted into a scratch tree and typechecked with `tsc` 6 under the `air/tsconfig.base.json` options (including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`) against the real types of Electron 44.0.0, electron-builder, electron-updater, and the upstream packages the Host imports, except the Playwright smoke test and `playwright.config.ts` (the package is not installed here): exit 0. The 14 unit test files (10 in `air/apps/desktop`, 4 in `air/apps/desktop-host`) ran with Vitest 4: 116 tests passed, which is the count of the tests written in this plan. The upstream calls were checked by reading the tree at `dsh-v0.2.1-alpha.1`. The peer-only count (28) comes from a script over the manifests, not from a `pnpm deploy`.
- **Verified at writing time (2026-10-03, Fedora, scratch copy outside the repository).** Every TypeScript file in this plan was extracted and typechecked with `tsc` 6 under the `air/tsconfig.base.json` options against the real types of Electron 44.0.0, electron-builder, electron-updater, and the upstream packages the Host imports: exit 0. The 13 unit test files ran with Vitest: 111 tests passed. The staging commands, the peer fill, and a Host with the same upstream calls were run in the scratch spike (note 13 section 2).
- **Not run.** `pnpm deploy` and the staging script at the new tag (so the filled-package count, the size figures, and the longest path are unmeasured), launching Electron (including the Host restart page, the origin change across a restart, and the quick-entry re-creation), the tsdown bundles, electron-builder packaging, `electronLanguages`, the Playwright smoke, the lint run under plan 00's configuration, the workflow, and everything on Windows (including `taskkill` on the Host tree). The steps that first exercise them state the expected output; treat the first failing step as the place where an assumption is corrected.
