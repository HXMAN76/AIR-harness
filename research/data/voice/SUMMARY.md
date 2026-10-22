# Voice benchmarks

Run `2026-10-22T07-44-45-365Z`. Every table below is generated from the CSV files named in its section; nothing is typed in by hand.

## Machine and software

- branch: air/feat/voice-metrics-progress
- upstreamTag: dsh-v0.2.1-rc.2
- os: Windows 11 Home 10.0.26300
- cpu: AMD Ryzen AI 9 HX 370 w/ Radeon 890M
- logicalCores: 24
- ramGiB: 31.1
- gpu: NVIDIA GeForce RTX 4060 Laptop GPU
- node: v26.12.0
- ollama: 0.40.7
- modelDigests: {"qwen3-8b-32k:latest":"832ec0a2bf63"}
- kokoroVoice: am_michael

## How to read these numbers

- `n` is the number of measurements behind each row. With fewer than about 30 measurements, p95 and p99 are interpolated between a handful of points and say little about the tail; treat them as the largest values seen, not as estimates of a population.
- Percentiles use linear interpolation between order statistics. Latencies are milliseconds unless a title says otherwise.
- The speech is synthetic (Kokoro and Windows SAPI voices), not a person speaking into the microphone, so recognition and wake rates are likely better than real use. The owner's own clips are reported separately in the wake section and have no ground truth.
- One laptop, one run. The numbers describe this machine at the time of the run and are not a general claim about the software.

## Speech recognition (Parakeet)

Data: `research/data/voice/stt/2026-10-22T07-44-45-365Z` (450 rows in data.csv, manifest.json beside it).

### Parakeet decode latency (ms), per voice

| voice | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kokoro-am_michael | 150 | 121.3 | 118.6 | 156.2 | 161.6 | 181 | 62.6 | 195.9 |
| sapi-david | 150 | 106 | 102.8 | 133.3 | 139.1 | 148.5 | 78.4 | 151.2 |
| sapi-zira | 150 | 102.7 | 99 | 124.2 | 132.5 | 141.5 | 78.3 | 148.7 |
| all voices | 450 | 110 | 105.7 | 142.1 | 152.2 | 169.7 | 62.6 | 195.9 |

### Parakeet real-time factor (decode time / audio time)

| voice | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kokoro-am_michael | 150 | 0.085 | 0.087 | 0.097 | 0.102 | 0.114 | 0.049 | 0.119 |
| sapi-david | 150 | 0.052 | 0.049 | 0.07 | 0.074 | 0.081 | 0.042 | 0.086 |
| sapi-zira | 150 | 0.051 | 0.05 | 0.058 | 0.059 | 0.064 | 0.04 | 0.069 |
| all voices | 450 | 0.063 | 0.054 | 0.09 | 0.095 | 0.104 | 0.04 | 0.119 |

### Word error rate against the spoken text (first decode of each clip)

| voice | clips | ref words | word errors | WER | clips with no error |
| --- | --- | --- | --- | --- | --- |
| kokoro-am_michael | 30 | 112 | 3 | 2.7% | 93.3% |
| sapi-david | 30 | 112 | 3 | 2.7% | 93.3% |
| sapi-zira | 30 | 112 | 6 | 5.4% | 86.7% |
| all voices | 90 | 336 | 12 | 3.6% | 91.1% |

- 90 clips x 5 decodes; decoding is deterministic, so repeats measure timing only and the WER rows use each clip once.
- Cold first decode in this process: 74 ms (excluded from the tables, as is one more warm-up decode).
- Synthetic speech from Kokoro and SAPI; real microphone speech is harder. Latency is the recogniser call only (stream creation to result), as the listener worker measures it.

## Text wake

Data: `research/data/voice/wake/2026-10-22T07-44-45-365Z` (216 rows in data.csv, manifest.json beside it).

### Text wake on the reference text (the matcher alone)

| set | n | rate |
| --- | --- | --- |
| positives woken with the right command | 30 | 100.0% |
| negatives woken (false positives) | 20 | 15.0% |

