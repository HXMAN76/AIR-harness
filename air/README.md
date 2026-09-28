# AIR workspace

AIR-owned code for the AIR local-first personal agent, built on a fork of an MIT-licensed upstream agent harness. The plan and its evidence live in [research/research.md](../research/research.md); the development guide is [research/notes/08-dev-contrib-guide.md](../research/notes/08-dev-contrib-guide.md).

## Layout

```
air/
  pnpm-workspace.yaml     separate pnpm workspace (bundles/*, packages/*)
  bundles/air/            @air/dsh-air-bundle: product defaults as a Cordis patch
  packages/<pkg>/         AIR plugins (added feature by feature)
  examples/               profile-patch examples, e.g. the local Ollama route
  UPSTREAM-DELTA.md       every file AIR changes outside air/ and research/
```

This directory sits outside the upstream workspace globs (`packages/*/*`, `apps/*`), so upstream's workspace constraints, coverage, and bilingual-documentation gates do not apply here. Two repository-wide text gates still scan it: `verify-concrete-terms` and `verify-repository-references`.

## Branches

- `master` mirrors upstream (`upstream` remote) and is fast-forwarded only at upstream release tags.
- `air/main` carries AIR work and merges `master` at each upstream release tag.

After each merge: `pnpm install`, `pnpm run build`, bump AIR peer ranges, run `pnpm dsh --profile air --dump-config` and check stderr for unmatched patch targets, boot once, run AIR tests.

## The `air` profile

```sh
pnpm dsh --profile air --from-default-profile web     # create the profile from the Web template
pnpm dsh plugin --profile air add "$PWD/air/bundles/air"
cp air/examples/ollama.profile.cordis.patch.yml ~/.dsh/profiles/air/cordis.patch.yml
echo 'OLLAMA_API_KEY=ollama' >> ~/.dsh/.env
pnpm dsh --profile air --dump-config                  # inspect the composed tree
pnpm dsh --profile air                                # boot the Web UI
```

The bundle disables the upstream rows that send data to, or depend on accounts with, the upstream vendor's services, and makes a local Ollama model the default. See [bundles/air/cordis.patch.yml](bundles/air/cordis.patch.yml).

## Known issues

- Skill discovery also reads the user-level `~/.agents/skills` and `~/.dsh/skills` roots, so every skill installed there for other agents enters the AIR skill catalog. With a small local model this derails answers (observed with `qwen3:8b` and 36 unrelated user skills). The AIR bundle should point `skill-filesystem` at an AIR-owned root once its Config fields are confirmed.

## Quality bar

AIR packages keep ESM-only modules, the package README template (Summary, Model Experience, Known Limitations), REAL-composition Loader tests for product-visible plugins, and 100% per-file coverage. They do not require Chinese translation pairs.
