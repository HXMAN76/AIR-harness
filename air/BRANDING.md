# AIR branding plan

> **Status: placeholders.** The product name, mark, and copy are not final. "AIR" is the working name; implementation uses the placeholder values `{{PRODUCT_NAME}}` ("AIR"), `{{PRODUCT_TAGLINE}}`, and `{{PRODUCT_MARK}}` (a neutral text mark) supplied as Config of the AIR brand plugin, so the final brand is a one-file change. Layer 2 and 3 work below is deferred until the name is decided. The desktop app's identifiers (app id, URL scheme, `desktopName`, release tag format) are on hold for the same reason: they come from the desktop brand file as placeholders, and no release is published under provisional values.

AIR is a product built on a fork of an MIT-licensed upstream agent harness. The product shows its own name everywhere a user looks; the upstream origin appears only where the license and honesty require it.

## Rules

1. **Product surfaces say AIR.** Window titles, sidebar brand, welcome and onboarding copy, installer names, icons, CLI launcher name, README headline, demo slides.
2. **Attribution stays.** Keep the upstream `LICENSE` text with its copyright line (MIT requires the notice in copies and substantial portions), add an AIR copyright line for new work, keep `THIRD_PARTY_NOTICES.md`, and state the fork relationship once in an About/Credits section and in the README ("AIR is built on a fork of an open-source MIT-licensed agent harness").
3. **No upstream trademark in names or marketing.** The upstream brand guidelines ask projects not to use the upstream product name as a project name and not to use official brand materials in ways that imply endorsement; a full rebrand satisfies that. Describing the relationship truthfully in the attribution section is allowed.
4. **Model vendors are not branding.** Listing the vendor's models as one selectable provider (next to OpenAI, Anthropic, Ollama) is ordinary compatibility, not product branding. AIR's default model is local.
5. **Internal identifiers stay.** Package scopes (`@deepseek-ai/dsh-*`), the `dsh` source launcher, `$DSH_HOME`, and code identifiers are not user-facing in the AIR product and renaming them would conflict with every upstream merge. Users launch AIR through an `air` wrapper and see only AIR.

## Surfaces and how each is rebranded

Layers are ordered by merge cost. Prefer layer 1; use layer 3 only when nothing else reaches the surface, and record every layer-3 edit in [UPSTREAM-DELTA.md](UPSTREAM-DELTA.md).

**Layer 1 — composition only (done or zero upstream edits):**
- Account login, account Remote, account settings page, session-log upload, plugin inventory upload, feedback telemetry, vendor web search: disabled in [bundles/air/cordis.patch.yml](bundles/air/cordis.patch.yml).
- Default model: local Ollama route in the profile patch.
- CLI: an `air` launcher script that runs the source launcher with `--profile air` (planned; the upstream rule against package bins applies to upstream packages, not to a user-level wrapper).

**Layer 2 — AIR plugins filling upstream extension points (no upstream edits):**
- Sidebar brand: `ui-brand-official` registers `sidebar.brand.mark` and `sidebar.brand.name` only in the official build; AIR adds a client plugin `@air/dsh-client-ui-brand-air` that registers both slots with the AIR mark and name, and fills `conversation.hero.brand.mark` (declared in `packages/client/ui-conversation/src/client/contract/slots.ts`) so the upstream animated default no longer shows.
- Brand copy inside upstream dictionaries: the locale service throws on a second registration of the same namespace and locale, so strings cannot be overridden in place. The locale service does support additional locale definitions with a fallback chain ending in English, and dictionaries registered per namespace and locale. AIR can define `en-x-air` (fallback `en`) and `zh-x-air` (fallback `zh`) that register only the brand-bearing keys (`brand.localBuild`, the 0.2 preview notice, plugin-manager safety text, document-preview host text), and select that locale by default. Needs a spike to confirm the language picker labels and the stored preference behave acceptably.

**Layer 3 — carried edits (last resort, small, listed in UPSTREAM-DELTA.md):**
- `apps/web/index.html` `<title>`.
- Desktop: product name, app id, icons, installer strings, `dsh://` protocol display name in `apps/desktop` (only if the review demo uses the desktop app; the Web UI through the `air` profile avoids all of these).
- Root `README.md` headline and quickstart on `air/main`.

## Known brand-bearing strings at 0.2.0-rc.1

Found by searching client sources (full list: `grep -rn "DeepSeek Harness" packages/client/*/src`):
- `packages/client/locale/src/locales/en.ts`: `brand.localBuild` = "DSH Local Build" (page title and sidebar).
- `packages/client/ui-settings-models/src/client/locales.ts`: 0.2 preview notice (blocking dialog on first run).
- `packages/client/ui-plugin-manager/src/client/locales.ts`: install safety text.
- `packages/client/ui-settings-account/src/client/locales*.ts`: account and onboarding copy (disabled by the AIR bundle).
- `packages/client/ui-sidebar-documentpreview/src/client/office/locales.ts`: Office preview host text.
- `apps/desktop/electron-builder.config.d.mts`: protocol display name.

## Review-demo checklist

- Boot with the `air` profile; the local model answers with no upstream-vendor network calls.
- No upstream product name on the first screen, the sidebar, the page title, or dialogs (layers 2 and 3 for the title and preview notice).
- About/Credits and README carry the attribution sentence and license notice.
- Slides describe AIR as "built on a fork of an open-source MIT-licensed agent harness", with the upstream name in the related-work slide only.
