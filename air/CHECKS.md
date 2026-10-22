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

The fork's `air` workflow runs on Linux and Windows: root install and build, AIR install, build, typecheck, lint, tests, the repository text gates, and the profile smokes. This is the only Windows signal so far. Because `pnpm -r` also reaches `apps/voice`, CI covers its typecheck, lint, and unit tests (the live listener spec is excluded); it does not build `apps/voice` (tsdown plus copy), run the Electron entry, or run the renderer, so run `pnpm -C air/apps/voice run build` by hand. The workflow file is not edited (repository rule). The Windows leg found the failures listed in the troubleshooting table of [WINDOWS.md](WINDOWS.md).

## 2026-10-21: voice agent automated checks

Environment: Windows 11 Home, branch `air/feat/voice-agent-track-a`, worktree build.

| Command | Result |
|---|---|
| `pnpm -C air run typecheck` | Passed (all 11 packages) |
| `pnpm -C air run lint` | Passed (generated-file checks and oxlint clean) |
| `pnpm -C air run test` | Passed (all packages; voice app 9 files, 115 tests, 100% coverage) |
| `pnpm -C air/apps/voice test` | Passed (9 files, 115 tests, 100% statements, branches, functions, lines) |
| `pnpm run verify-concrete-terms` | Passed |
| `pnpm run verify-repository-references` | Failed on `python/sdk/uv.lock:113` (pre-existing commit hash in a lockfile; not from the voice agent work) |

## 2026-10-21: voice agent manual scenarios

Environment: Windows 11 Home. These scenarios require the Electron app running with a live microphone and speakers, which is not available in this environment.

| # | Scenario | Result | Time to first spoken word | Error text |
|---|---|---|---|---|
| 1 | Open Notepad and write a todo list (spoken reply) | NOT RUN — requires Windows desktop with audio | — | — |
| 2 | Search weather in Chennai (spoken web summary) | NOT RUN — requires Windows desktop with audio | — | — |
| 3 | Remember a preference, recall it in a new session | NOT RUN — requires Windows desktop with audio | — | — |
| 4 | Switch model routes by voice or toggle | NOT RUN — requires Windows desktop with audio | — | — |

## 2026-10-21: voice operator, open tool, Ollama Cloud route

Environment: Windows 11 Home, branch `air/feat/voice-agent-track-a`, local Ollama with `qwen3-8b-32k`. Run: `pnpm -C air run typecheck` (passed), `pnpm -C air run lint` (passed), `pnpm -C air/apps/voice test` (10 files, 207 tests, 100% statements, branches, functions, lines), `pnpm -C air/apps/voice run build` (passed), `pnpm -r --no-bail --if-present run test` in `air` (all packages passed, `tool-open` 46 tests at 100% coverage).

- Operator by hand: through the real runner, "open notepad" started Notepad and "close notepad" stopped it. Not run by hand: the other operator actions (volume keys, lock, search URLs, apps other than Notepad), a spoken end-to-end command with a microphone, and the Ollama Cloud route (no key was used; the route and the model id `minimax-m3.1-flash`, taken from the public model list at ollama.com/api/tags, were not called).
- One real SDK turn, `scripts/ask.ts "open notepad"` on the local route after installing `@air/dsh-tool-open` into the voice home's `sdk` profile: one tool call, `open` with `{"kind":"app","value":"notepad"}`, result "Opened Notepad.", reply in 6.5 s, Notepad running afterwards (then stopped). First request: 2,878 prompt tokens (1,522 new plus 1,356 read from cache, from the usage event). Before the tool existed, the same prompt gave 2,776 prompt tokens, no tool call, and a prose reply, in 15 s. The profile's memory and browser rows were not installed in the voice home, so those tools were absent from both runs; they are skipped at boot with a warning.

Voice home wiring, same day: `scripts/setup-home.ts` installed the open tool, memory packages, and browser packages into `~/.air/voice-home/profiles/sdk`; boot then printed one warning, the `permission` entry, instead of six; a `voice` preset (workspace-write with approval never) as the default preset removed it, and a second boot printed no warning. Memory by hand on the local route: "use the memory_write tool to save ..." made one `memory_write` call (committed, no prompt) and a new conversation answered "how do I like answers?" from the pinned note; the plain phrase "remember that I like short answers" did not call the tool in four tries. With the browser rows installed the first request is about 6,650 prompt tokens, against about 2,880 without them.

