# Phase 1 review talk: slide outline

Companion to `phase1-paper.md`. Twelve slides, about 15 minutes plus questions. The product name is the placeholder `{{PRODUCT_NAME}}` (working name AIR). The upstream project is named only on the related-work slide, as `air/BRANDING.md` requires. Every number below appears in the paper and is mapped to its source in `evidence-map.md`.

## Slide 1. Title and one-sentence claim

- Title: fitting a verifiable agent harness onto an 8 GB GPU.
- One sentence: on a consumer laptop the harness's own fixed prompt is a first-order design constraint, and Phase 1 built and checked the plugins that respond to it.
- Say up front: Phase 1 is a built system with hand-run checks, not a benchmark study.

## Slide 2. Problem

- Hosted-model harnesses assume large windows; an 8B local model gets 16,384 or 32,768 tokens.
- First live request: about 8,500 tokens before any conversation, 52 to 54 percent of a 16K window.
- Runtime default: 4,096-token context, with silent truncation (7.9k-token request reported as 2,050 tokens).
- Visual: a bar showing fixed prompt versus window.

## Slide 3. Research questions

- RQ1 context budget. RQ2 convention compatibility. RQ3 review before registration. RQ4 extension footprint.
- Note: formulated after the work, not pre-registered.

## Slide 4. Related work and positioning (the one slide that names upstream)

- Built on a fork of an MIT-licensed open-source agent harness; attribution as in the branding plan.
- Conventions have converged (AGENTS.md, Agent Skills, MCP); at least seven systems already pin MCP tool definitions.
- Consequence: pinning is a component, not the claim.

## Slide 5. Architecture in one picture

- Out-of-tree workspace: ten packages, five bundles, loaded into the desktop app, Web UI, and headless runner.
- Two rules: stay out of tree; no custom session event types (audit goes to sidecar files).
- Delivery: desktop first, Windows and Linux, local Ollama route by default.

## Slide 6. Context-budget mechanisms

- Lean preset, preset by model (window below 65,536 tokens), thinking off for Qwen 3, per-model compaction policies, chronological log in summaries.
- Show the table: 36 tools / 8,113 tokens, 32 / 7,686, and 19 / 4,426.

## Slide 7. Finding: hosted-window assumptions

- Compaction threshold uses a 65,536-token headroom; negative for 16K and 32K windows; compaction never ran on local models until 2026-10-12.
- Symptom was cut-off replies, not an error.
- After the fix: prompts fell by 34 to 39 percent in four sequences (derived from check E8).

## Slide 8. Compaction keeps order

- Stock summary named only the last file; answered "f4" when the first was f1.
- Chronological log: f1 to f4 in order (367 versus 205 tokens); live check over 11 messages answered "f1.txt".
- Caveat on the slide: single observation, one model, log written by the same small model.

## Slide 9. Window size versus speed on 8 GB

- Table for `qwen3:8b`: 40, 33, 21, 15 tokens per second and 100, 90, 76, 67 percent on GPU at 8K, 16K, 24K, 32K.
- `qwen2.5:7b-instruct` stays at 48 tokens per second but was worst in the harness (12 of 18 against 17 of 18).
- Decision: 32K default, 16K as faster but tight; Windows first run 17 tokens per second.

## Slide 10. Conventions and MCP review: what was checked

- Hand-run demo: instructions with import, command, skill, and an `.mcp.json` server worked unchanged.
- MCP: approve, diff, pin, tool call returned the echo result; declined tool stayed unavailable; two gaps found live and fixed.
- 308 plus 48 plus 72 tests, 27 drift scenarios mapped; no drift corpus or baseline comparison yet.
- 23 files outside the AIR workspace, three behavioral edits.

## Slide 11. Honest limits

- Single runs, one laptop class, one model family, 10-task reliability set, string-match scoring.
- Raw data of the 2026-10-10 runs lost; Windows covered only through a first prompt.
- Not run: hosted models, benchmarks, user study, drift corpus, memory, permissions.

## Slide 12. Phase 2 and the ask

- Plan 05: drift mini-corpus and token table. Plan 06: AgentDojo pilot. Plans 03 and 04: permissions and memory. Plan 07: rewrite for installer and first-run setup.
- Before the next review: repeat the context measurements with scripts kept in the repository; decisions needed from the owner (rubric, scope cuts, model for the deep tier, product name).

## Demo script (optional, 3 minutes)

1. Launch the desktop app on the lean preset and show "AIR Lean", the model, and effort Off.
2. Open the demo project; run `/mcp`, `/mcp approve demo`, `/mcp-trust diff demo`, then the printed pin command.
3. Send a file-reading prompt sequence that triggers the "Context compacted" row.

Keep a recorded fallback; the Windows application path was checked only to the first prompt.
