# @air/voice

## Summary

A wake-phrase voice companion for native Windows (preview). The Electron window captures the microphone at 16 kHz, a Node child process runs a small keyword spotter on every frame, and only after it hears "Jarvis" ("hey Jarvis", "OK Jarvis") does it find the next utterance with Silero VAD and transcribe it (English: NVIDIA Parakeet; Tamil: AI4Bharat IndicConformer). The command text is sent to a dsh session through upstream's TypeScript SDK. Speech without the wake word is never transcribed. The reply is spoken by Windows SAPI. Design: [plan 08](../../plans/2026-10-21-08-voice-agent.md); tasks: [plan 09](../../plans/2026-10-21-09-voice-agent-implementation.md).

The default route is local Ollama (`qwen3-8b-32k`). The cloud routes (Ollama Cloud, model `minimax-m3.1-flash`, for conversation, and the same model with computer use for screen control) are used only when the user asks for them.

## Model Experience

The model sees ordinary user messages: the command text after the wake phrase. A persona instruction in the voice profile asks for one to three short spoken sentences without Markdown. Commands that switch the route, start a new conversation, cancel, or change memory sharing are handled by the app and never reach the model. So are the simple PC commands of the local operator (below), which cost no tokens. For opens that do reach the model, the voice profile loads the `open` tool of `@air/dsh-tool-open` (one short description, `kind` app, url, or search, and `value`), so the 8B model does not write PowerShell for them.

## Setup

Prerequisites: the AIR workspace built (`pnpm -C air install && pnpm -C air run build`) and Ollama running with `qwen3-8b-32k`. Run the steps in this order:

```powershell
pnpm -C air/apps/voice exec tsx scripts/fetch-models.ts   # once; about 1 GB, uses Windows tar.exe
pnpm -C air/apps/voice exec tsx scripts/setup-home.ts     # once; home, workspace, .env, plugins
pnpm -C air/apps/voice build
pnpm -C air run voice
```

Locations (all outside the repository):

