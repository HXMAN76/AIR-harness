# Note 09: a desktop app on Linux, macOS, and Windows

Status: research note, 2026-10-02. Base: `air/main` on upstream release tag `dsh-v0.2.0-rc.2`. Machine: Fedora 44, GNOME Shell 50.5 on Wayland, x86_64, Electron 44.0.0 (`apps/desktop/package.json:63`). Nothing was built, installed, or launched for this note; every code statement cites a file read on this date, and every external statement cites a page fetched on this date unless marked "not re-checked".

Owner decision this note serves: the product ships as a desktop app on Linux, macOS, and Windows, and the phase-1 review demo runs in the desktop app on Linux (`air/plans/README.md:77`). This supersedes the "Web UI plus GNOME shortcut" phase-1 shell in spike 05 section 7.

## Summary

- Upstream's desktop app is an Electron shell around the Web application, with a release pipeline (about 8,900 lines under `apps/desktop/scripts/`) built for exactly three targets: `mac-arm64`, `mac-x64`, `win-x64`. Linux is rejected by the target resolver before any build step, including the development launcher. Spike 05's statement that "the Linux dev path exists in code" is wrong: `pnpm run dev:desktop` fails on Linux today (evidence in section 2).
- The pieces underneath are Linux-ready: the bundled-runtime lock has `linux-x64` and `linux-arm64`, the native addon ships Linux packages with a static Landlock executable, the sandbox chain is `bwrap` then Landlock, and Electron 44 is Wayland-native with the global-shortcut portal on by default.
- Recommendation: **option (b), an AIR-owned Electron shell in `air/apps/desktop` plus a small AIR Host entry in `air/apps/desktop-host`**, reusing upstream's public `@deepseek-ai/dsh/profile-boot` export and the `air` profile. `apps/desktop` stays untouched. Unavoidable in-tree edits for phase 1: none.
- Distribution without paid infrastructure: GitHub Releases as the update feed; AppImage (plus an rpm for Fedora) on Linux with working auto-update; unsigned NSIS on Windows with auto-update but a SmartScreen warning; ad-hoc-signed macOS build with no auto-update (electron-updater requires a signed macOS app) and a Gatekeeper "Open Anyway" step. Apple Developer ID (99 USD per year) is the only purchase that removes a hard limitation.

## 1. How upstream builds and packages the desktop app

**Architecture.** The shell loads the packaged Web entry at `dsh-app://app/` and forwards HTTP to an authenticated Web Host that runs as an Electron RunAsNode child (`apps/desktop/README.md:7`). The child entry is the private package `@deepseek-ai/dsh-desktop-host`: `apps/desktop/src/host-process.ts:188-199` spawns `lib/index.js` with `--expose-internals` and a Node IPC channel, and `apps/desktop-host/src/index.ts:25-30` calls `runProfile({ profile: 'desktop', args: ['--no-open', '--port', '19387'] })` from `@deepseek-ai/dsh/profile-boot`. When the tree is up it sends `{ type: 'ready', url, injections }`, where `url` comes from `ctx.connection.authenticatedUrl(...)` (`apps/desktop-host/src/index.ts:104-105`). The Host also answers `quit-inspection` and `update-tasks` requests over the same channel (`index.ts:59-90`).

**electron-builder configuration.** `apps/desktop/electron-builder.config.mjs` re-exports the factory in `apps/desktop/scripts/electron-builder-config.mjs`:

| Field | Value | Line |
|---|---|---|
| `appId` | from `DSH_DESKTOP_APP_ID` in `.env.macos` / `.env.windows` (template value `com.deepseek.harness`); no fallback | `:53`, `desktop-release-environment.mjs:64` |
| `productName` | `'DeepSeek Harness'` (literal) | `:109` |
| `protocols` | `[{ name: 'DeepSeek Harness', schemes: ['dsh'] }]` | `:102` |
| `artifactName` | `deepseek-harness-${version}-${os}-${arch}[-unsigned].${ext}` | `:111` |
| `electronFuses` | `{ runAsNode: true }` | `:115` |
| macOS | `dmg` + `zip`, `forceCodeSigning: true`, hardened runtime, `notarize: true`, microphone usage string | `:150-165` |
| Windows | `nsis`, `forceCodeSigning: !unsigned`, custom hardware-token signer, per-user install, `differentialPackage: true` | `:223-247` |
| Linux | `{ category: 'Development', target: ['AppImage'] }`, present but unreachable | `:233-236` |
| `publish` | `[{ provider: 'generic', url: <origin>, channel: 'nightly' }]`, or `null` for unsigned | `:249` |

