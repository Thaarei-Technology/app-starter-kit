---
workId: STARTER-015
title: Implement deployment promotion and repository operating contracts
origin: STARTER-014
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/
  - packages/tooling/src/
  - packages/tooling/schemas/
  - .github/workflows/
  - starter-release.json
  - IMPLEMENTATION.md
---

# Implement deployment promotion and repository operating contracts

## Objective

Generate the smallest useful repository governance and fail-closed deployment
promotion contracts while preserving Dokploy-first and Railway-beta policy.

## Scope

Dokploy plan/apply/inspect/promote/rollback/evidence commands, release and waiver
schemas, project metadata validation, security contribution paths, Renovate
policy, and concise operations/threat-model/release/handover documentation.

## Non-goals

Do not deploy externally, infer CODEOWNERS identities, add a platform control
plane, or claim enforcement that the organization GitHub/Dokploy plan does not
provide.

## Acceptance criteria

- [x] Staging apply requires an exact digest and qualified server version.
- [x] Production promotion requires staging digest equality and attestation proof.
- [x] Rollback consumes a recorded compatible release digest.
- [x] External approval evidence cannot silently equal the initiating actor.
- [x] Project, release evidence, and security waiver metadata are strict.
- [x] Generated repository governance and operator docs are concise and scoped.

## Validation

Unit and generated fixture validation cover the deployment guards, known-key
project metadata, structured evidence subject kinds, finding-bound waivers,
private security reporting, and absence of unselected services or CI work.

## Evidence

The generated Dokploy adapter emits JSON evidence and the protected
release-candidate workflow verifies image attestations before invoking promotion.
Live environment evidence remains empty until independently observed.

## Decisions

- GHCR and GitHub attestations remain the initial defaults.
- GitHub environment protection is used when available; otherwise an external
  approval artifact and distinct actor are required and recorded.
- Railway emits static beta configuration and plan checks only.

## Blockers

Both Dokploy topologies, Railway, package publication, and real provider behavior
remain `blocked_external` pending approved credentials and disposable targets.

## Handoff

Run final source, package-consumer, security, and 13-fixture validation.

## Completion

Complete.
