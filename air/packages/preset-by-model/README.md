# @air/dsh-preset-by-model

## Summary

A host-level plugin that chooses the agent preset of a new session from the context window of the model selected for it. The product has two presets: `air-lean` (the default; it omits the schedule, goal, delegation, and workflow tools to save about 3,400 tokens per request on small local models) and `air` (full). A model whose context window is below `smallWindowTokens` gets `smallPreset`; a model with a larger or equal window gets `largePreset`; a model whose window is unknown leaves upstream's default alone.

The plugin changes the preset only through the registry's own `select` operation. The session log therefore holds the ordinary `agent-preset/selected` event (no custom event type), the composer shows the new preset, and a resumed session rebuilds the same composition. The window comes from `ctx.llm.resolveModelInfo(provider, model)`, which asks the adapter of the model's route; for a hosted route this is the catalogue value, for a local route it is the configured or discovered value.

## When it acts

1. A fresh top-level session is created (agent source `startup`, no subagent origin, no parent session, not seeded) whose recorded preset equals the registry default, and no default was saved in Settings. The plugin looks up the window of the default model once.
2. While that session is blank, each `model/selection` event (the user picks a model in the composer) triggers a new lookup and, if the target preset differs from the current one, a new selection. Evaluations run one at a time in event order.

## When it never acts

- The session was resumed, forked, seeded, or is a subagent.
- The preset recorded at creation differs from the registry default (a caller asked for a preset).
- The user saved a default preset in Settings (`selectedDefault` is set).
- The user picked a preset in the composer: any `agent-preset/selected` event the plugin did not request ends its handling of that session. If the user's pick lands while the plugin's own selection is queued, the plugin selects the user's preset again afterwards so the user's choice is the last one logged.
- A turn has started (`turn/start`); upstream refuses preset changes after that point as well.
- The model has no known window or the lookup fails (logged at debug level).
- `enabled` is false.

## Config

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turn the plugin off without removing its row. |
| `smallWindowTokens` | `65536` | A window below this many tokens is small. Must be a positive integer. |
| `smallPreset` | `air-lean` | Preset id for a small model. |
| `largePreset` | `air` | Preset id for any other known window. |

Bad values fail the plugin load with a message naming the field. Both preset ids must be registered and usable when the plugin first needs them; if one is not, the plugin logs one warning naming it and does nothing for the rest of the process, so session creation is never affected.

## Model Experience

The model sees no difference except the tool list and system prompt of the chosen preset. A session switched to `air` receives the schedule, goal, delegation, and workflow tools and their prompt lines; switching happens before the first request, so the request cache is not rebuilt mid-conversation.

## Known Limitations

- Upstream does not record whether a preset came from the default or from the user. The plugin treats a creation-time preset equal to the registry default as "default applied". A caller that explicitly requests the default preset id is therefore handled as if it had not chosen one.
- Picking in the composer the preset that is already shown sends nothing to the Host, so the plugin cannot see it as a choice, and a later model change can still switch the preset. Since `dsh-v0.2.1-rc.2` the same holds for a programmatic `agentPresets.select` of the preset the session already records and runs: upstream returns without logging `agent-preset/selected`.
- Detection of the user's choice is kept in memory. A blank session that is resumed after a restart is not touched, whatever its history.
- The window is the adapter's value for the model route. A local route that reports no window leaves the default in place.
- A preset switch appends an `agent-preset/selected` event to the log of every large-model session, and a second one if the user then picks another model.
- Checked with upstream's real registry in automated tests. Not yet checked live in the desktop app.