**Signing and notarization.** macOS packaging refuses to run without a Developer ID identity, Team ID, a local p12, and one complete notarization credential set (`apps/desktop/README.md:292`). Windows release packaging requires an EV certificate on a SafeNet USB token and fails instead of emitting unsigned artifacts (`README.md:366-372`); only `package:win:x64:unsigned` skips it, and that mode omits the update configuration (`README.md:322`). `electron-builder-config.mjs:62` throws `unsigned builds require Windows` for any other platform.

**Update feed and hosting.** The feed is a generic HTTPS provider at `https://download.deepseek.com` (production) or `DOWNLOAD_TEST_ORIGIN` (test), uploaded to Tencent COS buckets by `scripts/upload-target.ts`; feeds live under `dsh-desk/feeds/<target>/` with `nightly.yml` / `nightly-mac.yml` (`README.md:264-290`, `desktop-auto-update-environment.mjs:18`). A second, separate service supplies a mandatory-update policy (`README.md:417`). Neither is usable by a fork.

**Root scripts.** `package.json:28-46` forwards `build:desktop`, `dev:desktop`, `start:desktop`, `prepare:desktop`, `package:desktop[:dir]`, `package:desktop:mac:{arm64,x64}[:dir]`, `package:desktop:win:x64[:unsigned|:dir]`, and six `upload:*` scripts to `apps/desktop`. There is no Linux script.

**`desktop` profile versus `web`.** The desktop profile is the Web template: `apps/desktop/src/project-manager.ts:32,142,167,175` initializes it with `PROFILE_TEMPLATES.web` bundles. Differences are (1) the name `desktop` is reserved for Electron (`apps/cli/src/args.ts:84-85` rejects it; `apps/cli/src/plugin.ts:12` only manages its plugins), (2) port `19387` instead of `3080`, (3) rows in `packages/bundle/web-app/cordis.patch.yml:45-59,280` that are disabled unless `profileContext.name === 'desktop'` (product telemetry with `serviceName: deepseek-harness-desktop`, product analytics), and (4) plugins the Host installs in code after boot: Office engine resolution, update-task control, quit inspection, and the account session publisher (`apps/desktop-host/src/index.ts:93-103`).

**Bundled runtimes.** `app.asar/dsh` carries the complete production dependency tree, so no core package is installed on the user's machine (`README.md:77`, `:119`). `resources/runtime/primary-runtime` carries standalone Node, pnpm, and Python with Office libraries; the `load_workspace_dependencies` tool from `@deepseek-ai/dsh-tool-workspace-dependencies` installs that payload offline under `$DSH_HOME/dsh-runtimes/dsh-primary-runtime` on first use (`README.md:63`). The payload is pinned by `scripts/primary-runtime/lock.json`, whose `targets` are `win-x64`, `mac-arm64`, `mac-x64`, `linux-x64`, `linux-arm64`.

**Installed `dsh` command.** The menu entry "Manage dsh Command…" installs, repairs, or removes a terminal command that runs the ordinary CLI on Desktop's bundled Electron and pnpm: `/usr/local/bin/dsh` on macOS, a per-user PATH entry on Windows (`README.md:27-31`, `:89`; `apps/desktop/src/command-manager-entry.ts:17-23`). The menu item exists only on macOS and Windows (`main.ts:956`).

## 2. Linux gap analysis

### 2.1 What blocks a Linux build today

1. **Target resolver.** `apps/desktop/scripts/desktop-build-paths.mjs:7` defines `SUPPORTED_TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])`. Running `resolveDesktopBuildTarget()` on this machine throws `desktop build paths: unsupported target linux-x64` (executed 2026-10-02, read-only). `scripts/dev.ts:124` and `prepare-primary-runtime.ts:17-18` call it, so `dev:desktop`, `start:desktop`, and every `package:*` script stop on Linux before Electron starts.
2. **Platform mapping assumes two platforms.** `desktop-build-paths.mjs:69-74` maps any non-Windows target to `darwin`; `prepare-runtime.ts:34,42` and `prepare-dsh.ts:44` choose `Electron.app/Contents/MacOS/Electron` for anything that is not `win32`.
3. **Packaging entry.** `scripts/package-target.ts:50-78` types and tabulates only the three targets; `:179-186` enforces host rules for them.
4. **Update environment.** `desktop-auto-update-environment.mjs:25,77-80` accepts only the three targets and throws for other platforms.
5. **Toolchain preflight.** `desktop-toolchain-preflight.ts:78,95` is typed `'darwin' | 'win32'`.
6. **Unsigned mode.** `electron-builder-config.mjs:62` rejects unsigned builds off Windows, and the config resolves an app id, a policy origin, and an update origin from dotenv files that have no Linux variant (`README.md:210`).

The `linux: { target: ['AppImage'] }` block is therefore dead configuration. Patching in place means editing at least six script files plus tests that pin the three-target set.

