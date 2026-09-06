---
workId: STARTER-020
title: Review the experimental mobile security waiver
origin: STARTER-018
status: planned
owner: Starter maintainers
createdAt: 2026-09-06
updatedAt: 2026-09-06
sourceOfTruthIds: []
affectedPaths:
  - starter-release.json
  - packages/create-app/src/
  - docs/
  - .thaarei/work/
  - IMPLEMENTATION.md
---

# Review the experimental mobile security waiver

## Objective

Review and resolve the experimental mobile `image-size` security waiver before it
expires on 2026-10-05, without weakening mobile's internal-only,
production-forbidden policy.

## Scope

The current advisory and Expo/Metro dependency path, published patched-version
availability, generated mobile fixture reachability, trusted-asset controls,
waiver evidence and dates, mobile generator admission, regression tests, and the
corresponding documentation and release metadata.

## Non-goals

Do not claim native or production readiness, allow implicit mobile selection,
remove `--allow-experimental`, process untrusted build assets, promote mobile as
stable or beta, or let a waiver renewal unblock production.

## Acceptance criteria

- [ ] Complete the review by 2026-09-28, leaving at least seven days before the
      current 2026-10-05 expiry.
- [ ] Recheck the authoritative advisory and the exact generated dependency tree
      instead of assuming the original affected range is still current.
- [ ] Prefer upgrading or removing the vulnerable path; after a verified fix,
      remove the waiver and prove the advisory is absent from a clean generated
      mobile fixture.
- [ ] If no fix exists and internal experimentation must continue, repeat the
      build-time reachability analysis and approve a new waiver for no more than
      30 days with refreshed evidence digest, review/expiry dates, owner,
      controls, removal condition, and `blocksProduction: true`.
- [ ] If review or approval is incomplete at expiry, make no bypass: mobile
      generation remains disabled until a valid review or fix lands.
- [ ] Mobile still requires direct `--profiles mobile --allow-experimental`, is
      absent from presets and dependency closure, and cannot pass production
      admission.

## Execution plan

1. Review GHSA-5p2g-fcmc-qvqq and current Expo/Metro release notes from
   authoritative sources; capture access dates and affected/patched ranges.
2. Generate a clean mobile fixture with the pinned runtime and record the exact
   lockfile dependency path and audit output.
3. Test the smallest compatible Expo/Metro or direct-resolution remediation. Run
   install, format, lint, typecheck, tests, static mobile validation, and the
   complete starter fixture matrix.
4. If fixed, remove the waiver and expiry gate together. If still affected,
   revalidate that only version-controlled trusted build assets reach the parser
   and issue a narrowly renewed, production-blocking waiver only after maintainer
   approval.
5. Verify negative selection, expired-waiver, production-admission, and no-residue
   tests, then update the work record, release manifest, and generated dashboard.

## Validation

Not started. Required validation includes a clean mobile dependency audit,
focused experimental-selection and waiver-expiry tests, `pnpm check:fixtures`,
`pnpm release:check`, and `pnpm validate:starter` under the pinned runtime.

## Evidence

The current waiver is `mobile-image-size-2026-09` for
GHSA-5p2g-fcmc-qvqq through `expo -> @expo/metro-config -> image-size@2.0.2`.
Its controls restrict parsing to version-controlled local build assets and block
all production use. This record must contain the refreshed dependency and audit
evidence when executed.

## Decisions

- A patched dependency is preferred over a renewed waiver.
- Any renewal is a new time-bounded risk decision, not an automatic date change.
- Mobile remains optional internal experimentation throughout Starter 1.0.
- Mobile expiry may disable that fixture but does not change the qualification of
  stable non-mobile packages or generated repositories.

## Blockers

The upstream remediation state must be checked near the review date. A missing
patch is not permission to extend the waiver without repeating the documented
risk review and obtaining maintainer approval.

## Handoff

Starter maintainers own the review and should begin by 2026-09-28. The weekly
deep-validation workflow is a fail-closed backstop, not a substitute for the
scheduled review.

## Completion

Not started. The current waiver expires on 2026-10-05T00:00:00.000Z.