Browser rows moved to the screen patch, local route, "open notepad": first request 3,389 prompt tokens (2,971 new plus 418 cached), one `open` call, against about 6,650 with the browser rows. Remember rewrite on the local route: "remember that I like short answers" became the memory_write instruction and the model called `memory_write` and replied "Noted."; a follow-up in a new conversation answered from the pinned note without a `memory_search` call.

## Not checked

- Native Windows by a person: everything after the first prompt (MCP trust, skills, commands, compaction), the Web UI fallback, and the Electron window itself.
- An installer; tray, menus, and updater on Linux.
- Hosted (cloud) models, including the voice cloud and screen routes (Ollama Cloud), which exist but have not been run by a person.
- Benchmark raw data from 2026-10-10 was lost; the figures in the research notes are summaries.

## 2026-10-21: voice wake word and English/Tamil recognisers

Environment: Windows 11 Home, branch `air/feat/voice-agent-track-a`. Checks run: `pnpm -C air/apps/voice test` (13 files, 268 tests, 100% coverage of `src/core`), `pnpm -C air run lint` and `typecheck` (passed), `pnpm -C air/apps/voice run build` (passed; the built `lib/listener-worker.cjs` loads and switches to Tamil). Live (`AIR_VOICE_LIVE=1`, SAPI speech fed in real time, voices David and Zira): the keyword spotter woke on "Jarvis, open notepad." and "Jarvis, search weather in Chennai." in all four runs, with 0.10 to 0.28 s between the end of the spoken word and the wake event; the commands were "Open Notepad" and "Search weather in Chennai" (Zira once heard "Jana"); decode took 50 to 110 ms for 1 to 1.2 s of speech (real-time factor 0.05 to 0.09); speech without "Jarvis" produced no wake and no decode; worker start took about 2 s; the Tamil model loaded in about 330 ms on the first switch and decoded a silent clip. Not run: any real Tamil speech (no source), a microphone, the Electron app end to end, the `screen` route.

## 2026-10-22: voice orb window and Kokoro speech

Environment: Windows 11 Home, branch `air/feat/voice-orb-ui`, 165 Hz display. Checks run: `pnpm -C air/apps/voice exec vitest run --coverage` (15 files, 410 tests, 100% statements, branches, functions and lines of `src/core`), `pnpm -C air run lint`, `pnpm -C air run typecheck`, `pnpm -C air/apps/voice run build` (all passed). Orb preview (`scripts/orb-preview.ts`, real Electron window, WebGL backend): idle 164 fps, listening 165 fps, thinking 165 fps, speaking 153 fps (worst frame 6 to 12 ms; one 360 ms stall while the first sentence of speech decodes and the audio context starts). Real app (`pnpm -C air run voice`, 25 s): listener ready in 2.7 s, no console errors.

