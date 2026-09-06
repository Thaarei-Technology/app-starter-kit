---
workId: STARTER-011
title: Reconcile and implement the production hardening golden path
origin: production-golden-path-reconciliation
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - .github/workflows/
  - .thaarei/work/
  - docs/
  - packages/create-app/
  - packages/tooling/
  - package.json
  - pnpm-workspace.yaml
  - starter-release.json
  - templates/
  - IMPLEMENTATION.md
---

# Reconcile and implement the production hardening golden path

## Objective

Turn the reviewed golden-path proposal into a bounded remediation of the current
Starter 1.0 implementation without replacing working package, generator,
capability, mobile, identity, tenancy, or release foundations.

## Scope

The reconciled implementation plan, source and generated security gates,
runtime/API hardening, telemetry, browser and recovery validation, deployment
promotion, repository governance, operational documentation, and qualification
evidence.

## Non-goals

Do not change the initializer invocation, required flags, presets, profile graph,
health paths, package publication boundary, generated-repository independence,
or mobile production policy. Do not deploy a company platform, publish packages,
contact paid providers, or claim live Dokploy, Railway, native-mobile, restore,
or production evidence without running those external gates.

## Acceptance criteria

- [x] The rough proposal is replaced by one reconciled remediation plan.
- [x] Existing invocation and profile-isolation contracts remain compatible.
- [x] Generated repositories receive executable self-hosted security gates.
- [x] Stable runtime profiles have safe API, telemetry, browser, and recovery proof.
- [x] Dokploy promotion consumes one verified immutable image digest.
- [x] Local and external qualification evidence remain accurately separated.
- [x] The complete starter validation matrix passes.

## Validation

- Baseline `pnpm validate:starter` passed on 2026-09-05 with 110 source tests,
  clean package-consumer validation, and all 13 generated fixtures.
- `pnpm implementation:sync`, `pnpm check:implementation`,
  `pnpm format:check`, and `git diff --check` passed for the replacement plan.
- The 2,064-line untracked rough plan was removed after its reconciled replacement
  passed governance and formatting checks.

## Evidence

The reconciled plan is `docs/APP_STARTER_KIT_1_0_PRODUCTION_HARDENING_REMEDIATION_PLAN.md`.
Executable evidence will be recorded here rather than inferred from generated
configuration or documentation.

## Decisions

- Preserve both `pnpm starter:init` and exact-version `pnpm dlx ... init` entrypoints.
- Keep GHCR as the initial application registry and Dokploy as the stable target.
- Keep OpenTelemetry profile-gated while making safe logs and request correlation
  part of every generated server.
- Use local scanner CLIs/containers instead of paid security products.
- Extend existing project metadata instead of adding a duplicate `project.yaml`.
- Keep company-wide platform services outside generated application repositories.

## Blockers

Live deployment, promotion, rollback, restore, monitoring, package publication,
and native-device proof require approved organization infrastructure and
credentials. They remain `blocked_external` until independently observed.

## Handoff

Run focused checks after every subsystem and the full pinned-runtime validation
before completion. Regenerate `IMPLEMENTATION.md` only with
`pnpm implementation:sync`.

## Completion

Complete for plan reconciliation. Implementation continues under sequential
bounded work records.
