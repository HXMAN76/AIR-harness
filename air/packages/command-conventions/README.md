# @air/dsh-command-conventions

## Summary

A host-level plugin that turns Claude Code command files into slash commands. When an Agent is created it scans, in this order, `<project>/.claude/commands`, `<airHome>/commands`, and (only with `includeUserRoots: true`) `<claudeHome>/commands`, up to four directory levels deep. Each `.md` file becomes a command registered in that Agent's scope through `ctx.commands`; the first file found for a name wins. A nested path is joined with `-` (`frontend/component.md` is `/frontend-component`). A file whose name is already a command for that Agent (for example `/compact` or `/goal`) is skipped with a warning, so a repository cannot replace a built-in command.

Running a command reads the file again, substitutes arguments, and queues the text with `agent.followup` as a user message whose source is `{ kind: 'air-command', name, form: 'instructions' }`. The upstream registry logs `command/run` and `command/done` around it.

| Placeholder | Value |
|---|---|
| `$ARGUMENTS` | everything typed after the command name, trimmed |
| `$ARGUMENTS[N]`, `$N` | one argument after shell-like splitting (quotes group words), counted from `positionalBase` |
| `$name` | the argument at the position of `name` in the frontmatter `arguments:` list |

A missing argument becomes an empty string. When the body has no placeholder and input was typed, `ARGUMENTS: <input>` is appended. Frontmatter `description` (default: the first body line) and `argument-hint` (default `[arguments]`) appear in the `/` picker.

Config: `airHome`, `claudeHome`, `includeUserRoots` (default `false`), `maxFileBytes` (default 262144), `maxWalkEntries` (default 2000), `projectRootMarkers` (default `['.git']`), `positionalBase` (default `0`; set `1` for files written for the older `$1` convention).

This plugin is the only reader of `.claude/commands`: `@air/dsh-skill-conventions` does not list command files as skills, so each file appears once in the `/` picker.

## Model Experience

The model receives the rendered command body as an ordinary user turn. It does not see the command name or the placeholders, and it has no tool for running these commands itself.

## Known Limitations

- `@file` references and `` !`cmd` `` lines in a command body are not expanded; the model sees them as written.
- `allowed-tools` and `model` in command frontmatter are ignored.
- Command files are discovered once, when the Agent is created. A new file needs a new session; an edited file is picked up on the next run. Discovery uses the Agent's working directory at that moment, and a later directory change does not run it again.
- Command names lose the `:` namespace separator Claude Code uses (`frontend:component` is `/frontend-component`).
- A file whose path does not start with a letter after normalisation (for example `123.md`) is skipped.
- `$N` consumes any dollar sign followed by digits, so a body that spells a price as `$5` loses it; this matches Claude Code. Backslashes escape only quotes and whitespace in the input.
- A skill or built-in command with the same name is not detected for skills: a command file is skipped only when a registered slash command already has its name.
