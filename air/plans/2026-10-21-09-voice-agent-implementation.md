# AIR Voice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A wake-phrase voice companion for native Windows that drives a dsh session (local Qwen by default, OpenRouter cloud opt-in) with PowerShell, web, desktop control, and Markdown memory.

**Architecture:** An Electron app in `air/apps/voice` captures the microphone in the renderer, runs Silero VAD plus SenseVoice in a Node child process, matches the wake phrase, sends the command to a dsh runtime through upstream's TypeScript SDK, and speaks the reply through a PowerShell SAPI child. Memory is plan 04 without embeddings, loaded into the voice profile by patch rows.

**Tech Stack:** TypeScript 6 strict ESM, Electron 44.7.0 (linked from `apps/desktop`), `sherpa-onnx-node` 1.13.8, `@deepseek-ai/dsh-sdk-client` 0.2.1-rc.2, Windows `System.Speech`, `node:sqlite` FTS5, vitest 4.

**Spec:** [2026-10-21-08-voice-agent.md](2026-10-21-08-voice-agent.md); memory: [2026-09-30-04-memory-core.md](2026-09-30-04-memory-core.md).

## Global Constraints

- Obey `air/AGENTS.md`: out of tree, English only, no custom session event types, no `as unknown`, no commit hashes, no banned origin-label word, scripts in Node/tsx (no bash).
- Default route `ollama` / `qwen3-8b-32k`; cloud routes `openrouter` / `anthropic/claude-haiku-5.5` (cloud) and `openrouter` / `anthropic/claude-sonnet-5.5` (screen); ids from pi-ai's OpenRouter catalog. The cloud is never selected unless the user asks. (Owner change 2026-10-21: OpenRouter replaces the direct Anthropic route.)
- Audio and dropped transcripts are never written to disk or sent anywhere.
- AIR code never reads, logs, or prints `OPENROUTER_API_KEY`; it only checks presence (`!== undefined && !== ''`) to choose an error message.
- Voice home: `dshHome = <user home>/.air/voice-home`; workspace: `<Documents>/AIR Voice` (the Windows sandbox cannot grant ACLs on `G:\AIR-harness`, spec "Spike results").
- Models: `<user home>/.air/voice-models/` holding `model.int8.onnx`, `tokens.txt`, `silero_vad.onnx` with the SHA-256 values in `packages/experimental/speech-to-text-sensevoice/runtime/assets.json`.
- Wake word "Jarvis" (owner change 2026-10-21). Default phrases, one constant: `jarvis`, `hey jarvis`, `ok jarvis`, `jervis`, `jarvas`, `travis` (SenseVoice mis-hearings); follow-up window 8,000 ms.
- Priority: opening apps and local tasks through `pwsh` (`Start-Process notepad`, write a file, list a folder, open a URL in the default browser).
- Token economy: the voice profile keeps only the base `sdk` tools, `pwsh`, web fetch, the browser, and memory; no skills catalog, no subagent, schedule, goal, or workflow tools.
- Spoken reply: Markdown, code blocks, and URLs removed; at most the first two sentences when the cleaned text exceeds 60 words.
- Turn watchdog: 120,000 ms then speak "Still working."; "cancel" closes and restarts the runtime.
- Package name `@air/voice`, private, in workspace glob `apps/*`. Tests: `pnpm -C air/apps/voice test`. Coverage for `src/core/**`: 100% (`--coverage.include='src/core/**' --coverage.thresholds.100`); Electron and child-process entry files are exempt and covered by the manual check.

## Review Focus

- A transcript that contains the wake phrase mid-sentence ("I said hey jarvis yesterday") must not trigger: only a phrase at the start counts (wake matcher test).
- Speech while the agent is speaking: a wake phrase stops speech first, then handles the command; other speech is ignored (controller test `barge-in`).
- A second command while a turn runs: answered "I'm still on the last one." and dropped, not queued (controller test `busy`).
- The cloud route chosen without a key: spoken "The cloud key is not set." and the route stays local (agent bridge test `missing key`).
- Very long replies or replies that are only a code block: spoken text is never empty; fall back to "Done. The details are on screen." (cleaner test).

