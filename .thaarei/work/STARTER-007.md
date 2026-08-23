---
workId: STARTER-007
title: Product-owned generated repository contract
origin: claimflow-generation-review
status: complete
owner: primary-agent
createdAt: 2026-08-22
updatedAt: 2026-08-22
sourceOfTruthIds: []
affectedPaths:
  - .thaarei/work/STARTER-007.md
  - docs/
  - templates/
  - tooling/governance/
  - tooling/starter-init/
  - package.json
  - starter-release.json
  - IMPLEMENTATION.md
---

# Product-owned generated repository contract

## Objective

Make generated client repositories product-owned: derive identifiers from
`product-id`, remove starter branding from generated output, and retain useful
product governance and release checks.

## Scope

Starter generator, generated governance/release tooling, generated docs,
capability output, fixtures, and the source contract. Existing client
repositories are not changed.

## Non-goals

Migrate or regenerate ClaimFlow, create external resources, publish packages,
or claim deployment/recovery evidence.

## Acceptance criteria

- [x] Generated product output contains no Thaarei, starter, or fixture-product residue.
- [x] Product identity drives generated namespace, package name, runtime IDs, and local infrastructure.
- [x] Generated release governance is product-owned and validates product metadata.
- [x] Focused tests and the starter validation suite pass.

## Validation

- `pnpm test -- tooling/starter-init/src/initializer.test.ts` passed: 73 tests.
- `pnpm typecheck` passed.
- `pnpm release:check`, `pnpm check:source-of-truth`, and `pnpm check:boundaries` passed.
- `pnpm check:implementation` correctly required dashboard regeneration after this record was added.
- `pnpm validate:starter` passed on 2026-08-23: release, governance, formatting, lint,
  typecheck, 73 tests, and all generated profile fixtures.

## Evidence

The initializer dry-run for ClaimFlow now returns `.claimflow` provenance and
work paths, `@claimflow/claimflow`, `release-manifest.json`, and
product-scoped worker task names without writing to the existing ClaimFlow
repository.

## Decisions

- Generated repositories use `.<product-id>` for work and provenance.
- Generated release metadata is `release-manifest.json`.
- Preserve package boundaries and product-name reference demonstrations.
- Scope is starter-only; ClaimFlow remains untouched.

## Blockers

None.

## Handoff

Generated contract paths and complete fixture validation are recorded above.

## Completion

Complete.
