# File Conventions Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository or home folder configured for Claude Code works in the `air` profile on day one: its skills, command files, `CLAUDE.md` imports and rules, and `.mcp.json` servers load, while unrelated user-level skills stay out of the catalog unless the user opts in.

**Architecture:** Five out-of-tree packages under `air/packages/`. `@air/dsh-convention-core` is a plain library (project root, homes, frontmatter, Markdown discovery, polling watcher, tool-name table). `@air/dsh-skill-conventions` and `@air/dsh-instruction-conventions` are mounted inside a new agent preset `preset-air` (a copy of the upstream `standard` preset whose `skill-filesystem` has `includeDefaultRoots: false`), and `agent-preset-registry` is patched to `default: air`. `@air/dsh-mcp-conventions` and `@air/dsh-command-conventions` are host rows that mount per-Agent children through `createScope(ctx, agent)`, the pattern upstream uses in `packages/experimental/browser-use-runtime/src/mcp.ts`.

**Tech Stack:** TypeScript 6 (strict, ESM), Cordis plugins, `@deepseek-ai/schemastery` for Config, `yaml` 2.9, `picomatch` 4, Vitest 4, tsdown, pnpm 11.7.0.

**Spec:** [spikes/02-file-conventions.md](spikes/02-file-conventions.md) (primary; §0, §1, §3, §4, §5, §9), [spikes/01-toolchain.md](spikes/01-toolchain.md) (package templates, native Loader test, pitfalls), [research/research.md §5.1](../../research/research.md), [research/notes/03-competitors.md §5](../../research/notes/03-competitors.md). Depends on [plan 00](2026-09-30-00-workspace-foundation.md) being done.

## Global Constraints

- Node `^22.19 || >=24`; pnpm `11.7.0` (`air/package.json` `packageManager`); ESM only; TypeScript strict.
- Packages live in `air/packages/<pkg>`, named `@air/dsh-<pkg>`. dsh packages are peers with range `^0.2.0-rc.1` plus `link:../../../packages/<group>/<pkg>` devDependencies (vendor packages: `link:../../../vendor/<pkg>`). `workspace:*` is used only between AIR packages.
- Plan 00 provides: `air/package.json` devDependencies (`typescript`, `tsdown`, `vitest`, `@vitest/coverage-v8`, `@types/node`, `tsx`, the oxlint set) and scripts `build`, `typecheck`, `lint`, `test`, `smoke`; `air/pnpm-workspace.yaml` with `autoInstallPeers: false`; `air/tsconfig.base.json`; `air/.oxlintrc.json`; `air/.gitignore` (ignores `lib/`, `coverage/`, `.loader-*/`); `air/scripts/smoke-profile.sh`.
- Each package: `tsconfig.build.json` extends `../../tsconfig.base.json` and sets `rootDir: src`, `outDir: lib/types`, `include: ["src"]`; `tsconfig.json` extends `./tsconfig.build.json` with `rootDir: "."`, `noEmit: true`, `include: ["src", "tests"]`; `vitest.config.ts` includes `tests/**/*.spec.ts`.
- Test commands: `pnpm -C air/packages/<pkg> test`; coverage `pnpm -C air/packages/<pkg> exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`. Coverage must reach 100% per package; close a gap with a test, and use a `/* v8 ignore next -- <reason> */` comment only for a branch that needs a concurrent filesystem change to reach.
- Build order matters: the root `pnpm run build` must have finished before any AIR install, build, or test; an AIR package that imports `@air/dsh-convention-core` resolves its built `lib/`, so run `pnpm -C air/packages/convention-core build` before testing dependents. A native Loader test imports the package's own `lib/`, so run that package's `build` before its tests.
- Registrations are effects (`ctx.effect`, `ctx.on`; a registry `register()` returns the disposer). Deployment-varying choices are Config fields, not constants. Misconfiguration fails loud. Opaque cross-boundary ids are branded. No `as unknown` casts (the root `verify-no-unknown-casts` gate scans `air/`). Waterfall listeners call `next()`.
- No new session event types. Model-visible input enters as injected user messages with AIR source kinds (extending `MessageSourceMap`) or as tool results; AIR state and audit data go to files under `dshHomePath('air', ...)`.
- Each product-visible plugin has unit tests, one native-resolution Loader test (the `cordis.yml` is written inside the package directory), a `README.md` with Summary, Model Experience, and Known Limitations sections (English only), and JSDoc on every export.
- Markdown written by this plan never uses the banned origin word listed in the root `AGENTS.md` ("Ban ..." rule), contains no git commit hashes, and no URLs under the upstream organisation's GitHub path.
- Any edit outside `air/` and `research/` is recorded in `air/UPSTREAM-DELTA.md`. Goal for this plan: none.

## Decisions fixed by this plan

1. **Skill ranks.** Lower wins inside one layer. Project `.dsh/skills` 100, project `.agents/skills` 200, project `.claude/skills` 220, project `.claude/commands` 230, each `extraProjectRoots` entry 240, `<airHome>/skills` 350, and, only with `includeUserRoots: true`, `<agentsHome>/skills` 500, `<claudeHome>/skills` 520, `<claudeHome>/commands` 530. Spike 02 §1.2 proposed 150/160 for the `.claude` roots; this plan follows the research priority order (product-native, `.agents`, `.claude`), which is also the order in the task brief.
2. **Host filesystem only.** The AIR plugins read convention files with `node:fs`, not through `ctx.fs`. Remote or sandboxed filesystem providers are a later slice.
3. **Watching is polling.** `PathWatcher` wraps `fs.watchFile`, which also reports a path that does not exist yet. No chokidar dependency.
4. **`/mcp` lives in `@air/dsh-mcp-conventions`.** Spike 02 §9 lists it under the command package; the package that owns the approvals file also owns the command that edits it, so the two packages do not depend on each other.
5. **Commands in slice 1 substitute arguments only.** `@file` expansion and `` !`cmd` `` execution from spike 02 §3.2 are deferred; they stay literal text in the prompt and are listed under Known Limitations.
6. **Import approval is an allowlist.** An `@path` import outside the project root is skipped with a note unless its path is under a Config `allowedImportRoots` entry (spike 02 §4.2: no open turn exists to ask in).
7. **User roots stay off in the bundle.** `includeUserRoots` defaults to `false` in every package and the bundle leaves it there; a user turns it on in the profile patch.

## File Structure

```
air/
  package.json                                   (modify: add yaml devDependency for the drift test)
  README.md                                      (modify: packages list, known issues)
  bundles/air/
    package.json                                 (modify: dependencies on the four plugin packages)
    cordis.patch.yml                             (modify: preset-air, registry default, two host rows)
  scripts/tests/preset-air-drift.spec.ts         (create: preset-air equals upstream standard plus declared changes)
  packages/
    convention-core/                             @air/dsh-convention-core (library, no plugin)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               re-exports
      src/paths.ts                               homes, project root, containment
      src/names.ts                               kebab-case names
      src/tool-names.ts                          Claude Code <-> dsh tool-name table
      src/frontmatter.ts                         YAML frontmatter and typed field readers
      src/files.ts                               text reads, directory and Markdown-tree listing
      src/watch.ts                               PathWatcher (polling)
      tests/{paths,names,tool-names,frontmatter,files,watch}.spec.ts
    skill-conventions/                           @air/dsh-skill-conventions (preset row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, provider, apply
      src/roots.ts                               root list and ranks
      src/parse.ts                               skill and command file parsing
      tests/{parse,roots,provider,native-loader}.spec.ts
    instruction-conventions/                     @air/dsh-instruction-conventions (preset row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, source kind, pre-step and post-execute listeners
      src/imports.ts                             @path import resolver
      src/rules.ts                               .claude/rules loader and glob matcher
      src/baseline.ts                            baseline text assembly and budget
      tests/harness.ts                           stub Agent
      tests/{imports,rules,baseline,plugin,native-loader}.spec.ts
    mcp-conventions/                             @air/dsh-mcp-conventions (host row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, per-Agent mounts, /mcp command
      src/config.ts                              .mcp.json parser, ${VAR} expansion
      src/approvals.ts                           approval key and approvals file
      tests/harness.ts                           stub Agent
      tests/fixtures/echo-server.mjs             stdio MCP server with one tool
      tests/{config,approvals,plugin,native-loader}.spec.ts
    command-conventions/                         @air/dsh-command-conventions (host row)
      package.json  tsconfig.build.json  tsconfig.json  tsdown.config.ts  vitest.config.ts  README.md
      src/index.ts                               Config, source kind, scoped command registration
      src/args.ts                                argument splitting and substitution
      tests/harness.ts                           stub Agent
      tests/{args,plugin,native-loader}.spec.ts
```

Upstream APIs this plan relies on (verified at `dsh-v0.2.0-rc.2`):

| API | Location |
|---|---|
| `ctx.skills.registerProvider(create)`, `SkillProvider`, `SkillCandidate`, `SkillDefinition`, `SkillProviderControl`, layer and rank rules | `packages/skill/skill/src/index.ts` L40-97, L247-275, L345-355, L390-425 |
| `skill-filesystem` Config `includeDefaultRoots`, roots and ranks | `packages/skill/skill-filesystem/src/index.ts` L49-74, L245-265 |
| Preset row schema (`id`, `name`, `description`, `order`, `plugins`), registry Config (`default`) | `packages/preset/agent-preset/src/index.ts`, `packages/preset/agent-preset-registry/src/index.ts` L53-56 |
| Upstream `standard` preset list | `packages/bundle/web-app/presets/standard.patch.yml` |
| `agent/created` (serial, awaited before queued input), `agent/disposed`, `agent/pre-step` (waterfall), `PreStepDecision`, `Agent.followup` | `packages/core/agent/src/runtime-types.ts` L112-119, L215-240, L252-270, L309-320 |
| `tools/post-execute` waterfall, `PostToolDecision.additionalContexts` | `packages/core/tools/src/index.ts` L165-176, L617-620, L1781-1820 |
| `MessageSourceMap` (merge-extensible), `createUserMessage` | `packages/llm/llm/src/message.ts` L103-115, L236-246 |
| `Session.deriveMessages()`, `CreateSessionOptions.meta.cwd` | `packages/core/session/src/index.ts` L860-884, `packages/core/session/src/types.ts` L138-160 |
| `createScope(ctx, key)`, `Scope.dispose()` | `packages/core/scope/src/index.ts` L104-146 |
| `mcp-client` `Config` validator and `apply` | `packages/mcp/mcp-client/src/index.ts` L51-142, L154 |
| Per-Agent `mcp-client` child precedent | `packages/experimental/browser-use-runtime/src/mcp.ts` L100-160 |
| `ctx.commands.register`, `find`, `execute`, `CommandInvocation`, `CommandResult` | `packages/interaction/commands/src/index.ts` L41-80, L285-292, L328-330, L361-431; `types.ts` |
| `dshHomePath(...segments)` | `packages/util/home-paths/src/index.ts` L98 |
| `Branded<B>` | `packages/util/brand/src/index.ts` L18 |
| Bundle dependency closure supplies row packages to Node resolution | `packages/boot/app-boot/src/profile.ts` L16-20, L470-536 |

---

### Task 1: `@air/dsh-convention-core` — paths, names, tool-name table

**Files:**
- Create: `air/packages/convention-core/package.json`
- Create: `air/packages/convention-core/tsconfig.build.json`
- Create: `air/packages/convention-core/tsconfig.json`
- Create: `air/packages/convention-core/tsdown.config.ts`
- Create: `air/packages/convention-core/vitest.config.ts`
- Create: `air/packages/convention-core/src/paths.ts`
- Create: `air/packages/convention-core/src/names.ts`
- Create: `air/packages/convention-core/src/tool-names.ts`
- Create: `air/packages/convention-core/src/index.ts`
- Test: `air/packages/convention-core/tests/paths.spec.ts`
- Test: `air/packages/convention-core/tests/names.spec.ts`
- Test: `air/packages/convention-core/tests/tool-names.spec.ts`

**Interfaces:**
- Consumes: plan 00 workspace (`air/tsconfig.base.json`, root devDependencies).
- Produces (all exported from `@air/dsh-convention-core`):
  - `AIR_HOME_ENV = 'AIR_HOME'`, `AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'`
  - `interface UserHomeConfig { airHome?: string; claudeHome?: string; agentsHome?: string }`
  - `interface UserHomes { readonly airHome: string; readonly claudeHome: string; readonly agentsHome: string }`
  - `expandHome(path: string, home?: string): string`
  - `resolveUserHomes(config?: UserHomeConfig, env?: Readonly<Record<string, string | undefined>>, home?: string): UserHomes`
  - `pathExists(path: string): Promise<boolean>`
  - `findProjectRoot(cwd: string, markers?: readonly string[]): Promise<string>` (nearest ancestor containing a marker, default `['.git']`; falls back to `cwd`)
  - `isInside(root: string, candidate: string): boolean`
  - `directoriesBetween(root: string, cwd: string): string[]` (root first, cwd last; `[cwd]` when cwd is outside root)
  - `toKebabName(input: string): string | undefined`
  - `CLAUDE_TO_DSH_TOOL_NAMES: Readonly<Record<string, string>>`
  - `toDshToolName(claudeName: string): string | undefined`
  - `toClaudeToolNames(dshName: string): string[]`
  - `translateToolNames(claudeNames: readonly string[]): { names: string[]; unknown: string[] }`

- [ ] **Step 1: Create the package scaffold**

`air/packages/convention-core/package.json`:

```json
{
  "name": "@air/dsh-convention-core",
  "description": "Shared discovery helpers for the AIR file-convention plugins",
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
    "yaml": "^2.9.0"
  }
}
```

`air/packages/convention-core/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/convention-core/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/convention-core/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies stay external. */
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

`air/packages/convention-core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C /home/hxman/AIR-harness/air install`
Expected: exit 0; `air/packages/convention-core/node_modules/yaml` exists.

- [ ] **Step 2: Write the failing tests**

`air/packages/convention-core/tests/paths.spec.ts`:

```ts
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  directoriesBetween,
  expandHome,
  findProjectRoot,
  isInside,
  pathExists,
  resolveUserHomes,
} from '../src/index.ts'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-paths-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('expandHome', () => {
  it('expands a bare tilde and a tilde prefix', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u')
    expect(expandHome('~/x/y', '/home/u')).toBe('/home/u/x/y')
  })

  it('leaves other paths unchanged', () => {
    expect(expandHome('/abs/x', '/home/u')).toBe('/abs/x')
    expect(expandHome('~other/x', '/home/u')).toBe('~other/x')
  })
})

describe('resolveUserHomes', () => {
  it('uses defaults under the operating-system home', () => {
    expect(resolveUserHomes({}, {}, '/home/u')).toEqual({
      airHome: '/home/u/.air',
      claudeHome: '/home/u/.claude',
      agentsHome: '/home/u/.agents',
    })
  })

  it('reads AIR_HOME and DSH_AGENTS_HOME and ignores blank values', () => {
    expect(resolveUserHomes({}, { AIR_HOME: '/data/air', DSH_AGENTS_HOME: '~/shared' }, '/home/u')).toEqual({
      airHome: '/data/air',
      claudeHome: '/home/u/.claude',
      agentsHome: '/home/u/shared',
    })
    expect(resolveUserHomes({}, { AIR_HOME: '  ', DSH_AGENTS_HOME: '' }, '/home/u').airHome).toBe('/home/u/.air')
  })

  it('prefers explicit configuration over the environment', () => {
    const homes = resolveUserHomes(
      { airHome: '~/a', claudeHome: '/c', agentsHome: '/g' },
      { AIR_HOME: '/ignored', DSH_AGENTS_HOME: '/ignored' },
      '/home/u',
    )
    expect(homes).toEqual({ airHome: '/home/u/a', claudeHome: '/c', agentsHome: '/g' })
  })

  it('falls back to process.env and the real home', () => {
    expect(resolveUserHomes().claudeHome.endsWith('.claude')).toBe(true)
  })
})

describe('findProjectRoot', () => {
  it('returns the nearest ancestor that contains a marker', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    expect(await findProjectRoot(join(root, 'a', 'b'))).toBe(root)
    expect(await pathExists(join(root, '.git'))).toBe(true)
    expect(await pathExists(join(root, 'missing'))).toBe(false)
  })

  it('accepts custom markers', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'pkg', 'src'), { recursive: true })
    await mkdir(join(root, 'pkg', '.hg'))
    expect(await findProjectRoot(join(root, 'pkg', 'src'), ['.hg'])).toBe(join(root, 'pkg'))
  })

  it('falls back to the resolved cwd when no ancestor has a marker', async () => {
    const root = await tempDir()
    expect(await findProjectRoot(root, ['.air-marker-that-does-not-exist'])).toBe(resolve(root))
  })
})

describe('isInside', () => {
  it('accepts the root and its descendants only', () => {
    expect(isInside('/p', '/p')).toBe(true)
    expect(isInside('/p', '/p/a/b')).toBe(true)
    expect(isInside('/p', '/p/../q')).toBe(false)
    expect(isInside('/p', '/')).toBe(false)
    expect(isInside('/p', '/pq')).toBe(false)
  })
})

describe('directoriesBetween', () => {
  it('lists directories from the root down to the cwd', () => {
    expect(directoriesBetween('/p', '/p/a/b')).toEqual(['/p', '/p/a', '/p/a/b'])
    expect(directoriesBetween('/p', '/p')).toEqual(['/p'])
  })

  it('returns only the cwd when it is outside the root', () => {
    expect(directoriesBetween('/p', '/q/r')).toEqual(['/q/r'])
  })
})
```

`air/packages/convention-core/tests/names.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toKebabName } from '../src/index.ts'

describe('toKebabName', () => {
  it.each([
    ['fix-issue', 'fix-issue'],
    ['Fix Issue', 'fix-issue'],
    ['frontend:component', 'frontend-component'],
    ['  My_Skill.v2 ', 'my-skill-v2'],
    ['Résumé', 'resume'],
  ])('normalises %j to %j', (input, expected) => {
    expect(toKebabName(input)).toBe(expected)
  })

  it('returns undefined when nothing usable remains', () => {
    expect(toKebabName('***')).toBeUndefined()
    expect(toKebabName('')).toBeUndefined()
  })
})
```

`air/packages/convention-core/tests/tool-names.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_TO_DSH_TOOL_NAMES,
  toClaudeToolNames,
  toDshToolName,
  translateToolNames,
} from '../src/index.ts'

describe('tool-name table', () => {
  it('maps Claude Code names to dsh names', () => {
    expect(CLAUDE_TO_DSH_TOOL_NAMES).toEqual({
      Bash: 'bash',
      Read: 'read',
      Write: 'write',
      Edit: 'edit',
      MultiEdit: 'edit',
      Glob: 'glob',
      Grep: 'grep',
      WebFetch: 'web_fetch',
      WebSearch: 'web_search',
      TodoWrite: 'todo_write',
      Task: 'agent',
      Agent: 'agent',
      AskUserQuestion: 'ask_user_question',
    })
  })

  it('passes MCP names through and rejects unknown names', () => {
    expect(toDshToolName('Edit')).toBe('edit')
    expect(toDshToolName('mcp__github__create_issue')).toBe('mcp__github__create_issue')
    expect(toDshToolName('NotebookEdit')).toBeUndefined()
    expect(toDshToolName('toString')).toBeUndefined()
  })

  it('maps a dsh name back to every Claude Code name', () => {
    expect(toClaudeToolNames('edit')).toEqual(['Edit', 'MultiEdit'])
    expect(toClaudeToolNames('agent')).toEqual(['Task', 'Agent'])
    expect(toClaudeToolNames('mcp__a__b')).toEqual(['mcp__a__b'])
    expect(toClaudeToolNames('jobs')).toEqual([])
  })

  it('translates a list, strips Tool(pattern) suffixes, dedups, and reports unknown names', () => {
    expect(translateToolNames(['Bash(git add:*)', 'Read', 'Edit', 'MultiEdit', 'Nope', 'mcp__x__y'])).toEqual({
      names: ['bash', 'read', 'edit', 'mcp__x__y'],
      unknown: ['Nope'],
    })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core test`
Expected: FAIL, all three files, with `Failed to load url ../src/index.ts` (the module does not exist).

- [ ] **Step 4: Implement the modules**

`air/packages/convention-core/src/paths.ts`:

```ts
/** Home directories, project-root lookup, and path containment for the AIR convention plugins. */
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Environment variable that overrides the AIR home directory (default `~/.air`). */
export const AIR_HOME_ENV = 'AIR_HOME'

/** Environment variable upstream `skill-filesystem` reads for the shared agents home. */
export const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

/** Optional overrides for the user-level directories the convention plugins read. */
export interface UserHomeConfig {
  /** AIR-owned home. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Shared agents home. Defaults to `$DSH_AGENTS_HOME`, then `~/.agents`. */
  agentsHome?: string
}

/** Absolute user-level directories after defaulting. */
export interface UserHomes {
  readonly airHome: string
  readonly claudeHome: string
  readonly agentsHome: string
}

/**
 * Expand a leading `~` or `~/` against a home directory.
 * @param path - configured path.
 * @param home - home directory; defaults to the operating-system home.
 * @returns the expanded path, or the input when it has no supported prefix.
 */
export function expandHome(path: string, home: string = homedir()): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

/**
 * Resolve the user-level directories. Precedence: explicit configuration, environment, default.
 * @param config - explicit overrides.
 * @param env - environment mapping read for `AIR_HOME` and `DSH_AGENTS_HOME`.
 * @param home - operating-system home used for defaults and `~` expansion.
 * @returns absolute directories.
 */
export function resolveUserHomes(
  config: UserHomeConfig = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): UserHomes {
  const absolute = (path: string): string => resolve(expandHome(path, home))
  return {
    airHome: absolute(config.airHome ?? nonBlank(env[AIR_HOME_ENV]) ?? join(home, '.air')),
    claudeHome: absolute(config.claudeHome ?? join(home, '.claude')),
    agentsHome: absolute(config.agentsHome ?? nonBlank(env[AGENTS_HOME_ENV]) ?? join(home, '.agents')),
  }
}

/**
 * Test whether a host path exists.
 * @param path - path to probe.
 * @returns true when the path is reachable.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Any access failure means this caller cannot use the path.
    return false
  }
}

/**
 * Find the nearest ancestor of `cwd` that contains one of the markers.
 * @param cwd - directory to start from.
 * @param markers - entry names that identify a project root.
 * @returns the project root, or the resolved `cwd` when no ancestor has a marker.
 */
export async function findProjectRoot(cwd: string, markers: readonly string[] = ['.git']): Promise<string> {
  const start = resolve(cwd)
  let current = start
  while (true) {
    for (const marker of markers) {
      if (await pathExists(join(current, marker))) return current
    }
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/**
 * Test whether `candidate` is `root` or a path below it, after normalisation. Symbolic links are not resolved.
 * @param root - containing directory.
 * @param candidate - path to test.
 * @returns true when the candidate does not leave the root.
 */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * List every directory from `root` down to `cwd`.
 * @param root - project root.
 * @param cwd - working directory.
 * @returns directories ordered root first; only `cwd` when it lies outside `root`.
 */
export function directoriesBetween(root: string, cwd: string): string[] {
  const top = resolve(root)
  const bottom = resolve(cwd)
  if (!isInside(top, bottom)) return [bottom]
  const directories = [top]
  let current = top
  for (const segment of relative(top, bottom).split(sep).filter(part => part.length > 0)) {
    current = join(current, segment)
    directories.push(current)
  }
  return directories
}
```

`air/packages/convention-core/src/names.ts`:

```ts
/** Name normalisation shared by skill and command discovery. */

/**
 * Convert a file stem, directory name, or namespaced command path into a kebab-case name.
 * @param input - raw name, for example `frontend:component` or `My Skill`.
 * @returns a name matching `^[a-z0-9]+(-[a-z0-9]+)*$`, or undefined when no letter or digit remains.
 */
export function toKebabName(input: string): string | undefined {
  const name = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return name.length > 0 ? name : undefined
}
```

`air/packages/convention-core/src/tool-names.ts`:

```ts
/** Claude Code tool names and their dsh equivalents, shared by skills, agents, hooks, and permission rules. */

/** Claude Code tool name to dsh tool name. MCP names (`mcp__server__tool`) are identical on both sides. */
export const CLAUDE_TO_DSH_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Bash: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'todo_write',
  Task: 'agent',
  Agent: 'agent',
  AskUserQuestion: 'ask_user_question',
})

const MCP_PREFIX = 'mcp__'

/**
 * Translate one Claude Code tool name.
 * @param claudeName - bare tool name without a `(pattern)` suffix.
 * @returns the dsh tool name, or undefined when the table has no entry.
 */
export function toDshToolName(claudeName: string): string | undefined {
  if (claudeName.startsWith(MCP_PREFIX)) return claudeName
  return Object.hasOwn(CLAUDE_TO_DSH_TOOL_NAMES, claudeName) ? CLAUDE_TO_DSH_TOOL_NAMES[claudeName] : undefined
}

/**
 * List the Claude Code names that map to one dsh tool name.
 * @param dshName - dsh tool name.
 * @returns matching Claude Code names in table order; empty when none map to it.
 */
export function toClaudeToolNames(dshName: string): string[] {
  if (dshName.startsWith(MCP_PREFIX)) return [dshName]
  return Object.entries(CLAUDE_TO_DSH_TOOL_NAMES)
    .filter(([, mapped]) => mapped === dshName)
    .map(([claudeName]) => claudeName)
}

/**
 * Translate a list of Claude Code tool entries such as `Read` or `Bash(git add:*)`.
 * @param claudeNames - entries from `allowed-tools`, `tools`, or a permission rule list.
 * @returns distinct dsh names in first-seen order, plus the entries the table does not know.
 */
export function translateToolNames(claudeNames: readonly string[]): { names: string[]; unknown: string[] } {
  const names: string[] = []
  const unknown: string[] = []
  for (const entry of claudeNames) {
    const open = entry.indexOf('(')
    const bare = (open < 0 ? entry : entry.slice(0, open)).trim()
    const mapped = toDshToolName(bare)
    if (mapped === undefined) unknown.push(entry)
    else if (!names.includes(mapped)) names.push(mapped)
  }
  return { names, unknown }
}
```

`air/packages/convention-core/src/index.ts`:

```ts
/**
 * Shared discovery helpers for the AIR file-convention plugins.
 * @module @air/dsh-convention-core
 */
export * from './paths.ts'
export * from './names.ts'
export * from './tool-names.ts'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core test`
Expected: `Test Files 3 passed (3)`.

- [ ] **Step 6: Typecheck**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core typecheck`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/packages/convention-core air/pnpm-lock.yaml
git commit -m "feat(air): add convention-core paths, names, and tool-name table"
```

---

### Task 2: `@air/dsh-convention-core` — frontmatter, file listing, watcher, README

**Files:**
- Create: `air/packages/convention-core/src/frontmatter.ts`
- Create: `air/packages/convention-core/src/files.ts`
- Create: `air/packages/convention-core/src/watch.ts`
- Modify: `air/packages/convention-core/src/index.ts`
- Create: `air/packages/convention-core/README.md`
- Test: `air/packages/convention-core/tests/frontmatter.spec.ts`
- Test: `air/packages/convention-core/tests/files.spec.ts`
- Test: `air/packages/convention-core/tests/watch.spec.ts`

**Interfaces:**
- Consumes: Task 1 package scaffold.
- Produces (exported from `@air/dsh-convention-core`):
  - `interface ParsedDocument { readonly data: Record<string, unknown>; readonly body: string; readonly hasFrontmatter: boolean }`
  - `parseFrontmatter(raw: string): ParsedDocument` (no frontmatter returns `data: {}` and the whole text as body; invalid YAML or a non-mapping throws)
  - `isRecord(value: unknown): value is Record<string, unknown>`
  - `stringField(data, key): string | undefined`
  - `booleanField(data, key): boolean | undefined` (throws `TypeError` for other values)
  - `stringListField(data, key): string[] | undefined` (YAML list, or a string split on commas and whitespace outside parentheses; throws `TypeError` otherwise)
  - `readTextFile(path: string): Promise<string | undefined>` (undefined when absent or not a regular file)
  - `interface DirectoryEntry { readonly name: string; readonly path: string; readonly kind: 'directory' | 'file' }`
  - `listDirectory(root: string): Promise<DirectoryEntry[]>` (sorted by name; absent root returns `[]`; symbolic links are followed; broken links are skipped)
  - `interface MarkdownEntry { readonly path: string; readonly segments: readonly string[] }`
  - `listMarkdownTree(root: string, maxDepth: number): Promise<MarkdownEntry[]>` (`segments` is the relative path without the `.md` suffix; `maxDepth` 1 lists only the root)
  - `interface PathWatcherOptions { readonly intervalMs: number; readonly maxPaths: number; readonly onChange: () => void }`
  - `class PathWatcher { constructor(options: PathWatcherOptions); retain(paths: Iterable<string>): void; get paths(): string[]; close(): void }`

- [ ] **Step 1: Write the failing tests**

`air/packages/convention-core/tests/frontmatter.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { booleanField, isRecord, parseFrontmatter, stringField, stringListField } from '../src/index.ts'

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from the body', () => {
    const parsed = parseFrontmatter('---\nname: demo\ndescription: A demo\n---\n# Body\ntext\n')
    expect(parsed).toEqual({ data: { name: 'demo', description: 'A demo' }, body: '# Body\ntext\n', hasFrontmatter: true })
  })

  it('accepts CRLF line endings and a byte-order mark', () => {
    const parsed = parseFrontmatter('﻿---\r\nname: demo\r\n---\r\nbody')
    expect(parsed.data).toEqual({ name: 'demo' })
    expect(parsed.body).toBe('body')
  })

  it('returns the whole text as body when there is no frontmatter', () => {
    expect(parseFrontmatter('Just text\n')).toEqual({ data: {}, body: 'Just text\n', hasFrontmatter: false })
    expect(parseFrontmatter('---\nname: unterminated\n')).toEqual({
      data: {},
      body: '---\nname: unterminated\n',
      hasFrontmatter: false,
    })
  })

  it('treats an empty frontmatter block as no fields', () => {
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body', hasFrontmatter: true })
  })

  it('throws for invalid YAML and for a non-mapping document', () => {
    expect(() => parseFrontmatter('---\nname: [unclosed\n---\nbody')).toThrow()
    expect(() => parseFrontmatter('---\n- a\n- b\n---\nbody')).toThrow('frontmatter must be a YAML mapping')
  })
})

