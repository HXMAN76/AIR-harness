# @air/dsh-voice-approval

## Summary

The approval answerer of the voice profile. It is default-deny. A tool call with `sandbox_permissions` set is refused by a tool guard with "Needs voice approval: run <command> (<justification>)." unless the latest user message carries `[AIR-APPROVE-<16 hex>]` whose token file holds the SHA-256 of that exact tool name and canonical arguments. The guard then lets the call through and the `approval/request` answerer allows the one request it raises and deletes the token (single use). Every other approval request is rejected, except requests of tools named in `trustedToolPrefixes`.

The voice app reads the denial from the run events (`@air/dsh-voice-approval/denial`), asks the person, and on yes creates the token with `@air/dsh-voice-approval/token`.

Config: `tokenDir` and `trustedToolPrefixes` (default none).

## Known Limitations

- Only sandbox escalations get the spoken flow; other approval requests are rejected without a spoken question.
- Tested with fakes and a real tool registry, not an end-to-end run of the runtime.
