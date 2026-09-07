---
workId: STARTER-021
title: Harden generated staging database and release artifacts
origin: FLEET-STAGING-001
status: in_progress
owner: Starter maintainers
createdAt: 2026-09-07
updatedAt: 2026-09-07
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/generator.ts
  - packages/create-app/src/initializer.test.ts
  - .thaarei/work/STARTER-021.md
---

# Harden generated staging database and release artifacts

## Objective

Make generated data-enabled products wait for dependency health, expose a
credential-safe database role bootstrap command, and publish a one-shot
immutable migration image in the generated release workflow.

## Scope

Generator output, generated-output regression tests, protected workflow
readiness, role bootstrap and migration image contracts. Existing starter
release work remains planned and is not silently closed by this change.

## Non-goals

Do not publish a stable starter release, change product capability semantics, or
claim live deployment, recovery, or production readiness from local evidence.

## Acceptance criteria

- [x] Generated `dev:deps` waits for Compose health checks.
- [x] Generated workflow bootstraps roles before migrations.
- [x] Role credentials are generated or supplied without logging their values
      and written to a mode-0600 protected file.
- [x] Data-enabled output includes a one-shot migration Dockerfile and a
      migration artifact in the immutable-image matrix.
- [x] Private API ingress remains disabled unless `external-api` is selected.
- [x] Generator regression tests cover the new contracts.

## Validation

- `pnpm exec tsc --noEmit` passed on 2026-09-07.
- `devx test test-skip-git` passed: 58 tests on Node 24.20.0.
- `devx test pack-check` passed.
- `devx test validate-starter` reached the final all-server fixture but was
  blocked because the DevX container has no Docker binary; generated fixtures
  before that case passed.

## Blockers

The all-server fixture requires Docker-in-container support that is not exposed
by the current starter DevX profile. Run it in CI or a Docker-enabled disposable
runner before marking this record complete.

## Evidence

The passing test outputs and the blocked fixture result are recorded above;
secret values are intentionally absent.

## Decisions

- Generate role passwords only on the target runtime or accept operator-supplied
  values; never place them in generated source or logs.
- Keep the migration job separate from long-running application services.

## Handoff

Fleet owns importing the reviewed generator output and collecting protected CI,
Dokploy, DNS, rollback, and restore evidence.

## Completion

Pending the Docker-enabled all-server fixture and protected release evidence.
