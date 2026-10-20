# @air/dsh-memory-index

## Summary

Consumer of `ctx.airMemoryStore`, registered as `ctx.airMemoryIndex`. It keeps a derived SQLite database (default `<DSH_HOME>/cache/air/memory-index.sqlite`, owner-only) with one row per memory file and an FTS5 table over `description` and body. Deleting the database loses nothing: `sync()` compares each file's content hash with the stored one and rewrites what differs in one transaction (the FTS row of a memory shares the rowid of its `memories` row, so a delete never scans the FTS table). `search()` syncs when the store reports a write by this process since the last sync, or when `syncMinIntervalMs` has passed; a note edited by hand is found within that interval. The file carries `PRAGMA application_id` `0x41495231` and `PRAGMA user_version` 1; another version drops and recreates the tables, another application id is refused.

Search takes the allowed scopes from the caller and never returns a memory outside them. Superseded and expired memories are excluded unless `includeSuperseded` is set. The query's letters and digits become FTS5 terms (each quoted, joined with `OR`, so query syntax is inert), and hits are ranked by SQLite's `bm25()`; a hit's `score` is `-bm25`, so higher is better. There is no vector search: plan 04's embedding package is not built in this tier (plan 09, Track B), so a note is found only when it shares a word with the query.

Config: `path`, `journalMode` (`wal`), `snippetChars` (240), `syncMinIntervalMs` (2000; 0 checks the files before every search).

## Model Experience

This package adds nothing to a model request by itself. `memory_search` in `@air/dsh-tool-memory` renders its hits.

## Known Limitations

- Keyword search only: synonyms and paraphrases do not match ("editor" does not find a note that says only "neovim"). Recency, importance, and trust do not affect the order.
- The `unicode61` tokenizer splits on letters and digits and folds case; it does no stemming, so "edits" does not match "edit".
- A search that must sync lists the store (one `stat` per file, 0.19 s for 10,000 files when nothing changed in the Linux scratch benchmark of 2026-10-08; untimed on Windows) and compares hashes.
- A file edited by hand shows up in search results after `syncMinIntervalMs`, not at once; call `sync()` to force it.
- `node:sqlite` runs on the JavaScript thread and prints an experimental warning on Node 22.
