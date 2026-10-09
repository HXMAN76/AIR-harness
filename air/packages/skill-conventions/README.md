# @air/dsh-skill-conventions

## Summary

A skill provider (`air-conventions`) for the directories other agents already use. It registers through `ctx.skills.registerProvider` and must be mounted in the same agent preset as upstream `skill-filesystem`, because the preset layer wins duplicate names over host-level providers. The AIR preset sets `skill-filesystem` to `includeDefaultRoots: false`, so this provider is the only source of project and user skill directories. Upstream still lists its `customSkillDirs` and the bundled skill directory (`DSH_BUNDLED_SKILL_DIR`), which this provider does not touch.

| Root | Source | Rank | Scanned |
|---|---|---|---|
| `<project>/.dsh/skills` | `project-dsh` | 100 | always |
| `<project>/.agents/skills` | `project-agents` | 200 | always |
| `<project>/.claude/skills` | `project-claude` | 220 | always |
| each `extraProjectRoots` entry | `project-extra` | 240 | when configured |
| `<airHome>/skills` | `user-air` | 350 | always |
| `<agentsHome>/skills` | `user-agents` | 500 | `includeUserRoots: true` |
| `<claudeHome>/skills` | `user-claude` | 520 | `includeUserRoots: true` |

`<project>` is the nearest ancestor of the session cwd that contains `.git`. A lower rank wins a duplicate name; the registry logs the one it dropped. A skill is `<root>/<dir>/SKILL.md`, or `<root>/<name>.md` when that file's frontmatter has a `description` (a plain `README.md` in a skills folder is not a skill). `.claude/commands` files are not skills; `@air/dsh-command-conventions` registers them as slash commands.

Differences from upstream `skill-filesystem` parsing: `name` defaults to the directory or file name; `description` defaults to the first body paragraph for a `SKILL.md`; `when_to_use` is accepted; a `SKILL.md` without frontmatter is valid. The Claude Code fields `allowed-tools`, `disallowed-tools`, `arguments`, `paths`, `model`, `context`, `agent`, and `argument-hint` are recorded under `metadata.claudeCode` for other AIR plugins and have no effect here.

Config: `providerName`, `airHome`, `claudeHome`, `agentsHome`, `includeUserRoots` (default `false`), `extraProjectRoots` (default `[]`; relative, no `..`), `maxFileBytes` (default 262144), `maxWalkEntries` (default 2000), `descriptionMaxChars` (default 1500), `watchIntervalMs` (default 3000; 0 disables), `watchMaxProjects` (default 32).

## Model Experience

The model sees these skills in the same catalog and loads them with the same `skill` tool as any other skill. A loaded body has `${CLAUDE_SKILL_DIR}` replaced with the absolute skill directory. `$ARGUMENTS` and `$1` placeholders stay literal on the skill path.

## Known Limitations

- Skills written for Claude Code may name tools that do not exist here (`NotebookEdit`) or use Claude Code tool names (`Bash`, `Edit`); the model sees those names unchanged.
- `allowed-tools`, `context: fork`, `agent`, `model`, and `paths` are recorded but not enforced.
- `` !`cmd` `` lines and `@file` references in a skill body are not expanded.
- A command file cannot be invoked by the model, and Claude Code's merge of commands into skills is not reproduced.
- Files are read from the host filesystem, not through `ctx.fs`.
- Nested `<subdir>/.claude/skills` directories below the project root are not scanned.
- With `includeDefaultRoots: false` on upstream `skill-filesystem`, `~/.dsh/skills` and `~/.agents/skills` are not listed; put harness-native skills in `~/.air/skills` or `<project>/.dsh/skills`.
- A changed description is seen after at most one `watchIntervalMs`; a body edit is always read fresh. Only the `watchMaxProjects` most recently listed projects are watched; a project released from the watch list causes one catalog rebuild.
