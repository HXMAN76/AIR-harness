# Note 13: desktop shell practice in comparable projects, and the staging spike

Status: research note, 2026-10-03. Base: `air/main` on upstream release tag `dsh-v0.2.0-rc.2`. Machine: Fedora 44, GNOME Shell 50.5 on Wayland, x86_64, Node 22.23.1, pnpm 11.7.0, Electron 44.0.0 (installed under the repository's `node_modules`).

This note serves plan 07 ([air/plans/2026-10-03-07-desktop-shell.md](../../air/plans/2026-10-03-07-desktop-shell.md)) and extends [note 09](09-desktop-cross-os.md), which chose the AIR-owned Electron shell. Evidence labels used below:

- **[V]** verified on 2026-10-03 by fetching the cited file or page, or by running the cited command.
- **[N09]** verified on 2026-10-02 in note 09 and not re-fetched.
- **[R]** recalled from general knowledge; not re-checked today. Treat as a lead, not a fact.

## Summary

- Every open-source project surveyed that wraps a local agent or server uses the same four parts: a shell (Electron in four of five), a backend process started by the main process, a secret generated per launch and handed to the page out of band, and a loopback-only listener. AIR's design in note 09 matches this pattern.
- Two projects are close precedents. Goose ships rpm, deb, and Flatpak from one Electron configuration and uses electron-updater against GitHub Releases. Cherry Studio 2.1.4 packages the same harness packages AIR depends on (`@deepseek-ai/dsh-*` at `0.2.0-rc.2`) with electron-builder 26 and pnpm, and its `asarUnpack` list names the native files that must stay outside the archive.
- The staging spike ran and passed with one finding that changes the plan: `pnpm deploy --prod` of `@deepseek-ai/dsh` produces a tree that does **not** boot, because 27 workspace packages that other packages name only as peers are absent. Copying those 27 packages from the built workspace makes the tree self-contained; the `air` bundle then boots from it under plain Node in 2.5 s and under Electron 44 in Node mode in 1.8 s.
- One owner expectation needs correcting: GNOME's Background Apps list shows Flatpak applications. An rpm-installed application that calls the Background portal is permitted to run but is not listed. The opt-in background mode therefore needs its own visible way back (notification, launcher, hotkey).

## 1. Survey

| Project (version read) | Shell | Backend process | Packaging | Linux targets | Updates |
|---|---|---|---|---|---|
| Goose desktop 1.53.0 | Electron 43.4.0, Electron Forge 7.11.2 | Separate Rust binary `goosed`, shipped under `src/bin` | `extraResource: ['src/bin', 'src/images', 'src/app-update.yml']`, `asar: true`, fuses plugin | zip, deb, rpm, Flatpak | electron-updater 6.8.9, GitHub provider, plus an own GitHub-download fallback |
| Open WebUI Desktop 0.0.20 | Electron 39, electron-vite, electron-builder 26.0.12 | Python server installed on first launch ("Internet required on first launch") | `asarUnpack: resources/**, node_modules/node-pty/**`, `npmRebuild: true` | AppImage, snap, deb, Flatpak | electron-updater 6.3.9, `publish: github` |
| Cherry Studio 2.1.4 | Electron 44.2.0, electron-vite, electron-builder 26.15.6, pnpm 12.6.0 | In-process main plus a bundled Bun runtime for the harness bridge | Long `asarUnpack` list of native packages; per-OS `extraResources` | AppImage, deb, rpm | electron-updater 6.7.0, generic HTTPS provider |
| Jan (main branch) | Tauri 2 (`@tauri-apps/cli` ^2.7.0) | Rust core with sidecar binaries | Tauri bundler | AppImage, deb [R] | Tauri updater endpoints |
| Ollama app | Go program with a React UI; Inno Setup on Windows | The Go binary is the server | Native installers | none from the app directory | Own updater [R] |

Sources, all [V]: Goose [`ui/desktop/forge.config.ts`](https://github.com/aaif-goose/goose/blob/main/ui/desktop/forge.config.ts), [`package.json`](https://github.com/aaif-goose/goose/blob/main/ui/desktop/package.json), and [`src/main.ts`](https://github.com/aaif-goose/goose/blob/main/ui/desktop/src/main.ts) (the repository moved from the `block` organization to `aaif-goose`; the old raw URLs redirect). Open WebUI Desktop [`electron-builder.yml`](https://github.com/open-webui/desktop/blob/main/electron-builder.yml), [`README.md`](https://github.com/open-webui/desktop/blob/main/README.md), and release `v0.0.20` (published 2026-05-06). Cherry Studio [`electron-builder.yml`](https://github.com/CherryHQ/cherry-studio/blob/main/electron-builder.yml) and [`package.json`](https://github.com/CherryHQ/cherry-studio/blob/main/package.json). Jan [`package.json`](https://github.com/janhq/jan/blob/main/package.json) and [`src-tauri/tauri.conf.json`](https://github.com/janhq/jan/blob/main/src-tauri/tauri.conf.json). Ollama [`app/README.md`](https://github.com/ollama/ollama/blob/main/app/README.md).

Not surveyed from source: AnythingLLM Desktop, LM Studio, Msty, Claude Desktop, and the Codex app publish no desktop-shell source that could be read today; statements about them below are [R] and limited to visible behaviour. LibreChat has no official desktop wrapper [R]. No public desktop shell for Hermes Agent was found in the time available; it is left out.

### 1.1 Spawning and supervising the backend

Three mechanisms are in use.

1. **A separate native binary under `resources/`** (Goose, Jan, Ollama). The main process calls `child_process.spawn` on a path below `process.resourcesPath`. This needs no Node in the child and no archive handling, and is the reason Goose lists `src/bin` under `extraResource` [V].
2. **Electron in Node mode** (upstream's desktop app, VS Code's command-line launcher [R]). The main process spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and an IPC channel (`stdio: ['ignore', 'pipe', 'pipe', 'ipc']`), as `apps/desktop/src/host-process.ts` does [V, read in this checkout]. The child is an ordinary Node process, so `process.send`, `process.on('disconnect')`, and native addons work unchanged. It requires the `runAsNode` fuse to stay enabled; upstream sets `electronFuses: { runAsNode: true }` [N09].
3. **`utilityProcess.fork`**. Electron's documentation describes it as the equivalent of `child_process.fork` that uses Chromium's Services API and message ports, callable only after the `ready` event ([Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)) [V]. VS Code runs its extension host this way [R]. It keeps the fuse closed, but the child is not a plain Node process: `process.send` is replaced by `process.parentPort`, so upstream's Host entry and any code that expects a Node IPC channel would need an adapter.

Decision for AIR: mechanism 2. The spike below showed the staged tree booting under Electron 44.0.0 in Node mode (Node 24.18.1) without extra flags. `utilityProcess` stays a later hardening option because it would let AIR disable the `runAsNode` fuse.

Supervision practice seen in Goose's `main.ts` [V]: the backend's readiness is awaited before the window loads; the shell owns shutdown on `will-quit`; failures surface in a dialog. Upstream's `DesktopHost` adds a bounded stderr tail kept for the failure message and a `shutdown` message followed by escalation to termination [V]. None of the surveyed shells restarts the backend silently more than a few times; AIR adopts a bounded restart policy (three restarts in sixty seconds, then a visible failure).

### 1.2 Packaging the backend's dependency tree and native modules

- **Native files must be outside `app.asar`.** Cherry Studio unpacks `node_modules/node-pty/**`, `node_modules/koffi/**`, `node_modules/@koromix/koffi-*/**`, `node_modules/@img/sharp-*/**`, `node_modules/@deepseek-ai/node-addon-system*/**`, `node_modules/@deepseek-ai/dsh-subprocess/**`, `node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**`, `node_modules/@deepseek-ai/dsh-win32-process/**`, and several pure-JavaScript packages that locate files relative to themselves (`@deepseek-ai/cordis`, `cosmokit`, `schemastery`, `dsh-skill`, `dsh-scope`, `yaml`) [V]. Upstream's own list is the glob form `**/*.{node,dylib,dll,so,exe}`, `**/*.so.*`, `**/spawn-helper`, `**/@vscode/ripgrep-*/bin/rg`, and the platform LibreOffice package (`apps/desktop/scripts/electron-builder-config.mjs`) [V].
- **A whole tree as loose files is the simpler route.** Goose avoids the archive question by shipping the backend as `extraResource`. For AIR, putting the staged tree under `extraResources` means the Host never reads through the archive, at the cost of slower NSIS installation (about 15,000 files, 500 MB before pruning). Plan 07 does this and keeps a defensive `asarUnpack` list for the small application archive.
- **Rebuilding natives.** Open WebUI sets `npmRebuild: true` because it compiles `node-pty` for Electron's ABI [V]. AIR's tree uses N-API prebuilt binaries only (`node-pty` prebuilds, `koffi`, `sharp`, `node-addon-system`), which load in any Node 22+ or Electron 44 process, so `npmRebuild: false` is correct and avoids a compiler toolchain on Windows runners. The spike confirms the prebuilt files load under Electron 44.
- **rpm build identifiers.** Cherry Studio carries `rpm: { fpm: ["--rpm-rpmbuild-define=_build_id_links none"] }` with a comment pointing at an Electron Forge issue about build-id link conflicts between Electron applications [V]. AIR copies the line.
- **File filters.** Cherry Studio's `files` list excludes build leftovers (`!**/*.{h,iobj,ipdb,tlog,recipe,vcxproj,…}`) and unused optional backends [V]; upstream filters by a runtime file policy. AIR's staging script prunes other-platform native packages, `.bin` links, declaration files, and source maps.

### 1.3 Authentication between the window and the local server

- Goose generates `crypto.randomBytes(32).toString('hex')` per launch, passes it to the backend in an environment variable, binds `http://127.0.0.1:<port>`, and gives the page the secret through an IPC handler (`ipcMain.handle('get-secret-key', …)`), never through a URL [V].
- Upstream's Host returns `ctx.connection.authenticatedUrl(...)`. The spike observed the exchange [V]: `GET /?token=<t>` answers `303 See Other`, `location: ./`, with a cookie `dsh-auth-<id>=…; HttpOnly; SameSite=Strict; Max-Age=2592000`, and `GET /api/` without the cookie answers `401`. After the first navigation the address in the window carries no token.
- The Host prints `dsh web: http://127.0.0.1:<port>/?token=…` on standard output [V]. A shell that copies child output into a log file would write the token to disk. Plan 07 redacts `token=` values before any write and never logs the ready URL.

Practice to adopt: loopback bind, per-launch secret, navigation restricted to the Host origin, `setWindowOpenHandler` denying new windows and sending `http`/`https` links to the default browser (Goose does the same at `main.ts` `setWindowOpenHandler`) [V], `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` (Goose's three window definitions all set these) [V], plus `sandbox: true`, which upstream and Electron's defaults since version 20 use [R].

### 1.4 Single instance, deep links

Goose takes `app.requestSingleInstanceLock()`, handles `second-instance` by focusing the existing window and parsing the forwarded command line, and registers its scheme with `app.setAsDefaultProtocolClient('goose')`; its Flatpak maker declares `mimeType: ['x-scheme-handler/goose']` [V]. Cherry Studio declares `mimeTypes: [x-scheme-handler/cherrystudio]` under `linux` in electron-builder [V]; rpm and deb then install a `.desktop` file with that handler. AIR registers the `air` scheme the same way and treats deep links as "focus the window" in phase 1.

### 1.5 Tray, close, background

- Goose creates a `Tray` and quits on `window-all-closed` except on macOS with a tray [V]. It does not hide to tray on Linux.
- Upstream hides on close on every platform and has a tray only on Windows, which strands the window on GNOME [N09].
- Electron's Linux tray needs a StatusNotifierItem host; GNOME has none without the AppIndicator extension [N09]. A shell can test for one before creating a tray by asking the session bus whether `org.kde.StatusNotifierWatcher` has an owner [R]; plan 07 does this with `gdbus call … org.freedesktop.DBus.NameHasOwner`.
- **Background portal.** `org.freedesktop.portal.Background.RequestBackground` takes `reason`, `autostart`, `commandline`, and `dbus-activatable`, and answers `background` and `autostart` booleans; `SetStatus` sets a one-line status message. The documentation introduces it as an interface for sandboxed applications ([portal documentation](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Background.html)) [V]. A host application is identified by its systemd unit name (`app-<id>-….scope`) or by registering through `org.freedesktop.host.portal.Registry`; GTK does this at `GtkApplication` startup, Electron does not ([GNOME blog, 2025-06-04](https://blogs.gnome.org/ignapk/2025/06/04/using-portals-with-unsandboxed-apps/)) [V]. A search result dated 2025 reports that GNOME's Background Apps menu lists only Flatpak applications (thread title "Background Apps only shows Flatpak apps?", not opened because the site blocks fetching) [search snippet only]; this matches the monitor's design, which enumerates Flatpak instances [R].

Consequence: the owner's rule "opt-in background mode uses the Background portal, so the app appears in Background Apps" holds for a future Flatpak build, not for the rpm. For the rpm, plan 07 still calls the portal (it is the documented request and records the autostart wish) and adds the things that work for a host application: a notification on first hide, relaunch from the application grid (the second instance shows the window), the global hotkey, and Quit in the application menu.

Behaviour conventions on other products [R]: Claude Desktop and the Codex app keep running in the tray or menu bar after the window closes on Windows and macOS, with a setting to disable it; LM Studio offers a "run on login" headless service; all show Quit in the tray menu.

### 1.6 Global hotkey and quick entry

Goose registers two configurable accelerators, `focusWindow` and `quickLauncher`, through `globalShortcut.register`, and unregisters all on quit [V]. Open WebUI Desktop advertises a floating "Spotlight" bar on `Shift+Ctrl+I` and a system-wide push-to-talk shortcut [V]. Both keep the shortcut in user settings and re-register on change. On GNOME Wayland the registration goes through the GlobalShortcuts portal and needs `desktopName` to match an installed `.desktop` file [N09]; none of the surveyed projects documents a fallback. AIR's fallback is the second-instance flag `--quick-entry`, which a GNOME custom shortcut can run.

### 1.7 Start at login

`app.setLoginItemSettings({ openAtLogin })` covers Windows and macOS; Linux is not supported by that API [N09]. The portable Linux method is a file `~/.config/autostart/<desktop-id>.desktop` with `Exec`, `X-GNOME-Autostart-enabled=true`, and optionally an argument that starts hidden [R]. The Background portal writes the same file when `autostart` is true [V, portal documentation]. Plan 07 writes the file directly so the result does not depend on portal app-id detection.

### 1.8 Updates

- electron-updater supports NSIS on Windows and AppImage, deb, rpm, and pacman on Linux; deb and rpm updates run the system package manager, which elevates through `pkexec` or `sudo` ([electron-builder auto-update](https://www.electron.build/docs/features/auto-update/)) [V]. Testing without packaging needs `dev-app-update.yml` and `autoUpdater.forceDevUpdateConfig = true` [V]. Staged rollouts are a `stagingPercentage` line in the channel file [V].
- Goose sets the feed in code (`autoUpdater.setFeedURL({ provider: 'github', … })`) and falls back to its own GitHub download when electron-updater fails [V]. Open WebUI uses `publish: { provider: github }` and uploads `latest.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`, and `latest-mac.yml` beside the installers (release `v0.0.20` asset list) [V].
- Cherry Studio sets `verifyUpdateCodeSignature: false` for Windows [V]; without a publisher name the updater relies on HTTPS and the SHA-512 in `latest.yml` [N09].

AIR policy: AppImage and NSIS update in place; rpm shows "update available" with a link in phase 1 because a password prompt from a background process is a poor first experience (the rpm path can be enabled later); development builds and builds without an embedded `app-update.yml` do not check.

### 1.9 Code signing for open-source Windows builds

**SignPath Foundation** ([conditions](https://signpath.org/terms.html), page marked "Draft") [V]. Requirements that matter for AIR:

- OSI-approved license with no commercial dual licensing, no proprietary components, actively maintained, **already released** in the form to be signed, and documented on a download page.
- The certificate is issued to SignPath Foundation, which becomes the named publisher. Every release needs a manual approval by a project Approver; binaries must be built from the repository in a verifiable way.
- "Sign your own binaries only": a modified upstream may be signed if the upstream publishes signed builds, the project is a visible fork, and the release branches follow upstream's. Unsigned upstream binaries may be included inside a signed installer.
- All team members use multi-factor authentication; roles (Authors, Reviewers, Approvers) and a "Code signing policy" section with a privacy statement must appear on the project page.
- Installers must provide uninstallation; software must not transfer user data without a displayed policy.

Assessment: AIR can qualify after its first public unsigned release. The fork relationship is the point to raise in the application, since most of the signed code is upstream's; the upstream vendor signs its own Windows builds, which is the condition the policy names. Plan 07 leaves a signing hook and lists the application under follow-up work.

**Other routes, prices on 2026-10-03.** Azure Artifact Signing (renamed from Trusted Signing): 9.99 USD per month Basic, 99.99 USD Premium ([Azure pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)) [V]; Microsoft's comparison lists availability as organizations in the USA, Canada, EU, and UK and individuals in the USA and Canada only, and OV certificates from a certificate authority at 150–300 USD per year ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)) [V]. A reseller page quotes Certum-issued standard certificates at 99 USD per year and EV at 299 USD ([my-ssl.com](https://my-ssl.com/learn/azure-trusted-signing-vs-code-signing-certificate)) [V, vendor's own claim]. Both Azure and OV signatures start with no SmartScreen reputation; warnings fade as downloads accumulate [V, Microsoft Learn]. For a student team in India the realistic choices are SignPath Foundation or unsigned.

### 1.10 CI

- Goose and Cherry Studio build each OS on its own runner; cross-building Electron installers with native modules is not attempted [V for the per-OS scripts in both `package.json` files].
- rpm on Ubuntu runners: electron-builder drives `fpm`, which calls `rpmbuild`; the runner needs the `rpm` package (`sudo apt-get install -y rpm`) [R]. rpm cannot be built on Windows runners [R]. The electron-builder Linux page documents the `rpm` options (`depends`, `compression`, `afterInstall`) ([electron-builder Linux](https://www.electron.build/docs/linux)) [V].
- Runner labels and the free public-repository allowance are in note 09 [N09]. Build Linux artifacts on the oldest supported Ubuntu image for glibc compatibility [N09].

### 1.11 Crash handling and logs

Goose uses `electron-log` 5 and writes updater and backend messages to it [V]. Upstream keeps a bounded tail of Host stderr for the failure dialog [V]. Electron's `crashReporter` uploads minidumps to a server; with `uploadToServer: false` it only stores them locally [R]. AIR writes plain log files under `userData/logs` (shell log and Host output with tokens redacted), starts `crashReporter` in local-only mode, and offers "Open logs folder" in the menu. No session events are written by the shell.

### 1.12 Testing

Goose and Cherry Studio both depend on `@playwright/test` 1.62.1 and run Electron end-to-end tests with it; Goose has `test-e2e` scripts and a separate Vitest unit lane [V]. Playwright's `_electron.launch` accepts `executablePath` for a packaged build and needs the `nodeCliInspect` fuse left enabled [N09]. Upstream tests its shell logic as pure modules with Electron fakes [N09]. AIR copies that split: pure modules under Vitest, one Playwright smoke against the `--dir` build.

### 1.13 electron-builder or Electron Forge

Both are maintained in 2026: Goose is on Forge 7.11, Cherry Studio and Open WebUI on electron-builder 26 [V]. Reasons to use electron-builder here: upstream already pins `electron-builder ^26.15.3` and `electron-updater ^6.8.9`, so versions and caches are shared; NSIS, rpm, and AppImage come from one configuration; electron-updater's channel files are written by the same tool; and Cherry Studio shows the combination working with pnpm and these harness packages. Forge would need the Squirrel or WiX maker on Windows and a separate update story (Goose mixes Forge packaging with electron-updater and a hand-written fallback) [V].

### 1.14 pnpm workspaces and electron-builder

Known problems [R, long-standing reports such as [pnpm issue 3415](https://github.com/pnpm/pnpm/issues/3415)]: electron-builder's dependency collection follows `node_modules` symlinks poorly; `link:` dependencies point outside the application directory and are not copied; hoisting differs between `isolated` and `hoisted` linkers. pnpm's own documentation recommends `nodeLinker: hoisted` when tooling does not work with symlinks ([pnpm settings](https://pnpm.io/settings/node-modules)) [V, search excerpt]. Upstream avoids the collector entirely: `beforeBuild` returns a value that makes electron-builder skip its own `node_modules` collection, and the tree is prepared by scripts [V]. AIR does the same in a simpler way: the application archive contains one bundled `main.js` with no runtime dependencies, and the Host tree is a prepared directory.

## 2. Staging spike (run 2026-10-03)

Scratch directory: a session scratch directory outside the repository (abbreviated `$S`). The repository was not modified; `git status` showed only the roadmap edit that was already present. Precondition: the root build exists (`apps/cli/lib/profile-boot.js` present).

| # | Command (cwd = repository root unless stated) | Result |
|---|---|---|
| 1 | `pnpm --filter @deepseek-ai/dsh deploy --prod --legacy --offline --config.node-linker=hoisted $S/stage` | Fails: legacy deploy ignores the lockfile and cannot resolve offline (`ERR_PNPM_NO_OFFLINE_META`). |
| 2 | `pnpm --filter @deepseek-ai/dsh deploy --prod --offline --config.inject-workspace-packages=true --config.node-linker=hoisted $S/stage` | Fails: the target is on another filesystem, so pnpm picked a second, empty store (`/tmp/.pnpm-store`) and could not download offline. |
| 3 | Command 2 plus `--config.store-dir=$HOME/.local/share/pnpm/store` | 579 packages copied in 5 s, then exit 1: `ERR_PNPM_IGNORED_BUILDS` for `@deepseek-ai/dsh-subprocess-local` (the workspace `allowBuilds` key uses a relative `file:` path that the deploy copy does not match; its script only restores an executable bit on macOS). |
| 4 | Command 3 plus `--config.strict-dep-builds=false` | Exit 0 in 4 s. 500 MB; hoisted `node_modules` with 264 `@deepseek-ai` packages; 15 symlinks, all under `node_modules/.bin`; the deploy root is the `@deepseek-ai/dsh` package itself (`package.json`, `lib/`). |
| 5 | Copy `air/bundles/air/{package.json,cordis.patch.yml}` to `$S/stage/node_modules/@air/dsh-air-bundle/`; write a 30-line Host at `$S/stage/air-host/index.mjs`; `node parent.mjs` (forks the Host with `DSH_HOME=$S/home`) | Fails: `Cannot find package '@deepseek-ai/cordis-plugin-group' imported from …/dsh-app-boot/lib/index.js`. |
| 6 | Script listing required (non-optional) peers that are absent from the tree | 27 packages, all workspace packages (for example `dsh-fs`, `dsh-sandbox`, `dsh-shell`, `dsh-jobs`, `dsh-session-persistence`, `cordis-plugin-group`). `--config.auto-install-peers=true` does not change the result. |
| 7 | Script copying each missing package's `package.json` and `files` entries from the workspace (package paths from `pnpm ls -r --depth -1 --json`, 1.5 s), repeated until no required dependency or peer is missing | 27 packages copied in one pass; no external (registry) package missing. |
| 8 | `node parent.mjs $S/stage $S/home` again | `ready` after 2,541 ms; `shutdown-complete` 355 ms after the `shutdown` message; exit code 0; stderr empty. The profile created under `$S/home/profiles/air` lists `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@air/dsh-air-bundle`. |
| 9 | Same with `execPath` = the repository's Electron 44.0.0 binary and `ELECTRON_RUN_AS_NODE=1` | `ready` after 1,777 ms; clean shutdown; exit 0. No `--expose-internals` flag was needed. |
| 10 | `curl -i <ready url>` | `303`, `location: ./`, `set-cookie: dsh-auth-…; HttpOnly; SameSite=Strict`. |

How the Host in step 5 resolves its imports: it sits inside the deployed package directory, so `@deepseek-ai/dsh/profile-boot` resolves by package self-reference and every other `@deepseek-ai/*` import resolves from `stage/node_modules`. Bundle resolution checks the installation anchor first (`resolveBundleDir` in `packages/boot/app-boot/src/profile.ts`), so placing `@air/dsh-air-bundle` in the staged `node_modules` is enough; the profile directory needs no install step.

Not covered by the spike: Windows (junction and path-length behaviour, `conpty` prebuilds); the page rendering in a `BrowserWindow`; a model call; lazily imported packages that boot does not touch; the primary-runtime payload; AIR plugin packages with their own registry dependencies (none exist yet; when they do, their dependencies must already be in the tree or the staging script must fail, which the peer-fill step reports as "external missing"). Foreign-platform native files are in the tree (`node-pty` prebuilds for macOS and Windows, both macOS `node-addon-system` packages) and should be pruned.

Verdict: the staging approach is feasible with pnpm 11 alone; no pack-and-install pipeline is needed. Plan 07 Task 1 turns steps 4, 5, 7, and 8 into `air/apps/desktop/scripts/stage-runtime.ts` and repeats the boot check on Windows as its exit criterion.

## 3. Practices to adopt

Plan 07 cites these by number.

1. **P1 Staged tree, not collector.** Prepare the Host's production tree with `pnpm deploy` (lockfile mode, hoisted linker, explicit store directory, `strict-dep-builds=false`), then fill missing workspace peers; ship it as `extraResources`. Never let electron-builder collect `node_modules` (section 1.14, spike).
2. **P2 Boot check after staging.** Boot the Host from the staged tree with plain Node before packaging, and again from the `--dir` build in CI (spike step 8; note 09 section 7).
3. **P3 Node-mode child with IPC.** Spawn `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and an IPC channel; keep the `runAsNode` fuse enabled; `utilityProcess` is a later hardening step (section 1.1).
4. **P4 Bounded supervision.** Ready timeout, at most three restarts per minute, stderr tail in the failure dialog, `shutdown` message before termination (section 1.1).
5. **P5 Loopback, per-launch secret, origin lock.** Load only the authenticated loopback URL; deny other navigation; open `http`/`https` links externally; deny new windows; `contextIsolation`, `sandbox`, `webSecurity` on; `nodeIntegration` off (section 1.3).
6. **P6 Never log the token.** Redact `token=` values in Host output before writing logs; do not log the ready URL (section 1.3).
7. **P7 Single instance with argument forwarding.** `requestSingleInstanceLock`; `second-instance` shows the window or the quick-entry window (`--quick-entry`); register the scheme and the `x-scheme-handler` MIME type (section 1.4).
8. **P8 Close policy by platform capability.** Windows hides to tray; Linux quits unless the user opted into background mode; a tray is created on Linux only when a StatusNotifier host answers; background mode always leaves a visible way back (section 1.5).
9. **P9 Shortcuts are settings with reported failure.** Store the accelerator in settings, re-register on change, surface failure, and document the installed `.desktop` requirement and the `--quick-entry` fallback (section 1.6).
10. **P10 Autostart by platform.** `setLoginItemSettings` on Windows; an XDG autostart file on Linux (section 1.7).
11. **P11 Updates from GitHub Releases, by package type.** NSIS and AppImage update in place; rpm notifies; development and unconfigured builds do not check; channel is a setting (section 1.8).
12. **P12 Unsigned by default, signing as a hook.** Unsigned artifacts carry an `-unsigned` suffix; a documented hook accepts SignPath later; `verifyUpdateCodeSignature: false` while unsigned (sections 1.8, 1.9).
13. **P13 Native runners per OS.** `windows-2025` for NSIS, `ubuntu-24.04` with the `rpm` package for rpm and AppImage; `--rpm-rpmbuild-define=_build_id_links none` (sections 1.2, 1.10).
14. **P14 Local logs only.** Shell and Host logs under `userData/logs`, local-only crash dumps, an "Open logs folder" menu item; no session events from the shell (section 1.11).
15. **P15 Pure modules plus one packaged smoke.** Logic in Electron-free modules tested with fakes; one Playwright `_electron` smoke against the unpacked build (section 1.12).
16. **P16 One brand file.** Product name, application id, `desktopName`, scheme, and publish target come from `brand.json`; changing the application id later resets portal consent, the userData directory, and the Windows notification identity (note 09 section 4).

## 4. Open points for the owner

- GNOME Background Apps will not list the rpm build (section 1.5). Accept the notification-and-launcher design, or plan a Flatpak build later for the listed behaviour.
- rpm auto-update is technically available but prompts for a password; plan 07 ships "notify with link" for rpm.
- SignPath requires a first public release before applying, and its certificate names SignPath Foundation as publisher.