describe('field readers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('stringField returns non-empty strings only', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x')
    expect(stringField({ a: '' }, 'a')).toBeUndefined()
    expect(stringField({ a: 3 }, 'a')).toBeUndefined()
    expect(stringField({}, 'a')).toBeUndefined()
  })

  it('booleanField reads booleans and their string spellings', () => {
    expect(booleanField({ a: true }, 'a')).toBe(true)
    expect(booleanField({ a: 'false' }, 'a')).toBe(false)
    expect(booleanField({ a: 'TRUE' }, 'a')).toBe(true)
    expect(booleanField({}, 'a')).toBeUndefined()
    expect(() => booleanField({ a: 'maybe' }, 'a')).toThrow('frontmatter field "a" must be a boolean')
    expect(() => booleanField({ a: 1 }, 'a')).toThrow(TypeError)
  })

  it('stringListField reads YAML lists and separated strings', () => {
    expect(stringListField({ a: ['x', ' y ', ''] }, 'a')).toEqual(['x', 'y'])
    expect(stringListField({ a: 'Bash(git add:*, git commit:*), Read  Grep' }, 'a')).toEqual([
      'Bash(git add:*, git commit:*)',
      'Read',
      'Grep',
    ])
    expect(stringListField({ a: 'weird)name' }, 'a')).toEqual(['weird)name'])
    expect(stringListField({}, 'a')).toBeUndefined()
    expect(stringListField({ a: null }, 'a')).toBeUndefined()
    expect(() => stringListField({ a: [1] }, 'a')).toThrow('frontmatter field "a" must be a string or a list of strings')
    expect(() => stringListField({ a: 7 }, 'a')).toThrow(TypeError)
  })
})
```

`air/packages/convention-core/tests/files.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listDirectory, listMarkdownTree, readTextFile } from '../src/index.ts'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-files-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('readTextFile', () => {
  it('reads a regular file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await readTextFile(join(dir, 'a.md'))).toBe('hello')
  })

  it('returns undefined for a missing path, a directory, and a path below a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'hello')
    expect(await readTextFile(join(dir, 'missing.md'))).toBeUndefined()
    expect(await readTextFile(dir)).toBeUndefined()
    expect(await readTextFile(join(dir, 'a.md', 'child'))).toBeUndefined()
  })

  it('rethrows failures other than absence', async () => {
    await expect(readTextFile('bad\0path')).rejects.toThrow()
  })
})

describe('listDirectory', () => {
  it('lists files and directories sorted by name and follows symbolic links', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'zeta'))
    await writeFile(join(dir, 'alpha.md'), 'a')
    await symlink(join(dir, 'zeta'), join(dir, 'link'))
    await symlink(join(dir, 'nowhere'), join(dir, 'broken'))
    expect(await listDirectory(dir)).toEqual([
      { name: 'alpha.md', path: join(dir, 'alpha.md'), kind: 'file' },
      { name: 'link', path: join(dir, 'link'), kind: 'directory' },
      { name: 'zeta', path: join(dir, 'zeta'), kind: 'directory' },
    ])
  })

  it('returns an empty list for a missing root and for a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.md'), 'a')
    expect(await listDirectory(join(dir, 'missing'))).toEqual([])
    expect(await listDirectory(join(dir, 'a.md'))).toEqual([])
  })
})

describe('listMarkdownTree', () => {
  it('lists Markdown files with path segments up to the depth limit', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'frontend', 'deep'), { recursive: true })
    await writeFile(join(dir, 'fix.md'), 'x')
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(dir, 'frontend', 'component.md'), 'x')
    await writeFile(join(dir, 'frontend', 'deep', 'too-deep.md'), 'x')
    expect(await listMarkdownTree(dir, 2)).toEqual([
      { path: join(dir, 'fix.md'), segments: ['fix'] },
      { path: join(dir, 'frontend', 'component.md'), segments: ['frontend', 'component'] },
    ])
    expect(await listMarkdownTree(dir, 1)).toEqual([{ path: join(dir, 'fix.md'), segments: ['fix'] }])
  })

  it('returns an empty list for a missing root', async () => {
    expect(await listMarkdownTree(join(await tempDir(), 'missing'), 4)).toEqual([])
  })
})
```

`air/packages/convention-core/tests/watch.spec.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PathWatcher } from '../src/index.ts'

const created: string[] = []
const watchers: PathWatcher[] = []

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-core-watch-'))
  created.push(dir)
  return dir
}

function watcher(onChange: () => void, maxPaths = 8): PathWatcher {
  const subject = new PathWatcher({ intervalMs: 20, maxPaths, onChange })
  watchers.push(subject)
  return subject
}

describe('PathWatcher', () => {
  it('reports a change to a retained file', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, 'one')
    const onChange = vi.fn()
    watcher(onChange).retain([file])
    await writeFile(file, 'one two three')
    await vi.waitFor(() => { expect(onChange).toHaveBeenCalled() }, { timeout: 5000 })
  })

  it('reports a retained path that appears later', async () => {
    const dir = await tempDir()
    const file = join(dir, 'later.md')
    const onChange = vi.fn()
    watcher(onChange).retain([file])
    await writeFile(file, 'now present')
    await vi.waitFor(() => { expect(onChange).toHaveBeenCalled() }, { timeout: 5000 })
  })

  it('keeps the most recently retained paths within the limit', () => {
    const subject = watcher(() => {}, 2)
    subject.retain(['/air-watch/a', '/air-watch/b'])
    subject.retain(['/air-watch/a'])
    subject.retain(['/air-watch/c'])
    expect(subject.paths).toEqual(['/air-watch/a', '/air-watch/c'])
  })

  it('stops watching on close and ignores later retains', () => {
    const subject = watcher(() => {})
    subject.retain(['/air-watch/a'])
    subject.close()
    expect(subject.paths).toEqual([])
    subject.retain(['/air-watch/b'])
    expect(subject.paths).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core test`
Expected: the three new files FAIL with `parseFrontmatter is not a function`, `readTextFile is not a function`, and `PathWatcher is not a constructor`; the three Task 1 files pass.

- [ ] **Step 3: Implement the modules**

`air/packages/convention-core/src/frontmatter.ts`:

```ts
/** YAML frontmatter parsing and typed field readers for Markdown convention files. */
import { parse as parseYaml } from 'yaml'

/** A Markdown document split into frontmatter fields and body. */
export interface ParsedDocument {
  /** Frontmatter mapping; empty when the document has none. */
  readonly data: Record<string, unknown>
  /** Text after the closing `---`, or the whole text when there is no frontmatter. */
  readonly body: string
  /** Whether a complete frontmatter block was present. */
  readonly hasFrontmatter: boolean
}

/**
 * Narrow a value to a plain object.
 * @param value - value to test.
 * @returns true for non-null, non-array objects.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Split a Markdown document into YAML frontmatter and body.
 * @param raw - file content.
 * @returns the parsed fields and body; a document without a complete block has no fields.
 * @throws when the block is not valid YAML or is not a mapping.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw
  const lines = text.split('\n')
  const first = lines[0]
  if (first === undefined || stripCarriageReturn(first) !== '---') return { data: {}, body: text, hasFrontmatter: false }
  const close = lines.findIndex((line, index) => index > 0 && stripCarriageReturn(line) === '---')
  if (close < 0) return { data: {}, body: text, hasFrontmatter: false }
  const body = lines.slice(close + 1).join('\n')
  const parsed: unknown = parseYaml(lines.slice(1, close).join('\n'))
  if (parsed === null || parsed === undefined) return { data: {}, body, hasFrontmatter: true }
  if (!isRecord(parsed)) throw new TypeError('frontmatter must be a YAML mapping')
  return { data: parsed, body, hasFrontmatter: true }
}

/**
 * Read a non-empty string field.
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns the string, or undefined when absent, empty, or not a string.
 */
export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read a boolean field.
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns the boolean, or undefined when absent.
 * @throws TypeError when the value is neither a boolean nor the text `true` or `false`.
 */
export function booleanField(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const text = value.toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function splitList(value: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (char === ',' || /\s/u.test(char))) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  items.push(current)
  return items
}

/**
 * Read a list-of-strings field. Claude Code writes these either as a YAML list or as one string
 * separated by commas or spaces; separators inside parentheses belong to the item (`Bash(git add:*)`).
 * @param data - frontmatter mapping.
 * @param key - field name.
 * @returns trimmed non-empty items, or undefined when the field is absent or null.
 * @throws TypeError when the value is neither a string nor a list of strings.
 */
export function stringListField(data: Record<string, unknown>, key: string): string[] | undefined {
  const value = data[key]
  if (value === undefined || value === null) return undefined
  let items: string[]
  if (typeof value === 'string') items = splitList(value)
  else if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) items = value
  else throw new TypeError(`frontmatter field "${key}" must be a string or a list of strings`)
  return items.map(item => item.trim()).filter(item => item.length > 0)
}
```

`air/packages/convention-core/src/files.ts`:

```ts
/** Host-filesystem reads and listings for convention files. Absence is a normal result, not an error. */
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch (error: unknown) {
    if (isAbsent(error)) return undefined
    throw error
  }
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Read a UTF-8 text file.
 * @param path - absolute file path.
 * @returns the content, or undefined when the path is absent or not a regular file.
 */
export async function readTextFile(path: string): Promise<string | undefined> {
  const info = await statIfPresent(path)
  if (info === undefined || !info.isFile()) return undefined
  return await readFile(path, 'utf8')
}

/** One entry of a listed directory, with symbolic links resolved to their target kind. */
export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/**
 * List the files and directories directly under `root`.
 * @param root - directory to list.
 * @returns entries sorted by name; empty when `root` is absent or not a directory. Broken links and special files are omitted.
 */
export async function listDirectory(root: string): Promise<DirectoryEntry[]> {
  const rootInfo = await statIfPresent(root)
  if (rootInfo === undefined || !rootInfo.isDirectory()) return []
  const entries: DirectoryEntry[] = []
  for (const name of (await readdir(root)).sort(compareText)) {
    const path = join(root, name)
    const info = await statIfPresent(path)
    if (info === undefined) continue
    if (info.isDirectory()) entries.push({ name, path, kind: 'directory' })
    else if (info.isFile()) entries.push({ name, path, kind: 'file' })
  }
  return entries
}

/** A Markdown file found under a root, with its relative path split into segments. */
export interface MarkdownEntry {
  readonly path: string
  /** Relative path segments; the last one has no `.md` suffix. */
  readonly segments: readonly string[]
}

/**
 * List `.md` files under `root`, descending at most `maxDepth` directory levels.
 * @param root - directory to walk.
 * @param maxDepth - number of directory levels including `root`; 1 lists only the root.
 * @returns entries in directory order, each directory sorted by name.
 */
export async function listMarkdownTree(root: string, maxDepth: number): Promise<MarkdownEntry[]> {
  const found: MarkdownEntry[] = []
  const walk = async (directory: string, prefix: readonly string[]): Promise<void> => {
    for (const entry of await listDirectory(directory)) {
      if (entry.kind === 'directory') {
        if (prefix.length + 1 < maxDepth) await walk(entry.path, [...prefix, entry.name])
      } else if (entry.name.endsWith('.md')) {
        found.push({ path: entry.path, segments: [...prefix, entry.name.slice(0, -3)] })
      }
    }
  }
  await walk(root, [])
  return found
}
```

`air/packages/convention-core/src/watch.ts`:

```ts
/** Polling change detection for convention files and directories. */
import { unwatchFile, watchFile } from 'node:fs'

/** Settings for one {@link PathWatcher}. */
export interface PathWatcherOptions {
  /** Milliseconds between stat polls of each retained path. */
  readonly intervalMs: number
  /** Maximum number of retained paths; the least recently retained path is released first. */
  readonly maxPaths: number
  /** Called when a retained path is created, modified, or removed. */
  readonly onChange: () => void
}

/**
 * Watches a bounded set of paths with `fs.watchFile`. A path that does not exist yet is
 * reported when it appears. The poll timers do not keep the process alive.
 */
export class PathWatcher {
  private readonly listeners = new Map<string, () => void>()
  private closed = false

  /** @param options - poll interval, path limit, and change callback. */
  constructor(private readonly options: PathWatcherOptions) {}

  /**
   * Start watching the given paths, or mark them as recently used when already watched.
   * @param paths - absolute paths of files or directories.
   */
  retain(paths: Iterable<string>): void {
    if (this.closed) return
    for (const path of paths) {
      let listener = this.listeners.get(path)
      if (listener === undefined) {
        listener = (): void => { this.options.onChange() }
        watchFile(path, { interval: this.options.intervalMs, persistent: false }, listener)
      } else {
        this.listeners.delete(path)
      }
      this.listeners.set(path, listener)
    }
    for (const [path, listener] of this.listeners) {
      if (this.listeners.size <= this.options.maxPaths) break
      unwatchFile(path, listener)
      this.listeners.delete(path)
    }
  }

  /** Paths currently watched, least recently retained first. */
  get paths(): string[] {
    return [...this.listeners.keys()]
  }

  /** Stop every poll timer. Later `retain` calls do nothing. */
  close(): void {
    this.closed = true
    for (const [path, listener] of this.listeners) unwatchFile(path, listener)
    this.listeners.clear()
  }
}
```

Replace `air/packages/convention-core/src/index.ts` with:

```ts
/**
 * Shared discovery helpers for the AIR file-convention plugins.
 * @module @air/dsh-convention-core
 */
export * from './paths.ts'
export * from './names.ts'
export * from './tool-names.ts'
export * from './frontmatter.ts'
export * from './files.ts'
export * from './watch.ts'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core test`
Expected: `Test Files 6 passed (6)`.

- [ ] **Step 5: Check coverage, typecheck, build, lint**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: every `src/*.ts` row shows 100 in all four columns; exit 0.

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/convention-core typecheck && pnpm -C /home/hxman/AIR-harness/air/packages/convention-core build && ls /home/hxman/AIR-harness/air/packages/convention-core/lib/index.js`
Expected: exit 0; the path is printed.

Run: `pnpm -C /home/hxman/AIR-harness/air run lint`
Expected: exit 0. If oxlint reports a rule violation in the new files, change the code to satisfy the rule (do not add a disable comment) and rerun Steps 4 and 5.

- [ ] **Step 6: Write the README**

`air/packages/convention-core/README.md`:

```markdown
# @air/dsh-convention-core

## Summary

A library, not a plugin. It holds the code every AIR file-convention plugin needs: user-home and project-root resolution, YAML frontmatter parsing with typed field readers, Markdown file discovery, a polling path watcher, kebab-case name normalisation, and the table that maps Claude Code tool names to dsh tool names.

| Export | Use |
|---|---|
| `resolveUserHomes`, `expandHome` | `~/.air` (or `$AIR_HOME`), `~/.claude`, `~/.agents` (or `$DSH_AGENTS_HOME`) |
| `findProjectRoot`, `isInside`, `directoriesBetween` | nearest ancestor containing `.git`; containment checks |
| `parseFrontmatter`, `stringField`, `booleanField`, `stringListField` | skill, command, and rule files |
| `readTextFile`, `listDirectory`, `listMarkdownTree` | discovery; an absent path is an empty result |
| `PathWatcher` | invalidation when a watched file or directory changes |
| `toKebabName` | `frontend/component.md` becomes `frontend-component` |
| `toDshToolName`, `toClaudeToolNames`, `translateToolNames` | `Edit` and `MultiEdit` become `edit`; `mcp__*` names pass through |

## Model Experience

None directly. The model sees the results through the plugins that use this library: skill names and descriptions, instruction text, and tool names.

## Known Limitations

- Files are read from the host filesystem with `node:fs`. A remote or sandboxed filesystem provider is not consulted.
- `isInside` compares normalised paths and does not resolve symbolic links.
- `PathWatcher` polls with `fs.watchFile`; a change is seen after at most one interval, and each watched path costs one `stat` per interval.
- The tool-name table covers the tools listed in the export; a Claude Code tool with no dsh equivalent (for example `NotebookEdit`) is reported as unknown.
```

- [ ] **Step 7: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/packages/convention-core
git commit -m "feat(air): add convention-core frontmatter, file listing, and path watcher"
```

---

### Task 3: `@air/dsh-skill-conventions` — skill provider

**Files:**
- Create: `air/packages/skill-conventions/package.json`
- Create: `air/packages/skill-conventions/tsconfig.build.json`
- Create: `air/packages/skill-conventions/tsconfig.json`
- Create: `air/packages/skill-conventions/tsdown.config.ts`
- Create: `air/packages/skill-conventions/vitest.config.ts`
- Create: `air/packages/skill-conventions/src/parse.ts`
- Create: `air/packages/skill-conventions/src/roots.ts`
- Create: `air/packages/skill-conventions/src/index.ts`
- Create: `air/packages/skill-conventions/README.md`
- Test: `air/packages/skill-conventions/tests/parse.spec.ts`
- Test: `air/packages/skill-conventions/tests/roots.spec.ts`
- Test: `air/packages/skill-conventions/tests/provider.spec.ts`
- Test: `air/packages/skill-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `PathWatcher`, `findProjectRoot`, `isRecord`, `listDirectory`, `listMarkdownTree`, `readTextFile`, `resolveUserHomes`, `UserHomes`, `parseFrontmatter`, `stringField`, `booleanField`, `stringListField`, `toKebabName`.
- Consumes from upstream: `ctx.skills.registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void`; `SkillCandidate`, `SkillDefinition`, `SkillLookupOptions`, `SkillInvocationPolicy`, `SkillSource` from `@deepseek-ai/dsh-skill`.
- Produces:
  - Cordis plugin module `@air/dsh-skill-conventions`: `name = 'air-skill-conventions'`, `inject = ['skills']`, `Config`, `apply(ctx, config)`.
  - `interface Config { providerName?: string; airHome?: string; claudeHome?: string; agentsHome?: string; includeUserRoots?: boolean; extraProjectRoots?: string[]; commandsUserInvocable?: boolean; descriptionMaxChars?: number; watchIntervalMs?: number; watchMaxPaths?: number }` with defaults `'air-conventions'`, homes from `resolveUserHomes`, `false`, `[]`, `true`, `1500`, `2000`, `512`.
  - `resolveConfig(config: Config): ResolvedConfig` (throws `TypeError` on invalid values).
  - `class ConventionSkillProvider implements SkillProvider`.
  - Skill sources: `project-dsh`, `project-agents`, `project-claude`, `project-claude-commands`, `project-extra`, `user-air`, `user-agents`, `user-claude`, `user-claude-commands`.
  - `SkillCandidate.metadata.claudeCode` keys (present only when the file sets them): `allowedTools: string[]`, `disallowedTools: string[]`, `arguments: string[]`, `paths: string[]`, `model: string`, `context: string`, `agent: string`, `argumentHint: string`.
  - Bundle row used in Task 9: `{ id: air-skill-conventions, name: '@air/dsh-skill-conventions', config: { commandsUserInvocable: false } }`.

- [ ] **Step 1: Create the package scaffold**

`air/packages/skill-conventions/package.json`:

```json
{
  "name": "@air/dsh-skill-conventions",
  "description": "Skill provider for .claude/skills, .claude/commands, project skill roots, and the AIR home",
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
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-skill": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-skill": "link:../../../packages/skill/skill"
  }
}
```

`air/packages/skill-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/skill-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/skill-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
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

`air/packages/skill-conventions/vitest.config.ts`:

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
Expected: exit 0; `air/packages/skill-conventions/node_modules/@air/dsh-convention-core/lib/index.js` exists; `air/packages/skill-conventions/node_modules/@deepseek-ai/dsh-skill/lib/index.js` exists.

- [ ] **Step 2: Write the failing parser and root tests**

`air/packages/skill-conventions/tests/parse.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSkillText, type ParseOptions } from '../src/parse.ts'

const skill: ParseOptions = { fallbackName: 'from-dir', kind: 'skill', commandsUserInvocable: true, descriptionMaxChars: 1500 }
const command: ParseOptions = { fallbackName: 'frontend-component', kind: 'command', commandsUserInvocable: true, descriptionMaxChars: 1500 }

describe('parseSkillText: skills', () => {
  it('reads name, description, when_to_use, and body', () => {
    expect(parseSkillText('---\nname: pdf-tools\ndescription: Work with PDFs\nwhen_to_use: For PDF files\n---\n\n# PDF\nSteps.\n', skill)).toEqual({
      name: 'pdf-tools',
      description: 'Work with PDFs',
      whenToUse: 'For PDF files',
      invocation: { modelInvocable: true, userInvocable: true },
      body: '# PDF\nSteps.',
    })
  })

  it('accepts the camelCase whenToUse spelling', () => {
    expect(parseSkillText('---\ndescription: D\nwhenToUse: Sometimes\n---\nB', skill).whenToUse).toBe('Sometimes')
  })

  it('defaults the name to the directory name, normalised to kebab-case', () => {
    expect(parseSkillText('---\ndescription: D\n---\nB', { ...skill, fallbackName: 'My Skill' }).name).toBe('my-skill')
    expect(parseSkillText('---\nname: Fancy Name\ndescription: D\n---\nB', skill).name).toBe('fancy-name')
  })

  it('defaults the description to the first body paragraph without heading marks', () => {
    expect(parseSkillText('\n\n# Deploy helper\nruns the deploy\n\nSecond paragraph.', skill).description).toBe('Deploy helper runs the deploy')
  })

  it('caps the description', () => {
    const parsed = parseSkillText(`---\ndescription: ${'x'.repeat(40)}\n---\nB`, { ...skill, descriptionMaxChars: 10 })
    expect(parsed.description).toBe(`${'x'.repeat(9)}…`)
  })

  it('reads the invocation flags', () => {
    const parsed = parseSkillText('---\ndescription: D\ndisable-model-invocation: true\nuser-invocable: false\n---\nB', skill)
    expect(parsed.invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it('keeps metadata and records Claude Code fields under metadata.claudeCode', () => {
    const parsed = parseSkillText([
      '---',
      'description: D',
      'metadata:',
      '  author: someone',
      'allowed-tools: Bash(git add:*), Read',
      'disallowed-tools: [Write]',
      'arguments: issue branch',
      'paths: ["src/**/*.ts"]',
      'model: sonnet',
      'context: fork',
      'agent: reviewer',
      'argument-hint: "[issue]"',
      '---',
      'B',
    ].join('\n'), skill)
    expect(parsed.metadata).toEqual({
      author: 'someone',
      claudeCode: {
        allowedTools: ['Bash(git add:*)', 'Read'],
        disallowedTools: ['Write'],
        arguments: ['issue', 'branch'],
        paths: ['src/**/*.ts'],
        model: 'sonnet',
        context: 'fork',
        agent: 'reviewer',
        argumentHint: '[issue]',
      },
    })
  })

  it('throws for an unusable name, a missing description, and a bad flag', () => {
    expect(() => parseSkillText('---\nname: "***"\ndescription: D\n---\nB', skill)).toThrow('invalid skill name "***"')
    expect(() => parseSkillText('---\nname: x\n---\n', skill)).toThrow('no description in frontmatter or body')
    expect(() => parseSkillText('---\ndescription: D\nuser-invocable: perhaps\n---\nB', skill)).toThrow('must be a boolean')
  })
})

describe('parseSkillText: commands', () => {
  it('names a command after its file path and keeps it out of the model catalog', () => {
    expect(parseSkillText('---\nname: ignored\ndescription: Make a component\n---\nCreate $ARGUMENTS', command)).toEqual({
      name: 'frontend-component',
      description: 'Make a component',
      invocation: { modelInvocable: false, userInvocable: true },
      body: 'Create $ARGUMENTS',
    })
  })

  it('follows the commandsUserInvocable default and explicit flags', () => {
    const hidden = { ...command, commandsUserInvocable: false }
    expect(parseSkillText('Fix it', hidden).invocation).toEqual({ modelInvocable: false, userInvocable: false })
    expect(parseSkillText('---\nuser-invocable: true\ndisable-model-invocation: false\n---\nFix it', hidden).invocation)
      .toEqual({ modelInvocable: true, userInvocable: true })
  })
})
```

`air/packages/skill-conventions/tests/roots.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { skillRoots } from '../src/roots.ts'

const homes = { airHome: '/h/.air', claudeHome: '/h/.claude', agentsHome: '/h/.agents' }

