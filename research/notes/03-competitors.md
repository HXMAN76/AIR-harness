# 03 — Competitor and Ecosystem Research: Agent Products and Markdown-as-Configuration

Research date: 2026-09-28. Method: web research against vendor documentation, standards sites, vendor blogs, and press coverage. Every claim carries its source URL inline.

**Evidence labels used throughout**

- **[Docs]**: verified by reading the vendor's own documentation, specification, or official blog in September 2026.
- **[Press]**: reported by third-party press, reviews, or community posts. Treat these as unconfirmed.
- **[Not verified]**: the capability may exist, but this pass found no source for it. The feature matrix marks these cells `?`.

---

## 0. Executive summary

1. **The file conventions have converged, and open standards now govern them.** Three open formats cover most of the ecosystem. Instructions go in `AGENTS.md`, which the Linux Foundation's Agentic AI Foundation has stewarded since December 2025. Procedures go in `SKILL.md` under the Agent Skills standard at agentskills.io, published by Anthropic on 2025-12-18. Tools go in MCP plus the `.mcpb` bundle format. A fourth standard for packaging, **Agent Plugins** (`plugin.json`), launched on 2026-08-07. Its founders are Amazon, Cursor, Microsoft, OpenAI, and Vercel. Anthropic is absent, so Claude Code's `.claude-plugin/plugin.json` format now competes with it.
2. **Claude Code's Markdown files work for three reasons.** First, only a small amount of metadata is always in context, and the full body loads on demand (progressive disclosure). Second, the format is the model's native medium. Third, the files live in git beside the code. The documentation also states the limit: "Claude treats them as context, not enforced configuration". Enforcement needs hooks, permissions, and a sandbox ([Claude Code memory docs](https://code.claude.com/docs/en/memory)).
3. **The main failure mode is that skills do not fire reliably.** Vercel's January 2026 evals found that a skill was never invoked in 56% of cases. A compressed docs index in `AGENTS.md` scored 100% ([Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)).
4. **The main security failure is the third-party skill supply chain.** One large study found that 26.1% of 31,132 skills had at least one vulnerability ([arXiv 2601.10338](https://arxiv.org/html/2601.10338)). OpenClaw's ClawHub registry hosted hundreds of credential-stealing skills in February 2026 ([Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/), [Dark Reading](https://www.darkreading.com/cyber-risk/malicious-openclaw-skills-clawhub-threaten-ai-supply-chain)).
5. **No product combines all five of the following:** open source, local-first, model-agnostic, a desktop-class user experience, and security the user can verify. That combination is the opening for this project. The recommended approach is to read every major convention as written, then add enforcement, signing, and auditing that competitors lack.

---

## 1. Per-product analysis

### 1.1 Claude Code (Anthropic)

**Architecture.** Claude Code is an agent loop with built-in tools: file read/edit, Bash, web, subagents, and MCP. It ships as a CLI, IDE extensions, the desktop app, and cloud sessions at claude.ai/code. The same loop is exposed as the **Claude Agent SDK** for Python and TypeScript. By default the SDK loads no filesystem configuration. Callers opt in with `settingSources: ['user','project']` ([Agent SDK skills](https://platform.claude.com/docs/en/agent-sdk/skills)) [Docs]. Claude Code is proprietary; its source is not open.

**Extension model: which parts are files and which are code** [Docs]

- **Memory and instructions (Markdown).** Files load in this order: managed policy `CLAUDE.md` (`/etc/claude-code/CLAUDE.md` on Linux), `~/.claude/CLAUDE.md`, `./CLAUDE.md` or `./.claude/CLAUDE.md`, then `./CLAUDE.local.md` ([memory docs](https://code.claude.com/docs/en/memory)).
  - Files from the filesystem root down to the working directory are concatenated, not overridden. Subdirectory files load lazily when Claude reads a file in that subdirectory.
  - `@path` imports are expanded, with a maximum depth of 4 hops. Imports from outside the project need approval.
  - The docs advise keeping each file under 200 lines. A `CLAUDE.md` up to 4 MiB loads in full.
  - `.claude/rules/*.md` holds rules that can be scoped with `paths:` frontmatter, so they load only for matching files.
  - `AGENTS.md` is read natively (v2.1.277 and later). It is used when no `CLAUDE.md` exists, or alongside `CLAUDE.md` if the user configures that.
  - `/doctor prompt-audit` checks the instruction files for contradictions and stale content.
- **Auto memory (Markdown written by the agent).** The location is `~/.claude/projects/<project>/memory/`.
  - A `MEMORY.md` index sits next to one topic file per memory. Each memory has a `type` of `user`, `feedback`, `project`, or `reference`.
  - Only the first 200 lines or 25 KB of `MEMORY.md` load at session start. Topic files are read on demand.
  - The memory is local to one machine and shared across worktrees. It is on by default and toggled with `/memory` or `autoMemoryEnabled` ([memory docs](https://code.claude.com/docs/en/memory)).
- **Skills (Markdown folders).** A skill lives at `.claude/skills/<name>/SKILL.md`. Skills also load from `~/.claude/skills/`, from nested directories, from plugins, and from enterprise policy.
  - Claude Code supports the open-standard fields and adds its own: `disable-model-invocation`, `user-invocable`, `context: fork`, `agent`, `model`, `effort`, `allowed-tools`, `disallowed-tools`, `paths`, `arguments`, `argument-hint`, `hooks`, and `when_to_use`.
  - The description plus `when_to_use` is truncated at 1,536 characters in the skill listing.
  - `` !`cmd` `` runs a shell command and injects its output. These commands pass permission checks and time out after 2 minutes.
  - **Slash commands have been merged into skills.** Legacy files in `.claude/commands/*.md` still work ([skills docs](https://code.claude.com/docs/en/skills)).
- **Subagents (Markdown).** A subagent is defined in `.claude/agents/*.md` or `~/.claude/agents/*.md`.
  - Frontmatter fields include `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `skills`, `memory` (`user`, `project`, or `local`), `maxTurns`, `isolation: worktree`, `background`, `mcpServers`, and `hooks`.
  - Each subagent gets a fresh context. Nesting is allowed up to 3 levels deep by default ([sub-agents docs](https://code.claude.com/docs/en/sub-agents)).
- **Hooks (JSON config that runs code).** Hooks are declared in `settings.json` at user, project, local, or managed scope. They can also come from a plugin's `hooks/hooks.json` or from skill and agent frontmatter.
  - There are about 30 events, including `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SubagentStop`, `PreCompact`, and `InstructionsLoaded`.
  - Handler types are `command`, `http`, `mcp_tool`, `prompt`, and `agent`.
  - Exit code 2 blocks the action. JSON output can set `permissionDecision` or `updatedInput` ([hooks docs](https://code.claude.com/docs/en/hooks)).
- **Plugins and marketplaces (JSON manifest plus files).** A plugin has a manifest at `.claude-plugin/plugin.json` plus `skills/`, `agents/`, `hooks/hooks.json`, and `.mcp.json`.
  - A marketplace is a git repository or directory containing `.claude-plugin/marketplace.json`.
  - `claude-plugins-official` is added automatically. Installs are scoped to user, project, or local.
  - Every enabled plugin's descriptions cost context tokens on every turn. The docs show a "Context cost" estimate and state that "what the plugin runs, it runs as you" ([plugins docs](https://code.claude.com/docs/en/plugins)).
- **Output styles.** These are Markdown files under `.claude/`; the prompt-audit command lists them among the files it checks ([memory docs](https://code.claude.com/docs/en/memory)).

**Permissions and safety** [Docs]

- Permission modes are `default`, `acceptEdits`, `plan`, `auto` (classifier-based), `dontAsk`, and `bypassPermissions`. Allow, ask, and deny rules work at the level of individual tools, for example `Bash(git *)`.
- The OS-level Bash sandbox uses Seatbelt on macOS and bubblewrap plus socat on Linux and WSL2. Native Windows is not supported.
  - A filesystem allowlist and a network domain allowlist are enforced through a proxy.
  - The optional seccomp filter ships as `@anthropic-ai/sandbox-runtime`.
  - Credential **masking** shows the sandboxed process a sentinel value. The proxy substitutes the real secret only on requests to allowed hosts. A repository's own settings cannot enable masking.
  - An escape hatch, `dangerouslyDisableSandbox`, retries a blocked command outside the sandbox and goes through the normal permission flow. Setting `allowUnsandboxedCommands: false` disables it ([sandboxing docs](https://code.claude.com/docs/en/sandboxing)).

**Scheduling, voice, and multiple clients** [Press]

- `/voice` push-to-talk arrived in March 2026 ([pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/381/claude-code-march-2026-updates)).
- **Routines** entered research preview on 2026-04-14. They are cloud sessions triggered by a schedule, an HTTP API call, or a GitHub event ([The New Stack](https://thenewstack.io/claude-code-can-now-do-your-job-overnight/), [MakerKit](https://makerkit.dev/blog/tutorials/claude-code-routines-guide)).
- The desktop app has its own scheduled tasks ([docs](https://code.claude.com/docs/en/desktop-scheduled-tasks)).

**What users praise and complain about**

- *Praise:* Simon Willison called skills "maybe a bigger deal than MCP" (2025-10-16) because they are simple and cheap in tokens ([simonwillison.net](https://simonwillison.net/2025/Oct/16/claude-skills/)).
- *Complaints:* usage limits. Max-plan users reported 5-hour windows running out in minutes after 2026-03-23 ([The Register, Jan 2026](https://www.theregister.com/2026/01/05/claude_devs_usage_limits/), [laozhang.ai](https://blog.laozhang.ai/en/posts/claude-code-max-quota-consumption)) [Press].
- *Complaints:* Claude ignoring rules in `CLAUDE.md` ([shareuhack](https://www.shareuhack.com/en/posts/claude-code-claude-md-setup-guide-2026)) [Press].
- *Constraints:* the source is closed, and Anthropic models are the only officially supported models.

### 1.2 Claude Desktop, Cowork, Claude in Chrome, and computer use (Anthropic)

- **MCP and Desktop Extensions.** Claude Desktop hosts local MCP servers. The Desktop Extensions format `.dxt` was renamed **MCP Bundles (`.mcpb`)** and moved into the MCP project on 2025-11-20 ([MCP blog](https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/)) [Docs].
  - A bundle is a zip archive containing `manifest.json`. `server.type` is one of `node`, `python`, `binary`, or `uv`.
  - The manifest also declares `mcp_config`, `user_config` (typed fields with a `sensitive` flag), `compatibility` (platforms and runtimes), `tools`, `prompts`, and `privacy_policies`.
  - The manifest spec does not describe signing ([MANIFEST.md](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)). Sources disagree on whether the current manifest version is 0.3 or 0.4.
  - Supported clients are Claude Desktop, Claude Code, and MCP for Windows.
- **Cowork.** Cowork launched on 2026-01-12 as a macOS research preview described as "Claude Code for the rest of your work" [Press].
  - It booted a Linux VM through Apple's Virtualization Framework and worked on a folder the user granted ([InfoQ](https://www.infoq.com/news/2026/01/claude-cowork/), [ADTmag](https://adtmag.com/articles/2026/01/20/anthropic-expands-claude-computer-agent-with-cowork.aspx)).
  - Windows support followed on 2026-02-10 [Press].
  - The help center (September 2026) now describes Cowork as a cloud service on Anthropic servers. It is available on desktop, web, mobile, and the Chrome side panel, and it can reach local files when the desktop app is connected.
  - It uses connectors, plugins (skills plus subagents), and Claude in Chrome. Permission modes are Manual, Auto, and Skip, and file deletion requires explicit permission ([help center](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)) [Docs].
  - Scheduled tasks run in the cloud as of July 2026. A "Customize" section groups skills, plugins, and connectors, and Team and Enterprise plans get a plugin marketplace ([search summary of release notes](https://support.claude.com/en/articles/12138966-release-notes)) [Press].
- **Computer use and Dispatch.** Computer use in the desktop app was announced on 2026-03-23 for macOS Pro and Max users, with Windows following shortly after. **Dispatch** assigns tasks from a paired phone to the Mac ([Claude blog](https://claude.com/blog/dispatch-and-computer-use), [DevOps.com](https://devops.com/claude-code-can-now-run-your-desktop/)) [Docs/Press].
- **Gaps.** There is no Linux desktop app ([Medium](https://medium.com/@mara.ellorin/built-on-linux-but-not-for-linux-users-fddc6792b594)) [Press]. Claude Desktop and Cowork are closed source and cloud-tethered, and memory is not portable.

### 1.3 Agent Skills open standard (agentskills.io)

- **Format** [Docs] ([specification](https://agentskills.io/specification)). A skill is a folder with `SKILL.md` and optional `scripts/`, `references/`, and `assets/` directories.
  - Required frontmatter: `name`, 1–64 characters of `a-z0-9-`, with no leading, trailing, or doubled hyphens, matching the directory name. `description`, 1–1024 characters.
  - Optional frontmatter: `license`, `compatibility` (up to 500 characters), `metadata` (a string-to-string map), and `allowed-tools`, which is experimental.
  - Disclosure budget: metadata of about 100 tokens is always loaded, the body should stay under 5,000 tokens and 500 lines, and resources load on demand. File references should go only one level deep.
  - Validator: `skills-ref validate ./my-skill`.
- **History.** Anthropic introduced skills on 2025-10-16 ([Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) and published them as an open standard on 2025-12-18 ([Strapi summary](https://strapi.io/blog/what-are-agent-skills-and-how-to-use-them)) [Press for the date].
- **Adopters listed on agentskills.io** (as of 2026-09-28) [Docs]: Claude, Claude Code, ChatGPT & Codex, Cursor, GitHub Copilot, VS Code, Gemini CLI, Kiro, OpenCode, Goose, OpenHands, Roo Code, Hermes Agent, OpenClaw, Letta, Amp, Factory, Junie (JetBrains), TRAE, Tabnine, Qodo, Mistral Vibe, Databricks, Snowflake Cortex Code, Spring AI, Google AI Edge Gallery, and others ([agentskills.io](https://agentskills.io/home)).
  - Qoder is **not** listed, although it uses `SKILL.md` ([Qoder docs](https://docs.qoder.com/extensions/skills)).

### 1.4 AGENTS.md and Agent Plugins (standards)

- **AGENTS.md** [Docs]. The file is plain Markdown with no required fields. When files are nested, the closest one wins, and explicit user prompts override file contents.
  - It was released in August 2025 by the OpenAI Codex team with Amp, Jules, Cursor, and Factory. It became a founding project of the **Agentic AI Foundation (AAIF)** at the Linux Foundation in December 2025, alongside MCP and goose.
  - More than 60,000 repositories use it. Readers include Codex, Cursor, Copilot, Gemini CLI, Jules, VS Code, Zed, Warp, Aider, Devin, Factory, and Claude Code (natively since v2.1.277) ([agents.md](https://agents.md), [Linux Foundation press release](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)).
- **Agent Plugins.** The standard launched on 2026-08-07 at version 1.0.0. The layout is `plugin.json`, a `skills/` directory of Agent Skills, and `mcp.json`, with client-specific extensions namespaced by reverse domain.
  - The Technical Steering Committee includes Amazon, Cursor, Microsoft, OpenAI, and Vercel. At launch it was supported by ChatGPT/Codex, Cursor, GitHub Copilot, Kiro, and VS Code. Anthropic is not a member ([agent-plugins.org](https://agent-plugins.org/), [The Decoder](https://the-decoder.com/amazon-cursor-microsoft-openai-and-vercel-unite-on-a-shared-standard-for-ai-agent-plugins/)) [Docs/Press].
  - Cline CLI already discovers packages under `~/.agents/plugins/*` ([Cline CLI changelog](https://github.com/cline/cline/blob/main/apps/cli/CHANGELOG.md)) [Press summary].

### 1.5 Qoder (Alibaba)

- **Architecture.** Qoder launched on 2025-08-21 as an agentic IDE, and later added a JetBrains plugin, a CLI, and a mobile app ([Yahoo Finance](https://finance.yahoo.com/news/alibaba-launches-qoder-agentic-coding-133000732.html)) [Press].
  - **Quest Mode** is autonomous delegation: it writes a spec, implements it, and tests it. "Quest Experts Mode" coordinates several agents in parallel.
  - Qoder 1.0 (2026-05-15) moved Quest to its own window and added parallel tasks across projects. **Cloud Agents** followed on 2026-05-28. The Chinese product Tongyi Lingma was renamed "Qoder CN" on 2026-05-20 [Press].
- **Extensions** [Docs]. The docs cover Skills (`~/.qoder/skills/<name>/SKILL.md` and `.qoder/skills/`, where the project copy wins), Custom Agents (`.qoder/agents/<name>.md`), Plugins, MCP, Hooks, Commands, Rules (`.qoder/rules/**.md`), Deeplinks, and Canvas ([skills](https://docs.qoder.com/extensions/skills), [subagents](https://docs.qoder.com/en/cli/user-guide/subagent)).
  - The layout closely mirrors Claude Code's `.claude/` layout.
- **Memory** [Docs]. Qoder keeps automatic long-term memory of your style and project, which you can view and delete in Settings under Memories. When rules and memory conflict, rules win ([memory](https://docs.qoder.com/user-guide/chat/memory)).
  - **Repo Wiki** generates documentation in `.qoder/repowiki`, which can be committed and shared through git ([Repo Wiki](https://docs.qoder.com/user-guide/repo-wiki)).
- **Distribution and pricing.** Pricing is credit-based, sold in blocks of 1,500 credits, with a 14-day Pro trial ([pricing](https://docs.qoder.com/account/pricing)) [Docs].
- **Praise and complaints** [Press, 2025-08] ([Jimmy Song review](https://jimmysong.io/blog/qoder-alibaba-ai-ide-personal-review/)):
  - Praise: hybrid vector plus code-graph retrieval, and a visible execution flow.
  - Complaints: Repo Wiki generation takes 2–3 hours for medium projects, analysis tops out around 6,000 files, results depend heavily on spec quality, and pricing was unclear.
- **Constraints.** Qoder is closed source and cloud-model only.

### 1.6 Cursor (Anysphere)

- **Rules** [Docs] ([rules](https://cursor.com/docs/context/rules)). Rules live in `.cursor/rules/*.mdc` with frontmatter `description`, `globs`, and `alwaysApply`. A plain `.md` file in that folder is ignored.
  - The four modes are Always, Apply Intelligently (chosen by description), Specific Files (matched by glob), and Manual (`@`-mention).
  - User rules, Team rules, and `AGENTS.md` (nested) are also supported. Precedence is Team, then Project, then User. The current rules docs do not mention "Memories" [Not verified whether that feature still exists].
- **Skills, subagents, hooks, and plugins** [Docs/Press]. Since about February 2026 Cursor supports skills, subagents, and hooks.
  - Plugins bundle rules, skills, agents, commands, MCP, and hooks. They use either `.cursor-plugin/plugin.json` or the Agent Plugins `plugin.json`.
  - Official plugins are distributed through the Cursor Marketplace after manual review, community plugins through cursor.directory, and team marketplaces are private ([plugins](https://cursor.com/docs/plugins)).
- **Cloud agents** [Docs/Press]. Each cloud agent gets its own VM. Since 2026-02-24 it has a full desktop with computer use, video recording, and a human takeover mode ([changelog](https://cursor.com/changelog/02-24-26), [blog](https://cursor.com/blog/agent-computer-use)).
- **Complaints** [Press]. The switch to credit pricing in June 2025 caused a backlash, and Cursor apologized and issued refunds on 2025-07-04. Unpredictable usage costs still dominate complaints in 2026 ([wearefounders](https://www.wearefounders.uk/cursors-pricing-disaster-the-full-timeline-of-how-an-ai-coding-darling-burned-its-most-loyal-users/), [finout](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips)).
- **Constraints.** Cursor is closed source.

### 1.7 OpenAI Codex CLI, the Codex app, and ChatGPT desktop

- **Codex CLI.** The CLI is open source and originated `AGENTS.md`.
  - Configuration lives in `~/.codex/config.toml`, with team layers under `.codex/`.
  - OS sandbox: Seatbelt on macOS, and bubblewrap or Landlock plus seccomp on Linux. The sandbox modes are `read-only`, `workspace-write`, and `danger-full-access`. The approval policy is set separately from the sandbox mode ([blakecrosley guide](https://blakecrosley.com/guides/codex), [codex KB](https://codex.danielvaughan.com/2026/03/31/codex-cli-network-security-requirements-toml/)) [Press/secondary].
- **Skills** [Docs] ([build-skills](https://learn.chatgpt.com/docs/build-skills)). Codex looks for skills in `.agents/skills` in the repository, `$HOME/.agents/skills` for the user, `/etc/codex/skills` for admins, and a set of built-in system skills.
  - Skills are compatible with agentskills.io. They are invoked with `$skill-name` in the CLI or `@skill` in ChatGPT, or implicitly.
  - An optional `agents/openai.yaml` sets UI metadata, the invocation policy, and MCP dependencies. The skill list is capped at about 8,000 characters.
  - **Note:** `.agents/` is emerging as the vendor-neutral directory name.
- **Codex app** [Press]. The desktop app launched on 2026-02-02. The "Codex for (almost) everything" update on 2026-04-16 added computer use (macOS first), an in-app browser, a memory preview, more than 90 plugins, automations, and SSH devboxes ([Help Net Security](https://www.helpnetsecurity.com/2026/04/17/openai-codex-desktop-update-macos/), [buildfastwithai](https://www.buildfastwithai.com/blogs/openai-codex-for-almost-everything-2026)).
- **ChatGPT Atlas and ChatGPT desktop.** The Atlas browser (October 2025, macOS only) was shut down on 2026-08-09. Its agentic browsing moved into ChatGPT and a new ChatGPT desktop app ([OpenAI help](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work), [BGR](https://www.bgr.com/2212396/openai-chatgpt-browser-atlas-discontinued/)) [Docs/Press].

### 1.8 Gemini CLI, now Antigravity CLI (Google)

- **Status change.** On 2026-05-19 Google announced that Gemini CLI would move to **Antigravity CLI** (`agy`). Gemini CLI stopped serving consumer accounts on 2026-06-18; enterprise Code Assist customers keep v0.50.0 ([Google Developers Blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)) [Docs].
  - Agent Skills, Hooks, Subagents, and Extensions carry over, with extensions becoming "Antigravity plugins" [Docs].
  - Press describes Antigravity CLI as a closed-source Go binary ([botmonster](https://botmonster.com/coding/gemini-cli-dead-migrate-antigravity-cli-2026/), [digitalapplied](https://www.digitalapplied.com/blog/gemini-cli-to-antigravity-cli-migration-june-18-2026-guide)) [Press].
- **Gemini CLI extension model (historical, open source)** [Docs] ([extensions docs](https://geminicli.com/docs/extensions/)):
  - Manifest `gemini-extension.json`, installed under `~/.gemini/extensions`.
  - `GEMINI.md` context files and TOML commands.
  - `skills/<name>/SKILL.md`, `hooks/hooks.json`, and `agents/*.md`.
- **Lesson.** An open-source CLI with more than 100,000 GitHub stars was withdrawn for consumers. Vendor-controlled tools can disappear, which argues for an open, standards-based harness.

### 1.9 Kiro (AWS)

- **Specs** [Docs]. A spec moves through requirements (user stories with acceptance criteria), design, and tasks ([Kiro docs](https://kiro.dev/docs/)).
- **Steering** [Docs] ([steering](https://kiro.dev/docs/steering/)). Steering files are Markdown in `.kiro/steering/` or `~/.kiro/steering/`.
  - Frontmatter `inclusion:` takes `always`, `fileMatch` (with `fileMatchPattern`), `manual` (`#name`), or `auto` (matched by description).
  - The foundation files are `product.md`, `tech.md`, and `structure.md`. `AGENTS.md` is always included. Other files are referenced with `#[[file:path]]`.
- **Hooks** [Docs/secondary]. Hooks are JSON files at `.kiro/hooks/<id>.json`, triggered by file changes, tool use, or task events ([hooks](https://kiro.dev/docs/hooks/)).
- **Powers** [Press/secondary]. A Power is a one-click bundle of MCP servers, steering, and hooks ([AWS Builder Center](https://builder.aws.com/content/3CSqR2TiDguv0Pg6EKn1LLswZ5i/building-production-ready-agents-with-kiro-steering-powers-hooks-specs-and-skills)).
- **Standards.** Kiro supports Agent Skills and Agent Plugins.
- **Constraints.** Kiro is closed source.

### 1.10 OpenCode (open source)

- **Instructions** [Docs]. `AGENTS.md` is canonical and `CLAUDE.md` is a fallback ([rules](https://opencode.ai/docs/rules/)).
- **Skills** [Docs]. OpenCode searches `.opencode/skills/`, `~/.config/opencode/skills/`, **`.claude/skills/`**, and **`.agents/skills/`**. It enforces the agentskills.io name regex. Skill permissions (`allow`, `deny`, and glob patterns) are set per agent in `opencode.json` ([skills](https://opencode.ai/docs/skills/)).
- **Code plugins** integrate external systems. Bash permissions can be set to `ask` or allowlisted with globs ([BSWEN guide](https://docs.bswen.com/blog/2026-03-05-opencode-plugins-skills-agents/)) [Press].
- **Why it matters here.** OpenCode is the clearest example of the "read everyone's conventions" strategy this project should copy.

### 1.11 Goose (Block, now AAIF)

- **Architecture** [Docs] ([goose-docs.ai](https://goose-docs.ai/)). Goose is a Rust agent with a desktop app (macOS, Linux, Windows), a CLI, and an API. It is Apache-2.0 licensed and governed by AAIF. The repository moved to `github.com/aaif-goose/goose` in April 2026 [Press].
- **Extensions.** Extensions are MCP servers; the project lists more than 70.
- **Recipes.** Recipes are YAML files that bundle instructions, extensions, provider and model, parameters, sub-recipes, retry logic, and a response schema ([kspl](https://academy.kspl.tech/blog/ai-tool-deep-dive-goose)) [Press].
- **Other features.** Goose supports skills and subagents. It supports more than 15 providers, including Ollama, and Claude, ChatGPT, and Gemini subscriptions via ACP.
- **Security.** Goose ships prompt-injection detection, tool permission controls, a sandbox mode, and an "adversary reviewer" [Docs].
- **Why it matters here.** Goose is the closest open-source analogue to a local-first desktop personal agent.

### 1.12 Cline and Roo Code (and Kilo Code)

- **Cline** [Docs/Press].
  - Rules live in `.clinerules`. Plan/Act modes separate planning from execution.
  - **Memory Bank** began as a prompting convention: Markdown files such as `projectbrief.md` that the agent maintains, refreshed on request with "update memory bank" ([Cline docs](https://docs.cline.bot/prompting/cline-memory-bank)).
  - Skills load from `.cline/skills/` and `~/.cline/data/settings/skills/` (open standard). Hooks exist, and Agent Plugins are read from `~/.agents/plugins/*` ([Cline 3.48](https://cline.ghost.io/cline-3-48-0-skills-and-websearch-make-cline-smarter/), [changelog](https://github.com/cline/cline/blob/main/apps/cli/CHANGELOG.md)).
  - Cline is Apache-2.0 licensed and model-agnostic, including local models.
- **Roo Code** [Press]. Roo Code was known for its Modes: Architect, Code, Debug, Ask, and Orchestrator, each with its own model and permissions. **It shut down on 2026-05-15**, and its repository (24,000+ stars) was archived. The team moved to a cloud agent, Roomote, and Cline absorbed its users ([The New Stack](https://thenewstack.io/roo-code-cloud-ides-ai-coding/), [Cline on X](https://x.com/cline/status/2046645935762198953)). Kilo Code continues the fork line.

### 1.13 OpenHands

- **Architecture** [Docs/Press]. The OpenHands Software Agent SDK has a stateless Agent, a Conversation that keeps an append-only EventLog, a Workspace (local or Docker), and LiteLLM for model providers ([arXiv 2511.03690](https://arxiv.org/html/2511.03690v2)).
- **Skills** [Docs]. Skills replace V0 "microagents", and V1 still reads the V0 layout ([skills README](https://github.com/OpenHands/OpenHands/blob/main/skills/README.md)).
- **Runtimes.** Docker is the default sandbox runtime; local and remote runtimes also exist ([docs](https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox)).
- **Other.** OpenHands is MIT licensed. Its architecture is the closest match to this harness's design rule "model-visible ⟺ logged".

### 1.14 Open Interpreter and 01

- The 01 Light hardware was cancelled and pre-orders refunded. The team moved to a 01 voice app that remotely controls a desktop ([changes.openinterpreter.com](https://changes.openinterpreter.com/log/01-app)) [Docs].
- A new Rust version based on Codex has been reported ([GitHub](https://github.com/openinterpreter/openinterpreter)) [Press summary].
- **Lesson.** A voice-first personal agent is still unsolved as a product.

### 1.15 Hermes Agent (Nous Research)

- **Overview** [Docs] ([docs](https://hermes-agent.nousresearch.com/docs/)). Hermes was released in February 2026 under the MIT license. It runs as a CLI, a desktop app, an OpenAI-compatible API, and a **gateway to more than 20 messaging platforms**, including Telegram, Discord, Slack, WhatsApp, Signal, Matrix, and Teams.
- **Learning loop.** The agent curates its own `MEMORY.md`, uses SQLite FTS5 for recall across sessions, and **creates and improves skills itself**. Skills are compatible with agentskills.io, and a Skills Hub hosts shared ones.
- **Execution and scheduling.** There are 7 terminal backends: local, Docker, SSH, Daytona, Singularity, Modal, and Vercel Sandbox. Built-in cron delivers results to any platform. Voice mode works in the CLI, Telegram, and Discord.
- **Release cadence.** v0.21.1 shipped on 2026-09-07 ([search summary](https://www.mayhemcode.com/2026/09/hermes-agent-review-2026-features.html)) [Press].
- **Why it matters here.** Hermes is the strongest open "Jarvis" competitor on features. It is weakest on verifiable security.

### 1.16 OpenClaw (formerly Clawdbot)

- **Overview** [Press]. OpenClaw is an open-source local personal assistant that runs on the user's device. It started as Clawdbot and was renamed at the end of January 2026. It has a skill registry, **ClawHub**.
- **The February 2026 security crisis:**
  - 386 malicious skills were found between February 1 and 3, later more than 800 (about 20% of the registry). They posed as crypto tools and installed infostealers ([Paubox](https://www.paubox.com/blog/malicious-crypto-skills-compromise-openclaw-ai-assistant-users), [Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)).
  - An RCE vulnerability, CVE-2026-25253, was disclosed ([Hive Security](https://hivesecurity.gitlab.io/blog/openclaw-ai-agent-security-crisis-2026/), [Bitdefender](https://businessinsights.bitdefender.com/technical-advisory-openclaw-exploitation-enterprise-networks)).
- **Why it matters here.** OpenClaw proves both halves of the thesis: users want a local Jarvis, and an open skill registry without verification becomes a malware channel.

### 1.17 Manus (Meta)

- **Acquisition** [Press]. Meta acquired Manus in late 2025, reportedly for $2–3B. China's state planner ordered the deal unwound on 2026-04-27 ([codersera](https://codersera.com/blog/manus-ai-2026-status-meta-block-desktop-app/)).
- **Desktop app** [Press]. The **"My Computer"** desktop app for macOS and Windows launched on 2026-03-16 to 2026-03-18. It reads and edits local files, runs terminal commands, and controls apps, which moved Manus beyond cloud-only execution ([CNBC](https://www.cnbc.com/2026/03/18/metas-manus-launches-desktop-app-to-bring-its-ai-agent-onto-personal-devices.html)).
- **Constraints.** Manus is closed and cloud-model only.

### 1.18 OS and browser agents: Microsoft Copilot Actions and Perplexity Comet

- **Copilot Actions** [Docs] ([Windows security book](https://learn.microsoft.com/en-us/windows/security/book/operating-system-agentic-security)).
  - Copilot Actions runs in an **Agent Workspace** under a **separate agent account**, a standard account distinct from the user's. It is off by default.
  - It can request access to six known folders. Screenshots are kept for up to 30 days.
  - Microsoft explicitly warns about cross-prompt injection (XPIA) ([SC Media](https://www.scworld.com/news/new-agent-workspace-feature-comes-with-security-warning-from-microsoft)).
  - At Build 2026 Microsoft introduced the **Microsoft Execution Containers (MXC) SDK** and Agent 365 policy for local agents ([Windows Developer Blog](https://blogs.windows.com/windowsdeveloper/2026/06/02/windows-platform-security-for-ai-agents/)).
  - *Lesson:* an OS-level agent identity plus containment is the most rigorous consumer design seen in this survey.
- **Perplexity Comet** [Press]. Comet has been a Chromium agentic browser since July 2025. It has had repeated indirect prompt-injection findings: credential theft, data exfiltration, and session hijack ([TechCrunch](https://techcrunch.com/2025/10/25/the-glaring-security-risks-with-ai-browser-agents/), [AIMultiple](https://research.aimultiple.com/ai-browser-security/)).

---

## 2. Why Markdown-as-configuration works

The user observed that Claude Code's agents, skills, commands, and memory, all kept as plain Markdown files, "work rather than failing". The evidence points to eight mechanisms, each of which can be copied, and to five failure modes that need engineering.

### 2.1 The mechanisms

1. **Progressive disclosure keeps context cheap.** The agent loads content in three levels:
   - At startup it loads only the name and description of each skill (about 100 tokens).
   - When a task matches, it loads the full body (under 5,000 tokens recommended).
   - It reads scripts and references only when the body points to them ([agentskills.io](https://agentskills.io/home), [spec](https://agentskills.io/specification)).

   Anthropic calls the resulting capacity "effectively unbounded", because the filesystem holds the detail and the context window does not ([Anthropic engineering, 2025-10-16](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)). Claude Code applies the same pattern to lazily loaded subdirectory `CLAUDE.md` files, `paths:`-scoped rules, and auto-memory topic files behind a 200-line index. The design keeps tokens spent in proportion to relevance.
2. **Markdown is the format models already read.** Instructions written as Markdown need no translation layer, schema, or compiler. The model reads the same bytes the human wrote. Headings, lists, and code fences are the structures models saw most in training data and chat formatting. The YAML frontmatter is the only part the machine parses, and it is kept tiny: `name`, `description`, and a few switches.
3. **The files are text, so they fit in git.** Instructions are versioned, reviewed in pull requests, blamed, and reverted like code. Claude Code's scope layers map onto git behaviour: `CLAUDE.md` is committed, `CLAUDE.local.md` is gitignored, and the user file `~/.claude/` is never shared ([memory docs](https://code.claude.com/docs/en/memory)). Qoder's `.qoder/repowiki` and Kiro's `.kiro/steering` follow the same rule.
4. **No build step, no runtime, no API.** A skill can be a single file. Simon Willison's comparison: MCP needs a server and a protocol, while a skill is "a Markdown file telling the model how to do something" ([simonwillison.net](https://simonwillison.net/2025/Oct/16/claude-skills/)). Non-programmers can author them, and the agent can write them too. Hermes goes further and creates and improves its own skills ([Hermes docs](https://hermes-agent.nousresearch.com/docs/)).
5. **Scripts handle the steps that must be deterministic.** A skill can bundle `scripts/`. The prose tells the model *when* to act, and the code does the work that must be exact, such as parsing a PDF form or sorting. Anthropic states this split explicitly ([Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)).
6. **The pieces compose.** A skill can preload into a subagent (`skills:` field), fork into one (`context: fork`), declare its own hooks, and ship inside a plugin that also carries MCP servers. Every layer is a folder, so composing them is just a directory tree ([skills](https://code.claude.com/docs/en/skills), [sub-agents](https://code.claude.com/docs/en/sub-agents)).
7. **The same file works across tools.** The same `SKILL.md` runs in more than 40 clients ([agentskills.io](https://agentskills.io/home)). The same `AGENTS.md` works in more than 25 tools and over 60,000 repositories ([agents.md](https://agents.md)). Claude Code, OpenCode, Kiro, and Cursor all read `AGENTS.md`. OpenCode reads `.claude/skills/`. Claude Code's `/import` copies other agents' instructions, MCP servers, commands, subagents, and skills ([memory docs](https://code.claude.com/docs/en/memory)). Content written once reaches every tool that reads the standard.
8. **Advice and enforcement are kept apart.** This design choice matters most for reliability, and Anthropic documents it plainly. Markdown is context, not enforced configuration. To block an action, you use a `PreToolUse` hook, permission deny rules, or the sandbox ([memory docs](https://code.claude.com/docs/en/memory)). The Markdown layer can be forgiving because a deterministic layer beneath it enforces the rules that must hold.

### 2.2 Failure modes and their mitigations

| Failure mode | Evidence | Mitigations seen in the field |
|---|---|---|
| **Context bloat** | Every enabled skill, agent, and plugin description costs tokens on every turn; Claude Code shows a per-plugin "Context cost" estimate ([plugins](https://code.claude.com/docs/en/plugins)). Longer `CLAUDE.md` files "reduce adherence" ([memory](https://code.claude.com/docs/en/memory)). | Caps on description length (1,536 characters in Claude Code; about 8,000 for the whole Codex list); `skillOverrides` set to `name-only` or `off`; lazy loading by `paths:` glob; a 200-line/25 KB index for memory; MCP tool search. |
| **Conflicting instructions** | "If two rules contradict each other, Claude may pick one arbitrarily" ([memory](https://code.claude.com/docs/en/memory)). | Explicit precedence: closest `AGENTS.md` wins; Team, then Project, then User in Cursor; rules beat memory in Qoder. `claudeMdExcludes` for monorepos. `/doctor prompt-audit` to find contradictions. |
| **Skills not triggering** | Vercel: the skill was never invoked in 56% of cases, scoring 53% (the same as no docs); with explicit instructions 79%; a passive compressed index in `AGENTS.md` 100% (8 KB, down from 40 KB) ([Vercel, 2026-01-27](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)). Small wording changes caused large swings. | Keep essential facts always loaded (`AGENTS.md`) and procedures on demand (skills). Write descriptions that contain trigger keywords. Offer explicit invocation (`/skill`, `$skill`, `@agent`). Use `paths:` auto-attach. Test plugins with evals ([Claude Code plugin evals](https://code.claude.com/docs/en/plugins)). |
| **Advice is not enforcement** | Users report `CLAUDE.md` rules being ignored ([shareuhack](https://www.shareuhack.com/en/posts/claude-code-claude-md-setup-guide-2026)). | Move every rule that must hold into hooks, permission rules, or the sandbox. |
| **Security of third-party skills** | 26.1% of 31,132 marketplace skills had at least one vulnerability across 14 patterns ([arXiv 2601.10338](https://arxiv.org/html/2601.10338)). A January 2026 campaign compromised about 1 in 5 packages in one registry (same source). ClawHub hosted more than 800 malicious skills ([Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)). Once approved, a skill "silently inherits persistent permissions" (arXiv summary). | Namespaced marketplace tiers with manual review (Anthropic official/community/third-party; Cursor manual review). External-import approval dialogs. `disableSkillShellExecution`. Synced cloud skills never run `!` commands locally. The spec's `allowed-tools` field, which is still **experimental**. Sandbox plus credential masking. None of these tools gives a signed, capability-scoped manifest that is enforced at runtime. |

**Conclusion.** Markdown works as a **context-shaping layer** when four things are true: it is disclosed progressively, it is small, it is kept in version control, and it is backed by a deterministic enforcement layer. It fails when a product treats it as the security boundary, or depends on the model choosing to load something critical.

---

## 3. Feature matrix (as of 2026-09-28)

Key: **Y** = verified in docs; **Y\*** = reported by press or secondary sources; **P** = partial or limited; **N** = not offered; **?** = not verified in this pass. "Skills" means Agent Skills (`SKILL.md`) support.

| Capability | Claude Code | Claude Desktop / Cowork | Qoder | Cursor | Codex CLI / app | Antigravity (ex-Gemini CLI) | Kiro | OpenCode | Goose | Cline | OpenHands | Hermes | OpenClaw | Manus |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Skills (SKILL.md) | Y | Y (plugins) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | ? |
| Subagents | Y | Y (plugins) | Y | Y\* | ? | Y | Y\* | Y\* | Y | ? | Y\* | Y\* | ? | ? |
| Hooks | Y | ? | Y | Y\* | ? | Y | Y | Y\* (code plugins) | ? | Y\* | ? | ? | ? | ? |
| Commands | Y (merged into skills) | P | Y | Y | Y\* | Y (TOML) | P | Y\* | P (recipes) | Y\* (workflows) | ? | ? | ? | ? |
| Plugins / marketplace | Y (`marketplace.json`) | Y\* (Team/Ent marketplace) | Y | Y (Marketplace + Agent Plugins) | Y\* (90+ plugins; Agent Plugins) | Y (extensions → plugins) | Y (Powers; Agent Plugins) | Y (code plugins) | P (extension directory) | Y\* (Agent Plugins dir) | ? | Y (Skills Hub) | Y (ClawHub) | ? |
| MCP client | Y | Y (+`.mcpb`) | Y | Y | Y\* | Y | Y | Y\* | Y | Y\* | Y\* | Y | ? | ? |
| Memory | Y (`CLAUDE.md` + auto memory) | P | Y (auto + Repo Wiki) | P (rules; Memories ?) | Y\* (memory preview) | Y (`GEMINI.md`) | Y (steering) | Y (`AGENTS.md`) | ? | Y (rules + Memory Bank) | ? | Y (`MEMORY.md` + FTS5) | Y\* | ? |
| OS sandbox | Y (Seatbelt / bubblewrap) | Y\* (VM, then cloud isolation) | ? | Y\* (cloud VMs) | Y\* (Seatbelt / Landlock / bubblewrap) | ? | ? | P (permission rules) | Y (sandbox mode) | ? | Y (Docker) | Y (Docker / SSH / remote backends) | N\* (RCE CVE) | Y\* (cloud) |
| Voice | Y\* (`/voice`) | Y\* | ? | ? | Y\* | ? | ? | ? | ? | ? | ? | Y | ? | ? |
| Computer use | Y\* (CLI docs) | Y | ? | Y (cloud VMs) | Y\* (macOS) | ? | ? | N | ? | P (browser) | P (browser) | ? | Y\* | Y\* |
| Scheduling / background | Y\* (Routines, desktop tasks) | Y (cloud scheduled tasks) | Y\* (Quest, Cloud Agents) | Y (cloud agents) | Y\* (automations) | ? | ? | ? | Y\* (recipes in CI) | ? | Y\* (headless) | Y (cron) | Y\* | Y\* |
| Multi-client | Y (CLI / IDE / desktop / web) | Y (desktop / web / mobile / Chrome) | Y (IDE / JetBrains / CLI / mobile) | Y (IDE / CLI / web) | Y (CLI / app / IDE / web) | Y (CLI / desktop) | Y (IDE / CLI) | Y (TUI / desktop\*) | Y (desktop / CLI / API) | Y (VS Code / CLI) | Y (web / CLI / SDK) | Y (CLI / desktop / 20+ messaging apps) | Y\* | Y (web / desktop) |
| Local models | N (Anthropic models only) | N | N | P | Y\* | N | N | Y | Y (Ollama) | Y | Y (LiteLLM) | Y (custom endpoints) | Y\* | N |
| Open source license | Proprietary | Proprietary | Proprietary | Proprietary | CLI open source; app proprietary | Closed\* | Proprietary | Open source (MIT\*) | Apache-2.0 | Apache-2.0\* | MIT\* | MIT | Open source\* | Proprietary |

---

## 4. Gaps no product fills well: where an open, local-first, verifiable personal agent can differentiate

1. **Skill and plugin security that the user can verify.**
   - The gap: every product runs skills "as you" ([Claude Code plugins](https://code.claude.com/docs/en/plugins)). The standard's `allowed-tools` field is experimental ([spec](https://agentskills.io/specification)). The MCPB manifest spec does not describe signing ([MANIFEST.md](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)). OpenClaw showed the result.
   - **Opportunity:**
     - Treat `allowed-tools` together with a new capability block (filesystem roots, network hosts, secrets) as an **enforced** permission manifest, mapped onto the harness sandbox.
     - Require signed skill and plugin packages, with a transparency log of hashes.
     - Show a diff of permissions between versions before an update is accepted.
     - Scan on install using static analysis plus a classification model, following SkillScan in [arXiv 2601.10338](https://arxiv.org/html/2601.10338).
2. **A local-first, model-agnostic personal agent with a desktop-class experience.**
   - The gap: Anthropic's Cowork has moved toward cloud execution ([help center](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)). The Codex app and Manus are proprietary. Goose and Hermes are open but lack an agent-OS security model.
   - **Opportunity:** a Linux-first desktop app, with macOS and Windows as well. Neither Claude Desktop nor Cowork ships for Linux ([Medium](https://medium.com/@mara.ellorin/built-on-linux-but-not-for-linux-users-fddc6792b594)). It would run fully offline with local models and use cloud models as an option.
3. **Enforcement compiled from Markdown.**
   - The gap: every vendor says rules are advice and that hooks are needed for enforcement. Writing hooks in shell or JSON is hard for non-developers.
   - **Opportunity:** let a rule's frontmatter declare `enforce:` constraints (deny path globs, deny commands, require confirmation). The harness compiles these into `PreToolUse` guard plugins. The prose stays for the model, and the frontmatter becomes policy.
4. **Measuring whether skills trigger.**
   - The gap: Vercel showed silent non-invocation in 56% of cases ([Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)). Only Claude Code documents plugin evals.
   - **Opportunity:**
     - Built-in trigger telemetry: when a skill should have fired, when it did, and when the user invoked it by hand.
     - A `skills eval` command that replays recorded sessions. The harness already has keyless recorded-session snapshots.
     - An automatic suggestion to promote a frequently needed skill into always-on `AGENTS.md` context.
5. **Memory that is transparent and portable.**
   - The gap: Claude's auto memory is local to one machine ([memory docs](https://code.claude.com/docs/en/memory)). Qoder's memories live in a settings UI. Cloud assistants hide memory.
   - **Opportunity:**
     - Markdown memory in the user's own git repository.
     - Each entry records its origin: the session event that created it. This fits the harness rule "model-visible ⟺ logged".
     - A review queue for memories the agent writes.
     - Export to `CLAUDE.md` or `AGENTS.md`, and import from Claude, Cline Memory Bank, Qoder, and Hermes.
6. **Resistance to cross-prompt injection for personal automation.**
   - The gap: browser and OS agents remain exposed ([Microsoft XPIA warning](https://www.scworld.com/news/new-agent-workspace-feature-comes-with-security-warning-from-microsoft), [Comet findings](https://research.aimultiple.com/ai-browser-security/)).
   - **Opportunity:** tag content that entered the session from web pages, email, or files as untrusted. Require confirmation before any side-effecting tool call whose arguments come from untrusted content. Borrow Windows' **separate agent account** idea as an optional Linux user or namespace for the agent.
7. **Reading every ecosystem's formats in one agent.**
   - The gap: packaging is fragmented across Claude plugins, Agent Plugins, Gemini/Antigravity extensions, Kiro Powers, Goose recipes, and Cursor `.mdc` rules.
   - **Opportunity:** one loader that reads all of them. OpenCode and Cline show that partial versions of this attract users.
8. **Voice and ambient use on an open, audited core.**
   - The gap: voice exists in Hermes, Claude Code (`/voice`), and 01, but none pairs it with verifiable safety. Dispatch-style remote control from a phone is closed (Anthropic).
   - **Opportunity:** a messaging and phone gateway in the style of Hermes, with per-channel permission profiles.

---

## 5. Recommendations: conventions to adopt verbatim so the product inherits existing ecosystems

The goal: a user can drop in a repository or a `~/.claude` folder configured for another agent, and it works on day one. The harness adds verification on top without changing the file formats.

### 5.1 Instructions and memory

- **Read `AGENTS.md` natively** with its standard semantics: nested files, closest wins, user prompt overrides ([agents.md](https://agents.md)).
- **Also read `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md`** with Claude Code's semantics:
  - Walk from the root down to the working directory and concatenate.
  - Load subdirectory files lazily on first read.
  - Expand `@path` imports to a maximum of 4 hops, skipping code spans.
  - Require approval for imports from outside the project.
  - Offer a setting equivalent to `claude-md-or-agents-md` / `claude-md-and-agents-md` ([memory docs](https://code.claude.com/docs/en/memory)).
- **Path-scoped rules.** Read `.claude/rules/**/*.md` (`paths:` frontmatter), `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`), and `.kiro/steering/*.md` (`inclusion: always|fileMatch|manual|auto`). Normalize all of them into one internal rule type with the modes {always, glob, description-matched, manual}.
- **Auto memory.** Copy the Claude Code layout: a `MEMORY.md` index plus topic files with a `type:` of `user`, `feedback`, `project`, or `reference`. Keep the load budget at 200 lines / 25 KB for the index. Store it under the product's own home directory by default, and make the location configurable, including a git repository.

### 5.2 Skills and commands

- **Discovery paths, in priority order:**
  1. Product-native `.air/skills/`. The name is a placeholder; choose one.
  2. `.agents/skills/`, the Codex and vendor-neutral path.
  3. `.claude/skills/`.
  4. The matching user-level directories: `~/.agents/skills`, `~/.claude/skills`.
  5. Nested `<subdir>/.claude/skills/`.
  6. Also read `.opencode/skills/`, `.cline/skills/`, and `.qoder/skills/`.

  The first two are what Codex and OpenCode already scan ([Codex](https://learn.chatgpt.com/docs/build-skills), [OpenCode](https://opencode.ai/docs/skills/)).
- **Validate against the spec exactly.** Enforce the `name` regex and the requirement that `name` matches the directory, the description limit of 1–1024 characters, and the `compatibility` limit of 500 characters. Pass unknown `metadata` through untouched. Use `skills-ref` in CI.
- **Honor Claude Code's extension fields** so that existing skills behave the same way: `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `context: fork`, `agent`, `model`, `paths`, `arguments`, `argument-hint`, `when_to_use`, `$ARGUMENTS`, `$0`, `${CLAUDE_SKILL_DIR}`, and `` !`cmd` `` injection. Run injection through the permission check, and give policy a way to disable it ([skills docs](https://code.claude.com/docs/en/skills)).
- **Treat `.claude/commands/*.md` as legacy skills** that the user can invoke, as Claude Code does.
- **Budget skill descriptions** to about 1,500 characters each, with a total listing cap, and expose `name-only` and `off` overrides.

### 5.3 Subagents

- Read `.claude/agents/*.md`, `~/.claude/agents/*.md`, and `.qoder/agents/*.md`. Also read the product's own path.
- Support these frontmatter fields: `name`, `description`, `tools`, `disallowedTools`, `model` (mapped to local provider aliases), `permissionMode`, `skills`, `memory`, `maxTurns`, `isolation: worktree`, `background`, `mcpServers`, and `hooks` ([sub-agents docs](https://code.claude.com/docs/en/sub-agents)).

### 5.4 Hooks

- Accept Claude Code's `hooks` JSON schema: event name → matcher → handlers. Support the handler types `command`, `http`, and `prompt`, exit code 2 to block, and `hookSpecificOutput.permissionDecision` / `updatedInput`.
- Start with these events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `PreCompact`, and `Notification` ([hooks docs](https://code.claude.com/docs/en/hooks)).
- Implement each hook as a harness guard plugin, so that a hook decision is itself a logged session event.

### 5.5 Plugins, marketplaces, and MCP

- **Two plugin manifests.** Read the Claude Code plugin layout (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) **and** the Agent Plugins `plugin.json` with `skills/` and `mcp.json`. Together they cover the Anthropic camp and the OpenAI/Microsoft/Cursor/AWS camp ([Claude plugins](https://code.claude.com/docs/en/plugins), [agent-plugins.org](https://agent-plugins.org/)).
- **Later: import formats.** Add `gemini-extension.json`, Kiro Powers, and Goose recipe YAML as import formats.
- **MCP.** Read project `.mcp.json`. Install **`.mcpb` bundles**: parse `manifest.json`, store `user_config` fields marked `sensitive` in the OS keychain, and check `compatibility.platforms` ([MCPB manifest](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)).
- **Differentiators to add on top, without changing the formats:**
  - Signed packages, meaning a detached signature beside the manifest.
  - A permissions diff on update.
  - A sandbox profile per plugin.
  - Marketplace tiers (verified, community, local) with identity binding modelled on Anthropic's reserved-name rule, which accepts official names only from `github.com/anthropics/` ([plugins docs](https://code.claude.com/docs/en/plugins)).
  - Scanning on install.

### 5.6 Sandbox and permissions

- Match or exceed Claude Code and Codex: Seatbelt on macOS; bubblewrap plus seccomp, or Landlock, on Linux.
- Enforce an allowlist of network domains through a proxy.
- **Mask credentials** with sentinel values that the proxy substitutes only for allowed hosts ([sandboxing docs](https://code.claude.com/docs/en/sandboxing)).
- Offer permission modes mirroring `default`, `acceptEdits`, `plan`, and `auto`, with allow, ask, and deny rules using the `Tool(pattern)` syntax. Users of Claude Code, Codex, and OpenCode already know this syntax.

### 5.7 What not to copy

- **Do not rely on the model to load safety-critical guidance.** Use Vercel's pattern instead: put a compressed index in always-on context and keep procedures in skills ([Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)).
- **Do not run an open registry without verification.** OpenClaw's ClawHub is the counterexample.
- **Do not depend on a single vendor's CLI or model.** Gemini CLI was withdrawn for consumers and Roo Code was archived. For a final-year project, open standards (AAIF's `AGENTS.md` and MCP, agentskills.io, Agent Plugins, MCPB) are the durable base.

---

### Key sources (all accessed 2026-09-28)

- Claude Code docs: [memory](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills), [sub-agents](https://code.claude.com/docs/en/sub-agents), [hooks](https://code.claude.com/docs/en/hooks), [plugins](https://code.claude.com/docs/en/plugins), [sandboxing](https://code.claude.com/docs/en/sandboxing)
- Standards: [agentskills.io](https://agentskills.io/home), [specification](https://agentskills.io/specification), [agents.md](https://agents.md), [agent-plugins.org](https://agent-plugins.org/), [MCPB](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md), [AAIF press release](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- Evidence on failure modes: [Vercel evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals), [arXiv 2601.10338](https://arxiv.org/html/2601.10338), [Unit 42 on OpenClaw](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)
