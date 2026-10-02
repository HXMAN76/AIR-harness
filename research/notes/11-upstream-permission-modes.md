# 11 — Upstream Permission Modes and What AIR Gets Without New Code

This note records what the upstream harness offers for permission behaviour at release tag `dsh-v0.2.0-rc.2`, so that the roadmap decision "use what upstream already offers for now" ([air/plans/README.md](../../air/plans/README.md), row "Permission defaults") can be applied to [plan 03](../../air/plans/2026-09-30-03-permissions.md). Statements are cited as `path:line` against the fork's `air/main` branch. The effective configuration in section 5 comes from `pnpm dsh --profile air --dump-config`, run read-only on this machine. Nothing in this note was tested by running an agent session; behaviour is read from READMEs and source, and the places where that matters are marked.

## 1. Permission presets

### 1.1 What a preset is

A permission preset is a name for one pair of values: a sandbox mode and an approval policy. The preset service writes both values through their owners and records the chosen name; it enforces nothing itself (`packages/interaction/permission-presets/README.md:12`, `:28`). `PresetSpec` holds only those two fields plus an optional display `name` and `description` (`packages/interaction/permission-presets/src/index.ts:183-187`).

### 1.2 Shipped presets

The base bundle declares three presets, with no `name` or `description` (`packages/bundle/base/cordis.patch.yml:250-262`):

| Preset id | Sandbox mode | Approval policy | Web label (English) |
|---|---|---|---|
| `read-only` | `read-only` | `ask` | Read Only |
| `workspace-write` | `workspace-write` | `ask` | Workspace Write |
| `danger-full-access` | `danger-full-access` | `never` | Full access |

Labels come from the Web client's locale dictionary (`packages/client/ui-permission-presets/src/client/locales.ts:69-71`); a `name` set in the host config would replace the localized label (`packages/client/ui-permission-presets/README.md:32`). The plugin's own schema default, used only when a composition gives no `presets`, has two entries (`workspace-write`, `danger-full-access`) with English descriptions (`packages/interaction/permission-presets/src/index.ts:188-197`).

Two names are reserved and rejected in the table at load (`src/index.ts:213-218`):

- `custom` is a derived display value for a sandbox/approval pair that matches no preset. A user can leave it but cannot select it (`README.md:60`, `:135`).
- `auto` belongs to the Auto review integration. Its pair is fixed in code as `danger-full-access` + `ask` (`src/index.ts:89-92`). It appears in the catalog only while that integration is loaded.

### 1.3 Default for new sessions

`defaultPreset` is optional. When absent, the service infers it from the composed sandbox mode and approval policy and fails at load if the pair matches no preset (`src/index.ts:222-227`). The base bundle sets neither field explicitly; it sets the two underlying values from one environment variable (`packages/bundle/base/cordis.patch.yml:229-248`):

- sandbox mode: `process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`
- approval policy: `never` when that variable is `danger-full-access`, otherwise `ask`

So the default for a new session is **Workspace Write** (`workspace-write` + `ask`) unless `DSH_PERMISSION_MODE` is set. The Web bundle adds only client rows (`ui-approval`, `ui-permission`) and does not change these values (`packages/bundle/web-app/cordis.patch.yml:311-312`, `:388-389`). A search of the shipped bundle patches and app manifests found no other row that sets them, so Web and desktop profiles built on base + web-app share this default; the desktop template itself was not opened for this note.

A fresh session is pinned at creation: the service appends `permission/preset` and writes both values (`src/index.ts:437-443`). Later changes to the default never alter an existing session, and a resumed session keeps its recorded values (`README.md:64`).

### 1.4 Switching and what is persisted

- **Current session.** The composer control (accessible name "Access mode, current: {name}", `locales.ts:67`) and the bare `/permission` picker both submit `/permission <preset>` (`packages/client/ui-permission-presets/README.md:32`). Selecting Full access or Auto review in a picker shows a risk confirmation; a typed `/permission <preset>` executes directly (`README.md:12`).
- **Future sessions.** Settings → General has one row that writes `defaultPreset` in the `permission` settings namespace. It offers configured presets only; `auto` is absent (`README.md:38`, `packages/interaction/permission-presets/README.md:64`, `:137`).
- **Session log.** A switch appends `permission/preset` when the effective preset changes, plus the changed `sandbox/mode` and `approval/policy` values through their owners (`packages/interaction/permission-presets/README.md:86`). `permission/preset` is log-only; the model learns of the change through the sandbox and approval runtime-context text (`README.md:121`).