describe('skillRoots', () => {
  it('lists project roots and the AIR home, without user roots by default', () => {
    expect(skillRoots({ projectRoot: '/p', homes, includeUserRoots: false, extraProjectRoots: ['.opencode/skills'] })).toEqual([
      { path: '/p/.dsh/skills', source: 'project-dsh', rank: 100, kind: 'skill' },
      { path: '/p/.agents/skills', source: 'project-agents', rank: 200, kind: 'skill' },
      { path: '/p/.claude/skills', source: 'project-claude', rank: 220, kind: 'skill' },
      { path: '/p/.claude/commands', source: 'project-claude-commands', rank: 230, kind: 'command' },
      { path: '/p/.opencode/skills', source: 'project-extra', rank: 240, kind: 'skill' },
      { path: '/h/.air/skills', source: 'user-air', rank: 350, kind: 'skill' },
    ])
  })

  it('adds the user roots only on request and omits project roots without a project', () => {
    expect(skillRoots({ projectRoot: undefined, homes, includeUserRoots: true, extraProjectRoots: ['x'] })).toEqual([
      { path: '/h/.air/skills', source: 'user-air', rank: 350, kind: 'skill' },
      { path: '/h/.agents/skills', source: 'user-agents', rank: 500, kind: 'skill' },
      { path: '/h/.claude/skills', source: 'user-claude', rank: 520, kind: 'skill' },
      { path: '/h/.claude/commands', source: 'user-claude-commands', rank: 530, kind: 'command' },
    ])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions exec vitest run tests/parse.spec.ts tests/roots.spec.ts`
Expected: FAIL with `Failed to load url ../src/parse.ts` and `Failed to load url ../src/roots.ts`.

- [ ] **Step 4: Implement the parser and the root list**

`air/packages/skill-conventions/src/parse.ts`:

```ts
/** Parses skill files and Claude Code command files into skill metadata. */
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import {
  booleanField,
  isRecord,
  parseFrontmatter,
  stringField,
  stringListField,
  toKebabName,
} from '@air/dsh-convention-core'

/** Whether a file is a skill (`SKILL.md` or flat `<name>.md`) or a `.claude/commands` file. */
export type SkillFileKind = 'skill' | 'command'

/** Inputs that depend on where the file was found and on plugin configuration. */
export interface ParseOptions {
  /** Directory name, file stem, or joined command path used when the file declares no name. */
  readonly fallbackName: string
  readonly kind: SkillFileKind
  /** Default `userInvocable` for command files that do not set `user-invocable`. */
  readonly commandsUserInvocable: boolean
  /** Longest description kept; longer text ends with an ellipsis. */
  readonly descriptionMaxChars: number
}

/** A parsed skill or command file. */
export interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly metadata?: Record<string, unknown>
  /** Trimmed Markdown body with placeholders left as written. */
  readonly body: string
}

const LIST_FIELDS = [
  ['allowed-tools', 'allowedTools'],
  ['disallowed-tools', 'disallowedTools'],
  ['arguments', 'arguments'],
  ['paths', 'paths'],
] as const

const STRING_FIELDS = [
  ['model', 'model'],
  ['context', 'context'],
  ['agent', 'agent'],
  ['argument-hint', 'argumentHint'],
] as const

function firstParagraph(body: string): string | undefined {
  for (const block of body.split(/\n\s*\n/u)) {
    const text = block.replace(/^\s*#+\s*/u, '').replace(/\s+/gu, ' ').trim()
    if (text.length > 0) return text
  }
  return undefined
}

function claudeCodeFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [key, target] of LIST_FIELDS) {
    const value = stringListField(data, key)
    if (value !== undefined) fields[target] = value
  }
  for (const [key, target] of STRING_FIELDS) {
    const value = stringField(data, key)
    if (value !== undefined) fields[target] = value
  }
  return fields
}

/**
 * Parse one skill or command file.
 * @param raw - file content.
 * @param options - fallback name, file kind, and configured defaults.
 * @returns name, description, invocation policy, recorded Claude Code fields, and body.
 * @throws when the YAML is invalid, a flag is not a boolean, no usable name remains, or no description can be derived.
 */
export function parseSkillText(raw: string, options: ParseOptions): ParsedSkillFile {
  const { data, body } = parseFrontmatter(raw)
  const declared = (options.kind === 'skill' ? stringField(data, 'name') : undefined) ?? options.fallbackName
  const name = toKebabName(declared)
  if (name === undefined) throw new Error(`invalid skill name "${declared}"`)
  const description = stringField(data, 'description') ?? firstParagraph(body)
  if (description === undefined) throw new Error('no description in frontmatter or body')
  const disableModelInvocation = booleanField(data, 'disable-model-invocation')
  const userInvocable = booleanField(data, 'user-invocable')
  const invocation: SkillInvocationPolicy = options.kind === 'skill'
    ? { modelInvocable: disableModelInvocation !== true, userInvocable: userInvocable !== false }
    : { modelInvocable: disableModelInvocation === false, userInvocable: userInvocable ?? options.commandsUserInvocable }
  const whenToUse = stringField(data, 'when_to_use') ?? stringField(data, 'whenToUse')
  const claudeCode = claudeCodeFields(data)
  const declaredMetadata = data['metadata']
  const metadata: Record<string, unknown> = {
    ...isRecord(declaredMetadata) ? declaredMetadata : {},
    ...Object.keys(claudeCode).length > 0 ? { claudeCode } : {},
  }
  return {
    name,
    description: description.length <= options.descriptionMaxChars
      ? description
      : `${description.slice(0, options.descriptionMaxChars - 1)}…`,
    ...whenToUse !== undefined ? { whenToUse } : {},
    invocation,
    ...Object.keys(metadata).length > 0 ? { metadata } : {},
    body: body.trim(),
  }
}
```

`air/packages/skill-conventions/src/roots.ts`:

```ts
/** The skill roots this provider scans and their precedence ranks. */
import { join } from 'node:path'
import type { SkillSource } from '@deepseek-ai/dsh-skill'
import type { UserHomes } from '@air/dsh-convention-core'

/** One directory scanned for skills. Lower `rank` wins a duplicate name inside one registry layer. */
export interface SkillRoot {
  readonly path: string
  readonly source: SkillSource
  readonly rank: number
  /** `skill`: `<dir>/SKILL.md` and flat `<name>.md`, one level. `command`: every `.md` file, nested paths joined with `-`. */
  readonly kind: 'skill' | 'command'
}

/** Inputs for {@link skillRoots}. */
export interface RootOptions {
  /** Project root of the lookup cwd; undefined for a lookup without a cwd. */
  readonly projectRoot: string | undefined
  readonly homes: UserHomes
  /** Whether `~/.agents/skills`, `~/.claude/skills`, and `~/.claude/commands` are scanned. */
  readonly includeUserRoots: boolean
  /** Extra skill directories relative to the project root, for example `.opencode/skills`. */
  readonly extraProjectRoots: readonly string[]
}

/**
 * List the roots for one lookup. Ranks match upstream `skill-filesystem` for `.dsh/skills` (100) and
 * `.agents/skills` (200); the remaining roots follow in the documented priority order.
 * @param options - project root, homes, and opt-in flags.
 * @returns roots in ascending rank order.
 */
export function skillRoots(options: RootOptions): SkillRoot[] {
  const { projectRoot, homes } = options
  const roots: SkillRoot[] = []
  if (projectRoot !== undefined) {
    roots.push(
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100, kind: 'skill' },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200, kind: 'skill' },
      { path: join(projectRoot, '.claude', 'skills'), source: 'project-claude', rank: 220, kind: 'skill' },
      { path: join(projectRoot, '.claude', 'commands'), source: 'project-claude-commands', rank: 230, kind: 'command' },
    )
    for (const relativeRoot of options.extraProjectRoots) {
      roots.push({ path: join(projectRoot, relativeRoot), source: 'project-extra', rank: 240, kind: 'skill' })
    }
  }
  roots.push({ path: join(homes.airHome, 'skills'), source: 'user-air', rank: 350, kind: 'skill' })
  if (options.includeUserRoots) {
    roots.push(
      { path: join(homes.agentsHome, 'skills'), source: 'user-agents', rank: 500, kind: 'skill' },
      { path: join(homes.claudeHome, 'skills'), source: 'user-claude', rank: 520, kind: 'skill' },
      { path: join(homes.claudeHome, 'commands'), source: 'user-claude-commands', rank: 530, kind: 'command' },
    )
  }
  return roots
}
```

- [ ] **Step 5: Run the parser and root tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions exec vitest run tests/parse.spec.ts tests/roots.spec.ts`
Expected: `Test Files 2 passed (2)`.

- [ ] **Step 6: Write the failing provider tests**

`air/packages/skill-conventions/tests/provider.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as skillConventions from '../src/index.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  project: string
  home: string
  config: skillConventions.Config
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-skill-'))
  created.push(base)
  const project = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  return {
    project,
    home,
    config: {
      airHome: join(home, '.air'),
      claudeHome: join(home, '.claude'),
      agentsHome: join(home, '.agents'),
      watchIntervalMs: 0,
    },
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

function skillText(description: string, extra = '', body = 'Body.'): string {
  return `---\ndescription: ${description}\n${extra}---\n${body}\n`
}

async function mount(config: skillConventions.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(skillConventions, config)
  return { ctx, fiber }
}

async function names(ctx: Context, cwd: string | undefined): Promise<string[]> {
  return (await ctx.skills.list({ cwd })).map(skill => skill.name).sort()
}

describe('air-skill-conventions provider', () => {
  it('lists project roots and the AIR home and leaves user roots out by default', async () => {
    const { project, home, config } = await world()
    await write(join(project, '.dsh/skills/alpha/SKILL.md'), skillText('Alpha', 'name: alpha\n'))
    await write(join(project, '.agents/skills/beta/SKILL.md'), skillText('Beta'))
    await write(join(project, '.claude/skills/gamma/SKILL.md'), skillText('Gamma'))
    await write(join(project, '.claude/skills/flat.md'), skillText('Flat'))
    await write(join(project, '.claude/skills/notes.txt'), 'not a skill')
    await write(join(project, '.claude/skills/empty-dir/readme.txt'), 'no SKILL.md here')
    await write(join(project, '.claude/commands/frontend/component.md'), 'Create a component named $ARGUMENTS')
    await write(join(home, '.air/skills/delta.md'), skillText('Delta'))
    await write(join(home, '.agents/skills/decoy/SKILL.md'), skillText('Decoy'))
    await write(join(home, '.claude/skills/decoy-two/SKILL.md'), skillText('Decoy two'))
    const { ctx } = await mount(config)
    expect(await names(ctx, join(project))).toEqual(['alpha', 'beta', 'delta', 'flat', 'frontend-component', 'gamma'])
    expect(await names(ctx, undefined)).toEqual(['delta'])
  })

  it('includes the user roots on request', async () => {
    const { project, home, config } = await world()
    await write(join(home, '.agents/skills/shared/SKILL.md'), skillText('Shared'))
    await write(join(home, '.claude/skills/personal/SKILL.md'), skillText('Personal'))
    await write(join(home, '.claude/commands/standup.md'), 'Write my standup')
    const { ctx } = await mount({ ...config, includeUserRoots: true })
    expect(await names(ctx, project)).toEqual(['personal', 'shared', 'standup'])
  })

  it('scans extra project roots', async () => {
    const { project, config } = await world()
    await write(join(project, '.opencode/skills/extra/SKILL.md'), skillText('Extra'))
    const { ctx } = await mount({ ...config, extraProjectRoots: ['.opencode/skills'] })
    const [skill] = await ctx.skills.list({ cwd: project })
    expect(skill).toMatchObject({ name: 'extra', source: 'project-extra', provider: 'air-conventions' })
  })

  it('lets the lower rank win a duplicate name', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/same/SKILL.md'), skillText('From claude'))
    await write(join(project, '.dsh/skills/same/SKILL.md'), skillText('From dsh'))
    const { ctx } = await mount(config)
    const [skill] = await ctx.skills.list({ cwd: project })
    expect(skill).toMatchObject({ name: 'same', description: 'From dsh', source: 'project-dsh' })
  })

  it('marks commands user-invocable only, and hides them when commandsUserInvocable is false', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/commands/fix.md'), 'Fix issue $ARGUMENTS')
    await write(join(project, '.claude/commands/open.md'), '---\ndisable-model-invocation: false\n---\nOpen the file')
    const visible = await mount(config)
    const listed = await visible.ctx.skills.list({ cwd: project })
    expect(listed.find(skill => skill.name === 'fix')?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    const hidden = await mount({ ...config, commandsUserInvocable: false })
    expect(await names(hidden.ctx, project)).toEqual(['open'])
  })

  it('loads a body with the skill directory substituted and $ARGUMENTS left literal', async () => {
    const { project, config } = await world()
    const directory = join(project, '.claude/skills/tool')
    await write(join(directory, 'SKILL.md'), skillText('Tool', 'allowed-tools: Read\n', 'Run ${CLAUDE_SKILL_DIR}/run.sh with $ARGUMENTS'))
    const { ctx } = await mount(config)
    const definition = await ctx.skills.get('tool', { cwd: project })
    expect(definition).toMatchObject({
      name: 'tool',
      provider: 'air-conventions',
      source: 'project-claude',
      content: `Run ${directory}/run.sh with $ARGUMENTS`,
      resourceBase: { kind: 'directory', path: directory },
      metadata: { claudeCode: { allowedTools: ['Read'] } },
    })
  })

  it('drops a file with invalid frontmatter and keeps the rest', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/bad/SKILL.md'), '---\nname: [unclosed\n---\nBody')
    await write(join(project, '.claude/skills/good/SKILL.md'), skillText('Good', 'when_to_use: Always\n'))
    const { ctx } = await mount(config)
    const listed = await ctx.skills.list({ cwd: project })
    expect(listed.map(skill => skill.name)).toEqual(['good'])
    expect(listed[0]?.whenToUse).toBe('Always')
  })

  it('removes its skills when the plugin unloads', async () => {
    const { project, config } = await world()
    await write(join(project, '.claude/skills/gone/SKILL.md'), skillText('Gone'))
    const { ctx, fiber } = await mount({ ...config, watchIntervalMs: 20 })
    expect(await names(ctx, project)).toEqual(['gone'])
    await fiber.dispose()
    expect(await names(ctx, project)).toEqual([])
  })

  it('refreshes the catalog when a watched root changes', async () => {
    const { project, config } = await world()
    const { ctx } = await mount({ ...config, watchIntervalMs: 20 })
    expect(await names(ctx, project)).toEqual([])
    await write(join(project, '.claude/skills/late/SKILL.md'), skillText('Late'))
    await vi.waitFor(async () => { expect(await names(ctx, project)).toEqual(['late']) }, { timeout: 5000 })
  })
})

describe('ConventionSkillProvider.get', () => {
  const control = { signal: new AbortController().signal, invalidate: () => {} }

  it('returns undefined for a candidate it did not create and for a deleted file', async () => {
    const { project, config } = await world()
    const file = join(project, '.claude/skills/temp/SKILL.md')
    await write(file, skillText('Temp'))
    const ctx = new Context()
    contexts.push(ctx)
    const provider = new skillConventions.ConventionSkillProvider(ctx, control, skillConventions.resolveConfig(config))
    const [candidate] = await provider.list({ cwd: project })
    if (candidate === undefined) throw new Error('expected one candidate')
    const foreign: SkillCandidate = { ...candidate, locator: 'not-a-locator' }
    expect(await provider.get(foreign)).toBeUndefined()
    await rm(file)
    expect(await provider.get(candidate)).toBeUndefined()
    provider.dispose()
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    expect(skillConventions.resolveConfig({ airHome: '/a', claudeHome: '/c', agentsHome: '/g' })).toEqual({
      providerName: 'air-conventions',
      homes: { airHome: '/a', claudeHome: '/c', agentsHome: '/g' },
      includeUserRoots: false,
      extraProjectRoots: [],
      commandsUserInvocable: true,
      descriptionMaxChars: 1500,
      watchIntervalMs: 2000,
      watchMaxPaths: 512,
    })
  })

  it('rejects invalid values', () => {
    expect(() => skillConventions.resolveConfig({ descriptionMaxChars: 0 })).toThrow('descriptionMaxChars must be a positive integer')
    expect(() => skillConventions.resolveConfig({ watchIntervalMs: -1 })).toThrow('watchIntervalMs must be a non-negative integer')
    expect(() => skillConventions.resolveConfig({ watchMaxPaths: 0.5 })).toThrow('watchMaxPaths must be a positive integer')
    expect(() => skillConventions.resolveConfig({ extraProjectRoots: ['/abs'] })).toThrow('must be a relative path inside the project')
    expect(() => skillConventions.resolveConfig({ extraProjectRoots: ['a/../../b'] })).toThrow('must be a relative path inside the project')
  })
})
```

- [ ] **Step 7: Run the provider tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions exec vitest run tests/provider.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 8: Implement the plugin**

`air/packages/skill-conventions/src/index.ts`:

```ts
/**
 * Skill provider for the file conventions other agents use: project `.dsh/skills`, `.agents/skills`,
 * `.claude/skills`, `.claude/commands`, extra project roots, the AIR home, and opt-in user roots.
 * Mount it in the same agent preset as upstream `skill-filesystem` so both register in one layer.
 *
 * @module @air/dsh-skill-conventions
 */
import { dirname, isAbsolute, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import {
  PathWatcher,
  findProjectRoot,
  isRecord,
  listDirectory,
  listMarkdownTree,
  readTextFile,
  resolveUserHomes,
  type UserHomes,
} from '@air/dsh-convention-core'
import { parseSkillText, type ParsedSkillFile, type SkillFileKind } from './parse.ts'
import { skillRoots, type SkillRoot } from './roots.ts'

export const name = 'air-skill-conventions'
export const inject = ['skills']

/** Directory levels walked under a commands root (`a/b/c/d.md` is the deepest command). */
const COMMAND_TREE_DEPTH = 4

/** Plugin configuration. */
export interface Config {
  /** Unique provider name in the skill registry layer. Defaults to `air-conventions`. */
  providerName?: string
  /** AIR home; its `skills` directory is always scanned. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home, read only with `includeUserRoots`. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Shared agents home, read only with `includeUserRoots`. Defaults to `$DSH_AGENTS_HOME`, then `~/.agents`. */
  agentsHome?: string
  /** Whether `<agentsHome>/skills`, `<claudeHome>/skills`, and `<claudeHome>/commands` are scanned. Defaults to false. */
  includeUserRoots?: boolean
  /** Extra skill directories relative to the project root, for example `.opencode/skills`. */
  extraProjectRoots?: string[]
  /** Whether a command file without `user-invocable` is listed for people. Set false when a command plugin registers the same files. Defaults to true. */
  commandsUserInvocable?: boolean
  /** Longest skill description kept in the catalog. Defaults to 1500. */
  descriptionMaxChars?: number
  /** Milliseconds between polls of scanned roots and skill files; 0 disables watching. Defaults to 2000. */
  watchIntervalMs?: number
  /** Maximum number of watched paths. Defaults to 512. */
  watchMaxPaths?: number
}

export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default('air-conventions').description('Unique provider name in the skill registry layer.'),
  airHome: Schema.string().description('AIR home; defaults to $AIR_HOME, then ~/.air.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  agentsHome: Schema.string().description('Shared agents home; defaults to $DSH_AGENTS_HOME, then ~/.agents.'),
  includeUserRoots: Schema.boolean().default(false).description('Scan ~/.agents/skills, ~/.claude/skills, and ~/.claude/commands.'),
  extraProjectRoots: Schema.array(Schema.string()).default([]).description('Extra skill directories relative to the project root.'),
  commandsUserInvocable: Schema.boolean().default(true).description('List command files for people unless they set user-invocable.'),
  descriptionMaxChars: Schema.number().default(1500).description('Longest skill description kept in the catalog.'),
  watchIntervalMs: Schema.number().default(2000).description('Milliseconds between polls of scanned paths; 0 disables watching.'),
  watchMaxPaths: Schema.number().default(512).description('Maximum number of watched paths.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly providerName: string
  readonly homes: UserHomes
  readonly includeUserRoots: boolean
  readonly extraProjectRoots: readonly string[]
  readonly commandsUserInvocable: boolean
  readonly descriptionMaxChars: number
  readonly watchIntervalMs: number
  readonly watchMaxPaths: number
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? 'air-conventions',
    homes: resolveUserHomes(config),
    includeUserRoots: config.includeUserRoots ?? false,
    extraProjectRoots: config.extraProjectRoots ?? [],
    commandsUserInvocable: config.commandsUserInvocable ?? true,
    descriptionMaxChars: config.descriptionMaxChars ?? 1500,
    watchIntervalMs: config.watchIntervalMs ?? 2000,
    watchMaxPaths: config.watchMaxPaths ?? 512,
  }
  if (!Number.isInteger(resolved.descriptionMaxChars) || resolved.descriptionMaxChars < 1) {
    throw new TypeError('air-skill-conventions: descriptionMaxChars must be a positive integer')
  }
  if (!Number.isInteger(resolved.watchIntervalMs) || resolved.watchIntervalMs < 0) {
    throw new TypeError('air-skill-conventions: watchIntervalMs must be a non-negative integer')
  }
  if (!Number.isInteger(resolved.watchMaxPaths) || resolved.watchMaxPaths < 1) {
    throw new TypeError('air-skill-conventions: watchMaxPaths must be a positive integer')
  }
  for (const root of resolved.extraProjectRoots) {
    if (isAbsolute(root) || normalize(root).split(/[\\/]/u).includes('..')) {
      throw new TypeError(`air-skill-conventions: extraProjectRoots entry "${root}" must be a relative path inside the project`)
    }
  }
  return resolved
}

interface SkillFile {
  readonly path: string
  /** Directory that `${CLAUDE_SKILL_DIR}` and relative resources resolve against. */
  readonly directory: string
  readonly fallbackName: string
}

interface Locator extends SkillFile {
  readonly kind: SkillFileKind
}

function isLocator(value: unknown): value is Locator {
  return isRecord(value)
    && typeof value['path'] === 'string'
    && typeof value['directory'] === 'string'
    && typeof value['fallbackName'] === 'string'
    && (value['kind'] === 'skill' || value['kind'] === 'command')
}

async function skillFiles(root: SkillRoot): Promise<SkillFile[]> {
  if (root.kind === 'command') {
    return (await listMarkdownTree(root.path, COMMAND_TREE_DEPTH)).map(entry => ({
      path: entry.path,
      directory: dirname(entry.path),
      fallbackName: entry.segments.join('-'),
    }))
  }
  const files: SkillFile[] = []
  for (const entry of await listDirectory(root.path)) {
    if (entry.kind === 'directory') {
      files.push({ path: join(entry.path, 'SKILL.md'), directory: entry.path, fallbackName: entry.name })
    } else if (entry.name.endsWith('.md')) {
      files.push({ path: entry.path, directory: root.path, fallbackName: entry.name.slice(0, -3) })
    }
  }
  return files
}

/** Skill provider over the convention roots. One instance serves every lookup cwd. */
export class ConventionSkillProvider implements SkillProvider {
  readonly name: string
  private readonly watcher: PathWatcher | undefined

  /**
   * @param ctx - plugin context, used for warnings.
   * @param control - registration lifecycle; `invalidate` is called when a watched path changes.
   * @param config - resolved configuration.
   */
  constructor(
    private readonly ctx: Context,
    control: SkillProviderControl,
    private readonly config: ResolvedConfig,
  ) {
    this.name = config.providerName
    this.watcher = config.watchIntervalMs > 0
      ? new PathWatcher({ intervalMs: config.watchIntervalMs, maxPaths: config.watchMaxPaths, onChange: control.invalidate })
      : undefined
    control.signal.addEventListener('abort', () => { this.dispose() }, { once: true })
  }

  /**
   * Discover skill candidates for one lookup.
   * @param options - lookup options; `cwd` selects the project roots.
   * @returns candidates from every configured root; files that fail to parse are logged and omitted.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const projectRoot = options.cwd === undefined ? undefined : await findProjectRoot(options.cwd)
    const roots = skillRoots({
      projectRoot,
      homes: this.config.homes,
      includeUserRoots: this.config.includeUserRoots,
      extraProjectRoots: this.config.extraProjectRoots,
    })
    const candidates: SkillCandidate[] = []
    const watched: string[] = []
    for (const root of roots) {
      watched.push(root.path)
      for (const file of await skillFiles(root)) {
        watched.push(file.path)
        const parsed = await this.parse(file, root.kind)
        if (parsed === undefined) continue
        if (!parsed.invocation.modelInvocable && !parsed.invocation.userInvocable) continue
        const locator: Locator = { ...file, kind: root.kind }
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          provider: this.name,
          source: root.source,
          rank: root.rank,
          locator,
          resourceBase: { kind: 'directory', path: file.directory },
          path: file.path,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        })
      }
    }
    this.watcher?.retain(watched)
    return candidates
  }

  /**
   * Load the body of a candidate this provider listed.
   * @param candidate - winning candidate from {@link list}.
   * @returns the definition with `${CLAUDE_SKILL_DIR}` replaced by the skill directory, or undefined when the file is gone or no longer parses.
   */
  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator
    if (!isLocator(locator)) return undefined
    const parsed = await this.parse(locator, locator.kind)
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      content: parsed.body.replaceAll('${CLAUDE_SKILL_DIR}', locator.directory),
    }
  }

  /** Stop watching. Safe to call more than once. */
  dispose(): void {
    this.watcher?.close()
  }

  private async parse(file: SkillFile, kind: SkillFileKind): Promise<ParsedSkillFile | undefined> {
    const raw = await readTextFile(file.path)
    if (raw === undefined) return undefined
    try {
      return parseSkillText(raw, {
        fallbackName: file.fallbackName,
        kind,
        commandsUserInvocable: this.config.commandsUserInvocable,
        descriptionMaxChars: this.config.descriptionMaxChars,
      })
    } catch (error: unknown) {
      this.ctx.logger.warn(`air-skill-conventions: ${file.path} ignored: ${(error as Error).message}`)
      return undefined
    }
  }
}

/**
 * Register the convention skill provider in the calling context's skill-registry layer.
 * @param ctx - plugin context with the `skills` service injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  let provider: ConventionSkillProvider | undefined
  ctx.skills.registerProvider((control) => {
    provider = new ConventionSkillProvider(ctx, control, resolved)
    return provider
  })
  ctx.effect(() => () => { provider?.dispose() }, 'air-skill-conventions.watcher')
}
```

- [ ] **Step 9: Run all unit tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions exec vitest run tests/parse.spec.ts tests/roots.spec.ts tests/provider.spec.ts`
Expected: `Test Files 3 passed (3)`.

If `ctx.logger.warn` is reported as not callable, compare with `packages/skill/skill-filesystem/src/index.ts` (it calls `ctx.logger.warn(message)` the same way) and check that `@deepseek-ai/cordis` resolves to `vendor/cordis` (`ls -l air/packages/skill-conventions/node_modules/@deepseek-ai/`).

- [ ] **Step 10: Write the native Loader test**

`air/packages/skill-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-skill'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-skill-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude', 'skills', 'hello'), { recursive: true })
  await writeFile(join(project, '.claude', 'skills', 'hello', 'SKILL.md'), '---\ndescription: Say hello\n---\nGreet the user.\n')
  await mkdir(join(home, '.agents', 'skills', 'decoy'), { recursive: true })
  await writeFile(join(home, '.agents', 'skills', 'decoy', 'SKILL.md'), '---\ndescription: Decoy\n---\nUnrelated.\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    '- id: air-skill-conventions',
    "  name: '@air/dsh-skill-conventions'",
    '  config:',
    `    airHome: ${JSON.stringify(join(home, '.air'))}`,
    `    claudeHome: ${JSON.stringify(join(home, '.claude'))}`,
    `    agentsHome: ${JSON.stringify(join(home, '.agents'))}`,
    '    watchIntervalMs: 0',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const skills = await context.skills.list({ cwd: project })
  expect(skills.map(skill => skill.name)).toEqual(['hello'])
  expect(skills[0]).toMatchObject({ provider: 'air-conventions', source: 'project-claude' })
  expect((await context.skills.get('hello', { cwd: project }))?.content).toBe('Greet the user.')
})
```

- [ ] **Step 11: Build, then run the whole suite with coverage**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions build && pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 4 passed (4)`; `index.ts`, `parse.ts`, and `roots.ts` at 100 in every column.

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/skill-conventions typecheck && pnpm -C /home/hxman/AIR-harness/air run lint`
Expected: exit 0 for both.

- [ ] **Step 12: Write the README**

`air/packages/skill-conventions/README.md`:

```markdown
# @air/dsh-skill-conventions

## Summary

A skill provider (`air-conventions`) for the directories other agents already use. It registers through `ctx.skills.registerProvider` and must be mounted in the same agent preset as upstream `skill-filesystem`, because the preset layer wins duplicate names over host-level providers. The AIR preset sets `skill-filesystem` to `includeDefaultRoots: false`, so this provider is the only source of local skills.

| Root | Source | Rank | Scanned |
|---|---|---|---|
| `<project>/.dsh/skills` | `project-dsh` | 100 | always |
| `<project>/.agents/skills` | `project-agents` | 200 | always |
| `<project>/.claude/skills` | `project-claude` | 220 | always |
| `<project>/.claude/commands` | `project-claude-commands` | 230 | always |
| each `extraProjectRoots` entry | `project-extra` | 240 | when configured |
| `<airHome>/skills` | `user-air` | 350 | always |
| `<agentsHome>/skills` | `user-agents` | 500 | `includeUserRoots: true` |
| `<claudeHome>/skills` | `user-claude` | 520 | `includeUserRoots: true` |
| `<claudeHome>/commands` | `user-claude-commands` | 530 | `includeUserRoots: true` |

`<project>` is the nearest ancestor of the session cwd that contains `.git`. A lower rank wins a duplicate name. A skill is `<root>/<dir>/SKILL.md` or `<root>/<name>.md`; a command is any `.md` file up to four levels deep, named after its path (`frontend/component.md` becomes `frontend-component`).

Differences from upstream `skill-filesystem` parsing: `name` defaults to the directory or file name; `description` defaults to the first body paragraph; `when_to_use` is accepted; a file without frontmatter is valid. The Claude Code fields `allowed-tools`, `disallowed-tools`, `arguments`, `paths`, `model`, `context`, `agent`, and `argument-hint` are recorded under `metadata.claudeCode` for other AIR plugins and have no effect here.