---

## Track A — voice app (`air/apps/voice`)

### Task A1: Package scaffold and wake matcher

**Files:**
- Modify: `air/pnpm-workspace.yaml` (add `- apps/*`)
- Create: `air/apps/voice/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` (copy the shapes of `air/packages/preset-by-model`), `README.md` (package README template: Summary, Model Experience, Known Limitations)
- Create: `air/apps/voice/src/core/wake.ts`
- Test: `air/apps/voice/tests/wake.spec.ts`

**Interfaces:**
- Produces: `matchWake(transcript: string, phrases?: readonly string[]): { wake: boolean; command: string }`, `DEFAULT_WAKE_PHRASES: readonly string[]`.

- [ ] **Step 1: Write the failing test** — table cases: `'Jarvis, open Notepad.'` → `{ wake: true, command: 'open Notepad' }`; `'hey jarvis what time is it'` → command `'what time is it'`; `'Hey, Jarvis.'` → `{ wake: true, command: '' }`; `'I said hey jarvis yesterday'` → `{ wake: false, command: '' }`; `''` → no wake; `'JARVIS!!! search weather'` → command `'search weather'`. Command keeps original casing, trims punctuation at both ends.
- [ ] **Step 2: Run** `pnpm -C air install` then `pnpm -C air/apps/voice test` — expect FAIL (module missing).
- [ ] **Step 3: Implement `matchWake`** — normalise a copy (lower case, strip `[^a-z0-9 ]`, collapse spaces) only to find the phrase at the start; slice the command from the original by word count.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `feat(air): scaffold the voice app and its wake matcher`.

### Task A2: Spoken-text cleaner and voice commands

**Files:**
- Create: `air/apps/voice/src/core/speech-text.ts`, `air/apps/voice/src/core/commands.ts`
- Test: `air/apps/voice/tests/speech-text.spec.ts`, `tests/commands.spec.ts`

**Interfaces:**
- Produces: `toSpokenText(reply: string): string`; `parseVoiceCommand(command: string): { kind: 'route'; route: Route } | { kind: 'new-conversation' } | { kind: 'cancel' } | { kind: 'memory-share'; on: boolean } | { kind: 'ask'; text: string }`; `type Route = 'local' | 'cloud' | 'screen'`.

- [ ] **Step 1: Failing tests** — `toSpokenText('**Done.** See https://x.y')` → `'Done. See the link on screen.'`; a reply that is only a fenced code block → `'Done. The details are on screen.'`; 80-word reply → first two sentences; Markdown list → items joined with commas. `parseVoiceCommand('use cloud')` → route cloud; `'switch to local'` → local; `'use screen mode'` → screen; `'new conversation'`; `'cancel'`; `'share memory with cloud'` → on true; `'stop sharing memory'` → on false; anything else → ask.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement both functions** (regex tables; no dependencies).
- [ ] **Step 4: Run** — PASS, 100% coverage of `src/core`.
- [ ] **Step 5: Commit** `feat(air): add the voice reply cleaner and voice commands`.

### Task A3: Speaker (SAPI child)

**Files:**
- Create: `air/apps/voice/src/core/speaker.ts`, `air/apps/voice/src/speaker.ps1`
- Test: `air/apps/voice/tests/speaker.spec.ts`

**Interfaces:**
- Produces: `class Speaker { constructor(spawnFn?: SpawnLike); speak(text: string): Promise<void>; stop(): void; dispose(): Promise<void>; readonly speaking: boolean }`. Line protocol to the child: `SAY <base64 utf8>` / `STOP`; child writes `DONE` after each utterance or cancel.
- `speaker.ps1`: loads `System.Speech`, `SelectVoiceByHints` female adult en-US fallback to default, reads stdin lines, `SpeakAsync` / `SpeakAsyncCancelAll`, writes `DONE` on `SpeakCompleted`.

