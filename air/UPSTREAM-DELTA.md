# Upstream delta

Every file AIR changes outside `air/` and `research/`, with the reason. Upstream accepts no external pull requests, so each entry is carried across every upstream merge; keep the list short and prefer new files over edits.

| File | Change | Reason |
|---|---|---|
| `.graphifyignore` | New file | Keep the graphify indexer away from encrypted Office test fixtures |
| `.claude/rules/air.md` | New file | Pointer that Claude Code loads automatically, sending agents to `air/AGENTS.md` |
| `scripts/translation-pairing.manifest.json` | Add `air/` to `excluded` | AIR docs are English-only; the gate otherwise requires Chinese pairs for every `air/**/*.md` |

Candidates not yet made (research.md and the plans): an MCP tool-definition review hook between the `syncTools` fetch and registration phases; streaming methods on the speech-to-text Service Definition; more Claude Code hook events in `hooks-claude-code`; product-name surfaces that no plugin slot or configuration can replace. The desktop app is AIR-owned under `air/apps/` (plan 07), so upstream's `apps/desktop` needs no edits; plan 07 adds one workflow file, `.github/workflows/air-desktop.yml`.