| What | Where |
|---|---|
| Voice home (`DSH_HOME` of the voice runtime: `.env`, profile, plugins, memory, session logs) | `%USERPROFILE%\.air\voice-home`. It is not shared with the desktop app, so memory the voice agent writes does not appear there |
| Models | `%USERPROFILE%\.air\voice-models\<name>\` (`kws`, `asr-en`, `asr-ta`, `vad`). They are fetched only by `fetch-models.ts` and never downloaded at launch; a missing model makes the listener exit with "listener unavailable"; run the fetch script |
| Agent workspace (the agent's working directory and the only place its sandbox may write) | `<Documents>\AIR Voice`, where Documents is the folder Windows reports, so a OneDrive-redirected Documents works. The app refuses a workspace that contains or lies inside the voice home, so the key, memory, and profile stay out of reach |

`scripts/setup-home.ts` creates the home and the workspace, adds `OLLAMA_API_KEY=ollama` to the `.env`, and installs the profile plugins. The voice profile patch and the memory rows for the local route ship in `profile/`.

The voice profile loads plugins by name from the voice home's `sdk` profile. `setup-home.ts` installs them there with `dsh plugin --profile sdk add` (the `open` tool, the memory packages, and the MCP client that runs the Playwright browser server on the cloud and screen routes only: its tool definitions cost about 3,700 prompt tokens), skipping any that are already installed. A plugin that is not installed is skipped at boot with a warning and the session runs without its tools.

Memory in the voice profile: `memory_write` normally asks the user, but nobody can answer a prompt by voice (`approval.policy: never`). With no one to ask, a note of type `user` is saved without a prompt and marked agent-inferred (trust low), while a `feedback` note is refused. The persona therefore tells the model to save with type `user`. Pinned notes appear at the start of each new conversation. The 8B model often says it will remember without calling the tool, so the controller rewrites "remember/note/don't forget (that) X" into an explicit memory_write instruction and "what do you remember about X" / "do you remember X" into a memory_search one (the window still shows what you said).

For the cloud routes, add `OLLAMA_CLOUD_KEY=<key>` (an Ollama account key from ollama.com/settings/keys) to `%USERPROFILE%\.air\voice-home\.env`, or set it in the environment. The cloud and screen routes also need a Playwright browser install (`pnpm exec playwright install chromium` at the repository root); see "Web apps (Gmail)".

## Using the voice agent

1. **Wake the agent.** Say "Jarvis" (or "hey Jarvis", "OK Jarvis"). A short beep plays, speech in progress is cut off (barge-in), and the status bar shows "awake". If you say nothing for 6 seconds the agent goes back to sleep.
2. **Speak a command.** Speak the command after the beep (or straight after the word, "Jarvis, open Notepad"); the next utterance is transcribed and sent to the agent. For example, "Jarvis, open Notepad and write a todo list" opens Notepad through `Start-Process` and types the list with `Set-Content`.
3. **Local commands run without the model.** Simple commands are matched first (see "Local operator" below) and answered in a fraction of a second.
4. **Hear the reply.** The agent's reply is spoken by Windows SAPI and shown in the transcript pane. The default voice is the system's first installed SAPI voice; change it in Windows Settings > Time & language > Speech.
5. **Switch routes.** Say "use the cloud model" (Ollama Cloud), "use the screen model" (Ollama Cloud with computer use), or "use the local model" (Ollama). The toggle in the window also switches routes.
6. **Start a new conversation.** Say "new conversation" or "start a new conversation" to clear the session and begin fresh.
7. **Cancel.** Say "cancel", "cancel that", or "never mind" to stop the current utterance and clear the pending command.
8. **Language.** Say "Tamil mode" (or "switch to Tamil") to have commands recognised in Tamil, and "English mode" to go back. English is the default. Tamil commands always go to the agent, because the local operator's patterns are English, and the persona replies in English. The wake word stays "Jarvis" in both modes.
9. **Memory sharing.** Say "share memory with the cloud" or "stop sharing memory" to toggle whether the cloud routes can read and write the AIR memory store. The local route always has access.

## Wake word and speech recognition

| Part | Model | Size on disk | Licence |
|---|---|---|---|
| Wake word | sherpa-onnx KWS zipformer GigaSpeech 3.3M (2024-01-01), int8, streaming | 5.5 MB (18 MB download) | Apache-2.0 (model card); trained on GigaSpeech |
| English | NVIDIA Parakeet TDT 0.6B v2, int8 (sherpa-onnx `nemo_transducer`) | 661 MB (482 MB download) | CC-BY-4.0 (NVIDIA) |
| Tamil | AI4Bharat IndicConformer Tamil, int8 sherpa-onnx NeMo CTC export (`parismitaglobalsolutions/indicconformer-sherpa-onnx`, folder `ta`) | 198 MB | Apache-2.0 per the export's model card; the source model is MIT (AI4Bharat) |
| Speech detection | Silero VAD | 1.8 MB | MIT |

Every model is downloaded by `scripts/fetch-models.ts` into `~/.air/voice-models/<name>/` (`kws`, `asr-en`, `asr-ta`, `vad`). `src/core/models.lock.json` pins each URL, size, and SHA-256 (hashes computed from the first download); the script checks every installed file again after installing, and skips a model whose files already match. Archives are extracted with Windows `tar.exe` started without a shell. The Tamil model loads only when you first switch to Tamil (about 1 to 2 seconds).

The worker (`src/listener-worker.ts`, logic in `src/core/worker-engine.ts`) runs the spotter on every 100 ms frame and sends `{type:'wake'}` at once; then Silero VAD (minimum silence 0.35 s, longest utterance 10 s, 6 s without speech gives up) finds the next utterance, the active recogniser decodes it, and `{type:'command', text, lang}` goes to the controller. The wake phrases are BPE token lines in `src/keywords.txt`; `scripts/gen-keywords.ts` regenerates them from the model's `bpe.model` with sentencepiece (needs `uv`). Keyword boost and threshold are set per line in that script; `AIR_VOICE_KWS_SCORE` and `AIR_VOICE_KWS_THRESHOLD` override the defaults for tuning.

Wake mode. The default is text wake (`AIR_VOICE_WAKE=text`, also the value when the variable is unset): Silero VAD cuts speech into segments, Parakeet decodes every segment of at most 4 seconds, and the transcript counts as a wake only if it starts with a wake phrase: jarvis, javis, jervis, jarvas (and a few other mis-hearings, see `TEXT_WAKE_PHRASES` in `src/core/wake.ts`), alone or after "hey" or "ok". The words after the phrase are the command. Longer speech is not decoded. A transcript without a wake phrase is dropped: it is never logged, stored, or sent on; with `AIR_VOICE_DEBUG=1` only the marker `heard (no wake)` is printed, with no text. The owner's real microphone gave 0 keyword-spotter wakes at thresholds 0.05 to 0.25 but Parakeet transcribed "Hey Javis, open the notepad." from the same clip, which is why text wake is the default. `AIR_VOICE_WAKE=kws` opts back in to the streaming keyword spotter (it accepts only "Jarvis", "hey Jarvis", and "OK Jarvis", and decodes only after a wake). `AIR_VOICE_ASR=sensevoice` uses the old SenseVoice English recogniser (`fetch-models.ts --sensevoice` fetches it).

Conversation. A bare wake ("Jarvis") makes the app say a greeting for the time of day and what it can do: "Good morning. I can read your important mail, read today's news, or open an app. What would you like?" After every spoken reply (operator, agent, greeting) a follow-up window listens for `AIR_VOICE_FOLLOWUP_MS` (default 8000; 0 turns it off) without a wake word. Speech in the window is a new request; 8 seconds of silence returns to idle with nothing spoken. "Stop", "that's all", "thank you", and "thank you Jarvis" end the conversation with "Okay." In the window, "important mail", "my mail", or "emails" start the mail flow and "news" or "headlines" the news. Anything else is a normal request. The window is a `listen` control message with a duration, which the worker honours in text mode too (tested in `tests/worker-engine.spec.ts`).

Models: the default route is the cloud model when `OLLAMA_CLOUD_KEY` is present (the app says "Using the cloud model." once at start), else the local model ("Using the local model."). "Use local" and "use cloud" switch for the session. Operator commands never call a model. Requests that need GUI control (click, scroll, type into, press the, select the, on screen, this window, the button, drag, fill the form) switch to the screen route and say "Screen mode on."; without the key the app says "Screen control needs the cloud key." and stays where it was.

SAPI has no Tamil voice. When a reply contains Tamil script, the window shows it and the app says "Reply is on screen." (Phase 2: Tamil text to speech.) Tamil operator commands, and spoken Tamil mode switches, are matched only as far as the Tamil model transcribes them; Tamil recognition has not been tested with real Tamil speech (no Tamil speech source here).

## Local operator

After the wake phrase and the app commands, the controller tries the operator (`src/core/operator.ts`). A match runs on the PC, is spoken as one short sentence, and never calls the model; the window shows the tool as `operator`. If running it fails, the app says "I couldn't do that." and does not hand the command to the model. Anything that does not match goes to the model as before. Matching is case-insensitive and ignores a leading "please" or "can you" and a trailing "for me".

| Say | Does |
|---|---|
| open browser | opens Google in the default browser |
| open notepad, calculator, paint, file explorer (explorer, files), settings, terminal, command prompt (cmd), edge, chrome, spotify, vs code (code) | starts that app |
| open youtube, gmail, github, google, or a domain such as example.org (.com, .org, .in, .io) | opens the site over https |
| search X, search for X, google X, look up X | Google results for X |
| play X on youtube, search youtube for X | YouTube results for X |
| close notepad, calculator, paint, settings, terminal, command prompt, edge, chrome, spotify, vs code | closes that app's main window gracefully (an app with unsaved work shows its own save prompt; not File Explorer), no confirmation; "close it" / "close that" / "close the app" closes the last app AIR opened this session, or asks "Which app should I close?" |
| volume up, volume down, mute | sends the media key (up and down press it five times) |
| lock screen | says "Say yes to confirm.", then locks the PC once you say yes |
| what time is it, what's the date | answered locally |
| read the news, today's news, headlines, news about X | reads the top 5 headlines of a news feed aloud; no model, no tokens (see News) |

Locking the screen asks first: after "Say yes to confirm." the listener opens a 6 second follow-up window that needs no wake word, and "yes" or "confirm" (also after a wake) runs the command. Any other answer or silence says "Cancelled." and does nothing. Closing an app does not ask: it sends the window a close request, so an app with unsaved work shows its own save prompt.

### News

The operator fetches an RSS feed with Node's `fetch` (default `https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`; a topic uses `https://news.google.com/rss/search?q=<topic>&hl=en-IN&gl=IN&ceid=IN:en`; `AIR_VOICE_NEWS_FEED` overrides both, https only), reads the `<item><title>` elements with a small regex parser (no dependency, nothing evaluated), strips the trailing " - Source", and speaks the top five numbered. On any failure it says "I couldn't get the news." It costs no model tokens.

