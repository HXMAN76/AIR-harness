# 10. Local models on the owner's laptop: models, runtime, budgets, evaluation feasibility

Research date: 2026-10-02. Scope: which open-weight models and which runtime AIR should use on the owner's laptop for both the product default and the research evaluation, with probes run on that machine. Inputs: [research.md](../research.md), [note 05](05-memory-context.md), [note 06](06-voice-os-ambient.md), [note 08 §1.4](08-dev-contrib-guide.md), [spike 06](../../air/plans/spikes/06-evaluation.md), [eval pilot plan](../../air/plans/2026-09-30-05-eval-pilot.md).

Labels used throughout: **MEASURED** means run on this machine on 2026-10-02 with the command shown; **CLAIM** means a vendor, benchmark, or community figure quoted from the linked page and not reproduced here; **ESTIMATE** means arithmetic over measured or claimed figures. Nothing was pulled, created, or deleted in Ollama, and no Ollama setting was changed.

## 1. Summary

1. **The largest defect found is silent context truncation.** Ollama's default context on this GPU is 4,096 tokens, and the OpenAI-compatible endpoint has no per-request context field. A 7.9k-token prompt sent to the base tag `qwen2.5:7b-instruct` through `/v1/chat/completions` was cut to 2,050 prompt tokens and the model lost the system prompt (MEASURED, §4.5). The harness prompt alone is about 5k tokens, so every AIR route must use a server-wide `OLLAMA_CONTEXT_LENGTH` or a derived model with `num_ctx`, and AIR should check the loaded context at startup.
2. **Product default: `qwen3:8b` at 16k context with a `q8_0` KV cache.** At the current `f16` KV cache it spills 10% to CPU at 16k and 33% at 32k (MEASURED). `qwen2.5:7b-instruct` stays fully on the GPU even at 32k because its KV cache is about a third the size (MEASURED), which makes it the throughput and judge model.
3. **Runtime: keep Ollama for the product and the main evaluation; add `llama-server` only for the MoE "quality" option.** Prefix reuse across agent steps works in Ollama: a repeated 7.9k-token prefix cost 0.03–0.04 s instead of 3.4–4.9 s (MEASURED).
4. **Native tool calling worked for all three installed chat models** in one round trip each through `/v1` (MEASURED, n = 1 per model; this shows the wire path works, not reliability).
5. **Evaluation is feasible locally for one model at one repeat, not for the full matrix.** A full AgentDojo v1.2.2 harness arm is estimated at 2.6–8 h on `qwen2.5:7b-instruct`; the 13-run plan of spike 06 would be 34–104 h (ESTIMATE). Run the local model on the full benchmark once per main arm and keep repeats and ablations on a cheap hosted model.
6. **The NPU and the iGPU are not worth a dependency.** The kernel driver is loaded here, but the LLM runtime for the NPU is unpackaged on Fedora and uses closed binaries. Treat it as an optional later experiment.

## 2. The machine

MEASURED 2026-10-02 (`nvidia-smi`, `lscpu`, `free -g`, `ollama --version`, `journalctl -u ollama`, `lsmod`, `cat /sys/firmware/acpi/platform_profile`):

| Item | Value |
| --- | --- |
| CPU | AMD Ryzen AI 9 HX 370 w/ Radeon 890M, 24 logical CPUs |
| RAM | 30 GiB total, 19 GiB available at probe time (desktop session and applications held 11 GiB) |
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU, 8,188 MiB; Ollama reports 7.7 GiB total, 7.6 GiB available; 13 MiB used at idle, so the desktop renders on the iGPU |
| Ollama | 0.32.7, CUDA backend (`cuda_v13`), models under `/var/lib/ollama` |
| Ollama server defaults in effect | `OLLAMA_CONTEXT_LENGTH:0` with log line `vram-based default context ... default_num_ctx=4096`; `OLLAMA_NUM_PARALLEL:1`; `OLLAMA_KEEP_ALIVE:5m0s`; `OLLAMA_KV_CACHE_TYPE` unset (log shows `K (f16)`, `V (f16)`); `OLLAMA_FLASH_ATTENTION:false` in the config dump, yet the runner logs `Flash Attention enabled` (automatic); `OLLAMA_MAX_LOADED_MODELS:0` (automatic) |
| NPU | `amdxdna` module loaded, `/dev/accel/accel0` present, kernel 7.2.7 |
| Power state | AC online; platform profile `quiet` |

`nvidia-smi` reported `power.draw` of 590.01 W, which is not physically possible for this GPU; the power reading is not usable on this driver (615.71.09) and energy is not reported in this note.

## 3. Agent models that fit this rig

### 3.1 What decides fit

Three quantities decide whether a model runs fully on the GPU: weight size, KV cache size (context × layers × KV heads × head dimension × bytes per value), and about 0.3–0.5 GiB of runtime buffers. The KV cache differs a great deal between models of the same parameter count, and it was the deciding factor in the probes:

| Model (Q4_K_M) | KV cache, `f16` | Source |
| --- | --- | --- |
| `qwen3:8b` | 2,304 MiB at 16,384 tokens (36 layers), about 141 KiB per token | MEASURED, Ollama runner log `llama_kv_cache: size = 2304.00 MiB (16384 cells, 36 layers ...)` |
| `qwen2.5:7b-instruct` | about 47–57 KiB per token: VRAM grew 464 MiB from 8k to 16k and 764 MiB from 16k to 32k | MEASURED, `nvidia-smi` deltas in §4.3 |

