# @air/dsh-mcp-conventions

## Summary

A host-level plugin that imports Claude Code project MCP configuration. When an Agent is created it reads `<project>/.mcp.json` (the project is the nearest ancestor of the session cwd that contains `.git`) and, for each server a person has approved, mounts one upstream `mcp-client` in that Agent's scope. The mount is awaited inside `agent/created`, so the tools exist for the first request. Servers start in parallel; a server that fails or exceeds `startupTimeoutMs` is logged and skipped, and Agent creation continues.

Supported entries: `command`, `args`, `env` (stdio) and `url`, `headers` with `type: "http"` (Streamable HTTP). `${VAR}` and `${VAR:-default}` are expanded from the process environment in `command`, `args`, `env`, `url`, and `headers`. A stdio server runs with the session cwd as its working directory.

Consent: a repository file can name any command, so nothing in `.mcp.json` runs until a person approves it. Approvals are stored in `<DSH_HOME>/air/mcp-approvals.json` (mode 0600 on POSIX; on Windows the file inherits the private ACL of the user profile), keyed by a SHA-256 over the project root, the server name, and the entry exactly as written in `.mcp.json`. Editing the command, arguments, URL, or any `${VAR}` name requires a new approval; rotating the value of a `${VAR}` does not. Run `/mcp approve <server>` before the first message of a session so the tools exist for the first request; the session logs a note at creation when servers await approval.

| Command | Effect |
|---|---|
| `/mcp` | list each declared server with its command line or URL and its state: `running`, `approved, not running`, `not approved`; list file problems |
| `/mcp approve <server>` | record approval and start the server for this session |
| `/mcp revoke <server>` | remove approval and stop the server in this session |

Config: `approvalsFile`, `startupTimeoutMs` (default 15000), `toolCallTimeoutMs` (default 60000), `maxFileBytes` (default 262144), `projectRootMarkers` (default `['.git']`), `reviewTools` (default `false`). With `reviewTools: true` every mounted `mcp-client` waits for the `mcpToolReview` service of the MCP trust plan, so imported servers cannot register tools unreviewed; the AIR bundle turns it on when that plan is installed.

## Model Experience

The model sees each approved server's tools as `mcp__<server>__<tool>`, plus the server instructions upstream `mcp-client` attributes to that server. It sees nothing for a server that is not approved. `/mcp` output is shown to the person and is not sent to the model.

## Known Limitations

- Only the project `.mcp.json` is read, as UTF-8 (a UTF-8 byte-order mark is accepted; a UTF-16 file saved by Windows PowerShell 5 is not). `~/.claude.json`, Claude Desktop configuration, and `.mcpb` bundles are not imported.
- On Windows a bare `npx` or `uvx` command works because the upstream client launches servers through `cross-spawn`; a server inherits only a small set of environment variables plus the `env` it declares.
- `type: "sse"` servers and OAuth are not supported (upstream `mcp-client` has neither).
- An approval covers expanded env and header values, so rotating a token referenced through `${VAR}` requires a new approval.
- Every Agent starts its own server processes, including delegated child Agents working in the same project.
- `.mcp.json` is read once, when the Agent is created; edit the file and start a new session to pick up changes. Revoking in one session does not stop the server in other running sessions.
- A corrupt approvals file approves nothing: `/mcp` shows a problem line that names the file, and servers do not start until the file is repaired or deleted. Two processes writing the file at the same instant can lose one approval.
- Tool definitions are not pinned or reviewed here; that is the MCP trust plan.
