---
workId: STARTER-018
title: Reconcile final documentation and qualification tracking
origin: STARTER-017
status: complete
owner: primary-agent
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - .thaarei/work/
  - docs/
  - packages/create-app/src/
  - packages/tooling/src/governance/
  - packages/tooling/tests/
  - IMPLEMENTATION.md
---

# Reconcile final documentation and qualification tracking

## Objective

Close the final local documentation and work-tracking gaps after the production
hardening implementation, while preserving the distinction between completed
repository work and external Starter 1.0 release qualification.

## Scope

Update the reconciled remediation plan to reflect its implemented state, repair
stale historical validation wording, create explicit planned work for protected
release qualification and the experimental-mobile waiver review, regenerate the
bounded implementation dashboard, remove validation cleanup flakiness discovered
during the final run, and validate the resulting repository state.

## Non-goals

Do not publish packages, push images, deploy to Dokploy or Railway, run native
mobile builds, change profile maturity, create production evidence, or alter the
initializer invocation and generation contracts. Do not delete the already
merged remote feature branch as part of repository content cleanup.

## Acceptance criteria

- [x] The remediation plan describes completed local implementation and links to
      the implementing work records without implying that external qualification
      passed.
- [x] Historical validation records do not contain a result contradicted by their
      own completion evidence.
- [x] Protected Starter 1.0 qualification and publication have a detailed planned
      work record with exact admission, evidence, and non-goal boundaries.
- [x] The experimental mobile waiver has a separate planned review record with an
      owner, deadline, fail-closed outcome, and removal/renewal criteria.
- [x] `IMPLEMENTATION.md` is regenerated from the canonical work records.
- [x] Same-day completed work records are ordered deterministically by descending
      work ID so the bounded dashboard displays the latest records.
- [x] Fixture port allocation reserves the complete port set before releasing it,
      preventing duplicate ports within a multi-service validation run.
- [x] Documentation links, governance checks, and the full pinned-runtime starter
      validation pass with a clean worktree apart from this work item's changes.

## Validation

- `pnpm check:implementation`, `pnpm format:check`, `pnpm release:check`, and
  `git diff --check` passed after the documentation changes.
- A local-link audit passed for all 32 tracked and newly added Markdown files.
- Stale-text searches found no remaining rough-plan reference, pre-implementation
  directive, contradictory `implementation:sync` result, or obsolete
  continuing-work handoff.
- `pnpm exec vitest run packages/tooling/tests/governance.test.ts` passed the
  governance suite, including the same-day dashboard-ordering regression: 39
  tests across 2 discovered test files.
- The post-dashboard full validation reached `all-server-capabilities` and exposed
  a transient Python bind failure because the sequential allocator released each
  ephemeral port before selecting the next one. No listener remained after the
  fixture's normal process and Compose cleanup.
- The allocator now holds every requested port reservation until the unique set is
  complete. Focused fixture-port and governance tests passed: 41 tests across 3
  discovered test files; `pnpm typecheck` also passed.
- `THAAREI_FIXTURE=all-server-capabilities pnpm check:fixtures` passed after the
  allocator repair, including runtime health and cleanup.
- `pnpm validate:starter` passed under Node 24.20.0 and pnpm 11.22.0: release,
  publication, source-of-truth, boundary, and implementation governance;
  formatting and lint; strict type checking; 121 tests in 10 files; clean packed
  package consumers; and all 13 generated fixtures.

## Evidence

The pre-change audit found a clean merged tree, synchronized dashboard, no broken
local Markdown links, 118 passing source tests, clean package consumers, and all
13 generated fixtures passing. It also confirmed that `starter-release.json`
remains a prerelease with empty structured evidence, unqualified stable profiles,
blocked Dokploy topologies, and a mobile waiver expiring on 2026-10-05.

The reconciled plan now links completed implementation records and the two
remaining planned records. The obsolete local merged branch was removed after a
new `codex/starter-kit-final-cleanup` branch was created from current `main`; no
remote branch was deleted.

## Decisions

- Keep the original company-wide implementation plan as an audited historical
  baseline; it is not the removed rough golden-path proposal.
- Treat source implementation completion and stable release qualification as
  separate states.
- Track release qualification and mobile waiver review separately because they
  have different admission rules, infrastructure needs, and deadlines.
- Keep Railway beta and mobile production-forbidden; neither may be promoted by
  the stable Dokploy qualification work.
- Break same-day completed-dashboard ties by descending work ID because the work
  schema intentionally uses date-only update metadata.
- Reserve fixture ports as one set to prevent duplicate assignment while keeping
  generated application and Compose invocation unchanged.

## Blockers

None.

## Handoff

Execute `STARTER-019` only in approved protected release infrastructure. Begin
`STARTER-020` by 2026-09-28 and resolve or deliberately renew the waiver before
2026-10-05. Neither planned item authorizes synthetic evidence or a mobile
production-readiness claim.

## Completion

Complete. Local documentation, tracking, dashboard ordering, and fixture cleanup
are validated; external stable release qualification and mobile waiver review
remain accurately planned.
