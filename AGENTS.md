# Thaarei starter repository instructions

This repository is the source for a private starter that generates independently
owned client repositories. Generated products own their source and behavior while
consuming narrowly scoped, exact-version private foundation and tooling packages.
The engineering contract is in [docs/engineering-starter-kit.md](docs/engineering-starter-kit.md).
The generated-repository instructions are in [docs/template-AGENTS.md](docs/template-AGENTS.md).
Read those files when changing the starter contract or its generated output.

## Start every task

1. Read this file and the active `.thaarei/work/<work-id>.md` file.
2. Run `git status --short` before editing. Preserve unrelated user changes.
3. Find the owner with `rg -l '<keyword>'` or `grep -Rl '<keyword>'` before reading broad trees.
4. Read the owner, its tests, its callers, and its dependency boundaries.
5. Confirm the selected profile and the allowed write scope before changing files.

The active work item is the canonical plan and evidence record. Record changed
paths, validation results, blockers, and unresolved decisions there. Generate
the bounded root `IMPLEMENTATION.md` with `pnpm implementation:sync`; never edit
that generated file by hand.

## Contract rules

- Keep one private repository per client and do not add upstream synchronization.
- Only `@thaarei-technology/create-app`, `@thaarei-technology/foundation`, and
  `@thaarei-technology/tooling` may be published. Publish them privately to
  `https://npm.pkg.github.com` only from the protected release workflow after
  package contents, checksums, tests, and the release manifest pass. Generated
  client workspace packages remain non-publishable.
- Use the mandatory base plus selected capability profiles. Unused profiles add no packages, services, environment variables, or CI jobs.
- Keep strict TypeScript, Zod at trust boundaries, explicit package boundaries, and fail-closed deployment configuration.
- Keep domain rules in `packages/core`, persistence in `packages/database`, provider implementations in `packages/adapters`, and transport composition in `packages/api`.
- Keep source-of-truth blocks on architectural owners only. Do not annotate trivial helpers or duplicate implementation details in the block.
- Record profile exceptions, new dependencies, provider changes, and readiness claims in the active work item.

## Governance commands

Keep these command names stable. The governance implementation supplies them:

```text
pnpm check:source-of-truth
pnpm check:boundaries
pnpm check:implementation
pnpm implementation:sync
pnpm release:check
pnpm validate:starter
```

Before handoff, run the smallest relevant check first, then the applicable
profile typecheck, tests, build, migration check, and security scan. Record
every result in the active work item. Treat deployment, backup restore,
rollback, and native mobile proof as separate evidence from local validation.

## Change safety

Extend an existing owner before creating a new abstraction or dependency. Keep
generated files under their generator. Keep secrets out of files, logs, and
work evidence. Do not reset, discard, or overwrite unrelated user changes.
