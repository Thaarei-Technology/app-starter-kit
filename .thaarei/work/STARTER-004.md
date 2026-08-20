---
workId: STARTER-004
title: Add the client-project creation guide
origin: client-project-creation-guide
status: complete
owner: primary-agent
createdAt: 2026-08-20
updatedAt: 2026-08-20
sourceOfTruthIds: []
affectedPaths:
  - README.md
  - docs/create-client-project.md
  - docs/engineering-starter-kit.md
  - .thaarei/work/STARTER-004.md
  - IMPLEMENTATION.md
---

# Add the client-project creation guide

## Objective

Document how a developer creates an independent private client repository from
the Thaarei starter and validates the generated repository.

## Scope

- Add a source-facing creation guide with both supported empty-destination
  workflows.
- Document initializer options, profile dependencies, generated output, and
  validation evidence.
- Link the guide from the source README and engineering contract.

## Non-goals

- Change initializer behavior or generated client contents.
- Claim live deployment, backup restore, rollback, or native-device evidence.
- Add GitHub automation or publish a package.

## Acceptance criteria

- [x] The guide matches the initializer flags, profile dependencies, defaults,
  output behavior, and generated paths.
- [x] The README and engineering contract link to the guide.
- [x] Source governance and formatting checks pass.
- [x] The generated implementation dashboard includes this work item.

## Validation

`pnpm starter:init --help` passed with the repository's existing Node engine
warning. `pnpm check:implementation` and `pnpm check:source-of-truth` passed.
The full `pnpm validate:starter` gate passed release consistency, source
ownership, boundaries, implementation tracking, formatting, lint, strict
TypeScript, 57 tests, and all eight generated fixtures. The current shell uses
Node 26.4.0; the repository requires Node 24.19.x.

## Evidence

Reviewed the guide against `tooling/starter-init/src/index.ts`,
`tooling/starter-init/src/validation.ts`, `tooling/starter-init/src/generator.ts`,
and the initializer tests. The guide documents the generated
`docs/developer-guide.md` as client-repository guidance and keeps source-only
creation guidance in this document.

## Decisions

- Both documented creation routes use an empty destination.
- GitHub's "Use this template" flow is documented as a source-copy operation,
  not as client initialization.

## Blockers

None.

## Handoff

The source README and engineering contract point developers to the creation
guide. The generated client developer guide remains a separate runtime guide.

## Completion

Complete. The source README and engineering contract link to the new guide,
and the implementation dashboard was regenerated from this record.
