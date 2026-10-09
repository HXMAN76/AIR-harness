# @air/dsh-convention-core

## Summary

A library, not a plugin. It holds the code every AIR file-convention plugin needs: user-home and project-root resolution, YAML frontmatter parsing with typed field readers, Markdown file discovery, a polling path watcher, kebab-case name normalisation, and the table that maps Claude Code tool names to dsh tool names.

| Export | Use |
|---|---|
| `resolveUserHomes`, `expandHome` | `~/.air` (or `$AIR_HOME`), `~/.claude`, `~/.agents` (or `$DSH_AGENTS_HOME`) |
| `findProjectRoot`, `isInside`, `directoriesBetween`, `toPosixRelative` | nearest ancestor containing `.git`; containment checks; forward-slash relative paths for globs |
| `parseFrontmatter`, `stringField`, `booleanField`, `stringListField` | skill, command, and rule files |
| `readContained`, `listDirectory`, `listMarkdownTree` | contained reads and walks: a file or entry is used only when its real path is inside an allowed root, is not a credential file, and is within the size and entry limits; a walk enters each real directory once and reports a cap hit |
| `isSensitivePath`, `describeSkip`, `describeTruncation` | credential-file classification (`.env*`, keys, `.git/config`, `.git-credentials`, `.pypirc`, `.pgpass`, `*.tfvars`, `.claude/settings.local.json`, `.config/gh`, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`) and one-line wording of a refusal; `isSensitivePath(path, root)` ignores directories above `root`, and `readContained` always passes the root that contains the file, so a project under `~/.docker/work` is readable while its own `.env` is not; call `isSensitivePath(path)` without a root only for a path that has no allowed root |
| `readTextFile`, `fileSize`, `fileSignature`, `realpathIfPresent` | uncontained reads for AIR-owned files, size, content-version signature, and canonical paths; an absent path is an empty result |
| `PollWatcher` | one timer that invalidates a catalog when a watched file or directory of a project changes |
| `toKebabName` | `frontend/component.md` becomes `frontend-component` |
| `toDshToolName`, `toClaudeToolNames`, `translateToolNames` | `Edit` and `MultiEdit` become `edit`; `mcp__*` names pass through |

## Model Experience

None directly. The model sees the results through the plugins that use this library: skill names and descriptions, instruction text, and tool names.

## Known Limitations

- Files are read from the host filesystem with `node:fs`. A remote or sandboxed filesystem provider is not consulted.
- `isInside` compares normalised paths and does not resolve symbolic links; call `realpathIfPresent` on both sides when a link could leave the root. Windows rules (case-insensitive, drive letters) apply on Windows and are tested on every host through `path.win32`.
- `PollWatcher` runs one timer; a change is seen after at most one interval, each retained path costs one `stat` per interval, and a file deleted between listing and the first poll is noticed only when the registry fails to load it.
- The tool-name table covers the tools listed in the export; a Claude Code tool with no dsh equivalent (for example `NotebookEdit`) is reported as unknown.

## Residual risks

Hard links and Windows junctions are not detected, so a hard link inside a root to a credential file outside it reads as an ordinary file. The check-then-read window is not closed against a concurrent attacker process that swaps a file for a link between the containment check and the read. The sensitive-file list is a heuristic and misses credential files with unusual names. A project root that is the home directory or `/` (because it carries the root marker) makes containment that wide. Skill resource files are read by the upstream skill tool without this containment. Secret redaction covers raw values, not encoded forms such as base64 or URL-encoded text. Two processes writing the approvals file at the same instant can lose an entry. Upstream's MCP client logs an expanded command when a spawn fails.