### 2.2 What is already Linux-ready

- **Primary runtime:** `linux-x64` and `linux-arm64` are locked (section 1).
- **Native addon:** `native/system/packages/` has `linux-x64` and `linux-arm64` beside the two macOS packages; the Linux packages contain glibc and musl `system.node` files and a static Landlock executable (`native/system/README.md:31`).
- **Sandbox backends:** `packages/sandbox/sandbox-local/README.md:71` selects `bwrap` then Landlock on Linux and fails closed when neither works (`:57`).
- **Office conversion:** the provider falls back to WASM when no native engine package matches (`README.md:240`); only `libreoffice-kit` and `libreoffice-kit-wasm` are installed in this checkout.
- **Login-shell environment:** the GUI-launch environment probe already runs on Linux (`login-shell-environment.ts:176`, `README.md:139`).

### 2.3 Every `process.platform` branch in `apps/desktop` and what Linux gets

| Location | Branch | Linux result |
|---|---|---|
| `main.ts:213-224` | Windows hidden title bar; macOS `hiddenInset` + vibrancy | Default native frame, opaque background |
| `main.ts:243` | Fullscreen state relay | Not relayed |
| `main.ts:938-970` | Menus | Application + Edit menus only; About uses Electron's `role: 'about'` |
| `main.ts:956` | "Manage dsh Command…" | Absent |
| `main.ts:985-991`, `tray.ts` | Tray | None; icon is a Windows ICO |
| `main.ts:992` | First-close background notice | None |
| `main.ts:1076-1090` | Close hides the window | Window hides with no tray and no Dock; only a second launch or `dsh://open` brings it back |
| `main.ts:1238` | `window-all-closed` | Quits (but the window is hidden, not closed, so this rarely fires) |
| `main.ts:1240` | `powerMonitor` shutdown | Handled as on macOS |
| `main.ts:1228` | `setAsDefaultProtocolClient('dsh')` | Called; on Linux it needs an installed `.desktop` file with the scheme handler, which AppImage does not install by itself |
| `main.ts:1297` | Mandatory-update policy | Throws `unsupported platform` if a policy is embedded |
| `main.ts:346` | Raise after update | Windows only |
| `microphone-permissions.ts:21,28` | System microphone authorization | Granted to the owned main frame with no OS prompt; capture goes through PipeWire/PulseAudio |
| `keyboard.ts:45`, `main.ts:682` | Native shortcut interception | Not scoped; shortcuts dispatch through the DOM (`README.md:53`) |
| `update-attention.ts:34-39` | Taskbar flash / Dock bounce | Neither; the silent `Notification` still fires |
| `update-overlay.ts:27,39` | Overlay modality | Native modal child window |
| `mandatory-update-window.ts:52,246`, `preload-app.ts:75`, `preload-windows.ts:9` | Embedded Windows overlay | Separate-window path |
| `preload-platform.ts:26` | Platform chrome marks | None |
| `welcome-window.ts:27-34` | Acrylic / vibrancy | Opaque white background, also in dark mode |
| `quit-confirmation.ts:78` | Button order | macOS order |
| `command-management.ts`, `command-installation.ts:161`, `command-manager-entry.ts:12-23` | CLI install | No Linux path |
| `login-shell-environment.ts:176` | Login-shell probe | Runs |
| `runtime-tree.ts:79,208` | Executable-bit inventory | POSIX path |
| `device-info.ts:11` | `platform=` field | `linux` |
| `apps/desktop-host/src/office.ts:35`, `cli.ts:30` | `node` versus `node.exe` | POSIX path |

The directory picker has no platform branch: `directory-picker.ts:23` calls `dialog.showOpenDialog`, which on Linux goes through the XDG file-chooser portal or GTK. The README adds that automatic selection uses the Host's browse mode on Linux when neither zenity nor kdialog exists (`README.md:11`).

### 2.4 Linux platform facts that shape the design (2026-10-02)