Config: `providerName`, `airHome`, `claudeHome`, `agentsHome`, `includeUserRoots` (default `false`), `extraProjectRoots` (default `[]`), `commandsUserInvocable` (default `true`), `descriptionMaxChars` (default 1500), `watchIntervalMs` (default 2000; 0 disables), `watchMaxPaths` (default 512).

## Model Experience

The model sees these skills in the same catalog and loads them with the same `skill` tool as any other skill. Command files are user-invocable only unless the file sets `disable-model-invocation: false`, so they do not consume catalog space. A loaded body has `${CLAUDE_SKILL_DIR}` replaced with the absolute skill directory. `$ARGUMENTS` and `$1` placeholders stay literal on the skill path; `@air/dsh-command-conventions` substitutes them for command files.

## Known Limitations

- Skills written for Claude Code may name tools that do not exist here (`NotebookEdit`) or use Claude Code tool names (`Bash`, `Edit`); the model sees those names unchanged.
- `allowed-tools`, `context: fork`, `agent`, `model`, and `paths` are recorded but not enforced.
- `` !`cmd` `` lines and `@file` references in a skill body are not expanded.
- Files are read from the host filesystem, not through `ctx.fs`.
- Nested `<subdir>/.claude/skills` directories below the project root are not scanned.
- With `includeDefaultRoots: false` on upstream `skill-filesystem`, skills bundled with the upstream application (`DSH_BUNDLED_SKILL_DIR`) and `~/.dsh/skills` are not listed.
- A changed description is seen after at most one `watchIntervalMs`; a body edit is always read fresh.
```

- [ ] **Step 13: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/packages/skill-conventions air/pnpm-lock.yaml
git commit -m "feat(air): add the convention skill provider with opt-in user roots"
```

---

### Task 4: `@air/dsh-instruction-conventions` — imports, rules, baseline text

**Files:**
- Create: `air/packages/instruction-conventions/package.json`
- Create: `air/packages/instruction-conventions/tsconfig.build.json`
- Create: `air/packages/instruction-conventions/tsconfig.json`
- Create: `air/packages/instruction-conventions/tsdown.config.ts`
- Create: `air/packages/instruction-conventions/vitest.config.ts`
- Create: `air/packages/instruction-conventions/src/imports.ts`
- Create: `air/packages/instruction-conventions/src/rules.ts`
- Create: `air/packages/instruction-conventions/src/baseline.ts`
- Test: `air/packages/instruction-conventions/tests/imports.spec.ts`
- Test: `air/packages/instruction-conventions/tests/rules.spec.ts`
- Test: `air/packages/instruction-conventions/tests/baseline.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `directoriesBetween`, `expandHome`, `isInside`, `listMarkdownTree`, `parseFrontmatter`, `readTextFile`, `stringListField`.
- Produces (package-internal modules used by Task 5):
  - `imports.ts`: `MAX_IMPORT_HOPS = 4`; `interface InstructionFile { readonly path: string; readonly content: string }`; `interface SkippedImport { readonly path: string; readonly reason: 'outside-project' | 'max-hops' }`; `interface ImportOptions { readonly projectRoot: string; readonly allowedRoots: readonly string[]; readonly home: string }`; `findImportPaths(text: string): string[]`; `resolveImports(seeds: readonly InstructionFile[], options: ImportOptions): Promise<{ files: InstructionFile[]; skipped: SkippedImport[] }>`.
  - `rules.ts`: `interface Rule { readonly path: string; readonly relativePath: string; readonly content: string; readonly globs: readonly string[]; readonly digest: string }`; `loadClaudeRules(projectRoot: string): Promise<{ rules: Rule[]; problems: string[] }>`; `matchingRules(rules: readonly Rule[], relativeFilePath: string): Rule[]`.
  - `baseline.ts`: `interface BaselineInput { readonly cwd: string; readonly projectRoot: string; readonly claudeHome: string; readonly home: string; readonly includeUserRoots: boolean; readonly allowedImportRoots: readonly string[]; readonly maxBytes: number }`; `interface Baseline { readonly text: string; readonly digest: string }`; `composeBaseline(input: BaselineInput): Promise<{ baseline: Baseline | undefined; problems: string[] }>`.

What the baseline contains, in order: `<project>/.claude/CLAUDE.md`; `<claudeHome>/CLAUDE.md` when `includeUserRoots`; every file reached through `@path` imports from those two files and from the `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` files between the project root and the cwd (upstream `agent-instructions` already injects those four files themselves, so they are import seeds only); every `.claude/rules/**/*.md` file without `paths:`. Identical content is included once. A file that would exceed `maxBytes` is left out and named in a `<skipped reason="budget"/>` line.

- [ ] **Step 1: Create the package scaffold**

`air/packages/instruction-conventions/package.json`:

```json
{
  "name": "@air/dsh-instruction-conventions",
  "description": "Loads .claude/CLAUDE.md, @path imports, and .claude/rules as injected instructions",
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
    "@deepseek-ai/dsh-llm": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-agent-loop-testkit": "link:../../../packages/test-support/agent-loop-testkit",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session",
    "@deepseek-ai/dsh-system-prompt": "link:../../../packages/core/system-prompt",
    "@deepseek-ai/dsh-tools": "link:../../../packages/core/tools",
    "@types/picomatch": "^4.0.2"
  }
}
```

`air/packages/instruction-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/instruction-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/instruction-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
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

`air/packages/instruction-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C /home/hxman/AIR-harness/air install`
Expected: exit 0; `air/packages/instruction-conventions/node_modules/picomatch` exists.

- [ ] **Step 2: Write the failing tests**

`air/packages/instruction-conventions/tests/imports.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_IMPORT_HOPS, findImportPaths, resolveImports } from '../src/imports.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function world(): Promise<{ project: string; home: string; outside: string }> {
  const base = await mkdtemp(join(tmpdir(), 'air-imports-'))
  created.push(base)
  return { project: join(base, 'project'), home: join(base, 'home'), outside: join(base, 'outside') }
}

async function write(path: string, text: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

describe('findImportPaths', () => {
  it('finds @path tokens at the start of a line and after whitespace', () => {
    expect(findImportPaths('@README\nSee @docs/style.md, then @~/notes.md. Also @./a/b.md)')).toEqual([
      'README',
      'docs/style.md',
      '~/notes.md',
      './a/b.md',
    ])
  })

  it('ignores code spans, fenced blocks, addresses, and a bare @', () => {
    const text = [
      'Mail me at someone@example.com or ping @ later.',
      'Inline `@not/imported.md` is code.',
      '```',
      '@inside/fence.md',
      '```',
      '~~~',
      '@inside/tilde.md',
      '~~~',
      '@real.md',
    ].join('\n')
    expect(findImportPaths(text)).toEqual(['real.md'])
  })
})

describe('resolveImports', () => {
  it('follows imports relative to the importing file, in document order', async () => {
    const { project, home } = await world()
    const seed = await write(join(project, 'CLAUDE.md'), 'Read @docs/a.md and @docs/b.md')
    await write(join(project, 'docs/a.md'), 'A imports @nested/c.md')
    await write(join(project, 'docs/nested/c.md'), 'C')
    await write(join(project, 'docs/b.md'), 'B')
    const result = await resolveImports([{ path: seed, content: 'Read @docs/a.md and @docs/b.md' }], { projectRoot: project, allowedRoots: [], home })
    expect(result.files.map(file => file.content)).toEqual(['A imports @nested/c.md', 'C', 'B'])
    expect(result.skipped).toEqual([])
  })

  it('includes each file once, does not re-include a seed, and ignores missing files', async () => {
    const { project, home } = await world()
    const seed = await write(join(project, 'CLAUDE.md'), '@a.md @a.md @AGENTS.md @missing.md')
    const agents = await write(join(project, 'AGENTS.md'), 'Agents imports @a.md')
    await write(join(project, 'a.md'), 'A imports @CLAUDE.md')
    const result = await resolveImports([
      { path: seed, content: '@a.md @a.md @AGENTS.md @missing.md' },
      { path: agents, content: 'Agents imports @a.md' },
    ], { projectRoot: project, allowedRoots: [], home })
    expect(result.files).toEqual([{ path: join(project, 'a.md'), content: 'A imports @CLAUDE.md' }])
    expect(result.skipped).toEqual([])
  })

  it('stops after the hop limit', async () => {
    const { project, home } = await world()
    expect(MAX_IMPORT_HOPS).toBe(4)
    for (let hop = 1; hop <= 5; hop += 1) await write(join(project, `h${hop}.md`), `hop ${hop} @h${hop + 1}.md`)
    const result = await resolveImports([{ path: join(project, 'CLAUDE.md'), content: '@h1.md' }], { projectRoot: project, allowedRoots: [], home })
    expect(result.files.map(file => file.path)).toEqual([1, 2, 3, 4].map(hop => join(project, `h${hop}.md`)))
    expect(result.skipped).toEqual([{ path: join(project, 'h5.md'), reason: 'max-hops' }])
  })

  it('skips imports outside the project unless an allowed root contains them', async () => {
    const { project, home, outside } = await world()
    await write(join(outside, 'shared.md'), 'Shared')
    await write(join(home, 'notes.md'), 'Notes')
    const content = `@${join(outside, 'shared.md')} @~/notes.md @../outside/shared.md`
    const seed = { path: join(project, 'CLAUDE.md'), content }
    const denied = await resolveImports([seed], { projectRoot: project, allowedRoots: [], home })
    expect(denied.files).toEqual([])
    expect(denied.skipped).toEqual([
      { path: join(outside, 'shared.md'), reason: 'outside-project' },
      { path: join(home, 'notes.md'), reason: 'outside-project' },
    ])
    const allowed = await resolveImports([seed], { projectRoot: project, allowedRoots: [outside, home], home })
    expect(allowed.files.map(file => file.content)).toEqual(['Shared', 'Notes'])
    expect(allowed.skipped).toEqual([])
  })
})
```

`air/packages/instruction-conventions/tests/rules.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadClaudeRules, matchingRules } from '../src/rules.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-rules-'))
  created.push(dir)
  return dir
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('loadClaudeRules', () => {
  it('loads always rules and path-scoped rules from nested directories', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/general.md'), 'Be concise.\n')
    await write(join(root, '.claude/rules/frontend/ts.md'), '---\npaths:\n  - "**/*.ts"\n  - "web/**"\n---\nUse strict TypeScript.\n')
    await write(join(root, '.claude/rules/py.md'), '---\npaths: "**/*.py"\n---\nUse type hints.\n')
    const { rules, problems } = await loadClaudeRules(root)
    expect(problems).toEqual([])
    expect(rules.map(rule => ({ relativePath: rule.relativePath, globs: rule.globs, content: rule.content }))).toEqual([
      { relativePath: '.claude/rules/frontend/ts.md', globs: ['**/*.ts', 'web/**'], content: 'Use strict TypeScript.' },
      { relativePath: '.claude/rules/general.md', globs: [], content: 'Be concise.' },
      { relativePath: '.claude/rules/py.md', globs: ['**/*.py'], content: 'Use type hints.' },
    ])
    expect(rules[0]?.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect(rules[0]?.path).toBe(join(root, '.claude/rules/frontend/ts.md'))
  })

  it('reports an unparsable rule file and skips an empty one', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    await write(join(root, '.claude/rules/empty.md'), '---\npaths: "**/*.md"\n---\n\n')
    const { rules, problems } = await loadClaudeRules(root)
    expect(rules).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(join(root, '.claude/rules/bad.md'))
  })

  it('returns nothing for a project without rules', async () => {
    expect(await loadClaudeRules(await project())).toEqual({ rules: [], problems: [] })
  })
})

describe('matchingRules', () => {
  it('returns path-scoped rules whose globs match the project-relative path', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/general.md'), 'Always.')
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nTypeScript.')
    await write(join(root, '.claude/rules/dot.md'), '---\npaths: ".github/**"\n---\nWorkflows.')
    const { rules } = await loadClaudeRules(root)
    expect(matchingRules(rules, 'src/deep/a.ts').map(rule => rule.content)).toEqual(['TypeScript.'])
    expect(matchingRules(rules, '.github/workflows/ci.yml').map(rule => rule.content)).toEqual(['Workflows.'])
    expect(matchingRules(rules, 'README.md')).toEqual([])
  })
})
```

`air/packages/instruction-conventions/tests/baseline.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeBaseline, type BaselineInput } from '../src/baseline.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function world(): Promise<BaselineInput> {
  const base = await mkdtemp(join(tmpdir(), 'air-baseline-'))
  created.push(base)
  const projectRoot = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(projectRoot, 'pkg'), { recursive: true })
  return {
    cwd: join(projectRoot, 'pkg'),
    projectRoot,
    claudeHome: join(home, '.claude'),
    home,
    includeUserRoots: false,
    allowedImportRoots: [],
    maxBytes: 32768,
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('composeBaseline', () => {
  it('returns nothing when the workspace has no convention files', async () => {
    expect(await composeBaseline(await world())).toEqual({ baseline: undefined, problems: [] })
  })

  it('assembles .claude/CLAUDE.md, imports from the instruction chain, and always rules', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory. @../docs/style.md')
    await write(join(root, 'docs/style.md'), 'Style guide.')
    await write(join(root, 'CLAUDE.md'), 'Root file, injected upstream. @docs/build.md')
    await write(join(root, 'docs/build.md'), 'Build steps.')
    await write(join(root, 'pkg/AGENTS.local.md'), 'Local file, injected upstream. @notes.md')
    await write(join(root, 'pkg/notes.md'), 'Package notes.')
    await write(join(root, '.claude/rules/general.md'), 'Be concise.')
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nScoped rule.')
    const { baseline, problems } = await composeBaseline(input)
    expect(problems).toEqual([])
    expect(baseline?.text).toBe([
      '<air_instructions>',
      'These project convention files apply to this workspace. Follow them together with the other workspace instructions.',
      `<file path="${join(root, '.claude/CLAUDE.md')}">`,
      'Project memory. @../docs/style.md',
      '</file>',
      `<file path="${join(root, 'docs/style.md')}">`,
      'Style guide.',
      '</file>',
      `<file path="${join(root, 'docs/build.md')}">`,
      'Build steps.',
      '</file>',
      `<file path="${join(root, 'pkg/notes.md')}">`,
      'Package notes.',
      '</file>',
      `<file path="${join(root, '.claude/rules/general.md')}">`,
      'Be concise.',
      '</file>',
      '</air_instructions>',
    ].join('\n'))
    expect(baseline?.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect((await composeBaseline(input)).baseline?.digest).toBe(baseline?.digest)
  })

  it('reads the user CLAUDE.md and its imports only on request', async () => {
    const input = await world()
    await write(join(input.claudeHome, 'CLAUDE.md'), 'User memory. @~/.claude/extra.md')
    await write(join(input.claudeHome, 'extra.md'), 'User extra.')
    expect((await composeBaseline(input)).baseline).toBeUndefined()
    const { baseline } = await composeBaseline({ ...input, includeUserRoots: true })
    expect(baseline?.text).toContain('User memory.')
    expect(baseline?.text).toContain('User extra.')
  })

  it('includes identical or empty content once and notes skipped imports', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Same text. @/etc/air-outside.md')
    await write(join(root, '.claude/rules/dup.md'), 'Same text. @/etc/air-outside.md')
    await write(join(root, '.claude/rules/blank.md'), '   \n')
    const { baseline } = await composeBaseline(input)
    expect(baseline?.text.match(/Same text\./gu)).toHaveLength(1)
    expect(baseline?.text).toContain('<skipped path="/etc/air-outside.md" reason="outside-project"/>')
  })

  it('leaves out a file that exceeds the byte budget and names it', async () => {
    const input = await world()
    const root = input.projectRoot
    await write(join(root, '.claude/CLAUDE.md'), 'Short.')
    await write(join(root, '.claude/rules/we"ird.md'), 'x'.repeat(400))
    const { baseline } = await composeBaseline({ ...input, maxBytes: 200 })
    expect(baseline?.text).toContain('Short.')
    expect(baseline?.text).not.toContain('xxxx')
    expect(baseline?.text).toContain(`<skipped path="${join(root, '.claude/rules/we&quot;ird.md')}" reason="budget"/>`)
  })

  it('returns rule problems', async () => {
    const input = await world()
    await write(join(input.projectRoot, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    const { baseline, problems } = await composeBaseline(input)
    expect(baseline).toBeUndefined()
    expect(problems).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions test`
Expected: FAIL, three files, each with `Failed to load url ../src/<module>.ts`.

- [ ] **Step 4: Implement the modules**

`air/packages/instruction-conventions/src/imports.ts`:

```ts
/** Resolves Claude Code `@path` imports found in instruction files. */
import { dirname, resolve } from 'node:path'
import { expandHome, isInside, readTextFile } from '@air/dsh-convention-core'

/** Claude Code follows imports at most this many files deep from the file that starts the chain. */
export const MAX_IMPORT_HOPS = 4

/** An instruction file with its content. */
export interface InstructionFile {
  readonly path: string
  readonly content: string
}

/** An import that was found but not read. */
export interface SkippedImport {
  readonly path: string
  readonly reason: 'outside-project' | 'max-hops'
}

/** Containment settings for {@link resolveImports}. */
export interface ImportOptions {
  readonly projectRoot: string
  /** Absolute directories outside the project whose files may be imported. */
  readonly allowedRoots: readonly string[]
  /** Home directory used to expand `@~/...`. */
  readonly home: string
}

const FENCE = /^(?:```|~~~)/u
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u

/**
 * List the `@path` tokens in Markdown text. A token starts a line or follows whitespace.
 * Fenced code blocks and inline code spans are ignored.
 * @param text - instruction file content.
 * @returns paths as written, without the `@` and without trailing punctuation.
 */
export function findImportPaths(text: string): string[] {
  const paths: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line.trimStart())) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const token of line.replace(/`[^`]*`/gu, ' ').split(/\s+/u)) {
      if (!token.startsWith('@')) continue
      const path = token.slice(1).replace(TRAILING_PUNCTUATION, '')
      if (path.length > 0) paths.push(path)
    }
  }
  return paths
}

/**
 * Read every file reachable through `@path` imports from the seed files.
 * Relative paths resolve against the importing file's directory. A file is read once; seed files
 * are never returned. A path that is not a regular file is ignored.
 * @param seeds - files whose content starts the import chains (hop 0).
 * @param options - project root, extra allowed roots, and the home directory.
 * @returns imported files in depth-first document order, plus the imports that were not read.
 */
export async function resolveImports(
  seeds: readonly InstructionFile[],
  options: ImportOptions,
): Promise<{ files: InstructionFile[]; skipped: SkippedImport[] }> {
  const files: InstructionFile[] = []
  const skipped: SkippedImport[] = []
  const visited = new Set(seeds.map(seed => resolve(seed.path)))
  const permitted = (path: string): boolean =>
    isInside(options.projectRoot, path) || options.allowedRoots.some(root => isInside(root, path))
  const visit = async (file: InstructionFile, hop: number): Promise<void> => {
    for (const written of findImportPaths(file.content)) {
      const target = resolve(dirname(file.path), expandHome(written, options.home))
      if (visited.has(target)) continue
      visited.add(target)
      if (!permitted(target)) {
        skipped.push({ path: target, reason: 'outside-project' })
        continue
      }
      const content = await readTextFile(target)
      if (content === undefined) continue
      if (hop + 1 > MAX_IMPORT_HOPS) {
        skipped.push({ path: target, reason: 'max-hops' })
        continue
      }
      const imported = { path: target, content }
      files.push(imported)
      await visit(imported, hop + 1)
    }
  }
  for (const seed of seeds) await visit(seed, 0)
  return { files, skipped }
}
```

`air/packages/instruction-conventions/src/rules.ts`:

```ts
/** Loads Markdown rule files under .claude/rules and matches path-scoped rules against touched files. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { listMarkdownTree, parseFrontmatter, readTextFile, stringListField } from '@air/dsh-convention-core'

/** Directory levels walked under `.claude/rules`. */
const RULE_TREE_DEPTH = 6

/** One rule file. A rule without globs applies always; a rule with globs applies after a matching file is touched. */
export interface Rule {
  readonly path: string
  /** Path relative to the project root with `/` separators, used as the rule's identity in message sources. */
  readonly relativePath: string
  readonly content: string
  /** `paths:` globs relative to the project root; empty for an always rule. */
  readonly globs: readonly string[]
  /** First 16 hex digits of the SHA-256 of `content`. */
  readonly digest: string
}

/**
 * Load every rule file of a project.
 * @param projectRoot - project root directory.
 * @returns rules with non-empty bodies, and one problem line per file that failed to parse.
 */
export async function loadClaudeRules(projectRoot: string): Promise<{ rules: Rule[]; problems: string[] }> {
  const rules: Rule[] = []
  const problems: string[] = []
  for (const entry of await listMarkdownTree(join(projectRoot, '.claude', 'rules'), RULE_TREE_DEPTH)) {
    const raw = await readTextFile(entry.path)
    /* v8 ignore next -- the file was listed a moment ago; only a concurrent delete reaches this. */
    if (raw === undefined) continue
    try {
      const { data, body } = parseFrontmatter(raw)
      const globs = stringListField(data, 'paths') ?? []
      const content = body.trim()
      if (content.length === 0) continue
      rules.push({
        path: entry.path,
        relativePath: `.claude/rules/${entry.segments.join('/')}.md`,
        content,
        globs,
        digest: createHash('sha256').update(content).digest('hex').slice(0, 16),
      })
    } catch (error: unknown) {
      problems.push(`${entry.path}: ${(error as Error).message}`)
    }
  }
  return { rules, problems }
}

/**
 * Select the path-scoped rules that apply to one file.
 * @param rules - rules from {@link loadClaudeRules}.
 * @param relativeFilePath - file path relative to the project root with `/` separators.
 * @returns rules with at least one matching glob; always rules are never returned.
 */
export function matchingRules(rules: readonly Rule[], relativeFilePath: string): Rule[] {
  return rules.filter(rule => rule.globs.length > 0 && picomatch.isMatch(relativeFilePath, [...rule.globs], { dot: true }))
}
```

`air/packages/instruction-conventions/src/baseline.ts`:

```ts
/** Assembles the model-facing text for the convention files that apply from the first request. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { directoriesBetween, readTextFile } from '@air/dsh-convention-core'
import { resolveImports, type InstructionFile, type SkippedImport } from './imports.ts'
import { loadClaudeRules } from './rules.ts'

/** Files upstream `agent-instructions` injects itself; here they only start import chains. */
const CHAIN_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']

const PREAMBLE = 'These project convention files apply to this workspace. Follow them together with the other workspace instructions.'

/** Inputs for {@link composeBaseline}. */
export interface BaselineInput {
  /** Session working directory. */
  readonly cwd: string
  readonly projectRoot: string
  /** Claude Code home (`~/.claude`). */
  readonly claudeHome: string
  /** Home directory used to expand `@~/...` imports. */
  readonly home: string
  /** Whether `<claudeHome>/CLAUDE.md` is read and `claudeHome` is an allowed import root. */
  readonly includeUserRoots: boolean
  /** Absolute directories outside the project whose files may be imported. */
  readonly allowedImportRoots: readonly string[]
  /** UTF-8 byte budget for included file blocks. */
  readonly maxBytes: number
}

/** The assembled text and its identity. */
export interface Baseline {
  readonly text: string
  /** First 16 hex digits of the SHA-256 of `text`; a changed digest means the text must be injected again. */
  readonly digest: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function attribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

async function readExisting(paths: readonly string[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  for (const path of paths) {
    const content = await readTextFile(path)
    if (content !== undefined) files.push({ path, content })
  }
  return files
}

function render(files: readonly InstructionFile[], skipped: readonly SkippedImport[], maxBytes: number): Baseline | undefined {
  const seen = new Set<string>()
  const blocks: string[] = []
  const notes = skipped.map(item => `<skipped path="${attribute(item.path)}" reason="${item.reason}"/>`)
  let bytes = 0
  for (const file of files) {
    const content = file.content.trim()
    const identity = sha256(content)
    if (content.length === 0 || seen.has(identity)) continue
    seen.add(identity)
    const block = `<file path="${attribute(file.path)}">\n${content}\n</file>`
    const size = Buffer.byteLength(block)
    if (bytes + size > maxBytes) {
      notes.push(`<skipped path="${attribute(file.path)}" reason="budget"/>`)
      continue
    }
    bytes += size
    blocks.push(block)
  }
  if (blocks.length === 0 && notes.length === 0) return undefined
  const text = ['<air_instructions>', PREAMBLE, ...blocks, ...notes, '</air_instructions>'].join('\n')
  return { text, digest: sha256(text).slice(0, 16) }
}

/**
 * Read the convention files that apply to a session from its first request and render them.
 * @param input - workspace location, user-root opt-in, import allowlist, and byte budget.
 * @returns the baseline, or undefined when no file applies; plus rule-file parse problems.
 */
export async function composeBaseline(input: BaselineInput): Promise<{ baseline: Baseline | undefined; problems: string[] }> {
  const included = await readExisting([
    join(input.projectRoot, '.claude', 'CLAUDE.md'),
    ...input.includeUserRoots ? [join(input.claudeHome, 'CLAUDE.md')] : [],
  ])
  const chain = await readExisting(
    directoriesBetween(input.projectRoot, input.cwd).flatMap(directory => CHAIN_FILES.map(file => join(directory, file))),
  )
  const imports = await resolveImports([...included, ...chain], {
    projectRoot: input.projectRoot,
    allowedRoots: [...input.allowedImportRoots, ...input.includeUserRoots ? [input.claudeHome] : []],
    home: input.home,
  })
  const ruleSet = await loadClaudeRules(input.projectRoot)
  const always = ruleSet.rules
    .filter(rule => rule.globs.length === 0)
    .map(rule => ({ path: rule.path, content: rule.content }))
  return {
    baseline: render([...included, ...imports.files, ...always], imports.skipped, input.maxBytes),
    problems: ruleSet.problems,
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions test`
Expected: `Test Files 3 passed (3)`.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions typecheck`
Expected: exit 0. (`src/index.ts` does not exist yet; `tsc -p tsconfig.json` checks the three modules and the tests.)

```bash
cd /home/hxman/AIR-harness
git add air/packages/instruction-conventions air/pnpm-lock.yaml
git commit -m "feat(air): resolve @path imports and .claude/rules into an instruction baseline"
```

---

### Task 5: `@air/dsh-instruction-conventions` — plugin, Loader test, README

**Files:**
- Create: `air/packages/instruction-conventions/src/index.ts`
- Create: `air/packages/instruction-conventions/tests/harness.ts`
- Create: `air/packages/instruction-conventions/README.md`
- Test: `air/packages/instruction-conventions/tests/plugin.spec.ts`
- Test: `air/packages/instruction-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from Task 4: `composeBaseline(input: BaselineInput)`, `loadClaudeRules(projectRoot)`, `matchingRules(rules, relativeFilePath)`, `Rule`.
- Consumes from upstream: `ctx.on('agent/pre-step', (payload: { agent; messages: UserMessage[]; turn; step; signal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>)`; `ctx.on('tools/post-execute', (exec: ToolExecution, result, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>)`; `createUserMessage({ content, source })`; `agent.session.header.cwd`; `agent.session.deriveMessages(): Message[]`.
- Produces:
  - Cordis plugin module `@air/dsh-instruction-conventions`: `name = 'air-instruction-conventions'`, `Config`, `apply(ctx, config)`. No `inject`.
  - `interface Config { maxBytes: number; claudeHome?: string; includeUserRoots?: boolean; allowedImportRoots?: string[]; projectRootMarkers?: string[] }` (defaults: `~/.claude`, `false`, `[]`, `['.git']`; `maxBytes` is required).
  - `resolveConfig(config: Config): ResolvedConfig`.
  - Message source kind `air-instructions`: `interface AirInstructionSource { readonly kind: 'air-instructions'; readonly form: 'instructions'; readonly baseline?: true; readonly rule?: string; readonly digest: string }`. A baseline message has `baseline: true`; a path-scoped rule message has `rule` set to the rule's project-relative path.
  - Bundle row used in Task 9: `{ id: air-instruction-conventions, name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } }`.

- [ ] **Step 1: Write the test harness**

`air/packages/instruction-conventions/tests/harness.ts`:

```ts
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
```

This mirrors `stubAgent` in `packages/goal/command-goal/tests/command-goal.spec.ts`; if the `Agent` interface has gained a member since `dsh-v0.2.0-rc.2`, copy the addition from that file.

- [ ] **Step 2: Write the failing plugin tests**

`air/packages/instruction-conventions/tests/plugin.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as instructionConventions from '../src/index.ts'
import { loadClaudeRules } from '../src/rules.ts'
import { stubAgent } from './harness.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'air-instructions-'))
  created.push(base)
  await mkdir(join(base, '.git'))
  return base
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

// Test doubles follow the `defineTool` form verified in spike 01; each is written out so the
// parameter names stay literal types.
function registerTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Test double for read.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'File to read' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.resolve('done')
    },
  }))
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Test double for write that always fails.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'File to write' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.reject<string>(new Error('disk full'))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Test double for bash.',
    parameters: {
      command: { type: 'string', required: true, description: 'Command line' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      return Promise.resolve('done')
    },
  }))
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(instructionConventions, { maxBytes: 32768, claudeHome: '/air-test-no-such-home/.claude' })
  registerTools(ctx)
  return ctx
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function preStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
  options: { step?: number; decision?: PreStepDecision; signal?: AbortSignal } = {},
): Promise<PreStepDecision> {
  return ctx.waterfall(
    'agent/pre-step',
    { agent, messages, turn: 1, step: options.step ?? 1, signal: options.signal ?? new AbortController().signal },
    () => Promise.resolve<PreStepDecision>(options.decision ?? { kind: 'enter', messages }),
  )
}

function entered(decision: PreStepDecision): UserMessage[] {
  if (decision.kind !== 'enter') throw new Error('expected the step to enter')
  return decision.messages
}

let calls = 0
function run(ctx: Context, name: string, args: Record<string, string>, agent?: Agent) {
  calls += 1
  return ctx.tools.execute({
    name,
    arguments: args,
    callId: ToolCallId(`air-call-${calls}`),
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
}

describe('baseline injection on agent/pre-step', () => {
  it('adds one air-instructions message after the claimed prompt', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const first = prompt('hello')
    const messages = entered(await preStep(ctx, agent, [first]))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBe(first)
    expect(messages[1]?.source).toMatchObject({ kind: 'air-instructions', form: 'instructions', baseline: true })
    expect(messages[1]?.content).toEqual([{ type: 'text', text: expect.stringContaining('Project memory.') }])
  })

  it('does not repeat a baseline that the session already holds, and repeats it after the files change', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const [, baseline] = entered(await preStep(ctx, agent, [prompt('one')]))
    if (baseline === undefined) throw new Error('expected a baseline message')
    agent.session.append('user/message', baseline, { surfaceOp: 'append' })
    expect(entered(await preStep(ctx, agent, [prompt('two')]))).toHaveLength(1)
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory, revised.')
    const refreshed = entered(await preStep(ctx, agent, [prompt('three')]))
    expect(refreshed).toHaveLength(2)
    expect(refreshed[1]?.source).not.toEqual(baseline.source)
  })

  it('leaves the decision unchanged when there is nothing to add', async () => {
    const root = await project()
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const only = prompt('hello')
    expect(entered(await preStep(ctx, agent, [only]))).toEqual([only])
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    expect(await preStep(ctx, agent, [only], { decision: { kind: 'reject' } })).toEqual({ kind: 'reject' })
    expect(entered(await preStep(ctx, agent, [], { step: 1 }))).toEqual([])
    expect(entered(await preStep(ctx, agent, [], { step: 2 }))).toHaveLength(1)
    const { agent: detached } = stubAgent(ctx, undefined)
    expect(entered(await preStep(ctx, detached, [only]))).toEqual([only])
  })

  it('stops when the turn was cancelled while files were read', async () => {
    const root = await project()
    await write(join(root, '.claude/CLAUDE.md'), 'Project memory.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    const controller = new AbortController()
    controller.abort(new Error('turn cancelled'))
    await expect(preStep(ctx, agent, [prompt('hello')], { signal: controller.signal })).rejects.toThrow('turn cancelled')
  })

  it('keeps working when a rule file does not parse', async () => {
    const root = await project()
    await write(join(root, '.claude/rules/bad.md'), '---\npaths: [unclosed\n---\nBody')
    await write(join(root, '.claude/rules/good.md'), 'Be concise.')
    const ctx = await mount()
    const { agent } = stubAgent(ctx, root)
    expect(entered(await preStep(ctx, agent, [prompt('one')]))).toHaveLength(2)
    expect(entered(await preStep(ctx, agent, [prompt('two')]))).toHaveLength(2)
  })
})

describe('path-scoped rules on tools/post-execute', () => {
  async function scoped(): Promise<{ ctx: Context; root: string }> {
    const root = await project()
    await write(join(root, '.claude/rules/ts.md'), '---\npaths: "**/*.ts"\n---\nUse strict TypeScript.')
    return { ctx: await mount(), root }
  }

  it('attaches a matching rule once per session', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const first = await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)
    expect(first.isError).toBe(false)
    expect(first.additionalContexts).toHaveLength(1)
    const context = first.additionalContexts?.[0]
    expect(context?.source).toMatchObject({ kind: 'air-instructions', form: 'instructions', rule: '.claude/rules/ts.md' })
    expect(context?.content).toEqual([{
      type: 'text',
      text: '<air_rule path=".claude/rules/ts.md">\nUse strict TypeScript.\n</air_rule>',
    }])
    const second = await run(ctx, 'read', { file_path: join(root, 'src/b.ts') }, agent)
    expect(second.additionalContexts).toBeUndefined()
  })

  it('does not attach a rule the resumed session already holds', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const [rule] = (await loadClaudeRules(root)).rules
    if (rule === undefined) throw new Error('expected one rule')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'earlier rule text' }],
      source: { kind: 'air-instructions', form: 'instructions', rule: rule.relativePath, digest: rule.digest },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', prompt('unrelated'), { surfaceOp: 'append' })
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' }, agent)).additionalContexts).toBeUndefined()
  })

  it('attaches nothing for other tools, other files, failures, and calls without a workspace', async () => {
    const { ctx, root } = await scoped()
    const { agent } = stubAgent(ctx, root)
    const { agent: detached } = stubAgent(ctx, undefined)
    expect((await run(ctx, 'bash', { command: 'ls src/a.ts' }, agent)).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'README.md' }, agent)).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: '/etc/air-outside/a.ts' }, agent)).additionalContexts).toBeUndefined()
    const failed = await run(ctx, 'write', { file_path: 'src/a.ts' }, agent)
    expect(failed.isError).toBe(true)
    expect(failed.additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' })).additionalContexts).toBeUndefined()
    expect((await run(ctx, 'read', { file_path: 'src/a.ts' }, detached)).additionalContexts).toBeUndefined()
  })
})

