# Spike 05: voice loop, OS control, triggers, secret handoff, and Linux desktop shell

Status: research spike, 2026-09-30. Base: `air/main` on upstream `dsh 0.2.0-rc.2`. Machine: Fedora 44, GNOME Shell 50.5 on Wayland, RTX 4060 Laptop (8 GB, driver 615.71), 24 CPU threads, 30 GB RAM, Ollama 0.32.7. Scope: research.md sections 5.6 to 5.10 and note 06. Every file reference below was read in this repository; every "probe" line is a read-only command run on the reference machine. Nothing in this spike changes code.

## 0. Summary

- **Voice needs no upstream edit in phase 1.** The upstream speech-to-text seam accepts out-of-tree providers today. Streaming recognition, text-to-speech, and the hands-free loop fit in new `@air/*` Service Definitions next to it, and Typert already supports bidirectional Remote streams (`RemoteStream<Out, In>` plus `ctx.invocation.uplink()`), so microphone frames can flow to the Host without a new transport.
- **The installed `sherpa-onnx-node` 1.13.8 already contains everything phase 1 needs**: offline and streaming ASR, Silero VAD, keyword spotting, and `OfflineTts` with Kokoro, Kitten, Matcha, VITS/Piper, ZipVoice, and Pocket configs. The Linux x64 native package is CPU-only (ONNX Runtime 1.28.2 without the CUDA provider library). With `qwen3:8b` resident in Ollama, CPU inference for STT/TTS is the right default anyway; GPU STT goes through a Wyoming sidecar later.
- **Transcripts and triggers enter as ordinary user messages with an AIR-declared source kind** (`MessageSourceMap` declaration merging, as `schedule` and `webhook` do). No AIR package appends a custom session event type. Playback truncation, trigger audit, and OS verify records go to tool results or AIR-owned JSONL files.
- **OS control works unprivileged from Node by shelling out to `busctl --json=short`, `wpctl`, and `gsettings`**, and the same calls also work inside the harness bwrap sandbox. GNOME 50 removed the screen interface from `org.gnome.SettingsDaemon.Power`; brightness goes through logind `SetBrightness` plus sysfs read-back.
- **Triggers can use the existing `ctx.webhookRuntime.dispatch()`** with an AIR provider kind; schedule's `create()` is a public Host method for cron routines. The AIR bundle must insert the `@deepseek-ai/dsh-webhook` row, which the Web composition does not mount.
- **Privileged commands cannot run inside the sandbox at all**: bwrap sets `NoNewPrivs: 1`, so `sudo` and `pkexec` fail there. The phase-1 handoff is `pkexec` (GNOME polkit dialog) or a `zenity` askpass helper, both run Host-side after approval; the Web sidebar terminal is an existing zero-code path.
- **Cheapest reliable Linux shell for the demo: Web UI + systemd user service + a GNOME custom shortcut opening a Chromium app window.** Electron on Linux is not an upstream release target, GNOME has no tray without an extension that is not installed, and Electron's Wayland global shortcut path is unverified on GNOME 50.

## 1. Speech-to-text seam as it exists

### 1.1 Service Definition `ctx.speechToText`

Package `@deepseek-ai/dsh-experimental-speech-to-text` (`packages/experimental/speech-to-text`). Types in `src/types.ts`, service in `src/index.ts`.

```ts
// src/types.ts
export type SpeechProviderId = Branded<'SpeechProviderId'>                  // :5
export interface SpeechProviderInfo {                                        // :16
  readonly id: SpeechProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  readonly languages: readonly string[]
  readonly setupEstimate?: SpeechSetupEstimate
  readonly downloadSources?: readonly string[]
}
export interface SpeechPreparation {                                         // :87
  snapshot(): SpeechPreparationState
  subscribe(listener: () => void): () => void
  prepare(options?: SpeechPreparationOptions): void
  cancel(): Promise<void>
}
export interface SpeechInput { readonly audio: Uint8Array; readonly language: string }          // :102
export interface Transcript { readonly text: string; readonly audioSeconds: number; readonly inferenceSeconds: number } // :108
export interface SpeechProvider {                                            // :115
  readonly info: SpeechProviderInfo
  readonly preparation?: SpeechPreparation
  transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript>
}
export interface SpeechRequest { readonly audio: Uint8Array; readonly providerId?: SpeechProviderId; readonly language?: string } // :128
export interface SpeechSpec extends SpeechInput { readonly provider: SpeechProvider }             // :135
```

```ts
// src/index.ts — class SpeechToText extends Service, key 'speechToText' (:15)
export interface Config { defaultProvider: Volatile<string>; language: Volatile<string> }         // :20
static Config = z.object({ defaultProvider: z.string().min(1).required().volatile(),
                           language: z.string().min(1).default('auto').volatile() })             // :36
register(provider: SpeechProvider): () => Promise<void>                                            // :63
listProviders(): readonly SpeechProviderInfo[]                                                     // :86
async *follow(caller: AbortSignal): AsyncIterable<SpeechSnapshot>                                  // :97
snapshot(): SpeechSnapshot                                                                         // :123
async configure(patch: SpeechSelectionPatch): Promise<void>                                        // :134
prepare(id: SpeechProviderId, options?: SpeechPreparationOptions): void                           // :158
async cancelPreparation(id: SpeechProviderId): Promise<void>                                       // :169
resolve(request: SpeechRequest): SpeechSpec                                                        // :180
async transcribe(spec: SpeechSpec, signal: AbortSignal): Promise<Transcript>                       // :192
```

Behavior that matters for AIR providers: duplicate ids throw; the disposer aborts and joins accepted work; `resolve()` throws when the provider is missing or its `languages` list lacks the requested hint, and the default hint is `'auto'`, so **every AIR provider must list `'auto'`** or the bundle must set `language`. No fallback provider is ever chosen. The package README's Known Limitations states "Only complete-recording transcription is supported."

### 1.2 Provider registration (SenseVoice reference)

`packages/experimental/speech-to-text-sensevoice/src/index.ts`: `export const inject = ['speechToText', 'subprocess']` (:13); `apply()` registers inside `ctx.effect()` (:27-41) with `ctx.speechToText.register({ info, preparation: worker, transcribe })` (:28) and casts the configured id with `config.providerId as SpeechProviderId`. Inference runs in a managed child process (`src/worker.ts`) that binds an authenticated loopback HTTP server (`src/process-server.ts`), started through `ctx.subprocess`. `src/inference.ts:39` `createTranscriber()` loads `sherpa.OfflineRecognizer` (:47) and `sherpa.Vad` (:48) and decodes Silero-VAD segments. Config (`src/config.ts`) covers `providerId`, `dataRoot`, `modelDirectory`, `vadModelPath`, `precision`, model origins, `threads`, VAD thresholds, timeouts, `idleTimeoutMs`, `maxPending`, byte limits. Assets are pinned by URL and sha256 in `runtime/assets.json`. Dependency: `"sherpa-onnx-node": "1.13.8"` exact.

**An out-of-tree provider is supported as is**: any plugin with `inject: ['speechToText']` can call `ctx.speechToText.register()`. The AIR bundle then sets `defaultProvider` on the `speech-to-text` row.

### 1.3 The speech Remote

`@deepseek-ai/dsh-experimental-api-speech-to-text`, class `SpeechController extends TypertRemoteService`, `namespace: 'speech'` (`src/index.ts:36`), `static inject = ['speechToText', 'typert']` (:29), Config `maxAudioBytes` (default 4 MiB) and `maxDurationSeconds` (default 120).

