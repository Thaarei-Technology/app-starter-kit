---
workId: STARTER-021
title: Harden generated staging database and release artifacts
origin: FLEET-STAGING-001
status: in_progress
owner: Starter maintainers
createdAt: 2026-09-07
updatedAt: 2026-09-08
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/generator.ts
  - packages/create-app/src/initializer.test.ts
  - packages/create-app/src/validate-fixtures.ts
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
- [x] The bootstrap validation runtime can launch and remove generated Docker
      Compose dependencies through the Platform VM Docker daemon.
- [x] Container and host paths match for generated bind mounts, and generated
      loopback services are reachable from the validation process.
- [x] The complete `all-server-capabilities` fixture passes and removes its
      disposable containers and volumes.

## Plan

1. Extend the existing bootstrap profile with a pinned Docker CLI, the Platform
   VM Docker socket, host-equivalent source mounting, and host networking.
2. Update profile validation so an incomplete Docker-capable configuration is
   rejected before setup.
3. Add an explicit Docker capability preflight to the all-server fixture so a
   future runner fails with a precise error.
4. Rebuild the bootstrap runtime and run the smallest Docker preflight before
   the complete starter validation matrix.
5. Inspect Docker state after the run and confirm that fixture resources were
   removed.

The implementation also updates the external personal DevX profile at
`~/.codex/devx/profiles/fleet-starter-bootstrap`. Those files are not owned by
this repository and therefore are not listed in `affectedPaths`.

## Validation

- `pnpm exec tsc --noEmit` passed on 2026-09-07.
- `devx test test-skip-git` passed: 58 tests on Node 24.20.0.
- `devx test pack-check` passed.
- `devx test validate-starter` reached the final all-server fixture but was
  previously blocked because the DevX container had no Docker binary.
- `devx profile validate fleet-starter-bootstrap` passed after adding the
  trusted Docker validation service.
- `devx test docker-runtime` passed with Docker Engine 29.7.2, Docker Compose
  5.5.0, a mounted Docker socket, and a host-equivalent working directory.
- `devx test test-skip-git` passed 58 tests.
- `devx test validate-starter` passed the release, publication, governance,
  formatting, lint, typecheck, 132-test, package tarball, and complete generated
  fixture matrix. The formerly blocked `all-server-capabilities` fixture
  started its Compose dependencies, applied migrations, built and started the
  generated applications, passed health checks, and removed its resources.
- Post-run inspection found no matching fixture containers, volumes, or
  `fleet-validate-starter.*` temporary directories.

## Blockers

No local starter qualification blocker remains. Protected release evidence
still requires a reviewed commit and an explicitly authorized push; this work
does not infer that authorization.

## Evidence

The passing test outputs and the blocked fixture result are recorded above;
secret values are intentionally absent.

## Decisions

- Generate role passwords only on the target runtime or accept operator-supplied
  values; never place them in generated source or logs.
- Keep the migration job separate from long-running application services.
- Use Docker-outside-of-Docker for this trusted bootstrap profile. Mount the VM
  Docker socket, run the validation process with host networking, and mount the
  synchronized checkout at the same absolute path on both sides. Socket access
  is equivalent to host-level Docker control and is accepted for this profile.

## Handoff

Fleet owns importing the reviewed generator output and collecting protected CI,
Dokploy, DNS, rollback, and restore evidence.

## Completion

The Docker-enabled local qualification is complete. Protected release evidence
remains a separate handoff because no commit or push was requested.
