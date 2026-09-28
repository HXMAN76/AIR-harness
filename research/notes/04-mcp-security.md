# 04 — MCP Security: Threat Model, Prior Art, and a Tool-Surface Pinning Design for AIR-harness

Research date: 2026-09-28. All claims below are date-stamped to their source; "verified in source" means read in this repository or the AIR clone during this research, not inferred.

## 0. Summary

AIR's "manifest tool-pinning" is a sound idea, but it is not novel. By late 2025 and through 2026, TOFU pinning of MCP tool definitions shipped in Invariant Labs' mcp-scan (later Snyk agent-scan), Trail of Bits' mcp-context-protector, Pipelock, MCPProxy, MCPTrust signed lockfiles, and the Vercel AI SDK's `fingerprintTools`/`detectToolDrift`. OWASP's MCP Security Cheat Sheet recommends it as standard practice. AIR's actual implementation also has a significant gap. It hashes only `inputSchema` (`core/tool_gateway/models.py` `compute_schema_digest`, called as `compute_schema_digest(tool.input_schema)` in `core/plugin_manager/manager.py:163`). The tool `description`, which is the main tool-poisoning vector, is not pinned. The canonicalization it uses (`json.dumps(sort_keys=True, separators=(",",":"))`) is not RFC 8785, so a TypeScript port would not reproduce its digests.

The case for AIR-harness therefore does not rest on novelty. It rests on doing pinning inside the client, where the harness already has advantages that proxies lack. The harness has atomic two-phase tool generations (`syncTools`), a fail-closed approval seam, and a durable session log whose "model-visible ⟺ logged" rule makes an audited tool surface a natural extension. Section 3 gives a concrete design. Section 4 ranks the defenses beyond pinning. Pinning addresses only one row of the threat table; prompt injection through tool results and egress-based exfiltration are larger residual risks.

## 1. Threat model

### 1.1 Current AIR-harness baseline (verified in source, 2026-09-28)

- `packages/mcp/mcp-client/src/tools.ts` `syncTools()` works in two phases. Phase 1 calls `client.listTools(undefined, { cacheMode: 'refresh' })` and builds a `ToolDefinition` for every listed tool, taking `description`, `inputSchema` and `outputSchema` verbatim. Phase 2 disposes the previous generation and registers the new one. The only rejections in phase 1 are fetch failure and duplicate names. Nothing compares against an approved surface.
- `packages/mcp/mcp-client/src/connection.ts` sets `listChanged.tools.onChanged` to `refreshTools()`, which re-runs `syncTools` through a serialized `syncChain`. Every reconnect generation re-syncs from scratch. A server can therefore change its tool surface at any time, and the harness adopts the change silently. `docs/subsystems/mcp.md` also says "a failed refresh retains the previous tool generation".
- Server `instructions` are size-checked (`maxInstructionBytes`) and then published into the system prompt as a server-attributed section. They are also unpinned.
- Stdio servers are spawned by the MCP SDK with a scrubbed environment (`transport.ts` → `scrubbedParentEnv()`), but they are not confined by `packages/sandbox`. The sandbox vocabulary covers file effects only. `packages/sandbox/sandbox-policy/README.md` states that "network and process policy are outside its vocabulary".
- `packages/interaction/user-approval` is fail-closed (`unavailable` → deny). Its outcome union is closed at `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`, and `request()` throws outside an open turn. Both facts constrain how approval of a new tool surface can work (§3.6).
- `tools/pre-execute` (waterfall) plus monotonic guards in `packages/core/tools` are the per-call enforcement point. `PreToolDecision` includes `ask`.
- The MCP SDK in use is `@modelcontextprotocol/client` 2.0.0, which implements the 2026-07-28 protocol.

### 1.2 Protocol context (2025–2026)

- **2025-06-18 / 2025-11-25.** These revisions contain the Security Best Practices page, which covers confused deputy, token passthrough, session hijacking, SSRF, OAuth URL validation and local server compromise (https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices). Tool `annotations` exist, and the tools page says clients "MUST consider tool annotations to be untrusted unless they come from trusted servers".
- **2026-07-28 (current; RC locked 2026-05-21, final 2026-07-28).** This revision is confirmed. It is stateless: the `initialize` handshake is removed (SEP-2575) and `Mcp-Session-Id` is removed (SEP-2567). A new `server/discover` method returns server capabilities. `tools/list` results carry `ttlMs` and `cacheScope` (SEP-2549), "a long-lived SSE stream is no longer the only way to learn that a list changed". `inputSchema`/`outputSchema` move to full JSON Schema 2020-12 with `$ref`/`$defs`, and "implementations must not auto-dereference external `$ref` URIs" (SEP-2106). Roots, Sampling and Logging are deprecated. Authorization is hardened with RFC 9207 `iss` validation (SEP-2468). Source: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ and https://blog.modelcontextprotocol.io/posts/2026-07-28/. **No 2026-07-28 feature provides tool-definition integrity or signing.** A community discussion (modelcontextprotocol discussion #2402, "Tool Integrity") proposes schema pinning and signature trust anchors, per https://mcpproxy.app/blog/2026-03-27-mcp-spec-converging-mcpproxy-architecture/. It is not in the spec.
- **Security implication of statelessness.** Behind a round-robin load balancer, consecutive `tools/list` and `tools/call` requests can reach different server instances. During a rolling deploy these instances may run different versions. A client-side pin verifies what was *listed*; it cannot prove which code *executes* a call. This limitation applies to every pinning scheme.