### Text wake on synthesized speech (recogniser transcript, then the matcher)

| voice | positives | true-positive rate | negatives | false-positive rate | hard negatives | hard false-positive rate | command WER when woken |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kokoro-am_michael | 30 | 100.0% | 20 | 15.0% | 10 | 30.0% | 8.0% |
| sapi-david | 30 | 100.0% | 20 | 15.0% | 10 | 30.0% | 7.1% |
| sapi-zira | 30 | 100.0% | 20 | 15.0% | 10 | 30.0% | 8.0% |
| all voices | 90 | 100.0% | 60 | 15.0% | 30 | 30.0% | 7.7% |

### Text wake on the owner clips (no ground truth; labelled by file, transcripts not kept)

| clip | seconds | woke | command followed | speech without wake | longest decode (ms) |
| --- | --- | --- | --- | --- | --- |
| 2026-10-22-beep.wav | 8 | no | no | 0 | 0 |
| 2026-10-22-rep1.wav | 6 | no | no | 0 | 0 |
| 2026-10-22-rep2.wav | 6 | no | no | 0 | 0 |
| 2026-10-22-sapi-loud-12s.wav | 12 | no | no | 0 | 0 |
| 2026-10-22-sapi-loud-raw.wav | 6 | no | no | 0 | 0 |
| 2026-10-22-sapi-loud.wav | 6 | no | no | 2 | 0 |
| 2026-10-22-silence.wav | 6 | no | no | 0 | 0 |
| 2026-10-22-spk-lg.wav | 8 | no | no | 0 | 0 |
| a-silence.wav | 6 | no | no | 1 | 0 |
| b-sapi-speaker-raw.wav | 6 | no | no | 0 | 0 |
| b-sapi-speaker-raw100.wav | 6 | no | no | 0 | 0 |
| b-sapi-speaker.wav | 6 | no | no | 1 | 0 |
| c-sapi-low.wav | 6 | no | no | 1 | 0 |
| owner-jarvis.wav | 6 | yes | yes | 0 | 85 |
| sapi-jarvis-notepad-low.wav | 2.6 | yes | yes | 0 | 99 |
| sapi-jarvis-notepad.wav | 2.6 | yes | no | 1 | 0 |

### Decode time of the synthesized wake and negative clips (ms)

| set | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all clips | 150 | 111.6 | 108.9 | 141 | 148.6 | 173.6 | 57.4 | 203.9 |

- 150 synthesized clips (3 voices x (30 "Jarvis, ..." + 20 negatives)); one decode each.
- False wakes: "Marvin is a robot" x3; "Davis called me yesterday" x3; "Travis is late again" x3.
- The matcher deliberately accepts names within edit distance 2 of "jarvis" (for example Travis and Davis), so those look-alikes count as false positives by design; the fuzziness buys recall on a mis-heard name.
- Owner clips include recordings made while debugging the microphone, some of them SAPI speech played through the speakers; there is no per-clip label, so no rate is computed for them.

## Speech output (Kokoro and SAPI)

Data: `research/data/voice/tts/2026-10-22T07-44-45-365Z` (120 rows in data.csv, manifest.json beside it).

### Kokoro load time (cold process; model files are in the OS cache after the first run)

| measure | ms |
| --- | --- |
| OfflineTts constructed in this process | 1068 |
| TTS worker process start to READY (load plus one warm-up sentence) | 1534 |

### Time to first audio (ms): speak() call to the first WAV handed to the player

| engine, reply length | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kokoro am_michael, 1 sentence | 20 | 798.2 | 810.7 | 855 | 857.1 | 867.6 | 696.7 | 870.3 |
| kokoro am_michael, 2 sentences | 20 | 758.1 | 782.5 | 841.7 | 874.2 | 900.8 | 536.5 | 907.5 |
| kokoro am_michael, 3 sentences | 20 | 754.5 | 782.9 | 856.7 | 865 | 883.3 | 569.8 | 887.9 |
| sapi, 1 sentence | 20 | 38 | 36.3 | 47.3 | 51.1 | 51.2 | 25.8 | 51.2 |
| sapi, 2 sentences | 20 | 33.9 | 31.4 | 46.7 | 47 | 48.6 | 25.4 | 49 |
| sapi, 3 sentences | 20 | 36.8 | 33.8 | 47.4 | 49.9 | 50.6 | 29.6 | 50.8 |