- [ ] **Step 1: Failing tests with a fake spawn** — `speak('hi')` writes `SAY aGk=\n` and resolves on `DONE`; `stop()` writes `STOP\n` and the pending promise resolves; `speaking` true between; child exit rejects pending and the next `speak` respawns once; a second exit makes `speak` reject with `Error('speaker unavailable')`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — spawn `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <speaker.ps1>`.
- [ ] **Step 4: Run** — PASS. Manual: `pnpm -C air/apps/voice exec tsx scripts/say.ts "Hello from AIR"` speaks (add that 5-line script).
- [ ] **Step 5: Commit** `feat(air): speak replies through Windows SAPI`.

### Task A4: Listener (VAD + SenseVoice child)

**Files:**
- Create: `air/apps/voice/src/core/models.ts`, `air/apps/voice/src/listener-worker.ts` (child entry), `air/apps/voice/src/core/listener.ts` (parent side)
- Create: `air/apps/voice/scripts/fetch-models.ts`
- Test: `air/apps/voice/tests/models.spec.ts`, `tests/listener.spec.ts`, opt-in `tests/listener.live.spec.ts` (runs only when `AIR_VOICE_LIVE=1`)

**Interfaces:**
- Produces: `modelPaths(home?: string): { model: string; tokens: string; vad: string }`; `verifyModels(paths): Promise<{ ok: true } | { ok: false; missing: string[] }>` (size + SHA-256 from upstream `assets.json`); `class Listener extends EventEmitter { start(): void; push(frame: Float32Array): void; stop(): Promise<void> }` emitting `'segment'` with `{ text: string; durationMs: number }` and `'error'`.
- Worker protocol: parent writes raw Float32LE frames on stdin; worker writes one JSON line per segment on stdout. Worker uses `sherpa.Vad` (threshold 0.5, minSilence 0.5 s, minSpeech 0.25 s, maxSpeech 15 s, window 512) and `OfflineRecognizer` (SenseVoice, language `auto`, ITN on, 4 threads), resolved with `createRequire` against `packages/experimental/speech-to-text-sensevoice/package.json`.
- `fetch-models.ts` downloads the three pinned files from `assets.json` URLs, verifies, and prints sizes; it skips verified files.

