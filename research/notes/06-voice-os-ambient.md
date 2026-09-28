# Voice, OS Control, Computer Use, Ambient Agents, and Secret Handoff

> **Upstream sync note (2026-09-28):** written against `dsh 0.1.6-alpha.2`. The fork is now at `dsh 0.2.0-rc.1`; see [research.md section 2b](../research.md) for what changed (experimental speech-to-text seam, cron-capable schedule with cold-session restore, Windows tray, agent-preset registry, session format v4).

Research date: 2026-09-28. Scope: survey plus recommended architecture for AIR-harness (TypeScript/Node, Cordis plugins, Electron desktop, web client, CLI). Reference machine: Fedora Linux on Wayland, RTX 4060 laptop GPU (8 GB VRAM class), 30 GB RAM. Every figure below is quoted from the linked source with its date. Numbers labelled "design target" are recommendations for this project, not measurements. Where a source is a vendor page, the figure is a vendor claim.

## 1. Voice pipeline

### 1.1 Survey

**Pipeline shape.** The mature local reference is Home Assistant Assist: wake word, then speech-to-text, then intent handling, then text-to-speech, with each stage running as an independent server that speaks the Wyoming protocol, a small framing format over TCP with Zeroconf discovery ([Home Assistant Wyoming integration](https://www.home-assistant.io/integrations/wyoming/), [wyoming-satellite](https://github.com/rhasspy/wyoming-satellite)). Home Assistant moved wake-word detection off the satellite onto a server running openWakeWord, then later onto the device itself with microWakeWord ([Home Assistant wake-word approach](https://www.home-assistant.io/voice_control/about_wake_word/)). The design lesson for AIR-harness is that each stage is an independently swappable provider with a narrow audio-in/text-out or text-in/audio-out interface, and that stage servers can live in other processes or on other machines.

**Wake word.** openWakeWord (open source, ONNX/TFLite models, custom phrases trained almost entirely on synthetic TTS speech) is the default free option and is what Home Assistant uses server-side ([openWakeWord](https://github.com/dscripka/openWakeWord)). microWakeWord produces tiny streaming TFLite-Micro models for ESP32-S3-class hardware and uses the same synthetic-data training idea; it matters if the project ever ships a hardware satellite. Picovoice Porcupine is commercial and closed, generates a custom model from typed text in minutes, and has SDKs for most platforms including Node ([Picovoice wake-word guide, 2026](https://picovoice.ai/blog/complete-guide-to-wake-word/)); its licence terms make it a poor default for an open-source project but acceptable as an optional provider. sherpa-onnx also ships open-vocabulary keyword spotting that runs in the same native addon as its STT/TTS ([sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)).

**VAD.** Silero VAD remains the standard. v6.0 was released 2025-08-25 with ONNX models; the maintainers report 16% fewer errors on noisy real-life data versus v5, and v6.2 (2025-12-10) added an "ifless" ONNX export ([Silero VAD releases](https://github.com/snakers4/silero-vad/releases), [v6.0 discussion](https://github.com/snakers4/silero-vad/discussions/678)). sherpa-onnx embeds Silero VAD, so a Node process can get VAD without a separate runtime.

**Streaming and batch STT.**

- *Whisper family.* faster-whisper (CTranslate2) and whisper.cpp (GGML, CUDA/Vulkan/CPU) remain the most portable options ([faster-whisper](https://github.com/SYSTRAN/faster-whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp)). Whisper is not natively streaming; "streaming" wrappers re-decode sliding windows, which costs GPU time and causes transcript revisions. For a command-and-conversation assistant, running Whisper on each VAD-bounded utterance is simpler and good enough. Distil-Whisper variants trade some accuracy for speed on English.
- *NVIDIA Parakeet.* parakeet-tdt-0.6b-v3 is a 600M-parameter FastConformer-TDT model covering 25 European languages with automatic language detection, punctuation, capitalisation and word timestamps; the accompanying paper is arXiv 2509.14128 (September 2025) ([model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [paper](https://arxiv.org/abs/2509.14128)). It is fast on a GPU and has community ONNX exports runnable through sherpa-onnx. English-only v2 remains available ([v2 card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)).
- *Moonshine.* Moonshine v2 (arXiv 2602.12241, February 2026) is a true streaming encoder with sliding-window attention, aimed at sub-1 GB, low-TOPS edge hardware; tiny/small/medium streaming checkpoints are published ([paper](https://arxiv.org/abs/2602.12241v1), [moonshine-streaming-small](https://huggingface.co/moonshine-ai/moonshine-streaming-small)). It is the best fit for the CPU-only tier when English is enough.
- *Kyutai STT.* Built on "delayed streams modeling"; `stt-1b-en_fr` has a 0.5 s delay and a built-in semantic VAD, `stt-2.6b-en` a 2.5 s delay ([Kyutai STT](https://kyutai.org/stt/), [delayed-streams-modeling](https://github.com/kyutai-labs/delayed-streams-modeling/)). Server-oriented (Rust/PyTorch), interesting as a sidecar.
- *sherpa-onnx.* Not a model but the most useful runtime for this project: offline and streaming ASR (Zipformer, Paraformer, Whisper, Moonshine, NeMo transducers), TTS (VITS/Piper voices, Kokoro, Matcha), VAD, keyword spotting and diarization via ONNX Runtime, with a Node native addon on npm (`sherpa-onnx`, 1.13.x at time of search) and documented Electron use ([repo](https://github.com/k2-fsa/sherpa-onnx), [Node addon examples](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md), [npm](https://www.npmjs.com/package/sherpa-onnx)).

**TTS.**

- *Piper.* Fast, CPU-friendly, many voices. The original `rhasspy/piper` (MIT) was archived in October 2025; development continues at `OHF-Voice/piper1-gpl` under GPL-3.0 ([piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), [archived repo](https://github.com/rhasspy/piper)). Running Piper voice files through sherpa-onnx or as a separate process avoids linking GPL code into the harness.
- *Kokoro-82M.* Apache-2.0, 82M parameters, noticeably more natural than Piper at still-small cost, multilingual voice packs; supported directly by sherpa-onnx including Node examples ([model card](https://huggingface.co/hexgrad/Kokoro-82M), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)). Best default for both GPU and CPU tiers.
- *Chatterbox / Chatterbox Turbo* (Resemble AI). Turbo is 350M parameters with a one-step distilled decoder, paralinguistic tags, 5-second zero-shot cloning, PerTh watermarking on every output; the vendor claims about 75 ms latency. An ONNX export exists ([Chatterbox Turbo card](https://huggingface.co/ResembleAI/chatterbox-turbo), [ONNX](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX), [repo](https://github.com/resemble-ai/chatterbox)). Good optional "expressive voice" provider on the 4060.
- *XTTS / Coqui.* Coqui shut down in 2023; the maintained fork is `idiap/coqui-ai-TTS` (PyPI `coqui-tts`), but XTTS-v2 weights remain under the non-commercial Coqui Public Model License ([idiap fork](https://github.com/idiap/coqui-ai-TTS)). Not a default for an open-source distributable.
- *Orpheus* (Llama-3B-based, emotion tags, token streaming) and *Sesame CSM-1B* (conversational, conditioned on dialogue audio history) are expressive but heavier LLM-style generators ([Orpheus](https://github.com/canopyai/Orpheus-TTS), [CSM](https://github.com/SesameAILabs/csm)). Check each weight licence; Orpheus inherits Llama terms. On an 8 GB card they compete with everything else for VRAM, so treat them as experiments.

**End-to-end and full-duplex speech models.**

- *Moshi* (Kyutai): full-duplex speech-text model; theoretical latency 160 ms, practical about 200 ms on an L4 GPU per the project ([moshi](https://github.com/kyutai-labs/moshi)). Excellent at turn-taking, weak at tool use; not an agent brain.
- *OpenAI gpt-realtime*: GA on 2025-08-28 with SIP, image input and remote MCP tools ([announcement](https://openai.com/index/introducing-gpt-realtime/)).
- *Gemini Live API* native audio: "proactive audio" (responds only to device-directed speech) and affective dialog on Gemini 2.5 Flash native audio; the capability guide notes these are not all available on every Live model ([Live API guide](https://ai.google.dev/gemini-api/docs/live-guide)).
- *Qwen3-Omni* (open weights, 30B-A3B Thinker-Talker MoE, arXiv 2509.17765) supports function calling; the open release is effectively half-duplex, with full duplex via community retrofits or the hosted API ([tech report](https://arxiv.org/abs/2509.17765), [repo](https://github.com/QwenLM/Qwen3-Omni)). It does not fit an 8 GB GPU without aggressive quantisation and offload.

The architectural conflict for AIR-harness: speech-to-speech models collapse STT, reasoning and TTS into one opaque model call, which conflicts with the harness rule that everything model-visible must be reconstructable from the session log and with the harness's own model-provider layer (DeepSeek and others). A cascaded pipeline (STT → harness agent loop → TTS) keeps the agent loop, tools, approvals and logging unchanged. End-to-end models should be an optional provider for "chat mode", not the core.

**Turn detection and barge-in.** VAD silence alone either cuts users off mid-thought or adds long tails. Two open models address this:

- *Pipecat Smart Turn* (now v3.2): a native-audio semantic end-of-turn classifier, open data and open training code, designed to run on CPU next to Silero VAD ([smart-turn](https://github.com/pipecat-ai/smart-turn), [HF](https://huggingface.co/pipecat-ai/smart-turn-v3), [v3.1 accuracy post](https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/)).
- *LiveKit turn detector*: text-based end-of-utterance model fine-tuned from Qwen2.5-0.5B-Instruct and distilled from a 7B teacher; multilingual variant covers English plus 13 languages; used with Silero VAD, which still handles interruption triggering ([HF](https://huggingface.co/livekit/turn-detector), [docs](https://docs.livekit.io/agents/build/turns/turn-detector/)).

Smart Turn is audio-native (no dependency on the STT transcript), so it fits a pipeline where STT runs only once per turn. The LiveKit model needs a partial transcript, so it pairs with streaming STT.

**Frameworks.** Pipecat (Python) and LiveKit Agents (Python, plus `@livekit/agents` for Node, now 1.x with semantic turn detection and MCP) are the leading frameworks ([agents-js](https://github.com/livekit/agents-js), [LiveKit Agents docs](https://docs.livekit.io/agents/)). Vocode has lost momentum relative to these. LiveKit Agents assumes a LiveKit room/WebRTC transport; for a single-user local desktop app that is extra infrastructure. Pipecat is the better source of patterns (frame pipeline, interruption semantics, Smart Turn integration) than a runtime dependency for a Node harness.

**Latency budget.** Human conversational turn gaps cluster around 200 ms across languages ([Stivers et al., PNAS 2009](https://www.pnas.org/doi/10.1073/pnas.0903616106)). Industry write-ups converge on roughly 800 ms from end of user speech to first assistant audio as the "still feels smooth" line, splitting it approximately as endpointing 150–300 ms, final ASR 100–200 ms, LLM time-to-first-token 300–600 ms, TTS time-to-first-byte 100–250 ms ([WebRTC.ventures, September 2026](https://webrtc.ventures/2026/09/voice-ai-latency-budget/), [AWS Builder Center](https://builder.aws.com/content/3JDFAfXBiuwPP5MPzgf4RUWSAIp/the-800ms-rule-budgeting-latency-for-a-real-time-voice-agent-on-aws)). For a local pipeline, endpointing and LLM first token dominate; network hops to a cloud LLM are the only non-local cost.

**Running from Node/Electron.** Three viable integration patterns:

1. *In-process native addon*: `sherpa-onnx` (ASR/TTS/VAD/KWS) and `onnxruntime-node` (arbitrary ONNX such as openWakeWord or Smart Turn). onnxruntime-node supports the CUDA execution provider on Linux x64 (CUDA 12, cuDNN 9; CUDA 11 dropped since 1.22) ([onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node), [CUDA EP](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)). Run inference in a `worker_threads` worker or an Electron `utilityProcess`, never on the main or renderer thread.
2. *Sidecar process* speaking Wyoming or a small WebSocket protocol: a Python faster-whisper/Parakeet/NeMo/Chatterbox server supervised by the harness `subprocess` package. Best for GPU models whose best implementation is Python.
3. *Remote/API provider*: cloud STT/TTS or a realtime speech model.

Microphone capture belongs in the client: the web client and Electron renderer already have `getUserMedia` with echo cancellation, noise suppression and AGC, which are essential for barge-in (the assistant must not hear itself). Headless/CLI capture can use PipeWire via `pw-record` or `parec` as a subprocess.

### 1.2 Recommended architecture

**Packages** (new group `packages/voice/`):

| Package | Role | Notes |
|---|---|---|
| `dsh-voice` | Service Definition `ctx.voice` | Registries for `wake`, `vad`, `turn`, `stt`, `tts` stage providers; session binding; config resolution (`resolve(request): VoiceSpec`). No model-visible tools. |
| `dsh-voice-sherpa` | Service Provider (in-process, worker thread) | sherpa-onnx for Silero VAD, KWS, Moonshine/Parakeet/Whisper ASR, Kokoro/Piper TTS. CPU default, CUDA opt-in. |
| `dsh-voice-onnx-turn` | Provider (`turn`, `wake`) | onnxruntime-node running Smart Turn v3.x and openWakeWord models. |
| `dsh-voice-wyoming` | Provider (sidecar/remote) | Wyoming client for any Wyoming STT/TTS/wake server; lets users reuse Home Assistant add-ons and GPU Python servers. |
| `dsh-voice-realtime-*` (experimental) | Provider for full speech-to-speech | OpenAI Realtime / Gemini Live; must emit transcripts and tool calls as session events. |
| `client/ui-voice` | Consumer (client) | Push-to-talk, hands-free toggle, live captions, barge-in, level meter; locale-owned copy. |

**Data flow.** Client captures 16 kHz mono PCM with browser AEC and streams frames over the existing client connection. The host runs VAD → turn detector → STT. The final transcript enters the agent loop as an ordinary user message whose session event records `source: "voice"`, the STT provider, and the final text; audio bytes are not logged by default. Assistant text streams to TTS sentence by sentence (split on punctuation after the first clause to cut time-to-first-audio). On barge-in (VAD speech start while TTS is playing, confirmed by a minimum-duration gate), the client stops playback immediately, the host cancels pending TTS, and a session event records the truncation point so the log reflects what the user actually heard. This mirrors how the realtime APIs truncate assistant audio.

**Model choices.**

| Stage | RTX 4060 laptop | CPU-only |
|---|---|---|
| Wake word | openWakeWord (ONNX, CPU, always on) | openWakeWord or sherpa-onnx KWS |
| VAD | Silero VAD v6 (CPU) | Silero VAD v6 |
| Turn | Smart Turn v3.x (CPU) + VAD silence fallback | Smart Turn v3.x |
| STT | Parakeet-TDT-0.6B-v3 (CUDA, multilingual EU) or faster-whisper large-v3-turbo sidecar for other languages | Moonshine streaming small/medium (English) or Whisper small/base via whisper.cpp |
| TTS | Kokoro-82M (default); Chatterbox Turbo optional for expressive/cloned voice | Kokoro-82M or Piper voice |
| LLM | Harness model provider (DeepSeek API) | same |

Keep wake word, VAD and turn detection on CPU so the GPU is free for STT/TTS bursts and any local vision model.

**Latency targets (design targets).** p50 end-of-speech to first audio ≤ 800 ms with a cloud LLM; stretch ≤ 500 ms. Barge-in: playback stops within 150 ms of confirmed user speech. Wake-word to listening chime ≤ 250 ms. Instrument each stage with timestamps in a non-model-visible diagnostics event so regressions are measurable in the recorded-session snapshots.

**Privacy defaults.** Push-to-talk on by default; hands-free wake word is opt-in and shows a persistent indicator. Audio never leaves the machine unless a cloud provider is explicitly selected. Pre-wake audio stays in a ring buffer of a few seconds and is discarded. Audio is not persisted; transcripts are persisted because they are model-visible. Voice-originated actions follow the same approval tiers as typed ones; high-risk actions require an on-screen confirmation, never a spoken "yes" alone, because speech can come from a TV or another person.

## 2. OS control

### 2.1 Survey by platform

**Linux (the primary target).** Nearly everything the old AIR demos did is available over D-Bus on the session or system bus, which is preferable to parsing CLI output:

- *Media*: MPRIS (`org.mpris.MediaPlayer2.*`) for play/pause/next/metadata on any compliant player; `playerctl` is a CLI over the same interface ([MPRIS spec](https://specifications.freedesktop.org/mpris-spec/latest/)).
- *Audio*: PipeWire via `wpctl` (`wpctl get-volume @DEFAULT_AUDIO_SINK@`, `set-volume`, `set-mute`) or `pactl` against pipewire-pulse. There is no stable, simple D-Bus volume API across desktops, so a CLI subprocess is the practical route.
- *Brightness*: `org.freedesktop.login1.Session.SetBrightness("backlight", device, value)` lets an unprivileged user in an active session change the backlight without root (systemd ≥ 243); `brightnessctl` uses it when available ([logind D-Bus API](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html), [brightnessctl commit](https://github.com/Hummer12007/brightnessctl/commit/99c21787cbbbde7ca1eb57abc8e7e3b3101eeb6d)). Read back from `/sys/class/backlight/*/brightness`. GNOME also exposes brightness through `org.gnome.SettingsDaemon.Power`.
- *Network*: NetworkManager (`org.freedesktop.NetworkManager`) or `nmcli`.
- *Bluetooth*: BlueZ (`org.bluez`, `Adapter1.Powered`, `Device1.Connect`, `Connected`) or `bluetoothctl`.
- *Power/battery*: UPower (`org.freedesktop.UPower`, `Device.Percentage`, `State`) and logind for suspend/lock.
- *Notifications*: `org.freedesktop.Notifications.Notify` for output; monitoring other apps' notifications requires `dbus-monitor`-style eavesdropping, which is increasingly restricted and is privacy-sensitive.
- *Settings and wallpaper*: `gsettings` on GNOME (`org.gnome.desktop.background picture-uri` and `picture-uri-dark`), `plasma-apply-wallpaperimage` on KDE; the xdg-desktop-portal Wallpaper interface exists but prompts.
- *Apps*: launch `.desktop` entries via `gtk-launch`/`gio launch`; list via XDG data dirs.
- *Screens and input on Wayland*: xdg-desktop-portal `Screenshot`, `ScreenCast` (PipeWire stream) and `RemoteDesktop` (input injection, now via libei). RemoteDesktop supports `persist_mode` 2 plus a single-use `restore_token` that must be stored and rotated to avoid a consent dialog on every process start ([RemoteDesktop portal docs](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html), [libei in the portals, July 2026](http://who-t.blogspot.com/2026/07/libei-integrations-in-xdg-remotedesktop.html), [computer-use-linux PR on persistent grants](https://github.com/agent-sh/computer-use-linux/pull/188)). X11 tools like `xdotool` do not work on Wayland ([semicomplete on Wayland fragmentation](https://www.semicomplete.com/blog/xdotool-and-exploring-wayland-fragmentation/)).

From Node, D-Bus can be reached with a pure-JS client library (for example `dbus-next`; check maintenance status before adopting) or, with no native dependency, by shelling out to `busctl --json=short call ...` and `gdbus`, which gives structured output. Given the harness's `shell`/`subprocess` packages and sandbox, the subprocess path is the lower-risk start; a D-Bus library is worth it for signal subscriptions (battery, network, media changes) in the ambient layer.

**macOS.** `osascript` runs AppleScript and JXA (`-l JavaScript`); the `shortcuts` CLI runs any user Shortcut, which gives access to many system actions without private APIs ([Apple: run shortcuts from the command line](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac)). Clicking and typing into other apps needs the Accessibility (AX) permission; reading the screen needs Screen Recording; both are TCC grants attached to the host app (the Electron app), so the desktop app must request them explicitly. Volume via `osascript -e "set volume output volume N"`; media via app-specific AppleScript or the MediaRemote private framework (avoid); brightness has no supported public CLI.

**Windows.** PowerShell for most settings, WinRT APIs (media sessions via `GlobalSystemMediaTransportControlsSessionManager`, Bluetooth radios, notifications), Core Audio for volume, WMI for brightness on laptops, and UI Automation for the accessibility tree. A cluster of MCP servers show the pattern works: Windows-MCP (accessibility-tree based, no vision model needed) and `mcp-windows` which targets controls by name rather than coordinates ([Windows-MCP](https://github.com/CursorTouch/Windows-MCP), [sbroenne/mcp-windows](https://github.com/sbroenne/mcp-windows)).

### 2.2 Recommended architecture

**Packages** (new group `packages/os-control/`):

| Package | Role |
|---|---|
| `dsh-os-control` | Service Definition `ctx.osControl`: a registry of typed *capabilities* (`audio.output`, `display.brightness`, `media.player`, `bluetooth`, `network.wifi`, `power`, `notifications.post`, `apps.launch`, `desktop.wallpaper`, `system.packages`). Each capability declares `read()`, `set(desired)`, `verify(desired, observed)`, a `riskTier`, and whether `set` is reversible. |
| `dsh-os-control-linux` | Service Provider: D-Bus/busctl + `wpctl`/`brightnessctl`/`gsettings`/`nmcli` backends, with desktop detection (GNOME, KDE, wlroots) resolved explicitly at load. |
| `dsh-os-control-macos`, `dsh-os-control-windows` | Service Providers; can start as thin `osascript`/`shortcuts` and PowerShell/WinRT wrappers. |
| `dsh-tool-os-control` | Consumer: model-visible tools. Prefer a small number of typed tools (`os_get_state`, `os_set_state`, `media_control`, `app_launch`) over one tool per setting; tool inputs are JSON-validated at the model boundary. |
| `client/ui-os-control` | Consumer: tool cards showing before/after state and verification result. |

**Verify-after-set as a contract.** Every `set` returns `{ requested, before, after, verified, attempts }`. The provider re-reads real state after the change (AIR's Bluetooth plugin pattern), with a bounded poll for asynchronous subsystems (BlueZ connect, NetworkManager activation). The tool result reports `verified: false` with the observed value rather than claiming success. For relative requests ("a bit louder") the provider resolves the absolute target first, which makes the log reproducible and makes verification well-defined. Clamp ranges in the provider (for example refuse brightness 0 on the only display) as a safety invariant, not a tunable.

**Risk-tiered approval**, mapped onto the existing fail-closed `dsh-user-approval` seam and permission presets:

| Tier | Examples | Default policy |
|---|---|---|
| 0 read | battery, now playing, volume, Wi-Fi SSID | allow |
| 1 reversible, local | volume, brightness, play/pause, wallpaper, launch app, post notification | allow, with undo recorded |
| 2 disruptive or connectivity | toggle Wi-Fi/Bluetooth, connect device, kill app, lock screen | ask (auto-allow configurable per preset) |
| 3 privileged or destructive | package updates, power off, delete files, change system settings | always ask with exact command shown; secrets via section 5 |

The tier is declared by the capability, not by the model. Whether a tier-2 action auto-allows is a validated `Config` field.

## 3. Computer use

### 3.1 Survey

**Scores (all OSWorld-Verified, success rate, 100-step budget unless noted).** The official leaderboard, read 2026-09-28, lists at the top: claude-fable-5 86.0% and claude-opus-5 83.4% (both 2026-07-31), Muse Spark 1.1 80.7% (2026-07-08), Holo3-35B-A3B 80.4 ± 2.2% (2026-04-19), MiniMax M3 75.2%, Qwen 3.7 Plus 73.3%, Kimi K2.6 73.1%, and claude-sonnet-4-6 72.1% (2026-03-07); the human baseline from the original paper is 72.36% ([OSWorld leaderboard](https://os-world.github.io/)). For context on pace: OpenAI's CUA launched at 38.1% on the original OSWorld in January 2025 ([OpenAI CUA](https://openai.com/index/computer-using-agent/)); Claude Sonnet 4.5 reported 61.4% on OSWorld-Verified in September 2025 ([Anthropic](https://www.anthropic.com/news/claude-sonnet-4-5)); UI-TARS-2 reported 47.5 on OSWorld in September 2025 ([arXiv 2509.02544](https://arxiv.org/abs/2509.02544)). OSWorld tasks are short relative to real work; Snorkel's long-horizon OSWorld 2.0 (108 hour-plus tasks) is a harder signal ([Snorkel OSWorld 2.0](https://snorkel.ai/leaderboard/os-world-2-0/)), and OSWorld-Human measures step efficiency, which matters for latency and cost ([OSWorld-Human](https://github.com/WukLab/osworld-human)).

**Open weights.** Holo3-35B-A3B (H Company, Apache-2.0, sparse MoE with about 3B active parameters, fine-tuned from Qwen3.5-35B-A3B; released 2026-03-31; the vendor page quotes 77.8% while the leaderboard entry shows 80.4%) is the strongest open computer-use model found ([HF card](https://huggingface.co/Hcompany/Holo3-35B-A3B), [H Company](https://hcompany.ai/holo3)). Its 35B total parameters exceed 8 GB VRAM at usable precision; it would need a quantised build with CPU expert offload using the 30 GB RAM, or a remote endpoint. UI-TARS (ByteDance) and the UI-TARS-desktop stack remain the best-known open agent framework ([UI-TARS-2](https://huggingface.co/papers/2509.02544)).

**Products.** OpenAI folded Operator into ChatGPT agent on 2025-07-17 ([Operator page](https://openai.com/index/introducing-operator/)). Anthropic's computer-use tool runs trained prompt-injection classifiers over tool results such as screenshots and steers the model to confirm with the user when an injection is suspected ([computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)); independent 2026 research shows such classifiers can still be bypassed ([CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-claude-code-automode-prompt-injection-2026/), [arXiv 2608.02018](https://arxiv.org/pdf/2608.02018)).

**Accessibility tree vs pixels.** Pixel-only agents (screenshot in, coordinates out) generalise to any app but spend many tokens per step and are fragile to scaling and theming. Parsers such as OmniParser v2 convert screenshots into labelled interactable elements so a non-grounded LLM can act ([Microsoft Research](https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/)). Accessibility-tree agents (AT-SPI on Linux, AX on macOS, UIA on Windows) are cheaper and exact when apps expose good trees; Windows-MCP demonstrates a vision-free agent on UIA. Electron and many GTK4/Qt apps expose usable trees; games, canvases and some web views do not. The practical answer is hybrid: accessibility tree first, screenshot plus grounding when the tree is empty or ambiguous, and a structured API (section 2) before either.

### 3.2 Recommended architecture

The harness already has `dsh-computer-use` (single provider slot) with experimental CUA-driver providers. Add:

- `dsh-computer-use-linux-portal` (Provider): screenshots via the Screenshot/ScreenCast portal, input via RemoteDesktop + libei with persisted restore tokens kept in `dsh-credentials`, AT-SPI tree extraction via a small sidecar (Python `pyatspi` or a Rust helper) because there is no maintained Node AT-SPI binding.
- A `grounding` option on the provider: `model-native` (for Claude/OpenAI-style computer-use models), `omniparser` (sidecar), or `local-vlm` (Holo/UI-TARS via an OpenAI-compatible local endpoint).

Policy: computer use is the last resort after typed OS capabilities and browser-use. Each action is tier 2 by default; typing into password fields, payment forms and terminals is tier 3. Screenshots are model-visible and therefore logged; store them as attachments with a retention setting, and redact regions the provider identifies as password fields. Treat on-screen text as untrusted data, never as instructions.

## 4. Proactive and ambient behaviour

### 4.1 Survey

"Proactive Agent" (Lu et al., arXiv 2410.12361) formalised proactive assistance, built ProactiveBench from 6,790 events across coding, writing and daily-life activity (keyboard/mouse, clipboard, browser), and reported a best fine-tuned F1 of 66.47% at deciding when to offer help ([paper](https://arxiv.org/abs/2410.12361)). ProactiveEval (arXiv 2508.20973) unifies evaluation for proactive dialogue agents ([paper](https://arxiv.org/pdf/2508.20973)). The CHI 2025 study "Assistance or Disruption?" logged 398 proactive interventions in programming: 53.3% led to engagement, 12.1% were disruptions and 34.7% were ignored; participants described persistent suggestions as distracting, and timing at task boundaries helped ([arXiv 2502.18658](https://arxiv.org/html/2502.18658v4), [ACM DL](https://dl.acm.org/doi/10.1145/3706598.3713357)). ProMemAssist (arXiv 2507.21378) models working memory to time assistance ([paper](https://arxiv.org/pdf/2507.21378)). Most relevant for cost: a May 2026 Microsoft/Purdue paper argues that calling an LLM on every event just to decide whether to wake is wasteful, and that a small temporal-graph model over structured (actor, verb, object, time) events gives better trigger F1 at about 11–14 ms per event, with the LLM invoked only when the trigger fires ([arXiv 2605.30152](https://arxiv.org/abs/2605.30152)). Gemini Live's "proactive audio", which answers only device-directed speech, is the voice-side analogue ([Live API guide](https://ai.google.dev/gemini-api/docs/live-guide)).

The consistent conclusion: separate a cheap, deterministic or small-model **trigger** from the expensive LLM **action**, gate interruptions by user state and task boundaries, and make proactivity budgeted and easy to silence.

### 4.2 Recommended architecture

**Packages** (new group `packages/ambient/`):

| Package | Role |
|---|---|
| `dsh-signals` | Service Definition `ctx.signals`: typed event sources registered via `ctx.effect()`, each emitting structured records (`source`, `kind`, `subject`, `at`, `data`), branded ids. |
| `dsh-signals-linux` | Providers: UPower battery/AC, NetworkManager connectivity, logind lock/unlock/idle/suspend, MPRIS now-playing, file watch (chokidar or `fs.watch` on configured paths), calendar (CalDAV or ICS poll; Google via MCP), removable media. |
| `dsh-triggers` | Consumer of signals: declarative rules (YAML in cordis.yml or user settings) with conditions, cooldowns and quiet hours; an optional scoring model slot for learned triggers later. A fired rule starts a session through the same fire-and-forget path that `dsh-webhook` uses, with the triggering signal recorded as the first session event. |
| `dsh-routines` | Consumer built on `dsh-schedule`: named routines ("good morning", "end of day") that assemble a briefing from tools (calendar, weather, unread mail summary, battery, pending jobs). |
| `client/ui-ambient` | Inbox of proactive items, per-rule mute, "why am I seeing this". |

**Anti-annoyance rules (defaults).**

1. Deterministic triggers only at first; no LLM-in-the-loop polling.
2. Delivery channel by urgency: silent inbox item (default) → desktop notification → spoken interruption (only for rules the user marked urgent, and never during a call, full-screen app, or Do Not Disturb, all readable from D-Bus/portals).
3. Per-rule cooldown and a global budget (design target: at most a handful of unsolicited notifications per day unless raised).
4. Defer to task boundaries: prefer idle, unlock, or app-switch moments via logind idle hints.
5. Every proactive item has "mute this rule" and "never do this", which are recorded as settings changes.
6. Proactive sessions run with a restricted permission preset (tiers 0–1 only); anything higher becomes a suggestion awaiting user approval.

**Privacy.** Signals stay local. Only the fired signal's summary becomes model-visible (and therefore logged). No keylogging, clipboard or other-app notification capture by default; each is an explicit opt-in provider.

## 5. Secure secret handoff (sudo and passwords)

### 5.1 Survey

Coding agents run subprocesses without a controlling TTY, so `sudo` cannot prompt; the common workaround is that the user runs the command themselves (Claude Code's `!` prefix) ([Igor47 on sudo for Claude](https://igor.moomers.org/posts/claude-sudo), [opencode issue #9808](https://github.com/anomalyco/opencode/issues/9808)). Community tools converge on three patterns:

- **`SUDO_ASKPASS` helper with a GUI prompt**: the agent runs `sudo -A <cmd>`; sudo execs the askpass program, which shows a native dialog containing the exact command; the password flows dialog → sudo, never through the agent ([claude-sudo-askpass](https://github.com/dgutson/claude-sudo-askpass), [sudoplz](https://github.com/crypdick/sudoplz), [Jono's Corner, March 2026](https://www.dgt.is/blog/2026-03-10-ai-sudo-with-agents/)).
- **polkit/pkexec**: `pkexec <cmd>` triggers the desktop's polkit authentication agent; the password is typed into an OS dialog the LLM cannot read ([pkexec manual](https://www.freedesktop.org/software/polkit/docs/latest/pkexec.1.html), [asroot write-up, June 2026](https://www.ivanmorgillo.com/2026/06/16/ai-coding-agent-sudo-pkexec-asroot-linux/)). Better still, many privileged operations have polkit-guarded D-Bus APIs already (PackageKit for updates, NetworkManager, logind, udisks), so no root shell is needed at all.
- **Pre-execution hooks**: a PreToolUse hook intercepts commands containing `sudo` and routes them to a dialog or denies them ([Nutchanon's hook](https://nutchanon.org/blog/claude-code-sudo-hook/)).

Keyring-stored passwords that are auto-supplied (some tools do this) remove the human from the loop and turn the agent into a standing root principal; avoid.

### 5.2 Recommended architecture

**Principle:** the secret travels from a human-facing input directly to the consuming process over a channel that is outside the agent loop, is never a session event, never appears in argv, environment exported to children, terminal scrollback, or spill files.

**Package** `dsh-secret-prompt` (Service Definition in `packages/interaction/`, beside `dsh-user-approval`), with providers:

- `secret-prompt-askpass` (Linux/macOS): the harness sets `SUDO_ASKPASS` to a tiny helper binary/script for commands it launches with `sudo -A`. The helper connects to a per-session Unix socket (0600, in `$XDG_RUNTIME_DIR`) and blocks. The host raises a secret-input request to the client *outside the session event stream*: the Electron app shows a native-styled modal with the exact command, working directory and requesting session; the web client shows a masked field over the authenticated connection. The helper writes the password to sudo's stdin pipe and exits; the host zeroes its buffer. Session log records only `privileged_command.approved|denied` with the command, not the secret.
- `secret-prompt-polkit` (Linux, preferred when available): use `pkexec` or, better, polkit-guarded D-Bus APIs (PackageKit `UpdatePackages` for the "system update" demo), so the desktop's own polkit agent collects the password. The harness never touches it.
- `secret-prompt-pty` (fallback for the persistent terminal): when a terminal session's output matches a password prompt pattern (`[sudo] password for`, `Password:`), the terminal backend switches that PTY to "human input" mode: the client's input field for that terminal sends keystrokes straight to the PTY write path, the host marks the input bytes as non-loggable, and model-facing reads of the terminal are paused until the prompt clears. Terminal echo is off during sudo prompts, but the host must also avoid capturing the raw input stream.

Enforcement lives in the `dsh-shell`/`dsh-terminal` backends and the sandbox policy: plain `sudo` without `-A` is rejected with a model-visible hint to use the privileged-command tool; `sudo -S` and here-strings are rejected because they imply the model supplied the password. Privileged commands are tier 3 in the approval table, so approval and password entry are the same human gesture on the desktop. Cache nothing by default; sudo's own timestamp may be left at the system default and documented.

## 6. Cross-cutting recommendations for AIR-harness

1. **Keep the agent loop unchanged.** Voice is an input/output channel producing ordinary user messages plus metadata events; OS control and signals are plugins on existing extension points; secret handoff lives in interaction/terminal backends. No `agent-loop` change is needed, which avoids the architecture-doc update obligation.
2. **Capability seams complete in one change.** For each of `voice`, `os-control`, `signals`, `secret-prompt`, ship Definition + at least one Provider + a Consumer (tool or UI) together, with recorded-session snapshots for transcript output (voice-origin messages, verify-after-set tool results, proactive session start).
3. **Sidecar policy.** In-process (worker thread / `utilityProcess`) for ONNX models via sherpa-onnx and onnxruntime-node; sidecar for Python-only GPU models and AT-SPI; all sidecars supervised through `dsh-subprocess` with explicit teardown per the defensive-patterns doc.
4. **Configuration.** Model paths, device (`cpu`/`cuda`), wake phrase, turn thresholds, rule cooldowns and tier auto-allow are validated `Config` fields; misconfiguration (missing model file, CUDA requested but unavailable) fails at load.
5. **Model downloads.** Treat model fetching as an explicit, user-approved setup step with pinned hashes; do not auto-download at first use.

## 7. Demo scenarios and feasibility

Feasibility is judged for Fedora/Wayland on the reference laptop, using the recommended stack.

| # | Scenario | Path | Feasibility | Notes |
|---|---|---|---|---|
| 1 | "Hey AIR, set volume to 30%" | wake → STT → `os_set_state(audio.output)` via `wpctl`, verify read-back | High | Tier 1; voice round-trip is the showcase. |
| 2 | "Dim the screen a bit" | logind `SetBrightness`, resolve relative to absolute, verify via sysfs | High | Clamp minimum. |
| 3 | "Pause the music / what's playing?" | MPRIS over D-Bus or `playerctl` | High | Tier 0/1. |
| 4 | "Open Firefox and VS Code" | `gio launch` / `gtk-launch`, verify process/window | High | Window verification on Wayland is limited; verify process. |
| 5 | "Connect my headphones" | BlueZ `Device1.Connect`, poll `Connected` | High | Tier 2 ask; proves verify-after-set with async state. |
| 6 | "Remind me at 5 to call mom" | `dsh-schedule` + notification + optional TTS | High | Already mostly present in harness. |
| 7 | "Change my wallpaper to something calm" | image search/generation + `gsettings` (both light/dark keys) | High | KDE needs separate backend. |
| 8 | Good-morning briefing at unlock | logind unlock signal → routine → calendar, weather, battery, jobs; spoken summary | High | Needs calendar provider (CalDAV/ICS or Google MCP). |
| 9 | "Update the system" | PackageKit D-Bus or `pkexec dnf upgrade`; polkit dialog collects password | High | Tier 3; demonstrates password never in context. Show the session log afterwards. |
| 10 | Battery low while on battery → suggest power saver | UPower signal → rule → notification with action | High | Deterministic trigger, cooldown. |
| 11 | Barge-in: interrupt a long spoken answer | client AEC + VAD + TTS cancel + truncation event | Medium-High | Needs careful echo cancellation on laptop speakers; headphones make it easy. |
| 12 | Hands-free wake word all day | openWakeWord on CPU | Medium | False accepts depend on phrase and room; custom phrase needs training. |
| 13 | File-watch: new PDF in Downloads → summarise and file it | `dsh-signals` file watch → session → OCR/PDF tools | Medium-High | Ask before moving files. |
| 14 | "Fill this form in the app on screen" (non-browser) | computer use via portal + AT-SPI, cloud CU model | Medium | Portal consent once, token persistence; AT-SPI coverage varies by app. |
| 15 | Same with a local open computer-use model | Holo3 quantised with CPU offload or remote endpoint | Low-Medium | 8 GB VRAM is the constraint; latency per step will be high locally. |
| 16 | Full-duplex chit-chat mode | Moshi or a realtime API provider | Medium (cloud) / Low (local) | Keep out of the tool-using core; log transcripts. |
| 17 | Cross-platform: same commands on macOS/Windows | `os-control-macos` via `osascript`/`shortcuts`; Windows via PowerShell/WinRT/UIA | Medium | Needs TCC grants on macOS; brightness APIs are uneven. |

## 8. Open questions

- Whether to adopt `@livekit/agents` for its Node turn-handling code or reimplement the narrower pieces (Smart Turn, barge-in) directly; the room/WebRTC dependency is the deciding cost.
- Which D-Bus client library for Node is maintained enough for long-lived signal subscriptions; if none, a small sidecar that bridges D-Bus signals to JSON lines is a safe fallback.
- GNOME's handling of RemoteDesktop persistence across reboots and KDE's historical bug there ([KDE bug report](https://www.mail-archive.com/kde-bugs-dist@kde.org/msg877541.html)) need hands-on testing on the Fedora machine.
- Licence review before bundling: Piper (GPL-3.0 now), XTTS (non-commercial), Orpheus (Llama terms), Porcupine (commercial), Chatterbox (check weights licence and watermark implications).
