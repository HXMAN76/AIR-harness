# @air/dsh-mcp-conventions

## Summary

A host-level plugin that imports Claude Code project MCP configuration. When an Agent is created it reads `<project>/.mcp.json` (the project is the nearest ancestor of the session cwd that contains `.git`) and, for each server a person has approved, mounts one upstream `mcp-client` in that Agent's scope. The mount is awaited inside `agent/created`, so the tools exist for the first request. Servers start in parallel; a server that fails or exceeds `startupTimeoutMs` is logged and skipped, and Agent creation continues.

Supported entries: `command`, `args`, `env` (stdio) and `url`, `headers` with `type: "http"` (Streamable HTTP). `${VAR}` and `${VAR:-default}` are expanded from the process environment in `command`, `args`, `env`, `url`, and `headers`. A stdio server runs with the Agent's working directory at creation as its own.

Consent: a repository file can name any command, so nothing in `.mcp.json` runs until a person approves it. Approvals are stored in `<DSH_HOME>/air/mcp-approvals.json` (directory mode 0700 and file mode 0600 on POSIX; on Windows the file inherits the private ACL of the user profile), keyed by a SHA-256 over the project root, the server name, the full entry exactly as written in `.mcp.json` (variables unexpanded), and, for a stdio server, the resolved working directory it runs in. Each stored record also lists the project root, server name, and working directory so the file can be read by a person. Editing the command, arguments, URL, or any `${VAR}` name, running the same definition from another directory, or moving the project folder requires a new approval; rotating the value of a `${VAR}` does not. An approval does not cover the contents of the scripts or binaries the command points at: changing those needs no new approval, so approve only commands whose targets you trust. Approvals made by earlier builds, which had no working directory in the key, no longer match and must be given again. On Windows the project root and working directory compare without regard to letter case. Run `/mcp approve <server>` before the first message of a session so the tools exist for the first request; the session logs a note at creation when servers await approval.

| Command | Effect |
|---|---|
| `/mcp` | list each declared server with its command line or URL as written in the file (`${VAR}` stays unexpanded), each env variable or header as `NAME=<text as written in the file>` (`${VAR}` stays unexpanded, so a user approving sees that `Authorization` is `Bearer ${GITHUB_TOKEN}` or that env sets `NODE_OPTIONS`; expanded values are never shown), its working directory, and its state: `running`, `approved, not running`, `not approved`; list file problems |
| `/mcp approve <server>` | record approval and start the server for this session |
| `/mcp revoke <server>` | remove approval and stop the server in this session |

Config: `approvalsFile`, `startupTimeoutMs` (default 15000), `toolCallTimeoutMs` (default 60000), `maxFileBytes` (default 262144), `projectRootMarkers` (default `['.git']`), `reviewTools` (default `false`). With `reviewTools: true` every mounted `mcp-client` waits for the `mcpToolReview` service of the MCP trust plan, so imported servers cannot register tools unreviewed; when the service is missing the approval reports at once that the reviewer is required and not loaded, and nothing is mounted; the AIR bundle turns it on when that plan is installed. In that mode each mounted client also receives the server's approval key as its `reviewKey`, so the reviewer can tell apart two projects' servers that share a local name.

## Model Experience

The model sees each approved server's tools as `mcp__<server>__<tool>`, plus the server instructions upstream `mcp-client` attributes to that server. It sees nothing for a server that is not approved. `/mcp` output is shown to the person and is not sent to the model.

## Known Limitations

- Only the project `.mcp.json` is read, as UTF-8 (a UTF-8 byte-order mark is accepted; a UTF-16 file saved by Windows PowerShell 5 is not). `~/.claude.json`, Claude Desktop configuration, and `.mcpb` bundles are not imported.
- On Windows a bare `npx` or `uvx` command works because the upstream client launches servers through `cross-spawn`; a server inherits only a small set of environment variables plus the `env` it declares.
- `type: "sse"` servers and OAuth are not supported (upstream `mcp-client` has neither).
- `/mcp`, log lines, and error messages show unexpanded text only (a literal value in `.mcp.json` appears as written, because that is the text an approval covers), print an invalid server name as a quoted string cut to 64 characters, and a malformed `.mcp.json` is reported by path without quoting its content. Messages from upstream `mcp-client` itself (for example a spawn error that quotes the expanded command) are outside this package: they are scrubbed in `/mcp` output but not in the upstream client's own log lines.
- Replacing the approvals file is retried a few times when another process holds it open on Windows (`EPERM`/`EBUSY`); after that the write fails with a message saying so.
- Every Agent starts its own server processes, including delegated child Agents working in the same project.
- `.mcp.json` is read once, when the Agent is created; edit the file and start a new session to pick up changes. Discovery uses the Agent's working directory at creation, and a later directory change does not run it again. Revoking stops the server in every session of this process that mounted it; sessions in other processes keep theirs until they end.
- A corrupt approvals file approves nothing: `/mcp` shows a problem line that names the file, and servers do not start until the file is repaired or deleted. Two processes writing the file at the same instant can lose one approval.
- Tool definitions are not pinned or reviewed here; that is the MCP trust plan.