- [ ] **Step 1: Failing tests** — `modelPaths` default directory; `verifyModels` reports a missing file and a wrong hash (temp files); `Listener` with a fake worker: frames are forwarded as bytes, a JSON line becomes a `'segment'`, malformed lines emit `'error'` once and keep running.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. Live: `AIR_VOICE_LIVE=1 pnpm -C air/apps/voice exec vitest run tests/listener.live.spec.ts` with fixture `tests/fixtures/jarvis-open-notepad.wav` (record with the app's own capture in Task A6, or any 16 kHz mono WAV) → one segment whose `matchWake` command contains `notepad`.
- [ ] **Step 5: Commit** `feat(air): listen with Silero VAD and SenseVoice`.

### Task A5: Agent bridge and voice profile

**Files:**
- Create: `air/apps/voice/src/core/agent.ts`, `air/apps/voice/profile/voice.cordis.patch.yml`, `air/apps/voice/profile/screen.cordis.patch.yml`, `air/apps/voice/scripts/setup-home.ts`
- Modify: `air/apps/voice/package.json` (dependency `@deepseek-ai/dsh-sdk-client`: `link:../../../packages/sdk/client`)
- Test: `air/apps/voice/tests/agent.spec.ts`

**Interfaces:**
- Consumes: `Route` (A2).
- Produces: `class AgentBridge { constructor(opts: { dshHome: string; cwd: string; harnessFactory?: HarnessFactory }); route: Route; setRoute(route: Route): { ok: true } | { ok: false; reason: 'missing-key' }; ask(text: string): Promise<{ reply: string; tools: string[] }>; newConversation(): void; setMemoryShare(on: boolean): Promise<void>; readonly memoryShared: boolean; cancel(): Promise<void>; dispose(): Promise<void> }`. `setMemoryShare` closes the harnesses and records whether the next launch adds `profile/memory-share.cordis.patch.yml` (created by Track B; until then the method only records the flag). Route → `{ provider, model, patches }`: local `ollama`/`qwen3-8b-32k`/[voice]; cloud `openrouter`/`anthropic/claude-haiku-5.5`/[voice]; screen `openrouter`/`anthropic/claude-sonnet-5.5`/[voice, screen]. One harness per route, created lazily, `profile: 'sdk'`, `dshBin` = `apps/cli/lib/bin.js` resolved from the repository root, `initializeTimeoutMs: 300_000`. Session id kept per route until `newConversation()`.
- `voice.cordis.patch.yml`: the Ollama route block from `air/examples/ollama.profile.cordis.patch.yml`; the `openrouter` catalog provider of `llm-pi-ai` (key `OPENROUTER_API_KEY`) needs no provider block; a persona row instruction: "You are AIR, a voice assistant on the user's Windows PC. Answer in one to three short spoken sentences without Markdown. Use the pwsh tool for local tasks and say what you did. To open an app use Start-Process. To type text into a new file, write it with Set-Content then open it."; rows that remove the skills catalog and the subagent, schedule, goal, and workflow tools; `tool-web` fetch on; the Playwright MCP browser rows (`@deepseek-ai/dsh-browser-use-playwright-mcp` and its runtime, copying the row shape from that package's README).
- `screen.cordis.patch.yml`: `@deepseek-ai/dsh-computer-use-cua-driver-native` rows from its README.
- `setup-home.ts`: creates the voice home and workspace, writes `OLLAMA_API_KEY=ollama` into `<home>/.env` when absent, prints whether `OPENROUTER_API_KEY` is present in that file or the environment (yes/no only), backs up any changed file as `<name>.bak-<timestamp>`.

- [ ] **Step 1: Failing tests with a fake harness factory** — default route local; `setRoute('cloud')` without the key → `{ ok: false, reason: 'missing-key' }` and route stays local; with the key (set in a test env object passed to the factory, never the real one) → ok and next `ask` uses `openrouter`/`anthropic/claude-haiku-5.5`; `ask` returns `finalResponse` and the `tool/call` names from `events`; `newConversation` drops the session id; `cancel` closes the harness and the next `ask` makes a new one.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. Live: `pnpm -C air/apps/voice exec tsx scripts/setup-home.ts` then `pnpm -C air/apps/voice exec tsx scripts/ask.ts "Use pwsh to print the year"` (add the script) answers with the year; a second turn opens Notepad with `Start-Process` (closed afterwards with `Stop-Process`) and the tool calls are recorded; the first request's prompt tokens on the local route are measured (Ollama `prompt_eval_count`); compose check: `node apps/cli/lib/bin.js --profile sdk --patch air/apps/voice/profile/voice.cordis.patch.yml --dump-config` with `DSH_HOME` = the voice home shows no unmatched patch targets.
- [ ] **Step 5: Commit** `feat(air): drive the voice agent through the SDK with local and cloud routes`.

### Task A6: Controller and Electron shell

**Files:**
- Create: `air/apps/voice/src/core/controller.ts`
- Create: `air/apps/voice/src/main.ts`, `src/preload.cts`, `src/renderer/index.html`, `src/renderer/capture-worklet.js`, `src/renderer/app.js`
- Modify: `air/apps/voice/package.json` (scripts `build` with tsdown for `main.ts`, `start` = `electron lib/main.js`; devDependency `electron`: `link:../../../apps/desktop/node_modules/electron`); `air/package.json` script `voice`: `pnpm -C apps/voice start`
- Test: `air/apps/voice/tests/controller.spec.ts`

**Interfaces:**
- Consumes: `matchWake` (A1), `parseVoiceCommand`, `toSpokenText` (A2), `Speaker` (A3), `Listener` (A4), `AgentBridge` (A5).
- Produces: `class VoiceController { constructor(deps: { listener; speaker; agent; now?: () => number; onState: (s: VoiceState) => void }); handleSegment(seg: { text: string }): Promise<void> }`; `type VoiceState = { phase: 'idle' | 'awake' | 'thinking' | 'speaking'; route: Route; transcript?: string; reply?: string; tools?: string[]; error?: string; memoryShared: boolean }`.
- Rules: wake with command → handle; wake without command → `awake` for 8,000 ms, next segment is the command; while `speaking`, a wake segment calls `speaker.stop()` first; while `thinking`, a wake command gets spoken "I'm still on the last one." (except `cancel`); route commands answer "Using local model." / "Using the cloud model." / "Screen mode on." or "The cloud key is not set."; ask → `thinking`, `agent.ask`, `speaking` with `toSpokenText`, `idle`; errors spoken in one sentence and shown; watchdog at 120,000 ms speaks "Still working.".
- Electron: `main.ts` creates a 380×520 always-on-top window, grants only the `media` permission, spawns the listener and speaker, forwards renderer frames (`ipc 'frames'`, Float32Array buffers of 1,600 samples) to `listener.push`, pushes `VoiceState` to the renderer (`ipc 'state'`). Renderer: `AudioContext({ sampleRate: 16000 })` + `AudioWorklet` capture with echo cancellation and noise suppression; shows a status dot per phase, route toggle buttons (Local / Cloud / Screen), a "Share memory with cloud" checkbox (off), last transcript, reply, tool names, and a microphone-on indicator.

- [ ] **Step 1: Failing controller tests** (fakes, fake clock): wake+command flow; wake-then-command within 8 s; command after 8 s ignored; barge-in; busy; route command without key; agent error spoken; watchdog; mid-sentence wake ignored.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement controller, then the Electron files.** **Step 4: Run** — PASS; `pnpm -C air run typecheck` and `pnpm -C air run lint` pass. Manual: `pnpm -C air run voice`, say "Jarvis, what time is it?" → spoken time.
- [ ] **Step 5: Commit** `feat(air): add the voice controller and the Electron window`.

### Task A7: Review scenarios, docs, checks

**Files:**
- Modify: `air/apps/voice/README.md`, `air/README.md` (new "Voice agent (preview)" section with setup and the four commands), `air/WINDOWS.md` (section "Voice agent"), `air/CHECKS.md` (dated section with each scenario's result and time), `air/UPSTREAM-DELTA.md` (state "no upstream files changed" for this feature), `air/plans/README.md` (status rows for plans 08/09)

- [ ] **Step 1:** Run the four spec scenarios on Windows (local route; then cloud and screen if the key is set); record pass/fail, seconds to first spoken word, and the exact error text of any failure.
- [ ] **Step 2:** Write the docs; run `pnpm run verify-concrete-terms`, `pnpm run verify-repository-references`, `pnpm -C air run lint`, `pnpm -C air run test`.
- [ ] **Step 3: Commit** `docs(air): document the voice agent preview and its Windows checks`.

## Track B — memory (plan 04 without embeddings)

Execute [plan 04](2026-09-30-04-memory-core.md) tasks in its own order with these changes; everything not listed is executed as written.

- **Skip Task 3** (`@air/dsh-embedding`).
- **Task 4** (`@air/dsh-memory-index`): build only the FTS5 table and keyword search; the embedder is an optional injected dependency that is absent, `vector` rows and RRF fusion are not created, and search ranks by FTS5 `bm25` with the plan's validity filters. Keep the plan's index rebuild and staleness behaviour. Tests for vector paths are dropped; coverage stays 100%.
- **Task 5** (`@air/dsh-tool-memory`): `memory_search` calls keyword search only; remove the Ollama-not-ready messages that concern embeddings.
- **Task 6** as written.
- **Task 7** as written for `air/bundles/air`, plus: add the memory host and agent rows to `air/apps/voice/profile/voice.cordis.patch.yml` with `shareWith: ['ollama']`; the voice controller's `memory-share` command and checkbox switch the runtime by restarting the harness with an extra per-launch patch `profile/memory-share.cordis.patch.yml` that sets `shareWith: ['ollama', 'openrouter']`.
- Peer ranges in new packages: `^0.2.0-rc.1 || ^0.2.1-alpha.1` (matches `0.2.1-rc.2`).
- Track B starts at the same time as Track A; its Task 7 voice-profile step waits for Task A5.

### Task B-final: Memory in the voice scenarios

- [ ] **Step 1:** Run spec scenario 3 (remember, new conversation, recall) on the local route; record in `air/CHECKS.md`.
- [ ] **Step 2: Commit** `docs(air): record the voice memory check`.
