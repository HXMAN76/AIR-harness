# @air/dsh-tool-open

## Summary

Registers one model tool, `open`, with the arguments `kind` (`app`, `url`, or `search`) and `value`. It starts a whitelisted Windows app, a site, or a Google search with `Start-Process`, so a small local model does not have to write PowerShell for simple opens. The plugin has one setting, `enabled` (default `true`).

The same package holds the whitelist that the voice app's local operator uses, so there is one list. It is exported as `@air/dsh-tool-open/whitelist` (apps, site names, the domain and URL rules, query encoding) and `@air/dsh-tool-open/exec` (a process runner type, the default runner, and the constant PowerShell scripts). Both subpaths export TypeScript source, for bundlers and test runners that read it directly.

Rules that are enforced in code, not in the prompt:

- `app` takes a spoken name from the list (notepad, calculator, paint, file explorer, settings, terminal, command prompt, edge, chrome, spotify, vs code); anything else is an error that names the known apps.
- `url` takes a site name (youtube, gmail, github, google), a domain ending in `.com`, `.org`, `.in`, or `.io`, or an `https://` URL made of plain characters; `http:`, `file:`, and quote, semicolon, or space characters are refused.
- `search` is URL-encoded into a Google results URL. The value never reaches a shell: the script is a constant and the target travels in the `AIR_OP_TARGET` environment variable.
- Before anything runs, the target must be a whitelisted executable, `ms-settings:`, `spotify:`, or an `https://` URL.

## Model Experience

One tool definition is added to the request header: a one-sentence description and two parameters, about 370 characters of JSON (an estimate of 90 tokens). It is fixed for the session, so it stays in the reusable prefix. A result is one sentence ("Opened Notepad."). In one measured turn on `qwen3-8b-32k`, "open notepad" became one `open` call with `{"kind":"app","value":"notepad"}`; before the tool the model answered in prose and called nothing (see [CHECKS.md](../../CHECKS.md)).

## Known Limitations

- Windows only: the runner starts `powershell.exe`. On other systems the tool returns the start error.
- The tool does not check that the app is installed; a missing executable is reported as a start failure.
- `Start-Process` returns when the app starts, not when it is ready. Typing into the app is a separate step for `pwsh`.
- The tool runs in the host, outside the shell sandbox; the whitelist is the only gate. Approval prompts are not used.