### Time to render and hand over the whole reply (ms)

| engine, reply length | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kokoro am_michael, 1 sentence | 20 | 798.4 | 810.8 | 855.2 | 857.2 | 867.8 | 696.8 | 870.4 |
| kokoro am_michael, 2 sentences | 20 | 1359.2 | 1346.5 | 1494.5 | 1501.5 | 1506.4 | 1183.5 | 1507.7 |
| kokoro am_michael, 3 sentences | 20 | 1820.8 | 1822.8 | 1968.8 | 2069.4 | 2071.6 | 1561.5 | 2072.2 |
| sapi, 1 sentence | 20 | 38.1 | 36.3 | 47.5 | 51.2 | 51.3 | 25.9 | 51.4 |
| sapi, 2 sentences | 20 | 66 | 62.8 | 79.8 | 91.8 | 93.4 | 56.4 | 93.8 |
| sapi, 3 sentences | 20 | 108.3 | 107.8 | 126.1 | 130.4 | 137.6 | 93 | 139.3 |

### Real-time factor (render time / audio time; below 1 is faster than real time)

| engine, reply length | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kokoro am_michael, 1 sentence | 20 | 0.25 | 0.239 | 0.285 | 0.299 | 0.306 | 0.223 | 0.307 |
| kokoro am_michael, 2 sentences | 20 | 0.244 | 0.241 | 0.268 | 0.269 | 0.273 | 0.224 | 0.274 |
| kokoro am_michael, 3 sentences | 20 | 0.247 | 0.244 | 0.265 | 0.267 | 0.271 | 0.23 | 0.272 |
| sapi, 1 sentence | 20 | 0.01 | 0.01 | 0.013 | 0.013 | 0.013 | 0.007 | 0.013 |
| sapi, 2 sentences | 20 | 0.01 | 0.01 | 0.013 | 0.013 | 0.014 | 0.009 | 0.014 |
| sapi, 3 sentences | 20 | 0.012 | 0.012 | 0.015 | 0.015 | 0.016 | 0.01 | 0.016 |

- 20 replies per cell, rotating through five fixed texts per length; one warm-up reply per engine is excluded.
- Kokoro threads: 4, CPU. Both engines run in a child process and return base64 WAV through a pipe, as in the app.
- Time to first audio ends when the first sentence is handed to the player; the renderer adds a few milliseconds to decode and start it, which is not measured here.

## Local operator

Data: `research/data/voice/operator/2026-10-22T07-44-45-365Z` (7720 rows in data.csv, manifest.json beside it).

### matchOperatorIntent latency (microseconds, all 30 phrases)

| stage | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| match | 6000 | 1.15 | 1 | 1.3 | 1.5 | 2.2 | 0.6 | 605.9 |

### runOperatorIntent with a dry-run runner (ms; includes time/date answers and every open, search, close, volume intent)

| stage | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dry-run | 1700 | 0.01 | 0.001 | 0.022 | 0.024 | 0.052 | 0 | 9.38 |

### Real execution of the safe pair (ms): the PowerShell call returns, Notepad opened or told to close

| stage | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| open notepad | 10 | 360.5 | 347.5 | 392.8 | 427.5 | 455.3 | 327.9 | 462.3 |
| close notepad (CloseMainWindow) | 10 | 284.9 | 283.3 | 297 | 319.3 | 337.1 | 257.4 | 341.5 |

- 19 of the 30 command phrases are operator intents; the others go to the agent.
- URL intents (open youtube, search, gmail) are run only with the dry-run runner, so no browser opens during the benchmark.

## Agent turns (local and cloud route)

Data: `research/data/voice/agent/2026-10-22T07-44-45-365Z` (60 rows in data.csv, manifest.json beside it).

