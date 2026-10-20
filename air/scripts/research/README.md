# Research scripts

Deterministic experiments for the Phase 1 paper. Both scripts run with Node and tsx on native Windows and Linux, change no product behaviour, and write their output under `research/data/<experiment>/<timestamp>/` at the repository root. Each run directory holds a `manifest.json` with the git branch, the nearest upstream release tag (`git describe --tags --abbrev=0`) and the number of commits after it, whether tracked files were dirty, the OS, and the Node version. Commit hashes are left out on purpose.

Prerequisites: root `pnpm install` and `pnpm run build`, then `pnpm -C air install`.

## E1: prompt-token census

```sh
pnpm -C air exec tsx scripts/research/e1-token-census.ts                 # 3 captures each of standard, air, air-lean
pnpm -C air exec tsx scripts/research/e1-token-census.ts --no-replay     # capture only, no Ollama needed
pnpm -C air exec tsx scripts/research/e1-token-census.ts --captures 5 --presets air,air-lean
```

What it does: it composes a Web profile with the AIR bundle in a throwaway `DSH_HOME`, points the `ollama` route at a recording proxy on 127.0.0.1, and turns off `air-preset-by-model` so that the preset named in `session/create` is the one that runs. For each capture it boots a fresh Web host, creates one Session in an empty temporary workspace with the preset, and sends `Reply OK.` through `session/prompt`. The proxy saves the request body and answers with a canned reply, so no model runs during capture. Afterwards each body is replayed to Ollama's `/v1/chat/completions` with `stream: false` and `max_tokens: 1` to read the prompt token count.

Environment: `AIR_E1_OLLAMA` (default `http://127.0.0.1:11434`), `AIR_E1_MODEL` (default `qwen3-8b-32k`; it must have `num_ctx` above the request size, or Ollama truncates without an error), `AIR_E1_SECONDS` (timeout per capture, default 180).

Output files:

- `requests/<preset>-<n>.json`: the first agent request body exactly as sent. `<preset>-<n>.normalized.json` is the same with the temporary home, the workspace, the checkout path, the Session id, the sampled turn time, and the Web host's port replaced by placeholders (`DYNAMIC_TEXT` and the replacements in the script). The raw bodies always differ between captures because the time-context message carries the sampled time. `<preset>-<n>.all-requests.json` lists every request of that capture (hash and size).
- `census.csv`: one row per capture.
- `tools.csv`: one row per tool of the first capture of each preset.
- `composed-profile.txt`: the composed profile tree (`--dump-config`), normalized.
- `manifest.json`: also the Ollama version, model digest and parameters, and per preset whether the bodies, normalized bodies, and Ollama counts were identical across captures.

`census.csv` columns:

| Column | Meaning |
|---|---|
| `preset`, `capture` | Agent preset and capture number. |
| `sessionRequests` | Model requests the proxy saw during the capture (the first one is analysed). |
| `bodySha256`, `normalizedSha256` | SHA-256 of the body as sent, and of the normalized body. |
| `bodyChars` | Characters of the whole JSON body. |
| `messageCount`, `toolCount` | Messages and tools in the request. |
| `toolsChars` | JSON length of the `tools` array. |
| `systemChars` | Text of system (or developer) messages. |
| `userChars` | Text of all user messages: the typed prompt plus the context messages the harness injects after it. |
| `promptChars` | The typed prompt. |
| `runtimeContextChars` | The runtime-context message: working directory, file and approval policy, checkout path, Web GUI URL. |
| `timeContextChars` | The time-context message (sampled time and time zone). It changes on every turn by design. |
| `skillCatalogChars` | The skill catalog message (`<available_skills>` inside a `<system-reminder>`). |
| `instructionChars` | Every other injected user message, such as instruction files (`AGENTS.md`, `CLAUDE.md`); 0 in an empty workspace. The classification (`classifyUserMessage`) uses the markers the harness writes at `dsh-v0.2.1-rc.2`. |
| `ollamaPromptTokens` | Ollama `usage.prompt_tokens` (its `prompt_eval_count`) for the replayed body. |
| `ollamaNoToolsTokens`, `ollamaPromptOnlyTokens` | First capture only: the same body without `tools`, and the last user message alone. |
| `ollamaToolsTokensByDifference` | `ollamaPromptTokens - ollamaNoToolsTokens`: tokens the tool block adds, including template framing. |
| `heuristic*Tokens` | The harness's fixed heuristic (`packages/llm/token-meter/src/estimate.ts`: ceil(chars / 4) plus framing). Compaction compares this kind of estimate with its threshold until provider usage is available. Tools are priced over the OpenAI `tools` JSON, which is close to but not the harness's own tool envelope. |
| `maxTokens`, `reasoningEffort` | `max_tokens` and `reasoning_effort` of the request. |

There is no offline Qwen tokenizer in this repository, so the only exact token count is Ollama's.

## E2: compaction threshold table

```sh
pnpm -C air exec tsx scripts/research/e2-threshold-table.ts
pnpm -C air exec tsx scripts/research/e2-threshold-table.ts --fixed-prompt-tokens 7686   # also flag thresholds at or below a measured prompt
pnpm -C air exec tsx scripts/research/e2-threshold-table.ts --no-write                   # print only
```

It imports upstream's `resolveConfig`, `resolveTargetPolicy`, and `resolveCompactSpec` from `packages/compaction/compaction-basic/src/config.ts` and evaluates them for windows of 4K, 8K, 16K, 24K, 32K, 64K, 128K, and 200,000 tokens under upstream defaults and under the `compaction-basic` configs that ship in the `preset-air` and `preset-air-lean` rows of `air/bundles/air/cordis.patch.yml`. `--reserved` changes the output reservation (default 4,096, the `maxTokens` of the local model rows). `air/scripts/tests/e2-threshold-table.spec.ts` checks the imported function against an independent re-derivation of the formula.

`thresholds.csv` columns:

| Column | Meaning |
|---|---|
| `window` | Adapter context window in tokens. |
| `arm` | `upstream-default`, `air-full` (preset `air`), or `air-lean`. |
| `model` | AIR model id used for the policy lookup (the first id in `MODEL_WINDOWS` with that window); `(none)` when no AIR model has that window. |
| `policyMatched` | Whether a `modelPolicies` entry matched; without one, upstream defaults apply. |
| `reservedOutputTokens` | Output tokens the request reserves. |
| `thresholdRatio`, `headroomTokens` | Resolved policy fields. |
| `pressureBudgetTokens` | `window - reservedOutputTokens - headroomTokens`. |
| `formulaThresholdTokens` | `floor(min(window x thresholdRatio, pressureBudgetTokens))` without upstream's guard; negative means the formula is broken for this window. |
| `thresholdTokens` | The threshold upstream uses; empty when upstream refuses. |
| `thresholdShare` | `thresholdTokens / window`. |
| `retainTokens` | Verbatim tail kept after compaction. |
| `summaryMaxTokens` | Output cap of the summary request; upstream defaults it to `headroomTokens` (65,536). |
| `outcome` | `compacts`; `never compacts` when the pressure budget is not positive (upstream throws `TargetPressureConfigError`, logs one warning per target, and continues the turn without compacting; overflow recovery still runs); `compacts every step` when `--fixed-prompt-tokens` is given and the threshold is at or below it. |
| `note` | Upstream's error message, or why defaults apply. |