The text you speak never reaches a shell. Each action is a constant PowerShell script, and the one variable value, an app or URL from the whitelist, travels in the `AIR_OP_TARGET` environment variable; a search is percent-encoded into the URL. Targets are checked again before running: a whitelisted executable, `ms-settings:`, `spotify:`, or a plain `https:` URL. The whitelist and URL rules are the ones in `@air/dsh-tool-open`, shared with the agent's `open` tool.

## Web apps (Gmail)

"Jarvis, send a gmail to asha@example.com saying I am running late" drives a logged-in Gmail in a visible Chromium window and sends after one spoken confirmation. Nothing here has been run against a real browser or a real Gmail account; the steps below are untested.

What is loaded: the cloud and screen routes add `profile/browser.cordis.patch.yml`, an MCP client row for the pinned Playwright MCP server (`@playwright/mcp@0.0.80`) started with `--browser chromium --user-data-dir <voice home>\browser-profile`. Without `--headless` the window is visible, and the profile directory keeps your login across conversations and restarts. The local route never loads these tools (about 3,700 prompt tokens). No upstream file is edited for this.

First-login steps:

1. Run `pnpm exec playwright install chromium` once at the repository root (`scripts/setup-home.ts` prints this reminder). The Playwright version there is the one the patch pins, so the download matches.
2. Put `OLLAMA_CLOUD_KEY` in `%USERPROFILE%\.air\voice-home\.env`.
3. Say "Jarvis, open gmail". The cloud model opens `mail.google.com` in the Chromium window. Sign in there by hand, including any two-step prompt. Google may refuse a sign-in from an automated browser; if it does, this route does not work for that account.
4. Say "Jarvis, check my mail" to confirm the login stuck. Close and restart the app and try again: you should still be signed in.