### Turn time, command to final reply (ms), warm turns

| route | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local (warm) | 29 | 1251.6 | 1024 | 1942.5 | 2475.8 | 2755.6 | 785.1 | 2848.9 |
| cloud (warm) | 29 | 1875 | 1449.2 | 2765.3 | 3903.9 | 5010.8 | 1107.5 | 5308.2 |

### Time to the first session event (ms), warm turns

| route | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local (warm) | 29 | 7.8 | 7.9 | 9.3 | 10.1 | 10.5 | 5.8 | 10.6 |
| cloud (warm) | 29 | 5.3 | 5.1 | 6.7 | 7.1 | 8.4 | 3.7 | 8.8 |

### Prompt (input) tokens per turn, summed over the turn's model calls

| route | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local (warm) | 29 | 233 | 233 | 236 | 236 | 236 | 229 | 236 |
| cloud (warm) | 29 | 45 | 2 | 133 | 134 | 136 | 2 | 136 |

### Output tokens per turn

| route | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local (warm) | 29 | 17 | 13 | 28 | 40 | 45 | 9 | 47 |
| cloud (warm) | 29 | 45 | 18 | 143 | 170 | 243 | 8 | 266 |

### Cold first turn (starts the dsh runtime, may load the model)

| route | total (ms) | first event (ms) | prompt tokens | output tokens |
| --- | --- | --- | --- | --- |
| local | 14318 | 2113 | 3461 | 29 |
| cloud | 8456 | 1714 | 4019 | 361 |

### Failed turns

| route | failed | of |
| --- | --- | --- |
| local | 0 | 30 |
| cloud | 0 | 30 |

- 10 prompts x 3 runs per route; every turn starts a new conversation (system prompt only), so context does not accumulate. Tokens come from the model's usage report and are 0 where the provider omits it.
- Local: Ollama, qwen3-8b-32k on the laptop GPU; the model may already be resident in VRAM, which makes the cold turn look better than a true cold start.
- Cloud timings include the network to Ollama Cloud and depend on load there; treat them as one sample of that service.

## End to end (speech in, first audio out)

Data: `research/data/voice/e2e/2026-10-22T07-44-45-365Z` (109 rows in data.csv, manifest.json beside it).

### Operator commands, speech end to first audio (ms)

| span | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| speech end to first audio (e2e) | 82 | 561.4 | 500.5 | 779 | 867.6 | 1289.4 | 306.2 | 1328.8 |
|   speech end to reply text ready | 82 | 81.6 | 73 | 112 | 135.1 | 192.9 | 53.1 | 200.2 |
|   reply ready to first audio (Kokoro first sentence) | 82 | 479.8 | 418 | 695.1 | 752.5 | 1096.4 | 247.1 | 1128.6 |
|   recogniser decode (stt) | 82 | 81.4 | 72.5 | 111.8 | 135 | 192.7 | 53 | 200 |
|   running the intent (dry run) | 82 | 0.2 | 0.1 | 0.3 | 0.3 | 0.6 | 0.1 | 0.9 |
| speech end to wake cue dispatched | 82 | 81.4 | 72.5 | 111.7 | 135 | 192.7 | 53 | 200 |
| e2e plus the 350 ms VAD tail | 82 | 911.4 | 850.5 | 1129 | 1217.6 | 1639.4 | 656.2 | 1678.8 |

### Agent command (local route), speech end to first audio (ms), warm turns

| span | n | mean | p50 | p90 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| speech end to first audio (e2e) | 6 | 2142.3 | 2149.2 | 2205.1 | 2208 | 2210.2 | 2056.4 | 2210.8 |
|   agent turn, command to reply | 6 | 1480.8 | 1482.6 | 1528.7 | 1538.1 | 1545.7 | 1421.1 | 1547.6 |
|   agent first event | 6 | 3.1 | 3.1 | 3.5 | 3.6 | 3.7 | 2.8 | 3.7 |
|   reply ready to first audio | 6 | 564.7 | 557.7 | 593.8 | 599.3 | 603.7 | 535 | 604.8 |
| e2e plus the 350 ms VAD tail | 6 | 2492.3 | 2499.2 | 2555.1 | 2558 | 2560.2 | 2406.4 | 2560.8 |