Ollama defaults a GPU under 24 GiB to a 4k context ([Ollama context length docs](https://docs.ollama.com/context-length), read 2026-10-02), so download size plus "a few GB" understates the need at 16k–32k.

### 3.2 Candidates as of October 2026

Sizes and context windows for tags not installed here are CLAIMS from the Ollama library pages ([qwen3.5 tags](https://ollama.com/library/qwen3.5/tags), [gemma4 tags](https://ollama.com/library/gemma4/tags), [granite4.2](https://ollama.com/library/granite4.2), read 2026-10-02) and from a library survey dated 2026-09-29 ([Morph, Best Ollama Models](https://www.morphllm.com/best-ollama-models)). Fit columns for those tags are ESTIMATES until measured.

| Model, Ollama tag | Download | Licence | Tools in Ollama | Trained context | Fit in 8 GB at 16k |
| --- | --- | --- | --- | --- | --- |
| `qwen3:8b` (installed) | 5.2 GB | Apache-2.0 (MEASURED, `ollama show`) | yes, plus thinking | 40,960 | MEASURED: 100% GPU at 8k (6,046 MiB); 10%/90% CPU/GPU at 16k; 33%/67% at 32k. ESTIMATE: fits at 16k with `q8_0` KV |
| `qwen2.5:7b-instruct` (installed) | 4.7 GB | Apache-2.0 | yes | 32,768 | MEASURED: 100% GPU at 8k, 16k, and 32k (5,030 / 5,494 / 6,258 MiB) |
| `llama3.1:8b` (installed) | 4.9 GB | Llama 3.1 Community Licence | yes | 131,072 | MEASURED: 100% GPU at 8k (5,676 MiB); larger contexts not probed |
| `qwen3.5:9b` | 6.6 GB | Apache-2.0 per a third-party table ([Onyx leaderboard](https://onyx.app/self-hosted-llm-leaderboard)); verify on the model card | vision, tools, thinking | 256K | ESTIMATE: tight; 6.6 GB of weights leaves about 1 GiB for KV and buffers, so expect a CPU split at 16k unless the KV cache is small or quantized |
| `qwen3.5:4b` | 3.4 GB (`q8_0`: 5.3 GB) | as above | vision, tools, thinking | 256K | ESTIMATE: fits at 32k |
| `granite4.2:8b` | 5.3 GB | Apache-2.0 | tools, thinking, JSON output | 128K | ESTIMATE: similar to `qwen3:8b`; KV size unknown |
| `granite4.2:3b` | 2.2 GB | Apache-2.0 | tools | 128K | ESTIMATE: fits at 32k |
| `gemma4:e4b-it-qat` | 6.1 GB (`q4_K_M`: 6.6 GB) | sources disagree on the Gemma 4 licence; verify | tools reported unreliable at release, later fixed by model updates ([Micro Center guide, 2026-09-10](https://www.microcenter.com/site/mc-news/article/best-local-llms-8gb-16gb-32gb-memory-guide.aspx)) | 128K | ESTIMATE: tight at 16k; the same guide lists 7.79 GB for a 4-bit build with 32K context |
| `gemma4:e2b-it-qat` | 4.3 GB | as above | as above | 128K | ESTIMATE: fits at 16k |
| `gpt-oss:20b` | 14 GB (MXFP4), 21B MoE with 3.6B active | Apache-2.0 | tools, reasoning always on | 128K | Does not fit; CPU+GPU split (§3.4) |
| `qwen3:30b` / Qwen3-30B-A3B GGUF | 19 GB (Q4_K_M 18.56 GB), about 3B active | Apache-2.0 | tools, thinking | 256K | Does not fit; MoE expert offload (§3.4) |
| `qwen3.6:35b` (35B-A3B) | 24 GB | not checked | tools, vision | 256K | Does not fit the GPU; 24 GB against 7.7 GiB of VRAM plus the 19 GiB of RAM free at probe time leaves almost no margin |
| `devstral:24b`, `mistral-small3.2:24b`, `qwen3.6:27b`, `qwen3.8:27b` | 14–18 GB dense | Apache-2.0 for Devstral; others not checked | tools | 128K–256K | Dense models of this size run mostly on CPU here; not recommended |

Also seen in the survey and not candidates here: `llama4:16x17b` (67 GB), `phi4:14b` (9.1 GB, 16K context, too short for the harness prompt plus history), and cloud-only tags (`glm-5.3`, `kimi-k3`, `deepseek-v4.1-flash`), which have no local weights.

### 3.3 Published tool-use and agent results

- **BFCL v4.** The live leaderboard is at [gorilla.cs.berkeley.edu/leaderboard.html](https://gorilla.cs.berkeley.edu/leaderboard.html). The rows retrieved on 2026-10-02 covered GLM-4.6 (FC thinking, overall 72.38, rank 4) and Granite-4.0-350m (overall 18.98, rank 103); rows for the 4B–9B candidates above were not retrieved in this pass, so this note quotes no BFCL score for them. Read them from the leaderboard before the model choice is written into a report.
- **SWE-bench Verified.** `devstral:24b` states 46.8% on its Ollama card (CLAIM, via the Morph survey). No 8B-class model publishes a comparable figure.
- **Aider polyglot.** Qwen3 32B scores 40.0% and smaller general models far lower (CLAIM, same survey quoting the [Aider leaderboard](https://aider.chat/docs/leaderboards/)); an 8B model should not be expected to produce strict diff edits.
- **AgentDojo with open weights.** A January 2026 defence paper evaluates on AgentDojo with gpt-oss-120b, llama-3.1-70b, and qwen3-32b ([arXiv 2601.04795](https://arxiv.org/html/2601.04795v1)), which is a precedent for open-weight agents on this benchmark but at sizes this laptop cannot run.
- **MCPTox.** Qwen3-8b is one of the evaluated agents: attack success 14% without reasoning and 41.8% with reasoning ([arXiv 2508.14925](https://arxiv.org/html/2508.14925v2), Table 3). This is the only published security figure found for a model installed here.

### 3.4 Partial offload with the 30 GiB of RAM

Mixture-of-experts models are the only larger models worth running here, because llama.cpp can keep attention and the KV cache on the GPU and place expert feed-forward tensors in RAM (`--n-cpu-moe N`, alias `-ncmoe`).

- **gpt-oss-20b.** The llama.cpp guide gives `llama-server -hf ggml-org/gpt-oss-20b-GGUF --ctx-size 32768 --jinja -ub 2048 -b 2048 --n-cpu-moe 16` as its "32k context, 16 layers on the CPU" example ([llama.cpp discussion 15396](https://github.com/ggml-org/llama.cpp/discussions/15396)). A third-party calculator suggests `-ncmoe 11` for an 8 GB card at 8k context, leaving about 5 GB of experts in RAM (CLAIM, [Local AI Master](https://localaimaster.com/tools/moe-vram-calculator)).
- **Qwen3-30B-A3B Q4_K_M.** The same calculator suggests `-ncmoe 33` on 8 GB; 28.99B of its 30.53B parameters are expert tensors (CLAIM). That puts roughly 17 GB in RAM, which fits the 19 GiB available here only with the browser closed.
- **Speed.** A community thread title reports both models measured on an RTX 4060 Laptop GPU with 32 GB RAM ([r/LocalLLaMA, "Poor GPU club"](https://www.reddit.com/r/LocalLLaMA/comments/1nyxmci/poor_gpu_club_8gb_vram_qwen330ba3b_gptoss20b_ts/)), and a comment quoted in search results reports Qwen3.6-35B-A3B Q4_K_S at 41.5 tokens/s on an RTX 4060 Ti 8 GB at 16k context with a `q8` KV cache. Neither page could be read in full, so no tokens/s figure for this laptop is given. Measure with `llama-bench -ngl 99 --n-cpu-moe ...` before committing.
- **Dense 14B models** (for example `qwen3:14b`) split by whole layers, and every CPU layer runs at RAM-bandwidth speed. The 33% CPU split measured on `qwen3-8b-32k` already halved generation speed (20.6 against 37.5–46.8 tokens/s), so a dense 14B model at 16k is expected to be slower still (ESTIMATE).

### 3.5 Ranked shortlist

**(a) Product default**

1. `qwen3:8b` at 16,384 context with `OLLAMA_KV_CACHE_TYPE=q8_0`. Installed, Apache-2.0, native tools verified today, 37–47 tokens/s when fully on GPU (MEASURED at 8k). Turn thinking off for routine tool steps (`reasoning_effort: "none"` worked through `/v1`, §4.4) and on for planning turns.
2. `qwen2.5:7b-instruct` at 32,768 context as the long-context fallback: fully on GPU at 32k, 43 tokens/s (MEASURED). It is a 2024 model without a thinking mode.
3. Candidates to pull and measure before adoption, in this order: `qwen3.5:9b` (newer family, vision, 256K trained context, tight fit), `granite4.2:8b` (Apache-2.0, function-calling focus). Adopt one only if it stays 100% GPU at 16k and passes the tool-call probe of §4.4 at scale.

**(b) Quality option with offload**

1. `gpt-oss:20b` through `llama-server` with `--n-cpu-moe` (command above). Smallest RAM footprint of the MoE options and Apache-2.0.
2. Qwen3-30B-A3B Q4_K_M (GGUF from the `Qwen/Qwen3-30B-A3B` family; Ollama tag `qwen3:30b`) through `llama-server -ngl 99 --n-cpu-moe 33 -c 16384 --jinja`. Needs about 17 GB of free RAM.
3. A cheap hosted model (`deepseek-flash`, already the upstream default route) when quality matters more than locality.

**(c) Fast small model for routing and judging**

1. Reuse the loaded default model with thinking off and a small `max_tokens`. With prefix reuse a follow-up call costs 0.4 s (MEASURED), and no second model has to share the 8 GB.
2. `qwen2.5:7b-instruct` as the local LongMemEval judge during development (no thinking tokens, so `max_tokens 10` is safe; spike 06 §4.5).
3. `granite4.2:3b` (2.2 GB) or `qwen3.5:4b` (3.4 GB) only if a separate router is required; it must run on CPU or it evicts or splits the main model.

## 4. Probe results (MEASURED 2026-10-02)

All probes used Python `urllib` against `http://127.0.0.1:11434`. Native calls: `POST /api/chat` with `{"stream": false, "options": {"num_predict": 96, "temperature": 0, "seed": 7, "num_ctx": <n>}}` and `"think": false` for `qwen3`; rates come from `prompt_eval_count / prompt_eval_duration` and `eval_count / eval_duration`. VRAM: `nvidia-smi --query-gpu=memory.used,temperature.gpu,utilization.gpu --format=csv,noheader`. Placement: `ollama ps`. Each model was unloaded with `ollama stop <model>` between runs. Total probe time was about 3.5 minutes. Every figure is n = 1 or n = 2.

### 4.1 Generation and prompt-evaluation speed at 8,192 context

| Model | Load (cold) | Generation, tokens/s (cold / warm) | VRAM after load | Placement |
| --- | --- | --- | --- | --- |
| `qwen2.5:7b-instruct` | 5.47 s | 46.4 / 48.3 | 5,030 MiB | 100% GPU |
| `llama3.1:8b` | 6.64 s | 48.1 / 44.7 | 5,676 MiB | 100% GPU |
| `qwen3:8b` (thinking off) | 8.92 s | 44.7 / 46.8 | 6,046 MiB | 100% GPU |

A second run of `qwen3:8b` at 8k about three minutes later gave 38.0 and 37.5 tokens/s; GPU temperature had risen from 50 °C to 61–67 °C and the platform profile was `quiet`. Treat 37–47 tokens/s as the range.

### 4.2 Long prefix and prefix reuse

A system message of 260 synthetic records plus a short question (7,916–7,924 prompt tokens for the Qwen tokenizers, 5,787 for Llama), then the same system message with a different question:

| Model | First request: prompt eval | Second request, same prefix: prompt eval | Second request wall time |
| --- | --- | --- | --- |
| `qwen2.5:7b-instruct` | 4.33 s (1,826 tokens/s) | 0.028 s | 0.42 s |
| `llama3.1:8b` | 3.36 s (1,721 tokens/s) | 0.037 s | 0.41 s |
| `qwen3:8b` | 4.90 s (1,617 tokens/s) | 0.038 s | 0.43 s |

Ollama therefore reuses the KV cache for an unchanged prefix across requests to the same loaded model. `prompt_eval_count` still reports the full count on the reused request, so cache hits must be read from the duration, not the count. One anomaly: a 20-token warm prompt on `llama3.1:8b` took 4.66 s of prompt evaluation once; cause not investigated.

### 4.3 Context length against VRAM and placement

| Model and context | VRAM | `ollama ps` size / placement | Generation, tokens/s (cold / warm) |
| --- | --- | --- | --- |
| `qwen3:8b`, `num_ctx` 8,192 | 6,046 MiB | 6.2 GB, 100% GPU | 38.0 / 37.5 |
| `qwen3-8b-16k` (16,384) | 6,858 MiB | 7.8 GB, 10%/90% CPU/GPU | 34.5 / 35.2 |
| `qwen3-8b-32k` (32,768) | 6,724 MiB | 10 GB, 33%/67% CPU/GPU | 20.3 / 20.9 |
| `qwen2.5:7b-instruct`, 16,384 | 5,494 MiB | 5.6 GB, 100% GPU | 40.1 / 42.9 |
| `qwen2.5:7b-instruct`, 32,768 | 6,258 MiB | 6.4 GB, 100% GPU | 42.5 / 43.3 |

The 32k variant of `qwen3:8b` loses about 45% of its generation speed and its short-prompt evaluation rate fell to 75–129 tokens/s. ESTIMATE: with `q8_0` KV the 16k cache is about 1,150 MiB, the same bytes as the 8k `f16` cache, so `qwen3:8b` at 16k should load at about 6.0–6.2 GiB and stay on the GPU; 32k would need `q4_0`.

### 4.4 Native tool-call round trip through `/v1/chat/completions`

Request: two function tools (`get_weather`, `read_file`), user message "What is the weather in Chennai right now in celsius? Use the tool.", `max_tokens` 600, no temperature; then the assistant message plus a `tool` message with a JSON result was sent back.

| Model | Step 1 result | Arguments | Step 1 / step 2 time | Completion tokens, step 1 | Final answer used the tool result |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5:7b-instruct` | `finish_reason: tool_calls`, `get_weather` | `{"city":"Chennai","unit":"celsius"}`, valid JSON | 3.89 s (includes load) / 0.69 s | 28 | yes |
| `llama3.1:8b` | same | same | 4.84 s (includes load) / 0.83 s | 25 | yes |
| `qwen3:8b` | same | same | 7.17 s (includes load) / 4.66 s | 122 | yes |
| `qwen3-8b-16k` | same | same | 8.79 s (includes load) / 5.07 s | 124 | yes |

All four succeeded. `qwen3` spends about 4–5 times the output tokens per step because thinking is on by default, which is why its warm second step takes 4.7–5.1 s against 0.7–0.8 s.

Time to first token (streaming, warm, short prompt): `qwen2.5:7b-instruct` 0.17 s; `llama3.1:8b` 0.28 s; `qwen3:8b` 0.31 s to the first reasoning chunk with no answer content inside 64 tokens; `qwen3-8b-16k` with `reasoning_effort: "none"` 0.31 s to first content. With the 7.9k-token prefix on `qwen3-8b-16k` (thinking off): 5.84 s on first use, 0.42 s when the prefix was already cached.

### 4.5 Default context through the OpenAI-compatible endpoint

The base tags loaded with `CONTEXT 4096` when called through `/v1` (`ollama ps`). Sending the 7.9k-token system message, which began with "SECRET-WORD is PELICAN", to `qwen2.5:7b-instruct` returned `usage.prompt_tokens: 2050` and an answer saying the text contained no secret word. The truncation produced no error. The derived model `qwen3-8b-16k` reported 7,921 prompt tokens for the same text.

### 4.6 Embedder

`POST /api/embed` with `nomic-embed-text`: 768 dimensions; 64 inputs totalling 11,648 tokens in 0.62 s warm; 482 MiB VRAM in use with only the embedder loaded; `ollama ps` showed 323 MB, 100% GPU, context 2,048 (the Modelfile's `num_ctx 8192` is capped by the model's 2,048-token architecture).

## 5. Runtime choice

| Runtime | Tool calls | Prefix / KV reuse | Parallel requests | Context and KV settings | Verdict for this rig |
| --- | --- | --- | --- | --- | --- |
| **Ollama 0.32.7** | Template-based parsing per model; worked for all three installed models (§4.4). Since 0.32.6 a truncated response reports `finish_reason: "length"` instead of `"tool_calls"` (CLAIM, Morph survey citing the release notes) | Works across requests (MEASURED §4.2) | `OLLAMA_NUM_PARALLEL`, default 1; memory scales with parallel × context ([FAQ](https://docs.ollama.com/faq)) | `OLLAMA_CONTEXT_LENGTH`, `num_ctx` in a Modelfile or native `options`; `OLLAMA_KV_CACHE_TYPE` (`f16` default, `q8_0`, `q4_0`); `OLLAMA_FLASH_ATTENTION`; `OLLAMA_KEEP_ALIVE` | **Default.** Already integrated, model store and scheduler included |
| **llama.cpp `llama-server`** | `--jinja` builds a grammar from the tool schemas, so arguments are constrained to the schema; recent issues show grammar edge cases with very large tool sets, for example a build failure above about 58 tools (CLAIM, [llama.cpp issue 28522](https://github.com/ggml-org/llama.cpp/issues/28522), 2026-09) | Per-slot cache; `--cache-ram` host prompt cache | `-np N` slots; context is divided among slots | Every placement choice is a flag: `-c`, `-ngl`, `--n-cpu-moe`, `-ctk`/`-ctv`, `--flash-attn` | **Second runtime for the MoE quality option only.** Check grammar build time and limits against the harness's large tool catalog before relying on it |
| **vLLM** | Good, with guided decoding | Automatic prefix caching, continuous batching | Best of the group | Reserves VRAM up front; no CPU offload; safetensors or AWQ weights | Not suitable for 8 GB |
| **LM Studio** | llama.cpp engine underneath | as llama.cpp | yes | GUI-driven | No advantage for a headless Linux service; closed-source application |
| **TabbyAPI / ExLlamaV2** | Supported, less widely exercised | yes | yes | EXL2 weights and cache quantization; GPU only, no RAM offload | Could fit a larger context for an 8B model, but adds a third weight format; not worth it |

### 5.1 Recommended Ollama settings (owner action; not applied)

Systemd drop-in for the `ollama` service:

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=16384"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
```

- `OLLAMA_CONTEXT_LENGTH` is the way to set context without Modelfiles: it changes the server default that `/v1` requests use, and Modelfile `num_ctx` or native `options.num_ctx` still override it ([context length docs](https://docs.ollama.com/context-length); maintainer statement in [Ollama issue 14116](https://github.com/ollama/ollama/issues/14116), 2026-03-24). The existing `qwen3-8b-16k` and `qwen3-8b-32k` variants keep working.
- `q8_0` roughly halves KV memory; the Ollama FAQ warns that KV quantization does not suit every model, so rerun §4.4 and a long-context recall check after enabling it.
- `OLLAMA_KEEP_ALIVE=30m` avoids the 4–9 s reload measured in §4.1 after the default 5 minutes of idleness. Use `-1` during evaluation runs.
- `OLLAMA_MAX_LOADED_MODELS=2` allows the chat model and the embedder together (6.0–6.2 GiB + 0.47 GiB, §7).
- For evaluation only, `OLLAMA_NUM_PARALLEL=2` with `qwen2.5:7b-instruct` at 16k: two 16k slots need the same KV memory as one 32k context, which loaded at 6,258 MiB fully on GPU (MEASURED for the single 32k context; the two-slot configuration itself was not run). Do not use it with `qwen3:8b`.

### 5.2 Recommended `air` profile route

```yaml
- id: llm-pi-ai
  config:
    providers:
      ollama:
        displayName: Ollama (local)
        apiKeyEnv: OLLAMA_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:11434/v1
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
          - id: qwen3-8b-16k            # or qwen3:8b once OLLAMA_CONTEXT_LENGTH=16384 is set
            contextWindow: 16384
            maxTokens: 4096
          - id: qwen2.5:7b-instruct     # needs OLLAMA_CONTEXT_LENGTH or a num_ctx variant
            contextWindow: 16384
            maxTokens: 4096
```

Three obligations follow from the probes:

1. **`contextWindow` must not exceed the context Ollama actually loaded.** AIR should read `GET /api/ps` after the first request and fail loudly when the loaded context is smaller than the declared window; otherwise compaction thresholds are computed against a window the server silently truncates (§4.5).
2. **Sampling comes from the model's Modelfile because the harness sends no temperature.** `qwen3:8b` carries `temperature 0.6, top_k 20, top_p 0.95, repeat_penalty 1` (MEASURED, `ollama show`); `qwen2.5:7b-instruct` and `llama3.1:8b` carry none and use Ollama's defaults. Evaluation variants with temperature 0 and a fixed seed are already planned in the pilot (Task 4).
3. **Declare reasoning efforts for `qwen3`** so thinking can be disabled per step; note 08 §1.4 says hand-declared models need explicit `reasoningEfforts`. Whether the `openai-completions` route forwards `reasoning_effort` to Ollama was not verified here.

## 6. Embeddings and reranking

| Model | Ollama tag, size | Dimensions | Context | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| nomic-embed-text v1.5 | `nomic-embed-text`, 274 MB (installed) | 768 (MEASURED) | 2,048 loaded (MEASURED); 8,192 advertised | Apache-2.0 (MEASURED) | 482 MiB VRAM, about 18.8k tokens/s (MEASURED). Needs `search_document:` / `search_query:` prefixes |
| EmbeddingGemma | `embeddinggemma` | 768, truncatable to 512/256/128 | 2K | Gemma terms | 308M parameters, under 200 MB RAM quantized (note 05) |
| bge-m3 | `bge-m3`, 567M parameters | 1,024 | 8,192 | MIT | Ollama returns dense vectors only, not the sparse or multi-vector outputs (CLAIM, [WZ-IT, 2026-09](https://wz-it.com/en/blog/best-embedding-models-german/)); MMTEB mean 59.56 (CLAIM, same page) |
| Qwen3-Embedding 0.6B | `qwen3-embedding:0.6b`, 639 MB | 1,024, user-definable from 32 | 32K | Apache-2.0 | MMTEB multilingual 64.33; 4B (2.5 GB, 2,560 dims) 69.45; 8B (4.7 GB, 4,096 dims) 70.58 (CLAIM, [Morph embedding survey](https://www.morphllm.com/ollama-embedding-models)) |

Recommendation: keep `nomic-embed-text` for the first memory slice because it is installed, measured, and small. Evaluate `qwen3-embedding:0.6b` as the upgrade: higher multilingual score, 32K context, adjustable dimensions, and a permissive licence. Store model id and dimension with each vector, as note 05 already requires, so the switch is a lazy re-embed.

Reranking: Ollama has no rerank endpoint (CLAIM, same WZ-IT comparison, 2026-09); a cross-encoder would need `llama-server --reranking` or a Python sidecar. For AIR memory recall the candidate set is small and note 05 already fuses FTS5 BM25 with vector kNN through RRF. A reranker adds a second runtime and CPU latency for an unmeasured gain, so it is not worth it in the first slices. Make it one LongMemEval arm later (RRF against RRF plus `bge-reranker-v2-m3` on CPU) and adopt it only if that arm shows a difference outside the confidence interval.

## 7. Speech alongside the LLM

Note 06 recommends sherpa-onnx in-process for VAD, STT, and Kokoro TTS, CPU by default. The VRAM measurements here confirm that default: with the chat model at 16k there is about 1 GiB of GPU headroom, which is not enough for a GPU Whisper model.

| Component | Placement | VRAM | RAM | Basis |
| --- | --- | --- | --- | --- |
| Chat LLM, `qwen3:8b` 16k, `q8_0` KV | GPU | about 6.0–6.2 GiB | about 1 GiB host | ESTIMATE from the 8k `f16` load (6,046 MiB MEASURED) |
| Chat LLM alternative, `qwen2.5:7b-instruct` 16k | GPU | 5,494 MiB | about 1 GiB host | MEASURED |
| Embedder, `nomic-embed-text` | GPU | about 470 MiB | small | MEASURED (482 MiB total with 13 MiB idle) |
| STT, Parakeet-TDT-0.6b-v3 int8 via sherpa-onnx | CPU, 4 threads | 0 | about 0.6 GB loaded, 1.2 GB reported in use on a phone | CLAIM ([sherpa-onnx issue 2626](https://github.com/k2-fsa/sherpa-onnx/issues/2626), 2025-09); about 640 MB on disk; about 30× real time on an i7-12700KF (CLAIM, [SnailText](https://snailtext.app/blog/whisper-vs-parakeet-tdt/)) |
| TTS, Kokoro-82M via sherpa-onnx | CPU, 2–4 threads | 0 | under 1 GB | 82M parameters is about 330 MB at 32-bit floats (arithmetic); speed on this CPU not measured |
| VAD and wake word (Silero, KWS) | CPU, 1 thread | 0 | tens of MB | note 06 |
| **Total with `qwen3:8b`** | | **about 6.5–6.7 GiB of 7.7 GiB** | about 3–4 GiB on top of the 11 GiB desktop baseline | ESTIMATE |
| Optional: faster-whisper large-v3-turbo on GPU | GPU | 809M parameters is about 1.6 GB at 16-bit floats before buffers (arithmetic) | — | Does not fit beside `qwen3:8b` at 16k; fits beside `qwen2.5:7b-instruct` at 16k only narrowly. Not measured |

CPU contention is the real constraint: when the LLM is fully on the GPU the CPU threads are free for speech; a model with a CPU split (the 32k variant, or the MoE quality option) competes with STT for the same cores and memory bandwidth. Do not combine voice mode with the offloaded quality model.

## 8. Radeon 890M and the XDNA NPU on Linux

- **NPU.** The kernel side is present here (`amdxdna` loaded, `/dev/accel/accel0`). LLMs on XDNA 2 NPUs under Linux became possible in March 2026 with Lemonade 10.0 and FastFlowLM 0.9.35, requiring kernel 7.0 or later, NPU firmware 1.1.0.0 or later, and the XRT stack ([Phoronix, 2026-03-11](https://www.phoronix.com/news/AMD-Ryzen-AI-NPUs-Linux-LLMs); [Lemonade guide](https://lemonade-server.ai/flm_npu_linux.html), which lists Strix Point as supported). Packages exist for Ubuntu and Arch; Fedora means building XRT and the plugin from source. FastFlowLM's NPU kernels are precompiled closed binaries ([Gentoo wiki user page](https://wiki.gentoo.org/wiki/User:Lockal/AMDXDNA)). Reports for this exact CPU are mixed: one HX 370 user on Ubuntu 26.04 says it works after installing the package, another on NixOS reports an XRT incompatibility ([Framework forum thread](https://community.frame.work/t/guide-use-npu-xdna2-with-arch-linux-and-fastflowlm/80879), April 2026). The same thread has one report of gpt-oss-20b at 18 tokens/s on an NPU (hardware not stated).
- **iGPU.** llama.cpp's Vulkan backend can run a model on the 890M using shared system RAM. It would compete with the CPU for the same memory bandwidth and with the desktop for the same GPU, and the Ollama log on this machine lists only the CUDA device.
- **Verdict.** Not worthwhile as a product dependency: Fedora packaging is missing, the runtime is partly closed, and AIR would gain a third inference stack. The one plausible use is a small always-on model (wake-word follow-up, routing, or Whisper) on the NPU so the 4060 can sleep; record it as an optional experiment after the voice slice, not as roadmap work.

## 9. Evaluation feasibility on this rig

### 9.1 Pilot figures used

From the pilot plan (measured on this machine with `qwen2.5:7b-instruct`): AgentDojo banking, n = 5 episodes per arm: native 5.8 s per episode, harness 9.0 s per episode, harness mean 5,094 input and 313 output tokens per episode; tool-free prompts 0.4–3.4 s (n = 5); LongMemEval oracle run about 1 s ingestion and 3–10 s per answer (n = 6). Cross-check with this note's rates: 5,094 tokens at about 1,800 tokens/s plus 313 tokens at about 46 tokens/s is 2.8 s + 6.8 s = 9.6 s with no cache hits, consistent with the 9.0 s measured.

### 9.2 AgentDojo v1.2.2 (949 attack pairs + 97 utility tasks = 1,046 episodes)

| Run | Arithmetic | ESTIMATE |
| --- | --- | --- |
| Native arm, `qwen2.5:7b-instruct` | 1,046 × 5.8 s | 1.7 h if every suite behaved like banking |
| Harness arm, same model | 1,046 × 9.0 s | 2.6 h on the same assumption |
| Harness arm, allowing for longer suites | banking has the shortest tool outputs; workspace, travel, and slack episodes take more steps and tokens; factor 1.5–3 | 4–8 h |
| Harness arm, `qwen3:8b` with thinking on | 4–5 times the output tokens per step (§4.4) and a 10% CPU split at 16k unless KV is quantized | 2–4 times the row above |
| Spike 06 plan, 13 runs (3 arms × 3 repeats + ablations) | 13 × 2.6–8 h | 34–104 h |
| Local subset of spike 06 (banking + slack, 286 episodes) | 286 × 9–27 s | 0.7–2.2 h per arm, against the 4–5 h spike 06 assumed at 40–60 s per episode |

The n = 5 basis is small and from one suite; the pilot's token and latency table should replace these rows as soon as it exists.

### 9.3 LongMemEval 100-question study

Spike 06 sizes it at 100 questions × 8 arms × 3 repeats = 2,400 answers and 2,400 judgments.

- **Answering:** 2,400 × 3–10 s = 2–6.7 h (ESTIMATE from the oracle timing; retrieval arms that fill more of the 16k window sit at the upper end). A full-context arm on the S variant does not fit a 16k or 32k window and stays hosted, as spike 06 already states.
- **Ingestion replay:** under a minute per question on S by the pilot's own estimate, so under 1.7 h for 100 questions, once.
- **Memory extraction by a local model** (arms that build AIR memory): the S variant has about 500 turns per question. Reading that much text at about 1,700 tokens/s and writing short extractions at about 45 tokens/s is several minutes per question, so 100 questions is in the range of 5–10 h per extraction configuration (ESTIMATE; depends entirely on the extractor's prompt design, which does not exist yet).
- **Judge:** 2,400 judgments of about 600 input tokens and at most 10 output tokens is under 1 s each at the measured rates, about 25–40 min locally (ESTIMATE). Local judge: `qwen2.5:7b-instruct`; spike 06 already excludes `qwen3:8b` with thinking because `max_tokens 10` truncates it. A local judge is for development only and must reach κ ≥ 0.8 against the official `gpt-4o-2024-08-06` judge on the 200-pair agreement study; published numbers use the official judge, which costs a few dollars.

AgentDojo needs no LLM judge; it scores environment state.

### 9.4 Parallelism, heat, and power

- **Parallelism.** One GPU, so parallel slots share compute; the gain comes from batching and is model- and runtime-dependent. Only `qwen2.5:7b-instruct` has the VRAM for two 16k slots (§5.1). The pilot plan notes that Ollama at temperature 0 is not bit-reproducible across batch sizes, so fix `OLLAMA_NUM_PARALLEL` per reported run and record it in the manifest. Embedding and judging can run while the GPU is otherwise idle; they should not overlap agent episodes.
- **Heat.** GPU temperature rose from 50 °C to 67 °C within one minute of probing, and generation speed for the same configuration varied between 37.5 and 46.8 tokens/s across two runs minutes apart. The platform profile was `quiet`. For multi-hour runs: AC power, the `performance` or `balanced` platform profile, the laptop raised for airflow, a temperature and tokens/s sample logged per episode, and a resumable episode driver so a thermal shutdown or suspend costs one episode. Disable suspend on lid close for the run.
- **Latency metrics.** Wall-clock and time-to-first-token numbers from a thermally varying laptop are not stable enough to compare arms run hours apart. Interleave arms within a run, or report token counts as the primary overhead metric and latency as secondary with the temperature range.

### 9.5 Recommended split

| Work | Where | Reason |
| --- | --- | --- |
| Pilot, development loops, subsets, mechanism tests | Local, `qwen2.5:7b-instruct` at 16k, temperature 0 | Free, fast enough (minutes to 2 h) |
| AgentDojo full v1.2.2, main arms (N, H0, H-all), 1 repeat | Local, same model, overnight runs | 3 runs × 2.6–8 h; gives the "local-first" result the product claims rest on |
| Same three arms on `qwen3:8b` with thinking on, fixed subset (banking + slack) | Local | Second local model and the reasoning covariate that MCPTox found to matter |
| Repeats (3×), ablations, and the stronger-model comparison | Hosted `deepseek-flash` | Spike 06 estimates about $3.3 per full run and about 45 min with 8 workers; 13 runs about $45 |
| LongMemEval answering and development judging | Local | 2–7 h answering, under 1 h judging |
| LongMemEval final judging and any full-context arm | Hosted (official judge; `deepseek-flash` for full context) | Comparability and context size |

## 10. Research validity when the agent is a small local model

1. **Low attack success can be incapacity, not robustness.** The AgentDojo authors observe that more capable models tend to be more susceptible to injection and that weaker models show lower attack success partly because they fail tasks of any kind ([AgentDojo, arXiv 2406.13352](https://www.alphaxiv.org/abs/2406.13352)). MCPTox reports the same inverse relation for tool poisoning: Qwen3-8b at 14% attack success without reasoning against 41.8% with reasoning, a higher rate for the 32B model, and refusals under 3% for every model, so failures were mostly attacks that were ignored or not executed rather than detected ([arXiv 2508.14925](https://arxiv.org/html/2508.14925v2), §4.3–4.4).
2. **Consequence for AIR's defence claims.** With an 8B agent the undefended attack success may be low, which leaves little room to show a reduction (a floor effect) and makes absolute numbers incomparable with published GPT-4o-class results. Spike 06 already lists this threat; the measurements here add that the thinking setting and the context configuration change both speed and, per MCPTox, vulnerability, so both are experimental conditions, not incidental settings.
3. **How to report it.**
   - Always report benign utility, utility under attack, attack success, and the share of episodes with at least one valid tool call together, with Wilson intervals; never attack success alone.
   - Add attack success conditional on the agent having reached the injected content (the tool result containing the injection was read), so "never got there" is separated from "resisted".
   - State model tag, quantization (Q4_K_M), context length, KV cache type, thinking setting, sampling parameters, runtime version, and `OLLAMA_NUM_PARALLEL` in every table caption. A truncated context (§4.5) would silently remove injections or instructions; assert the loaded context in the run manifest.
   - Report the same arms on at least one stronger hosted model. A defence that is deterministic (pinning, policy, taint rules) should show the same block rate regardless of model; a difference between models then measures the agent, not the defence, and that separation is itself a result.
   - Describe local-model numbers as "local 8B agent under these settings", not as a general property of the defence, and do not compare them with leaderboard figures.
   - Report invalid or malformed tool calls as their own category; MCPTox notes that some agents produce many invalid outputs and that this distorts success rates.

## 11. Open items

- Pull and measure `qwen3.5:9b`, `granite4.2:8b`, and `gpt-oss:20b` (owner decision; about 26 GB of downloads). Repeat §4.1–4.4 for each.
- Apply the settings of §5.1 and re-measure `qwen3:8b` at 16k with `q8_0` KV; confirm 100% GPU.
- Run the tool-call probe at scale with the real harness tool catalog (dozens of tools, 5k-token prompt) and count malformed calls per model; n = 1 per model here shows only that the path works.
- Measure two-slot throughput for `qwen2.5:7b-instruct` before using `OLLAMA_NUM_PARALLEL=2` in any reported run.
- Read BFCL v4 rows for the shortlisted small models from the live leaderboard.
- Verify the Gemma 4 and Qwen 3.5 licences on their model cards before either becomes a default.