## 2. Auto review

### 2.1 What it is

`@deepseek-ai/dsh-experimental-auto-review` adds the `auto` preset. Before each tool call, a model request classifies the pending action; an allowed call executes with Full access (no file sandbox), and a denied call is sent to the user as an approval request (`packages/experimental/auto-review/README.md:12`, `:46`).

### 2.2 How it decides

The decision is model-based with a fixed prompt. There are no rules, exemptions, or stored grants (`README.md:117`).

- The listener is prepended on `tools/pre-execute` and acts only for sessions whose current preset is `auto`. The outer `run_code` call of PTC mode is skipped; each inner `tools.*` call is reviewed (`src/index.ts:686-693`).
- The reviewer receives the fixed `REVIEW_POLICY` as system text and one user message built from the session: working directory, project constraints, filtered history with source roles, and the full pending call. Main-agent system messages, assistant text, reasoning, and tool results are excluded (`README.md:60`).
- The policy defines three classes (`src/index.ts:52-55`): **low** (project-local reads and writes, builds, tests, non-destructive Git, cleanup of objects the session created) is always allowed; **medium** (irreversible deletion of pre-existing objects, force push, production access, external writes or sends, permission or system changes) is allowed only with explicit current human or direct-parent authorization of action, target, and scope; **high** (sending secrets or private data across a trust boundary) is always denied.
- The reply must be one JSON object with `risk` and `decision`, optionally `reason` on a deny. Any other text, extra block, or invalid combination is an error (`src/index.ts:43-50`, `:561-587`, `:609-613`).

### 2.3 Which model it calls

The reviewer uses the provider and model from the session's latest `request/header`, that is, the same route as the main agent, at temperature 0 through `ctx.llm.stream` (`src/index.ts:371`, `:516`, `:626-637`; `README.md:87`). There is no setting for a separate reviewer model. Any route the agent can use, including an Ollama route declared through `llm-pi-ai`, is therefore accepted. Section 7.4 discusses whether that is advisable.

### 2.4 Outcomes

| Reviewer result | Session policy `ask` (top-level Auto session) | Session policy `never` (delegated in-process child) |
|---|---|---|
| allow | Later listeners run; if they allow, the call executes | Same |
| deny | User is asked; the call runs only on approval (`src/index.ts:713-716`) | Final denial (`src/index.ts:710-712`) |
| malformed reply or request failure | Call fails, body not executed (`src/index.ts:707`, `:669-675`) | Same |

The model sees `Auto review rejected tool "<name>"; its body was not executed`, or the failure text, or the ordinary approval outcome. The reviewer's reason is stored as structured error detail for the user, not as model content. Risk class, reviewer prompt, and raw response are not persisted (`README.md:101`).

### 2.5 Configuration, cost, and enablement

- **Config:** none. The row is `id: auto-review` with no fields (`packages/experimental/auto-review/cordis.patch.yml:1-3`); the policy is a source constant.
- **Cost:** one additional uncached model request per reviewed call, with no retry, truncation, or compaction; an oversized request fails the call with the provider error (`README.md:91`).
- **Enablement:** the package is one of four optional bundles the installation ships switched off (`packages/boot/app-boot/src/profile.ts:213-218`). A user switches it on from the Web sidebar's Plugins page or with `pnpm dsh plugin --profile <name> add ./packages/experimental/auto-review` (`README.md:30-36`). It is then selectable per session only, with an `EXP` badge and a confirmation dialog; it can never be a default (`packages/interaction/permission-presets/README.md:137`).
- **Unloading:** switching the bundle off migrates every live Auto session to Full access with the `never` policy (`src/index.ts:727-733`, `README.md:62`). A stored Auto session cannot reopen without the integration (`packages/interaction/permission-presets/src/index.ts:431-436`).

### 2.6 Stated limitations