### Agent command, cold first turn (starts the dsh runtime)

| e2e (ms) | agent turn (ms) | first event (ms) | prompt tokens | output tokens |
| --- | --- | --- | --- | --- |
| 2068.9 | 1447.8 | 2.9 | 41 | 20 |

### CPU and memory of the benchmark process tree during the run

| role | processes | cycles | CPU mean (% of one core) | CPU p95 | CPU max | RSS mean (MiB) | RSS max (MiB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dsh-runtime | 1 | 401 | 0.6 | 2.6 | 85.7 | 131.6 | 191.6 |
| host | 1 | 419 | 0.3 | 1.3 | 5.3 | 131.5 | 139.8 |
| listener | 1 | 419 | 14.8 | 56.2 | 99.5 | 783.3 | 789.4 |
| other:conhost.exe | 2 | 419 | 0 | 0 | 2.5 | 15.7 | 15.9 |
| tts | 1 | 419 | 55.1 | 238 | 390.9 | 589.8 | 604.1 |
| all roles together | 6 | 419 | 70.8 | 254.3 | 433.9 | 1646.4 | 1697 |

- 102 operator turns (51 clips x 2 passes) and 7 agent turns attempted; 0 produced no turn record (not woken or timed out) and 20 took a different path than intended (the command was mis-heard) and are left out of the tables, though they stay in data.csv.
- The wake and command arrive together in text-wake mode, so the cue (beep) is dispatched after the transcript is decoded; "speech end to wake cue" shows that.
- First audio is the moment the first Kokoro WAV is handed to the player; the Electron renderer adds a few milliseconds to decode and start it, and the audio device adds its own buffer. The numbers are from synthetic speech played to the microphone path in software, not a person.
- Roles in the resource table: host is this process (the Electron main process in the app: controller, listener parent, speaker); listener and tts are the worker processes; dsh-runtime is the agent runtime, present once the first agent turn starts it. CPU is percent of one core (the machine has 24 logical cores).

## Idle resources of the app

Data: `research/data/voice/resources/2026-10-22T07-44-45-365Z` (359 rows in data.csv, manifest.json beside it).

### Idle app: CPU and memory by role, one sample per second

| role | processes | cycles | CPU mean (% of one core) | CPU p95 | CPU max | RSS mean (MiB) | RSS max (MiB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dsh-runtime | 1 | 43 | 5.7 | 14.3 | 117.9 | 183.2 | 210.8 |
| electron-gpu | 1 | 45 | 28.1 | 35.2 | 41.1 | 127.7 | 128.6 |
| electron-renderer | 1 | 45 | 18.6 | 26.1 | 28.9 | 101.1 | 107.4 |
| electron-utility | 2 | 45 | 3.2 | 9.8 | 10.8 | 125.8 | 125.8 |
| host | 1 | 46 | 2.2 | 6 | 9.5 | 99 | 103.8 |
| listener | 1 | 45 | 12.3 | 64.5 | 90 | 784.4 | 788.4 |
| other:conhost.exe | 2 | 45 | 0 | 0 | 0 | 15.6 | 15.7 |
| tts | 1 | 45 | 0.1 | 0 | 5.9 | 575.9 | 578 |
| all roles together | 10 | 46 | 68.6 | 133.4 | 160.4 | 1963.1 | 2041.1 |

- 60 s window after 20 s of settling; the app speaks one line at start-up (the model announcement), which falls inside the settle time.
- CPU is percent of one core (a role with several processes is summed; the machine has 24 logical cores). Memory is the working set, which counts shared pages in each process, so the all-roles row overstates the true total.
- Role host is the Electron main process; the renderer, GPU and utility processes belong to Electron. The microphone stays open and the window shows an animated orb, so this is the idle state a user would leave running, not a stopped app.