| Say | Does |
|---|---|
| send, write, or compose a gmail (email, mail) to X saying Y | composes the message in Gmail and stops before Send |
| open gmail (also open email, open my inbox) | the operator opens https://mail.google.com locally: no model, no cloud key needed |
| read my important mail, check my mail (emails, gmail, inbox, unread) | needs the cloud route; the agent opens Gmail, lists up to 5 unread messages in the Important or Primary view, and says one line per message: "From <sender>: <subject>." It never opens attachments, never clicks links inside a mail, and never sends |

Cloud switch: reading and sending need the browser tools, so on the local route the app switches to the cloud model first and says "Using the cloud model." With no cloud key it says "The cloud key is not set.", stays on the local route, and does not call the model. "Open gmail" is not affected: it is an operator command and works with or without the key.

Send gate: the compose instruction tells the model to fill in the recipient, subject, and body, not to press Send, and to end its reply with the exact line `CONFIRM SEND`. The app speaks the draft summary without that line, then says "Say yes to send it." and opens the 6 second follow-up window. "Yes" (or "confirm") sends the follow-up "Now press Send and speak one sentence saying who it went to." Any other answer, or silence, sends "Do not send it." and speaks "Cancelled." The spoken gate is backed by a hard block, not only by an instruction. The plugin `@air/dsh-send-guard` (`air/packages/send-guard`, row in `profile/browser.cordis.patch.yml`, same tool-guard seam the MCP trust plugin uses; no upstream file edited) refuses, with the model-visible error "Sending is locked until the user confirms.", any browser tool call that would send: a click on an element described as Send, Ctrl+Enter / Control+Enter / Meta+Enter, typing with submit, and a script (evaluate / run code) that mentions sending, submitting or clicking. It allows such a call only when the most recent user message of the session carries `[AIR-SEND-<16 hex>]`, a random token the voice app creates after your "yes" and writes as a file in `<voice home>\send-tokens`. The token is appended only to the "Now press Send" prompt, never to the draft prompt, and the guard deletes its file on the one send it allows, so a second send is blocked again. Residual risk: a send path the guard does not recognise (for example Enter on a focused Send button) is not blocked; the guard is a pattern list over Playwright tool calls and was only tested against fake calls.

## Voice approval for escalations

The voice profile uses the workspace-write sandbox with approval policy `ask`, and the only approval answerer is `@air/dsh-voice-approval` (`air/packages/voice-approval`, out of tree). It is default-deny:

- A tool call that asks for a wider sandbox (`sandbox_permissions` plus a justification, for example pwsh outside the workspace) is refused up front with the model-visible text "Needs voice approval: run <command> (<justification>)."
- The app finds that text in the run's events, says "It wants to <summary>. Say yes to allow.", and opens a 6 second window.
- On "yes" it creates a random `[AIR-APPROVE-<16 hex>]` token whose file stores the SHA-256 of that exact tool call (tool name and canonical arguments), and prompts "Approved. Run exactly that command again now. [AIR-APPROVE-...]". The token never reaches the model before the yes. The plugin lets only a call with the same digest through, and deletes the token on the one approval it answers, so it cannot be reused or applied to a different command.
- Anything but "yes", or silence, says "Cancelled." and prompts "Do not run it."
- Every other approval request is rejected. Requests from tools named `mcp__browser__*` are allowed, because the send guard is what protects Send; this is the only automatic allow and is configured in `voice.cordis.patch.yml`.

