---
workId: STARTER-005
title: Prove all-server-profile LMS bootstrap and runtime composition
origin: lms-starter-trial
status: complete
owner: primary-agent
createdAt: 2026-08-20
updatedAt: 2026-08-20
sourceOfTruthIds: []
affectedPaths:
  - tooling/starter-init/src/generator.ts
  - tooling/starter-init/src/initializer.test.ts
  - tooling/starter-init/src/validate-fixtures.ts
  - templates/
  - .thaarei/work/STARTER-005.md
  - IMPLEMENTATION.md
---

# Prove all-server-profile LMS bootstrap and runtime composition

## Objective

Use the all-server capability combination for a real LMS trial and feed
general starter composition or runtime defects back into the generator.

## Scope

The `web,api,data,identity,jobs,ai,durable-ai,external-api,storage,python`
profile combination, Railway deployment artifacts, local Linux/container
validation, and regression coverage for reusable starter behavior.

## Non-goals

Mobile, live Railway resources, production credentials, hosted AI providers,
remote repositories, backup/restore or rollback proof, and a broad LMS MVP.

## Pre-existing user changes

The working tree contained edits to `tooling/starter-init/src/generator.ts` and
`tooling/starter-init/src/initializer.test.ts` before this work. They are
preserved and treated as user-owned baseline changes.

## Acceptance criteria

- [x] The all-server profile combination generates and passes the complete static gate.
- [x] Cross-profile web/API client composition is covered by regression tests.
- [x] Storage-enabled local development has a documented, pinned S3-compatible proof.
- [x] API, worker, web, Python, PostgreSQL, and object storage runtime checks pass locally.
- [x] General defects are fixed in the starter before the permanent LMS repository is generated.
- [x] All commands, changed paths, blockers, and external-only gates are recorded.

## Validation

Focused initializer tests passed after implementation: 59 tests across 3 files.

## Evidence

`pnpm validate:starter` passed, including all nine fixtures and the all-server
Docker runtime harness. The harness started PostgreSQL and MinIO, ran the
migration, started API/worker/web/Python, and reached their health endpoints plus
MinIO liveness. `pnpm audit --prod --audit-level high` passed with no known
vulnerabilities.

The mobile fixture's native export is intentionally not part of this Linux
all-server trial; its platform-neutral gates and dependency checks still run.

## Decisions

- Product sibling: `/srv/dev-environment/workspaces/projects/thaarei-lms`.
- Deployment artifacts: Railway.
- Local object storage: MinIO, pinned by explicit image digests.
- AI proof: deterministic local model through the policy and adapter seams.
- Handoff: independent uncommitted Git repository; local services stop cleanly.

## Resolved defects

- Preserved the pre-existing readinessChecks type correction and regression test.
- Kept tRPC and Better Auth clients alongside the generated OpenAPI client under
  `externalApi`, including the web reference flow.
- Added storage-gated pinned MinIO services, bucket initialization, local env
  values, and storage lifecycle commands.
- Separated API, worker, web, Python, PostgreSQL, and MinIO local ports and
  loaded root `.env` consistently for API and worker development.
- Added the all-server fixture and Docker-backed runtime acceptance harness.

## Blockers

Live Railway deployment, backup restore, rollback, and production readiness remain
external evidence gates.

## Handoff

Update this record after each starter correction and run
`pnpm implementation:sync` before handoff.

## Completion

Complete for local starter validation. Railway deployment, backup restore,
rollback, and native mobile evidence remain external or explicitly excluded.
