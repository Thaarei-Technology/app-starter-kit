---
workId: STARTER-017
title: Remediate final production hardening review findings
origin: STARTER-016
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src
  - packages/tooling/src
  - .thaarei/work
  - IMPLEMENTATION.md
---

# Remediate final production hardening review findings

## Objective

Close the actionable findings from the final production-hardening review without
changing the starter's invocation, profile selection, or deployment-target
contracts.

## Scope

Harden generated identity enrollment, bounded web proxying, private-image
scanner authentication, runtime-image qualification, and Dokploy promotion
evidence. Add focused generator and tooling regression coverage.

## Non-goals

Do not publish packages, deploy external infrastructure, promote a release, or
convert local validation into production qualification.

## Acceptance criteria

- [x] A password-authenticated user can bootstrap a first TOTP or passkey while
      recovery-only sessions remain unable to change account factors.
- [x] Generated web proxies enforce request and response limits even when
      `Content-Length` is absent or misleading.
- [x] Private GHCR image scanning receives explicit short-lived credentials
      without persisting them in generated files or logs.
- [x] Runtime inspection executes the declared application entrypoint under the
      hardened container policy and observes health and graceful termination.
- [x] Dokploy promotion requires attributable approval and verifies the active,
      terminal deployment digest before emitting passing evidence.
- [x] Focused tests, generated fixture validation, and governance checks pass
      under the pinned Node and pnpm versions.

## Validation

- `pnpm exec vitest run packages/tooling/src/security.test.ts
  packages/create-app/src/initializer.test.ts` passed: 54 tests in 2 files.
- `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` passed under Node
  24.20.0 and pnpm 11.22.0.
- `pnpm check:fixtures` passed all 13 approved generated repositories,
  including the web/data/identity and full-profile consumers.
- The first `pnpm validate:starter` attempt stopped at
  `IMPLEMENTATION_STALE`, as expected after creating this work item and before
  running the required generated-dashboard synchronization; no code check
  failed in that attempt.
- After `pnpm implementation:sync`, `pnpm validate:starter` passed release and
  publication policy, source-of-truth, boundary and implementation governance,
  formatting, lint, type checking, 118 tests in 9 files, clean packed-package
  consumers, and all 13 generated fixtures.

## Evidence

Source and clean generated-consumer validation prove the new contracts compile
and the focused policy regressions pass. No live private-image scan, runtime
container execution, Dokploy deployment, or production evidence is claimed by
this remediation; those remain release-environment qualification gates.

## Decisions

- Initial factor enrollment accepts only a recently established verified
  password session; factor removal and replacement retain stronger assurance.
- Proxy byte limits are enforced by bounded reads rather than trusting
  caller-supplied length headers.
- Scanner credentials are injected only into the scanner process environment.
- Dokploy evidence is based on structured deployment state rather than JSON
  substring searches.

## Blockers

None.

## Handoff

Use the protected release environment to exercise the new private GHCR scan,
actual-entrypoint runtime inspection, and structured Dokploy deployment polling
before changing any external qualification from blocked or unqualified.

## Completion

Complete.
