# @air/voice

## Summary

A wake-phrase voice companion for native Windows (preview). The Electron window captures the microphone at 16 kHz, a Node child process finds speech with Silero VAD and transcribes it with SenseVoice, and a transcript that starts with the wake word ("Jarvis", "hey Jarvis", and its common mis-hearings) is sent as a command to a dsh session through upstream's TypeScript SDK. The reply is spoken by Windows SAPI. Design: [plan 08](../../plans/2026-10-21-08-voice-agent.md); tasks: [plan 09](../../plans/2026-10-21-09-voice-agent-implementation.md).

The default route is local Ollama (`qwen3-8b-32k`). The cloud routes (Claude Haiku for conversation, Claude Sonnet with computer use for screen control) are used only when the user asks for them.

## Model Experience

The model sees ordinary user messages: the command text after the wake phrase. A persona instruction in the voice profile asks for one to three short spoken sentences without Markdown. Commands that switch the route, start a new conversation, cancel, or change memory sharing are handled by the app and never reach the model.

## Setup

Prerequisites: the AIR workspace built (`pnpm -C air install && pnpm -C air run build`), Ollama running with `qwen3-8b-32k`, and the voice models downloaded.

```powershell
pnpm -C air/apps/voice install
pnpm -C air/apps/voice build
pnpm -C air run voice
```

The first launch downloads the three model files (Silero VAD, SenseVoice, and the tokenizer) into `air/apps/voice/models/` if they are not present. The voice home is created at `$DSH_HOME` (or `apps/desktop/.desktop-build/development/home`) by `scripts/setup-home.ts`, which writes the voice profile patch, adds `OLLAMA_API_KEY=ollama` to the `.env`, and pins the memory rows for the local route.

For the cloud routes, add `OLLAMA_CLOUD_KEY=<key>` (an Ollama account key from ollama.com/settings/keys) to the same `.env` file. The `screen` route also needs a Playwright browser install (`npx playwright install chromium`).

## Using the voice agent

1. **Wake the agent.** Say "Jarvis" (or "hey Jarvis", "OK Jarvis", and common mis-hearings the recogniser returns). The status bar shows "listening" while the microphone is active and "awake" after the wake phrase is found.
2. **Speak a command.** The text after the wake phrase is sent to the agent. For example, "Jarvis, open Notepad and write a todo list" opens Notepad through `Start-Process` and types the list with `Set-Content`.
3. **Hear the reply.** The agent's reply is spoken by Windows SAPI and shown in the transcript pane. The default voice is the system's first installed SAPI voice; change it in Windows Settings > Time & language > Speech.
4. **Switch routes.** Say "use the cloud model" (Claude Haiku), "use the screen model" (Claude Sonnet with computer use), or "use the local model" (Ollama). The toggle in the window also switches routes.
5. **Start a new conversation.** Say "new conversation" or "start a new conversation" to clear the session and begin fresh.
6. **Cancel.** Say "cancel", "cancel that", or "never mind" to stop the current utterance and clear the pending command.
7. **Memory sharing.** Say "share memory with the cloud" or "stop sharing memory" to toggle whether the cloud routes can read and write the AIR memory store. The local route always has access.

## Architecture

```
Electron renderer (capture worklet, 16 kHz mono)
    |
    | raw Float32 frames
    v
Listener (Node child: Silero VAD + SenseVoice)
    |
    | JSON segments
    v
Wake matcher -> Command parser
    |                |
    | ask            | route / new / cancel / memory-share
    v                v
SDK harness -----> Controller (handles locally)
    |
    | agent reply
    v
Speaker (PowerShell SAPI)
```

The renderer captures audio with an `AudioWorklet` and sends raw frames to the main process. The main process pipes them to the listener child, which runs Silero VAD to find speech boundaries and SenseVoice to transcribe. Transcripts that start with a wake phrase are classified by `parseVoiceCommand`; `ask` commands go through the SDK harness to a dsh session, and the reply is spoken by the speaker child.

## Known Limitations

- Work in progress; see the plan for the parts that exist.
- Wake matching is text-based on the full transcript; there is no trained wake-word model.
- Audio and dropped transcripts are never stored.
- Windows only: SAPI for speech output, PowerShell for the listener worker, and the Electron target is `win32`.
- The cloud routes need an Ollama Cloud key and a Playwright browser install; the `screen` route is untested.
- Nobody can answer an approval prompt by voice: requests that need one are rejected (the voice profile sets `approval.policy: never`).
- The voice agent shares its dsh home with the desktop app; session logs are written to the same home.
