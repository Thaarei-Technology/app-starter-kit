---
workId: STARTER-019
title: Qualify and release Starter 1.0
origin: STARTER-018
status: planned
owner: Starter release owners
createdAt: 2026-09-06
updatedAt: 2026-09-11
sourceOfTruthIds: []
affectedPaths:
  - .github/workflows/
  - starter-release.json
  - .thaarei/work/
  - IMPLEMENTATION.md
---

# Qualify and release Starter 1.0

## Objective

Produce independently verifiable evidence for the web and mobile baseline,
stable Starter 1.0 profiles, and standard Dokploy topology, then publish the
three lockstep private packages and promote the starter from prerelease to
stable without rebuilding tested artifacts.

## Scope

Protected GitHub package and GHCR workflows, clean registry consumers, immutable
application images, SBOM and vulnerability results, attestations, runtime-image
inspection, disposable Dokploy qualification, staging and production promotion,
rollback and restore exercises, monitoring receipt, structured release evidence,
qualification statuses, and the final release manifest/tag.

## Non-goals

Do not promote Railway from beta, weaken or renew
the mobile waiver, contact product-specific paid providers, select product SLOs,
RPOs, or RTOs, or change initializer commands, presets, profiles, package
boundaries, and generated-repository independence.

## Acceptance criteria

- [ ] The candidate commit and lockstep package version are frozen before external
      evidence is collected.
- [ ] All three packages pass tarball allowlists, checksums, tests, protected
      publication to `next`, and clean installation using repository-scoped read
      permissions.
- [ ] Every application image is built once, referenced by digest, scanned, has an
      SBOM and provenance/attestation, passes `gh attestation verify`, and passes
      actual-entrypoint runtime inspection under the hardened container policy.
- [ ] The candidate Dokploy server version passes API contract checks and both
      standard and hardened disposable topology suites.
- [ ] Both Dokploy suites prove migration locking, staging readiness, candidate
      checks, distinct-person approval, exact-digest promotion, process draining,
      schema-compatible rollback, monitoring receipt, encrypted backup, and
      restore verification.
- [ ] Every stable qualification gate has current structured evidence matching
      the exact release, generator version, recipe hash, source commit, provider,
      target, topology, artifact digests, and migration set.
- [ ] Failed or incomplete evidence leaves the manifest prerelease and does not
      publish a stable version or mutable production tag.
- [ ] After every stable gate passes, the lockstep `1.0.0` packages are published
      privately to `latest`, `starter-release.json` is marked released, and the
      immutable release tag and manifest are verified from a clean consumer.

## Execution plan

1. Confirm protected environments, package/GHCR permissions, repository package
   read grants, two-person approval, disposable Dokploy access, encrypted backup
   storage, and external monitoring. Record identities and resource identifiers,
   never credential values.
2. Create an exact lockstep release candidate such as `1.0.0-rc.1`, run the full
   pinned-runtime matrix, pack-test all packages, publish privately to `next`, and
   install them in clean temporary consumers using only approved read access.
3. Build each application image once from the frozen commit. Retain immutable
   digests, generate SBOM and provenance, scan the exact digests, verify GitHub
   attestations, and execute the declared entrypoints with non-root, read-only,
   dropped-capability, health, and graceful-drain checks.
4. Pin and qualify the Dokploy candidate version. Contract-test its privileged
   API, then run the complete standard and hardened topology suites against
   disposable infrastructure with isolated stateful services.
5. Deploy exact candidate digests to staging, run advisory-lock migrations and
   compatibility/smoke checks, obtain approval from a person other than the
   initiating developer, reverify digests and attestations, and promote without
   rebuilding.
6. Exercise monitoring, rollback to a recorded schema-compatible digest, backup,
   and restore to a fresh target. Verify application readiness, marker data, and
   migration digests after restore.
7. Add current machine-readable evidence records, change only proven stable
   qualifications to `qualified`, rerun release admission, publish lockstep
   `1.0.0` packages to `latest`, tag the exact commit, and verify the final release
   from a clean generated consumer.

## Validation

Not started. At minimum run the protected release-candidate and package workflows,
`pnpm validate:deep`, `pnpm validate:starter`, `pnpm release:check`, clean registry
consumer installation, attestation verification, both Dokploy live suites, and
post-release exact-version generation. Record every command and external receipt.

## Evidence

Evidence must conform to `packages/tooling/schemas/starter-release.schema.json`.
Local compatibility records from `STARTER-012` through `STARTER-018` are inputs,
not substitutes for protected registry, immutable-image, deployment, rollback,
monitoring, and restore evidence.

## Decisions

- Use `next` for prereleases and `latest` only for the admitted stable release.
- Keep all three package versions lockstep and all generated consumers exact-pinned.
- Build application images once and promote digests, never rebuilt tags.
- Dokploy is the only Starter 1.0 stable deployment target. Railway stays beta.
- An experimental or beta profile does not block the stable starter when it is
  absent from stable artifacts and its production policy is enforced.

## Blockers

Requires approved GitHub package/GHCR credentials and access controls, protected
release environments, a qualified disposable Dokploy environment for both
topologies, independent approval, external backup storage, and monitoring. Keep
this item planned until those prerequisites are available; never synthesize the
missing evidence.

## Handoff

Starter release owners coordinate execution with organization administrators and
the operations owner. Stop on any failed gate, retain the prerelease state, and
record the exact blocker plus recovery instructions before resuming.

## Completion

Not started. Stable Starter 1.0 remains intentionally unreleased.
