---
workId: STARTER-009
title: Record the approved App Starter Kit 1.0 implementation plan
origin: fleet-v2-starter-foundation-planning
status: complete
owner: primary-agent
createdAt: 2026-09-05
updatedAt: 2026-09-05
sourceOfTruthIds: []
affectedPaths:
  - docs/APP_STARTER_KIT_1_0_IMPLEMENTATION_PLAN.md
  - .thaarei/work/STARTER-009.md
  - IMPLEMENTATION.md
---

# Record the approved App Starter Kit 1.0 implementation plan

## Objective

Add the approved, decision-complete plan for turning this prerelease repository
into the company-wide App Starter Kit 1.0 foundation. The plan must be usable as
the implementation brief in this repository without requiring changes in the
Fleet Compliance repository.

## Scope

Documentation only. Add the implementation plan, record this documentation
change, and refresh the generated implementation dashboard.

## Non-goals

Do not implement the 1.0 architecture in this work item. Do not modify the Fleet
Compliance repository. Do not publish packages, deploy services, create remote
repositories, or change the existing starter contract as part of recording the
plan.

## Acceptance criteria

- [x] The complete approved plan exists at
      `docs/APP_STARTER_KIT_1_0_IMPLEMENTATION_PLAN.md`.
- [x] The plan distinguishes stable, experimental, and product-owned scope.
- [x] The plan specifies generator, runtime, environment, deployment, release,
      public-interface, testing, and Fleet-admission decisions.
- [x] The plan states that implementation occurs only in this starter repository.
- [x] Documentation formatting and governance validation pass.

## Validation

- `pnpm implementation:sync` passed and refreshed `IMPLEMENTATION.md`.
- `pnpm format:check` passed: 25 files checked with no changes required.
- `pnpm check:implementation` passed.
- `pnpm check:source-of-truth` passed.
- `pnpm check:boundaries` passed.
- `pnpm release:check` passed; the starter release manifest is consistent.
- `git diff --check` passed.

## Decisions

- Starter 1.0 is a breaking reset from the current prerelease contract.
- Engineers consume a private `@thaarei-technology/create-app` package.
- Generated applications are independent repositories with narrowly shared
  foundation and tooling packages.
- Dokploy is qualified first; Railway remains explicitly beta until live evidence
  exists.
- Fleet begins only after the selected stable core and Dokploy hardened blueprint
  pass their release gates.

## Blockers

No documentation blocker is known.

## Evidence

The approved plan contains 20 sections covering the execution boundary, audited
gaps, capability maturity, distribution model, generator contract, generated
foundation, environments, stable profiles, local development, containers,
Dokploy/Railway adapters, releases, public contracts, documentation, testing,
delivery phases, acceptance criteria, defaults, and implementation governance.

## Handoff

Future implementation work must use the plan document as its approved baseline,
create one or more new active work items, keep changes in this repository, and
record validation evidence per delivery phase.

## Completion

Complete. The approved plan is present in the starter repository, the generated
implementation dashboard is current, and all documentation/governance checks
listed above pass.