Kokoro v1.0 multi-lang through sherpa-onnx (`scripts/tts-bench.ts`, 4 threads, CPU, sample "Good evening." plus "I can read your important mail, read today's news, or open an app."): model load 1.2 s; fp32 first sentence 260 to 350 ms, whole sample 1.1 to 1.3 s for 5 s of audio (real-time factor 0.22 to 0.26); int8 first sentence 840 ms, real-time factor 0.68, so fp32 (350 MB) is the pinned build. Voices af_heart, af_bella, bf_emma and am_michael rendered to `%USERPROFILE%\.air\voice-ui-shots\voices\`. Not run: any listening test (quality is the owner's call), Supertonic 3, a microphone-to-speaker run through the Kokoro path, SAPI cancel mid-render, barge-in against real speech, the renderer fallback to Canvas 2D (forced only by `?fallback` in a browser, not looked at).

## 2026-10-22: voice wake word on the real microphone

Environment: Windows 11 Home, branch `air/fix/voice-mic-wake`. Tools: `scripts/record-mic.ts` (headless Electron capture with the app's getUserMedia, echo cancellation, noise suppression and worklet), `scripts/score-kws.ts` (offline `KeywordSpotter`, per-threshold verdicts, per-frame RMS and peak, optional Parakeet transcript), `scripts/mic-check.ts` (record, optionally speak through SAPI, score). Clips are in `%USERPROFILE%\.air\voice-samples\` (not committed). Keyword score 2.5.

| Clip | Peak / RMS | Parakeet hears | Fires at 0.05 / 0.08 / 0.10 / 0.15 / 0.25, before | After the gain |
|---|---|---|---|---|
| a: room, nobody speaking | 0.28 / 0.03 | other people's speech in the room | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| b: SAPI "Jarvis, open notepad." at volume 60 through the speakers | 0.27 / 0.029 | unrelated room speech | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| b raw (no echo cancellation), SAPI volume 70 and 100 | 0.05 / 0.010 | nothing | 0 / 0 / 0 / 0 / 0 | not rescored |
| c: SAPI at volume 15 through the speakers | 0.42 / 0.038 | unrelated room speech | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| Earlier SAPI file, normal level | 0.60 / - | "Jarvis, open notepad." | 1 / 1 / 1 / 1 / 1 | 1 / 1 / 1 / 1 / 1 |
| Earlier SAPI file, quiet | 0.07 / - | "Jarvis, open notepad." | 0 / 0 / 0 / 0 / 0 | 1 / 1 / 1 / 1 / 1 (at 1.2 s) |

Findings, as measured. (1) SAPI played through this PC's speakers did not reach the microphone (raw capture RMS 0.01, empty transcript), so clips b and c hold room sound, not the wake phrase; they show only that no threshold from 0.05 to 0.25 gives a false wake on 6 s of room noise that contains speech. (2) The owner's real-microphone miss was not reproduced, because no clip of a person saying "Jarvis" was available to an agent. (3) Reproduced: a quiet utterance (peak 0.07) that Parakeet transcribes exactly fires the spotter at none of the five thresholds; the same samples amplified 2x, 4x or 8x fire at all five, and the normal-level clip still fires when attenuated to 0.5x and 0.25x. Level, not threshold, was the failing variable.

Fix chosen (one): a boost on the spotter's input only (`src/core/gain.ts`, `SpotterGain`). Gain is 0.3 divided by a decaying peak tracker (3% decay per 100 ms chunk), limited to 1 to 8, so quiet speech is lifted and loud audio passes untouched. Threshold, keyword score, VAD and recogniser path are unchanged. Voice tests: 299 pass, 100% statements, branches, functions and lines on `src/core` (`gain.spec.ts` plus a spotter-input test in `worker-engine.spec.ts`).

Not run: any clip of a person speaking "Jarvis" into the real microphone (so whether this fixes the owner's miss is unconfirmed), any speaker-to-microphone capture that worked, and a live wake in the app after the change. If the owner's voice still does not wake, use `AIR_VOICE_WAKE=text` (README, troubleshooting) and record a clip with `mic-check.ts` for rescoring.

## 2026-10-22: voice text wake, conversation, news, mail, send guard, voice approval

Environment: Windows 11 Home, branch `air/feat/voice-browser` (PR #11), merged with the mic-wake branch (PR #10). Nothing below touched a real browser or a Gmail account, and no real escalation was run.

Ran, all passing: `npx vitest run --coverage` in `air/apps/voice` (428 tests, 100% statements, branches, functions and lines of `src/core`); `@air/dsh-send-guard` and `@air/dsh-voice-approval` each with `vitest run --coverage` at 100% (the guard and the answerer are also exercised through a real `ToolRuntime`, and the answerer through the `approval/request` event); `pnpm -C air run build`, `lint`, `typecheck`, `test`, `smoke`; `pnpm run verify-concrete-terms`; `pnpm run verify-translation-pairing`; `pnpm -C air/apps/voice run build`.

Live, owner's real-microphone clip (`~/.air/voice-samples/owner-jarvis.wav`, 6 s, peak 1.0, "Hey Javis, open the notepad. Hey Javis, open the notepadepad.") through the real worker with the real models and the new default (text wake): `AIR_VOICE_LIVE=1 npx vitest run tests/listener.live.spec.ts -t owner` passed. Wake events at 3.8 s and 6.4 s of audio; commands "open the notepad" (1,916 ms of speech, 86 ms decode) and "open the" (1,308 ms, 63 ms). The keyword spotter fired 0 times on this clip at thresholds 0.05 to 0.25 (earlier measurement).

Live cloud turn (key present, presence checked only, never read), "what is 2+2" on the cloud route with the earlier voice patch (the new plugins are not installed in the voice home yet, and the Playwright patch was replaced by an empty one so no browser could start): reply "2 + 2 is 4.", 13.8 s including runtime start, 3,895 input tokens, 9 output tokens.

Persona (local route, "what's the capital of France and why is it famous"): 26 words before, 24 words after; first-request prompt tokens 3,415 before and 3,427 after. A quoted example sentence in the persona was repeated verbatim by the 8B model in two trials, so the final text has none; the model still answers in about the same length.

Not run: the new plugins inside the real dsh runtime (the voice home needs `scripts/setup-home.ts` re-run to install them, and `dsh --dump-config` was not run on the changed patches); whether the tool guard sees a `user/message` event with the token at the moment the model calls Send (it reads the session log the way the approval service does, tested with fake sessions only); whether upstream tools other than pwsh ask for approval under the `ask` policy and are now denied; the `mcp__browser__` allow-list under `ask`; Gmail with a real login; the news feed over the network; a spoken conversation with the follow-up window on the real speakers (echo of the app's own speech into the microphone is possible).

## 2026-10-22 (later): send guard live, echo muting, approval coverage

Live send-guard check without Gmail (`air/apps/voice/scripts/check-send-guard.ts`, cloud route, key present, the voice home with the plugins installed; the Playwright row replaced by `scripts/fixture-browser-mcp.mjs`, a stdio MCP server named `browser` with `browser_click` and `browser_press_key` that records each call): (1) asked to click "Send" with no token, the model called `mcp__browser__browser_click` and got "Error: Sending is locked until the user confirms."; the fixture recorded 0 calls. (2) With a fresh `[AIR-SEND-...]` token created as the controller does after a spoken yes, in the post-yes prompt, the same click ran: 1 recorded call, `{"tool":"browser_click","arguments":{"element":"Send","ref":"e5"}}`. (3) Asked again, the click was refused with the same text; still 1 recorded call. So the guard sees the token in the latest user message of a real session.

Approval requesters in the voice profile (from the source and `dsh --dump-config`, no model turn): pwsh and bash and the file write and edit tools (sandbox escalation, spoken yes flow), the plugin manager's tool, and the memory tools for feedback and forgetting. A rejected request that has no voice flow is now spoken as "I can't do that without approval." plus what it was.

Echo: the listener is muted while the app speaks and for 400 ms after (unit tests with fake timers and a fake worker engine only; not tried on real speakers). Send guard: Enter, NumpadEnter and Space after a Send-named target are refused (fake-call tests only; the live check above used a click).

## 2026-10-22: voice Gmail by REST API

Environment: Windows 11 Home, branch `air/feat/voice-gmail-api` after merging `origin/air/main` (which now includes the mic-wake, voice-browser, and rebrand work); the merge was clean, and every check below was re-run on the merged tree. Checks run: `pnpm -C air/apps/voice exec vitest run --coverage` (23 files, 648 tests, 100% statements, branches, functions and lines of `src/core`, including `src/core/gmail/*`), `pnpm -C air run lint`, `typecheck`, `test`, `smoke`, `pnpm -C air/apps/voice run build`, and at the repository root `verify-concrete-terms`, `verify-translation-pairing`, `verify-no-unknown-casts` (all passed). The unit tests use a fake `fetch`, a fake token endpoint, and a real loopback listener on 127.0.0.1 driven by a fake browser; no request leaves the machine. Covered: PKCE and consent URL, code exchange, token refresh and `invalid_grant`, encrypted token file, listing and metadata parsing, RFC 2047 header decoding, body extraction (plain, HTML fallback, quoted text), recipient resolution (none, one, several), spoken address normalisation, RFC 2822 building with UTF-8 subject, send only after an exact yes, every cancel path, the controller fallback when `google-credentials.json` is missing.

Not run: the real Google sign-in (needs the owner's Google account and a Desktop app OAuth client), any real Gmail read or send, Electron `safeStorage` encryption of the token file (the tests use a fake cipher), the spoken flow on a microphone. Reading and sending against a live account are unverified until the owner connects Gmail.
