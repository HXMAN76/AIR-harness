# Upstream delta

Every file AIR changes outside `air/` and `research/`, with the reason. Upstream accepts no external pull requests, so each entry is carried across every upstream merge; keep the list short and prefer new files over edits.

| File | Change | Reason |
|---|---|---|
| `.graphifyignore` | New file | Keep the graphify indexer away from encrypted Office test fixtures |
| `scripts/translation-pairing.manifest.json` | Add `air/` to `excluded` | AIR docs are English-only; the gate otherwise requires Chinese pairs for every `air/**/*.md` |

Candidates not yet made (research.md): an MCP tool-definition review hook between the `syncTools` fetch and registration phases; streaming methods on the speech-to-text Service Definition; Linux tray and global hotkey in `apps/desktop/src/`; more Claude Code hook events in `hooks-claude-code`; product-name surfaces that no plugin slot or configuration can replace.
