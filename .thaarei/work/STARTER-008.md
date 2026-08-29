---
workId: STARTER-008
title: Add the approved DMS Core starter fixture and Expo SDK 57 patch pins
origin: dms-core-starter-readiness
status: complete
owner: primary-agent
createdAt: 2026-08-29
updatedAt: 2026-08-29
sourceOfTruthIds: []
affectedPaths:
  - tooling/starter-init/src/capabilities.ts
  - tooling/starter-init/src/initializer.test.ts
  - tooling/starter-init/src/validate-fixtures.ts
  - pnpm-workspace.yaml
  - starter-release.json
  - .thaarei/work/STARTER-008.md
  - IMPLEMENTATION.md
---

# Add the approved DMS Core starter fixture and Expo SDK 57 patch pins

## Objective

Add the exact DMS Core profile to the current V2 fixture matrix and align the
published Expo SDK 57 and React Native patch pins used by generated projects.

## Scope

The approved DMS Core fixture uses `api,data,identity,jobs,external-api,storage`
with Dokploy deployment artifacts and the `@thaarei` package scope at project
initialization time. The source catalog, generated mobile dependencies, release
manifest, fixture tests, and validation evidence are in scope.

## Non-goals

Do not initialize or modify the DMS Core repository. Do not commit or push this
starter change from the implementation worker. Do not change the existing
`readinessChecks` fix or unrelated V2 capabilities.

## Acceptance criteria

- [x] The source and release catalogs agree on the approved Expo and React Native pins.
- [x] The exact DMS Core profile is covered by initializer and generated-fixture validation.
- [x] Generated mobile projects pass `expo install --check`.
- [x] Focused source, release, governance, and type checks pass.
- [x] The full pinned starter validation passes all 13 generated fixtures.

## Validation

Validation results:

- `pnpm test -- tooling/starter-init/src/initializer.test.ts` passed: 75 tests.
- `pnpm release:check` passed.
- `pnpm check:source-of-truth` passed.
- `pnpm check:boundaries` passed.
- `pnpm check:implementation` passed after `pnpm implementation:sync`.
- `pnpm format:check` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- A fresh generated DMS Core repository using `api,data,identity,jobs,external-api,storage`,
  Dokploy, and `@thaarei` passed `pnpm install --frozen-lockfile --ignore-scripts` and
  `pnpm check`: 10 package typechecks, 10 builds, and 11 tests passed.
- `pnpm check:fixtures` validated web-only, internal-tool, web-developer-handoff,
  web-mobile-product, and durable-agentic-workflow. The command stopped at the first
  Docker-dependent runtime fixture because the local Colima Docker daemon was unavailable.
- After Colima started, the runtime check exposed a pre-existing V2 validator
  defect: generated repositories use a product-owned `*_FIXTURE_ID` variable,
  while the validator still injected `STARTER_FIXTURE_ID`. The validator now
  derives and sets the generated product-owned variable through
  `productIdentity()`.
- `pnpm dlx node@24.19.0 /usr/local/bin/pnpm check:fixtures` passed all 13
  fixtures after the repair, including the Docker-backed all-server runtime,
  both mobile Expo checks, the exact DMS Core profile, platform capabilities,
  RAG, and the full-profile fixture.

## Evidence

The source and release catalogs now use Expo `57.0.18`, Expo Notifications
`57.0.15`, Expo Router `57.0.17`, Expo Secure Store `57.0.2`, and React Native
`0.86.3`. The fixture matrix contains 13 entries, including the exact DMS Core
profile. Generated mobile validation passed `expo install --check`.

The Docker runtime diagnosis proved that both generated health endpoints
returned `instanceId: "local"` even though the retired starter variable was
present. The generated application reads its product-owned fixture variable,
so the validation harness now uses that same generated contract.

## Decisions

- Use the exact DMS Core profile from the approved DMS implementation plan.
- Keep package pins in the shared V2 catalog and copy them to release metadata.


## Blockers

No blocker remains for this work item. Native-device, live deployment,
backup/restore, and rollback evidence remain separate release gates.

## Handoff

The primary agent must inspect the diff and validation evidence before merging
this work into the starter `main` branch.

## Completion

Complete. The approved patch pins, exact DMS profile, and product-owned runtime
fixture validation pass on the current V2 starter baseline.
