---
workId: STARTER-012
title: Add the self-hosted security toolchain and CI tiers
origin: STARTER-011
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - .github/workflows/
  - packages/create-app/src/
  - packages/tooling/src/
  - packages/tooling/schemas/
  - tooling/security/
  - package.json
  - pnpm-workspace.yaml
  - starter-release.json
  - IMPLEMENTATION.md
---

# Add the self-hosted security toolchain and CI tiers

## Objective

Provide pinned, locally runnable secret, SAST, filesystem/configuration, image,
and SBOM checks and generate fast, deep, and release-candidate CI tiers without
requiring a paid security service.

## Scope

Security tool catalog, scanner launcher and policy, waiver schema, source and
generated commands, generated scanner configuration, workflows, tests, and
release metadata.

## Non-goals

Do not upload source or findings to a hosted scanner, scan production actively,
publish packages, push images, deploy infrastructure, or weaken the mobile
waiver. Do not run heavyweight scanners during ordinary generator unit tests.

## Acceptance criteria

- [x] Every scanner image is versioned and digest-pinned.
- [x] Source and generated repositories expose stable security commands.
- [x] Generated CI separates pull-request, deep, and release-candidate gates.
- [x] Waivers identify scanner, finding, severity, subject, and evidence.
- [x] Synthetic policy tests prove blocking and expiry behavior.

## Validation

- `pnpm security:policy-test` passed; synthetic Gitleaks and Semgrep findings
  were blocked and clean fixtures passed.
- `pnpm security:secrets` passed with the corrected default-rule extension.
- `pnpm security:sast` passed with zero findings.
- `pnpm security:fs` and `pnpm security:config` passed for the source tree.
- `pnpm release:check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm test` passed; 117 tests passed in 9 files.
- `pnpm packages:pack-check` passed clean-consumer validation.
- `pnpm check:fixtures` passed all 13 generated fixtures.

## Evidence

Pinned scanner digests are recorded in `starter-release.json` and the generated
release manifest. SARIF/JSON reports are emitted under ignored
`.artifacts/security/`. Source and generated workflow files provide isolated
pull-request security, scheduled/manual deep validation, and protected release
candidate paths.

## Decisions

- Scanner CLIs run in pinned containers through one tooling-owned launcher.
- Gitleaks owns secrets; Trivy owns vulnerability, license, configuration,
  image, and SBOM scanning; Semgrep owns the reviewed local SAST rules.
- Pull-request workflows do not receive publication, registry-write,
  deployment, backup, or production credentials.

## Blockers

Image scanning and attestation evidence still require an exact target image to
exist. Live registry and deployment proof belongs to later work items.

## Handoff

Run unit/type/governance checks before the full fixture matrix.

## Completion

Complete.