From `README.md:115-119`: absent from default Web and Headless; no file sandbox; direct Node effects inside a PTC program are not reviewed; classification can be wrong; no deterministic exemptions, persistent grants, configurable policy, or retry; out-of-process children keep their own permission systems.

## 3. Approval policies, sandbox modes, and escalation

### 3.1 Approval policy

`@deepseek-ai/dsh-user-approval` has two policies (`packages/interaction/user-approval/src/index.ts:70`):

- `ask` sends each request to the composed answerers. With no answerer the result is `unavailable` and the action fails closed (`packages/interaction/user-approval/README.md:32`, `:36`).
- `never` rejects every request inside the service before any answerer runs (`README.md:78`). The model is told not to request escalation (`README.md:122`).

Outcomes are `allowed-once`, `rejected`, `cancelled`, `unavailable` (`src/types.ts:32`). Each request appends `approval/asked` and `approval/decided` to the session log (`README.md:86`). The Web answerer is `ui-approval`, which takes over the composer and can show the correlated tool card (`packages/client/ui-approval/README.md:11`).

### 3.2 Sandbox modes

`@deepseek-ai/dsh-sandbox-policy` holds one mode per session, used by the confined bash, filesystem, and terminal capabilities (`packages/sandbox/sandbox-policy/README.md:12`).

| Mode | File effect (`packages/sandbox/sandbox/README.md:58-60`) |
|---|---|
| `read-only` | No writes except required sinks such as `/dev/null` |
| `workspace-write` | Writes under the session's working directory plus host temp areas |
| `danger-full-access` | No confinement |

If a mode cannot be enforced on the host, the call fails with `SANDBOX_UNAVAILABLE` instead of running unconfined (`packages/sandbox/sandbox/README.md:12`, `:86`).

### 3.3 Escalation

A confined call that is denied returns a marker and, when escalation is advertised, a hint. The model may retry that exact call once with `sandbox_permissions` and a `justification`; the approval service asks the user, and approval covers that one call (`packages/sandbox/sandbox/README.md:66`, `:100`, `:150`). The ladder is `read-only` → `workspace-write` or `danger-full-access`, and `workspace-write` → `danger-full-access`.

### 3.4 What a preset therefore means in practice

In stock compositions the only sources of an approval prompt are sandbox escalation, Auto review denials, and the Claude Code hooks bridge when it is composed; a search for `kind: 'ask'` in package sources found only `packages/core/tools`, `packages/experimental/auto-review`, and `packages/hooks/hooks-claude-code`. Consequently:

- **Workspace Write:** bash and file tools run without prompts inside the working directory. A prompt appears only when the model requests a wider mode for one call.
- **Read Only:** writes are denied; each write needs an escalation prompt.
- **Full access:** no confinement and no prompts; escalation is unnecessary and `never` rejects any other ask.
- **Auto review:** no confinement; a model request before every call; prompts only on reviewer denials.

Plan 03's "shell and file-write ask every time" is not an upstream behaviour in any preset.

## 4. Other shipped modes that affect autonomy

- **Agent presets** choose an Agent's tools and prompt sections, not its permissions (`packages/preset/agent-preset-registry/README.md:12`). The Web labels are Standard mode, PTC mode, Minimal mode, and Creator mode (`packages/client/ui-agent-preset/src/client/locales.ts:44-55`); there is no preset named "Code". From the dumped configuration: `standard` has bash, file tools, search, jobs, skills, goal, planning, compaction, delegation, `ask_user`, todo, web, and the plugin-manager tool; `ptc` adds programmatic tool calling over the same set; `minimal` has only the persona and a persistent shell; `cordis` (Creator) adds the `tool-cordis` self-modification tool. The registry default is `standard`.
- **Plan mode** (`/plan`) asks the agent to plan and submit through `exit_plan_mode` for review. It is guidance only: every tool stays available, and the README directs deployments to sandbox mode and approval policy for enforcement (`packages/plan/plan-mode/README.md:12`, `:185`).
- **Goal round driver** continues an active goal across turns while the agent is idle, up to the goal's round cap (256 by default) (`packages/goal/goal/README.md:12`, `packages/goal/goal-round-driver/README.md:12`). It raises unattended run length but does not change permissions.
- **Timeout policy** applies each tool's declared `timeoutMs` cooperatively; bash, read, write, and edit declare none (`packages/guard/timeout-policy/README.md:12`, `:326`).
- **Repeat-tool reminder** is advisory text at 3, 5, and 8 identical calls and never blocks (`packages/guard/repeat-tool-reminder/README.md:12`).
- **Composer access-mode control** is the permission picker of section 1.4, not a separate mechanism.
- **Settings surfaces in 0.2:** Settings → General (default permission preset), the agent-preset section (roster and new-task default, `packages/client/ui-agent-preset/README.md:12`), and the sidebar Plugins page (optional bundles through the plugin manager, plus per-plugin pages such as Agent loop; `packages/boot/plugin-manager/README.md:14`, `packages/client/ui-settings-agent-loop/README.md:12`).

