---
workId: STARTER-022
title: Simplify the starter development workflow and qualify mobile foundations
origin: COMPANY-STARTER-REVIEW-001
status: complete
owner: Starter maintainers
createdAt: 2026-09-11
updatedAt: 2026-09-11
sourceOfTruthIds: []
affectedPaths:
  - packages/create-app/src/
  - packages/tooling/src/governance/
  - packages/tooling/tests/
  - docs/
  - templates/AGENTS.md
  - starter-release.json
  - .thaarei/work/
  - IMPLEMENTATION.md
---

# Simplify the starter development workflow and qualify mobile foundations

## Objective

Make generated web and mobile repositories fast to start, safe to configure,
clear for agents, and honest about which capabilities and deployment evidence
are production-ready.

## Scope

Capability presets, generation and setup workflow, local development feedback,
generated validation stages, mobile API and identity foundations, Dokploy
planning, governance ergonomics, generated documentation, qualification
metadata, and regression tests.

## Non-goals

Do not claim native iOS/Android, live Dokploy, package publication, signing,
backup, restore, or production readiness without external evidence. Do not add
social login, push notifications, upstream synchronization, or a generator
plugin framework.

## Acceptance criteria

- [x] Production-like runtimes fail closed when APP_ENV is missing or invalid.
- [x] Generated setup, doctor, and development commands have tested behavior.
- [x] Default presets contain only the functional authenticated baseline.
- [x] Everyday checks are separated from starter and production qualification.
- [x] Web and mobile use an explicit typed API configuration and selected identity support.
- [x] Mobile generation includes development-build commands and required dependencies only.
- [x] Dokploy plans can be inspected offline and mobile products expose the API.
- [x] Mobile security policy is consistent across source and generated checks.
- [x] Generated documentation and agent guidance match executable behavior.
- [x] Relevant source and generated-output regression checks pass.

## Validation

- Follow-up review corrections reject production/local environment mismatches
  across API, worker, web, and migrations; use the package-local Expo launcher;
  load `.env` in doctor; and generate native verification and password recovery
  callback routes.
- `THAAREI_FIXTURE=web-mobile-product pnpm check:fixtures`: passed generated
  Expo compatibility, TypeScript, tests, builds, and security checks.
- `THAAREI_FIXTURE=all-server-capabilities pnpm check:fixtures`: passed the
  generated server checks and runtime proof with the guarded web start wrapper.
- `pnpm typecheck`: passed under Node 24.21.0.
- `pnpm test`: 133 tests passed after generated application discovery was broadened.
- `pnpm release:check`: passed after catalog reconciliation.
- `pnpm check:fixtures`: web, internal-tool, and web handoff passed; web/mobile
  passed through Expo compatibility, checks, tests, and builds. The full server
  fixture then found patched `js-yaml` advisory GHSA-2883-xcg3-v3hh; the exact
  override was raised to 4.3.2; the affected platform, RAG, and full-profile
  fixtures passed on the final rerun.
- `pnpm validate:starter`: all source checks, publication/package checks, and
  generated fixtures passed through `dms-core`; the platform formatting defect
  was then corrected and the remaining platform, RAG, and full-profile fixtures
  passed individually.
- Dependency audit found two critical Next.js advisories affecting 16.3.1;
  exact tested selection raised to patched 16.3.3 without a waiver.
- Native iOS/Android, signing, live Dokploy, backup, and restore were not run.

## Evidence

Generated fixture output proves structural optionality, root environment loading,
Turborepo watch scripts, shared governance CLI consumption, mobile Expo package
compatibility, and generated application checks. Source tests directly assert
explicit APP_ENV, mobile absolute API configuration, native scheme headers,
setup/doctor commands, offline Dokploy planning, and mobile API ingress.

## Decisions

- Treat web and mobile as equal company-default clients.
- Use company-owned macOS infrastructure for iOS build evidence.
- Require mobile email/password identity and protected API behavior; keep push and social optional.
- Keep Dokploy as the first deployment target and retain independent generated repositories.
- Keep advanced capabilities optional and distinguish scaffolds from runnable integrations.

## Blockers

Native signing, macOS runner access, live Dokploy infrastructure, registry
credentials, and backup storage are external qualification prerequisites.

## Handoff

Record external qualification steps and owners without synthesizing evidence.

## Completion

Follow-up review corrections are complete. Company-default release admission
remains in STARTER-019 and mobile production qualification remains externally
gated by STARTER-020 and the macOS/signing requirements above.