### 1.3 Threat table

Layers: **P** = tool-surface pinning (§3), **A** = user-approval, **G** = `tools/pre-execute` guards and capability scopes, **S** = OS sandbox (bwrap/Landlock/Seatbelt), **E** = egress control, **T** = output taint/quarantine, **O** = OAuth/credential handling.

| # | Threat | Example (source) | Defending layer(s) | AIR-harness status (2026-09-28) |
|---|---|---|---|---|
| 1 | Tool poisoning (instructions hidden in description/schema) | Invariant Labs' `add(a,b)` tool whose `<IMPORTANT>` description tells the model to read `~/.cursor/mcp.json` and SSH keys, April 2025 (https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks). MCPTox measures 72.8% ASR on o1-mini across 45 real servers and 353 tools, and finds that more capable models are often more susceptible (arXiv:2508.14925) | P freezes a reviewed text; description override removes it; G/S/E bound the damage | **Open.** Descriptions reach the model verbatim; no review or pin |
| 2 | Rug pull (definition mutated after approval) | Same Invariant post; "When MCP Servers Attack" (arXiv:2509.24272); ShareLock plants secret shares in several descriptions and reconstructs them "during server update" (arXiv:2606.27027) | **P** is the primary control; A for re-approval | **Open.** `listChanged` and reconnects adopt any new surface |
| 3 | Implicit poisoning / tool shadowing (a tool's text steers *another* tool) | Invariant's `send_email` shadowing example; MCP-ITP reaches 84.2% ASR with 0.3% detection (arXiv:2601.07395) | P (text frozen), G (per-tool scopes on the victim tool), E | **Open.** Namespacing (`mcp__server__tool`) prevents *name* collisions but not semantic shadowing |
| 4 | Name collision / preference manipulation | MSB name-collision attacks (arXiv:2510.15994); MPMA (arXiv:2505.11154) | Harness namespacing; P | **Mitigated for names** by `publicToolName()`; preference manipulation open |
| 5 | Prompt injection via tool results | GitHub MCP issue-to-private-repo exfiltration (Invariant, May 2025); TIP payloads keep >50% effectiveness against four defenses (arXiv:2603.24203); cross-channel fragmentation reaches up to 100% exfiltration on models that resist single-channel injection (arXiv:2609.18217) | T, G, E, A; plan/data separation (CaMeL-style) | **Open.** Results enter history as ordinary text. Images are gated by modality, not trust |
| 6 | Cross-server exfiltration ("toxic flow" / lethal trifecta) | A private-data tool, an untrusted-content tool and an outbound tool on different servers combine (Invariant toxic flows; OWASP ASI02) | T + E + G (flow policy) | **Open.** No cross-tool data-flow policy |
| 7 | Poisoned server `instructions` | Instructions are literal text in the system prompt; the same vector as #1 at higher privilege | P (pin instructions), size limit | **Partial.** Only a byte cap |
| 8 | Malicious or compromised server binary (supply chain) | Registry version drift: a third-party measurement (snyk/agent-scan issue #482, Sept 2026) reports the approval surface byte-identical while the resolved package version moved on 74.6% of 59,821 release transitions; aggregator upload study (arXiv:2506.02040) | Exact-version pins in launch args, artifact signatures (MCPB, Sigstore, npm publish attestations), S | **Open.** `command`/`args` unverified; `npx pkg@latest` accepted |
| 9 | Local server escapes into host (file/process) | NSA CSI on MCP (May 2026) highlights arbitrary code execution classes CWE-77/78/94/95 (https://media.defense.gov/2026/Jun/02/2003943289/-1/-1/0/CSI_MCP_SECURITY.PDF) | **S**, env scrubbing | **Partial.** Env scrubbed; MCP children not sandboxed |
| 10 | Confused deputy | Proxy servers with static client IDs and dynamic registration let consent cookies be reused (spec Security Best Practices) | O, per-client consent | **Mostly N/A.** Harness is a client; relevant if AIR-harness exposes a remote MCP proxy |
| 11 | Token passthrough | A server forwards the client's token to a downstream API; the spec forbids this (same page) | O, audience-bound tokens | **N/A client-side.** Relevant for headers in `streamable-http` config (`headers` map is sent verbatim) |
| 12 | Annotation spoofing | Server marks a destructive tool `readOnlyHint: true` | P (pin annotations); never grant trust from annotations alone | **Latent.** Harness ignores annotations today; becomes live if policy consumes them |
| 13 | Sampling / elicitation abuse | Server-side prompt injection via sampling; VS Code sampling system-prompt override (arXiv:2609.18217) | Refuse sampling; A for elicitation | **Mitigated.** Client declares `capabilities: {}`; elicitation unsupported (`docs/subsystems/mcp.md` Limits) |
| 14 | Consent fatigue / approval spoofing | SAFE-MCP SAFE-T1403; Claude Code 2.1.211 (July 2026) stripped invisible and look-alike characters from relayed approval prompts | A (diff-based, rate-limited prompts) | **Unknown.** Answerer UI renders `reason` text |

## 2. Prior-art survey and honest novelty assessment

### 2.1 Tools that pin or fingerprint MCP tool definitions

| Tool (date) | What is pinned | On change | Where |
|---|---|---|---|
| **Invariant mcp-scan** "Tool Pinning" (April 2025; https://invariantlabs.ai/blog/introducing-mcp-scan) | Hash of tool descriptions. A 2026-09 GitHub issue states `hash_entity()` returned `md5(entity.description)` only. | Warn on scan | Offline scanner. Also sends tool names/descriptions to a remote guardrail API |
| **Snyk agent-scan** (successor, v0.6.7 on 2026-09-25; https://github.com/snyk/agent-scan) | Per snyk/agent-scan#482, "Tool Pinning was removed rather than reworked" when `src/mcp_scan` left main. **Unverified beyond that issue thread.** | — | Scanner. Sends "tool names and descriptions" to Snyk for analysis |
| **Trail of Bits mcp-context-protector** (https://github.com/trailofbits/mcp-context-protector) | TOFU over "server instructions, tool descriptions, and tool input schemas" | "Any deviation … will block downstream tool calls until the user explicitly approves" via `--review-server`. Also quarantines suspicious *responses* | Wrapper proxy |
| **Pipelock** (https://github.com/luckypipewrench/pipelock) | Canonical hash of the *full* tool object including `_meta`. Also scans all text-bearing schema fields (`default`, `enum`, `examples`, `pattern`, `$comment`, `x-*`) | `detect_drift` warn/block; `new_tool_admission: admit|withhold` | Egress proxy |
| **MCPProxy** (March 2026 blog) | Schema, description, parameters | Re-quarantines changed tools; quarantined tools are invisible to the agent | Proxy |
| **MCPTrust** (Reddit announcement) | Deterministic `mcp-lock.json` of the live surface, signed | CI/runtime check | Lockfile tool |
| **Vercel AI SDK** `fingerprintTools` / `detectToolDrift` (vercel/ai PR #16902; https://ai-sdk.dev/llms-full.txt) | `description`, resolved input schema, `title` | Returns `{added, removed, changed}`; the app decides | In-client library |
| **Microsoft agent-governance-toolkit** "MCP Security Gateway 1.0" spec | "Tool Fingerprint: a cryptographic hash of a tool's description and schema" plus schema drift detection | Drift alert | Gateway |
| **IBM ContextForge** issue #5471 | Proposes snapshot hash of `name + description + input_schema`, checked in `tool_pre_invoke` | Warn/block; admin re-approval | Gateway (proposal) |
| **ToolHive** `toolsFilter`/`toolsOverride` (https://docs.stacklok.com/toolhive/guides-k8s/customize-tools) | No hash. Allow-lists tools and **replaces descriptions with operator-authored text** | — | Runtime/proxy |
| **Docker MCP Gateway** (https://github.com/docker/mcp-gateway/blob/main/docs/security.md) | No tool pinning found. Verifies image signatures by digest for `mcp/` images by default, `--block-secrets` on by default, optional `--block-network`/`allowHosts`, treats tool schemas as untrusted input when translating drafts to 2020-12 | — | Gateway |
| **ETDI** (arXiv:2506.01333) | Signed, immutable, versioned tool definitions with OAuth identity | Reject unsigned/changed | Protocol extension (research) |
| **MCPS IETF draft** (draft-sharif-mcps-secure-mcp) | "Signatures over complete tool definitions" plus per-message ECDSA | Reject | Individual Internet-Draft, not adopted |
| **Trustworthy MCP Registry** (Future Internet 18(5):243, May 2026) | Sigstore artifact build attestations plus JCS (RFC 8785) signed capability mutations | Reject unsigned mutation | Research blueprint |

The guidance documents converge on the same practices. The OWASP MCP Security Cheat Sheet says "Pin tool definitions with cryptographic hashes and verify before each execution" and warns against "TOFU without pinning" (https://github.com/owasp/cheatsheetseries, `MCP_Security_Cheat_Sheet.md`). The OWASP MCP Top 10 lists MCP03 Tool Poisoning. The OWASP Top 10 for Agentic Applications 2026 (published 2025-12-09) covers ASI02 Tool Misuse and ASI04 Agentic Supply Chain. The CoSAI MCP Security whitepaper (approved 2026-01-08) names "Missing Integrity Controls" as one of 12 categories covering about 40 threats and recommends mandatory code signing (https://www.coalitionforsecureai.org/wp-content/uploads/2026/03/model-context-protocol-security-1.pdf).

### 2.2 Novelty assessment

- **Tool-definition pinning is not novel.** At least seven shipped or proposed systems predate or parallel AIR's ADR-0005 (2026-09-16). AIR's EVALUATION.md RQ2 claim ("100% drift detection, 10/10") is true for its own ten scenarios, but it should not be presented as a new mechanism.
- **AIR is weaker than prior art in one important respect.** It pins only `inputSchema`. mcp-context-protector, Pipelock, Vercel and Microsoft all include the description, and mcp-context-protector also includes instructions. A pure description rug pull, which is the canonical Invariant attack, passes AIR's check.
- **What AIR-harness can legitimately claim as a contribution**, without claiming invention:
  1. **In-client, generation-atomic enforcement.** A verdict applies to a whole `syncTools` generation before registry mutation. A proxy decides per message; AIR-harness decides on the exact set of `ToolDefinition`s the model will see.
  2. **Audit tied to the model-visible surface.** Surface digests are recorded as session events, so every session log states which approved surface the model saw. None of the surveyed tools records this per session.
  3. **Reviewable, diffable lockfile containing the approved definitions themselves, not just hashes.** This supports human-readable diffs at approval time. mcp-context-protector stores configurations; hash-only schemes (AIR, mcp-scan) cannot show *what* changed.
  4. **Pin plus capability binding.** Each pinned tool carries a harness capability scope (§4) that is enforced in `tools/pre-execute`. The pin freezes *what the tool says it is*; the scope bounds *what it may do*.
  5. **Portable canonical form (RFC 8785)** so that Python AIR, TypeScript AIR-harness and CI produce identical digests.

A defensible framing for the project write-up: "we integrate established TOFU tool pinning into the client's registry transaction and session audit log, extend it to instructions and annotations, and measure it against the drift scenarios from prior work". It should not be framed as "we propose tool pinning".

## 3. Concrete design for AIR-harness

### 3.1 Scope and ownership

Add a capability seam rather than code inside `mcp-client` alone, following the repo convention that a capability seam comprises definition, provider and consumer roles:

- **Service Definition**: `McpTrust` (new package `packages/mcp/mcp-trust`), with `verify(server, surface): Verdict` and `approve(server, surface, scope)`.
- **Service Provider**: a lockfile-backed store under `packages/storage` (non-session storage), because pins outlive sessions.
- **Consumer**: `mcp-client` `syncTools()` phase 1, plus a turn-scoped approval bridge (§3.6).

Following the "misconfiguration fails loud" rule: if `trust.mode: enforce` is configured and the trust service is absent, plugin load fails. It must not silently fall back to unpinned registration.

### 3.2 Config schema

`cordis.yml` metadata stays literal, so pins that change frequently live in a lockfile. Config only references the lockfile and sets policy:

```yaml
- name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: browser
    command: npx
    args: ['-y', '@playwright/mcp@0.0.41']     # exact version; `@latest` rejected in enforce mode
    trust:
      mode: enforce            # off | tofu | enforce
      lockfile: .dsh/mcp-lock.json
      onAdded: withhold        # withhold | reject-generation
      onChanged: reject-generation   # reject-generation | withhold
      onRemoved: accept        # accept | reject-generation
      instructions: pin        # pin | drop | accept
      tools:
        allow: [browser_navigate, browser_snapshot]   # optional allowlist; unlisted tools never register
        deny:  [browser_evaluate]                     # dropped silently (logged), never prompts
        override:
          browser_navigate:
            description: "Navigate the controlled browser tab to an http(s) URL."
```

Lockfile entry (one per `serverName`, keyed by the **local** name, never the server's self-reported `serverInfo.name`, as in AIR ADR-0001 §5):

```json
{
  "version": 1,
  "canonicalization": "RFC8785-JCS/SHA-256",
  "servers": {
    "browser": {
      "launch": { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.41"], "artifactDigest": "sha512-…" },
      "instructions": { "digest": "sha256:…", "text": "…" },
      "tools": {
        "browser_navigate": {
          "digest": "sha256:…",
          "fields": { "description": "sha256:…", "inputSchema": "sha256:…", "outputSchema": "sha256:…", "annotations": "sha256:…" },
          "definition": { "name": "browser_navigate", "description": "…", "inputSchema": { } },
          "capability": "browser.navigate",
          "approvedAt": "2026-09-28T10:00:00Z", "approvedBy": "cli"
        }
      },
      "surfaceDigest": "sha256:…"
    }
  }
}
```

**Fields included in the per-tool digest.** The rule is: include every field that is model-visible or policy-relevant; exclude fields that are neither.

| Field | Include? | Reason |
|---|---|---|
| `name` | Yes | Identity; rename = remove + add |
| `title` | Yes | Model- and UI-visible in some hosts; Vercel includes it |
| `description` | **Yes (mandatory)** | Primary poisoning vector; AIR's gap |
| `inputSchema` | Yes, *unresolved* | Model-visible; `description`, `default`, `enum`, `examples` inside it are injection carriers (Pipelock). Never dereference external `$ref` (SEP-2106) |
| `outputSchema` | Yes | The SDK validates `structuredContent` against it (`callTool(..., { toolDefinition })`); widening changes what flows back |
| `annotations` | Yes | Harmless now, but must be pinned before any policy trusts `readOnlyHint`/`destructiveHint` (spec: untrusted) |
| `execution` | Yes (`taskSupport`) | Changes the execution path (`taskRequired` in `createExecutor`) |
| `icons` | No by default | Not model-visible; URIs change for CDN reasons. Configurable |
| `_meta` | No by default | Pipelock includes it and documents false positives from volatile values. Configurable `hashMeta: true` |

Keep per-field digests next to the whole-tool digest so that the approval UI can say "description changed, schema unchanged". Also store the full approved `definition`, so that the UI can render a textual diff and so that `override` and `allow` can be validated against real names at load time.

### 3.3 Canonicalization: RFC 8785 (JCS), not ad-hoc sorted keys

Recommendation: **RFC 8785 JSON Canonicalization Scheme, then SHA-256**, with the digest prefixed `sha256:`.

- JCS is specified for cross-language determinism: I-JSON input, ECMAScript number serialization, keys sorted by UTF-16 code units, and a minimal string escaping set. In TypeScript this is nearly free, because `JSON.stringify` already emits ES number and string formats. The `canonicalize` npm package implements RFC 8785, or a roughly 30-line local implementation with test vectors from the RFC would do.
- AIR's Python form `json.dumps(sort_keys=True, separators=(",",":"))` differs from JCS in three ways. `ensure_ascii=True` escapes non-ASCII as `\uXXXX`. Python orders keys by code point rather than UTF-16 code unit, which differs for non-BMP versus U+E000–U+FFFF keys. Float formatting differs: for example, Python emits `1e+16` where ES emits `1e16`. A lockfile produced by Python AIR would therefore fail verification in TypeScript on any schema with non-ASCII text or large or fractional numbers. Python has JCS implementations (for example the `rfc8785` package from Trail of Bits), so both sides can converge.
- Do **not** Unicode-normalize strings before hashing. Normalization would hide homoglyph or invisible-character edits to descriptions, which is exactly the class of change a pin must catch.
- Numerically equal JSON like `1.0` and `1` parse to the same number and canonicalize identically. That behavior is correct and prevents a false positive; add it as a test.
- Reject non-I-JSON input (lone surrogates, duplicate keys) as a *drift* verdict rather than a hash error, because an adversary controls the bytes.
- `surfaceDigest` = SHA-256 over JCS of `{ instructions: <digest|null>, tools: { <rawName>: <toolDigest> } }`. This is a single value that the session event can carry.

### 3.4 Where to enforce: `syncTools()` phase 1

Insert a verification step between "fetch" and "build" in phase 1, before any registry mutation:

1. Fetch: `listTools` (SDK-aggregated pages) as today. Fetch `instructions` in the same generation. `connection.ts` currently reads instructions before `enqueueSync`; move the instruction check into the same verdict so that tools and instructions are accepted or rejected together.
2. Filter: apply `deny`, then `allow`. Denied tools are dropped with a log line and never produce a prompt. This is AIR's `browser_evaluate` case, where the server cannot disable the tool but the client can refuse it.
3. **Verify**: compute digests, diff against the lockfile, and produce `Verdict { accepted[], withheld[], rejected: boolean, diff }`.
4. Build `ToolDefinition`s only for `accepted`, applying `override.description` when configured.
5. Phase 2 swap stays unchanged. The verdict and the swap happen in the same `syncChain` slot, so a `listChanged` storm cannot interleave verification and registration.

This point is correct because it is the operation that *makes* the registration decision, as the packages AGENTS.md rule requires ("Enforce a decision in the operation that makes it"). A `tools/pre-execute` check alone would leave poisoned descriptions in the model's context even if calls were blocked. Tool poisoning works without the poisoned tool ever being called (MindGuard, arXiv:2508.20412; MCP-ITP).

Add a second, cheap check at call time. The registered definition should carry its `toolDigest`, and a `tools/pre-execute` guard should deny calls whose definition digest no longer equals the lockfile's current approved digest. This covers the window between a lockfile revocation (for example `dsh mcp revoke`) and the next sync.

On 2026-07-28 servers, honor `ttlMs` as a re-verification cadence. When the cached list expires, re-list and re-verify, so that drift is caught even on servers that never emit `list_changed`. This replaces AIR's separate "interval re-check" job (ADR-0005) with a protocol-provided cadence.

### 3.5 Behaviour on drift

The current rule "a failed refresh retains the previous generation" must **not** apply to drift. A fetch failure means "we don't know"; drift means "the server now presents something else". The previous generation's descriptions no longer describe the code that will execute. Proposed defaults:

| Diff | Default | Rationale |
|---|---|---|
| Tool **added** (not in lockfile, not denied) | `withhold`: register nothing for it; keep accepted tools; surface for approval | Additions are common and legitimate (Pipelock's `withhold`). The rest of the surface is unaffected. |
| Pinned tool **changed** (any field digest) | `reject-generation`: dispose the previous generation, register **zero** tools from this server, clear its instructions section, mark the server `Quarantined` | A mutation of an approved definition is the rug-pull signature. The text of a changed tool can steer other tools from the same server (shadowing, ShareLock's multi-tool shares), so withholding only the changed tool is weaker. `withhold` remains available for low-risk servers. |
| Pinned tool **removed** | `accept` (log) | Removal cannot inject text. The model loses a tool, which is an availability issue, not an integrity issue. |
| Instructions changed | Same as `onChanged` | Instructions have system-prompt privilege |
| Canonicalization error / non-I-JSON | `reject-generation` | Adversary-controlled bytes |

`Quarantined` is sticky for the connection supervisor's lifetime. Reconnects re-verify, and a reconnect presenting the approved surface clears quarantine. This follows AIR's "Errored cannot be re-enabled without reload" test, relaxed so that a server that returns to the approved surface recovers without an HMR reload. That relaxation is safe because verification is repeated on every generation.

`tofu` mode: when the lockfile has no entry for this server, accept the first surface, write it as `approvedBy: "tofu"` with a warning, and behave as `enforce` afterward. `tofu` must never re-TOFU a server that already has an entry. OWASP explicitly warns about TOFU without pinning.

### 3.6 How the user approves a new surface

Two constraints from `user-approval` shape the flow. `request()` requires an open turn, and the only positive outcome is `allowed-once`. MCP connections are process-level and connect outside turns. So:

1. **Primary path: out-of-band CLI (persistent).** `dsh mcp pin <serverName>` connects using the same config, prints a field-level diff against the lockfile (full description text diff, schema diff, instructions diff), and writes on confirmation. Per the root AGENTS.md "Application launch" rule, this must be a `dsh` profile or subcommand, not a package bin. Subcommands:
   - `dsh mcp pin <server> [--tool <name>…]` — approve the whole current surface or selected tools.
   - `dsh mcp diff <server>` — show drift without writing.
   - `dsh mcp verify [--all]` — CI mode; non-zero exit on any drift; no writes.
   - `dsh mcp revoke <server> [--tool <name>]` — remove approvals; the runtime guard (§3.4) denies calls immediately.
2. **In-session path: per-process acceptance through the existing seam.** At the next `turn/start` after a withheld or quarantined verdict, a small `mcp-trust-approval` plugin calls `approval.request({ toolName: 'mcp__<server>__*', reason: <rendered diff summary> })`. `allowed-once` accepts the new surface **for this process only**; it does not write the lockfile, which matches the "one-shot" contract. The tools then register through a re-sync. `rejected`, `unavailable` and `cancelled` all leave the server withheld. A headless `policy: never` therefore stays fail-closed, which is the right default for scheduled or unattended Jarvis runs.
3. **Do not extend `ApprovalOutcome` with `allowed-always` for this.** That would change a closed, persisted union (`approval/decided`) and requires persistence-type acknowledgement. Persistent trust belongs to the trust store and the CLI, where an explicit human write produces a reviewable git diff.

Approval-prompt hygiene: render the diff from the stored `definition`, strip or visibly mark invisible and bidirectional control characters (the class Claude Code fixed in 2.1.211, July 2026), and cap re-prompts per server per session to limit consent fatigue.

### 3.7 Session events for audit

The model-visible tool set is already reconstructable from `request/header`. What is missing is *why* that surface was trusted. Add log-only events, declared by declaration merging in `mcp-trust`:

```ts
'mcp/surface': {            // appended at turn/start when a server's accepted surface differs from the last one recorded in this session
  serverName: string
  surfaceDigest: string      // sha256:… over JCS
  verdict: 'approved' | 'tofu' | 'accepted-once' | 'quarantined'
  withheld: string[]         // raw tool names not registered
  lockfileDigest?: string    // digest of the lockfile entry used
}
'mcp/drift': {              // appended when a sync produced a non-empty diff
  serverName: string
  added: string[]; removed: string[]
  changed: { tool: string; fields: string[] }[]
  instructionsChanged: boolean
  action: 'withhold' | 'reject-generation' | 'accept'
}
```

Mark both `ignorable: true`. They are audit data that no replay depends on, so older builds can still read logs that contain them. Record them in `docs/persistence-catalog.md` with the required type acknowledgement. Because connections are process-level, also keep a process-level audit line through `ctx.logger` for drift that occurs when no session is open. The session event records the surface *as that session observed it*.

### 3.8 Signed plugin bundles and launch origin checks

Pinning the *surface* does not pin the *code* (see threat #8 and the snyk#482 measurement). Three layers, in order of effort:

1. **Exact versions in launch args** (low effort). In `enforce` mode, reject `@latest`, unversioned `npx -y pkg`, and `uvx pkg` without `==`. Store `launch.command`/`args` in the lockfile and treat any change as `onChanged`.
2. **Artifact digests** (medium effort). For npm launchers, record the package `integrity` (sha512) resolved at pin time. Resolve through a local install into a harness-owned cache rather than `npx` at runtime, and verify with `npm audit signatures` or Sigstore npm publish attestations when the package publishes it. For OCI, pin by digest, as Docker MCP Gateway already requires for verified `mcp/` images. For **MCPB** bundles, `mcpb verify` checks the bundle's X.509 signature (https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md). Record the signer identity in the lockfile.
3. **Signed lockfile** (medium effort, high value for shared or team profiles). Sign `mcp-lock.json` with Sigstore keyless (`sigstore` npm, identity bound to the CI OIDC token) and verify at load, so that a profile bundle (`packages/bundle`) carries a verifiable approved surface. This matches MCPTrust's signed lockfiles and the "Trustworthy MCP Registry" blueprint (JCS plus Sigstore).

The official MCP Registry is still "in preview" and verifies namespace ownership, not artifacts. It "delegates security scanning" to npm/PyPI/Docker Hub (https://modelcontextprotocol.io/registry/about). It is a discovery source, not a trust root.

### 3.9 Tests to write

Port AIR's ten scenarios (`tests/security/test_tool_pinning.py`) as real-composition specs. The packages rule requires Loader-booted `cordis.yml` rather than hand-built `ctx.plugin`. Use a fixture server that can mutate its surface and emit `list_changed`. The server-everything and server-filesystem dev dependencies already exist.

AIR's ten, adapted:
1. Matching surface → all tools registered; `mcp/surface` verdict `approved`.
2. Added unpinned tool → withheld; others registered; `mcp/drift.added`.
3. Renamed tool → removal accepted plus addition withheld.
4. Widened `inputSchema` (new property) → `reject-generation`; zero tools; instructions section cleared.
5. Relaxed `additionalProperties: false` → `reject-generation`.
6. Missing pinned tool → accepted and logged.
7. Key reordering, including nested keys and `$defs` order → **no** drift.
8. Browser subset pinned, honest server → only the two pinned tools.
9. `browser_evaluate` appears → with `deny` it is dropped silently; without `deny` it is withheld. It is never registered in either case.
10. Quarantine is sticky across `list_changed` until the surface returns to the approved state or is approved.

New scenarios that AIR did not cover:
11. **Description-only change** (the Invariant rug pull) → `reject-generation`. AIR would pass this silently.
12. Instructions-only change → rejected; system-prompt section removed.
13. `annotations.readOnlyHint` false→true flip → drift.
14. `outputSchema` widening → drift.
15. Mid-session `list_changed` mutation while a call is in flight → the in-flight call settles; the next call is denied by the digest guard; no partial registration.
16. Reconnect to a different binary version (fixture flips version) → drift detected on the reconnect generation.
17. Pagination split across pages with the same total surface → no drift.
18. Invisible or homoglyph character inserted in a description → drift (proves no normalization).
19. `1.0` vs `1` in a schema `default` → no drift.
20. Non-I-JSON (duplicate key or lone surrogate) → `reject-generation`.
21. External `$ref` in `inputSchema` → hashed as-is, not fetched (assert no network).
22. `override.description` → the model-visible definition uses the override (snapshot test), while the digest is still computed over the server's text.
23. `enforce` with no trust service mounted → plugin load fails loud.
24. `tofu` first run writes an entry; second run with a changed surface does not re-TOFU.
25. Headless `policy: never` → withheld surfaces stay withheld; `approval/decided` = `rejected`.
26. Cross-language vector: digest of a fixture schema equals the Python `rfc8785` digest (shared golden file).
27. HMR identical-pins test: dispose and observe removal of tools *and* instruction sections.

Snapshot coverage: a keyless recorded-session snapshot showing the model-visible tool list before and after a withheld addition, per the "model-visible changes update a snapshot" rule.

## 4. Defense-in-depth roadmap beyond pinning (ranked by value/effort)

Pinning addresses threats #1, #2, #7, #12 and part of #8. Results-borne injection (#5) and cross-server flows (#6) remain, and they are the attacks with the best-documented real exploits. The ranking below weighs value against effort for AIR-harness specifically.

| Rank | Control | Value | Effort | Notes |
|---|---|---|---|---|
| 1 | **Surface pinning + allow/deny + description override** (§3) | High | Low–Med | Removes the metadata channel as a moving target; override removes it entirely for chosen tools |
| 2 | **Sandbox MCP stdio servers** with the existing `ctx.sandbox` (bwrap/Landlock/Seatbelt) instead of a bare SDK spawn | High | Med | Today MCP children are not confined. Needs a transport that spawns through the subprocess/sandbox seam; default `read-only` plus a per-server writable-roots config |
| 3 | **Per-tool capability scopes in `tools/pre-execute`**: each pinned tool maps to a capability (`fs.read`, `net.fetch`, `browser.navigate`…), with argument predicates (path under root, URL host in allowlist) and `ask` for side-effecting capabilities | High | Med | AIR's Capability Manager had this. Progent-style privilege policies cut AgentDojo ASR roughly sixfold in an independent reproduction (arXiv:2606.26479). Deterministic and outside the model |
| 4 | **Egress control** for MCP children and the agent's own fetch tools: a network namespace plus a filtering proxy with a per-server `allowHosts` | High | Med–High | The sandbox currently has no network vocabulary. Exfiltration needs an outbound channel, and cutting it defeats most of rows #5 and #6. Docker MCP Gateway's `--block-network`/`allowHosts` and Pipelock are reference designs |
| 5 | **Output taint and quarantine**: label every MCP result `untrusted(server)` in the session log. When any untrusted result is in context, escalate side-effecting capabilities (row 3) from `allow` to `ask`, or deny cross-server sinks (the lethal-trifecta rule). Optionally quarantine flagged responses the way mcp-context-protector does | High | Med | A cheap approximation of FIDES/APPA-style IFC (arXiv:2505.23643, arXiv:2607.24625) at turn granularity rather than value granularity. Must be enforced in guards, not prompts |
| 6 | **Secret blocking** on tool arguments and results (Docker `--block-secrets`-style pattern scan) | Med | Low | Catches common credential exfiltration; bypassable by encoding, so it complements rows 4–5 and does not replace them |
| 7 | **Spotlighting / delimiting** of tool results (datamarking or encoding untrusted text; Hines et al., Microsoft, 2024) | Low–Med | Low | Useful hygiene, but in-band defenses fall to adaptive attacks: 12 defenses bypassed at >90% ASR in "The Attacker Moves Second" (arXiv:2510.09023); AutoDojo recovers 28% ASR against a filter at 0% static ASR (arXiv:2606.15057). Never count it as a security boundary |
| 8 | **Plan/data separation (CaMeL / dual-LLM)** for high-risk profiles: a privileged planner sees only the user query; a quarantined model parses tool outputs into typed values; capabilities gate sinks | Very high for its scope | High | CaMeL solves 77% of AgentDojo tasks with provable security versus 84% undefended (arXiv:2503.18813). The Beurer-Kellner et al. design patterns (arXiv:2506.08837) — plan-then-execute, action-selector, map-reduce, dual-LLM, code-then-execute, context-minimization — offer cheaper partial versions. Fits the harness's PTC (`run_code`) mode as "code-then-execute". This is a loop change and requires an architecture.md update |
| 9 | **Static description scanning** (LLM or regex) at pin time | Low–Med | Low | Helps humans review. Detectors are evadable (MCP-ITP: 0.3% detection; cross-channel fragmentation defeated all seven tools tested in arXiv:2609.18217). Use it only as a reviewer aid in `dsh mcp diff` |
| 10 | **Signed lockfile + artifact build attestations** (§3.8, layers 2–3) | Med | Med | Matters most when profiles are shared; low marginal value for a single-user Jarvis until then |

Suggested sequencing:
- **Milestone A** (rows 1, 6, and tests 1–27): mostly inside `mcp-client` plus a new `mcp-trust` package.
- **Milestone B** (rows 2–3): reuses the existing sandbox and guard seams.
- **Milestone C** (rows 4–5): needs new network vocabulary in `sandbox-policy`, which is a cross-family change.
- Row 8 is a research track. For the project's evaluation (AIR RQ2), measure rows 1, 3 and 5 on AgentDojo and on MCPTox or MSB (arXiv:2510.15994). Include at least one adaptive attacker, because static-benchmark results for agent defenses have repeatedly overstated robustness.

## Sources (additional to inline)

- MCP Safety Audit (Radosevich & Halloran, 2025), arXiv:2504.03767
- MCP-Guard, arXiv:2508.10991
- SoK: Security and Safety in the MCP Ecosystem, arXiv:2512.08290
- "Are AI-assisted Development Tools Immune to Prompt Injection?" (seven clients, including Claude Code and Cursor), arXiv:2603.21642
- MCP Pitfall Lab / MCP-BOM, arXiv:2604.21477
- Claude Code MCP docs (list_changed auto-refresh; previous tools kept on refresh failure; no documented re-approval of changed definitions), https://code.claude.com/docs/en/mcp
- Claude Code changelog, https://code.claude.com/docs/en/changelog
- AIR prior art: `docs/adr/0005-tool-pinning-check-timing.md`, `docs/EVALUATION.md` RQ2, `tests/security/test_tool_pinning.py`, `core/tool_gateway/models.py`, `core/plugin_manager/manager.py`
