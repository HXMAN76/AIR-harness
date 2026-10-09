# Upstream delta

Every file AIR changes outside `air/` and `research/`, with the reason. Upstream accepts no external pull requests, so each entry is carried across every upstream merge; keep the list short and prefer new files over edits.

| File | Change | Reason |
|---|---|---|
| `.graphifyignore` | New file | Keep the graphify indexer away from encrypted Office test fixtures |
| `.claude/rules/air.md` | New file | Pointer that Claude Code loads automatically, sending agents to `air/AGENTS.md` |
| `scripts/translation-pairing.manifest.json` | Add `air/` to `excluded` | AIR docs are English-only; the gate otherwise requires Chinese pairs for every `air/**/*.md` |
| `.github/workflows/air.yml` | New file | CI for `air/main`: builds the fork, then builds, typechecks, lints, tests, and smoke-boots the AIR workspace |
| `packages/mcp/mcp-client/src/review.ts` | New file | `McpToolReview` Service Definition and `Context.mcpToolReview`; the provider is `@air/dsh-mcp-trust` out of tree, so upstream sees a definition and a consumer without a provider |
| `packages/mcp/mcp-client/src/tools.ts` | `ToolBridgeOptions` gains four optional fields, one of them `reviewKey` copied into the review request; `syncTools` calls `reviewGeneration` between fetch and build and publishes instructions at the swap | Tool definitions must be reviewed before any registry mutation; a call-time check alone leaves unreviewed descriptions in the model's context |
| `packages/mcp/mcp-client/src/connection.ts` | Instructions move from a post-attempt assignment into the sync queue slot; reviewer `resync` handle; `reviewKey` copied from the config into the bridge options | Tools and instructions are accepted or rejected together, and a later re-sync can withdraw instructions |
| `packages/mcp/mcp-client/src/index.ts` | Re-export the four review types; optional validated `reviewKey` config field on both transports | Out-of-tree provider imports them from the package root |
| `packages/mcp/mcp-client/tests/review.spec.ts` | New file | Keeps `packages/mcp/mcp-client/src` at 100% coverage; also covers `reviewKey` forwarding and validation |
| `packages/mcp/mcp-client/README.md`, `README.zh.md`, `README.i18n.yaml` | One Source map row, one Lifecycle paragraph, and one config table row (`reviewKey`) per language | Upstream rule: README changes with behavior, in both languages |
| `scripts/gen-cordis-catalog.ts` | One `SERVICE_WALK_EXEMPTIONS` entry for `mcpToolReview` | The catalog gate rejects an optional `Context` key without a provider unless it is listed; the key must be optional so that no reviewer means upstream behavior |
| `docs/config-catalog.md`, `docs/config-catalog.zh.md` | Regenerated (source line number of the mcp-client entry moved from 104 to 105) | Generated from `packages/mcp/mcp-client/src/index.ts`; `verify-config-catalog` fails otherwise |

Candidates not yet made (research.md and the plans): streaming methods on the speech-to-text Service Definition; more Claude Code hook events in `hooks-claude-code`; product-name surfaces that no plugin slot or configuration can replace. The desktop app is AIR-owned under `air/apps/` (plan 07), so upstream's `apps/desktop` needs no edits; plan 07 adds one workflow file, `.github/workflows/air-desktop.yml`.

Merge-conflict exposure of the mcp-client edit is `syncTools` (the phase-1 loop and the swap) and `connectGeneration` (the instruction block). At each upstream sync, re-apply by hand if they conflict, rerun `pnpm exec vitest run packages/mcp/mcp-client/tests --coverage --coverage.include='packages/mcp/mcp-client/src/**/*.ts'`, run `pnpm run gen-config-catalog`, and rerun the `@air/dsh-mcp-trust` and `@air/dsh-mcp-conventions` tests. A provider whose `review` throws or rejects blocks every tool of the reviewed server.
