# @air/dsh-effort-session-only

## Summary

A host-level plugin that keeps a reasoning-effort pick in the session instead of saving it as the default. When the user picks a model or an effort in the composer, upstream's Host appends a session-local `model/selection` event and also calls `agentDefaultModel.saveSelection`, which rewrites the whole `agent-default-model` row with the picked provider, model, and effort. Every later session then starts with that effort. Picking "medium" once to turn thinking on for one session made thinking the default for all sessions.

The plugin replaces `saveSelection` on the service instance with a wrapper. The wrapper saves the picked provider and model, so the last chosen model still sticks as upstream intends, and keeps the effort that is currently configured (`currentSelection().reasoningEffort`). When no effort is configured the saved row has no `reasoningEffort` key, and the provider's own `reasoning` setting decides. The session itself is unaffected: its `model/selection` event still carries the pick and its requests use it.

## How the replacement reaches the Host

Cordis hands out a service through a per-context proxy. An assignment through that proxy lands on the shared instance, and the proxy of the Host's context reads the own property first, so the Host's call `this.ctx.agentDefaultModel.saveSelection(selected)` runs the wrapper. A test loads upstream's real `agent-default-model` row through the Loader and calls the method through the service the way the session controller does. The plugin remembers a method that was already set on the instance and puts it back on dispose; otherwise it removes its own property so the class method is visible again.

## Config

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` mounts nothing and leaves upstream behavior. |

A value that is not a boolean fails the plugin load.

## Model Experience

None. The model sees the effort the session uses, as before; only the saved default changes. No token or request-cache effect.

## Known Limitations and Deferred Work

- A default effort that an earlier pick already saved in the profile stays in the row until it is edited or removed. The plugin stops new picks from changing it.
- The effort cannot be saved as the default from the composer any more. Set it in the `agent-default-model` row or the provider's `reasoning` setting.
- Headless runs have no model picking, so the headless bundle does not mount this plugin.
- The wrapper replaces a method on a service instance, which depends on how Cordis exposes services. If upstream adds a Config field that separates session choice from the default, replace this plugin with that field.
- Checked with upstream's real service and Loader in automated tests. Not yet checked live in the desktop app.