describe('resolveConfig', () => {
  it('applies defaults and expands allowed import roots', () => {
    const resolved = instructionConventions.resolveConfig({ maxBytes: 100, claudeHome: '/c', allowedImportRoots: ['/shared'] })
    expect(resolved).toMatchObject({
      maxBytes: 100,
      claudeHome: '/c',
      includeUserRoots: false,
      allowedImportRoots: ['/shared'],
      projectRootMarkers: ['.git'],
    })
    expect(instructionConventions.resolveConfig({ maxBytes: 1, allowedImportRoots: ['~/notes'] }).allowedImportRoots[0]).toMatch(/notes$/u)
  })

  it('rejects invalid values', () => {
    expect(() => instructionConventions.resolveConfig({ maxBytes: 0 })).toThrow('maxBytes must be a positive integer')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, allowedImportRoots: ['relative/dir'] })).toThrow('must be an absolute path or start with ~/')
    expect(() => instructionConventions.resolveConfig({ maxBytes: 1, projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
```

- [ ] **Step 3: Run the plugin tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions exec vitest run tests/plugin.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 4: Implement the plugin**

`air/packages/instruction-conventions/src/index.ts`:

```ts
/**
 * Companion to upstream `agent-instructions`. It injects the convention files upstream does not read:
 * `.claude/CLAUDE.md`, the user's `~/.claude/CLAUDE.md` (opt-in), files reached through `@path`
 * imports, and `.claude/rules`. Rules without `paths:` enter with the baseline; rules with `paths:`
 * are attached to the result of the first `read`, `write`, or `edit` call on a matching file.
 * Every injected text is a user message with source kind `air-instructions`, so it is in the session log.
 *
 * @module @air/dsh-instruction-conventions
 */
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { expandHome, findProjectRoot, isInside, resolveUserHomes } from '@air/dsh-convention-core'
import { composeBaseline } from './baseline.ts'
import { loadClaudeRules, matchingRules, type Rule } from './rules.ts'

export const name = 'air-instruction-conventions'

/** Durable source of every message this plugin injects. */
export interface AirInstructionSource {
  readonly kind: 'air-instructions'
  /** The text is instructions read out of files. */
  readonly form: 'instructions'
  /** Present on the message that carries the baseline files. */
  readonly baseline?: true
  /** Project-relative path of the rule file, on a path-scoped rule message. */
  readonly rule?: string
  /** Identity of the injected text; a different digest means different text. */
  readonly digest: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Convention files injected by `@air/dsh-instruction-conventions`. */
    'air-instructions': AirInstructionSource
  }
}

/** Plugin configuration. */
export interface Config {
  /** UTF-8 byte budget for the baseline file blocks. Required. */
  maxBytes: number
  /** Claude Code home. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Whether `<claudeHome>/CLAUDE.md` is read and may import files under `claudeHome`. Defaults to false. */
  includeUserRoots?: boolean
  /** Directories outside the project whose files `@path` imports may read; absolute or starting with `~/`. */
  allowedImportRoots?: string[]
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
}

export const Config: Schema<Config> = Schema.object({
  maxBytes: Schema.number().required().description('UTF-8 byte budget for the baseline file blocks.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  includeUserRoots: Schema.boolean().default(false).description('Read ~/.claude/CLAUDE.md and allow imports under ~/.claude.'),
  allowedImportRoots: Schema.array(Schema.string()).default([]).description('Directories outside the project that @path imports may read.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly maxBytes: number
  readonly claudeHome: string
  readonly home: string
  readonly includeUserRoots: boolean
  readonly allowedImportRoots: readonly string[]
  readonly projectRootMarkers: readonly string[]
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!Number.isInteger(config.maxBytes) || config.maxBytes < 1) {
    throw new TypeError('air-instruction-conventions: maxBytes must be a positive integer')
  }
  const home = homedir()
  const allowedImportRoots = (config.allowedImportRoots ?? []).map(root => expandHome(root, home))
  for (const root of allowedImportRoots) {
    if (!isAbsolute(root)) {
      throw new TypeError(`air-instruction-conventions: allowedImportRoots entry "${root}" must be an absolute path or start with ~/`)
    }
  }
  const projectRootMarkers = config.projectRootMarkers ?? ['.git']
  if (projectRootMarkers.length === 0) {
    throw new TypeError('air-instruction-conventions: projectRootMarkers must not be empty')
  }
  return {
    maxBytes: config.maxBytes,
    claudeHome: resolveUserHomes(config).claudeHome,
    home,
    includeUserRoots: config.includeUserRoots ?? false,
    allowedImportRoots,
    projectRootMarkers,
  }
}

const FILE_TOOLS = new Set(['read', 'write', 'edit'])

function touchedPath(exec: ToolExecution): string | undefined {
  const args = exec.arguments
  if (FILE_TOOLS.has(exec.name) && typeof args === 'object' && args !== null && 'file_path' in args && typeof args.file_path === 'string') {
    return args.file_path
  }
  return undefined
}

function latestBaselineDigest(history: readonly Message[]): string | undefined {
  for (const message of history.toReversed()) {
    if (message.source.kind === 'air-instructions' && message.source.baseline === true) return message.source.digest
  }
  return undefined
}

function ruleKey(relativePath: string, digest: string): string {
  return `${relativePath}:${digest}`
}

/**
 * Register the baseline and path-scoped rule injection.
 * @param ctx - plugin context; in a preset its listeners receive only that preset's Agents.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const reported = new Set<string>()
  const delivered = new WeakMap<Agent['session'], Set<string>>()

  const report = (problems: readonly string[]): void => {
    for (const problem of problems) {
      if (reported.has(problem)) continue
      reported.add(problem)
      ctx.logger.warn(`air-instruction-conventions: ${problem}`)
    }
  }

  const deliveredRules = (session: Agent['session']): Set<string> => {
    let keys = delivered.get(session)
    if (keys === undefined) {
      keys = new Set()
      for (const message of session.deriveMessages()) {
        if (message.source.kind === 'air-instructions' && message.source.rule !== undefined) {
          keys.add(ruleKey(message.source.rule, message.source.digest))
        }
      }
      delivered.set(session, keys)
    }
    return keys
  }

  const ruleMessage = (rule: Rule) => {
    const source: AirInstructionSource = { kind: 'air-instructions', form: 'instructions', rule: rule.relativePath, digest: rule.digest }
    return createUserMessage({
      content: [{ type: 'text', text: `<air_rule path="${rule.relativePath}">\n${rule.content}\n</air_rule>` }],
      source,
    })
  }

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    // An empty first step owns a no-step turn; adding context would turn it into a request.
    if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const { baseline, problems } = await composeBaseline({
      cwd,
      projectRoot,
      claudeHome: resolved.claudeHome,
      home: resolved.home,
      includeUserRoots: resolved.includeUserRoots,
      allowedImportRoots: resolved.allowedImportRoots,
      maxBytes: resolved.maxBytes,
    })
    signal.throwIfAborted()
    report(problems)
    if (baseline === undefined) return decision
    if (latestBaselineDigest([...agent.session.deriveMessages(), ...decision.messages]) === baseline.digest) return decision
    const source: AirInstructionSource = { kind: 'air-instructions', form: 'instructions', baseline: true, digest: baseline.digest }
    const message = createUserMessage({ content: [{ type: 'text', text: baseline.text }], source })
    // Place the context right after the messages the step claimed, before context other listeners appended.
    const lastClaimed = decision.messages.findLastIndex(entry => messages.includes(entry))
    return { ...decision, messages: decision.messages.toSpliced(lastClaimed + 1, 0, message) }
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const agent = exec.agent
    const filePath = touchedPath(exec)
    if (result.isError || agent === undefined || filePath === undefined || decision.kind !== 'accept') return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const absolute = resolve(cwd, filePath)
    if (!isInside(projectRoot, absolute)) return decision
    const ruleSet = await loadClaudeRules(projectRoot)
    report(ruleSet.problems)
    const keys = deliveredRules(agent.session)
    const fresh = matchingRules(ruleSet.rules, relative(projectRoot, absolute).split(sep).join('/'))
      .filter(rule => !keys.has(ruleKey(rule.relativePath, rule.digest)))
    if (fresh.length === 0) return decision
    for (const rule of fresh) keys.add(ruleKey(rule.relativePath, rule.digest))
    return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], ...fresh.map(ruleMessage)] }
  })
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions exec vitest run tests/imports.spec.ts tests/rules.spec.ts tests/baseline.spec.ts tests/plugin.spec.ts`
Expected: `Test Files 4 passed (4)`.

Two places depend on upstream runtime details; if a test fails there, check these first:
- `ctx.tools.execute` reaching `tools/post-execute` for the test-double tools: `packages/core/tools/tests/tools.spec.ts` shows the accepted `execute` input and `defineTool` fields.
- `session.append('user/message', message, { surfaceOp: 'append' })`: `packages/api/session-controller/tests/controller.host.spec.ts` L103 uses the same call.

- [ ] **Step 6: Write the native Loader test**

`air/packages/instruction-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-instruction-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude'), { recursive: true })
  await writeFile(join(project, '.claude', 'CLAUDE.md'), 'Loader project memory. @notes.md')
  await writeFile(join(project, '.claude', 'notes.md'), 'Imported notes.')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    '- id: air-instruction-conventions',
    "  name: '@air/dsh-instruction-conventions'",
    '  config:',
    '    maxBytes: 4096',
    `    claudeHome: ${JSON.stringify(join(root, 'home', '.claude'))}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent } = stubAgent(context, project)
  const first = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  const decision = await context.waterfall(
    'agent/pre-step',
    { agent, messages: [first], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [first] }),
  )
  if (decision.kind !== 'enter') throw new Error('expected the step to enter')
  expect(decision.messages).toHaveLength(2)
  expect(decision.messages[1]?.source).toMatchObject({ kind: 'air-instructions', baseline: true })
  const [block] = decision.messages[1]?.content ?? []
  expect(block).toMatchObject({ type: 'text', text: expect.stringContaining('Imported notes.') })
})
```

- [ ] **Step 7: Build, then run the whole suite with coverage**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions build && pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 5 passed (5)`; `baseline.ts`, `imports.ts`, `index.ts`, `rules.ts` at 100 in every column.

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/instruction-conventions typecheck && pnpm -C /home/hxman/AIR-harness/air run lint`
Expected: exit 0 for both.

- [ ] **Step 8: Write the README**

`air/packages/instruction-conventions/README.md`:

```markdown
# @air/dsh-instruction-conventions

## Summary

A companion to upstream `agent-instructions`, mounted in the same agent preset. Upstream keeps loading `AGENTS.md` and `CLAUDE.md` chains; this plugin adds what upstream does not interpret:

| Input | When it is injected |
|---|---|
| `<project>/.claude/CLAUDE.md` | baseline |
| `<claudeHome>/CLAUDE.md` | baseline, only with `includeUserRoots: true` |
| `@path` imports found in the two files above and in `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` between the project root and the cwd | baseline |
| `.claude/rules/**/*.md` without `paths:` | baseline |
| `.claude/rules/**/*.md` with `paths:` | after the first successful `read`, `write`, or `edit` on a matching file |

Imports follow Claude Code semantics: at most 4 hops, each file once, code spans and fenced blocks ignored, relative paths resolved against the importing file. An import outside the project root is read only when its path is under an `allowedImportRoots` entry (or under `claudeHome` with `includeUserRoots`); otherwise the baseline names it in a `<skipped reason="outside-project"/>` line.

The baseline is one user message with source `{ kind: 'air-instructions', form: 'instructions', baseline: true, digest }`, added on `agent/pre-step` after the messages the step claimed. It is added again only when the digest of the assembled text differs from the latest baseline in the session, which also covers resume and compaction. A path-scoped rule is a user message with source `{ kind: 'air-instructions', form: 'instructions', rule, digest }`, returned as `additionalContexts` from `tools/post-execute`, once per session and rule content.

Config: `maxBytes` (required; the AIR bundle sets 32768), `claudeHome`, `includeUserRoots` (default `false`), `allowedImportRoots` (default `[]`), `projectRootMarkers` (default `['.git']`).

## Model Experience

Before its first request the model receives an `<air_instructions>` block listing each file as `<file path="...">` with its text, followed by `<skipped .../>` lines for imports that were not read. After touching a file that matches a rule's `paths:` globs, the model receives `<air_rule path=".claude/rules/...">` with the rule text along with that tool result.

## Known Limitations

- `.cursor/rules/*.mdc` and `.kiro/steering/*.md` are not read yet.
- Outside-project imports use an allowlist, not an approval prompt.
- The files upstream injects (`AGENTS.md`, `CLAUDE.md` and their local variants) keep their `@path` text; the imported content arrives in the separate `<air_instructions>` block.
- Identical text is removed only inside this plugin's block. A file that upstream also injects under another path can appear twice.
- A file larger than the remaining `maxBytes` budget is left out whole and named in a `<skipped reason="budget"/>` line.
- Convention files are re-read on every step; a changed file causes a new baseline message, which invalidates the provider's prompt cache from that point.
- Files are read from the host filesystem, not through `ctx.fs`. Containment compares normalised paths and does not resolve symbolic links.
```

- [ ] **Step 9: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/packages/instruction-conventions
git commit -m "feat(air): inject .claude/CLAUDE.md, imports, and rules as air-instructions messages"
```

---

### Task 6: `@air/dsh-mcp-conventions` — `.mcp.json` parser and approvals file

**Files:**
- Create: `air/packages/mcp-conventions/package.json`
- Create: `air/packages/mcp-conventions/tsconfig.build.json`
- Create: `air/packages/mcp-conventions/tsconfig.json`
- Create: `air/packages/mcp-conventions/tsdown.config.ts`
- Create: `air/packages/mcp-conventions/vitest.config.ts`
- Create: `air/packages/mcp-conventions/src/config.ts`
- Create: `air/packages/mcp-conventions/src/approvals.ts`
- Test: `air/packages/mcp-conventions/tests/config.spec.ts`
- Test: `air/packages/mcp-conventions/tests/approvals.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `isRecord`, `readTextFile`. From upstream: `Branded<B>` (`@deepseek-ai/dsh-brand`).
- Produces (package-internal modules used by Task 7):
  - `config.ts`:
    - `type ServerSpec = { readonly transport: 'stdio'; readonly serverName: string; readonly command: string; readonly args: string[]; readonly env: Record<string, string>; readonly cwd: string } | { readonly transport: 'streamable-http'; readonly serverName: string; readonly url: string; readonly headers: Record<string, string> }`
    - `interface ParseOptions { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }`
    - `expandEnv(value: string, env: Readonly<Record<string, string | undefined>>): string` (`${VAR}` and `${VAR:-default}`; throws when a variable without a default is unset)
    - `parseMcpJson(text: string, options: ParseOptions): { servers: ServerSpec[]; problems: string[] }`
  - `approvals.ts`:
    - `type McpApprovalKey = Branded<'McpApprovalKey'>`
    - `approvalKey(projectRoot: string, spec: ServerSpec): McpApprovalKey` (SHA-256 over project root, name, transport, command or URL, arguments, and sorted env or header entries)
    - `interface ApprovalRecord { readonly projectRoot: string; readonly server: string; readonly approvedAt: string }`
    - `class ApprovalStore { constructor(file: string); has(key: McpApprovalKey): Promise<boolean>; add(key: McpApprovalKey, record: ApprovalRecord): Promise<void>; remove(key: McpApprovalKey): Promise<void> }`
    - File format: `{ "version": 1, "approved": { "<key>": ApprovalRecord } }`, mode `0600`.

- [ ] **Step 1: Create the package scaffold**

`air/packages/mcp-conventions/package.json`:

```json
{
  "name": "@air/dsh-mcp-conventions",
  "description": "Imports project .mcp.json servers as approved per-Agent MCP clients",
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
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-agent": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-brand": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-commands": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-home-paths": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-mcp-client": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-scope": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-agent-loop-testkit": "link:../../../packages/test-support/agent-loop-testkit",
    "@deepseek-ai/dsh-brand": "link:../../../packages/util/brand",
    "@deepseek-ai/dsh-commands": "link:../../../packages/interaction/commands",
    "@deepseek-ai/dsh-home-paths": "link:../../../packages/util/home-paths",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-mcp-client": "link:../../../packages/mcp/mcp-client",
    "@deepseek-ai/dsh-scope": "link:../../../packages/core/scope",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session",
    "@deepseek-ai/dsh-system-prompt": "link:../../../packages/core/system-prompt",
    "@deepseek-ai/dsh-tools": "link:../../../packages/core/tools"
  }
}
```

`air/packages/mcp-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/mcp-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/mcp-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
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

`air/packages/mcp-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C /home/hxman/AIR-harness/air install`
Expected: exit 0; `air/packages/mcp-conventions/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js` exists.

- [ ] **Step 2: Write the failing tests**

`air/packages/mcp-conventions/tests/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { expandEnv, parseMcpJson } from '../src/config.ts'

const options = { cwd: '/work/project', env: { TOKEN: 'secret', HOST: 'example.test' } }

describe('expandEnv', () => {
  it('substitutes set variables and defaults', () => {
    expect(expandEnv('Bearer ${TOKEN}', options.env)).toBe('Bearer secret')
    expect(expandEnv('${MISSING:-fallback}/${HOST:-unused}', options.env)).toBe('fallback/example.test')
    expect(expandEnv('${MISSING:-}', options.env)).toBe('')
    expect(expandEnv('no variables', options.env)).toBe('no variables')
  })

  it('throws for an unset variable without a default', () => {
    expect(() => expandEnv('${MISSING}', options.env)).toThrow('environment variable MISSING is not set')
  })
})

describe('parseMcpJson', () => {
  it('parses stdio and http servers', () => {
    const text = JSON.stringify({
      mcpServers: {
        files: { command: 'npx', args: ['-y', 'server-files', '${HOST}'], env: { API_TOKEN: '${TOKEN}' } },
        bare: { type: 'stdio', command: 'my-server' },
        remote: { type: 'http', url: 'https://${HOST}/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
        inferred: { url: 'https://example.test/other' },
        named: { type: 'streamable-http', url: 'https://example.test/third' },
      },
    })
    expect(parseMcpJson(text, options)).toEqual({
      servers: [
        { transport: 'stdio', serverName: 'files', command: 'npx', args: ['-y', 'server-files', 'example.test'], env: { API_TOKEN: 'secret' }, cwd: '/work/project' },
        { transport: 'stdio', serverName: 'bare', command: 'my-server', args: [], env: {}, cwd: '/work/project' },
        { transport: 'streamable-http', serverName: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' } },
        { transport: 'streamable-http', serverName: 'inferred', url: 'https://example.test/other', headers: {} },
        { transport: 'streamable-http', serverName: 'named', url: 'https://example.test/third', headers: {} },
      ],
      problems: [],
    })
  })

  it('reports each invalid server and keeps the valid ones', () => {
    const text = JSON.stringify({
      mcpServers: {
        ok: { command: 'server' },
        'bad name!': { command: 'server' },
        legacy: { type: 'sse', url: 'https://example.test/sse' },
        scalar: 'npx server',
        nocommand: { type: 'stdio' },
        nourl: { type: 'http' },
        badargs: { command: 'server', args: 'one two' },
        badenv: { command: 'server', env: { PORT: 8080 } },
        badheaders: { url: 'https://example.test', headers: ['a'] },
        unset: { command: '${NOT_SET}' },
      },
    })
    const { servers, problems } = parseMcpJson(text, options)
    expect(servers.map(server => server.serverName)).toEqual(['ok'])
    expect(problems).toEqual([
      'bad name!: server name must match [A-Za-z0-9_-]{1,32}',
      'legacy: transport type "sse" is not supported; use stdio or http',
      'scalar: server entry must be an object',
      'nocommand: a stdio server requires a "command" string',
      'nourl: an http server requires a "url" string',
      'badargs: "args" must be a list of strings',
      'badenv: "env.PORT" must be a string',
      'badheaders: "headers" must be an object of strings',
      'unset: environment variable NOT_SET is not set',
    ])
  })

  it('reports an unreadable document', () => {
    expect(parseMcpJson('{ not json', options).problems[0]).toMatch(/^\.mcp\.json is not valid JSON: /u)
    expect(parseMcpJson('[]', options)).toEqual({ servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] })
    expect(parseMcpJson('{"mcpServers": []}', options)).toEqual({ servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] })
  })
})
```

`air/packages/mcp-conventions/tests/approvals.spec.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import type { ServerSpec } from '../src/config.ts'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function approvalsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'air-approvals-'))
  created.push(dir)
  return join(dir, 'nested', 'mcp-approvals.json')
}

const stdio: ServerSpec = { transport: 'stdio', serverName: 'files', command: 'npx', args: ['server'], env: { B: '2', A: '1' }, cwd: '/p' }
const http: ServerSpec = { transport: 'streamable-http', serverName: 'remote', url: 'https://example.test/mcp', headers: { Z: '1', A: '2' } }

describe('approvalKey', () => {
  it('is a stable SHA-256 that ignores env and header order and the cwd', () => {
    const key = approvalKey('/p', stdio)
    expect(key).toMatch(/^[0-9a-f]{64}$/u)
    expect(approvalKey('/p', { ...stdio, env: { A: '1', B: '2' }, cwd: '/p/sub' })).toBe(key)
    expect(approvalKey('/p', { ...http, headers: { A: '2', Z: '1' } })).toBe(approvalKey('/p', http))
  })

  it('changes with the project, command, arguments, env values, URL, and headers', () => {
    const key = approvalKey('/p', stdio)
    expect(approvalKey('/q', stdio)).not.toBe(key)
    expect(approvalKey('/p', { ...stdio, command: 'node' })).not.toBe(key)
    expect(approvalKey('/p', { ...stdio, args: ['server', '--unsafe'] })).not.toBe(key)
    expect(approvalKey('/p', { ...stdio, env: { A: '1', B: '3' } })).not.toBe(key)
    expect(approvalKey('/p', { ...http, url: 'https://evil.test/mcp' })).not.toBe(approvalKey('/p', http))
    expect(approvalKey('/p', { ...http, headers: {} })).not.toBe(approvalKey('/p', http))
  })
})

describe('ApprovalStore', () => {
  it('records and removes approvals in a private file', async () => {
    const file = await approvalsFile()
    const store = new ApprovalStore(file)
    const key = approvalKey('/p', stdio)
    const other = approvalKey('/p', http)
    expect(await store.has(key)).toBe(false)
    await store.add(key, { projectRoot: '/p', server: 'files', approvedAt: '2026-10-01T00:00:00.000Z' })
    await store.add(other, { projectRoot: '/p', server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' })
    expect(await store.has(key)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      approved: {
        [key]: { projectRoot: '/p', server: 'files', approvedAt: '2026-10-01T00:00:00.000Z' },
        [other]: { projectRoot: '/p', server: 'remote', approvedAt: '2026-10-01T00:00:01.000Z' },
      },
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await store.remove(key)
    expect(await store.has(key)).toBe(false)
    expect(await new ApprovalStore(file).has(other)).toBe(true)
  })

  it('fails loud on a file that is not an approvals file', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'air-approvals-')), 'mcp-approvals.json')
    created.push(join(file, '..'))
    const store = new ApprovalStore(file)
    await writeFile(file, '{ truncated')
    await expect(store.has(approvalKey('/p', stdio))).rejects.toThrow()
    await writeFile(file, '{"version": 1, "approved": []}')
    await expect(store.has(approvalKey('/p', stdio))).rejects.toThrow('is not an approvals file')
    await writeFile(file, '[]')
    await expect(store.has(approvalKey('/p', stdio))).rejects.toThrow('is not an approvals file')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions test`
Expected: FAIL with `Failed to load url ../src/config.ts` and `Failed to load url ../src/approvals.ts`.

- [ ] **Step 4: Implement the modules**

`air/packages/mcp-conventions/src/config.ts`:

```ts
/** Parses Claude Code project `.mcp.json` files into MCP client specifications. */
import { isRecord } from '@air/dsh-convention-core'

/** One server to connect, with every `${VAR}` already expanded. */
export type ServerSpec =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: string[]
    readonly env: Record<string, string>
    /** Working directory of the server process: the session cwd. */
    readonly cwd: string
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Record<string, string>
  }

/** Values that are not part of the file. */
export interface ParseOptions {
  /** Session working directory, used as the cwd of stdio servers. */
  readonly cwd: string
  /** Environment read by `${VAR}` expansion. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Same grammar upstream `mcp-client` accepts for `serverName`. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu

/**
 * Expand `${VAR}` and `${VAR:-default}`.
 * @param value - text from the file.
 * @param env - environment mapping.
 * @returns the expanded text.
 * @throws when a variable without a default is unset.
 */
export function expandEnv(value: string, env: Readonly<Record<string, string | undefined>>): string {
  return value.replace(VARIABLE, (_match: string, variable: string, fallback: string | undefined) => {
    const resolved = env[variable] ?? fallback
    if (resolved === undefined) throw new Error(`environment variable ${variable} is not set`)
    return resolved
  })
}

function stringList(value: unknown, field: string, options: ParseOptions): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`"${field}" must be a list of strings`)
  }
  return value.map(item => expandEnv(item, options.env))
}

function stringMap(value: unknown, field: string, options: ParseOptions): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`"${field}" must be an object of strings`)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`"${field}.${key}" must be a string`)
    result[key] = expandEnv(item, options.env)
  }
  return result
}