## 5. What the `air` profile gets today

The installed profile lists bundles `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@air/dsh-air-bundle`; its profile patch declares only the Ollama route and two UI rows. [air/bundles/air/cordis.patch.yml](../../air/bundles/air/cordis.patch.yml) disables DeepSeek-account rows and sets the default model; it touches no permission row. Effective rows from `--dump-config`:

| Row id | Package | Effective config |
|---|---|---|
| `sandbox` | `dsh-sandbox-local` | none |
| `sandbox-policy` | `dsh-sandbox-policy` | `mode: DSH_PERMISSION_MODE ?? 'workspace-write'`, `workspaceRoot: process.cwd()` |
| `bash-sandbox` | `dsh-bash-sandbox` | `timeoutMs: 60000` (disabled on Windows) |
| `approval` | `dsh-user-approval` | `policy: ask` unless `DSH_PERMISSION_MODE` is `danger-full-access` |
| `permission` | `dsh-permission-presets` | three presets as in 1.2; no `defaultPreset`, so inferred `workspace-write` |
| `fs-sandbox` | `dsh-fs-sandbox` | none |
| `ui-approval`, `ui-permission` | Web client rows | present |
| `timeout-policy` | enabled | none |
| `repeat-tool-reminder` | enabled | thresholds 3, 5, 8 |
| `goal`, `goal-round-driver` | enabled | none |
| `agent-preset-registry` | enabled | `default: standard`; presets `standard`, `ptc`, `minimal`, `cordis` |
| `auto-review` | absent | not in the profile's bundle list |

The plugin manager row is active for a named profile, so Auto review is offered, switched off, on the Plugins page.

## 6. Gaps that remain when using upstream modes as-is

Each claim was checked in source at this tag. None of them changed between the rc.1 state described in earlier notes and rc.2 as far as the cited READMEs show; the Auto review bundle and the Plugins-page enablement are the relevant 0.2 additions.

1. **MCP tool calls are not gated by presets.** MCP tools register through `ctx.tools.register` (`packages/mcp/mcp-client/src/tools.ts:150`) and pass through `tools/pre-execute`, but no stock listener returns `ask` for them (section 3.4). Under Workspace Write they run without a prompt. **Partial change:** under Auto review they are reviewed like any other tool, by the model.
2. **No persistent allow rules.** Confirmed: only `allowed-once` exists, with no remembered rule or grant store (`packages/interaction/user-approval/README.md:155`). Auto review adds no grants (`packages/experimental/auto-review/README.md:117`).
3. **Approval requests carry no arguments.** Confirmed: the request has agent, tool name, optional call id, reason, and display reason (`packages/interaction/user-approval/src/types.ts:63-75`, `packages/core/tools/src/index.ts:1744-1751`; `README.md:156`). The Web card can show the correlated call through the call id, and escalation and Auto review put the justification or reviewer reason in the prompt text, but an answerer plugin cannot decide on arguments from the request alone.
4. **No network policy.** Confirmed: the sandbox vocabulary covers file effects only (`packages/sandbox/sandbox/README.md:167`). A confined bash call can still reach the network.
5. **MCP stdio children are unsandboxed.** Confirmed: the transport spawns the configured command directly through the SDK's `StdioClientTransport` with a scrubbed environment and no sandbox policy (`packages/mcp/mcp-client/src/transport.ts:31-39`).
6. **Same-world confinement.** Confined processes share the host kernel and filesystem view (`packages/sandbox/sandbox/README.md:12`, `:168`).
7. **`sudo` is not treated specially** by any preset; under Workspace Write it runs inside the file sandbox, and under Full access or Auto review it runs on the host.

