---
workId: STARTER-013
title: Harden generated runtime and telemetry boundaries
origin: STARTER-011
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/
  - starter-release.json
  - pnpm-workspace.yaml
  - IMPLEMENTATION.md
---

# Harden generated runtime and telemetry boundaries

## Objective

Apply secure API/web defaults, bounded outbound HTTP, safe diagnostics,
graceful process shutdown, profile-gated OpenTelemetry, and stronger runtime
container contracts without changing initializer or application invocation.

## Scope

Generated application configuration, transport hooks, adapters, tests,
container definitions, selected observability dependencies, and release
metadata.

## Non-goals

Do not add a security profile, hosted telemetry product, product-specific SLO,
or live production deployment. Do not expose raw dependency errors or sensitive
request material.

## Acceptance criteria

- [x] API and web security defaults fail closed and are regression-tested.
- [x] Readiness and logs do not disclose raw dependency or credential data.
- [x] Outbound HTTP has time, size, retry, and idempotency bounds.
- [x] API and worker processes drain on termination signals.
- [x] Observability is dependency-free when unselected and exports when selected.
- [x] Runtime images and deployment services use hardened defaults.

## Validation

- `pnpm typecheck` and `pnpm test` passed under Node 24.20.0; the source suite
  includes API origin, CSRF, request-ID, body-limit, readiness, redaction,
  outbound HTTP, telemetry, and graceful-shutdown coverage.
- Staging and production identity admission reject the checked-in local secret
  placeholder and Better Auth secrets shorter than 32 characters; local and CI
  retain the explicit non-production placeholder workflow.
- A disposable generated web fixture passed coverage, production browser
  navigation/hydration, Axe checks, k6, and ZAP passive DAST.
- The selected observability fixture delivered trace and metric payloads to the
  disposable local collector while an unselected fixture emitted no telemetry
  dependency or service.

## Evidence

Generated runtime configuration, tests, Dockerfiles, and deployment service
specifications are owned by `packages/create-app/src/generator.ts`. Local
executable evidence was observed in disposable `/tmp` fixtures; live image,
registry, and deployment evidence remains intentionally external.

## Decisions

- Preserve `/health/live`, `/health/ready`, and existing start commands.
- Prefer central generated owners over per-route or per-provider copies.
- Telemetry export failures remain observable but do not corrupt business
  readiness.

## Blockers

Exact-image attestation and live runtime inspection require a published image
digest and remain part of the protected release-candidate environment.

## Handoff

Continue with browser/recovery and full fixture qualification.

## Completion

Complete.
