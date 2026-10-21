# Verification log

Dated record of what was checked by hand and what the result was. The README links here instead of repeating it. Add a section for every new check; do not rewrite old sections. The first native Windows run by a person is the 2026-10-20 section.

## 2026-10-12: desktop app

Environment: Fedora 44, Wayland session, upstream's desktop app run from source with the AIR bundle and `air/bundles/air-desktop`, model `qwen3-8b-16k`, a demo project as the default workspace, driven by `air/scripts/desktop-drive.mjs`.

Passed:

- The app starts with no failed or pending rows, and the window is usable with no sign-in wall.
- The AIR preset and the local model are shown.
- A plain prompt got a reply in 35 seconds at about 30 tokens per second.
- `.claude/CLAUDE.md` with its `@notes.md` import reached the model.
- `/mcp` listed the project server as not approved, and `/mcp approve demo` started it.
- `/mcp-trust status` showed it unpinned.
- Asking the model to use the server's tool raised the approval prompt; after "Reject" the tool stayed unavailable.
- `list_mcp_resources` for the declined server was denied.
- `/mcp-trust diff demo` showed the tool's description, its input, and the exact pin command.
- The pin command pinned one tool, and status then showed approved.
- The tool call then returned `echo: mango`.
- `/issue 42` sent "Summarise issue 42 in one sentence." to the model, confirmed in the Trajectory view.
- "Use the hello skill to greet Sam." called the `skill` tool with name `hello`, and the model answered "Hello Sam!".

Open or not covered at the time:

- Once, in a session of 7 turns, a reply was cut off after 1 second with "Output token limit reached". It did not repeat in a new session, and the cause is not known.
- Each request to the model was about 8,500 tokens before any conversation, 52 to 54 percent of the 16,384-token context of that model. This led to the lean preset and the 32K default below.
- One reply ended with the stray text "/think".
- Not covered: path-scoped rules, revoke, a pinned server that later changes its tools, tray, menus, updater, and anything on Windows or macOS.

## 2026-10-12: local-model tuning

Environment: the same machine, default model `qwen3-8b-32k`, Ollama behind a recording proxy.

- E1: the app starts with no failed, pending, or invalid-compaction lines in the log, and the composer is shown.
- E2: a new session shows preset "AIR Lean" and model `qwen3-8b-32k`.
- E3: the reply was exactly "still here" with no `/think`, in 8 seconds; the request carried `reasoning_effort: "none"`.
- E4: the lean request had 19 tools and 4,426 prompt tokens, with none of the schedule, goal, delegation, or workflow tools; the full preset's earlier capture had 36 tools and 8,113 prompt tokens.
- E5: choosing "AIR" by hand sent 32 tools and 7,686 prompt tokens, and the page showed "AIR".
- E6: on a blank session, choosing a model with a 200,000-token window changed the preset to "AIR" within 1 second, and choosing `qwen3-8b-32k` again changed it back to "AIR Lean", with no reload.
- E7: a preset picked by hand stayed "AIR" after the model changed to `qwen3-8b-16k`.
- E8: with whole-file reads of about 11,000 tokens each, prompts fell from 18,200 to 11,607, from 22,649 to 13,905, from 20,567 to 13,599 (through a summary request limited to 2,048 output tokens), and from 24,564 to 15,844; every other request kept `max_tokens` 4096, and "Output token limit reached" never appeared.
- E9: the composer's model menu has an effort control; "Medium" sent `reasoning_effort: "medium"`, and the reply was 391 in 26 seconds.

## 2026-10-12: follow-up fixes

Environment: the same machine.

- F1: after the fixes the app starts with no failed, pending, or invalid-compaction lines in the log; the composer is shown, and a new session shows "AIR Lean", `qwen3-8b-32k`, and effort Off.
- F2: choosing effort "Medium" sent `reasoning_effort: "medium"` (reply 391) and left no `reasoningEffort` key in the profile's `agent-default-model` row; a new session showed effort Off and sent `reasoning_effort: "none"`.
- F3: choosing `qwen3-8b-16k` wrote `model: qwen3-8b-16k` as the default without a `reasoningEffort` key; choosing `qwen3-8b-32k` again returned the default.
- F4: over 11 file-read messages two summary requests (2,048 output tokens) were recorded; the last summary instruction contained "Chronological Log" and "First request", and the summary (957 tokens) listed f1.txt to f8.txt in order. "Which file did you read first?" was answered "f1.txt", and the ordered list of read files was right for all 10 files. The "Context compacted" row was at the top level with the "Completed in Ns" disclosures collapsed, and expanding it showed the summary with its log. No "Output token limit" message appeared and every other request kept `max_tokens` 4096.
- F5: the headless profile steps in the README created a profile under an empty `DSH_HOME`, and one task from a project with `.claude/CLAUDE.md` created `notes.md` whose first line was `# AIR`.

## 2026-10-20: first native Windows run

