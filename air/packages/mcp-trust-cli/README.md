# @air/dsh-mcp-trust-cli

## Summary

Command-line provider of the `air-mcp` profile. It connects the MCP servers whose mcp-client rows are in its own profile patch, compares what each server presents with the lockfile it shares with the `air` profile, and lets a person approve or revoke tool definitions outside any agent session. It is a `dsh` profile, not a package bin. It works the same in PowerShell, cmd, and POSIX shells.

```sh
pnpm dsh --profile air-mcp list                         # every lockfile entry; writes nothing
pnpm dsh --profile air-mcp diff browser                 # field-level difference; writes nothing
pnpm dsh --profile air-mcp pin browser                  # asks before writing; --yes skips the question
pnpm dsh --profile air-mcp pin browser --tool browser_navigate browser_snapshot
pnpm dsh --profile air-mcp verify --all                 # for CI; writes nothing
pnpm dsh --profile air-mcp revoke browser --tool browser_evaluate
pnpm dsh --profile air-mcp revoke browser --key a1b2c3d4e5f6
```

`list` prints one line per lockfile entry with four columns: server name, the first 12 characters of the entry's key (or `-` for a profile-level server), the number of approved tools, and the newest approval time. On an empty or missing lockfile it prints `the lockfile has no entries` and exits 0. A lockfile that cannot be read is reported with its path and the parse error, and the command exits 2.

Servers come in two kinds. A profile-level server is mounted by a row in a profile patch; its lockfile entry has no key. A project server comes from a project's `.mcp.json`; the `air` profile mounts it inside a session in that project, and its lockfile entry carries a key that identifies the exact definition. This process can observe only the first kind, so:

- `pin`, `diff`, and `verify` act on profile-level servers. Given `--key`, they print that the server belongs to a project and is reviewed inside a session in that project with `/mcp-trust diff <server> --key <prefix>`, and exit 1. A name that matches no profile-level server but does match project entries in the lockfile is reported with those entries, listed as `name  key <first 12 characters>`, and the command exits 2.
- `revoke` acts on any lockfile entry. For a project entry, pass `--key <prefix>` with at least 8 hexadecimal characters; the prefix must match exactly one entry with that server name. Zero or several matches is a usage error (exit 1) that lists the candidates. Without `--key`, `revoke` addresses the profile-level entry and refuses a name that has only project entries.

`pin` writes the same lockfile entry as an approval in the `air` profile's prompt, apart from the recorded approver (`cli` here, `prompt` there). Without `--yes`, `pin` asks on a terminal; when stdin is not a terminal it does not assume yes: it exits 1 and tells the person to pass `--yes`.

Everything that comes from a server or from the lockfile (names, descriptions, instructions, differences) is escaped and cut to a fixed length before it is printed. Every non-zero exit writes one line on stderr that says what was wrong and what to do.

| Exit code | Meaning |
|---|---|
| 0 | Every named surface is approved (or pinned on first use), or the write or listing succeeded |
| 1 | A surface differs from its pin; a pin was declined or refused without `--yes`; a usage error, including `--key` on `pin`, `diff`, or `verify` and an unusable `--key` on `revoke` |
| 2 | A server was not observed (not configured, its connection failed, or it is a project server), the lockfile cannot be read, no lockfile entry matches a revoke, or an operation failed |

`pin` writes what the process fetched during startup, including tools the review withheld. `revoke` without `--tool` leaves an empty entry for the server, so `tofu` mode cannot pin it again without a person. A running `air` process watches the lockfile and applies a revocation without a restart.

Create the profile once per harness home, from the repository root so the relative bundle paths resolve (the first command prints the composed configuration and can be ignored):

```sh
pnpm dsh --profile air-mcp --from-default-profile headless --dump-config
pnpm dsh plugin --profile air-mcp add air/bundles/mcp-servers
pnpm dsh plugin --profile air-mcp add air/bundles/air-mcp
```

## Model Experience

None. This profile runs no agent and sends no model request. Its effect on a model is indirect: a pin or revocation changes which MCP tools the `air` profile registers on its next sync.

## Known Limitations

- `pin` approves the surface this process observed. A server that presents different surfaces to different clients or at different times must be verified again from the `air` profile's own process (its audit log records the digest it ran against).
- Server rows live in each profile's own patch. A server defined only in the `air` profile, or one that a project's `.mcp.json` adds, is not connected here, so `diff`, `pin`, and `verify` report it as not observed or as belonging to a project. A project server is approved inside a session in that project; only `list` and `revoke` can reach its lockfile entry from this profile.
- If the lockfile cannot be read, `list` and `revoke` report the path and the parse error and change nothing; repair the file or move it aside and pin each server again.
- The profile starts every configured MCP server in order to read its surface. Servers with side effects at startup run them here as well.
- Output is plain text. There is no machine-readable format; CI should rely on exit codes.
- Server instructions are approved only by a whole-surface `pin`; `pin --tool` keeps the previous instruction pin.
- Hints name the command as `pnpm dsh --profile air-mcp`; this package does not read the trust plugin's `cliCommand` setting.