```ts
@Remote catalog(): SpeechCatalog                                                        // :44
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<SpeechCatalog> // :54
@Remote configure(patch: SpeechSelectionPatch): Promise<void>
@Remote prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): void
@Remote cancelPreparation(providerId: SpeechProviderId): Promise<void>
@Remote async transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<Transcript> // :89
// src/types.ts:15
export interface TranscriptionRequest { readonly audioBase64: string; readonly providerId?: SpeechProviderId; readonly language?: string }
```

Yes, complete recordings only: `transcribe()` validates canonical base64 and a 16 kHz mono PCM16 WAV, then calls the provider once. No Session event is written.

**Transport capability for streaming already exists.** `packages/typert/protocol/src/types.ts:93` `export type RemoteStream<Out, In = never> = AsyncIterable<Out> & { readonly [STREAM_UPLINK]?: In }`; the Host method reads uplink items through `RemoteInvocation.uplink<In = unknown>(): AsyncIterable<In>` (:420, reachable as `this.ctx.invocation.uplink()`); the generated Client method returns `RemoteStreamHandle<Out, In>` with `send(item)`, `end()`, `dispose()` (:106). Constraint from the protocol README (line 47): unary results may carry `Uint8Array`, but "Parameters, events, and stream items remain JSON-only", so uplink PCM frames travel as base64 strings (16 kHz PCM16 is 32 KB/s raw, about 43 KB/s encoded on loopback, acceptable).

### 1.4 Client plugin structure

`@deepseek-ai/dsh-experimental-client-ui-voice-input`: Host entry `src/index.ts` is an empty `apply()`; the browser entry (`./client` export) mounts the generated Remote with `ctx.remote.$mount(speechRemote)` (`src/client/mount.ts:60-65`), `inject = ['remote', 'slots', 'locale', 'pluginNavigation']` (:17), and registers `VoiceInput` in slot `conversation.input.activity` (:42) plus two bundle panels. Capture is `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` and `MediaRecorder` (`src/client/audio.ts:63,75`), resampled to 16 kHz and encoded by `encodeWave()`. The transcript is inserted into the draft through `InputActions.insertText()`; the user presses Send.

`InputActions` (`packages/client/ui-conversation/src/client/contract/input.ts:222`) also exposes `setDraft(text: string): void` (:233) and `submit(): void` (:241), so a session-scope slot component can submit programmatically. The bundle `voice-input-bundle/cordis.patch.yml` inserts four rows (`speech-to-text` with `defaultProvider: sensevoice-local`, `speech-to-text-sensevoice` with `dataRoot: !!js dshHomePath('speech-to-text', 'sensevoice')`, `api-speech-to-text`, `ui-voice-input`). Out-of-tree client code is supported: the client module registry scans Loader entries for packages that declare `dsh.client` (`docs/subsystems/client-modules.md`).

### 1.5 `sherpa-onnx-node` 1.13.8 as installed

Probe: `node_modules/.pnpm/sherpa-onnx-node@1.13.8`; `require('sherpa-onnx-node').version` → `1.13.8`, `onnxruntimeVersion` → `1.28.2`, build date 2026-09-10. Exports (`sherpa-onnx.js`): `OnlineRecognizer`, `OfflineRecognizer`, `OfflineTts`, `GenerationConfig`, `Vad`, `CircularBuffer`, `KeywordSpotter`, `SpokenLanguageIdentification`, speaker embedding and diarization classes, `AudioTagging`, `OfflinePunctuation`, `OnlinePunctuation`, `OfflineSpeechDenoiser`, `OnlineSpeechDenoiser`, `LinearResampler`, `readWave`, `writeWave`.

| Capability | API in the installed package | Notes |
|---|---|---|
| TTS | `OfflineTts` (`non-streaming-tts.js`): `static async createAsync(config)` (:54), `generate(obj)` (:68), `generateAsync(obj)` (:92) with `onProgress({ samples, progress })`; returning `0`/`false` stops generation | Model configs in `types.js`: `vits` (Piper voices), `matcha`, `kokoro` (:546: `model`, `voices`, `tokens`, `dataDir`, `lengthScale`, `lexicon`, `lang`), `kitten`, `zipvoice`, `pocket`. `TtsRequest` (:448) `{ text, sid, speed, generationConfig? }`; `GeneratedAudio` (:424) `{ samples: Float32Array, sampleRate }`. The progress callback gives chunked audio and cancellation. |
| Streaming ASR | `OnlineRecognizer` (`streaming-asr.js:95`): `createStream()`, `isReady()`, `decode()`, `isEndpoint(stream)` (:152), `reset()`, `getResult(stream)` (:169) | `OnlineModelConfig` (:356): `transducer`, `paraformer`, `zipformer2Ctc`, `nemoCtc`, `toneCtc`; `OnlineRecognizerConfig` (:382) has `enableEndpoint` and three endpoint rules, hotwords. |
| Offline ASR | `OfflineRecognizer` | `OfflineModelConfig` (:298) lists `transducer` (Parakeet TDT is a NeMo transducer), `nemoCtc`, `canary`, `whisper`, `moonshine`, `senseVoice`, `fireRedAsr`, and others. |
| VAD | `Vad` (`vad.js:72`): `acceptWaveform`, `isEmpty`, `isDetected()` (:97), `front`, `pop`, `flush`, `reset` | Silero model, as SenseVoice uses. |
| Keyword spotting | `KeywordSpotter` (`keyword-spotter.js:12`) with `KeywordSpotterConfig` (:705: `keywordsFile`, `keywordsScore`, `keywordsThreshold`) | Open-vocabulary Zipformer KWS; usable as the wake word without a second runtime. |

GPU: `sherpa-onnx-linux-x64@1.13.8` ships `libonnxruntime.so`, `libsherpa-onnx-c-api.so`, and `sherpa-onnx.node` (RUNPATH `$ORIGIN`) but no `libonnxruntime_providers_cuda.so`, so `provider: 'cuda'` is unavailable through npm. Upstream publishes separate CUDA 12 / cuDNN 9 C++ release archives; swapping them under the npm addon is unsupported. Decision: CPU for phase 1 (24 threads), GPU STT through a Python Wyoming sidecar in phase 2. `onnxruntime-node` is not installed, so openWakeWord and Pipecat Smart Turn would add a new native dependency; defer both.

### 1.6 What streaming and hands-free need

| Need | Present? | Plan |
|---|---|---|
| Frames from browser to Host | Transport yes (`RemoteStream` uplink); no speech method | New Remote method in `@air/dsh-api-voice` |
| Endpointing (VAD) on a live stream | sherpa `Vad`; not exposed by any service | New `ctx.speechStream` Service Definition |
| Partials | sherpa `OnlineRecognizer`; not exposed | Same Definition; providers declare `partials: boolean` |
| Auto-submit without the Send button | Client `InputActions.submit()`; Host `agent.followup()` | Host-side submission, section 3.3 |
| Speak the answer | No TTS | New `ctx.textToSpeech` seam |
| Barge-in | Browser AEC flags already set | Client stops playback on the stream's `speech-start` event |
| Wake word | sherpa `KeywordSpotter` | Phase 2 |

Keeping streaming in a separate AIR Definition, instead of adding methods to `SpeechToText`, removes the UPSTREAM-DELTA candidate "streaming methods on the speech-to-text Service Definition".

## 2. Text-to-speech seam design (mirrors speech-to-text)