Environment: Windows 11 Home 10.0.26200, NVIDIA GeForce RTX 4060 Laptop GPU (8 GB), 31 GB RAM, Node 26.12.0, pnpm 11.28.5, Git 2.56.0.windows.2, Ollama 0.40.6, Windows PowerShell 5.1 and Git Bash, checkout on drive G:. Steps from [WINDOWS.md](WINDOWS.md).

Passed:

- Root `pnpm install` and `pnpm run build`, and `pnpm -C air install` and `build` (run by the owner before this check; times not recorded).
- `pnpm -C air run typecheck`, `lint`, and `smoke` (all three profile smokes printed "ok").
- `pnpm -C air run test`: all ten packages passed on a quiet machine. A first run while `graphify update .` was using the CPU failed one test in `mcp-conventions` ("does not wait for a reviewer by default", "expected 'error' to be 'success'"); that test gives the server a 500 ms start-up timeout. It passed three times in a row alone and in the next full run.
- `ollama create` for `qwen3-8b-32k` and `qwen3-8b-16k`; `ollama list` showed both.
- `pnpm -C air run desktop:setup` created the desktop profile under `apps\desktop\.desktop-build\development\home`, added both bundles, wrote the Ollama route, and added `OLLAMA_API_KEY` to `.env`.
- `pnpm -C air run desktop` started on the second attempt (see below). The app page, opened from the `dsh web` address the launch printed, showed "AIR Lean", `qwen3-8b-32k`, effort Off, and no sign-in wall, behind a "Preview Notice" dialog dismissed with "Continue". "say hello in one sentence" was answered "Hello! How can I assist you today?" in 14 seconds including the model load, at 17 tokens per second, with 4.8K tokens in the request.

Problems:

- The first `pnpm -C air run desktop` failed while preparing the runtime payload with `EPERM, Permission denied: 'G:\AIR-harness\apps\desktop\.desktop-build\targets\win-x64\runtime\primary-runtime'`; the copied payload had `dependencies\python` but no `node` or `pnpm`. The same preparation run again succeeded with no change, so the cause is taken to be a file held for a moment by another process (the `EPERM` row of the troubleshooting table in WINDOWS.md); this is not proven.
- Ollama reported `qwen3-8b-32k` at 10.3 GB with 6.3 GB in GPU memory, so part of the model ran on the CPU.
- `desktop:setup` ran the profile's `pnpm install` with pnpm 12.14.0, not the pinned 11.28.5, and printed Node's `DEP0190` warning about shell arguments. The install succeeded.
- The system Git config had `core.autocrlf true`; the working tree was still clean. `core.autocrlf false` and `core.longpaths true` were then set globally as WINDOWS.md asks. Windows long paths were already enabled.
- Native build tools: none were installed, and no step needed them.

Not covered: the Electron window itself (the check used the page it serves), the Web UI fallback, MCP trust, skills, commands, and compaction on Windows.

## 2026-10-20: upstream sync to `dsh-v0.2.1-rc.2`

Environment: Windows 11 Home, Node 26.12.0, pnpm 11.28.5, branch `air/sync/dsh-v0.2.1-rc.2`. Details of the merge are in [research.md](../research/research.md) section 2b (fifth sync) and [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md).

Passed after the merge:

- Root `pnpm install`, `pnpm run clean`, and `pnpm run build` (9 gates passed). A first build run at the same time as a second clean failed with stale `tsbuildinfo` files (`TS2307` in `ui-message-feedback`, `TS6305` in `session-inspector`); a single clean followed by a single build passed. Do not run two builds or a clean and a build at once.
- `pnpm exec vitest run` on the desktop build-path, runtime-preparation, and retention tests, `packages/client/ui-chat`, and `packages/mcp/mcp-client/tests`: 64 files, 1,003 tests passed.
- `pnpm run gen-config-catalog` left `docs/config-catalog*.md` unchanged.
- `pnpm -C air install`, `build`, `typecheck`, `lint`, and `smoke` (all three smokes "ok").
- AIR package tests: all ten packages pass, `preset-by-model` after its test change (28 tests).

- `scripts/tests/preset-air-drift.spec.ts` failed until `preset-air` dropped `toolFilter` from its two sub-agent rows (upstream's `standard` preset dropped it and `dsh-tool-subagent` now rejects it) and gained the disabled `tool-plugin-market` row. After that change and `gen:lean`, the AIR root tests (74), lint, and the three smokes passed.

Not run: the desktop app and the Web UI on the merged tree.

## Continuous integration

The fork's `air` workflow runs on Linux and Windows: root install and build, AIR install, build, typecheck, lint, tests, the repository text gates, and the profile smokes. This is the only Windows signal so far. The Windows leg found the failures listed in the troubleshooting table of [WINDOWS.md](WINDOWS.md).

## Not checked

- Native Windows by a person: everything after the first prompt (MCP trust, skills, commands, compaction), the Web UI fallback, and the Electron window itself.
- An installer; tray, menus, and updater on Linux.
- Hosted (cloud) models.
- Benchmark raw data from 2026-10-10 was lost; the figures in the research notes are summaries.
