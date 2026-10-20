# @air/voice

## Summary

A wake-phrase voice companion for native Windows (preview). The Electron window captures the microphone at 16 kHz, a Node child process finds speech with Silero VAD and transcribes it with SenseVoice, and a transcript that starts with the wake word ("Jarvis", "hey Jarvis", and its common mis-hearings) is sent as a command to a dsh session through upstream's TypeScript SDK. The reply is spoken by Windows SAPI. Design: [plan 08](../../plans/2026-10-21-08-voice-agent.md); tasks: [plan 09](../../plans/2026-10-21-09-voice-agent-implementation.md).

The default route is local Ollama (`qwen3-8b-32k`). The cloud routes (Claude Haiku for conversation, Claude Sonnet with computer use for screen control) are used only when the user asks for them.

## Model Experience

The model sees ordinary user messages: the command text after the wake phrase. A persona instruction in the voice profile asks for one to three short spoken sentences without Markdown. Commands that switch the route, start a new conversation, cancel, or change memory sharing are handled by the app and never reach the model.

## Known Limitations

- Work in progress; see the plan for the parts that exist.
- Wake matching is text-based on the full transcript; there is no trained wake-word model.
- Audio and dropped transcripts are never stored.