Memory: `remember` (memory type user) stays hands-free because the voice profile sets the memory tool's `confirmTypes` to feedback only, so under policy `ask` it does not prompt. Feedback notes and forgetting still ask and are denied by the answerer (the tool reports it could not ask).

What needs voice approval: only escalations above workspace-write. Residual risk: commands that stay inside the workspace run without asking, as before. None of this has been run end to end against the real runtime; the plugins are tested with fakes and a real tool registry.

## Architecture

```
Electron renderer (capture worklet, 16 kHz mono)
    |
    | raw Float32 frames
    v
Listener (Node child: keyword spotter -> Silero VAD -> Parakeet / IndicConformer)
    |
    | JSON events: wake, command
    v
Controller (beep, barge-in) -> Command parser
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

The renderer captures audio with an `AudioWorklet` and sends raw frames to the main process. The main process pipes them to the listener child as framed audio (a control frame carries the language switch). The child runs the keyword spotter on every frame; after a wake it uses Silero VAD to find the next utterance and the active recogniser to transcribe it. The command text is classified by `parseVoiceCommand`; `ask` commands first try the operator and otherwise go through the SDK harness to a dsh session, and the reply is spoken by the speaker child.

## Troubleshooting: "Jarvis" does not wake

1. Run `pnpm -C air/apps/voice exec tsx scripts/mic-check.ts 6 mic.wav` and say "Jarvis, open notepad" about two seconds in. It records the default microphone through the app's own capture path, then prints per-frame RMS and peak (`*` marks a clipped frame) and whether the spotter fires at thresholds 0.05, 0.08, 0.10, 0.15, and 0.25. `--say "Jarvis, open notepad." --volume 60` plays Windows speech through the speakers while recording (only useful if the microphone can hear the speakers); `AIR_RECORD_RAW=1` turns off echo cancellation and noise suppression; `score-kws.ts <file.wav> --asr` scores an existing clip and also prints what Parakeet transcribes from it.
2. Transcript right but nothing fires: the spotter is the problem. Quiet speech was one measured cause (a clip with peak 0.07 never fired at any threshold); the spotter is now fed through a boost (`src/core/gain.ts`, up to 8x towards a peak of 0.3, never attenuating), and `--no-gain` scores without it. You can also lower `AIR_VOICE_KWS_THRESHOLD` (default 0.15; 0.05 gave no false wake on the recorded room noise) or raise `AIR_VOICE_KWS_SCORE` (default 2.5).
3. Transcript wrong or empty: the recording is the problem. Check the Windows default input device and its level, and keep the microphone away from the speakers.
4. Text wake is the default and needs no tuning. If you opted into `AIR_VOICE_WAKE=kws` and it never wakes, unset the variable.

## Known Limitations

- Work in progress; see the plan for the parts that exist.
- The wake word is spotted by a small general English model with keywords set in a file, not a model trained for "Jarvis"; accents and noise change how reliably it fires (see the tuning in `src/keywords.txt`). Speech that starts right after the word can lose its first syllable.
- Audio and dropped transcripts are never stored. The console shows wake events and commands only; `AIR_VOICE_DEBUG=1` also prints state changes with transcripts and replies.
- Windows only: SAPI for speech output, PowerShell for the listener worker, and the Electron target is `win32`.
- The cloud routes need an Ollama Cloud key and a Playwright browser install; the browser tools and the `screen` route are untested. The model id `minimax-m3.1-flash` is the catalog name at ollama.com/api/tags as of 2026-10-21; the earlier `minimax/M3-1-Flash` is not in it.
- Tamil is the secondary language: its recogniser is untested on real Tamil speech, its replies are not spoken, and the operator does not run in Tamil mode.
- The operator is English only and matches whole phrases: "open notepad and write my list" goes to the model. Closing an app by name stops every process of that name (after the spoken confirmation).
- Nobody can answer an approval prompt by voice: requests that need one are rejected (the voice profile sets `approval.policy: never`).
- The voice agent has its own dsh home (`%USERPROFILE%\.air\voice-home`); its memory and session logs are separate from the desktop app's.