function parseServer(serverName: string, raw: unknown, options: ParseOptions): ServerSpec {
  if (!SERVER_NAME.test(serverName)) throw new Error('server name must match [A-Za-z0-9_-]{1,32}')
  if (!isRecord(raw)) throw new Error('server entry must be an object')
  const url = raw['url']
  const command = raw['command']
  const type = raw['type'] ?? (typeof url === 'string' ? 'http' : 'stdio')
  if (type === 'stdio') {
    if (typeof command !== 'string') throw new Error('a stdio server requires a "command" string')
    return {
      transport: 'stdio',
      serverName,
      command: expandEnv(command, options.env),
      args: stringList(raw['args'], 'args', options),
      env: stringMap(raw['env'], 'env', options),
      cwd: options.cwd,
    }
  }
  if (type === 'http' || type === 'streamable-http') {
    if (typeof url !== 'string') throw new Error('an http server requires a "url" string')
    return {
      transport: 'streamable-http',
      serverName,
      url: expandEnv(url, options.env),
      headers: stringMap(raw['headers'], 'headers', options),
    }
  }
  throw new Error(`transport type ${JSON.stringify(type)} is not supported; use stdio or http`)
}

/**
 * Parse a `.mcp.json` document.
 * @param text - file content.
 * @param options - session cwd and environment.
 * @returns valid servers in file order, and one problem line per rejected entry or document error.
 */
export function parseMcpJson(text: string, options: ParseOptions): { servers: ServerSpec[]; problems: string[] } {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error: unknown) {
    return { servers: [], problems: [`.mcp.json is not valid JSON: ${(error as Error).message}`] }
  }
  const table = isRecord(document) ? document['mcpServers'] : undefined
  if (!isRecord(table)) return { servers: [], problems: ['.mcp.json must contain an "mcpServers" object'] }
  const servers: ServerSpec[] = []
  const problems: string[] = []
  for (const [serverName, raw] of Object.entries(table)) {
    try {
      servers.push(parseServer(serverName, raw, options))
    } catch (error: unknown) {
      problems.push(`${serverName}: ${(error as Error).message}`)
    }
  }
  return { servers, problems }
}
```

`air/packages/mcp-conventions/src/approvals.ts`:

```ts
/** The consent record for project MCP servers: which exact server definitions a person approved. */
import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isRecord, readTextFile } from '@air/dsh-convention-core'
import type { ServerSpec } from './config.ts'

/** Identity of one approved server definition in one project. */
export type McpApprovalKey = Branded<'McpApprovalKey'>

function sortedEntries(map: Record<string, string>): [string, string][] {
  return Object.entries(map).sort(([left], [right]) => {
    if (left === right) return 0
    return left < right ? -1 : 1
  })
}

/**
 * Compute the approval identity of a server. Any change to the project root, name, command, URL,
 * arguments, env values, or headers produces a different key, so a changed definition needs a new approval.
 * @param projectRoot - absolute project root that holds the `.mcp.json`.
 * @param spec - parsed server with variables expanded.
 * @returns a 64-digit hex SHA-256.
 */
export function approvalKey(projectRoot: string, spec: ServerSpec): McpApprovalKey {
  const canonical = spec.transport === 'stdio'
    ? [projectRoot, spec.serverName, 'stdio', spec.command, spec.args, sortedEntries(spec.env)]
    : [projectRoot, spec.serverName, 'streamable-http', spec.url, sortedEntries(spec.headers)]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex') as McpApprovalKey
}

/** What is stored beside a key so a person can read the file. */
export interface ApprovalRecord {
  readonly projectRoot: string
  readonly server: string
  /** ISO 8601 timestamp. */
  readonly approvedAt: string
}

/** Reads and rewrites the approvals file. Every call re-reads the file, so edits by another process are seen. */
export class ApprovalStore {
  /** @param file - absolute path of the approvals file; it is created on the first approval. */
  constructor(private readonly file: string) {}

  /**
   * Test whether a key is approved.
   * @param key - approval identity.
   * @returns true when the file lists the key.
   * @throws when the file exists but is not an approvals file.
   */
  async has(key: McpApprovalKey): Promise<boolean> {
    return Object.hasOwn(await this.read(), key)
  }

  /**
   * Record an approval.
   * @param key - approval identity.
   * @param record - readable description stored with the key.
   */
  async add(key: McpApprovalKey, record: ApprovalRecord): Promise<void> {
    await this.write({ ...await this.read(), [key]: record })
  }

  /**
   * Remove an approval.
   * @param key - approval identity.
   */
  async remove(key: McpApprovalKey): Promise<void> {
    const approved = await this.read()
    await this.write(Object.fromEntries(Object.entries(approved).filter(([existing]) => existing !== key)))
  }

  private async read(): Promise<Record<string, unknown>> {
    const text = await readTextFile(this.file)
    if (text === undefined) return {}
    const document: unknown = JSON.parse(text)
    const approved = isRecord(document) ? document['approved'] : undefined
    if (!isRecord(approved)) throw new Error(`air-mcp-conventions: ${this.file} is not an approvals file`)
    return approved
  }

  private async write(approved: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 1, approved }, undefined, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions test`
Expected: `Test Files 2 passed (2)`.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions typecheck`
Expected: exit 0.

```bash
cd /home/hxman/AIR-harness
git add air/packages/mcp-conventions air/pnpm-lock.yaml
git commit -m "feat(air): parse .mcp.json and record per-project MCP server approvals"
```

---

### Task 7: `@air/dsh-mcp-conventions` — per-Agent mounts, `/mcp` command, Loader test, README

**Files:**
- Create: `air/packages/mcp-conventions/src/index.ts`
- Create: `air/packages/mcp-conventions/tests/harness.ts`
- Create: `air/packages/mcp-conventions/tests/fixtures/echo-server.mjs`
- Create: `air/packages/mcp-conventions/README.md`
- Test: `air/packages/mcp-conventions/tests/plugin.spec.ts`
- Test: `air/packages/mcp-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from Task 6: `parseMcpJson`, `ServerSpec`, `ApprovalStore`, `approvalKey`.
- Consumes from upstream: `ctx.on('agent/created', ({ agent }) => Promise<undefined>)` (serial; awaited before the Agent's queued input runs); `ctx.on('agent/disposed', ({ agent }) => void)`; `createScope(ctx, agent): Scope` with `scope.ctx.plugin(...)` and `scope.dispose(): Promise<void>`; `import * as McpClient from '@deepseek-ai/dsh-mcp-client'` with `McpClient.Config(input)`; `ctx.commands.register(definition): () => void`; `dshHomePath(...segments): string`.
- Produces:
  - Cordis plugin module `@air/dsh-mcp-conventions`: `name = 'air-mcp-conventions'`, `inject = ['agents', 'tools', 'commands']`, `Config`, `apply(ctx, config)`.
  - `interface Config { approvalsFile?: string; startupTimeoutMs?: number; toolCallTimeoutMs?: number; projectRootMarkers?: string[] }` with defaults `dshHomePath('air', 'mcp-approvals.json')`, `15000`, `60000`, `['.git']`.
  - `resolveConfig(config: Config): ResolvedConfig`.
  - Global command `/mcp`: no input lists servers; `approve <server>` records approval and starts the server for the calling Agent; `revoke <server>` removes approval and stops it.
  - Model-facing tools `mcp__<server>__<tool>` registered in the Agent's scope by upstream `mcp-client`.
  - Bundle row used in Task 9: `{ id: air-mcp-conventions, name: '@air/dsh-mcp-conventions' }`.

- [ ] **Step 1: Write the harness and the fixture server**

`air/packages/mcp-conventions/tests/harness.ts`:

```ts
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
```

`air/packages/mcp-conventions/tests/fixtures/echo-server.mjs`:

```js
/** Line-delimited JSON-RPC MCP server over stdio with one tool, `echo`. */
import { createInterface } from 'node:readline'

const reply = (id, body) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`)

process.stdin.once('end', () => process.exit(0))

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  // Notifications carry no id and need no reply.
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize':
      reply(request.id, {
        result: {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'air-echo', version: '1' },
        },
      })
      break
    case 'tools/list':
      reply(request.id, {
        result: {
          tools: [{
            name: 'echo',
            description: 'Return the text argument.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          }],
        },
      })
      break
    case 'tools/call':
      reply(request.id, { result: { content: [{ type: 'text', text: `echo: ${request.params.arguments.text}` }] } })
      break
    default:
      reply(request.id, { error: { code: -32601, message: 'Method not found' } })
  }
})
```

The reply to unknown methods matters: the upstream client first probes `server/discover` and falls back to `initialize` on error `-32601`, as `packages/mcp/mcp-client/tests/fixtures/negotiation-lifecycle.mjs` shows.

- [ ] **Step 2: Write the failing plugin tests**

`air/packages/mcp-conventions/tests/plugin.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpConventions from '../src/index.ts'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { stubAgent } from './harness.ts'

const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  approvalsFile: string
}

async function world(mcpJson?: unknown): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-mcp-'))
  created.push(base)
  const root = join(base, 'project')
  await mkdir(join(root, '.git'), { recursive: true })
  if (mcpJson !== undefined) {
    await writeFile(join(root, '.mcp.json'), typeof mcpJson === 'string' ? mcpJson : JSON.stringify(mcpJson))
  }
  return { root, approvalsFile: join(base, 'state', 'mcp-approvals.json') }
}

const demo = { mcpServers: { demo: { command: process.execPath, args: [echoServer] } } }

async function mount(approvalsFile: string, startupTimeoutMs = 15_000) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(mcpConventions, { approvalsFile, startupTimeoutMs })
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined): Promise<Agent> {
  const { agent } = stubAgent(ctx, cwd)
  await ctx.agents.register(agent)
  return agent
}

async function command(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
  return execution.result
}

function toolNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name)
}

async function approveInFile(approvalsFile: string, root: string, mcpJson: unknown): Promise<void> {
  const { servers } = parseMcpJson(JSON.stringify(mcpJson), { cwd: root, env: process.env })
  for (const spec of servers) {
    await new ApprovalStore(approvalsFile).add(approvalKey(root, spec), {
      projectRoot: root,
      server: spec.serverName,
      approvedAt: '2026-10-01T00:00:00.000Z',
    })
  }
}

describe('air-mcp-conventions', () => {
  it('does not start a project server that nobody approved', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.kind).toBe('success')
    expect(listed.text).toContain(`demo (stdio: ${process.execPath} ${echoServer}): not approved`)
    expect(listed.text).toContain('/mcp approve <server>')
  })

  it('approves, starts, and revokes a server for the calling Agent', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: 'Approved and started "demo".' })
    expect(toolNames(ctx, agent)).toEqual(['mcp__demo__echo'])
    const result = await ctx.tools.execute({
      name: 'mcp__demo__echo',
      arguments: { text: 'hi' },
      callId: ToolCallId('air-mcp-call'),
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('echo: hi')
    expect((await command(ctx, agent, '/mcp')).text).toContain('): running')
    expect(await command(ctx, agent, '/mcp approve demo')).toEqual({ kind: 'success', text: '"demo" is already running.' })

    const second = await live(ctx, root)
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])

    expect(await command(ctx, agent, '/mcp revoke demo')).toEqual({
      kind: 'success',
      text: 'Revoked "demo"; its tools are removed from this session.',
    })
    expect(toolNames(ctx, agent)).toEqual([])
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
    expect((await command(ctx, agent, '/mcp')).text).toContain('): not approved')
    expect((await command(ctx, agent, '/mcp revoke demo')).kind).toBe('success')
  })

  it('stops servers when the Agent is disposed and when the plugin unloads', async () => {
    const { root, approvalsFile } = await world(demo)
    await approveInFile(approvalsFile, root, demo)
    const { ctx, fiber } = await mount(approvalsFile)
    const first = await live(ctx, root)
    const second = await live(ctx, root)
    const detached = await live(ctx, undefined)
    expect(toolNames(ctx, first)).toEqual(['mcp__demo__echo'])
    ctx.emit('agent/disposed', { agent: first })
    ctx.emit('agent/disposed', { agent: detached })
    await vi.waitFor(() => { expect(toolNames(ctx, first)).toEqual([]) }, { timeout: 5000 })
    expect(toolNames(ctx, second)).toEqual(['mcp__demo__echo'])
    await fiber.dispose()
    expect(toolNames(ctx, second)).toEqual([])
  })

  it('reports a server that fails to start, times out, or is unreachable', async () => {
    const servers = {
      mcpServers: {
        exits: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
        silent: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
        remote: { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      },
    }
    const { root, approvalsFile } = await world(servers)
    const { ctx } = await mount(approvalsFile, 500)
    const agent = await live(ctx, root)
    const exits = await command(ctx, agent, '/mcp approve exits')
    expect(exits.kind).toBe('error')
    expect(exits.text).toContain('Approved "exits", but it did not start: ')
    const silent = await command(ctx, agent, '/mcp approve silent')
    expect(silent).toEqual({ kind: 'error', text: 'Approved "silent", but it did not start: did not start within 500 ms' })
    expect((await command(ctx, agent, '/mcp approve remote')).kind).toBe('error')
    expect(toolNames(ctx, agent)).toEqual([])
    const listed = await command(ctx, agent, '/mcp')
    expect(listed.text).toContain('): approved, not running')
    expect(listed.text).toContain('remote (streamable-http: http://127.0.0.1:1/mcp)')

    const next = await live(ctx, root)
    expect(toolNames(ctx, next)).toEqual([])
  })

  it('lists problems and projects without servers', async () => {
    const broken = await world('{ not json')
    const first = await mount(broken.approvalsFile)
    const agent = await live(first.ctx, broken.root)
    expect((await command(first.ctx, agent, '/mcp')).text).toMatch(/Problem: \.mcp\.json is not valid JSON/u)

    const empty = await world()
    const second = await mount(empty.approvalsFile)
    const other = await live(second.ctx, empty.root)
    expect((await command(second.ctx, other, '/mcp')).text).toContain(`No servers are declared in ${join(empty.root, '.mcp.json')}.`)
  })

  it('rejects unknown input and sessions without a working directory', async () => {
    const { root, approvalsFile } = await world(demo)
    const { ctx } = await mount(approvalsFile)
    const agent = await live(ctx, root)
    const usage = 'Usage: /mcp [approve <server> | revoke <server>]'
    expect(await command(ctx, agent, '/mcp start demo')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve demo extra')).toEqual({ kind: 'error', text: usage })
    expect(await command(ctx, agent, '/mcp approve other')).toEqual({
      kind: 'error',
      text: `No server named "other" is declared in ${join(root, '.mcp.json')}. ${usage}`,
    })
    const detached = await live(ctx, undefined)
    expect(await command(ctx, detached, '/mcp')).toEqual({
      kind: 'error',
      text: 'This session has no working directory, so no .mcp.json was read.',
    })
  })
})

describe('resolveConfig', () => {
  it('applies defaults under the harness home', () => {
    const resolved = mcpConventions.resolveConfig({})
    expect(resolved.approvalsFile.endsWith(join('air', 'mcp-approvals.json'))).toBe(true)
    expect(resolved).toMatchObject({ startupTimeoutMs: 15000, toolCallTimeoutMs: 60000, projectRootMarkers: ['.git'] })
  })

  it('rejects invalid values', () => {
    expect(() => mcpConventions.resolveConfig({ startupTimeoutMs: 0 })).toThrow('startupTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ toolCallTimeoutMs: 1.5 })).toThrow('toolCallTimeoutMs must be a positive integer')
    expect(() => mcpConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
```

- [ ] **Step 3: Run the plugin tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions exec vitest run tests/plugin.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 4: Implement the plugin**

`air/packages/mcp-conventions/src/index.ts`:

```ts
/**
 * Imports Claude Code project `.mcp.json` files. For every Agent it reads `<project>/.mcp.json`,
 * and for each server a person approved it mounts one upstream `mcp-client` in that Agent's scope,
 * so the server's tools exist before the Agent's first request and disappear with the Agent.
 * Approvals are stored in an AIR-owned file, keyed by project and exact server definition.
 *
 * @module @air/dsh-mcp-conventions
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'
import { findProjectRoot, readTextFile } from '@air/dsh-convention-core'
import { ApprovalStore, approvalKey } from './approvals.ts'
import { parseMcpJson, type ServerSpec } from './config.ts'

export const name = 'air-mcp-conventions'
export const inject = ['agents', 'tools', 'commands']

const USAGE = 'Usage: /mcp [approve <server> | revoke <server>]'

/** Plugin configuration. */
export interface Config {
  /** Approvals file. Defaults to `<DSH_HOME>/air/mcp-approvals.json`. */
  approvalsFile?: string
  /** Milliseconds a server may take to connect and list its tools before it is abandoned. Defaults to 15000. */
  startupTimeoutMs?: number
  /** Milliseconds allowed per tool call or resource request. Defaults to 60000. */
  toolCallTimeoutMs?: number
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
}

export const Config: Schema<Config> = Schema.object({
  approvalsFile: Schema.string().description('Approvals file; defaults to <DSH_HOME>/air/mcp-approvals.json.'),
  startupTimeoutMs: Schema.number().default(15000).description('Milliseconds a server may take to start.'),
  toolCallTimeoutMs: Schema.number().default(60000).description('Milliseconds allowed per tool call.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly approvalsFile: string
  readonly startupTimeoutMs: number
  readonly toolCallTimeoutMs: number
  readonly projectRootMarkers: readonly string[]
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    approvalsFile: config.approvalsFile ?? dshHomePath('air', 'mcp-approvals.json'),
    startupTimeoutMs: config.startupTimeoutMs ?? 15000,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60000,
    projectRootMarkers: config.projectRootMarkers ?? ['.git'],
  }
  if (!Number.isInteger(resolved.startupTimeoutMs) || resolved.startupTimeoutMs < 1) {
    throw new TypeError('air-mcp-conventions: startupTimeoutMs must be a positive integer')
  }
  if (!Number.isInteger(resolved.toolCallTimeoutMs) || resolved.toolCallTimeoutMs < 1) {
    throw new TypeError('air-mcp-conventions: toolCallTimeoutMs must be a positive integer')
  }
  if (resolved.projectRootMarkers.length === 0) {
    throw new TypeError('air-mcp-conventions: projectRootMarkers must not be empty')
  }
  return resolved
}

interface AgentState {
  readonly projectRoot: string
  readonly servers: readonly ServerSpec[]
  readonly problems: readonly string[]
  /** Running servers by name; each scope owns one `mcp-client` child. */
  readonly mounted: Map<string, Scope>
}

/**
 * Mount project MCP servers per Agent and register `/mcp`.
 * @param ctx - host-level plugin context with `agents`, `tools`, and `commands` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const approvals = new ApprovalStore(resolved.approvalsFile)
  const states = new Map<Agent, AgentState>()

  /** Start one server in the Agent's scope. Returns the failure text, or undefined on success. */
  const mount = async (agent: Agent, state: AgentState, spec: ServerSpec): Promise<string | undefined> => {
    const scope = createScope(ctx, agent)
    const common = { toolCallTimeoutMs: resolved.toolCallTimeoutMs, failOnStartupError: true }
    const clientConfig = spec.transport === 'stdio'
      ? McpClient.Config({ transport: 'stdio', serverName: spec.serverName, command: spec.command, args: spec.args, env: spec.env, cwd: spec.cwd, ...common })
      : McpClient.Config({ transport: 'streamable-http', serverName: spec.serverName, url: spec.url, headers: spec.headers, ...common })
    const start = async (): Promise<void> => { await scope.ctx.plugin(McpClient, clientConfig) }
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        start(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error(`did not start within ${resolved.startupTimeoutMs} ms`)) }, resolved.startupTimeoutMs)
        }),
      ])
      state.mounted.set(spec.serverName, scope)
      return undefined
    } catch (error: unknown) {
      await scope.dispose()
      return (error as Error).message
    } finally {
      clearTimeout(timer)
    }
  }

  const release = async (agent: Agent): Promise<void> => {
    const state = states.get(agent)
    if (state === undefined) return
    states.delete(agent)
    await Promise.all([...state.mounted.values()].map(scope => scope.dispose()))
  }

  const describeServers = async (state: AgentState): Promise<string> => {
    const lines: string[] = []
    for (const spec of state.servers) {
      const target = spec.transport === 'stdio' ? [spec.command, ...spec.args].join(' ') : spec.url
      let status = 'not approved'
      if (state.mounted.has(spec.serverName)) status = 'running'
      else if (await approvals.has(approvalKey(state.projectRoot, spec))) status = 'approved, not running'
      lines.push(`${spec.serverName} (${spec.transport}: ${target}): ${status}`)
    }
    if (lines.length === 0) lines.push(`No servers are declared in ${join(state.projectRoot, '.mcp.json')}.`)
    for (const problem of state.problems) lines.push(`Problem: ${problem}`)
    lines.push('Use /mcp approve <server> to start a server from this project, or /mcp revoke <server> to stop trusting it.')
    return lines.join('\n')
  }

  const runCommand = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const state = states.get(invocation.agent)
    if (state === undefined) {
      return { kind: 'error', text: 'This session has no working directory, so no .mcp.json was read.' }
    }
    const parts = invocation.rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
    const action = parts[0]
    if (action === undefined) return { kind: 'success', text: await describeServers(state) }
    if ((action !== 'approve' && action !== 'revoke') || parts.length !== 2) return { kind: 'error', text: USAGE }
    const spec = state.servers.find(server => server.serverName === parts[1])
    if (spec === undefined) {
      return { kind: 'error', text: `No server named "${String(parts[1])}" is declared in ${join(state.projectRoot, '.mcp.json')}. ${USAGE}` }
    }
    const key = approvalKey(state.projectRoot, spec)
    if (action === 'revoke') {
      await approvals.remove(key)
      const scope = state.mounted.get(spec.serverName)
      state.mounted.delete(spec.serverName)
      await scope?.dispose()
      return { kind: 'success', text: `Revoked "${spec.serverName}"; its tools are removed from this session.` }
    }
    await approvals.add(key, { projectRoot: state.projectRoot, server: spec.serverName, approvedAt: new Date().toISOString() })
    if (state.mounted.has(spec.serverName)) return { kind: 'success', text: `"${spec.serverName}" is already running.` }
    const failure = await mount(invocation.agent, state, spec)
    return failure === undefined
      ? { kind: 'success', text: `Approved and started "${spec.serverName}".` }
      : { kind: 'error', text: `Approved "${spec.serverName}", but it did not start: ${failure}` }
  }

  ctx.on('agent/created', async ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const text = await readTextFile(join(projectRoot, '.mcp.json'))
    const parsed = text === undefined ? { servers: [], problems: [] } : parseMcpJson(text, { cwd, env: process.env })
    const state: AgentState = { projectRoot, servers: parsed.servers, problems: parsed.problems, mounted: new Map() }
    states.set(agent, state)
    for (const problem of state.problems) ctx.logger.warn(`air-mcp-conventions: ${problem}`)
    // Servers start in parallel; a failure is logged and never fails Agent creation.
    await Promise.all(state.servers.map(async (spec) => {
      if (!await approvals.has(approvalKey(projectRoot, spec))) return
      const failure = await mount(agent, state, spec)
      if (failure !== undefined) ctx.logger.warn(`air-mcp-conventions: server "${spec.serverName}" did not start: ${failure}`)
    }))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void release(agent)
  })

  ctx.effect(() => async () => {
    await Promise.all([...states.keys()].map(agent => release(agent)))
  }, 'air-mcp-conventions.servers')

  ctx.commands.register({
    name: 'mcp',
    description: 'List, approve, or revoke MCP servers declared in this project\'s .mcp.json',
    input: { hint: '[approve <server> | revoke <server>]' },
    handler: runCommand,
  })
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions exec vitest run tests/config.spec.ts tests/approvals.spec.ts tests/plugin.spec.ts`
Expected: `Test Files 3 passed (3)`.

If the `demo` server does not start, run the fixture by hand to see the handshake the upstream client sends:
`printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node air/packages/mcp-conventions/tests/fixtures/echo-server.mjs`
Expected: two JSON lines, the second listing `echo`. Then compare the request methods with `packages/mcp/mcp-client/tests/fixtures/negotiation-lifecycle.mjs` and add a `case` for any method the client requires.

- [ ] **Step 6: Write the native Loader test**

`air/packages/mcp-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { ApprovalStore, approvalKey } from '../src/approvals.ts'
import { parseMcpJson } from '../src/config.ts'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
const echoServer = join(import.meta.dirname, 'fixtures', 'echo-server.mjs')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-mcp-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  const approvalsFile = join(root, 'state', 'mcp-approvals.json')
  await mkdir(join(project, '.git'), { recursive: true })
  const mcpJson = JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [echoServer] } } })
  await writeFile(join(project, '.mcp.json'), mcpJson)
  const [spec] = parseMcpJson(mcpJson, { cwd: project, env: process.env }).servers
  if (spec === undefined) throw new Error('expected one server')
  await new ApprovalStore(approvalsFile).add(approvalKey(project, spec), {
    projectRoot: project,
    server: 'demo',
    approvedAt: '2026-10-01T00:00:00.000Z',
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-agent'",
    '- id: air-mcp-conventions',
    "  name: '@air/dsh-mcp-conventions'",
    '  config:',
    `    approvalsFile: ${JSON.stringify(approvalsFile)}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent } = stubAgent(context, project)
  await context.agents.register(agent)
  expect(context.tools.schemas(agent).map(schema => schema.name)).toEqual(['mcp__demo__echo'])
  const listed = await context.commands.execute(agent, '/mcp', [], new AbortController().signal)
  expect(listed?.result.text).toContain('): running')
})
```

- [ ] **Step 7: Build, then run the whole suite with coverage**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions build && pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 4 passed (4)`; `approvals.ts`, `config.ts`, `index.ts` at 100 in every column.

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/mcp-conventions typecheck && pnpm -C /home/hxman/AIR-harness/air run lint`
Expected: exit 0 for both.

Run: `pgrep -fa echo-server.mjs; echo "exit $?"`
Expected: no process listed, `exit 1` (every fixture server exited with its scope).

- [ ] **Step 8: Write the README**

`air/packages/mcp-conventions/README.md`:

```markdown
# @air/dsh-mcp-conventions