### 2.1 `@air/dsh-text-to-speech` (Service Definition, `ctx.textToSpeech`)

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SpeechPreparation, SpeechSetupEstimate, SpeechPreparationOptions } from '@deepseek-ai/dsh-experimental-speech-to-text/types'

export type TtsProviderId = Branded<'TtsProviderId'>
export interface TtsVoice { readonly id: string; readonly name: string; readonly language: string }
export interface TtsProviderInfo {
  readonly id: TtsProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  readonly voices: readonly TtsVoice[]
  readonly sampleRate: number
  readonly setupEstimate?: SpeechSetupEstimate
  readonly downloadSources?: readonly string[]
}
export interface TtsInput { readonly text: string; readonly voice: string; readonly speed: number }
/** One ordered PCM chunk; `final` marks the last chunk of one input. */
export interface TtsChunk { readonly samples: Float32Array; readonly sampleRate: number; readonly final: boolean }
export interface TtsProvider {
  readonly info: TtsProviderInfo
  readonly preparation?: SpeechPreparation
  /** Synthesize one text; aborting stops generation and settles after native work stops. */
  synthesize(input: TtsInput, signal: AbortSignal): AsyncIterable<TtsChunk>
}
export interface TtsRequest { readonly text: string; readonly providerId?: TtsProviderId; readonly voice?: string; readonly speed?: number }
export interface TtsSpec extends TtsInput { readonly provider: TtsProvider }

export interface Config {
  defaultProvider: Volatile<string>   // required, like speechToText
  voice: Volatile<string>             // must be one of the provider's voices
  speed: Volatile<number>             // 0.5 to 2.0
  maxTextChars: number                // per synthesize() call, default 600
}
export default class TextToSpeech extends Service {
  register(provider: TtsProvider): () => Promise<void>
  listProviders(): readonly TtsProviderInfo[]
  follow(caller: AbortSignal): AsyncIterable<TtsSnapshot>
  snapshot(): TtsSnapshot
  configure(patch: TtsSelectionPatch): Promise<void>
  prepare(id: TtsProviderId, options?: SpeechPreparationOptions): void
  cancelPreparation(id: TtsProviderId): Promise<void>
  resolve(request: TtsRequest): TtsSpec
  synthesize(spec: TtsSpec, signal: AbortSignal): AsyncIterable<TtsChunk>
}
```

Same rules as upstream: duplicate ids throw, disposer aborts and joins, `resolve()` fails loud on a missing provider or unknown voice, no fallback. Reusing `SpeechPreparation` keeps one preparation UI vocabulary.

### 2.2 `@air/dsh-text-to-speech-kokoro` (Service Provider)

`OfflineTts` with `model.kokoro` in a managed child process modeled on `speech-to-text-sensevoice` (subprocess + authenticated loopback server, idle reclamation, serial queue). `generateAsync({ text, sid, speed, onProgress })` streams chunks; the child returns `0` from `onProgress` when the request is aborted. Copy native buffers before crossing threads (the SenseVoice comment about Electron's V8 memory cage applies). Config: `providerId` (default `kokoro-local`), `dataRoot` (absolute, required), `modelDirectory?`, `modelVariant` (`'multi-lang-v1_0' | 'en-v0_19'`), `modelOrigins`, `threads`, `maxNumSentences`, `prepareTimeoutMs`, `synthesisTimeoutMs`, `idleTimeoutMs`, `maxPending`, `graceMs`, `maxLogBytes`. Assets pinned by sha256 in a `runtime/assets.json` like SenseVoice; sizes and hashes are recorded when pinned. Kokoro outputs 24 kHz. License: Kokoro-82M is Apache-2.0; Piper voices through sherpa are data files, not GPL code.

### 2.3 Remote and client playback

`@air/dsh-api-voice`, `class VoiceController extends TypertRemoteService`, `namespace: 'voice'`, `inject = ['textToSpeech', 'speechStream', 'speechToText', 'typert', 'sessionController']`:

```ts
@Remote ttsCatalog(): TtsCatalog
/** One sentence or clause; unary so the result can be bytes (WAV PCM16). */
@Remote async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<Uint8Array>
```

Sentence-level unary calls are chosen over a stream because unary results carry `Uint8Array` directly, cancellation is per call, and the client can keep one or two sentences in flight. The client decodes with `AudioContext.decodeAudioData` and schedules `AudioBufferSourceNode`s back to back.

**Barge-in**: while audio plays, the microphone stream (section 3) keeps running with `echoCancellation: true`. On a `speech-start` event that survives a minimum-duration gate (Config `bargeInMinSpeechMs`, default 250), the client stops every scheduled source, aborts pending `synthesize()` calls, and drops the queued text. The model context is unaffected: the full answer is already in `assistant/message`. What the user actually heard is recorded in the AIR voice log file (section 3.4), not in the Session log.

## 3. Hands-free loop

### 3.1 `@air/dsh-speech-stream` (Service Definition, `ctx.speechStream`)

```ts
export type SpeechStreamProviderId = Branded<'SpeechStreamProviderId'>
export interface SpeechStreamProviderInfo {
  readonly id: SpeechStreamProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  readonly languages: readonly string[]
  readonly features: { readonly partials: boolean; readonly keywords: boolean }
}
export type SpeechStreamEvent =
  | { readonly type: 'speech-start'; readonly atMs: number }
  | { readonly type: 'partial'; readonly text: string }
  | { readonly type: 'speech-end'; readonly atMs: number }
  | { readonly type: 'final'; readonly text: string; readonly audioSeconds: number; readonly inferenceSeconds: number }
  | { readonly type: 'keyword'; readonly keyword: string; readonly atMs: number }