## 7. Recommendation

### 7.1 Smallest configuration

No row is required: with the current bundle, new sessions already start in Workspace Write, users switch per session from the composer, and Auto review is one switch away on the Plugins page.

One optional addition makes the default independent of the `DSH_PERMISSION_MODE` environment variable. A patch replaces a row's whole `config`, so each row restates its fields. Append to `air/bundles/air/cordis.patch.yml`:

```yaml
# Permission defaults: upstream presets, pinned so an ambient
# DSH_PERMISSION_MODE cannot start new sessions in Full access.
- id: sandbox-policy
  config:
    mode: workspace-write
    workspaceRoot: !!js process.cwd()

- id: approval
  config:
    policy: ask

- id: permission
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: workspace-write
```

Omit `name` and `description` so the Web client keeps its localized labels. This patch was not loaded for this note; run `pnpm dsh --profile air --dump-config` after adding it.

### 7.2 Auto review

Leave it as an opt-in the user switches on from the Plugins page. Reasons not to add the `auto-review` row to the AIR bundle: it cannot be a default in any case; its pair is Full access; upstream marks it experimental and states that released products must not depend on experimental packages (`packages/experimental/README.md:12`); and removing the row later moves live Auto sessions to Full access. If the owner still wants it preloaded, the row is the one in `packages/experimental/auto-review/cordis.patch.yml:1-3`, and the bundle's `package.json` would need the package as a dependency; resolution from an out-of-tree bundle was not verified.

### 7.3 Plan 03 adjustments

| Plan 03 part | Recommendation |
|---|---|
| Capability table with `per_call` → `ask` defaults for `fs.write` and `shell.execute` (decision 4) | **Defer or make opt-in.** It contradicts the owner decision. If the package is built, ship those defaults as `allow`. |
| `unscopedMcpDefault: ask` (decision 5) | **Keep.** It closes gap 1 deterministically and is the only prompt most users would see under Workspace Write. Consider making it the package's sole default-on behaviour. |
| sudo guard (decision 11) | **Keep.** No upstream mode covers it, and it is a guard that rules cannot override. |
| Rule store, `Tool(pattern)`, `/allow`, `/deny`, approval answerer (decisions 1, 7, 8; tasks 2, 3, 6, 7) | **Keep but re-scope.** Their first use becomes "stop asking about this MCP tool" and answering escalation prompts, not relieving a blanket ask default. |
| Audit file (decisions 9, 10) | **Keep** with the rule store; upstream already logs `approval/asked` and `approval/decided` per session. |
| Interaction with Auto review | **Add a note.** Plan 03's listener calls `next()` first and combines as `deny > cancel > ask > allow`; Auto review is prepended and turns its own denial into an ask only when downstream allows. Both orders need a test once both are loaded. |

Gaps 4 and 5 (network, MCP children) stay with plan 02 and the planned safety document; no preset addresses them.

### 7.4 Auto review with a 7–8B local model

It will run: the reviewer uses whatever route the agent uses. It is not recommended as the product's safety mechanism on a local 7–8B model, for reasons that follow from the design rather than from a measurement:

- Every tool call gains a second, uncached model request, which roughly doubles local latency per call.
- The review request is never truncated. With the profile's 32,768-token context for `qwen3:8b`, a long session's retained history can exceed the window, and then every call fails until the session is switched to another preset.
- The reply must be exactly one JSON object after optional reasoning. A malformed reply fails the call with no retry. Small models are less reliable at strict output formats; the failure rate on this route is unmeasured.
- An allow executes with no sandbox, and the reviewer is the same model that proposed the call. A wrong "low" classification has no second line of defence, whereas Workspace Write confines files regardless of model quality.

For a local model, Workspace Write is the safer default, with Auto review reserved for sessions on a stronger hosted or larger local model. A short measurement (malformed-reply rate and added latency over about fifty reviewed calls on `qwen3:8b`) would replace this judgment with data and fits the evaluation pilot.
