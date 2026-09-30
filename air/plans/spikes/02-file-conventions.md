# Spike 02: universal file-convention loader (`@air/*` loader bundle)

Status: research spike, 2026-09-30. It turns [research/research.md §5.1](../../../research/research.md), [research/notes/03-competitors.md §5](../../../research/notes/03-competitors.md) and [research/notes/01-harness-audit.md §2.2-2.5, §3.1](../../../research/notes/01-harness-audit.md) into package designs. Every fact below was checked in this checkout (dsh 0.2.0-rc.1, re-based on 0.2.0-rc.2, whose changes in these areas are version bumps only). Line numbers refer to the current files. `pnpm dsh --profile air --dump-config` was run to read the composed tree.

Hard constraint shared with the other spikes: an out-of-tree plugin cannot add a `SessionEventMap` type. `Session.append` has no `ignorable` option, and an unknown non-ignorable type makes the session unloadable (spike 03 §0.1). Every design here therefore records model-visible input as (a) an injected `UserMessage` with an AIR-owned `MessageSourceMap` kind, (b) a tool result, (c) a system-prompt section (logged with the request), (d) upstream-declared events that AIR may reuse (`hook/invoked`, `hook/result`, `command/run`, `command/done`, `approval/policy`), or (e) an AIR-owned file. `MessageSourceMap` is merge-extensible and consumers fall through unknown kinds (`packages/llm/llm/src/message.ts` L110-136), so a custom source kind does not break loading.

## 0. Findings that change the research design

1. **The Web composition mounts skills, instructions, and subagent tools inside the agent preset, not at host level.** In the composed `air` tree the host rows `skill-filesystem`, `tool-skill`, `tool-subagent*` are `disabled: true` (`packages/bundle/web-app/cordis.patch.yml` L477-491) and the live rows sit in `preset-standard.config.plugins` (`packages/bundle/web-app/presets/standard.patch.yml` L16-37). A bundle patch cannot reach those nested rows by id: `applyEntryPatches` indexes nested rows only for `group: true` entries (`vendor/include/src/index.ts` L65-74), and `@deepseek-ai/dsh-agent-preset` is not a group. A patch can only replace `preset-standard`'s whole `config`, which forks the upstream plugin list.
2. **The preset layer wins skill-name duplicates outright** (`packages/skill/skill/src/index.ts` L345-355). A host-level AIR skill provider adds skills beside the preset's `skill-filesystem`, but it cannot hide the user roots the preset's provider reads. Restricting roots requires changing the preset's `skill-filesystem` config (or its environment defaults, §1.3).
3. **There is a supported, HMR-safe pattern for per-agent child plugins owned by another plugin**: `createScope(ctx, agent)` then `scope.ctx.plugin(Module, config)` inside an `agent/created` or on-demand path. `experimental/browser-use-runtime/src/mcp.ts` L100-160 mounts `@deepseek-ai/dsh-mcp-client` per Agent this way; the scope fiber is a child of the minting plugin's fiber, so unloading the AIR plugin disposes every child. `acp/acp/src/mcp.ts` L26-33 is the simpler variant that mounts on `agentCtx` inside `ctx.agents.create({ setup })`, which AIR does not own.
4. **User-invocable skills already give `/name`**, but the body is injected verbatim; `$ARGUMENTS` is never substituted, and the gesture regex matches `/name` anywhere in a user message, not only at its start (`packages/skill/tool-skill/src/index.ts` L177-208, L409).
5. **`tool-subagent` has no per-instance description**; its model-facing description is fixed text from `providerWording()` (`packages/subagent/tool-subagent/src/index.ts` L252-276). One tool instance per Claude Code agent file would give N identically described tools, which a small local model cannot route. §2 therefore proposes one AIR delegation tool with an agent-type parameter.
6. **The Claude Code hook bridge matches Claude Code matchers against dsh tool names** (`bash`, `read`, `edit`, ...), so a `"matcher": "Edit|Write"` group never fires (`packages/hooks/hooks-claude-code/src/index.ts` L244-249). MCP names already agree (`mcp__<server>__<tool>`).
7. **Approval has no "always allow" outcome.** `ApprovalOutcome` is `allowed-once | rejected | cancelled | unavailable` (`packages/interaction/user-approval/src/index.ts` L54). Persisting a rule after an ask needs an AIR command or settings page, not the approval card.

## 1. Skills

### 1.1 Current API

`packages/skill/skill-filesystem/src/index.ts`:

```ts
export const name = 'skill-filesystem'
export const inject = ['skills']
export interface Config {                       // L49-74
  providerName?: string                         // default 'filesystem'
  includeDefaultRoots?: boolean                 // default true
  dshHome?: string                              // default $DSH_HOME or ~/.dsh
  agentsHome?: string                           // default $DSH_AGENTS_HOME or ~/.agents (L168)
  customSkillDirs?: string[]                    // default []; resolve()d against process cwd (L169)
  watch?: boolean                               // default true
  watchUsePolling?: boolean
  watchStabilityThresholdMs?: number
  watchPollIntervalMs?: number
  watchMaxProjects?: number
  watchFollowSymlinks?: boolean
  bundledSkillDir?: string                      // default $DSH_BUNDLED_SKILL_DIR only when includeDefaultRoots
}
```

Roots (`roots()`, L245-265), lower rank wins within one layer:

| Root | Source | Rank | Condition |
|---|---|---|---|
| `<project>/.dsh/skills` | `project-dsh` | 100 | `includeDefaultRoots` and a `cwd` |
| `<project>/.agents/skills` | `project-agents` | 200 | same |
| each `customSkillDirs` entry | `custom` | 300 | always |
| `<dshHome>/skills` (skips `.system`) | `user-dsh` | 400 | `includeDefaultRoots` |
| `<agentsHome>/skills` | `user-agents` | 500 | `includeDefaultRoots` |
| bundled dir | `bundled` | 600 | explicit or env default |

`<project>` is the nearest ancestor containing `.git` (`findProjectRoot`, L945-955). Entries are `<root>/<dir>/SKILL.md` or flat `<root>/<name>.md`, one level deep (`discoverRoot`, L723-751).

Frontmatter parsed today (`parseSkillFile`, L797-840; `parseInvocationPolicy`, L1000-1010): `name` (required, kebab-case via `isSkillName`), `description` (required), `whenToUse`, `disable-model-invocation`, `user-invocable`, `metadata` (object). Legacy camelCase invocation keys throw. Every other key is ignored; a file without `name` is dropped with a warning.

Claude Code fields with no mapping today: `name` defaulting to the directory name, `allowed-tools`, `disallowed-tools`, `model`, `context: fork`, `agent`, `argument-hint`, `arguments`, `paths`, `hooks`, `$ARGUMENTS` / `$1..$n`, `${CLAUDE_SKILL_DIR}`, `` !`cmd` `` pre-execution, `@file` expansion.

Registry (`packages/skill/skill/src/index.ts`):

```ts
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void   // L390
register(skill: SkillRegistration): () => void                                           // L439
interface SkillProvider {                                                                 // L247-267
  readonly name: string
  readonly list: (o: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  readonly get: (c: SkillCandidate, o: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
interface SkillProviderControl { readonly signal: AbortSignal; readonly invalidate: () => void }
interface SkillCandidate extends SkillSummary { readonly rank: number; readonly locator: unknown; readonly metadata?: ... }
type SkillSource = 'project-dsh' | ... | (string & {})                                   // L40, open for AIR sources
```

Any number of providers may register; names must be unique per layer, and a registration files into the calling context's scope. `SkillLookupOptions.cwd` is the session cwd, so a second provider can compute project-relative roots per lookup. `SessionSkillCatalog.list` (`packages/api/session-controller/src/skill-catalog.ts` L64-88) feeds the Web `/` picker with every user-invocable skill from the scoped registry, so AIR skills appear there with no client work.

### 1.2 Proposed out-of-tree design (`@air/dsh-skill-conventions`)

A skill provider plugin (`providerName: 'air-conventions'`) implementing `SkillProvider`, mounted in the AIR preset (§1.3) so it lands in the same layer as the preset's `skill-filesystem`.

- Roots, per lookup `cwd`: project `.claude/skills` (rank 150, source `project-claude`), project `.claude/commands` (rank 160, source `project-claude-commands`), each `extraProjectRoots` entry (for `.opencode/skills`, `.qoder/skills`, `.cline/skills`), user `~/.claude/skills` and `~/.claude/commands` only when `includeUserRoots` is true, and an AIR-owned root `$AIR_HOME/skills` (default `~/.air/skills`, rank 350). Ranks between upstream ranks keep `.dsh/skills` authoritative.
- Parser: accepts a missing `name` (directory or file stem, normalised to kebab-case; `.claude/commands/frontend/component.md` becomes `frontend-component`, because command and skill names cannot contain `:`), a missing `description` (first body paragraph, capped), and keeps the Claude Code fields in `SkillCandidate.metadata.claudeCode` for other AIR plugins. Commands default to `modelInvocable: false`, `userInvocable: true`, which keeps them out of the model catalog (small-model budget) while the `/` picker lists them.
- Body transforms at `get()`: replace `${CLAUDE_SKILL_DIR}` with the skill directory. `$ARGUMENTS` stays literal in the body; argument binding happens in `@air/dsh-command-conventions` (§3).
- Watching: reuse the upstream pattern only if needed; the first slice can set `watch: false` semantics and call `control.invalidate()` from an `fs/observed` listener like `skill-filesystem` L143-146.
- Description budget: a `descriptionMaxChars` Config field (research target 1,500) applied in `list()`; `tool-skill`'s own `catalogDescriptionMaxLength` (default 500) still caps the rendered catalog.
- `allowed-tools`: record only. Enforcing it needs a per-skill-activation window (the skill tool result starts it, and the turn end closes it) implemented as a `tools/pre-execute` listener in `@air/dsh-permission-rules` (§8), keyed by the `skill` tool result in the session. Deferred to slice 2.
- `context: fork` / `agent`: slice 2, through the AIR delegation tool (§2): loading such a skill returns a tool result instructing the model to call `agent` with that skill's body as the prompt.

### 1.3 Restricting user roots (the `~/.agents/skills` problem)

Options, in order of preference:

1. **AIR preset.** The bundle inserts a new row `preset-air` (`@deepseek-ai/dsh-agent-preset`, `id: air`) whose `plugins` list starts as a copy of the standard list with `skill-filesystem` configured as below, plus AIR rows. It patches `agent-preset-registry` to `config: { default: air }` (that row's schema is only `default` plus the Volatile `selectedDefault`, `packages/preset/agent-preset-registry/src/index.ts` L53-56, so whole-config replacement loses nothing). `preset-standard` stays available. The copied list must be diffed at each upstream merge; the README checklist in `air/README.md` already runs `--dump-config` after merges.

   ```yaml
   - id: skill-filesystem
     name: '@deepseek-ai/dsh-skill-filesystem'
     config:
       includeDefaultRoots: false          # drops project .dsh/.agents, ~/.dsh/skills, ~/.agents/skills, bundled
   ```

   With `includeDefaultRoots: false` the upstream provider also loses project roots, because `customSkillDirs` are absolute (resolved once at load). The AIR provider therefore owns project `.dsh/skills` and `.agents/skills` too (same ranks as upstream), and `customSkillDirs` keeps only fixed absolute roots. Result: project roots and `~/.air/skills` only; `~/.agents/skills` is opt-in through `includeUserRoots` or `userRoots: [...]`.
2. **Environment redirect, zero YAML.** `agentsHome` defaults to `$DSH_AGENTS_HOME` (L168) and nothing else in the repository reads that variable (only `skill-filesystem` and test harnesses). `DSH_AGENTS_HOME=~/.air/agents` in `~/.dsh/.env` (loaded by `loadEnv`, `packages/boot/app-boot/src/index.ts` L117-129) removes the 36 unrelated skills today. It is home-wide, not per profile, and leaves `~/.dsh/skills` active, so it is a stopgap.
3. Replace `preset-standard`'s whole config in the patch. Rejected: silently forks the upstream plugin list under the upstream id.

### 1.4 Upstream edits

None required. Optional, small: a `projectSkillDirs?: string[]` Config field (relative roots joined to the per-cwd project root) in `skill-filesystem` would let `.claude/skills` ride the upstream provider and its watcher. Not needed for slice 1.

### 1.5 Tests

- Unit: parser table (missing name, missing description, namespaced command path, `${CLAUDE_SKILL_DIR}`, invalid YAML dropped with a warning), rank ordering against a fake `skills` registry, disposal removes the provider (`registerProvider` disposer; HMR test required by `packages/AGENTS.md`).
- REAL composition: boot the shipped `web` profile plus the AIR bundle through the repository-only helper `packages/test-support/loader-smoke/tests/fixtures/production-profile.ts` (not exported; AIR copies it or imports it by relative path), a test `*.patch.yml` with `llm-mock-server` as the route, a temp cwd containing `.claude/skills/x/SKILL.md` and a temp `DSH_AGENTS_HOME` with a decoy skill. Assert the durable `skill-catalog` message (source kind `skill-catalog`) lists `x` and not the decoy, and `ctx.remote.skills.list` returns the command entries.

### 1.6 Risks

Catalog growth for small models (mitigated by commands being non-model-invocable and the description cap). `.claude/skills` written for Claude Code often call `Bash(...)`-style tools or Claude-only tools; the model sees names that do not exist here. Symlinked skill directories shared across agents duplicate names; rank order decides silently.

## 2. Subagents from `.claude/agents/*.md`

### 2.1 Current API

`packages/subagent/tool-subagent/src/index.ts`:

```ts
export const name = 'tool-subagent'
export const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections']   // L45
export interface Config {                                                          // L48-104
  provider: string                           // ctx.subagents provider, e.g. 'spawn', 'fork'
  toolName?: string                          // default 'subagent'; unique per instance
  modelSelectionSettings?: boolean
  enableRunInBackground?: boolean
  backgroundMode?: 'one-shot' | 'continuable'
  agentOptions?: AgentOptions                // { provider, model, reasoningEffort, maxTokens }
  persona?: string                           // shadows deployment:persona-prefix
  toolFilter?: { allow?: string[]; deny?: string[] }
  maxDepth?: number | 'provider-managed'
}
export function apply(ctx: Context, config: Config, session?: Session): void      // L313
```

Instances are Cordis rows (`tool-subagent`, `tool-subagent-fork` inside the preset `delegation` group). The tool's parameters are `description`, `prompt`, optional model selection, optional `run_in_background` (L379-430); its description is fixed.

Seam (`packages/subagent/subagent/src/types.ts`):

```ts
ctx.subagents.start(name: string, request: SubagentStartRequest): Promise<SubagentRun>   // index.ts L559
ctx.subagents.startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>    // index.ts L261
interface SubagentStartRequest {                                                         // L145-196
  label?: string; prompt: ContentBlock[]; parent: Agent; signal: AbortSignal
  agentOptions?: AgentOptions; outputSchema?: ObjectJsonSchema; maxDepth?: number
  toolFilter?: ToolRestriction; persona?: string
}
interface SubagentCapabilities { agentOptions; outputSchema; depthLimit; toolFilter; persona }  // L128-134
```

`ContinuableStartSpec.request` is `Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>` (L32-50), so persona and tool filter also apply to continuable children.

Runtime kinds: a plugin can mount `tool-subagent` as a child with its own config (`scope.ctx.plugin(ToolSubagent, cfg)`, §0.3), so kinds can be created at runtime. `@deepseek-ai/dsh-agent-preset-registry` exposes `register(definition: PresetDefinition)` (L80) with `PresetDefinition = { id, name?, description?, order?, plugins }` (`definition.ts` L5-11); a preset is a whole composition for a top-level session, not a delegation target, so it is the wrong unit for Claude Code agents.

### 2.2 Proposed out-of-tree design (`@air/dsh-agent-conventions`)

One AIR tool `agent` registered per Agent (scoped via `createScope(ctx, agent)` on `agent/created`, because project agents depend on the session cwd), with parameters `subagent_type` (enum of discovered names), `description`, `prompt`. Its description lists each agent's `name: description`, which is what a model needs to route. `execute()` calls `ctx.subagents.start(config.provider, { label, prompt, parent: exec.agent, signal: exec.signal, persona, toolFilter, agentOptions, maxDepth })` and returns the child's output as the tool result. Slice 1 is foreground and one-shot; background and continuable modes stay with upstream `subagent`.

Discovery: `.claude/agents/*.md`, `.qoder/agents/*.md`, `$AIR_HOME/agents/*.md`, and `~/.claude/agents/*.md` when `includeUserRoots`. Project wins by name.

Field mapping:

| Claude Code field | Mapping | Status |
|---|---|---|
| `name`, `description` | enum value and tool description line | direct |
| body | `persona` (requires provider `persona` capability; `spawn` has it) | direct |
| `tools` | `toolFilter.allow` after name translation (table below) | direct |
| `disallowedTools` | `toolFilter.deny` after translation | direct |
| `model` (`sonnet`/`opus`/`haiku`/`inherit`/id) | `agentOptions {provider, model}` through a Config alias table `modelAliases: { sonnet: {provider, model}, ... }`; `inherit` omits | direct |
| `skills` | read each named skill through `ctx.skills.get(name, { cwd, scope: parent })` and append `renderSkillContent()` to the persona (Claude Code preloads the full body) | direct |
| `maxTurns` | a child-scoped `agent/pre-step` listener that returns `{ kind: 'reject' }` after N steps; mounted from a `subagent/start` listener on the child's `agent.ctx` | feasible, verify ordering |
| `permissionMode` | `plan` maps to the child's plan mode; `bypassPermissions`/`default` map to `setApprovalPolicy(child.session, 'never'|'ask')` (an upstream-declared `approval/policy` event) from `subagent/start` | feasible, verify timing: the child's first request may already be admitted |
| `mcpServers`, `hooks`, `memory`, `isolation: worktree`, `background` | not in slice 1 | deferred |

Tool-name translation table (shared with §6 and §8, owned by `@air/dsh-convention-core`): `Bash`→`bash`, `Read`→`read`, `Write`→`write`, `Edit`/`MultiEdit`→`edit`, `Glob`→`glob`, `Grep`→`grep`, `WebFetch`→`web_fetch`, `WebSearch`→`web_search`, `TodoWrite`→`todo_write`, `Task`/`Agent`→`agent`, `AskUserQuestion`→`ask_user_question`, `mcp__*` unchanged. Unknown names fail that agent loudly (logged, agent omitted), matching the "misconfiguration fails loud" rule.

Fallback without a new tool: mount one `tool-subagent` child per agent file (`toolName: agent_<name>`, `persona`, `toolFilter`, `agentOptions`) and add a system-prompt section (`ctx.systemPrompt.section`, `packages/core/system-prompt/src/index.ts` L454) listing `agent_<name>: <description>`. Works with zero upstream edits and keeps jobs and background support, but gives N tool schemas.

### 2.3 Upstream edits

None for the recommended design. Optional one-field edit if the fallback is preferred: `description?: string` in `tool-subagent` Config appended to the fixed wording.

### 2.4 Tests

Unit: frontmatter to `SubagentStartRequest` mapping (golden table), alias resolution, unknown tool name failure, `skills` preload. Fake `ctx.subagents` provider asserts the request. REAL composition: web profile plus AIR bundle, mock LLM scripted to call `agent` with `subagent_type: reviewer`; assert the child session's `parentSession` link, the child's system prompt contains the persona (logged request), and a denied tool is absent from the child's tool list.

### 2.5 Risks

`ToolRestriction` validation names "global tools" and throws on unknown names (`packages/core/tools/src/index.ts` L1097-1117). In the Web tree most tools are preset-scoped; confirm that preset tools count as known before shipping. Persona text from third-party agent files is model-visible and trusted; it should pass through the same review surface as skills.

## 3. Commands and `$ARGUMENTS`

### 3.1 Current API

`packages/interaction/commands/src/index.ts`:

```ts
interface CommandInvocation { commandId; agent: Agent; rawInput: string; attachments; signal }   // L41-59
interface CommandDefinition {                                                                  // L61-80
  definitionId?: CommandDefinitionId; name: string /* /^[a-z][a-z0-9_-]*$/ */
  description: string; input?: { hint: string; attachments?: boolean }
  recordInput?: boolean
  handler(i: CommandInvocation): CommandResult | Promise<CommandResult>
}
register(definition: CommandDefinition): () => void                                            // L285; scoped by calling ctx
list(agent: Agent): readonly CommandDescriptor[]                                               // L315
```

A command runs without a model turn and logs `command/run` / `command/done`. To reach the model, a handler calls `invocation.agent.followup(createUserMessage({ content, source }))` (pattern in `packages/goal/command-goal/src/index.ts` L117-123; `Agent.followup/steer/inject` in `packages/core/agent/src/runtime-types.ts` L215-240). Names collide per layer; scoped registration through `createScope(ctx, agent).ctx.commands.register(...)` gives per-session project commands.

User-invocable skills are the other path: `tool-skill` scans claimed `user`-source messages for `/<skill-name>` and appends a `skill-invocation` message with the verbatim body (L177-208).

### 3.2 Proposed out-of-tree design (`@air/dsh-command-conventions`)

Register each `.claude/commands/*.md` (and each skill with `arguments`/`$ARGUMENTS` in its body) as a scoped `ctx.commands` definition with `input.hint` from `argument-hint`. The handler:

1. Splits `rawInput` into `$ARGUMENTS` and positional `$1..$n` (shell-like quoting), substitutes named `arguments:` placeholders.
2. Expands `@path` references relative to the session cwd (bounded bytes, project-root containment).
3. For `` !`cmd` `` lines, runs the command through `ctx.shell` only after `ctx.approval.request({ agent, toolName: 'bash', reason })` returns `allowed-once` (approval routes through the configured answerers and is audited with upstream events), and inlines stdout.
4. Calls `agent.followup(createUserMessage({ content, source: { kind: 'air-command', name, form: 'instructions' } }))`, declaring `'air-command'` in `MessageSourceMap`. The rendered prompt is a logged `user/message`, so the model-visible text is reconstructable.

The same command therefore appears twice in the `/` picker (once as a user-invocable skill from §1, once as a command). Resolve by giving `.claude/commands` entries `userInvocable: false` in the skill provider when the command plugin is loaded (a Config flag on the provider), so only the command path surfaces them. `.claude/skills` with `$ARGUMENTS` keep the skill path; slice 2 adds an outer `agent/pre-step` listener that rewrites the `skill-invocation` message by substituting the text that followed the gesture. That rewrite depends on waterfall order between a host listener and the preset-scoped `tool-skill` listener and must be pinned by a composition test.

### 3.3 Upstream edits

None.

### 3.4 Tests

Unit: argument splitting and substitution table, `@file` containment, `!cmd` denied when approval is `rejected`/`unavailable`. REAL composition: submit `/fix-issue 123` through the commands Remote; assert `command/run`, then a `user/message` with source `air-command` whose text contains `123`.

### 3.5 Risks

`!cmd` is code execution from a repository file; approval per run is mandatory and the `never` policy must refuse it. Names with `:` namespaces lose their separator.

## 4. Instructions

### 4.1 Current API

`packages/context/agent-instructions/src/config.ts` L18-45:

```ts
interface Config {
  dshHome?: string                          // user-global $DSH_HOME/AGENTS.md only
  projectRootMarkers?: string[]             // default ['.git']
  maxBytes: number                          // required; 65536 in the shipped rows
  maxSourceBytes?: number                   // default 1 MiB
  instructionFileCandidates?: string[]      // default ['AGENTS.md', 'CLAUDE.md']; no '/' allowed (L117-122)
  localInstructionFileCandidates?: string[] // default ['AGENTS.local.md', 'CLAUDE.local.md']
}
```

It loads the user-global file and every candidate from project root down to cwd, dedups identical siblings, injects one durable baseline message (source kind `agent-instructions`), and adds nested files after `read`/`write`/`edit` touches. The README (L216) states that `.claude/rules/` and `@path` imports are not interpreted. Candidates cannot name `.claude/CLAUDE.md` (slash rejected), and `~/.claude/CLAUDE.md` is never read. In the Web tree the live row is inside the preset (`maxBytes: 65536`); the host row is disabled.

### 4.2 Proposed out-of-tree design (`@air/dsh-instruction-conventions`)

Keep upstream `agent-instructions` for AGENTS.md/CLAUDE.md chains. Add a companion plugin in the AIR preset that, on the first `agent/pre-step` of a session (same baseline rule as upstream: inject once, reconcile on resume by comparing a digest stored in the message source), appends one `UserMessage` with source `{ kind: 'air-instructions', form: 'instructions', digest }` containing:

- `.claude/CLAUDE.md` and `~/.claude/CLAUDE.md` (the latter behind `includeUserRoots`).
- `@path` imports found in any loaded CLAUDE.md, AGENTS.md or local file: max 4 hops, cycle detection, project-root containment; imports outside the project are skipped with a note unless listed in Config `allowedImportRoots` (the research asks for approval; an approval prompt before the first request has no open turn, and `ApprovalService.request` requires one, so slice 1 uses the allowlist).
- Rules: `.claude/rules/**/*.md` (`paths:`), `.cursor/rules/*.mdc` (`globs`, `alwaysApply`), `.kiro/steering/*.md` (`inclusion:`) normalised to `always | glob | description | manual`. `always` rules go in the baseline; `glob` rules are added after a `tools/post-execute` on `read`/`write`/`edit` whose `file_path` matches, delivered through `PostToolDecision.additionalContexts` with the same source kind (logged with the tool result); `description` rules become a catalog line; `manual` rules become user-invocable skills through §1's provider.

Budget: its own `maxBytes` Config field; upstream's 64 KiB budget is separate.

### 4.3 Upstream edits

None. Optional: allow a relative path segment in `instructionFileCandidates` so `.claude/CLAUDE.md` rides upstream dedup and refresh.

### 4.4 Tests

Unit: import resolver (hops, cycles, containment), rule normalisation table, glob matching. REAL composition: temp project with `CLAUDE.md` containing `@docs/style.md` and `.claude/rules/ts.md` with `paths: ['**/*.ts']`; mock LLM reads `a.ts`; assert the baseline `air-instructions` message has the import text and the `tool/result` for the read carries the rule context.

### 4.5 Risks

Duplicate text with upstream when both read the same file (dedup by content digest across both sources). Prompt cache churn when glob rules arrive mid-session.

## 5. MCP config import (`.mcp.json`)

### 5.1 Current API

`packages/mcp/mcp-client/src/index.ts`:

```ts
export const name = 'mcp-client'; export const inject = ['tools']                 // L31-34
type Config = StdioConfig | StreamableHttpConfig                                   // L104
// stdio: { transport:'stdio', serverName /^[A-Za-z0-9_-]{1,32}$/, command, args, env, cwd,
//          toolCallTimeoutMs, failOnStartupError, maxInstructionBytes?, reconnect? }   L51-76
// http:  { transport:'streamable-http', serverName, url, headers, toolCallTimeoutMs,
//          failOnStartupError, maxInstructionBytes?, reconnect? }                  L79-101
export const Config = z.union([...])                                              // L119-142, callable validator
export async function apply(ctx: Context, config: Config): Promise<void>           // L154
```

`serverName` is reserved per scope (`scopeOf(ctx) ?? ctx.root`, L162-176), so two Agents may each own `github` while duplicates inside one scope fail loud. `env` is merged over a scrubbed ambient env. No legacy SSE transport, no OAuth, no `${VAR}` expansion.

Dynamic children: `experimental/browser-use-runtime/src/mcp.ts` L100-160 (`createScope(ctx, agent)`, `await scope.ctx.plugin(McpClient, McpClient.Config({...}))`, `scope.dispose()` on close, all inside `ctx.effect`). `createScope` (`packages/core/scope/src/index.ts` L137-146) mints a no-op child fiber of the calling plugin and tags its context with the key, so registrations land in the Agent's layer while ownership stays with the AIR plugin (HMR and unload dispose them). `Fiber.dispose` is an effect of the parent fiber (`vendor/cordis/src/fiber.ts` L265).

### 5.2 Proposed out-of-tree design (`@air/dsh-mcp-conventions`)

Host-level plugin, `inject: ['agents', 'tools']`:

- `ctx.on('agent/created', async ({ agent, signal }) => ...)`: this waterfall-free serial event is awaited before the Agent's queued input runs (`runtime-types.ts` L252-261), so tools exist for the first request. Read `<projectRoot>/.mcp.json` (and `~/.claude.json` project entries, Claude Desktop config, when `includeUserRoots`), expand `${VAR}` and `${VAR:-default}` from `process.env`, map `type: stdio|http` (`sse` rejected with a warning), map `cwd` default to the session cwd, set `failOnStartupError: false`, validate with `McpClient.Config(...)`, then `createScope(ctx, agent)` and `await scope.ctx.plugin(McpClient, cfg)` per server. Keep `Map<Agent, Scope>`; dispose on `agent/disposed` and in the plugin effect.
- Project `.mcp.json` servers need consent before launch (Claude Code asks once per server). Slice 1: an AIR-owned approval file `$AIR_HOME/mcp-approvals.json` keyed by project root plus server digest; unapproved servers are skipped and listed through an `/mcp` command (§3) that records approval and remounts. No session event is added.
- Resources: upstream `mcp-resources` rows are global; its tools read the agent's servers through the scope chain (`packages/mcp/mcp-resources/src/index.ts` L113 uses `createScope` the same way).
- Interaction with spike 03: AIR's per-agent children get `inject: [mcpToolReview]` semantics only through the row mechanism; a programmatic `ctx.plugin` child has no row `inject`. The trust service must therefore be read opportunistically or the plugin must wait for it before mounting.

### 5.3 Upstream edits

None. (Spike 03's review hook is a separate delta.)

### 5.4 Tests

Unit: `.mcp.json` parser and env expansion table, duplicate names, unapproved skip. HMR: dispose the AIR fiber and observe `mcp__x__*` tools removed from the Agent's view. REAL composition: fixture MCP server over stdio (a tiny Node script in the test tree), `.mcp.json` in the temp cwd, pre-approved file; assert the logged request's tool list contains `mcp__demo__echo` and a scripted call returns its output.

### 5.5 Risks

Startup latency of N servers blocks Agent creation (mount in parallel with a per-server timeout; `failOnStartupError: false`). Repository-supplied commands are code execution; the consent file is mandatory.

## 6. Hooks

### 6.1 Current API

`packages/hooks/hooks-claude-code/src/index.ts`:

```ts
export const inject = ['shell', 'sessionProjections']                      // L50
interface Config {                                                          // L53-80
  configPath: string        // required; hooks.json or settings file with a `hooks` key; read once at load
  pluginRoot?: string       // ${CLAUDE_PLUGIN_ROOT}
  projectDir?: string       // ${CLAUDE_PROJECT_DIR}; default per run = session cwd
  defaultTimeoutMs?: number
  stderrSummaryMaxChars?: number
}
```

Supported events (`config.ts` L12-18): `SessionStart` (on `agent/created`), `UserPromptSubmit` (`agent/pre-step`), `PreToolUse` (`tools/pre-execute`), `PostToolUse` (`tools/post-execute`), `Stop` (`agent/turn-stopping`), `SubagentStart`, `SubagentStop`. Only `command` hooks run. `updatedInput` and `systemMessage` are warned and ignored; `allow` does not pre-approve; `continue: false` is logged only; `agent_type` is always `general-purpose`. The config is process-level (TODO per-session discovery); several files mean several rows.

`@deepseek-ai/dsh-hook-protocol` exports everything a second bridge needs: `runHook`, `matchesMatcher`, `mergeHookOutputs`, `parseHookOutput`, `appendHookInvoked`, `appendHookResult` (upstream-declared `hook/invoked` / `hook/result` events, usable out of tree), `createDetachedRuns` (`hook-protocol/src/index.ts`).

### 6.2 Proposed out-of-tree design (`@air/dsh-hook-conventions`)

A separate AIR bridge built on `dsh-hook-protocol`, not a fork of `hooks-claude-code`:

- Per-session config discovery on `agent/created`: `.claude/settings.json`, `.claude/settings.local.json`, and user `~/.claude/settings.json` (opt-in), merged in Claude Code order.
- Tool-name translation (§2 table, reverse direction) so `matcher` and `tool_name` use Claude Code names; `tool_input` keys translated where they differ (`file_path` already matches).
- Events that map to existing extension points: all seven upstream ones, plus `SessionEnd` (`agent/disposed`, observe only), `PostToolUseFailure` (`tools/post-execute` with `result.isError`), `Notification` / `PermissionRequest` (an `approval/request` waterfall listener, `packages/interaction/user-approval/src/types.ts` L79-91; a `PermissionRequest` hook returning allow or deny answers the ask), `PreCompact` (observe only: `session/event` for the upstream `compaction/start` marker, `packages/core/session/src/index.ts` L77; blocking is not possible without an upstream event).
- `permissionDecision: allow` from `PreToolUse` short-circuits AIR's rule store (§8) because AIR's listener owns both; upstream `ask` semantics stay.
- `updatedInput`: not possible. `PreToolDecision` excludes input rewriting by design (`packages/core/tools/src/index.ts` L598-611). Map it to `deny` with the reason "hook requested modified input" or leave warned; do not emulate.
- `http` hooks: POST the same payload with a timeout; `prompt` hooks: slice 2.
- AIR must not also mount upstream `hooks-claude-code` on the same file, or every hook runs twice.

### 6.3 Upstream edits

None for the listed events. A blocking `PreCompact` needs a new waterfall in `compaction` (candidate delta). Honoring `updatedInput` would need a `PreToolDecision` variant (rejected upstream by design).

### 6.4 Tests

Unit: settings merge, matcher translation (`Edit|Write` fires on `edit`), `PermissionRequest` mapping. REAL composition: settings file with a `PreToolUse` `Bash` deny hook (shell script exiting 2); mock LLM calls `bash`; assert the tool result is a denial and `hook/invoked` / `hook/result` events exist.

### 6.5 Risks

Repository hooks are code execution at session start; the same consent file as §5 should gate project hooks. Detached `SessionStart` context can miss the first request (upstream limitation noted in the audit).

## 7. Plugin manifests

### 7.1 Current state

No code reads `.claude-plugin/plugin.json`, `marketplace.json`, or Agent Plugins `plugin.json`; only `${CLAUDE_PLUGIN_ROOT}` substitution exists (`hooks-claude-code` Config). dsh's own plugin format is an npm package with `dsh.bundle.patch`, installed by `dsh plugin add`.

### 7.2 Proposed minimal support (`@air/dsh-plugin-conventions`, slice 2)

A resolver, not an installer: Config `pluginDirs: string[]` plus `$AIR_HOME/plugins/*`. For each directory, read `.claude-plugin/plugin.json` (Claude Code) or root `plugin.json` (Agent Plugins), then feed component paths to the other AIR plugins through a small same-process service `airConventionSources` (owned by `@air/dsh-convention-core`): `skills/`, `commands/`, `agents/`, `hooks/hooks.json` (with `pluginRoot`), `.mcp.json` / `mcp.json`. Enabled plugins are listed in an AIR-owned file; `marketplace.json` is read only to list installable entries, with fetching and signatures left to research §5.1a. No upstream edits.

Tests: fixture plugin directory with one component of each type; assert each appears in its consumer (catalog, command list, agent enum, tool list, hook run).

Risk: plugin-namespaced names (`plugin:skill`) do not fit `isSkillName` or command names; prefix as `<plugin>-<name>`.

## 8. Permission modes and `Tool(pattern)` rules

### 8.1 Current API

`packages/core/tools/src/index.ts`:

```ts
'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution,
                    next: () => Promise<PreToolDecision>): Promise<PreToolDecision>      // L153, waterfall
type PreToolDecision =                                                                    // L607-611
  | { kind: 'allow' } | { kind: 'deny'; reason: string; info?: ToolErrorInfo } | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { en: string; [locale: string]: string } }
interface ToolExecutionInput { callId; rootCallId?; name; schema?; arguments: unknown; agent?; parent?; signal }  // L326-352
restrict(filter: ToolRestriction): () => void                                            // L1097, scoped ctx only
```

`ask` resolves through `ctx.get('approval')` (`serviceAsk`, L1716-1760) with `ApprovalRequest { agent, toolName, callId?, reason?, displayReason?, signal? }` (`user-approval/src/index.ts` L111-132). Arguments are not copied into the request; `callId` links the prompt to the already presented tool call card, which shows the arguments. Outcomes are `allowed-once | rejected | cancelled | unavailable`. Session policy is `ask | never` (L54-66). `@deepseek-ai/dsh-permission-presets` bundles sandbox mode with approval policy (`read-only`, `workspace-write`, `danger-full-access` in the composed tree) and owns `/permission`. Plan mode is `@deepseek-ai/dsh-plan-mode` in the preset.

### 8.2 Proposed out-of-tree design (`@air/dsh-permission-rules`)

- Rule store: parse `permissions.allow|ask|deny` arrays from the same settings files as §6 plus `$AIR_HOME/permissions.json`, in Claude Code grammar `Tool` or `Tool(pattern)`: `Bash(npm run test:*)` (prefix), `Read(./src/**)` / `Edit(...)` (gitignore-style globs relative to the settings file), `WebFetch(domain:example.com)`, `mcp__server__tool`. Translate tool names with the shared table.
- Listener: one `tools/pre-execute` listener registered at host level (all agents). Order: deny rules, then `PreToolUse` hook decision if the hook plugin shares the listener, then ask rules, then allow rules, else `await next()` (delegate). `deny` returns `{ kind: 'deny', reason: 'denied by rule Bash(rm:*)' }` (tool result text is logged); `ask` returns `{ kind: 'ask', reason, displayReason }`; `allow` returns `{ kind: 'allow' }` without calling `next()`, which skips later listeners, so it must be registered after safety guards or only short-circuit rules the user wrote (document the order).
- Modes: `default` = rules plus upstream behavior; `acceptEdits` = allow `write`/`edit` inside the project root; `plan` = delegate to upstream plan mode; `bypassPermissions` = `permission` preset `danger-full-access`. Mode selection is an AIR command `/mode` storing the choice in an AIR-owned file keyed by session id, with the model-facing notice injected as a `UserMessage` source `air-permission-mode` so the change is logged. No new session event.
- "Always allow": an AIR command `/allow <rule>` appends to `$AIR_HOME/permissions.json`; the approval card stays allow-once.

### 8.3 Upstream edits

None. A future `allowed-always` approval outcome would be an upstream Service Definition change and is not needed for slice 1.

### 8.4 Tests

Unit: grammar parser and matcher table (prefix, glob, domain, MCP), precedence (deny over allow), path normalisation outside the project. REAL composition: rule `Bash(git push:*)` in `deny`, `Edit` in `ask` with approval policy `never`; assert the `bash` call is denied with the rule text and the `edit` call is rejected with `approval/*` audit events.

### 8.5 Risks

Listener order is the enforcement point; an AIR `allow` that skips `next()` can bypass a later upstream guard (for example `tool-jobs` or `auto-review` listeners). Pattern parity with Claude Code on shell compound commands (`&&`, pipes) needs a parser; slice 1 matches the whole command string by prefix and denies compound commands matching any deny rule segment.

## 9. Recommended package breakdown (`air/packages/*`, bundle `air/bundles/air`)

| Order | Package | Responsibility | Upstream seam |
|---|---|---|---|
| 1 | `@air/dsh-convention-core` | Library plus same-process service `airConventionSources`: project-root resolution, `$AIR_HOME`, user-root opt-in, YAML frontmatter parser, Claude Code ↔ dsh tool-name table, consent file store, per-Agent scope helper around `createScope` | none (library) |
| 2 | `@air/dsh-skill-conventions` | Skill provider for `.claude/skills`, `.claude/commands`, project `.dsh`/`.agents` roots, AIR root, extra product roots | `ctx.skills.registerProvider` |
| 3 | `@air/dsh-instruction-conventions` | `.claude/CLAUDE.md`, `~/.claude/CLAUDE.md`, `@path` imports, rules folders | `agent/pre-step`, `tools/post-execute` |
| 4 | `@air/dsh-mcp-conventions` | `.mcp.json` import with consent, per-Agent `mcp-client` children | `agent/created`, `createScope`, `mcp-client` |
| 5 | `@air/dsh-command-conventions` | Scoped commands with `$ARGUMENTS`, `@file`, approved `!cmd`; `/mcp`, `/allow`, `/mode` | `ctx.commands`, `agent.followup` |
| 6 | `@air/dsh-agent-conventions` | `agent` delegation tool from `.claude/agents/*.md` | `ctx.subagents.start`, `ctx.tools` |
| 7 | `@air/dsh-permission-rules` | `Tool(pattern)` rule store, modes | `tools/pre-execute`, `approval` |
| 8 | `@air/dsh-hook-conventions` | Per-session Claude Code hooks with name translation and extra events | `dsh-hook-protocol`, agent/tools/approval events |
| 9 | `@air/dsh-plugin-conventions` | `.claude-plugin` and Agent Plugins manifests feeding 2-8 | `airConventionSources` |

Bundle changes (`air/bundles/air/cordis.patch.yml`): insert `preset-air` (standard list with `skill-filesystem.includeDefaultRoots: false` and rows 2, 3, 6), insert host rows 1, 4, 5, 7, 8, patch `agent-preset-registry` to `default: air`. Slice 1 for the October milestone is packages 1-5 plus the preset; 6-8 follow; 9 is slice 2. Upstream delta for the whole loader: none required; optional candidates are `skill-filesystem.projectSkillDirs`, `tool-subagent.description`, relative `instructionFileCandidates`, and a blocking pre-compaction waterfall.
