# @air/dsh-instruction-conventions

## Summary

A companion to upstream `agent-instructions`, mounted in the same agent preset. Upstream keeps loading `AGENTS.md` and `CLAUDE.md` chains; this plugin adds what upstream does not interpret:

| Input | When it is injected |
|---|---|
| `<project>/.claude/CLAUDE.md` | baseline |
| `<claudeHome>/CLAUDE.md` | baseline, only with `includeUserRoots: true` |
| `@path` imports found in the two files above and in `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` between the project root and the cwd | baseline |
| `.claude/rules/**/*.md` without `paths:` | baseline |
| `.claude/rules/**/*.md` with `paths:` | after the first successful `read`, `write`, or `edit` on a matching file |

Imports follow Claude Code semantics: at most 4 hops, each file once, code spans and fenced blocks ignored, relative paths resolved against the importing file. An import is read only when both its path and its real path (symbolic links resolved) are inside the project root or an `allowedImportRoots` entry (or under `claudeHome` with `includeUserRoots`), it is not a credential-like file (`.env*`, SSH keys, `.pem`/`.key`, anything under `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.npmrc`, `.netrc`), and it is no larger than `maxBytes`; otherwise the baseline names it in a `<skipped reason="outside-project|sensitive|too-large|max-hops"/>` line.

The baseline is one user message with source `{ kind: 'air-instructions', form: 'instructions', baseline: true, digest }`, added on `agent/pre-step` after the messages the step claimed, at step 1 of each turn only. It is added again only when the digest of the assembled text differs from the latest baseline in the session, which also covers resume and compaction. A convention file that cannot be read is logged and the turn continues without the baseline. A path-scoped rule is a user message with source `{ kind: 'air-instructions', form: 'instructions', rule, digest }`, returned as `additionalContexts` from `tools/post-execute`, once per session and rule content.

Config: `maxBytes` (required; the AIR bundle sets 32768), `claudeHome`, `includeUserRoots` (default `false`), `allowedImportRoots` (default `[]`), `projectRootMarkers` (default `['.git']`).

## Model Experience

Before its first request the model receives an `<air_instructions>` block listing each file as `<file path="...">` with its text, followed by `<skipped .../>` lines for imports that were not read. After touching a file that matches a rule's `paths:` globs, the model receives `<air_rule path=".claude/rules/...">` with the rule text along with that tool result.

## Known Limitations

- `.cursor/rules/*.mdc` and `.kiro/steering/*.md` are not read yet.
- Outside-project imports use an allowlist, not an approval prompt.
- The files upstream injects (`AGENTS.md`, `CLAUDE.md` and their local variants) keep their `@path` text; the imported content arrives in the separate `<air_instructions>` block.
- Identical text is removed only inside this plugin's block. A file that upstream also injects under another path can appear twice.
- A file larger than the remaining `maxBytes` budget is left out whole and named in a `<skipped reason="budget"/>` line.
- Convention files are re-read once per turn; a changed file causes a new baseline message, which invalidates the provider's prompt cache from that point. An edit made during a turn is seen on the next turn.
- The credential-file list is a name heuristic, not a scanner; keep secrets out of folders you import from.
- Files are read from the host filesystem, not through `ctx.fs`. Path-scoped rules match case-sensitively with POSIX glob rules on every platform, including Windows.