- **Wayland.** Electron runs Wayland-native by default from 38.2; no `--ozone-platform` flag is needed on Electron 44 ([Electron Wayland tech talk](https://electronjs.org/blog/tech-talk-wayland)). Spike 05's flag recipe is obsolete.
- **Global shortcuts.** On Wayland `globalShortcut` uses `org.freedesktop.portal.GlobalShortcuts`; the `GlobalShortcutsPortal` feature is on by default. The app must have a valid portal identity: `desktopName` in `package.json` or `app.setDesktopName()` matching an installed `.desktop` file. With an unresolvable id GNOME 50.0/50.1 denies every bind without an error. GNOME shows a consent dialog on first bind; bindings persist per app id ([globalShortcut docs](https://www.electronjs.org/docs/latest/api/global-shortcut)). `apps/desktop/package.json` sets no `desktopName`. Consequence: the hotkey works only from an installed package (rpm, deb, Flatpak, or an AppImage whose `.desktop` file was integrated), not from a bare AppImage or `electron .`.
- **Tray.** Electron's Linux tray uses StatusNotifierItem and falls back to `GtkStatusIcon`; which mouse action emits `click` is environment-defined ([Tray docs](https://www.electronjs.org/docs/latest/api/tray)). GNOME Shell shows StatusNotifierItem icons only with the AppIndicator extension, which is not installed on the dev machine (spike 05 section 7.1). KDE Plasma shows them natively. A GNOME design cannot depend on the tray.
- **Chromium sandbox.** Fedora permits unprivileged user namespaces, so the namespace sandbox works without the SUID helper. Ubuntu 24.04 restricts them through AppArmor; Electron AppImages there abort with "The SUID sandbox helper binary was found, but is not configured correctly" because a FUSE-mounted `chrome-sandbox` cannot be root-owned mode 4755 ([Ask Ubuntu](https://askubuntu.com/questions/1512287/obsidian-appimage-the-suid-sandbox-helper-binary-was-found-but-is-not-configu), [Launchpad bug 2046844](https://bugs.launchpad.net/bugs/2046844), [electron-builder issue 8440](https://github.com/electron-userland/electron-builder/issues/8440)). A deb avoids this because its post-install script can set the helper's mode and install an AppArmor profile. Do not ship `--no-sandbox`.
- **Agent-command sandbox inside packages.** An AppImage is not confined, so `bwrap` on the host works as in the Web profile. The same Ubuntu restriction can stop unprivileged `bwrap`; upstream's chain then probes Landlock, which needs no user namespace. Flatpak is different: the app already runs inside Flatpak's own bubblewrap sandbox, Electron needs the zypak wrapper and `org.electronjs.Electron2.BaseApp` ([Flatpak Electron docs](https://docs.flatpak.org/en/latest/electron.html)), and a personal agent that executes host commands would need `flatpak-spawn --host` with broad permissions (general Flatpak behaviour, not re-checked today). Flatpak is a poor fit for this product in phase 1.
- **Auto-update.** electron-updater supports AppImage, deb, rpm, and pacman on Linux; deb/rpm installs elevate through `pkexec`/`sudo`, and Linux packages are unsigned by electron-builder (`allowUnverifiedLinuxPackages` defaults to `true`) ([electron-builder auto-update](https://www.electron.build/docs/features/auto-update/)). AppImage self-replacement needs no privileges and is the cheapest path.
- **Microphone.** No OS permission gate outside Flatpak; the upstream handler already grants the owned frame.

## 3. Patch in place, AIR-owned shell, or another shell

### (a) Patch `apps/desktop` in place

Edits needed: the six script files in 2.1, a Linux tray and hide policy in `main.ts` and `tray.ts`, `desktopName`, brand literals in `electron-builder-config.mjs`, `main.ts:928`, 22 lines of `src/locale.ts`, 6 of `installer/strings.nsh`, the hard-coded `profile: 'desktop'` in `apps/desktop-host/src/index.ts:27`, replacement of the COS feed, removal of forced signing, and matching changes in tests under `apps/desktop/tests/` (123 spec files, several pinning the three-target set). Effort: 2 to 3 weeks to a first Linux AppImage. Merge cost: high and permanent. `main.ts` is 1,349 lines and changed heavily between the two release candidates (187 upstream commits, research.md section 2b); every carried line in it conflicts repeatedly, and `air/UPSTREAM-DELTA.md` would grow from 2 rows to dozens. Risk: upstream's account, mandatory-update, and analytics paths stay in the binary and must be disabled one by one.

### (b) AIR-owned shell reusing upstream packages (recommended)

New out-of-tree workspaces:

- `air/apps/desktop-host` (about 80 lines): imports `runProfile` from `@deepseek-ai/dsh/profile-boot` (a declared export of `apps/cli/package.json`), passes `profile: 'air'` and a fixed AIR port, and sends `{ type: 'ready', url }` using `ctx.connection.authenticatedUrl(...)`, the same public calls upstream's Host uses.
- `air/apps/desktop` (estimated 600 to 900 lines for phase 1): Electron main process that takes the single-instance lock, spawns the Host under `ELECTRON_RUN_AS_NODE`, loads the returned authenticated loopback URL in a sandboxed `BrowserWindow`, and owns tray, global hotkey, quick-entry window, start-at-login, close-to-background policy, notifications, and updates. Its own `electron-builder.yml` carries AIR's app id, name, icons, Linux/macOS/Windows targets, and a GitHub publish block.

What is reused unchanged: the Host, webserver, client bundles, the `air` profile and bundle, sandbox, native addon, and the primary-runtime builder (`scripts/primary-runtime/prepare.ts` accepts a target and output directory; `linux-x64` is locked). What is not reused: upstream's `dsh-app://` asset protocol, welcome window, account views, mandatory-update client, command manager, NSIS pages, COS uploader, and hardware-token signing. None of those serve AIR.

Trade-offs to accept: loading `http://127.0.0.1:<port>` instead of `dsh-app://app/` means the client runs as ordinary Web, without the Desktop preload marker. The directory picker is the Host chooser (zenity/kdialog or browse mode), in-app update status in the account row is absent, and product analytics stay off because the profile is not named `desktop`, which matches AIR's privacy position. AIR-specific native features reach the client through an AIR preload and AIR client plugins (spike 01 section 5).

The hard part is packaging the dependency tree. Upstream solves it with `prepare-package-set.ts` and `prepare-dsh.ts` (pack workspace packages, install a production graph with the bundled pnpm, filter files, inventory hashes). AIR needs a simpler version: `pnpm deploy --prod` (or pack-and-install) of `@deepseek-ai/dsh`, the AIR Host, and the AIR bundle into a staging directory that electron-builder copies as `extraResources`, with `asarUnpack` for `*.node`, `*.so`, ripgrep, `spawn-helper`, and the Landlock executable (the list at `electron-builder-config.mjs:72`). This is the main schedule risk and should be spiked first.

Effort: about 1 week for a Linux `--dir` build that boots the `air` profile, 1 more for tray, hotkey, quick entry, autostart, and AppImage + rpm, then 1 to 2 weeks for macOS and Windows artifacts and updater wiring. Merge cost: near zero; the coupling is `runProfile`'s options, `authenticatedUrl`, and the webserver port Config, all checked by booting once after each upstream merge. Risk: pre-stable upstream APIs can change those three calls; the fix is local to an 80-line file.

### (c) Tauri or another shell around the local Web UI

Tauri 2 would need the Node Host as a sidecar binary with its own bundled Node, uses WebKitGTK on Linux and WKWebView on macOS (the client is tested only on Chromium), adds a Rust toolchain, and cannot reuse Electron RunAsNode, node-pty prebuild selection, or electron-updater. Its global-shortcut and tray plugins face the same Wayland and GNOME limits. Smaller downloads do not offset a second rendering engine and a new language in a final-year schedule. A plain Chromium `--app` window (spike 05) is no longer acceptable because the owner requires an installable app. Not recommended (Tauri facts from general knowledge, not re-checked today).

| | (a) Patch in place | (b) AIR-owned Electron shell | (c) Tauri |
|---|---|---|---|
| Time to Linux demo | 2–3 weeks | 1–2 weeks | 3–4 weeks |
| Carried in-tree edits | Dozens of files | None in phase 1 | None |
| Cost per upstream merge | High, recurring | Boot check | Boot check |
| Rebranding | Edit many literals | Own config | Own config |
| Main risk | Merge conflicts in `main.ts` and scripts | Packaging the Host tree | WebKit rendering differences, sidecar packaging |

**Decision proposed: (b).**

## 4. Rebranding surfaces

In upstream's app the brand is literal in: `productName`, protocol display name, artifact name, and microphone usage string (`electron-builder-config.mjs:102,109,111,158`); `applicationName` (`main.ts:928`); the `dsh` scheme (`main.ts:1228-1231`); 22 strings in `src/locale.ts`; 6 in `installer/strings.nsh`; icons in `apps/desktop/resources/`; the update origin `https://download.deepseek.com` (`desktop-auto-update-environment.mjs:18`); the app id supplied by dotenv; the installed command name `dsh`; and the telemetry rows keyed to profile name `desktop` with `serviceName: deepseek-harness-desktop` (`packages/bundle/web-app/cordis.patch.yml:45-59`).

With option (b) none of these are edited. `air/apps/desktop` holds one `brand.json` (`productName`, `appId`, `desktopName`, `protocolScheme`, `tagline`, icon paths) with the placeholder values from `air/BRANDING.md`; `electron-builder.yml` is generated from it at package time, and the main process reads the same file for window titles, tray tooltip, About panel, and notification titles. That keeps the "one-file change" promise for `{{PRODUCT_NAME}}`. Suggested placeholders: app id `io.github.hxman76.air`, scheme `air`, Linux `desktopName` `io.github.hxman76.air.desktop`. Choose the app id once: it keys the Windows AppUserModelID, the macOS bundle id, the Wayland portal identity (persisted shortcut consent), and the userData directory. The in-page brand (sidebar, hero, page title, dictionary strings) stays with layers 1 and 2 of `air/BRANDING.md`; the Layer 3 desktop bullet there can be retired, and `apps/web/index.html` `<title>` matters less because the shell sets the window title. Telemetry rows remain disabled because the profile name is `air`.

## 5. Distribution without paid infrastructure

| OS | Free artifact | First-run experience | Auto-update |
|---|---|---|---|
| Linux | AppImage + rpm (Fedora); deb later | AppImage: `chmod +x` and run; fails on Ubuntu 24.04 until the sandbox issue is handled, so Ubuntu users get the deb | Works for AppImage via electron-updater; rpm/deb prompt for a password |
| Windows | Unsigned NSIS `.exe` | SmartScreen "Windows protected your PC"; user clicks More info, then Run anyway. Some corporate policies block unsigned code | Works; without `publisherName` electron-updater does not verify a signature, so integrity rests on HTTPS and the SHA-512 in `latest.yml` |
| macOS | Ad-hoc-signed `.dmg` (`identity: '-'`); Apple Silicon requires at least an ad-hoc signature to execute | Gatekeeper blocks the first open; since macOS 15 the Control-click bypass is gone and the user must use System Settings, Privacy & Security, Open Anyway ([iDownloadBlog on Sequoia](https://www.idownloadblog.com/2024/08/07/apple-macos-sequoia-gatekeeper-change-install-unsigned-apps-mac/)) | Not available: "macOS application must be signed in order for auto updating to work" ([electron-builder](https://www.electron.build/docs/features/auto-update/)). Show a "new version available" link instead |

**Update feed.** electron-updater's GitHub provider reads release assets from a public repository without a token: `latest.yml`, `latest-linux.yml`, `latest-mac.yml`, the installers, `.blockmap` files, and a macOS `.zip`. electron-builder writes these with `publish: { provider: github, owner, repo }`; a workflow using the built-in `GITHUB_TOKEN` with `contents: write` uploads them to a draft release. No bucket, CDN, or server is needed.

**Signing costs (2026-10-02).**

- Apple Developer Program: 99 USD per year; covers Developer ID signing and notarization, removes the Gatekeeper block, and enables macOS auto-update (standard published fee, not re-checked today).
- Azure Artifact Signing (renamed from Trusted Signing in 2026): 9.99 USD per month Basic. Public-trust identity validation for individuals is limited to the USA and Canada, a Microsoft Q&A answer dated 2026-03-06 says individual onboarding was paused, and organizations must be in the USA, Canada, EU, or UK ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [Q&A](https://learn.microsoft.com/en-us/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident)). A third-party comparison claims wider self-employed eligibility ([my-ssl.com](https://my-ssl.com/learn/azure-trusted-signing-vs-code-signing-certificate)); treat that as unconfirmed. For an individual student outside the USA and Canada, assume it is unavailable.
- SignPath Foundation: free Windows code signing for open-source projects that meet its conditions ([signpath.org](https://signpath.org/)); needs an application and a public build pipeline. This is the realistic free route for Windows.
- CA certificates for individuals: roughly 99 to 300 USD per year (same comparison page); private keys must live on hardware or a cloud HSM.

**CI runners.** Standard GitHub-hosted runners are free and unlimited for public repositories ([runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). A release matrix needs native hosts because of native modules and per-OS runtimes:

| Target | Runner label |
|---|---|
| linux-x64 | `ubuntu-24.04` |
| linux-arm64 (optional) | `ubuntu-24.04-arm` |
| mac-arm64 | `macos-15` |
| mac-x64 (optional) | `macos-15-intel` |
| win-x64 | `windows-2025` |

Build Linux artifacts on the oldest supported Ubuntu image so the bundled native files link against an older glibc. If the repository is private, macOS minutes are billed at a multiple; keep it public.

## 6. Assistant-shell features across operating systems

All of these live in `air/apps/desktop/src/` (main process), with one AIR client plugin for the quick-entry page.

| Feature | Electron API | Linux (GNOME Wayland) | macOS | Windows |
|---|---|---|---|---|
| Tray | `Tray`, `Menu` | Visible only with the AppIndicator extension or on KDE; always set a context menu; do not rely on `click`. Without a tray, closing the window must keep a visible way back: minimize instead of hide, or quit the UI while the Host keeps running | Template image named `*Template.png`, 16 px and 32 px @2x | Multi-size ICO; left click opens |
| Global hotkey | `globalShortcut.register` | Portal; needs installed `.desktop` id; consent dialog on first bind; the user may rebind in Settings; registration can fail without an error on GNOME 50.0/50.1 | Works; avoid Spotlight and input-source combinations | Works; fails if another app holds the combination |
| Quick-entry overlay | Frameless `BrowserWindow`, `alwaysOnTop`, `skipTaskbar`, `show()`/`focus()` | Wayland forbids client-chosen position and focus stealing; the compositor centers the window, and activation is honoured when triggered from the portal shortcut. Global-screen coordinates are unavailable, so no "appear at cursor" | `type: 'panel'` gives a non-activating panel over fullscreen apps | Works; set `skipTaskbar` |
| Start at login | `app.setLoginItemSettings` (macOS, Windows) | Not supported by that API; write `~/.config/autostart/<desktopName>` with `X-GNOME-Autostart-enabled=true`, or request the Background portal. An AppImage path changes when the file moves, so prefer the rpm/deb for autostart | Works; unsigned apps appear as an unidentified developer item | Works per user |
| Notifications | `Notification` | libnotify; GNOME supports actions and body (spike 05 section 4); the app name comes from the `.desktop` file | Requires user permission; unsigned apps may not be listed in Notification settings until first use | Needs `app.setAppUserModelId(appId)` and a Start-menu shortcut, which NSIS creates |
| Deep link | `setAsDefaultProtocolClient('air')` | Needs `MimeType=x-scheme-handler/air` in the installed `.desktop` file (rpm/deb provide it) | `protocols` in builder config | Registry entry by NSIS |

The quick-entry page is the client plugin `@air/dsh-client-quick-entry` from roadmap item 8, loaded in the second window at a dedicated route; the shell only decides when to show it. Because the Host is a child of the shell, "keep running in the background" on GNOME without a tray means the process stays alive with no window; the shell should then post one notification saying so and offer Quit in the application menu. Spike 05's systemd user service remains a valid alternative for headless triggers, but the default desktop build should not need it.

## 7. Testing on a student budget

- **Existing upstream tests.** `apps/desktop/tests/*.spec.ts` run in the root unit lane with fakes for Electron APIs; `*.e2e.ts` run through `vitest.e2e.config.ts:45`. They cover upstream's shell, not AIR's. Upstream's real-window checks are manual fixtures run with a packaged Electron binary (`apps/desktop/tests/README.md:26`), and its browser scenarios use a Chromium headless shell under `.desktop-build/playwright` (`tests/README.md:62`). There is no Playwright-Electron suite to inherit.
- **AIR unit tests.** Keep `main.ts` thin and test pure modules (brand loading, autostart file content, hotkey registration state, Host supervision) with vitest and injected Electron fakes, the pattern upstream uses in `tray.ts`, `single-instance.ts`, and `update-attention.ts`.
- **Playwright Electron smoke.** `_electron.launch({ args: ['.'] })` is experimental but supports Electron 14 and later; it times out if the `nodeCliInspect` fuse is disabled and does not intercept native dialogs ([Playwright Electron](https://playwright.dev/docs/api/class-electron)). Leave that fuse at its default. One smoke test per OS: launch, wait for the Host `ready` event, assert the main window shows the conversation input, open the quick-entry window through an IPC test hook, quit cleanly. On Linux runners run under `xvfb-run` (X11 path); Wayland-only behaviour (portal shortcut, tray) cannot run on hosted runners and stays a manual checklist on the Fedora machine, plus an Ubuntu 24.04 virtual machine for the AppArmor case.
- **Packaged smoke.** After `electron-builder --dir`, run the unpacked binary with a `--smoke` flag that boots the Host, loads the page, and exits 0. This catches missing unpacked native files, the most likely packaging defect.
- **Model dependency.** CI has no Ollama; point the `air` profile at a stub OpenAI-compatible server for smoke tests, as the evaluation pilot plan already assumes.
- **Cost.** All of the above fits the free public-repository runners.

## Recommended architecture

```
air/apps/desktop-host/      AIR Host entry: runProfile({ profile: 'air' }), ready/shutdown IPC
air/apps/desktop/
  brand.json                placeholder brand; single source for names, ids, icons
  src/main.ts               lifecycle, single instance, window, close policy
  src/host.ts               spawn and supervise the Host (ELECTRON_RUN_AS_NODE)
  src/tray.ts               per-OS icon and menu; optional on GNOME
  src/hotkey.ts             globalShortcut with failure reporting
  src/quick-entry.ts        overlay window
  src/autostart.ts          login item (macOS/Windows) or XDG autostart file
  src/updates.ts            electron-updater, GitHub provider; link-only on unsigned macOS
  scripts/stage-runtime.ts  production tree + primary runtime for one target
  electron-builder.yml      generated from brand.json
air/packages/client-quick-entry/   client plugin for the overlay page
.github/workflows/air-desktop.yml  new file: matrix build, smoke, draft release
```

> Update 2026-10-03: the packaging approach was tested; `pnpm deploy` alone does not produce a bootable tree and needs a workspace peer-fill step. See [13-desktop-shell-practice.md](13-desktop-shell-practice.md) section 2 and the plan at `air/plans/2026-10-03-07-desktop-shell.md`.

## Phased plan

**Phase 1: review demo on Linux (about 2 weeks).**

1. Spike (2 days): stage a production tree for `@deepseek-ai/dsh` + AIR Host + AIR bundle with `pnpm deploy`, start it under `ELECTRON_RUN_AS_NODE=1` with the repository's Electron, confirm `ready` and a working page in a plain `BrowserWindow`. Exit criterion: the `air` profile answers from the local model inside an Electron window on Fedora.
2. Shell: single instance, Host supervision with a visible startup error, window state, quit confirmation while a task runs.
3. Assistant features: hotkey through the portal with a Settings fallback message, quick-entry window, autostart file, notification on background, tray behind a capability check.
4. Packaging: `--dir`, AppImage, and rpm for `linux-x64`; install the rpm on the dev machine because the hotkey and deep link need the installed `.desktop` file.
5. Tests: unit lane, Playwright smoke under xvfb, packaged `--smoke`.
6. Demo script change: launch from the GNOME app grid, summon with the hotkey.

**Phase 2: macOS and Windows artifacts (about 2 weeks, needs test machines or friends' laptops).** Add `mac-arm64` and `win-x64` to the staging script and the workflow matrix; ad-hoc-signed dmg and unsigned NSIS; per-OS tray icons; `setLoginItemSettings`; write the first-run instructions for Gatekeeper and SmartScreen; run the manual checklist once per OS.

**Phase 3: updates and polish.** GitHub Releases feed; AppImage and NSIS auto-update; "new version" link on macOS; apply to SignPath Foundation; decide on Apple Developer ID; deb for Ubuntu with the sandbox post-install step; optional `linux-arm64` and `mac-x64`.

## Unavoidable in-tree edits

Phase 1 with option (b): **none**. Additions outside `air/` and `research/` that are new files, not edits, and must be listed in `air/UPSTREAM-DELTA.md`: `.github/workflows/air-desktop.yml`. Possible later rows, only if the corresponding need is confirmed: none are known for the shell itself. The existing candidate "Linux tray and global hotkey in `apps/desktop/src/`" and the Layer 3 desktop bullet in `air/BRANDING.md` can be withdrawn. If `air/pnpm-workspace.yaml` needs an `apps/*` glob, that file is already AIR-owned.

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Production tree staging is harder than expected (workspace links, native prebuild selection, Typert metadata) | Phase 1 slips | Do the 2-day spike first; fall back to copying upstream's `prepare-package-set.ts` approach as an AIR script |
| GNOME denies or loses the portal shortcut | Hotkey fails in the demo | Install the rpm before the demo, verify consent once, keep a GNOME custom shortcut running `<app> --quick-entry` as a rehearsed fallback (single-instance forwarding makes this work) |
| No tray on GNOME | Background app looks closed | Capability check, minimize instead of hide, background notification |
| `runProfile` or `authenticatedUrl` changes upstream | AIR Host fails to boot after a merge | Boot check in the post-merge routine in `air/README.md`; 80-line fix |
| Plain-Web mode lacks a Desktop-only client feature AIR later wants | Feature gap | Add an AIR preload and client plugin; do not adopt upstream's preload protocol |
| Ubuntu 24.04 AppImage sandbox failure | App does not start for Ubuntu users | Ship a deb for Ubuntu; document; never disable the sandbox |
| Unsigned macOS and Windows builds | Warnings; no macOS auto-update | First-run guide; SignPath application; optional Apple fee |
| Download size (Electron + Node + Python + dependency tree) | Several hundred MB | Make the Python payload optional in phase 1; measure before deciding |
| Two Electron apps in one repository pin different Electron versions | Confusion in lockfile and cache | AIR pins the same major as upstream and bumps in the merge routine |

## Open decisions for the owner

1. Approve option (b) and withdraw the in-tree Linux tray/hotkey candidate.
2. App id, protocol scheme, and `desktopName` placeholders (changing them later resets portal consent, userData, and Windows notification identity).
3. Linux artifacts for the review: AppImage + rpm now, deb in phase 3; Flatpak excluded.
4. Close-button behaviour on GNOME without a tray: minimize, or quit the window and keep the Host.
5. Whether the desktop build bundles the Python/Office primary runtime in phase 1 or only Node and pnpm.
6. Whether to pay 99 USD for Apple Developer ID before the final demo, and whether to apply to SignPath Foundation for Windows (requires the repository and build to be public).
7. Whether macOS and Windows builds are a graded deliverable for the first review or a later milestone; phase 2 needs access to both machines for manual checks.
8. Update `air/plans/README.md` item 8 and spike 05 section 7 to point at this note, and add a plan entry for the staging spike.
