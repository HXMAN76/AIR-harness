# @air/dsh-memory-store

## Summary

Service Provider for AIR long-term memory, registered as `ctx.airMemoryStore`. Each memory is one Markdown file with YAML frontmatter under a single root (default `<DSH_HOME>/air/memory`), and the root is a git repository: every write, supersede, and forget is one commit whose subject names the memory and the session. The files are the only source of truth; the search index in `@air/dsh-memory-index` is derived from them and can be deleted.

Git is optional. If git is missing, times out, cannot commit, or has no identity (commits always pass the AIR identity with `-c`), the write still succeeds as a plain file, `store.versioning` reads `{ state: 'files-only', reason }`, a warning is logged, and the next successful commit records every change made in between. The repository is created with `init.defaultBranch=main`, a `.gitattributes` of `* text eol=lf`, `core.autocrlf=false`, `--no-verify`, and an empty hooks directory under `.air/`, so a user's global hooks and line-ending settings cannot change or fail a memory commit.

Layout: `<type>/<id>.md` for the user scope and `projects/<16 hex>/<type>/<id>.md` for a project scope, with types `user`, `feedback`, `project`, `reference`, and `episode`. Frontmatter fields: `id`, `type`, `scope`, `description`, `created`, `updated`, `valid_from`, `valid_to`, `supersedes`, `superseded_by`, `importance` (1–5), `source` (`kind`, optional `session` and `seq`), `trust`, `last_recalled`. `trust` is derived from `source.kind` on every read (`user-stated` and `user-confirmed` are `high`, `agent-inferred` is `low`, `tool-derived:<tool>` is `untrusted`); a value written by hand is ignored.

A replaced memory is never deleted: `write({ supersedes })` sets `valid_to` and `superseded_by` on the old file in the same commit. `forget(id, 'soft')` ends the validity interval; `forget(id, 'delete')` removes the file and leaves it in git history.

Reading is cached: a scan lists the directories and calls `stat` on each file, and parses only files whose size or modification time changed (10,000 files: 3.5 s cold, 0.19 s warm in the scratch benchmark on Linux; Windows is untimed). Files are read with a leading byte-order mark and CRLF line endings accepted, because a Windows editor writes both. A file name or directory is built only from lower-case ASCII letters, digits, and underscores, so no path holds a character, reserved device name, or case-only collision that Windows rejects.

Export and import: `exportTo(file)` writes every note, forgotten and superseded ones included, as one JSON archive; `importFrom(file, { keepTrust })` adds the notes whose id is missing, commits them as one change, and never overwrites an id. Paths come from each file's validated frontmatter, not from the archive, and `user-stated` and `user-confirmed` sources become `agent-inferred` unless `keepTrust` is set. They are not model tools; `air/scripts/memory-transfer.ts` calls the same functions without a running harness.

Model routes: the `shareWith` Config field (default `['ollama']`, `*` for every route) lists the provider ids that may receive memory text, and `store.shareWith` exposes it. `activeProvider`, `routeAllows`, and `routeLabel` resolve the provider id of an agent's next request and check it against that list. `@air/dsh-memory-context` and `@air/dsh-tool-memory` call them before they hand memory text to a model. The list lives here, on a host row, so a profile patch can change it with `- { id: air-memory-store, config: { shareWith: [ollama, deepseek] } }`; the per-Agent rows sit inside the preset, which a bundle patch cannot address by id.

Config: `root`, `gitPath` (`git`), `commitAuthorName`, `commitAuthorEmail`, `gitTimeoutMs` (15000), `lockWaitMs` (10000). Requires `ctx.subprocess`.

## Model Experience

This package adds nothing to a model request. Tools and the pinned core in `@air/dsh-tool-memory` and `@air/dsh-memory-context` decide what a model reads.

## Known Limitations

- Ids are resolved by scanning the root, so every `read` costs one directory walk plus one `stat` per file. The store is meant for thousands of files, not hundreds of thousands. An edit that keeps both the size and the modification time of a file is not noticed until the file changes again.
- Symlinks, dot directories (including `.quarantine/`), and files that fail validation are skipped; an invalid file is reported once as a warning, not an error. Two files that claim one id are reported once and the first in path order is used.
- The write lock compares process ids on one host. Two hosts sharing the root over a network filesystem can both hold it.
- `forget(id, 'delete')` does not rewrite git history, and no forget removes text that already entered a session log.
- Editing a file by hand is supported, but the edit is committed only by the next store write (`git add -A`). The same holds for an import and for any write made while git was failing.
- `store.versioning` describes the latest commit attempt of this process only.
- The archive is plain text with every note in it. Keep it as private as the memory directory, and do not import an archive from a source you do not trust: imported notes enter later sessions through the pinned core (as `agent-inferred` unless `--keep-trust`).
