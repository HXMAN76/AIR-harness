# @air/dsh-compaction-log

## Summary

A compaction engine that is upstream's `BasicCompactionEngine` with one change: the summary request ends with an extra section that asks the model for a numbered chronological log and the first request of the session. Replay, thresholds, `modelPolicies`, retention, checkpoint framing, and the durable session log are upstream's, unchanged.

With the stock instruction, an 8B local model wrote a summary that named only the most recent file (f4) and then answered "f4" to "which file did you read first" (the truth was f1). With one added rule, "Chronological Log: every user request and tool call, numbered, in order", the summary listed f1 to f4 in the right order (367 tokens instead of 205). A manual replay of a saved real summary request on `qwen3-8b-32k` with the section produced by this package listed f1, f2, f3, f4 in order and quoted the first request; the reply used 708 output tokens in total.

## How it works

The engine overrides `summarize()`, the hook upstream documents for custom summarizers, and calls upstream's implementation. For the duration of that call it registers an `llm/stream` listener. When the summary call of the same session reaches the listener, the listener removes itself and sends the request again with the section appended to the text of the final user message, which holds upstream's instruction. All other requests pass unchanged, and the listener is removed when the summary call ends or fails. The appended text:

- `## Chronological Log`: every user request and every tool call, numbered and oldest first, with the tool name, the key argument (path, command, query), and a few words of the result; entries of a prior checkpoint's log are carried forward in order without dropping or reordering; at most `logMaxEntries` entries, merging the oldest into one line that still names their files and commands.
- `## First request`: the first user request of the session verbatim, cut to `firstRequestMaxChars` characters, or the quote kept from a prior checkpoint.

Because the request is only extended, the conversation prefix is unchanged and the provider's prefix cache is reused as with the stock engine.

## Config

Every field of upstream's `compaction-basic` row is accepted and passed through unchanged, `modelPolicies` included. The two AIR presets keep the row id `compaction-basic` and change only the package name. A bundle patch cannot change a row's package, so the headless bundle turns the stock `compaction-basic` row off and inserts this engine as the row `air-compaction-log` with the same policies.

| Field | Default | Meaning |
|---|---|---|
| `logMaxEntries` | `60` | Most entries in the chronological log. Integer, at least 2. |
| `firstRequestMaxChars` | `300` | Most characters of the first request that the summary quotes. Positive integer. |

A bad value fails the engine's load with a message naming the field.

## Model Experience

The summary request is longer by about 330 tokens (the added section) and the summary is longer by the log: about 160 tokens more in the measured case, growing by one line per user request or tool call up to the cap. The summary call needs room for the log, so keep the row's `maxTokens` (the summary output limit) at 2048 for 32K windows; the AIR policies already do. The model after compaction sees the log inside the `<compacted-summary>` block and can answer order questions from it. The cached conversation prefix is unchanged.

## Known Limitations and Deferred Work

- The log is written by the same small model, so entries can be wrong or incomplete; the original events stay in the session log.
- When the log passes the cap, the oldest entries are merged by the model, which can lose individual steps. The default cap of 60 entries is an estimate for 32K windows, not a measured limit.
- The rewrite depends on upstream's summary request ending with the instruction as its final user message. If that changes, the engine fails the compaction with a clear error instead of sending a malformed request.
- Checked with upstream's real loop and the Loader in automated tests and with one manual replay on `qwen3-8b-32k`. Not yet checked live in the desktop app.
