# @air/voice

## Summary

A wake-phrase voice companion for native Windows (preview). The Electron window captures the microphone at 16 kHz, a Node child process finds speech with Silero VAD and transcribes it with SenseVoice, and a transcript that starts with the wake word ("Jarvis", "hey Jarvis", and its common mis-hearings) is sent as a command to a dsh session through upstream's TypeScript SDK. The reply is spoken by Windows SAPI. Design: [plan 08](../../plans/2026-10-21-08-voice-agent.md); tasks: [plan 09](../../plans/2026-10-21-09-voice-agent-implementation.md).

The default route is local Ollama (`qwen3-8b-32k`). The cloud routes (Ollama Cloud, model `minimax-m3.1-flash`, for conversation, and the same model with computer use for screen control) are used only when the user asks for them.

## Model Experience

The model sees ordinary user messages: the command text after the wake phrase. A persona instruction in the voice profile asks for one to three short spoken sentences without Markdown. Commands that switch the route, start a new conversation, cancel, or change memory sharing are handled by the app and never reach the model. So are the simple PC commands of the local operator (below), which cost no tokens. For opens that do reach the model, the voice profile loads the `open` tool of `@air/dsh-tool-open` (one short description, `kind` app, url, or search, and `value`), so the 8B model does not write PowerShell for them.

## Setup

Prerequisites: the AIR workspace built (`pnpm -C air install && pnpm -C air run build`), Ollama running with `qwen3-8b-32k`, and the voice models downloaded.

```powershell
pnpm -C air/apps/voice install
pnpm -C air/apps/voice build
pnpm -C air run voice
```

The first launch downloads the three model files (Silero VAD, SenseVoice, and the tokenizer) into `air/apps/voice/models/` if they are not present. The voice home is created at `$DSH_HOME` (or `apps/desktop/.desktop-build/development/home`) by `scripts/setup-home.ts`, which writes the voice profile patch, adds `OLLAMA_API_KEY=ollama` to the `.env`, and pins the memory rows for the local route.

The voice profile loads plugins by name from the voice home's `sdk` profile. `pnpm -C air/apps/voice exec tsx scripts/setup-home.ts` installs them there with `dsh plugin --profile sdk add` (the `open` tool, the memory packages, and the Playwright browser), skipping any that are already installed. A plugin that is not installed is skipped at boot with a warning and the session runs without its tools.

Memory in the voice profile: `memory_write` normally asks the user, but nobody can answer a prompt by voice (`approval.policy: never`). With no one to ask, a note of type `user` is saved without a prompt and marked agent-inferred (trust low), while a `feedback` note is refused. The persona therefore tells the model to save with type `user`. Pinned notes appear at the start of each new conversation. The 8B model often says it will remember without calling the tool; saying "use the memory_write tool" works.

For the cloud routes, add `OLLAMA_CLOUD_KEY=<key>` (an Ollama account key from ollama.com/settings/keys) to the same `.env` file. The `screen` route also needs a Playwright browser install (`npx playwright install chromium`).

## Using the voice agent

1. **Wake the agent.** Say "Jarvis" (or "hey Jarvis", "OK Jarvis", and common mis-hearings the recogniser returns). The status bar shows "listening" while the microphone is active and "awake" after the wake phrase is found.
2. **Speak a command.** The text after the wake phrase is sent to the agent. For example, "Jarvis, open Notepad and write a todo list" opens Notepad through `Start-Process` and types the list with `Set-Content`.
3. **Local commands run without the model.** Simple commands are matched first (see "Local operator" below) and answered in a fraction of a second.
4. **Hear the reply.** The agent's reply is spoken by Windows SAPI and shown in the transcript pane. The default voice is the system's first installed SAPI voice; change it in Windows Settings > Time & language > Speech.
5. **Switch routes.** Say "use the cloud model" (Ollama Cloud), "use the screen model" (Ollama Cloud with computer use), or "use the local model" (Ollama). The toggle in the window also switches routes.
6. **Start a new conversation.** Say "new conversation" or "start a new conversation" to clear the session and begin fresh.
7. **Cancel.** Say "cancel", "cancel that", or "never mind" to stop the current utterance and clear the pending command.
8. **Memory sharing.** Say "share memory with the cloud" or "stop sharing memory" to toggle whether the cloud routes can read and write the AIR memory store. The local route always has access.

## Local operator

After the wake phrase and the app commands, the controller tries the operator (`src/core/operator.ts`). A match runs on the PC, is spoken as one short sentence, and never calls the model; the window shows the tool as `operator`. If running it fails, the app says "I couldn't do that." and does not hand the command to the model. Anything that does not match goes to the model as before. Matching is case-insensitive and ignores a leading "please" or "can you" and a trailing "for me".

| Say | Does |
|---|---|
| open browser | opens Google in the default browser |
| open notepad, calculator, paint, file explorer (explorer, files), settings, terminal, command prompt (cmd), edge, chrome, spotify, vs code (code) | starts that app |
| open youtube, gmail, github, google, or a domain such as example.org (.com, .org, .in, .io) | opens the site over https |
| search X, search for X, google X, look up X | Google results for X |
| play X on youtube, search youtube for X | YouTube results for X |
| close notepad, calculator, paint, settings, terminal, command prompt, edge, chrome, spotify, vs code | stops that app's process (not File Explorer) |
| volume up, volume down, mute | sends the media key (up and down press it five times) |
| lock screen | locks the PC |
| what time is it, what's the date | answered locally |

The text you speak never reaches a shell. Each action is a constant PowerShell script, and the one variable value, an app or URL from the whitelist, travels in the `AIR_OP_TARGET` environment variable; a search is percent-encoded into the URL. Targets are checked again before running: a whitelisted executable, `ms-settings:`, `spotify:`, or a plain `https:` URL. The whitelist and URL rules are the ones in `@air/dsh-tool-open`, shared with the agent's `open` tool.

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
Operator ------> Controller (handles locally)
    | no match
    v
SDK harness
    |
    | agent reply
    v
Speaker (PowerShell SAPI)
```

The renderer captures audio with an `AudioWorklet` and sends raw frames to the main process. The main process pipes them to the listener child, which runs Silero VAD to find speech boundaries and SenseVoice to transcribe. Transcripts that start with a wake phrase are classified by `parseVoiceCommand`; `ask` commands first try the operator and otherwise go through the SDK harness to a dsh session, and the reply is spoken by the speaker child.

## Known Limitations

- Work in progress; see the plan for the parts that exist.
- Wake matching is text-based on the full transcript; there is no trained wake-word model.
- Audio and dropped transcripts are never stored.
- Windows only: SAPI for speech output, PowerShell for the listener worker, and the Electron target is `win32`.
- The cloud routes need an Ollama Cloud key and a Playwright browser install; the `screen` route is untested. The model id `minimax-m3.1-flash` is the catalog name at ollama.com/api/tags as of 2026-10-21; the earlier `minimax/M3-1-Flash` is not in it.
- The operator is English only and matches whole phrases: "open notepad and write my list" goes to the model. Closing an app by name stops every process of that name without asking.
- Nobody can answer an approval prompt by voice: requests that need one are rejected (the voice profile sets `approval.policy: never`).
- The voice agent shares its dsh home with the desktop app; session logs are written to the same home.
