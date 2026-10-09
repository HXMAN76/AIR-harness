# @air/dsh-mcp-trust

## Summary

Pins the tool surface of each MCP server and blocks a server whose surface changes. The plugin reviews every generation of tools that `mcp-client` fetches (names, descriptions, input schemas, annotations, and the server instructions) against a lockfile of approved definitions, registers only what the lockfile covers, and checks the digest again when a tool is called. A server that adds, changes, or removes a tool after it was pinned does not get its new surface to the model until a person approves it.

The plugin provides two services: `mcpToolReview`, consumed by `mcp-client` rows that declare it in `inject`, and `mcpTrust`, which lists, compares, pins, and revokes. Two front ends use `mcpTrust`: the `air-mcp` command line (`@air/dsh-mcp-trust-cli`) and the `/mcp-trust` slash command described below.

## Modes

The `mode` of a server's policy selects what the review does with a surface that has no matching pin.

| Mode | Behavior |
|---|---|
| `off` | No review. The server behaves as if the plugin were absent, and the lockfile is not read for it. |
| `tofu` | Trust on first use. The first surface of a server that has no lock entry is pinned automatically (`approvedBy: tofu`); a later change is blocked. A whole-server revoke leaves an empty entry, so tofu does not pin that server again. |
| `enforce` | A server with no pin registers no tools. A person must pin it. |

In `tofu` and `enforce`, a change to a pinned surface is handled by the policy fields `onAdded`, `onChanged`, `onRemoved`, and `instructions` (see the table below). A blocked server registers nothing, or only the tools that still match, and every call to a blocked tool is denied with a message that names the next step.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `lockfile` | none, required | Absolute path of the lockfile shared by every profile that must see the same pins. |
| `auditDir` | none, required | Absolute directory for the JSONL audit files. |
| `auditMaxBytes` | `10485760` | Size in bytes a JSONL audit file may reach before it rotates to one previous file. |
| `defaults` | none, required | Policy for every server: `mode`, `onAdded` (`withhold` or `reject-generation`), `onChanged` (`reject-generation` or `withhold`), `onRemoved` (`accept` or `reject-generation`), `instructions` (`pin`, `drop`, or `accept`), and optional `allow`, `deny`, and `override`. |
| `servers` | `{}` | Per-server policy overrides keyed by the local server name, merged over `defaults`. |
| `denyUnreviewedMcpTools` | none, required | Deny calls to `mcp__` tools that no review registered. |
| `maxPromptsPerServer` | none, required | Approval prompts per server for the life of the process. |
| `minReverifyMs` | none, required | Lower bound of the delay before a server is fetched and reviewed again after its time-to-live expires. |
| `maxReverifyMs` | none, required | Upper bound of that delay. |
| `lockWaitMs` | none, required | Longest wait for the lockfile writer lock. |
| `watchDebounceMs` | none, required | Quiet time after a lockfile change before it is re-read, so a revocation written by another process applies to this one. |
| `cliCommand` | none, required | Command prefix of the `air-mcp` profile named in prompts and denials, for example `pnpm dsh --profile air-mcp`. |
| `enrollOnApproval` | none, required | Approving a server that has no lock entry also writes its pin. A changed surface is never pinned by a prompt. |

The plugin does not choose the lockfile or audit locations; the bundle that loads it sets them. Put both inside the user's home data directory so the `air` and `air-mcp` profiles share one lockfile. The lockfile directory is created with mode 0700 if it is missing.

## Lockfile and audit

The lockfile is one JSON document. Each entry is keyed by the server name, or by the server name, `@`, and the review key for a project server. An entry holds the digest of the whole surface, each approved tool (definition, per-field digests, approval time, and who approved it: `cli`, `command`, `prompt`, or `tofu`), and the pinned instructions. A review key is added as the entry's `identity`. Writes take a lock file next to the lockfile and replace the document atomically. A lockfile that cannot be read or does not validate blocks every MCP server until it is repaired or moved aside; the plugin never rewrites it.

