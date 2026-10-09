# @air/dsh-convention-core

## Summary

A library, not a plugin. It holds the code every AIR file-convention plugin needs: user-home and project-root resolution, YAML frontmatter parsing with typed field readers, Markdown file discovery, a polling path watcher, kebab-case name normalisation, and the table that maps Claude Code tool names to dsh tool names.

| Export | Use |
|---|---|
| `resolveUserHomes`, `expandHome` | `~/.air` (or `$AIR_HOME`), `~/.claude`, `~/.agents` (or `$DSH_AGENTS_HOME`) |
| `findProjectRoot`, `isInside`, `directoriesBetween`, `toPosixRelative` | nearest ancestor containing `.git`; containment checks; forward-slash relative paths for globs |
| `parseFrontmatter`, `stringField`, `booleanField`, `stringListField` | skill, command, and rule files |
| `readTextFile`, `fileSize`, `realpathIfPresent`, `listDirectory`, `listMarkdownTree` | discovery and containment checks; an absent path is an empty result |
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
