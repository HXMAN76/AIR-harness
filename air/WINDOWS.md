# AIR on native Windows

Nobody on this project has yet run these steps on a Windows machine. The commands below are derived from upstream's documentation, the project scripts, and the Windows job of the fork's CI. The first teammate to run them should record the result with the report template at the end of this page.

This guide uses PowerShell and no WSL. Upstream supports native Windows development and treats WSL 2 as optional ([docs/development.md](../docs/development.md), section "Windows and WSL 2"). Keep the checkout and all tools in one environment; do not mix a Windows checkout with WSL tools.

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | `^22.19` or `>=24` (CI uses 24) | `node -v` |
| pnpm | exactly `11.28.5` | `pnpm -v` |
| Git | 2.26 or newer | `git --version` |
| Ollama for Windows | current release | `ollama --version` |
| Free disk | about 10 GB for the build, plus about 455 MB for the desktop runtime payload | `Get-PSDrive C` |

Native build tools: upstream's documentation names no compiler requirement for the development launch, and the Windows CI job installs and builds on a stock runner. Whether a fresh developer machine needs Visual Studio Build Tools (for example for the native addon the root `test` script builds) is unknown. If `pnpm install` or `pnpm run build` fails while compiling a native module, record the error in your report.

Windows builds of the packaged app (installer, signing) are out of scope here; they are described in [apps/desktop/README.md](../apps/desktop/README.md) and need extra tools (an NSIS compiler and 7-Zip). The development launch used below does not package anything.

## 2. Git settings

Upstream's `.gitattributes` sets `* text=auto eol=lf`, so the working tree is checked out with LF line endings on every host, and only `*.cmd` files get CRLF. The fork's CI sets `core.autocrlf false` on its Windows runner for the same reason. Set it before cloning, so your Git does not convert files a second time:

```powershell
git config --global core.autocrlf false
```

Upstream's documentation does not mention long paths. If a clone or build fails with a path-too-long error, run `git config --global core.longpaths true`, enable long paths in Windows, and record it in your report; this is not yet known to be needed.

## 3. Install the pinned pnpm

A globally installed pnpm 12 rewrites `package.json` and the lockfile. Install the pinned version:

```powershell
npm install -g pnpm@11.28.5
pnpm -v
```

`pnpm -v` must print `11.28.5`. The `air/` workspace pins `11.7.0` and selects it by itself when you run `pnpm -C air ...`. Upstream's guide suggests `corepack enable` instead; on Windows that can need an administrator shell when Node is installed under Program Files, so the `npm install -g` form is used here.

## 4. Clone and branch

```powershell
git clone git@github.com:HXMAN76/AIR-harness.git
cd AIR-harness
git switch air/main
git status
```

`git status` must show a clean tree. If it lists modified files straight after the clone, line endings were converted: check the setting in section 2.

## 5. Root install and build

```powershell
pnpm install
pnpm run build
```

The build takes several minutes. The Windows CI job runs the same two commands with `pnpm install --frozen-lockfile`.

## 6. AIR workspace install and checks

```powershell
pnpm -C air install
pnpm -C air run build
pnpm -C air run typecheck
pnpm -C air run lint
pnpm -C air run test
pnpm -C air run smoke
```

These are the steps of the Windows CI leg (install, build, typecheck, lint, tests, profile smokes), so they are expected to pass. `lint` fails when a generated file is stale; it names the generator (`lint:gen`, `gen:lean`, or `gen:policies`).

## 7. Ollama and the context variant

Install Ollama for Windows from its website, then pull the model and create the variant. Ollama's default 4,096-token context truncates the agent's prompt silently, so the variant is required. The commands write the two-line Modelfile without a heredoc:

```powershell
ollama pull qwen3:8b
Set-Content -Path Modelfile -Value "FROM qwen3:8b","PARAMETER num_ctx 32768" -Encoding ascii
ollama create qwen3-8b-32k -f Modelfile
ollama list
```

