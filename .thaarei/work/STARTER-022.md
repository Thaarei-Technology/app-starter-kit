---
workId: STARTER-022
title: Fix generated-contract defects and remove self-inflicted complexity
origin: DMS-CORE-FINAL-REVIEW
status: in_progress
owner: Starter maintainers
createdAt: 2026-09-11
updatedAt: 2026-09-11
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/capabilities.ts
  - packages/create-app/src/generator.ts
  - packages/create-app/src/validation.ts
  - packages/create-app/src/index.ts
  - packages/create-app/src/validate-fixtures.ts
  - packages/create-app/src/initializer.test.ts
  - packages/tooling/src/governance/boundaries.ts
  - packages/tooling/src/governance/source-of-truth.ts
  - packages/tooling/src/governance/cli.ts
  - packages/tooling/tests/check-release.test.ts
  - starter-release.json
  - package.json
  - packages/create-app/package.json
  - packages/foundation/package.json
  - packages/tooling/package.json
  - docs/engineering-starter-kit.md
  - docs/create-client-project.md
  - docs/template-AGENTS.md
  - templates/AGENTS.md
  - .thaarei/work/STARTER-022.md
---

# Fix generated-contract defects and remove self-inflicted complexity

## Objective

A final review of the starter against a real generated client (`dms-core`)
found four defects that forced product teams to fight the template, plus
several sources of complexity that carried no value. This work fixes the
defects, enforces the rules the contract already states, and removes
duplicated or vacuous machinery.

## Scope

Generator output for the `api`, `storage`, and `external-api` profiles; the
starter's own governance checks; the release catalog; the contract and operator
documentation. Existing generated repositories are independently owned and are
not modified by this work.

## Non-goals

Do not publish a stable release, change profile dependency semantics, or claim
live deployment, restore, rollback, or production readiness. Do not modify
`dms-core` or any other generated repository.

## Acceptance criteria

- [x] The `storage` profile uses SeaweedFS, not MinIO, as its local and
      integration fixture and image source.
- [x] The generated object-storage initializer no longer depends on the MinIO
      `mc` client.
- [x] `--transport rest` produces a `packages/api` with no tRPC imports,
      procedures, `/trpc` route, or `@trpc/server` dependency.
- [x] The transport defaults to tRPC when `web`/`mobile` is selected and to
      REST when `external-api` is selected without a first-party typed client.
- [x] Generated `packages/api` and `packages/database` contain no
      `process.env` reads.
- [x] `check:boundaries` rejects `process.env` reads in workspace packages
      other than `packages/config` and the migrator entrypoint.
- [x] `check:source-of-truth` no longer passes vacuously when no subject exists.
- [x] The duplicated Biome format invocation is removed.
- [x] The contract, operator, and generated agent docs describe the transport
      selection, the configuration boundary, and the storage provider.
- [x] The lockstep release version is bumped and `release:check` passes.

## Plan

1. Replace the MinIO image catalog and Compose services with SeaweedFS, using
   the `chrislusf/seaweedfs:4.45` image and a `weed shell` bucket initializer.
2. Add `--transport trpc|rest`, gate every tRPC import, procedure, route, and
   dependency behind the decision, and generate transport-appropriate tests.
3. Move instance and logger configuration out of `packages/api` into
   constructor parameters; make `createDatabaseRuntime` require its URL.
4. Add a `BOUNDARY_ENVIRONMENT` rule and a source-of-truth empty guard.
5. Update the contract, operator, and generated agent documentation.
6. Bump the lockstep version to `1.0.0-dev.2` and re-derive the release
   manifest.

## Validation

- `pnpm typecheck` passed on 2026-09-11.
- `pnpm lint` passed; `pnpm format:check` passed after one formatting pass.
- `pnpm release:check` passed: `starter release manifest is consistent`.
- `pnpm check:publication` passed: `package publication policy is consistent`.
- `pnpm check:source-of-truth` passed with the starter's explicit
  `--allow-empty`; the guard fails when a product repository has no owner.
- `pnpm check:boundaries` passed with the new environment rule.
- `pnpm check:implementation` passed.
- `pnpm exec vitest run --exclude '**/index.test.ts'` passed 127 tests across
  9 files, including the new transport, storage, environment-boundary, and
  release-version cases.
- A TypeScript parser check (`ts.createSourceFile` parse diagnostics) passed on
  132 generated TypeScript files across four configurations, including the
  `rest` transport and the combined storage/AI/tenancy/events output. Zero
  syntax errors.
- `pnpm check:fixtures` and the full `pnpm validate:starter` fixture matrix
  were not run: they require a Docker-capable target and network access that
  this environment does not provide. Generated-source compilation and the
  `all-server-capabilities` fixture remain unverified locally.

## Blockers

The generated fixture matrix needs a Docker runtime, registry credentials, and
network access. Until it runs, the SeaweedFS Compose definition and the REST
transport output are proven only by unit assertions, not by a started
generated application.

## Evidence

Machine check output is recorded above. No secret values are present. The
SeaweedFS image digest is taken from the reviewed `dms-core` baseline
(`chrislusf/seaweedfs:4.45@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5`)
and still requires provider-semantic qualification before production.

## Decisions

- SeaweedFS replaces MinIO because MinIO is in maintenance/archive state. One
  pinned image serves both the server and the bucket initializer.
- Transport selection is an explicit initializer option with a derived default,
  so a REST-only product is never forced to delete generated tRPC code.
- Configuration stays in the application entrypoint for now; the boundary rule
  prevents libraries from reading the environment. A future `packages/config`
  package is allowed by the rule and documented but not generated.
- The `base` profile remains an implicit foundation rather than a selectable
  profile; the documentation now says so.

## Handoff

Run `pnpm validate:starter` on a Docker-capable, registry-authenticated host to
complete the generated fixture matrix. Qualify the SeaweedFS provider
separately. Deferred from the review: splitting the 7190-line generator into
per-profile templates, deduplicating the pin and image catalogs into one
source, and replacing the duplicated release JSON schema. These are recorded
as follow-up work.

## Completion

Incomplete. Code, governance, documentation, and unit evidence are done. The
generated fixture matrix and the deferred simplification work remain.