The audit is a sidecar under `auditDir`: `process.jsonl` records drift the process saw, and `<sessionId>.jsonl` records the surface each session turn ran against. Full text of changed tool definitions and instructions is stored once by digest in `blobs/<hex>.json`. Nothing is written to a session log, so sessions stay loadable by builds without this plugin.

## Two kinds of server, two places to review

| Kind | How to recognize it | Where it is reviewed |
|---|---|---|
| Profile-level server | An `mcp-client` row in a profile patch; no review key | The `air-mcp` command line: `pnpm dsh --profile air-mcp diff <server>`, `pin`, `revoke`, `verify --all`, `list`. The command line connects those rows itself. |
| Project server | Declared in a project's `.mcp.json` and mounted per Agent by `@air/dsh-mcp-conventions`; its 64-hex review key identifies the exact definition | Inside a session, with `/mcp-trust`. The command line cannot observe it, and the in-session approval prompt does not appear in sessions that cannot ask (full access rejects prompts; a headless run has nobody to answer). |

Two project servers with the same name but different definitions get separate pins, observations, prompt budgets, and one-shot acceptances, because every per-server record is keyed by name and review key together.

## The `/mcp-trust` command

The command is registered when a command registry exists in the process. In the `air-mcp` profile there is no registry, the plugin still loads, and the command is simply absent. If the registry appears later, the command registers then. It works only on what this process has observed plus what the lockfile lists.

| Command | Effect |
|---|---|
| `/mcp-trust` or `/mcp-trust status` | One line per server: name, first 12 characters of the review key or `-`, state, tool count, and for a blocked server a summary of what changed. Covers every server observed in this process and every lockfile entry. States: `approved`, `first-use pinned`, `accepted once, not pinned`, `unpinned`, `blocked pending review`, `review failed`, `lockfile unreadable`, and `pinned, not observed in this process`. Reads only. |
| `/mcp-trust diff <server> [--key <prefix>]` | The field-level difference between the observed surface and its pin. The last line is the command that approves exactly this surface. Reads only. |
| `/mcp-trust pin <server> [--key <prefix>] --surface <prefix>` | Pins the currently observed surface with `approvedBy: command`, re-syncs the server so its tools register, and reports how many tools are pinned. |
| `/mcp-trust revoke <server> [--key <prefix>]` | Removes the pin and re-syncs the server so its tools unregister. |

`<server>` is resolved among the servers observed in this process and the lockfile entries with that name. One match is used. Several matches (same name with different keys, or keyless and keyed) need `--key`; `--key -` selects the one without a key. A key prefix needs at least 8 hexadecimal characters and must match exactly one candidate; otherwise the candidates are listed as `name  key <first 12>`. An unknown name lists the known servers.

`pin` requires `--surface`, a prefix of at least 8 hexadecimal characters of the digest of the surface the engine holds for that server right now. `diff` prints the full command with the first 12. If the server's surface changed after you ran `diff`, the digest no longer matches, `pin` refuses and pins nothing, and the message tells you to run `diff` again. The approval therefore covers what you reviewed. With a corrupt lockfile `status` shows it, and `pin` and `revoke` refuse with the reason. Every message ends with the next step when it refuses. Server-supplied text (names, descriptions, instructions) is printed with control, escape, and bidirectional characters made visible.

## Known limitations

- The review display cuts server text at 4,000 characters; the audit keeps the full text.
- Audit blobs are not rotated, and their number grows with the number of distinct changed definitions. Log files rotate to one previous file.
- A declined change is asked again, up to `maxPromptsPerServer` times per server for the life of the process.
- Accepting a changed surface once in a prompt lasts until the process exits and is never written to the lockfile.
- `/mcp-trust` can pin only a server connected in the current process. A project server that failed to connect, or that was never approved for mounting by `/mcp`, cannot be pinned until it is running.
- Nothing has been run on Windows by hand; the automated tests are written to run there, but the lockfile watcher, the writer lock, and the path handling have only been exercised on Linux.
