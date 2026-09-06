---
workId: STARTER-014
title: Add executable browser security performance and recovery proof
origin: STARTER-013
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/
  - packages/tooling/src/
  - tooling/
  - .github/workflows/
  - starter-release.json
  - IMPLEMENTATION.md
---

# Add executable browser security performance and recovery proof

## Objective

Turn coverage, browser accessibility, disposable DAST/load, runtime inspection,
and PostgreSQL recovery expectations into generated executable gates with
machine-readable artifacts.

## Scope

Vitest coverage thresholds, Playwright/Axe, k6, ZAP Automation Framework,
PostgreSQL backup/restore verification, runtime image inspection, pinned tool
launchers, and deep/release-candidate workflow wiring.

## Non-goals

Do not claim WCAG certification, impose a generic latency SLO, actively scan
production, or qualify a mutable/local image as a released artifact.

## Acceptance criteria

- [x] Source and generated coverage thresholds pass.
- [x] A production-built generated web fixture passes browser hydration and Axe.
- [x] Pinned k6 and ZAP run only against disposable targets and emit reports.
- [x] PostgreSQL backup/restore verifies reviewed migration and marker digests.
- [x] Runtime inspection rejects mutable references and unsafe runtime settings.
- [x] Recipe and semantic content hashes are distinct and machine-readable.

## Validation

- Source coverage passed at 85.67% lines, 89.28% functions, and 86.22% branches.
- Generated web coverage passed at 85.39% lines, 78.94% functions, and 66.17%
  branches.
- A fresh generated production web build passed two Playwright tests, including
  a real typed-client click, with no serious/critical Axe findings.
- A fresh identity fixture passed signup without premature authentication,
  Mailpit email verification, verified sign-in, authenticated Axe analysis,
  protected-route checks, logout revocation, and identical password-recovery
  status/body behavior for an existing and an absent account.
- k6 completed 150/150 checks with 0% request failures over five virtual users
  for 30 seconds.
- ZAP Automation Framework completed successfully with no Medium-or-higher
  alerts after replacing unsafe-inline CSP with request nonces.
- PostgreSQL 18.3 backup/restore produced a non-empty custom dump, restored into
  a fresh container, and verified the synthetic marker and migration digest.

## Evidence

Disposable reports were generated at `.artifacts/coverage/`,
`.artifacts/playwright/`, `.artifacts/security/`, and `.artifacts/recovery/` in
the generated qualification repositories. These ignored local artifacts are
not promoted as production evidence.

## Decisions

- Deep web validation builds and serves the production Next.js output.
- Web CSP uses unpredictable per-request nonces and forces dynamic rendering so
  framework scripts receive matching nonce attributes.
- Product teams own latency/capacity targets; the starter checks correctness and
  failure rate only.

## Blockers

Exact image scan, SBOM, attestation, and runtime evidence require the protected
registry-backed release-candidate workflow.

## Handoff

Run the complete pinned-runtime fixture matrix after governance synchronization.

## Completion

Complete.
