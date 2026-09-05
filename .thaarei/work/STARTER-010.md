---
workId: STARTER-010
title: Implement the Starter Kit 1.0 remediation plan
origin: starter-1.0-final-review
status: complete
owner: primary-agent
createdAt: 2026-09-05
updatedAt: 2026-09-05
sourceOfTruthIds: []
affectedPaths:
  - AGENTS.md
  - docs/
  - packages/
  - .github/workflows/publish-packages.yml
  - .nvmrc
  - templates/
  - package.json
  - pnpm-workspace.yaml
  - starter-release.json
  - IMPLEMENTATION.md
---

# Implement the Starter Kit 1.0 remediation plan

## Objective

Reconcile the final Starter 1.0 governance decisions, establish the three
publishable package contracts, replace unsafe generator behavior, and implement
machine-enforced maturity, qualification, security, and deployment foundations.

## Scope

Starter source, generated product output, public package boundaries, governance,
release evidence, stable profiles, deployment adapters, and validation fixtures.

## Non-goals

Do not modify Fleet, publish a package, create a remote repository, deploy live
infrastructure, or claim native mobile, Railway, backup/restore, or Dokploy live
qualification without external evidence.

## Acceptance criteria

- [x] Only the three approved private packages can be published.
- [x] Mobile requires explicit experimental opt-in and cannot pass production admission.
- [x] Source maturity, qualification, production policy, and evidence are separate validated contracts.
- [x] Generator selection, rendering, hashing, and writes are strict and deterministic.
- [x] Stable generated profiles and deployment artifacts satisfy the revised plan.
- [x] Relevant source and generated-repository validation passes.

## Validation

- Official Node 24.20.0 Linux x64 archive checksum matched the published
  `SHASUMS256.txt`; all commands below used that exact runtime and pnpm 11.22.0.
- `pnpm install --frozen-lockfile --ignore-scripts` passed.
- `pnpm release:check` passed the version, package, image, qualification, waiver,
  and release-manifest contract.
- `pnpm check:publication` passed the exact three-package allowlist.
- `pnpm typecheck` passed.
- `pnpm test` passed 110 tests in 8 test files after the final review
  remediations.
- `pnpm packages:pack-check` built all three package tarballs, computed SHA-256
  evidence, and installed them together in a clean offline consumer.
- `pnpm validate:web-handoff` passed the generated Postgres/Mailpit lifecycle,
  two-role migrations and checksum rejection, package typechecks/builds,
  same-origin client/proxy boundaries, email verification, enumeration-safe
  recovery, password-reset session revocation, fresh login, and non-root API/web
  production-image runtime proof.
- `pnpm check:fixtures` passed all 13 clean generated-repository fixtures under
  Node 24.20.0. This included mobile's platform-neutral Expo compatibility and
  active-waiver checks, exact Railway generation, isolated profile harnesses,
  and the all-server Docker/PostgreSQL runtime proof with two-role migrations,
  API, worker, web, Python, pgvector, MinIO, Valkey, Mailpit, and OTel services.
- `pnpm validate:starter` passed the complete final governance, formatting,
  lint, typecheck, source-test, clean-consumer pack, and 13-fixture matrix after
  the final package-deploy and runtime-image corrections.
- The final review remediation added fail-closed release-evidence admission,
  tag/version/channel binding, exact product-evidence matching, structured
  dry-run JSON failures, transaction-scoped membership resolution, tenant RLS
  for storage metadata, verified organization propagation, the Better Auth
  passkey completion route, and recent-assurance protection for recovery-code
  rotation. Targeted tests passed 66 cases across the affected suites, the
  all-server generated fixture passed separately, and the complete validation
  matrix passed afterward.
- `docker buildx imagetools inspect node:24.20.0-bookworm-slim` resolved the
  recorded multi-platform digest
  `sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`.

## Decisions

- The starter source has a narrow three-package publication exception.
- Generated product workspace packages remain non-publishable.
- Mobile remains internal, experimental, unqualified, and production-forbidden.
- Package/schema boundaries precede the generator rewrite.
- Dokploy qualifies first; Railway remains beta pending live evidence.
- Node 24.20.0 replaced 24.19.0 only after its full compatibility matrix passed.
- Graphile Worker schema migrations run under the dedicated migrator role;
  worker/runtime credentials receive bounded runtime grants and never migrate.
- Generated CI builds each application image once, emits dependency and SPDX
  SBOM evidence, records immutable digests, creates provenance attestations, and
  verifies those attestations before the evidence artifact is accepted.
- Local generated-repository qualification consumes packed foundation/tooling
  tarballs, so clean installs and container builds exercise package contents
  without host-only absolute file dependencies.
- Runtime package manifests allowlist built artifacts. Container cleanup removes
  application source only and never deletes dependency implementation files.

## Blockers

Live Dokploy and Railway API qualification, backup/restore exercises, protected
staging/production promotion, GitHub Packages publication, and native mobile
build evidence require organization environments, credentials, and independent
approvals. They remain release-admission blockers, not missing local implementation.
The exact mobile advisory waiver expires on 2026-10-05 and disables mobile
generation after expiry until it is reviewed or the dependency is fixed.

## Evidence

The source package split, package publication workflow, strict generator,
qualification/evidence schemas, stable profile implementations, migration roles,
identity recovery and assurance policy, local lifecycle, container hardening,
supply-chain workflow, and Dokploy/Railway adapters are implemented in the paths
listed above. Generated client packages remain private and non-publishable.

## Handoff

Do not change `starter-release.json` to `released`, publish the packages, promote
Railway, or claim mobile readiness until the corresponding external evidence is
attached and passes admission. Configure protected GitHub environments so the
production approver differs from the initiating developer.

## Completion

Complete for the locally implementable Starter 1.0 remediation scope. Starter
1.0 release admission remains intentionally blocked on the external evidence
listed above.