export interface SpeechStreamOptions { readonly language: string; readonly keywords?: readonly string[] }
export interface SpeechStream {
  /** 16 kHz mono PCM16 frames in capture order. */
  push(pcm: Int16Array): void
  end(): void
  readonly events: AsyncIterable<SpeechStreamEvent>
}
export interface SpeechStreamProvider {
  readonly info: SpeechStreamProviderInfo
  readonly preparation?: SpeechPreparation
  open(options: SpeechStreamOptions, signal: AbortSignal): SpeechStream
}
export interface Config { defaultProvider: Volatile<string>; language: Volatile<string>; maxStreamSeconds: number }
// Service: register / listProviders / follow / snapshot / configure / prepare / cancelPreparation,
// resolve(request: SpeechStreamRequest): SpeechStreamSpec, open(spec, signal): SpeechStream
```

### 3.2 `@air/dsh-speech-sherpa` (Service Provider for both STT Definitions)

One child process, two registrations:

- `ctx.speechToText.register()` for complete recordings with a selectable offline model: Parakeet TDT 0.6B v3 INT8 (`transducer` config, NeMo transducer model type as in the upstream sherpa Node examples; verify), Moonshine, or Whisper small.
- `ctx.speechStream.register()` with either VAD-segmented offline decoding (Parakeet: `speech-start`, `speech-end`, `final`, no partials) or a true streaming Zipformer `OnlineRecognizer` with endpoint rules (`partials: true`).
- Optional `KeywordSpotter` for the wake phrase (phase 2).

Config: `providerId`, `dataRoot`, `model` (`'parakeet-tdt-0.6b-v3-int8' | 'zipformer-streaming-en' | 'moonshine-base' | 'whisper-small'`), `modelDirectory?`, `vadModelPath?`, `kwsModelDirectory?`, `keywords: string[]`, `threads`, `vadThreshold`, `minSilenceSeconds`, `minSpeechSeconds`, `maxSpeechSeconds`, `languages`, `prepareTimeoutMs`, `inferenceTimeoutMs`, `idleTimeoutMs`, `maxPending`, `graceMs`, `maxLogBytes`. Pin `sherpa-onnx-node` to the exact upstream version so one native binary is shared. `languages` must include `'auto'`.

### 3.3 Loop mechanics and message entry

Remote method on `VoiceController`:

```ts
/** Open one listening stream bound to a Session; uplink carries base64 PCM16 frames. */
@Remote({ mode: 'stream' })
listen(request: ListenRequest, signal: AbortSignal): RemoteStream<ListenEvent, ListenUplink>
// ListenRequest = { sessionId: SessionId; providerId?: SpeechStreamProviderId; language?: string; autoSubmit: boolean }
// ListenUplink  = { pcmBase64: string } | { control: 'mute' | 'unmute' }
// ListenEvent   = SpeechStreamEvent | { type: 'submitted'; messageId: string } | { type: 'speak'; text: string; messageId: string }
```

Flow: the client opens `listen()` and sends 20 to 40 ms frames from an `AudioWorklet`. The Host decodes each uplink item, pushes it to the provider stream, and forwards events. On `final` with `autoSubmit`, the Host resolves the Agent with `ctx.sessionController.resolveAgent(sessionId)` and calls `agent.followup(message)` (`packages/core/agent/src/runtime-types.ts:222`) with a message built by `createUserMessage()` (`packages/llm/llm/src/message.ts:246`) whose source is an AIR-declared kind:

```ts
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'air-voice': { readonly kind: 'air-voice'; readonly provider: string; readonly language: string; readonly audioSeconds: number }
  }
}
```

This is the same pattern schedule uses for due reminders (`packages/schedule/schedule/src/runtime.ts:101-123`: `resolveAgent`, `createUserMessage({ content, source: { kind: 'schedule' } })`, `agent.followup(message)`). `MessageSourceMap` (`message.ts:110`) is documented as merge-extensible with consumers falling through unknown kinds, so the transcript is an ordinary, logged, model-visible user message and no custom session event type is needed. Verify during implementation that the Web conversation view renders an unknown user source kind as a normal user row, and that the persistence reader accepts it; if not, fall back to the client path `InputActions.setDraft(text)` then `submit()` (source `user`), which loses only the voice tag.

For speaking, the Host observes `'session/event'` (`packages/core/session/src/index.ts:77`) for the listened Session and, on `assistant/message` (`packages/core/session/src/types.ts:341`, payload `{ turn, step, message, stream, usage?, interrupted? }`), emits `{ type: 'speak', text }` with the text parts only (no reasoning, no tool calls). Phase 2 can start earlier from `'agent/assistant-stream'` (`runtime-types.ts:363`) sentence by sentence to cut time to first audio.

### 3.4 AIR-owned voice log

Because out-of-tree plugins cannot append custom session event types, `@air/dsh-api-voice` appends JSONL records to `dshHomePath('air', 'voice', '<sessionId>.jsonl')`: stage timestamps (speech-end, final, submitted, first audio), provider ids, barge-in truncation (message id, characters played, played milliseconds). No audio, no transcript text beyond what is already in the Session log. Config: `logDirectory`, `logRetentionDays`. This file feeds the RQ5 latency numbers.

### 3.5 Client `@air/dsh-client-ui-voice-loop`

A hands-free toggle next to the upstream microphone (slot `conversation.input.activity`; verify the slot accepts a second contribution, otherwise use a composer header slot or the bundle panel), a persistent listening indicator, live partial captions, `AudioWorklet` capture at 16 kHz, playback queue, barge-in. Copy through typed locale dictionaries. Push-to-talk stays the default; hands-free is an explicit toggle per Session and stops on page hide.

### 3.6 Wyoming provider (phase 2)

`@air/dsh-speech-wyoming`: registers with `ctx.speechToText` (and later `ctx.textToSpeech`) and speaks the Wyoming TCP protocol (`transcribe`, `audio-start`, `audio-chunk`, `audio-stop` → `transcript`). Config: `providerId`, `host`, `port`, `languages`, `location`, `connectTimeoutMs`, `requestTimeoutMs`. Enables `wyoming-faster-whisper` on CUDA as a user-run sidecar (no Python packages are installed now; Python 3.14.7 is present). Supervision through `ctx.subprocess` comes later.

## 4. OS control on Fedora GNOME Wayland

### 4.1 Probe results

Tools present: `wpctl`, `pactl`, `gdbus`, `busctl`, `dbus-send`, `bluetoothctl`, `gsettings`, `notify-send`, `nmcli`, `pkexec`, `gio`, `gtk-launch`, `upower`, `loginctl`, `systemd-ask-password`, `zenity`, `xdg-open`, `pw-record`, `parec`. Missing: `playerctl`, `brightnessctl`, `kdialog`, `ssh-askpass`.

| Capability | Probe (read-only) | Result |
|---|---|---|
| Volume | `wpctl get-volume @DEFAULT_AUDIO_SINK@` | `Volume: 0.99` |
| Battery | `busctl get-property org.freedesktop.UPower /org/freedesktop/UPower/devices/DisplayDevice org.freedesktop.UPower.Device Percentage State` | `d 70`, `u 2` (discharging) |
| Network | NetworkManager `State WirelessEnabled Connectivity` | `u 70`, `b true`, `u 4` (full) |
| Bluetooth | `org.bluez /org/bluez/hci0 Adapter1.Powered` | `b true` |
| Notifications | `org.freedesktop.Notifications.GetServerInformation` / `GetCapabilities` | `gnome-shell GNOME 50.5 1.2`; `actions body body-markup icon-static persistence sound` |
| Wallpaper / theme | `gsettings get org.gnome.desktop.background picture-uri-dark`, `org.gnome.desktop.interface color-scheme` | readable; `prefer-dark` |
| Media | user bus names `org.mpris.MediaPlayer2.*` | none registered at probe time (no player active) |
| Backlight | `/sys/class/backlight/nvidia_wmi_ec_backlight` | `35/100`, type `firmware`, file owned by root (write needs logind) |
| logind | `org.freedesktop.login1 /org/freedesktop/login1/session/auto` | `Active b true`; `SetBrightness ssu`, `Lock`, `SetIdleHint` present; `session/auto` resolves even from a process under `user@1000.service` |
| GNOME brightness | `org.gnome.SettingsDaemon.Power` | only `Power.Keyboard` (keyboard backlight); no screen interface in GNOME 50 |
| GNOME Shell brightness | `org.gnome.Shell.Brightness` | `SetAutoBrightnessTarget(d)`, `SetDimming(b)`, `HasBrightnessControl` only; no absolute setter |
| JSON output | `busctl --json=short get-property ...` | `{"type":"d","data":7.0e+01}` |
| Signals | `busctl --system monitor` | `BecomeMonitor failed: Access denied`; `gdbus monitor --system --dest org.freedesktop.UPower` runs unprivileged (AddMatch); `busctl --user monitor` runs |
| Portals | `org.freedesktop.portal.Desktop` | `GlobalShortcuts`, `RemoteDesktop`, `ScreenCast`, `Screenshot`, `Wallpaper`, `Notification`, `Registry` (xdg-desktop-portal 1.22.1, portal-gnome 50.0) |

**Sandbox interaction (tested).** The harness bwrap profile (`packages/sandbox/sandbox-local/src/profiles.ts:17`: `--ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent`) was reproduced by hand. Inside it: `busctl --user` calls to Notifications succeed, `busctl` on the system bus reads logind `session/auto` as active, `wpctl get-volume` works (PipeWire socket reachable), `gsettings get` works but prints `dconf-CRITICAL ... unable to create file '/run/user/1000/dconf/user': Read-only file system` (writes untested), `ps -e` shows 5 processes (PID namespace hides the Host). No network namespace is created, so bus sockets stay reachable. D-Bus peer credentials are translated by the kernel, so logind still sees the real PID. Conclusion: the OS provider does not need the bash sandbox, and model-issued `busctl` through `bash` would also work, which is a policy concern (section 4.4).

### 4.2 D-Bus library choice

| Option | Status (web lookup 2026-09-29) | Verdict |
|---|---|---|
| `dbus-next` | 0.10.2, last npm publish about five years ago | Do not adopt |
| `@particle/dbus-next`, `@holusion/dbus-next` forks | 0.11.x, published within the last year | Candidate for phase 2 |
| `@homebridge/dbus-native` | 0.7.1, published in September 2026, about 25k weekly downloads | Candidate for phase 2 signal subscriptions |
| `busctl --json=short` / `gdbus` via `ctx.subprocess` | system tools, no dependency | Phase 1 for calls and property reads |
| `gdbus monitor` line stream | unprivileged on system bus | Phase 1 for signals (text parsing) |

### 4.3 Packages

**`@air/dsh-os-control`** (Service Definition, `ctx.osControl`). Capabilities are a merge-extensible map so providers add kinds without editing the Definition:

```ts
export interface OsCapabilityMap {
  'audio.output': { state: { volume: number; muted: boolean }; desired: { volume?: number; muted?: boolean } }
  'display.brightness': { state: { percent: number }; desired: { percent: number } }
  'power.battery': { state: { percent: number; state: 'charging' | 'discharging' | 'full' | 'unknown' }; desired: never }
  'media.player': { state: { player?: string; status: 'playing' | 'paused' | 'stopped'; title?: string }; desired: { action: 'play' | 'pause' | 'next' | 'previous' } }
  'notifications.post': { state: never; desired: { summary: string; body: string } }
  'apps.launch': { state: never; desired: { appId: string } }
  'desktop.wallpaper': { state: { uri: string; uriDark: string }; desired: { uri: string } }
  'network.wifi': { state: { enabled: boolean; connectivity: string }; desired: { enabled: boolean } }
  'bluetooth.device': { state: { powered: boolean; connected: readonly string[] }; desired: { address: string; connected: boolean } }
}
export type RiskTier = 0 | 1 | 2 | 3
export interface OsCapability<K extends keyof OsCapabilityMap> {
  readonly id: K
  readonly setTier: RiskTier            // declared by the provider, never by the model
  readonly reversible: boolean
  read(signal: AbortSignal): Promise<OsCapabilityMap[K]['state']>
  set(desired: OsCapabilityMap[K]['desired'], signal: AbortSignal): Promise<void>
  verify(desired: OsCapabilityMap[K]['desired'], observed: OsCapabilityMap[K]['state']): boolean
}
export interface OsSetResult<K extends keyof OsCapabilityMap> {
  readonly requested: OsCapabilityMap[K]['desired']
  readonly before: OsCapabilityMap[K]['state'] | undefined
  readonly after: OsCapabilityMap[K]['state'] | undefined
  readonly verified: boolean
  readonly attempts: number
}
// Service: register(capability): () => Promise<void>; list(); read(id, signal); apply(id, desired, signal): Promise<OsSetResult>
export interface Config { verifyPollMs: number; verifyTimeoutMs: number }
```

**`@air/dsh-os-control-linux`** (Service Provider). Runs commands through `ctx.subprocess` in the Host (not through `ctx.shell`). Backends: `wpctl` for audio; logind `Session.SetBrightness("backlight", <device>, <raw>)` via `busctl call` plus sysfs read-back; MPRIS via `busctl --user` on `org.mpris.MediaPlayer2.*`; UPower; NetworkManager (`nmcli radio wifi` for set); BlueZ `Device1.Connect` with bounded polling of `Connected`; `org.freedesktop.Notifications.Notify`; `gtk-launch`; `gsettings set` for both `picture-uri` and `picture-uri-dark`. Config: `desktop: 'gnome'` (explicit, fails at load when `XDG_CURRENT_DESKTOP` disagrees), `backlightDevice?` (default: the single entry under `/sys/class/backlight`, load fails if several), tool paths (`busctlPath`, `wpctlPath`, `gsettingsPath`, `nmcliPath`), `commandTimeoutMs`, `capabilities: string[]` (enabled set). Safety invariants stay fixed in code: brightness never below 5 percent, volume clamped to 0 to 1.0 (no over-amplification).

**`@air/dsh-tool-os-control`** (Consumer). Tools `os_get_state({ capability })`, `os_set_state({ capability, value })`, `media_control({ action })`, `app_launch({ app_id })`, registered with `ctx.tools.register(defineTool(...))`. Tier 0 reads run without asking; tier 1 runs and records the undo value in the tool result; tier 2 asks through `ApprovalService.request(req: ApprovalRequest): Promise<ApprovalOutcome>` (`packages/interaction/user-approval/src/index.ts:215`); tier 3 is not offered by this tool. Config: `autoAllowTier: 0 | 1` (default 1). Verify data (`before`, `after`, `verified`, `attempts`) is the tool result value, so it is logged by the existing `tool/result` event with no custom event.

### 4.4 Policy note

Because model-issued `busctl`/`gdbus` inside the sandbox reach the same buses, a `tools/pre-execute` listener (`packages/core/tools/src/index.ts:153`) in `@air/dsh-tool-os-control` should mark bash commands that call `busctl`, `gdbus`, `dbus-send`, `nmcli`, `bluetoothctl`, or `gsettings set` as `ask`, pointing the model at the typed tools.

## 5. Signals, triggers, and routines

### 5.1 Current APIs

**Schedule** (`@deepseek-ai/dsh-schedule` 0.2.0-rc.2). `ScheduleService extends TypertRemoteService`, `static inject = ['agents', 'sessions', 'tools', 'storageDomain', 'sessionController', 'sessionPersistence']`. Public Host method, callable by another plugin:

```ts
// packages/schedule/schedule/src/index.ts:249
async create(sessionId: SessionId, request: ScheduleCreateRequest, signal?: AbortSignal): Promise<ScheduleRecord>
// src/types.ts:363
export interface ScheduleCreateRequest {
  prompt: string; title: string
  after_seconds?: number; at?: AtInput; every_seconds?: number
  daily?: DailyInput; weekly?: WeeklyInput; cron?: CronInput     // exactly one selector
}
export interface CronInput { readonly expression: string; readonly time_zone: string }  // five-field Vixie cron, explicit IANA zone
```

Config: `deliveryHistoryDays` (30), `deliveryHistoryRecords` (200). Delivery restores a cold Session and appends a user message with source kind `schedule` through `agent.followup()` (`runtime.ts:101-123`); in rc.2 due reminders are framed as scheduled user messages. A task is always bound to one existing Session. The schedule row ships in the optional `@deepseek-ai/dsh-experimental-schedule-bundle`, not the Web composition; it requires the Web Session controller and a persistence backend.

**Webhook runtime** (`@deepseek-ai/dsh-webhook`). `WebhookRuntime extends Service`, key `webhookRuntime`, `static inject = ['agents', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry']` (`src/index.ts:59-66`).

```ts
register<K extends string>(rule: WebhookRule<K>): () => Promise<void>        // index.ts:89
dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void        // index.ts:126, fire-and-forget
// src/types.ts
export interface VerifiedWebhookDelivery<K extends string = string> {         // :14
  readonly kind: K; readonly source: WebhookSourceId; readonly deliveryId: WebhookDeliveryId
  readonly event: WebhookEventOf<K>   // JsonValue for kinds not in WebhookEventMap
  readonly receivedAt: number
}
export interface WebhookSessionRequest {                                      // :38
  readonly workspacePath: string; readonly title: string; readonly prompt: string
  readonly agentPreset: string; readonly permissionPreset: string; readonly model?: WebhookModelSelection
}
export interface WebhookRule<K extends string = string> {                     // :54
  readonly id: WebhookRuleId; readonly kind: K
  run(delivery: Readonly<VerifiedWebhookDelivery<K>>, signal: AbortSignal): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}
```

`createWebhookSession()` (`src/session.ts:117`) resolves the permission and agent presets, creates the workspace, mounts the preset, applies the permission preset, renames the Session, and admits the prompt with source `{ kind: 'webhook', provider, source, deliveryId, ruleId, form: 'notice', summary }`. The runtime is provider-neutral and in-process: **a local signals plugin can call `dispatch()` directly with `kind: 'air-signal'`**; no HTTP ingress is involved. The row is only composed in CLI examples (`apps/cli/config/examples/github-review/cordis.yml`), so the AIR bundle must insert it; confirm the injected services exist in the Web profile with `pnpm dsh --profile air --dump-config`.

**File watching.** `ctx.fs.watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>` (`packages/fs/fs/src/index.ts:100`) observes one file or a directory's direct entries and reports invalidation only (no path). `chokidar` 4 and 5 are already workspace dependencies (`fs-local`, `hmr`, `credentials-local`, `skill-filesystem`); an AIR provider that needs "which file appeared" can depend on `chokidar` 4 directly.

### 5.2 Packages

**`@air/dsh-signals`** (Service Definition, `ctx.signals`): `register(source: SignalSource): () => Promise<void>`, `subscribe(filter: SignalFilter, listener: (record: SignalRecord) => void): () => void`, `SignalRecord { id: SignalId; source: string; kind: string; subject: string; at: number; data: JsonValue }` with `SignalId = Branded<'SignalId'>`. Config: `maxRecordsPerMinute`.

**`@air/dsh-signals-linux`** (Service Provider): UPower battery and AC (`gdbus monitor --system --dest org.freedesktop.UPower`), NetworkManager connectivity, logind `Lock`/`Unlock` for the active session, file watch on configured directories (`chokidar`), MPRIS track change later. Config: `sources` (enabled list), `watchDirectories: string[]` (absolute, fail at load if missing), `watchGlobs`, `debounceMs`, `batteryLowPercent`.

**`@air/dsh-routines`** (Consumer of signals, schedule, and webhook runtime). Loads Markdown routine files and wires each to its trigger:

```md
---
id: morning-briefing
title: Morning briefing
trigger:
  cron: { expression: "30 8 * * 1-5", time_zone: Europe/London }
agent_preset: assistant
permission_preset: read-only
delivery: inbox          # inbox | notify | speak
---
Summarize today's calendar, battery level, and pending jobs in five bullet points.
```

```md
---
id: new-pdf
title: File new PDFs
trigger:
  signal: { source: file, kind: created, glob: "~/Downloads/*.pdf" }
  cooldown: 10m
  quiet_hours: "22:00-07:00"
agent_preset: assistant
permission_preset: read-only
workspace: ~/Downloads
---
A new PDF arrived: {{subject}}. Summarize it and propose a folder; do not move it without asking.
```

- Signal triggers: one `WebhookRule<'air-signal'>` per routine registered with `ctx.webhookRuntime.register()`; the routines plugin evaluates conditions, cooldown, quiet hours, and a daily budget, then calls `dispatch({ kind: 'air-signal', source, deliveryId, event, receivedAt })`. The rule returns the `WebhookSessionRequest`. The created Session carries the webhook source kind with `ruleId` and `deliveryId`, which is the audit trail; no custom event.
- Time triggers: at load, the plugin ensures one dedicated "Routines" Session per routine (created once through the same webhook path, id stored in an AIR file) and calls `ctx.schedule.create(sessionId, { title, prompt, cron })`; schedule owns durability and cold-session restore.
- Delivery `notify` posts through `ctx.osControl` (`notifications.post`); `speak` routes to TTS only when a voice client is connected.
- AIR audit file: `dshHomePath('air', 'routines', 'fired.jsonl')` (routine id, signal id, decision, reason when suppressed).
- Config: `routineDirectories: string[]` (default `dshHomePath('air', 'routines')`), `dailyBudget`, `defaultCooldownMs`, `defaultPermissionPreset` (a restricted preset; tiers 0 to 1 only), `defaultAgentPreset`. Invalid front matter fails the plugin load with the file path.

## 6. Secret handoff

### 6.1 Current behavior

- `ShellExecRequest` (`packages/shell/shell/src/types.ts:61`) has `stdin?: string` (:85) and `env?: Record<string, string>` (:93), set only by in-process plugins; the model-facing `bash` tool exposes neither. `ShellExecutor.resolve(request: ShellExecRequest): ShellExecSpec` (`index.ts:84`), `execute(spec: ShellExecSpec): Promise<ShellExecution>` (:93). `sandboxPolicy?: SandboxExecutionPolicy` selects `mode: 'read-only' | 'workspace-write' | 'danger-full-access'` (`packages/sandbox/sandbox/src/index.ts:30,40`).
- No package in `packages/shell` or `packages/terminal` handles `sudo`, password prompts, or `SUDO_ASKPASS`.
- **Inside the bwrap sandbox, privilege elevation is impossible**: probe `grep NoNewPrivs /proc/self/status` → `1`; `sudo -n true` → `The "no new privileges" flag is set, which prevents sudo from running as root.` The same applies to `pkexec` (setuid). The persistent terminal backend (`terminal-bash`) runs under the same sandbox policy. Privileged commands therefore need `danger-full-access` (an approved escalation) or a Host-side runner.
- Outside the sandbox with no TTY: `setsid sudo -A true` → `sudo: no askpass program specified, try setting SUDO_ASKPASS`. sudo 1.9.17p2.
- The Web sidebar terminal (`packages/api/terminal-controller`, `src/index.ts:151` "Allocate a user shell ... without Agent sandbox or approval restrictions") keeps output outside the Agent transcript. The user can already run `sudo` there; this is the zero-code fallback.

### 6.2 polkit on this machine

- `pkaction --action-id org.freedesktop.policykit.exec`: implicit active `auth_admin` → `pkexec` shows the GNOME Shell polkit dialog.
- `pkcheck --process $$` from a process under `user@1000.service/app.slice`: `org.freedesktop.packagekit.system-update` → `yes`; `policykit.exec` → `auth_admin` challenge. polkit resolves such processes to the active session, so the dialog reaches GNOME Shell's agent (dialog display not triggered in this spike).
- Consequence for demo 9 in note 06: a PackageKit system update needs **no password** on Fedora for the active user, so it does not demonstrate secret handoff. Use `pkexec` for the tier-3 demo, or a dnf5daemon action (`org.rpm.dnf.v0.rpm.execute_transaction`).

### 6.3 Packages

**`@air/dsh-secret-prompt`** (Service Definition, `ctx.secretPrompt`): `request(req: SecretPromptRequest, signal: AbortSignal): Promise<SecretPromptOutcome>` where the outcome never contains the secret for callers other than the askpass socket; providers `polkit`, `askpass-zenity`, `askpass-web`. Config: `provider`, `timeoutMs`, `socketDirectory` (default `$XDG_RUNTIME_DIR/air`).

**`@air/dsh-tool-privileged`** (Consumer): tool `privileged_run({ command, justification })`, tier 3: always `ApprovalService.request()` with the exact command, then Host-side execution with `sandboxPolicy.mode: 'danger-full-access'` via `ctx.shell.resolve()`/`execute()`:

- `pkexec` path (preferred): runs `pkexec /usr/bin/env -- <argv>`; the password goes to GNOME Shell's polkit dialog.
- askpass path: `env: { SUDO_ASKPASS: <helper> }` and `sudo -A -p "AIR requests root for: <command>. Password: " <argv>`. Phase-1 helper is a two-line script around `zenity --password --title "AIR"` (zenity is installed); phase-2 helper connects to a 0600 Unix socket and the Web client shows the prompt.
- A `tools/pre-execute` listener rejects `bash` commands containing `sudo` without `-A`, `sudo -S`, here-strings piped into sudo, and `pkexec` under a confined mode, with a model-visible hint to call `privileged_run`.
- Logged: the tool call, approval outcome, exit status, and output (the tool result). Never logged: the password, which travels dialog → sudo or polkit only.

**Web secure prompt (phase 2).** Remote namespace `secret`: `@Remote({ mode: 'stream' }) requests(signal): AsyncIterable<SecretPromptView>` and `@Remote answer(id: SecretPromptId, secret: string): Promise<void>`, answered directly into the askpass socket and zeroed. Risk: `RemoteInvocation.request.args` (`packages/typert/protocol/src/types.ts:397-400`) exposes call arguments to in-process code, so audit every Host plugin that could record Remote arguments (the AIR bundle already disables `session-telemetry-otel`). The password field uses `autocomplete="off"` and is never placed in the draft or a slot state store.

## 7. Desktop shell on Linux

### 7.1 Electron app facts

- Electron `^44.0.0` (`apps/desktop/package.json:63`); lockfile resolves `electron@44.0.0`. Electron is not in `allowBuilds` in `pnpm-workspace.yaml`, so its postinstall does not run; the first `require('electron')` downloads the binary. That happened during this spike: `node_modules/.pnpm/electron@44.0.0/node_modules/electron/dist` now holds the 44.0.0 binary (282 MB, ignored by git).
- `scripts/dev.ts:79-91`: macOS gets a prepared `.app`; every other platform runs the Electron binary directly with inspector ports and `--user-data-dir`, so the Linux dev path exists in code. It was not launched in this spike.
- Tray: `apps/desktop/src/tray.ts:18` `class DesktopTray`, constructed only under `process.platform === 'win32'` (`main.ts:985`) with an ICO icon. Mandatory-update policy throws `desktop policy: unsupported platform` on Linux only when a policy config is present (`main.ts:1297`).
- GNOME tray: Electron's Linux `Tray` uses StatusNotifierItem; GNOME shows it only with the AppIndicator extension. `rpm -q gnome-shell-extension-appindicator` → not installed; it is not among the nine enabled extensions.
- Global shortcuts on Wayland: the portal `org.freedesktop.portal.GlobalShortcuts` exists here (xdg-desktop-portal 1.22.1). Electron needs `--ozone-platform=wayland --enable-features=GlobalShortcutsPortal` (Chromium honors only the last `--enable-features`). xdg-desktop-portal 1.20+ requires a non-sandboxed app to call `org.freedesktop.host.portal.Registry.Register(app_id)` with a reverse-DNS id backed by an installed `.desktop` file; Electron 40.6.1 to 42.3.3 failed this (electron/electron issue 51875, closed as blocked upstream). A third-party packaging note reports the fix in the Electron 44 line and GNOME 50 as "expected to work now but is unverified"; whether 44.0.0 includes it is unconfirmed. GNOME shows a one-time consent dialog.

### 7.2 Recommended phase-1 path

1. Run the Host as a systemd user service: `pnpm dsh --profile air web --no-open` with a fixed port (`@deepseek-ai/dsh-host-webserver` Config `host: '127.0.0.1'`, `port: <fixed>`). Triggers and schedules keep running when no window is open; this replaces the "resident tray agent".
2. Quick entry: a GNOME custom keyboard shortcut (Settings → Keyboard → Custom Shortcuts; one custom binding already exists, `custom0`) running `chromium-browser --app=http://127.0.0.1:<port>/?air=quick`. `chromium-browser` and `firefox` are installed; `--app` gives a chromeless window. The Web index requires the process token once, then a persistent browser cookie (`packages/host/frontend-static/README.md`), so the first launch per browser profile uses the tokened URL printed by `dsh web`.
3. `@air/dsh-client-quick-entry` (client plugin): on `?air=quick`, open a new Session in the default workspace, focus the composer, and optionally arm hands-free voice. Config: `defaultWorkspace`, `armVoice: boolean`.
4. OS notifications from the Host through `ctx.osControl` `notifications.post`.

Creating the GNOME shortcut and the systemd unit are persistent user configuration changes; the setup doc gives the commands and the user runs them.

Phase 2 (only if the Electron shell becomes a goal): a new `apps/desktop/src/tray-linux.ts` plus a platform condition at `main.ts:985`, and a portal-backed global shortcut with a shipped `.desktop` file. Both are upstream edits to be listed in `air/UPSTREAM-DELTA.md`.

## 8. Package list

| Package | Role | Key Config fields |
|---|---|---|
| `@air/dsh-speech-stream` | Service Definition `ctx.speechStream` | `defaultProvider`, `language`, `maxStreamSeconds` |
| `@air/dsh-speech-sherpa` | Provider for `speechToText` and `speechStream` | `providerId`, `dataRoot`, `model`, `modelDirectory`, `vadModelPath`, `kwsModelDirectory`, `keywords`, `threads`, VAD fields, `languages`, timeouts, `idleTimeoutMs`, `maxPending` |
| `@air/dsh-text-to-speech` | Service Definition `ctx.textToSpeech` | `defaultProvider`, `voice`, `speed`, `maxTextChars` |
| `@air/dsh-text-to-speech-kokoro` | Provider (sherpa `OfflineTts`) | `providerId`, `dataRoot`, `modelVariant`, `modelDirectory`, `modelOrigins`, `threads`, timeouts, `idleTimeoutMs`, `maxPending` |
| `@air/dsh-api-voice` | Remote `voice` (listen, synthesize, TTS catalog) and voice log | `bargeInMinSpeechMs`, `maxFrameBytes`, `logDirectory`, `logRetentionDays` |
| `@air/dsh-client-ui-voice-loop` | Client: hands-free toggle, captions, playback, barge-in | none beyond locale |
| `@air/dsh-speech-wyoming` (phase 2) | Provider over Wyoming TCP | `providerId`, `host`, `port`, `languages`, timeouts |
| `@air/dsh-voice-bundle` | Patch: upstream voice rows + AIR rows, default providers | n/a |
| `@air/dsh-os-control` | Service Definition `ctx.osControl` | `verifyPollMs`, `verifyTimeoutMs` |
| `@air/dsh-os-control-linux` | Provider (busctl, wpctl, gsettings, nmcli, sysfs) | `desktop`, `backlightDevice`, tool paths, `commandTimeoutMs`, `capabilities` |
| `@air/dsh-tool-os-control` | Consumer tools + bash pre-execute policy | `autoAllowTier` |
| `@air/dsh-signals` | Service Definition `ctx.signals` | `maxRecordsPerMinute` |
| `@air/dsh-signals-linux` | Provider (UPower, NM, logind, files) | `sources`, `watchDirectories`, `watchGlobs`, `debounceMs`, `batteryLowPercent` |
| `@air/dsh-routines` | Consumer: Markdown routines on schedule and webhook runtime | `routineDirectories`, `dailyBudget`, `defaultCooldownMs`, `defaultAgentPreset`, `defaultPermissionPreset` |
| `@air/dsh-secret-prompt` | Service Definition + polkit/zenity providers | `provider`, `timeoutMs`, `socketDirectory` |
| `@air/dsh-tool-privileged` | Consumer tool + sudo pre-execute policy | `method: 'pkexec' \| 'askpass'`, `askpassPath` |
| `@air/dsh-client-quick-entry` | Client: `?air=quick` entry | `defaultWorkspace`, `armVoice` |

AIR bundle additions: insert `@deepseek-ai/dsh-webhook`, the schedule bundle rows (or list `@deepseek-ai/dsh-experimental-schedule-bundle` in the profile), the upstream voice rows, and the AIR rows; fix `host-webserver` `port`.

## 9. Required upstream edits

Phase 1: **none.** Every item above uses registration APIs, public Host methods, Remote streams, `MessageSourceMap` merging, and bundle patches. Candidates retired by this spike: "streaming methods on the speech-to-text Service Definition" (replaced by `ctx.speechStream`). Remaining candidates for later phases: Linux tray and portal global shortcut in `apps/desktop/src/`; a voice source on client-side `InputActions.submit()` if the Host-side submission path proves unsuitable.

## 10. Task order

1. Bundle groundwork: add schedule, webhook, and upstream voice rows to the AIR profile; fixed web port; `--dump-config` check; boot once with SenseVoice push-to-talk to confirm the upstream path on Fedora.
2. `@air/dsh-os-control` + `-linux` + `@air/dsh-tool-os-control` (audio, battery, brightness, notifications, apps, wallpaper; bluetooth and wifi as tier 2).
3. `@air/dsh-text-to-speech` + `-kokoro`, `synthesize()` on `@air/dsh-api-voice`, client playback of the last assistant message on demand.
4. `@air/dsh-speech-stream` + `@air/dsh-speech-sherpa` (Parakeet VAD-segmented), `listen()` Remote, Host-side `air-voice` submission, `speak` events, barge-in, voice log.
5. `@air/dsh-secret-prompt` (polkit, zenity) + `@air/dsh-tool-privileged` + sudo pre-execute policy.
6. `@air/dsh-signals` + `-linux` + `@air/dsh-routines` (cron via schedule, file and battery via webhook runtime).
7. Systemd user service, GNOME shortcut setup doc, `@air/dsh-client-quick-entry`.
8. Phase 2: wake word (sherpa KWS), streaming Zipformer partials, sentence-level TTS from `agent/assistant-stream`, Wyoming GPU provider, Web secret prompt, D-Bus library for signals.

## 11. Test approach

- Service Definitions: unit tests with fake providers, following `packages/experimental/speech-to-text/tests/service.spec.ts` (duplicate id, disposer joins work, resolve failures, no fallback).
- Native providers: fake child-process tests like `speech-to-text-sensevoice/tests/provider.spec.ts` and `worker.spec.ts`; one opt-in local e2e per model (pattern `tests/local.e2e.ts`) using a short fixture WAV; asset manifest hash test.
- Remote: Typert gateway stream tests with scripted uplink frames (pattern `packages/api/gateway/tests/gateway-stream.host.spec.ts`), including abort mid-stream and oversize frames.
- OS provider: injected command runner returning recorded `busctl --json=short` and `wpctl` output captured on the reference machine; verify-after-set retry and clamp tests; one opt-in read-only live test on Fedora.
- Routines: front-matter parser tests (valid, invalid, missing directory); fake clock and fake `webhookRuntime`/`schedule` for cooldown, quiet hours, budget.
- Secret handoff: pre-execute policy tests for `sudo`, `sudo -S`, here-strings, `pkexec` under confinement; a canary test asserting the askpass value never appears in the Session log, tool result, or AIR files.
- Client: vitest client specs like `client-ui-voice-input/tests/*.client.spec.tsx` with a fake Remote handle; barge-in timing with a fake `AudioContext`.
- REAL-composition Loader test booting the AIR bundle; a keyless recorded-session snapshot for an `air-voice` user message, an `os_set_state` tool result, and a routine-created Session.

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Unknown user source kind `air-voice` not rendered or rejected by a reader | Hands-free submission path breaks | Verify in task 4 first; fallback to client `setDraft` + `submit` |
| Echo on laptop speakers defeats barge-in | False interruptions, or the assistant hears itself | Headphones in the demo; `bargeInMinSpeechMs` gate; mute uplink option while speaking |
| VRAM: `qwen3:8b` in Ollama plus GPU STT/TTS exceeds 8 GB | Model eviction, latency spikes | CPU STT/TTS in phase 1 (npm build is CPU-only anyway) |
| CPU latency of Parakeet 0.6B INT8 on long utterances | Misses the 800 ms design target | Measure in task 4; switch to Zipformer streaming or Moonshine if needed |
| Model downloads (hundreds of MB) | Setup friction, supply-chain exposure | Explicit preparation step with pinned sha256, as SenseVoice does |
| Second contribution in `conversation.input.activity` unsupported | Toggle placement | Alternate slot or bundle panel |
| Webhook row dependencies missing in the Web profile | Triggers fail at load | `--dump-config` check in task 1 |
| logind `SetBrightness` refused for a firmware backlight | Brightness demo fails | Test early; `org.gnome.Shell.Brightness` has no absolute setter, so the fallback is to drop the capability |
| `gsettings set` behavior inside bwrap untested | Only matters if the model uses bash | Provider runs Host-side; pre-execute asks for bash `gsettings set` |
| Remote argument exposure for Web secret prompt | Password capture by another plugin | Phase 2 only; plugin audit; polkit and zenity paths never cross the Remote |
| Electron Wayland shortcut and tray unverified on GNOME 50 | Desktop shell demo fails | Web + GNOME shortcut path for phase 1 |
| Upstream syncs change APIs (pre-stable) | Rework | Pin peer ranges; `--dump-config` and Loader test after each sync |

## 13. Recommended demo scope for the phase-1 review

1. **Voice round trip**: GNOME shortcut opens the quick-entry window; hands-free toggle on; "set the volume to 30 percent" → Parakeet transcript appears as a user message → `os_set_state` result shows before 0.99, after 0.30, `verified: true` → Kokoro speaks the answer; the user interrupts a long answer and playback stops (headphones).
2. **OS reads and tier 2**: "what's my battery", "dim the screen a bit" (logind, sysfs read-back), "connect my headphones" with an approval prompt.
3. **Routines**: a Markdown cron routine delivered through schedule into its Session; a new PDF in `~/Downloads` starting a read-only Session through the webhook runtime; show `fired.jsonl`.
4. **Secret handoff**: model asks to run a privileged command → approval → GNOME polkit dialog from `pkexec`; then show the Session log and AIR files contain no password; show plain `sudo` rejected with the hint.
5. **Resident Host**: close the window, show the systemd user service still running and a routine notification arriving.

Out of scope for phase 1: wake word, Smart Turn, streaming partials, GPU STT, Web secret prompt, Electron tray and global shortcut, macOS and Windows providers.