## Summary

A host-level plugin that imports Claude Code project MCP configuration. When an Agent is created it reads `<project>/.mcp.json` (the project is the nearest ancestor of the session cwd that contains `.git`) and, for each server a person has approved, mounts one upstream `mcp-client` in that Agent's scope. The mount is awaited inside `agent/created`, so the tools exist for the first request. Servers start in parallel; a server that fails or exceeds `startupTimeoutMs` is logged and skipped, and Agent creation continues.

Supported entries: `command`, `args`, `env` (stdio) and `url`, `headers` with `type: "http"` (Streamable HTTP). `${VAR}` and `${VAR:-default}` are expanded from the process environment in `command`, `args`, `env`, `url`, and `headers`. A stdio server runs with the session cwd as its working directory.

Consent: a repository file can name any command, so nothing in `.mcp.json` runs until a person approves it. Approvals are stored in `<DSH_HOME>/air/mcp-approvals.json` (mode 0600), keyed by a SHA-256 over the project root, server name, command or URL, arguments, and expanded env or header values. Changing any of these requires a new approval.

| Command | Effect |
|---|---|
| `/mcp` | list each declared server with its command line or URL and its state: `running`, `approved, not running`, `not approved`; list file problems |
| `/mcp approve <server>` | record approval and start the server for this session |
| `/mcp revoke <server>` | remove approval and stop the server in this session |

Config: `approvalsFile`, `startupTimeoutMs` (default 15000), `toolCallTimeoutMs` (default 60000), `projectRootMarkers` (default `['.git']`).

## Model Experience

The model sees each approved server's tools as `mcp__<server>__<tool>`, plus the server instructions upstream `mcp-client` attributes to that server. It sees nothing for a server that is not approved. `/mcp` output is shown to the person and is not sent to the model.

## Known Limitations

- Only the project `.mcp.json` is read. `~/.claude.json`, Claude Desktop configuration, and `.mcpb` bundles are not imported.
- `type: "sse"` servers and OAuth are not supported (upstream `mcp-client` has neither).
- An approval covers expanded env and header values, so rotating a token referenced through `${VAR}` requires a new approval.
- Every Agent starts its own server processes, including delegated child Agents working in the same project.
- `.mcp.json` is read once, when the Agent is created; edit the file and start a new session to pick up changes. Revoking in one session does not stop the server in other running sessions.
- A corrupt approvals file fails Agent creation with an error that names the file; delete or repair the file.
- Tool definitions are not pinned or reviewed here; that is the MCP trust plan.
```

- [ ] **Step 9: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/packages/mcp-conventions
git commit -m "feat(air): mount approved .mcp.json servers per Agent and add the /mcp command"
```

---

### Task 8: `@air/dsh-command-conventions` — `.claude/commands` with `$ARGUMENTS`

**Files:**
- Create: `air/packages/command-conventions/package.json`
- Create: `air/packages/command-conventions/tsconfig.build.json`
- Create: `air/packages/command-conventions/tsconfig.json`
- Create: `air/packages/command-conventions/tsdown.config.ts`
- Create: `air/packages/command-conventions/vitest.config.ts`
- Create: `air/packages/command-conventions/src/args.ts`
- Create: `air/packages/command-conventions/src/index.ts`
- Create: `air/packages/command-conventions/tests/harness.ts`
- Create: `air/packages/command-conventions/README.md`
- Test: `air/packages/command-conventions/tests/args.spec.ts`
- Test: `air/packages/command-conventions/tests/plugin.spec.ts`
- Test: `air/packages/command-conventions/tests/native-loader.spec.ts`

**Interfaces:**
- Consumes from `@air/dsh-convention-core`: `findProjectRoot`, `listMarkdownTree`, `parseFrontmatter`, `readTextFile`, `resolveUserHomes`, `stringField`, `stringListField`, `toKebabName`, `UserHomes`.
- Consumes from upstream: `ctx.on('agent/created' | 'agent/disposed', ...)`; `createScope(ctx, agent)`; `scope.ctx.commands.register({ name, description, input: { hint }, handler }): () => void`; `ctx.commands.find(agent, name): CommandDefinition | undefined`; `CommandInvocation { agent, rawInput }`; `CommandResult`; `agent.followup(message: UserMessage): void`; `createUserMessage({ content, source })`.
- Produces:
  - Cordis plugin module `@air/dsh-command-conventions`: `name = 'air-command-conventions'`, `inject = ['agents', 'commands']`, `Config`, `apply(ctx, config)`.
  - `interface Config { airHome?: string; claudeHome?: string; includeUserRoots?: boolean; projectRootMarkers?: string[]; positionalBase?: number }` with defaults from `resolveUserHomes`, `false`, `['.git']`, `0`.
  - `resolveConfig(config: Config): ResolvedConfig`.
  - `splitArguments(raw: string): string[]`; `substituteArguments(body: string, rawInput: string, names: readonly string[], positionalBase: number): string`.
  - Message source kind `air-command`: `interface AirCommandSource { readonly kind: 'air-command'; readonly name: string; readonly form: 'instructions' }`.
  - Bundle row used in Task 9: `{ id: air-command-conventions, name: '@air/dsh-command-conventions' }`.

Argument rules (Claude Code skill and command placeholders): `$ARGUMENTS` is the whole input, trimmed; `$ARGUMENTS[N]` and `$N` are one argument after shell-like splitting, counted from `positionalBase` (0 matches current Claude Code; set 1 for command files written for the older `$1` convention); `$name` is the argument at the position of `name` in the frontmatter `arguments:` list. A missing argument becomes an empty string. When the body has no placeholder and the input is not empty, `ARGUMENTS: <input>` is appended.

- [ ] **Step 1: Create the package scaffold**

`air/packages/command-conventions/package.json`:

```json
{
  "name": "@air/dsh-command-conventions",
  "description": "Registers .claude/commands files as slash commands with argument substitution",
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
    "@deepseek-ai/schemastery": "link:../../../vendor/schemastery"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-agent": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-commands": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-llm": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-scope": "^0.2.0-rc.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../vendor/cordis",
    "@deepseek-ai/cordis-plugin-include": "link:../../../vendor/include",
    "@deepseek-ai/cordis-plugin-loader": "link:../../../vendor/loader",
    "@deepseek-ai/dsh-agent": "link:../../../packages/core/agent",
    "@deepseek-ai/dsh-agent-loop-testkit": "link:../../../packages/test-support/agent-loop-testkit",
    "@deepseek-ai/dsh-commands": "link:../../../packages/interaction/commands",
    "@deepseek-ai/dsh-llm": "link:../../../packages/llm/llm",
    "@deepseek-ai/dsh-scope": "link:../../../packages/core/scope",
    "@deepseek-ai/dsh-session": "link:../../../packages/core/session"
  }
}
```

`air/packages/command-conventions/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"]
}
```

`air/packages/command-conventions/tsconfig.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "tests"]
}
```

`air/packages/command-conventions/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Bundle the tsc output into one ESM entry; dependencies and peers stay external. */
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

`air/packages/command-conventions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
```

Run: `pnpm -C /home/hxman/AIR-harness/air install`
Expected: exit 0; `air/packages/command-conventions/node_modules/@deepseek-ai/dsh-commands/lib/index.js` exists.

- [ ] **Step 2: Write the failing argument tests**

`air/packages/command-conventions/tests/args.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { splitArguments, substituteArguments } from '../src/args.ts'

describe('splitArguments', () => {
  it.each([
    ['', []],
    ['   ', []],
    ['123 high', ['123', 'high']],
    ['  "two words"  \'single quoted\' plain ', ['two words', 'single quoted', 'plain']],
    ['a\\ b c', ['a b', 'c']],
    ['"" x', ['', 'x']],
    ['pre"fix ed"post', ['prefix edpost']],
    ['"unterminated rest', ['unterminated rest']],
    ['trailing\\', ['trailing\\']],
  ])('splits %j', (raw, expected) => {
    expect(splitArguments(raw)).toEqual(expected)
  })
})

describe('substituteArguments', () => {
  it('replaces $ARGUMENTS with the trimmed input', () => {
    expect(substituteArguments('Fix issue $ARGUMENTS now', '  123 high ', [], 0)).toBe('Fix issue 123 high now')
  })

  it('replaces indexed and numbered placeholders from the configured base', () => {
    expect(substituteArguments('$ARGUMENTS[0]/$ARGUMENTS[1]/$0/$1/$2', 'a "b c"', [], 0)).toBe('a/b c/a/b c/')
    expect(substituteArguments('$ARGUMENTS[1]/$1/$2/$3', 'a "b c"', [], 1)).toBe('a/a/b c/')
    expect(substituteArguments('$0', 'a', [], 1)).toBe('')
  })

  it('replaces named placeholders declared in arguments and leaves other dollar words', () => {
    expect(substituteArguments('Issue $issue on $branch costs $HOME', '42 main', ['issue', 'branch'], 0))
      .toBe('Issue 42 on main costs $HOME')
    expect(substituteArguments('Issue $issue then $branch', '42', ['issue', 'branch'], 0)).toBe('Issue 42 then ')
  })

  it('appends the input when the body has no placeholder', () => {
    expect(substituteArguments('Review the diff.', 'only tests', [], 0)).toBe('Review the diff.\n\nARGUMENTS: only tests')
    expect(substituteArguments('Review the diff for $USER.', 'only tests', [], 0)).toBe('Review the diff for $USER.\n\nARGUMENTS: only tests')
    expect(substituteArguments('Review the diff.', '   ', [], 0)).toBe('Review the diff.')
  })
})
```

- [ ] **Step 3: Run the argument tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions exec vitest run tests/args.spec.ts`
Expected: FAIL with `Failed to load url ../src/args.ts`.

- [ ] **Step 4: Implement argument handling**

`air/packages/command-conventions/src/args.ts`:

```ts
/** Argument splitting and placeholder substitution for command files. */

/**
 * Split command input into arguments. Whitespace separates arguments; single or double quotes
 * group text, and a backslash keeps the next character. An unterminated quote runs to the end.
 * @param raw - text typed after the command name.
 * @returns the arguments in order.
 */
export function splitArguments(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let started = false
  let quote: string | undefined
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index)
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === '\'') {
      quote = char
      started = true
    } else if (char === '\\' && index + 1 < raw.length) {
      index += 1
      current += raw.charAt(index)
      started = true
    } else if (/\s/u.test(char)) {
      if (started) parts.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) parts.push(current)
  return parts
}

const PLACEHOLDER = /\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS|\$(\d+)|\$([A-Za-z_][A-Za-z0-9_]*)/gu

/**
 * Substitute argument placeholders in a command body.
 * @param body - command file body.
 * @param rawInput - text typed after the command name.
 * @param names - frontmatter `arguments:` names; `$name` maps to the argument at the same position.
 * @param positionalBase - index of the first argument for `$ARGUMENTS[N]` and `$N` (0 or 1).
 * @returns the prompt text. When no placeholder was replaced and the input is not empty, the input is appended as `ARGUMENTS: <input>`.
 */
export function substituteArguments(
  body: string,
  rawInput: string,
  names: readonly string[],
  positionalBase: number,
): string {
  const all = rawInput.trim()
  const positional = splitArguments(all)
  let replaced = false
  const text = body.replace(PLACEHOLDER, (
    match: string,
    indexed: string | undefined,
    numbered: string | undefined,
    named: string | undefined,
  ) => {
    if (named !== undefined) {
      const position = names.indexOf(named)
      if (position < 0) return match
      replaced = true
      return positional[position] ?? ''
    }
    replaced = true
    const index = indexed ?? numbered
    return index === undefined ? all : positional[Number(index) - positionalBase] ?? ''
  })
  return replaced || all.length === 0 ? text : `${text}\n\nARGUMENTS: ${all}`
}
```

- [ ] **Step 5: Run the argument tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions exec vitest run tests/args.spec.ts`
Expected: `Test Files 1 passed (1)`.

- [ ] **Step 6: Write the harness and the failing plugin tests**

`air/packages/command-conventions/tests/harness.ts`:

```ts
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** A live-session Agent whose follow-ups are recorded instead of driving a model. */
export interface StubAgent {
  readonly agent: Agent
  readonly followups: UserMessage[]
}

let created = 0

/**
 * Build an idle Agent over a real Session from `ctx.sessions`.
 * @param ctx - context with the session store mounted.
 * @param cwd - session working directory; undefined creates a session without one.
 * @returns the agent and the list its `followup` calls append to.
 */
export function stubAgent(ctx: Context, cwd: string | undefined): StubAgent {
  created += 1
  const id = SessionId(`air-test-${process.pid}-${created}`)
  const session = cwd === undefined ? ctx.sessions.create(id) : ctx.sessions.create(id, { meta: { cwd } })
  const followups: UserMessage[] = []
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, followups }
}
```

`air/packages/command-conventions/tests/plugin.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import * as commandConventions from '../src/index.ts'
import { stubAgent, type StubAgent } from './harness.ts'

const created: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface World {
  root: string
  home: string
  config: commandConventions.Config
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), 'air-commands-'))
  created.push(base)
  const root = join(base, 'project')
  const home = join(base, 'home')
  await mkdir(join(root, '.git'), { recursive: true })
  return { root, home, config: { airHome: join(home, '.air'), claudeHome: join(home, '.claude') } }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

async function mount(config: commandConventions.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.commands.register({ name: 'compact', description: 'Host command', handler: () => ({ kind: 'success' }) })
  const fiber = await ctx.plugin(commandConventions, config)
  return { ctx, fiber }
}

async function live(ctx: Context, cwd: string | undefined): Promise<StubAgent> {
  const stub = stubAgent(ctx, cwd)
  await ctx.agents.register(stub.agent)
  return stub
}

function names(ctx: Context, stub: StubAgent): string[] {
  return ctx.commands.list(stub.agent).map(command => command.name)
}

async function command(ctx: Context, stub: StubAgent, line: string) {
  const execution = await ctx.commands.execute(stub.agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} did not resolve to a command`)
  return execution.result
}

describe('air-command-conventions', () => {
  it('registers project command files for the Agent with description and hint', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/fix-issue.md'), '---\ndescription: Fix a GitHub issue\nargument-hint: "[issue] [priority]"\n---\nFix issue $ARGUMENTS.')
    await write(join(root, '.claude/commands/frontend/component.md'), '# Create a component\nName it $0.')
    await write(join(root, '.claude/commands/terse.md'), '#\nDo the thing.')
    await write(join(root, '.claude/commands/long.md'), 'x'.repeat(200))
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(ctx.commands.list(stub.agent)).toEqual([
      { name: 'compact', description: 'Host command' },
      { name: 'fix-issue', description: 'Fix a GitHub issue', input: { hint: '[issue] [priority]' } },
      { name: 'frontend-component', description: 'Create a component', input: { hint: '[arguments]' } },
      { name: 'long', description: `${'x'.repeat(119)}…`, input: { hint: '[arguments]' } },
      { name: 'terse', description: 'Project command file', input: { hint: '[arguments]' } },
    ])
  })

  it('sends the substituted body to the model as an air-command message', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/fix-issue.md'), '---\narguments: issue priority\n---\nFix issue $issue with priority $priority.\nAll: $ARGUMENTS')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(await command(ctx, stub, '/fix-issue 123 high')).toEqual({ kind: 'success', text: 'Sent /fix-issue to the model.' })
    expect(stub.followups).toHaveLength(1)
    expect(stub.followups[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Fix issue 123 with priority high.\nAll: 123 high' }],
      source: { kind: 'air-command', name: 'fix-issue', form: 'instructions' },
    })
  })

  it('counts positional placeholders from the configured base', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/greet.md'), 'Greet $1.')
    const { ctx } = await mount({ ...config, positionalBase: 1 })
    const stub = await live(ctx, root)
    await command(ctx, stub, '/greet Ada')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Greet Ada.' }])
  })

  it('reads the latest file content and reports a deleted file', async () => {
    const { root, config } = await world()
    const file = join(root, '.claude/commands/review.md')
    await write(file, 'Review the diff.')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    await write(file, 'Review the diff carefully.')
    await command(ctx, stub, '/review')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Review the diff carefully.' }])
    await rm(file)
    expect(await command(ctx, stub, '/review')).toEqual({ kind: 'error', text: `/review: ${file} can no longer be read.` })
    expect(stub.followups).toHaveLength(1)
  })

  it('prefers project files over the AIR home and reads user files only on request', async () => {
    const { root, home, config } = await world()
    await write(join(root, '.claude/commands/deploy.md'), 'Project deploy.')
    await write(join(home, '.air/commands/deploy.md'), 'AIR home deploy.')
    await write(join(home, '.air/commands/standup.md'), 'AIR home standup.')
    await write(join(home, '.claude/commands/personal.md'), 'Personal command.')
    const first = await mount(config)
    const stub = await live(first.ctx, root)
    expect(names(first.ctx, stub)).toEqual(['compact', 'deploy', 'standup'])
    await command(first.ctx, stub, '/deploy')
    expect(stub.followups[0]?.content).toEqual([{ type: 'text', text: 'Project deploy.' }])
    const second = await mount({ ...config, includeUserRoots: true })
    expect(names(second.ctx, await live(second.ctx, root))).toEqual(['compact', 'deploy', 'personal', 'standup'])
  })

  it('skips files it cannot register and never shadows an existing command', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/123.md'), 'Starts with a digit.')
    await write(join(root, '.claude/commands/+++.md'), 'No usable name.')
    await write(join(root, '.claude/commands/compact.md'), 'Tries to replace a host command.')
    await write(join(root, '.claude/commands/broken.md'), '---\narguments: [unclosed\n---\nBody')
    await write(join(root, '.claude/commands/empty.md'), '---\ndescription: Nothing here\n---\n\n')
    await write(join(root, '.claude/commands/good.md'), 'Works.')
    const { ctx } = await mount(config)
    const stub = await live(ctx, root)
    expect(names(ctx, stub)).toEqual(['compact', 'good'])
    expect(await command(ctx, stub, '/compact')).toEqual({ kind: 'success' })
  })

  it('scopes commands to the Agent and removes them on disposal and unload', async () => {
    const { root, config } = await world()
    await write(join(root, '.claude/commands/local.md'), 'Local.')
    const other = await world()
    const { ctx, fiber } = await mount(config)
    const here = await live(ctx, root)
    const there = await live(ctx, other.root)
    const detached = await live(ctx, undefined)
    const again = await live(ctx, root)
    expect(names(ctx, here)).toEqual(['compact', 'local'])
    expect(names(ctx, there)).toEqual(['compact'])
    expect(names(ctx, detached)).toEqual(['compact'])
    ctx.emit('agent/disposed', { agent: here.agent })
    ctx.emit('agent/disposed', { agent: there.agent })
    await vi.waitFor(() => { expect(names(ctx, here)).toEqual(['compact']) }, { timeout: 5000 })
    expect(names(ctx, again)).toEqual(['compact', 'local'])
    await fiber.dispose()
    expect(names(ctx, again)).toEqual(['compact'])
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    expect(commandConventions.resolveConfig({ airHome: '/a', claudeHome: '/c' })).toMatchObject({
      homes: { airHome: '/a', claudeHome: '/c' },
      includeUserRoots: false,
      projectRootMarkers: ['.git'],
      positionalBase: 0,
    })
  })

  it('rejects invalid values', () => {
    expect(() => commandConventions.resolveConfig({ positionalBase: 2 })).toThrow('positionalBase must be 0 or 1')
    expect(() => commandConventions.resolveConfig({ projectRootMarkers: [] })).toThrow('projectRootMarkers must not be empty')
  })
})
```

- [ ] **Step 7: Run the plugin tests to verify they fail**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions exec vitest run tests/plugin.spec.ts`
Expected: FAIL with `Failed to load url ../src/index.ts`.

- [ ] **Step 8: Implement the plugin**

`air/packages/command-conventions/src/index.ts`:

```ts
/**
 * Registers Claude Code command files (`.claude/commands/**` Markdown) as slash commands scoped to
 * the Agent whose project contains them. Running a command substitutes its arguments into the file
 * body and queues the result as a user message with source kind `air-command`, so the prompt the
 * model receives is in the session log.
 *
 * @module @air/dsh-command-conventions
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import {
  findProjectRoot,
  listMarkdownTree,
  parseFrontmatter,
  readTextFile,
  resolveUserHomes,
  stringField,
  stringListField,
  toKebabName,
  type UserHomes,
} from '@air/dsh-convention-core'
import { substituteArguments } from './args.ts'

export { splitArguments, substituteArguments } from './args.ts'

export const name = 'air-command-conventions'
export const inject = ['agents', 'commands']

/** Same grammar the upstream command registry accepts. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u
/** Directory levels walked under a commands root. */
const COMMAND_TREE_DEPTH = 4
const DESCRIPTION_MAX_CHARS = 120

/** Durable source of the user message a command file produces. */
export interface AirCommandSource {
  readonly kind: 'air-command'
  /** Command name without the slash. */
  readonly name: string
  /** The text is instructions read out of a file. */
  readonly form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A command file rendered by `@air/dsh-command-conventions`. */
    'air-command': AirCommandSource
  }
}

/** Plugin configuration. */
export interface Config {
  /** AIR home; its `commands` directory is always scanned. Defaults to `$AIR_HOME`, then `~/.air`. */
  airHome?: string
  /** Claude Code home, read only with `includeUserRoots`. Defaults to `~/.claude`. */
  claudeHome?: string
  /** Whether `<claudeHome>/commands` is scanned. Defaults to false. */
  includeUserRoots?: boolean
  /** Entry names that identify the project root. Defaults to `['.git']`. */
  projectRootMarkers?: string[]
  /** Index of the first argument for `$ARGUMENTS[N]` and `$N`: 0 or 1. Defaults to 0. */
  positionalBase?: number
}

export const Config: Schema<Config> = Schema.object({
  airHome: Schema.string().description('AIR home; defaults to $AIR_HOME, then ~/.air.'),
  claudeHome: Schema.string().description('Claude Code home; defaults to ~/.claude.'),
  includeUserRoots: Schema.boolean().default(false).description('Scan ~/.claude/commands.'),
  projectRootMarkers: Schema.array(Schema.string()).default(['.git']).description('Entry names that identify the project root.'),
  positionalBase: Schema.number().default(0).description('Index of the first argument for $ARGUMENTS[N] and $N: 0 or 1.'),
})

/** Configuration after defaulting and validation. */
export interface ResolvedConfig {
  readonly homes: UserHomes
  readonly includeUserRoots: boolean
  readonly projectRootMarkers: readonly string[]
  readonly positionalBase: number
}

/**
 * Apply defaults and reject invalid values.
 * @param config - configuration from the Loader row or a direct caller.
 * @returns the complete configuration.
 * @throws TypeError naming the invalid field.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    homes: resolveUserHomes(config),
    includeUserRoots: config.includeUserRoots ?? false,
    projectRootMarkers: config.projectRootMarkers ?? ['.git'],
    positionalBase: config.positionalBase ?? 0,
  }
  if (resolved.positionalBase !== 0 && resolved.positionalBase !== 1) {
    throw new TypeError('air-command-conventions: positionalBase must be 0 or 1')
  }
  if (resolved.projectRootMarkers.length === 0) {
    throw new TypeError('air-command-conventions: projectRootMarkers must not be empty')
  }
  return resolved
}

interface LoadedCommand {
  readonly description: string
  readonly hint: string
  readonly argumentNames: readonly string[]
  readonly body: string
}

interface CommandFile extends LoadedCommand {
  readonly name: string
  readonly path: string
}

function firstLine(text: string): string {
  const end = text.indexOf('\n')
  const line = (end < 0 ? text : text.slice(0, end)).replace(/^#+\s*/u, '').trim()
  if (line.length === 0) return 'Project command file'
  return line.length <= DESCRIPTION_MAX_CHARS ? line : `${line.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
}

/**
 * Register command files per Agent.
 * @param ctx - host-level plugin context with `agents` and `commands` injected.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const scopes = new Map<Agent, Scope>()

  /** Read and parse one command file; undefined when it is gone, empty, or does not parse. */
  const load = async (path: string): Promise<LoadedCommand | undefined> => {
    const raw = await readTextFile(path)
    if (raw === undefined) return undefined
    try {
      const { data, body } = parseFrontmatter(raw)
      const text = body.trim()
      if (text.length === 0) return undefined
      return {
        description: stringField(data, 'description') ?? firstLine(text),
        hint: stringField(data, 'argument-hint') ?? '[arguments]',
        argumentNames: stringListField(data, 'arguments') ?? [],
        body: text,
      }
    } catch (error: unknown) {
      ctx.logger.warn(`air-command-conventions: ${path} ignored: ${(error as Error).message}`)
      return undefined
    }
  }

  const discover = async (agent: Agent, cwd: string): Promise<CommandFile[]> => {
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers)
    const roots = [
      join(projectRoot, '.claude', 'commands'),
      join(resolved.homes.airHome, 'commands'),
      ...resolved.includeUserRoots ? [join(resolved.homes.claudeHome, 'commands')] : [],
    ]
    const found = new Map<string, CommandFile>()
    for (const root of roots) {
      for (const entry of await listMarkdownTree(root, COMMAND_TREE_DEPTH)) {
        const commandName = toKebabName(entry.segments.join('-'))
        if (commandName === undefined || !COMMAND_NAME.test(commandName)) {
          ctx.logger.warn(`air-command-conventions: ${entry.path} skipped: its path does not form a command name`)
          continue
        }
        if (found.has(commandName)) continue
        // A repository file must not replace a command the host or the preset already provides.
        if (ctx.commands.find(agent, commandName) !== undefined) {
          ctx.logger.warn(`air-command-conventions: ${entry.path} skipped: /${commandName} is already a command`)
          continue
        }
        const loaded = await load(entry.path)
        if (loaded === undefined) continue
        found.set(commandName, { ...loaded, name: commandName, path: entry.path })
      }
    }
    return [...found.values()]
  }

  const run = async (file: CommandFile, invocation: CommandInvocation): Promise<CommandResult> => {
    const loaded = await load(file.path)
    if (loaded === undefined) return { kind: 'error', text: `/${file.name}: ${file.path} can no longer be read.` }
    const text = substituteArguments(loaded.body, invocation.rawInput, loaded.argumentNames, resolved.positionalBase)
    const source: AirCommandSource = { kind: 'air-command', name: file.name, form: 'instructions' }
    invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source }))
    return { kind: 'success', text: `Sent /${file.name} to the model.` }
  }

  const release = async (agent: Agent): Promise<void> => {
    const scope = scopes.get(agent)
    if (scope === undefined) return
    scopes.delete(agent)
    await scope.dispose()
  }

  ctx.on('agent/created', async ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const files = await discover(agent, cwd)
    if (files.length === 0) return
    const scope = createScope(ctx, agent)
    scopes.set(agent, scope)
    for (const file of files) {
      scope.ctx.commands.register({
        name: file.name,
        description: file.description,
        input: { hint: file.hint },
        handler: invocation => run(file, invocation),
      })
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void release(agent)
  })

  ctx.effect(() => async () => {
    await Promise.all([...scopes.keys()].map(agent => release(agent)))
  }, 'air-command-conventions.scopes')
}
```

