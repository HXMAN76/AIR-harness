# @air/dsh-send-guard

## Summary

A tool guard that refuses browser tool calls that would send a message, with the model-visible error "Sending is locked until the user confirms." It uses the same seam as the MCP trust plugin (`tools.guard`), so no upstream file changes. It blocks: a click on an element whose description matches `\bsend\b`, Control+Enter, Ctrl+Enter and Meta+Enter key presses, typing with `submit: true`, and evaluate or run-code calls whose text mentions sending, submitting or clicking.

A blocked call is allowed once when the latest `user/message` of the session contains `[AIR-SEND-<16 hex>]` and a file of that name exists in `tokenDir`. The voice app creates the token (`@air/dsh-send-guard/token`, `issueSendToken`) only after the user's spoken yes and puts it only in the prompt that follows. The guard deletes the file on the allowed call, so a second send is blocked again.

Config: `tokenDir` (absolute path). The voice browser patch sets it to `<voice home>/send-tokens`.

## Known Limitations

- A pattern list over Playwright MCP tool names (`mcp__<server>__browser_<action>`); a send path it does not recognise, such as Enter on a focused Send button, is not blocked.
- Tested with fake calls and a real tool registry; not run against a live browser.