`ollama list` must show `qwen3-8b-32k`. Optional faster variant with a smaller context: write `PARAMETER num_ctx 16384` instead and name it `qwen3-8b-16k`. The model list and the trade-off are in [README.md](README.md#local-models). `qwen3:8b` needs a GPU with about 8 GB to run at the speeds quoted there; speed on other hardware is unknown.

## 8. Launch the desktop app

```powershell
pnpm -C air run desktop:setup
pnpm -C air run desktop
```

`desktop:setup` is idempotent. It adds the AIR bundles to the desktop profile, writes the Ollama route patch when none exists, adds `OLLAMA_API_KEY=ollama` to the `.env` of the harness home, and backs up every file it changes as `<name>.bak-<timestamp>`. The first launch downloads and builds a Node, pnpm, and Python runtime payload (about 128 MB downloaded, about 455 MB on disk; measured on Linux). Upstream supports a Windows x64 target for the desktop app, so the development launch is expected to pick the Windows payload; this has not been run.

Where things live, derived from `air/scripts/setup-desktop-profile.ts` and `apps/desktop/scripts/dev.ts`:

| What | Location |
|---|---|
| Harness home (`DSH_HOME`) | `apps\desktop\.desktop-build\development\home` inside the checkout, unless `$env:DSH_HOME` is set |
| Desktop profile | `<home>\profiles\desktop` (`package.json`, `cordis.patch.yml`) |
| Environment file | `<home>\.env` |
| Electron user data | `apps\desktop\.desktop-build\development\electron-user-data`, unless `$env:DSH_DESKTOP_USER_DATA_DIR` is set |
| Runtime payload | under `apps\desktop\.desktop-build`, which git ignores |
| Web profile (section 9) | `$HOME\.dsh`, a separate home |

Set `$env:DSH_HOME` before both commands to use another folder. The default workspace is created under the system Documents folder; on Linux it is `<Documents>/deepseek-harness/default-workspace`, and the Windows path is expected to follow the same pattern but is unverified.

What you should see: a window with the composer, the preset "AIR Lean", the model `qwen3-8b-32k`, effort Off, and no sign-in wall. The window shows upstream's name and icon. Send a message such as "say hello in one sentence".

## 9. Fallback: the Web UI

If the desktop app does not start, the Web UI uses the same bundle and the `air` profile under `$HOME\.dsh`:

```powershell
pnpm dsh --profile air --from-default-profile web --dump-config | Out-Null
pnpm dsh plugin --profile air add "$PWD\air\bundles\air"
New-Item -ItemType Directory -Force "$HOME\.dsh\profiles\air" | Out-Null
Copy-Item air\examples\ollama.profile.cordis.patch.yml "$HOME\.dsh\profiles\air\cordis.patch.yml"
Add-Content "$HOME\.dsh\.env" "OLLAMA_API_KEY=ollama"
pnpm dsh --profile air
```

The Web UI opens on `http://127.0.0.1:3080`. This has not been run on Windows either.

## 10. Troubleshooting

The rows on pnpm, path case, 8.3 names, `ENOENT`, `EPERM`/`EBUSY`, and the nested lint config come from failures seen in this project's Windows CI and the fixes made for them; the line-ending row follows from `.gitattributes` and the CI setting and was not itself seen as a failure. The last row records that upstream documents no further Windows issues.

| Symptom | Cause | What to do |
|---|---|---|
| `pnpm install` changes `package.json` or `pnpm-lock.yaml` | A global pnpm 12 rewrote the files | Run `git checkout -- package.json pnpm-lock.yaml`, install `pnpm@11.28.5`, repeat |
| Two spellings of the same path are treated as different files, or a visited-file check misses a loop | Windows paths are case-insensitive and carry drive letters | Compare paths lower-cased on `win32`; the AIR packages already do |
| A test compares a temp path and fails although the folders are the same | Temp folders can appear as 8.3 short names (`RUNNER~1`) in one place and long names in another | Resolve both sides with `realpath` before comparing |
| Reading a path below a regular file reports `ENOENT` where Linux reports `ENOTDIR` | Windows error code differs | Treat both as "absent" or "parent is a file", as `lockfile.ts` in `mcp-trust` does |
| Renaming or replacing a file fails with `EPERM` or `EBUSY` | Another process (antivirus, indexer, a child process) holds the file for a moment | Retry the rename a few times, as the test helpers do; close programs that use the folder |
| Repository-wide lint fails on a config inside `air/` | A second lint config named like the root one was picked up as a nested config | The generated config is named `air/oxlint.air.json`; keep that name |
| Files show as modified straight after clone | Line-ending conversion | Section 2 |
| Upstream's documented Windows limits | Upstream names none beyond: test results apply only to the environment where they ran, and Windows behavior needs native validation | Record what you see |

## First Windows run report

Copy this block into an issue or the team chat and fill it in. Paste the error text exactly; do not summarise it.

```text
Windows version (winver):
CPU / RAM / GPU:
Node (node -v):
pnpm (pnpm -v):
Git (git --version):
Ollama (ollama --version):
Shell: PowerShell 5.1 / PowerShell 7

Step                                   Result (pass/fail)   Time   Error text
2  git config core.autocrlf false
4  clone and git status clean
5  pnpm install
5  pnpm run build
6  pnpm -C air install
6  pnpm -C air run build
6  pnpm -C air run typecheck
6  pnpm -C air run lint
6  pnpm -C air run test
6  pnpm -C air run smoke
7  ollama create qwen3-8b-32k
8  pnpm -C air run desktop:setup
8  pnpm -C air run desktop (window opens)
8  message answered by the local model

Total time from clone to first reply:
Native build tools needed? (which, and where the error was):
Long paths needed?:
Where the harness home and Documents workspace actually are:
Screenshots (attach): the app window showing the preset ("AIR Lean") and the model name.
Anything else:
```