- [ ] **Step 9: Run the unit tests to verify they pass**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions exec vitest run tests/args.spec.ts tests/plugin.spec.ts`
Expected: `Test Files 2 passed (2)`.

- [ ] **Step 10: Write the native Loader test**

`air/packages/command-conventions/tests/native-loader.spec.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import { stubAgent } from './harness.ts'

const packageDir = join(import.meta.dirname, '..')
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// Rows resolve by Node from the directory of the cordis.yml, so the config
// lives inside this package; `@air/dsh-command-conventions` self-resolves to lib/.
it('loads the built package through native Loader resolution', async () => {
  root = await mkdtemp(join(packageDir, '.loader-'))
  const project = join(root, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.claude', 'commands'), { recursive: true })
  await writeFile(join(project, '.claude', 'commands', 'fix-issue.md'), 'Fix issue $ARGUMENTS.')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-agent'",
    '- id: air-command-conventions',
    "  name: '@air/dsh-command-conventions'",
    '  config:',
    `    airHome: ${JSON.stringify(join(root, 'home', '.air'))}`,
    `    claudeHome: ${JSON.stringify(join(root, 'home', '.claude'))}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(packageDir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const { agent, followups } = stubAgent(context, project)
  await context.agents.register(agent)
  const execution = await context.commands.execute(agent, '/fix-issue 123', [], new AbortController().signal)
  expect(execution?.result).toEqual({ kind: 'success', text: 'Sent /fix-issue to the model.' })
  expect(followups[0]).toMatchObject({
    content: [{ type: 'text', text: 'Fix issue 123.' }],
    source: { kind: 'air-command', name: 'fix-issue', form: 'instructions' },
  })
  expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(expect.arrayContaining(['command/run', 'command/done']))
})
```

The last assertion uses `snapshotEvents`, which upstream marks deprecated for new production code; it is acceptable in a test (upstream's own `command-goal.spec.ts` uses it). If oxlint reports `typescript/no-deprecated` on that line, add `// oxlint-disable-next-line typescript/no-deprecated -- test reads the log to check the upstream command lifecycle events` above it.

- [ ] **Step 11: Build, then run the whole suite with coverage**

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions build && pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions exec vitest run --coverage --coverage.include='src/**' --coverage.thresholds.100`
Expected: `Test Files 3 passed (3)`; `args.ts` and `index.ts` at 100 in every column.

Run: `pnpm -C /home/hxman/AIR-harness/air/packages/command-conventions typecheck && pnpm -C /home/hxman/AIR-harness/air run lint`
Expected: exit 0 for both.

- [ ] **Step 12: Write the README**

`air/packages/command-conventions/README.md`:

```markdown
# @air/dsh-command-conventions

## Summary

A host-level plugin that turns Claude Code command files into slash commands. When an Agent is created it scans, in this order, `<project>/.claude/commands`, `<airHome>/commands`, and (only with `includeUserRoots: true`) `<claudeHome>/commands`, up to four directory levels deep. Each `.md` file becomes a command registered in that Agent's scope through `ctx.commands`; the first file found for a name wins. A nested path is joined with `-` (`frontend/component.md` is `/frontend-component`). A file whose name is already a command for that Agent (for example `/compact` or `/goal`) is skipped with a warning, so a repository cannot replace a built-in command.

Running a command reads the file again, substitutes arguments, and queues the text with `agent.followup` as a user message whose source is `{ kind: 'air-command', name, form: 'instructions' }`. The upstream registry logs `command/run` and `command/done` around it.

| Placeholder | Value |
|---|---|
| `$ARGUMENTS` | everything typed after the command name, trimmed |
| `$ARGUMENTS[N]`, `$N` | one argument after shell-like splitting (quotes group words), counted from `positionalBase` |
| `$name` | the argument at the position of `name` in the frontmatter `arguments:` list |

A missing argument becomes an empty string. When the body has no placeholder and input was typed, `ARGUMENTS: <input>` is appended. Frontmatter `description` (default: the first body line) and `argument-hint` (default `[arguments]`) appear in the `/` picker.

Config: `airHome`, `claudeHome`, `includeUserRoots` (default `false`), `projectRootMarkers` (default `['.git']`), `positionalBase` (default `0`; set `1` for files written for the older `$1` convention).

In the AIR bundle, `@air/dsh-skill-conventions` runs with `commandsUserInvocable: false`, so each command file appears once in the `/` picker, through this plugin.

## Model Experience

The model receives the rendered command body as an ordinary user turn. It does not see the command name or the placeholders, and it has no tool for running these commands itself.

## Known Limitations

- `@file` references and `` !`cmd` `` lines in a command body are not expanded; the model sees them as written.
- `allowed-tools` and `model` in command frontmatter are ignored.
- Command files are discovered once, when the Agent is created. A new file needs a new session; an edited file is picked up on the next run.
- Command names lose the `:` namespace separator Claude Code uses (`frontend:component` is `/frontend-component`).
- A file whose path does not start with a letter after normalisation (for example `123.md`) is skipped.
```

- [ ] **Step 13: Commit**

```bash
cd /home/hxman/AIR-harness
git add air/packages/command-conventions air/pnpm-lock.yaml
git commit -m "feat(air): register .claude/commands files as argument-substituting slash commands"
```

---

### Task 9: Bundle wiring — `preset-air`, registry default, host rows, profile verification

**Files:**
- Modify: `air/package.json` (add `yaml` to `devDependencies`)
- Create: `air/scripts/tests/preset-air-drift.spec.ts`
- Modify: `air/bundles/air/package.json`
- Modify: `air/bundles/air/cordis.patch.yml`
- Modify: `air/README.md`

**Interfaces:**
- Consumes: the four plugin packages built in Tasks 3, 5, 7, 8 and their rows:
  - preset rows `{ id: air-instruction-conventions, name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } }` and `{ id: air-skill-conventions, name: '@air/dsh-skill-conventions', config: { commandsUserInvocable: false } }`
  - host rows `{ id: air-mcp-conventions, name: '@air/dsh-mcp-conventions' }` and `{ id: air-command-conventions, name: '@air/dsh-command-conventions' }`
- Consumes from upstream: `packages/bundle/web-app/presets/standard.patch.yml` (row `preset-standard`); host row `agent-preset-registry` with Config `{ default: string }`; patch semantics (a patch replaces a row's whole `config`; `insert` adds rows); the profile's runtime resolution, which supplies every package in the bundle's dependency closure to row loading; `air/scripts/smoke-profile.sh` from plan 00.
- Produces: the `air` profile composes an agent preset `air` (default for new sessions) with the convention plugins; `preset-standard` stays selectable. A drift test fails when the upstream `standard` preset changes without the same change in `preset-air`.

Why a copied preset: the live `skill-filesystem`, `tool-skill`, and `agent-instructions` rows sit inside `preset-standard`'s `config.plugins`, and a bundle patch cannot address nested rows of a non-group entry by id (spike 02 §0.1). Replacing `preset-standard`'s config would fork the upstream list under the upstream id, so the bundle adds its own preset and makes it the default.

- [ ] **Step 1: Add the YAML parser for the drift test**

In `air/package.json`, add this entry to `devDependencies` (keep the keys sorted):

```json
    "yaml": "^2.9.0"
```

Run: `pnpm -C /home/hxman/AIR-harness/air install`
Expected: exit 0; `air/node_modules/yaml/package.json` exists.

- [ ] **Step 2: Write the failing drift test**

`air/scripts/tests/preset-air-drift.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const airDir = join(import.meta.dirname, '..', '..')
const bundleDir = join(airDir, 'bundles', 'air')
const airPatch = join(bundleDir, 'cordis.patch.yml')
const standardPatch = join(airDir, '..', 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Upstream patch files use `!!js <expression>`; keep the expression as text so both files compare equal.
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (source: string) => `!!js ${source}` }

function patches(file: string): Row[] {
  const parsed: unknown = parse(readFileSync(file, 'utf8'), { customTags: [jsTag] })
  if (!Array.isArray(parsed) || !parsed.every(isRow)) throw new Error(`${file}: expected a list of patch objects`)
  return parsed
}

function insertedRows(file: string): Row[] {
  return patches(file).flatMap((patch) => {
    const inserted = patch['insert']
    return Array.isArray(inserted) ? inserted.filter(isRow) : []
  })
}

function presetPlugins(file: string, rowId: string): Row[] {
  const row = insertedRows(file).find(candidate => candidate['id'] === rowId)
  const config = row?.['config']
  if (!isRow(config)) throw new Error(`${file}: no preset row ${rowId}`)
  const plugins = config['plugins']
  if (!Array.isArray(plugins) || !plugins.every(isRow)) throw new Error(`${file}: ${rowId} has no plugin list`)
  return plugins
}

function isAirRow(row: Row): boolean {
  const id = row['id']
  return typeof id === 'string' && id.startsWith('air-')
}

describe('AIR bundle composition', () => {
  it('keeps preset-air equal to the upstream standard preset plus the declared changes', () => {
    const standard = presetPlugins(standardPatch, 'preset-standard')
    const air = presetPlugins(airPatch, 'preset-air')
    expect(air.filter(isAirRow)).toEqual([
      { id: 'air-instruction-conventions', name: '@air/dsh-instruction-conventions', config: { maxBytes: 32768 } },
      { id: 'air-skill-conventions', name: '@air/dsh-skill-conventions', config: { commandsUserInvocable: false } },
    ])
    const expected = standard.map(row => (row['id'] === 'skill-filesystem' ? { ...row, config: { includeDefaultRoots: false } } : row))
    expect(air.filter(row => !isAirRow(row))).toEqual(expected)
  })

  it('places each AIR preset row directly after its upstream counterpart', () => {
    const ids = presetPlugins(airPatch, 'preset-air').map(row => row['id'])
    expect(ids[ids.indexOf('agent-instructions') + 1]).toBe('air-instruction-conventions')
    expect(ids[ids.indexOf('skill-filesystem') + 1]).toBe('air-skill-conventions')
  })

  it('makes the AIR preset the default and mounts the host rows', () => {
    expect(patches(airPatch)).toContainEqual({ id: 'agent-preset-registry', config: { default: 'air' } })
    const hostRows = insertedRows(airPatch).filter(isAirRow)
    expect(hostRows).toEqual([
      { id: 'air-mcp-conventions', name: '@air/dsh-mcp-conventions' },
      { id: 'air-command-conventions', name: '@air/dsh-command-conventions' },
    ])
  })

  it('declares every AIR row package as a bundle dependency', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
    const dependencies = isRow(manifest) && isRow(manifest['dependencies']) ? manifest['dependencies'] : {}
    const rowPackages = [...readFileSync(airPatch, 'utf8').matchAll(/name: '(@air\/[^']+)'/gu)].map(match => match[1])
    expect(rowPackages).toHaveLength(4)
    for (const packageName of rowPackages) expect(dependencies).toHaveProperty([String(packageName)], 'workspace:*')
  })
})
```

- [ ] **Step 3: Run the drift test to verify it fails**

Run: `cd /home/hxman/AIR-harness/air && pnpm exec vitest run scripts/tests/preset-air-drift.spec.ts`
Expected: FAIL; the first two tests with `no preset row preset-air`, the third because the registry patch is absent, the fourth with `expected [] to have a length of 4`.

- [ ] **Step 4: Declare the bundle dependencies**

Replace `air/bundles/air/package.json` with:

```json
{
  "name": "@air/dsh-air-bundle",
  "description": "AIR product bundle: local-first defaults over the upstream Web composition",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "files": [
    "cordis.patch.yml"
  ],
  "dependencies": {
    "@air/dsh-command-conventions": "workspace:*",
    "@air/dsh-instruction-conventions": "workspace:*",
    "@air/dsh-mcp-conventions": "workspace:*",
    "@air/dsh-skill-conventions": "workspace:*"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Run: `pnpm -C /home/hxman/AIR-harness/air install && ls /home/hxman/AIR-harness/air/bundles/air/node_modules/@air/`
Expected: `dsh-command-conventions  dsh-instruction-conventions  dsh-mcp-conventions  dsh-skill-conventions`.

- [ ] **Step 5: Add the preset, the host rows, and the registry default**

Append to `air/bundles/air/cordis.patch.yml` (after the existing `agent-default-model` patch). The `plugins` list is the upstream `standard` list with three changes: `skill-filesystem` gets `includeDefaultRoots: false`, `air-instruction-conventions` follows `agent-instructions`, and `air-skill-conventions` follows `skill-filesystem`. Indentation is significant; copy the block as shown.

```yaml

# The AIR agent preset: the upstream `standard` plugin list
# (packages/bundle/web-app/presets/standard.patch.yml) with the AIR convention
# plugins added. A bundle patch cannot reach rows nested in `preset-standard`,
# so AIR ships its own preset and makes it the default; `standard` stays
# selectable. air/scripts/tests/preset-air-drift.spec.ts fails when the two
# lists differ by anything other than the changes below, which is the signal to
# re-copy after an upstream merge.
#   - skill-filesystem: includeDefaultRoots false, so ~/.dsh/skills,
#     ~/.agents/skills, and bundled skills are not listed; the AIR provider
#     owns project roots and ~/.air/skills, and user roots are opt-in.
#   - air-skill-conventions: commandsUserInvocable false, because
#     air-command-conventions registers the same command files.
- insert:
    - id: preset-air
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: air
        name: AIR
        description: Standard coding tools plus Claude Code file conventions; user-level skill folders are opt-in.
        order: 0
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              suffix: Your working directory is {{cwd}}.
              prefix: You are a coding agent powered by the {{model}} model.
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: air-instruction-conventions
            name: '@air/dsh-instruction-conventions'
            config:
              maxBytes: 32768
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              includeDefaultRoots: false
          - id: air-skill-conventions
            name: '@air/dsh-skill-conventions'
            config:
              commandsUserInvocable: false
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: command-goal
            name: '@deepseek-ai/dsh-command-goal'
          - id: tool-goal
            name: '@deepseek-ai/dsh-tool-goal'
          - id: planning
            name: cordis:group
            group: true
            isolate:
              planMode: true
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
                config:
                  section: |
                    You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

                    Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

                    The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

                    Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

                    Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

                    When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'
              - id: tool-subagent-list-agents
                name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
              - id: tool-subagent
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: spawn
                  toolName: subagent
                  modelSelectionSettings: true
                  backgroundMode: continuable
              - id: tool-subagent-fork
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: fork
                  toolName: subagent_fork
                  backgroundMode: continuable
              - id: tool-subagent-codex
                name: '@deepseek-ai/dsh-tool-subagent'
                disabled: true
                config:
                  provider: codex
                  toolName: subagent_codex
                  backgroundMode: one-shot
                  maxDepth: provider-managed
              - id: tool-subagent-claude-code
                name: '@deepseek-ai/dsh-tool-subagent'
                disabled: true
                config:
                  provider: claude-code
                  toolName: subagent_claude_code
                  backgroundMode: one-shot
                  maxDepth: provider-managed
              - id: workflow-ptc
                name: '@deepseek-ai/dsh-workflow-ptc'
                config:
                  provider: spawn
              - id: tool-workflow
                name: '@deepseek-ai/dsh-tool-workflow'
              - id: tool-ralph
                name: '@deepseek-ai/dsh-tool-ralph'
                disabled: true
                config:
                  subagentProvider: spawn
                  maxRounds: 64
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
          - id: present
            name: '@deepseek-ai/dsh-tool-present'
          - id: tool-plugin-manager
            name: '@deepseek-ai/dsh-plugin-manager/tools'
            disabled: true

    # Host rows: each mounts per-Agent children through createScope.
    - id: air-mcp-conventions
      name: '@air/dsh-mcp-conventions'
    - id: air-command-conventions
      name: '@air/dsh-command-conventions'

# New sessions use the AIR preset. The registry row's only non-volatile Config
# field is `default`, so replacing its config loses nothing.
- id: agent-preset-registry
  config:
    default: air
```

To turn on user-level folders (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/CLAUDE.md`), a user copies the `preset-air` row into the profile patch (`$DSH_HOME/profiles/air/cordis.patch.yml`) as an id-targeted patch with `includeUserRoots: true` on the `air-skill-conventions` and `air-instruction-conventions` rows, and patches `air-command-conventions` with `config: { includeUserRoots: true }`. This is documented in Step 9.

- [ ] **Step 6: Run the drift test to verify it passes**

Run: `cd /home/hxman/AIR-harness/air && pnpm exec vitest run scripts/tests/preset-air-drift.spec.ts`
Expected: `Tests 4 passed (4)`.

If the first test fails on a difference in an upstream row, the upstream file changed after this plan was written: re-copy that row from `packages/bundle/web-app/presets/standard.patch.yml` into `preset-air` and rerun.

- [ ] **Step 7: Build and test the whole AIR workspace**

Run: `pnpm -C /home/hxman/AIR-harness/air run build && pnpm -C /home/hxman/AIR-harness/air run typecheck && pnpm -C /home/hxman/AIR-harness/air run lint && pnpm -C /home/hxman/AIR-harness/air run test`
Expected: exit 0; the workspace-level run reports the drift test and the plan-00 script tests, then each of the five packages reports all test files passed.

Run from the repository root: `cd /home/hxman/AIR-harness && pnpm run verify-no-unknown-casts && pnpm run verify-concrete-terms && pnpm run verify-repository-references && pnpm run verify-translation-pairing`
Expected: each exits 0. `verify-no-unknown-casts` reports no new assertions.

- [ ] **Step 8: Verify with the `air` profile**

The `air` profile already links `air/bundles/air` (see `air/README.md`), so no reinstall into the profile is needed.

Run:

```bash
cd /home/hxman/AIR-harness
out="$(mktemp -d)"
pnpm dsh --profile air --dump-config > "$out/dump.yml" 2> "$out/dump.err"
echo "exit $?"
grep -Ei 'unmatched|incompatible|failed|skipping' "$out/dump.err"; echo "problems: $?"
grep -c 'id: preset-air' "$out/dump.yml"
grep -c "name: '@air/dsh-skill-conventions'" "$out/dump.yml"
grep -c "name: '@air/dsh-instruction-conventions'" "$out/dump.yml"
grep -c "name: '@air/dsh-mcp-conventions'" "$out/dump.yml"
grep -c "name: '@air/dsh-command-conventions'" "$out/dump.yml"
grep -A3 'id: agent-preset-registry' "$out/dump.yml" | grep -c 'default: air'
grep -c 'includeDefaultRoots: false' "$out/dump.yml"
```

Expected: `exit 0`; `problems: 1` (grep found nothing); every count prints `1`. If the dump quotes package names differently, adjust the `grep` patterns to the dump's quoting and keep the same seven checks.

Run: `pnpm -C /home/hxman/AIR-harness/air run smoke`
Expected: last line `smoke: ok (<temp dir>)`. The smoke boots under an isolated `DSH_HOME`, so a row that fails to load (for example a bad peer range: `disabling profile plugin row`) fails this step.

Then check behavior in the Web UI. Create a scratch project:

```bash
demo="$(mktemp -d)/air-demo" && mkdir -p "$demo/.claude/skills/hello" "$demo/.claude/commands" "$demo/.claude/rules" && git -C "$demo" init -q
printf -- '---\ndescription: Greet the user by name\n---\nSay hello to the person named in the request.\n' > "$demo/.claude/skills/hello/SKILL.md"
printf 'Summarise issue $ARGUMENTS in one sentence.\n' > "$demo/.claude/commands/issue.md"
printf 'Project memory: answer in British English. @notes.md\n' > "$demo/.claude/CLAUDE.md"
printf 'Imported note: the project is called Demo.\n' > "$demo/.claude/notes.md"
printf -- '---\npaths: "**/*.ts"\n---\nTypeScript files use strict mode.\n' > "$demo/.claude/rules/ts.md"
printf '{ "mcpServers": { "demo": { "command": "node", "args": ["%s"] } } }\n' "/home/hxman/AIR-harness/air/packages/mcp-conventions/tests/fixtures/echo-server.mjs" > "$demo/.mcp.json"
echo "$demo"
pnpm dsh --profile air --no-open --port 3190
```

Open the printed URL, start a session with the printed directory as its workspace, and confirm:

1. The `/` picker lists `hello` (skill), `issue` and `mcp` (commands), and none of the skills under `~/.agents/skills` or `~/.dsh/skills`.
2. `/mcp` prints `demo (stdio: node ...echo-server.mjs): not approved`. `/mcp approve demo` prints `Approved and started "demo".`; `/mcp` then prints `running`.
3. `/issue 42` starts a turn whose user message is `Summarise issue 42 in one sentence.`
4. With the local model running (`ollama serve`, model `qwen3:8b`), send `What is this project called?`; the answer uses the imported note (`Demo`). The session's first request contains one `<air_instructions>` block (visible in the session event view as a user message with source `air-instructions`).
5. `ls "$DSH_HOME/air/mcp-approvals.json" 2>/dev/null || ls ~/.dsh/air/mcp-approvals.json` shows the approvals file.

Stop the server with Ctrl-C. If a step cannot be checked because the local model is not installed, record which steps were checked in the commit message; steps 1, 2, 3, and 5 need no model response.

- [ ] **Step 9: Update `air/README.md`**

In the layout block, replace the line `  packages/<pkg>/         AIR plugins (added feature by feature)` with:

```
  packages/convention-core/          shared discovery library for the convention plugins
  packages/skill-conventions/        skill provider: .claude/skills, .claude/commands, project roots, ~/.air/skills
  packages/instruction-conventions/  .claude/CLAUDE.md, @path imports, .claude/rules
  packages/mcp-conventions/          .mcp.json servers per Agent, with approval (/mcp)
  packages/command-conventions/      .claude/commands with $ARGUMENTS
```

Replace the whole `## Known issues` section with:

````markdown
## File conventions

New sessions use the `air` agent preset, a copy of the upstream `standard` preset with the convention plugins added (`bundles/air/cordis.patch.yml`). After every upstream merge, run `pnpm -C air exec vitest run scripts/tests/preset-air-drift.spec.ts`; a failure names the upstream row to re-copy into `preset-air`.

User-level folders written for other agents (`~/.agents/skills`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/CLAUDE.md`) are not read by default, because a large unrelated skill catalog derails small local models. `~/.air/skills` and `~/.air/commands` are always read. To opt in, add to `$DSH_HOME/profiles/air/cordis.patch.yml`:

```yaml
- id: air-command-conventions
  config:
    includeUserRoots: true
```

and copy the `preset-air` row from the bundle patch into the same file with `includeUserRoots: true` added to the `air-skill-conventions` and `air-instruction-conventions` configs (a patch replaces a row's whole `config`, so the full plugin list must be repeated).

Project MCP servers from `.mcp.json` start only after `/mcp approve <server>`; approvals are stored in `$DSH_HOME/air/mcp-approvals.json`.
````

(The fenced YAML block inside this section is part of the README text.)

- [ ] **Step 10: Confirm no upstream file changed, refresh the graph, commit**

Run: `cd /home/hxman/AIR-harness && git status --short -- . ':!air' ':!research'`
Expected: no output. `air/UPSTREAM-DELTA.md` needs no new row.

Run: `cd /home/hxman/AIR-harness && graphify update .`
Expected: exit 0 (the root `CLAUDE.md` asks for this after code changes; commit `graphify-out/` only if it is tracked: `git ls-files graphify-out | head -1`).

```bash
cd /home/hxman/AIR-harness
git add air/package.json air/pnpm-lock.yaml air/scripts/tests/preset-air-drift.spec.ts air/bundles/air air/README.md
git commit -m "feat(air): add the AIR agent preset and wire the file-convention plugins into the bundle"
```

---

## Deferred to later slices

These items are in the spec and deliberately outside this plan. Each is named in a README Known Limitations section.

| Item | Spec | Why not now |
|---|---|---|
| Agents from `.claude/agents/*.md`, permission rules, hooks, plugin manifests | spike 02 §2, §6, §7, §8 | later slices by the task brief (packages 6-9) |
| `allowed-tools` enforcement, `context: fork`, `agent`, `model`, `paths` on skills | spike 02 §1.2 | needs `@air/dsh-permission-rules` and the delegation tool |
| `@file` expansion and approved `` !`cmd` `` in commands | spike 02 §3.2 | `!cmd` is code execution from a repository file and needs the approval path designed in the permissions plan |
| `$ARGUMENTS` on the skill-invocation path (`/skill-name args`) | spike 02 §3.2 | depends on waterfall order against the preset-scoped `tool-skill` listener; needs a composition test |
| `.cursor/rules/*.mdc`, `.kiro/steering/*.md`, description-matched and manual rules | spike 02 §4.2 | slice 1 scope is `.claude/rules` with `paths:` |
| `~/.claude.json` and Claude Desktop MCP entries, `.mcpb` | spike 02 §5.2, research §5.1 | project `.mcp.json` only |
| Mock-LLM composition test over the shipped `web` profile | spike 02 §1.5 | the helper `production-profile.ts` is repository-internal; slice 1 verifies composition with the drift test, the dump checks, and the plan-00 smoke boot |
| Reading through `ctx.fs` | spike 02 §1.1 | host filesystem only in slice 1 |

## Self-Review

**Spec coverage**

| Requirement | Task |
|---|---|
| AIR preset row `preset-air`, `agent-preset-registry` `default: air` | 9 |
| `skill-filesystem` `includeDefaultRoots: false` plus AIR skill provider in the preset layer | 3, 9 |
| `@air/dsh-convention-core`: project root, file watching, frontmatter, tool-name table | 1, 2 |
| Skill roots: project `.dsh/skills`, `.agents/skills`, `.claude/skills`, `.claude/commands` as skills, `~/.air/skills`; `~/.agents/skills` and `~/.claude/skills` opt-in through Config | 3 |
| `~/.claude/CLAUDE.md`, `@path` imports (4 hops, allowlist outside the project), `.claude/rules` with `paths:` | 4, 5 |
| `.mcp.json` to per-Agent `mcp-client` children through `createScope` and `scope.ctx.plugin(McpClient)`; consent file | 6, 7 |
| Commands with `$ARGUMENTS` through scoped `ctx.commands` and `agent.followup` with source `air-command` | 8 |
| Instructions companion with source `air-instructions` | 5 |
| Bundle `dependencies` `workspace:*` and rows; verification with the `air` profile | 9 |
| Unit tests, native Loader test, README (Summary, Model Experience, Known Limitations), JSDoc per product-visible plugin | 3, 5, 7, 8 (and README for the library in 2) |
| No new session event types; AIR state under `dshHomePath('air', ...)` | 5, 7, 8 |
| No upstream edits | 9 Step 10 |

**Placeholder scan:** every code step contains the full file content; every command has an expected result. The three troubleshooting notes (Task 3 Step 9, Task 5 Step 5, Task 7 Step 5) name the exact upstream file to compare against.

**Type consistency:** `UserHomes`, `resolveUserHomes(config)`, `findProjectRoot(cwd, markers)`, `listMarkdownTree(root, maxDepth)`, `readTextFile(path)`, `parseFrontmatter(raw)`, `stringField`, `booleanField`, `stringListField`, `toKebabName`, and `PathWatcher.retain/close/paths` are defined in Tasks 1-2 and used with the same signatures in Tasks 3-8. `ServerSpec`, `approvalKey(projectRoot, spec)`, and `ApprovalStore.has/add/remove` are defined in Task 6 and used in Task 7. Row ids and configs in Task 9 match the plugin names and Config fields of Tasks 3, 5, 7, 8. The `stubAgent(ctx, cwd)` helper is repeated verbatim in three packages because test files do not cross package boundaries.

**Assumptions the executor should confirm at the first failing step, not before:** (1) `ctx.logger.warn(message)` is callable on a bare `Context` in unit tests (upstream plugins call it the same way); (2) the upstream MCP client accepts the fixture server's handshake; (3) the `--dump-config` output quotes row names with single quotes. The `preset-air` YAML in Task 9 and the `customTags` handling of `!!js` were checked against the upstream `standard` preset with `yaml` 2.9.0 while writing this plan: the two lists differ only by the declared changes.
