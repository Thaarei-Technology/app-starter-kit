---
workId: STARTER-006
title: Starter Kit V2 production hardening
origin: starter-v2-production-hardening-plan
status: in_progress
owner: primary-agent
createdAt: 2026-08-20
updatedAt: 2026-08-21
sourceOfTruthIds: []
affectedPaths:
  - .thaarei/work/STARTER-006.md
  - tooling/starter-init/src/
  - tooling/governance/src/
  - tooling/release/
  - starter-release.json
  - docs/
  - templates/
  - IMPLEMENTATION.md
---

# Starter Kit V2 production hardening

## Objective

Evolve `app-starter-kit` from a capable application scaffold into a
composable, production-oriented starter for LMS, ecommerce, SaaS, AI,
agentic, search/RAG, and other complex applications. This work changes only
the starter repository. `/srv/dev-environment/workspaces/projects/thaarei-lms`
is review evidence and must not be modified.

## Scope

The V2 capability registry, generator/provenance owners, generated starter
artifacts, governance and release checks, documentation, reference fixtures,
and the evidence record described below. This increment establishes and
validates the registry and provenance foundation; later plan phases remain
tracked here until their implementation evidence is present.

## Non-goals

No changes to `thaarei-lms`, Git commits, remote changes, paid-provider calls,
live Railway resources, or client-owned EAS credentials. Generated tooling is
not evidence of a live provider, deployment, restore, rollback, alert delivery,
or native mobile build.

## Acceptance criteria

- [x] V2 capability registry accepts canonical profiles, provider selections,
  and the deprecated alias without recording the alias as canonical metadata.
- [x] Generated Compose and release metadata consume the shared image catalog.
- [x] Source release metadata records the V2 local-service image provenance.
- [x] Focused formatting, type, test, boundary, and release checks pass.
- [x] Generated core packages expose actor/public contexts, authorization port,
  and normalized error taxonomy for composition-only transports.
- [ ] Complete the remaining tenancy, outbox, AI, platform, acceptance, and
  operational phases described in the complete plan.

## Validation

Run focused checks first, followed by `pnpm validate:starter` after the work
record passes the governance schema. Results and failures are recorded in the
validation ledger.

## Evidence

The active validation ledger is the evidence source for this work. All passed
checks are local starter-source evidence; external proof remains explicitly
blocked.

## Decisions

The decisions and exceptions section below is the authoritative record for
provider, dependency, compatibility, and readiness choices.

## Blockers

The blockers and unresolved decisions section below is the authoritative record
for client-owned external proof and incomplete implementation phases.

## Handoff

Run `pnpm implementation:sync` after material record changes. Do not mark this
work complete until every remaining phase has terminal evidence or an approved,
explicitly recorded exclusion.

## Complete plan

### Governance and scope

Create this record before implementation, preserve the pre-existing dirty
baseline, record every changed path, command, result, defect, dependency,
provider decision, readiness claim, blocker, and unresolved decision, and
regenerate `IMPLEMENTATION.md` only with `pnpm implementation:sync`. Do not
commit, publish, synchronize upstream, call paid providers, change live
Railway resources, or modify the LMS sample.

The pre-existing baseline is:

```text
 M IMPLEMENTATION.md
 M tooling/starter-init/src/generator.ts
 M tooling/starter-init/src/initializer.test.ts
 M tooling/starter-init/src/validate-fixtures.ts
?? .thaarei/work/STARTER-005.md
```

Those paths are user-owned baseline work and remain preserved.

### V2 profiles and provider choices

Use an explicit capability registry with these profiles and dependencies:

| Profile | Requires |
| --- | --- |
| `web` | `api` |
| `mobile` | `api` |
| `api` | none |
| `data` | none |
| `identity` | `api`, `data` |
| `tenancy` | `identity`, `api`, `data` |
| `jobs` | `data` |
| `events` | `data`, `jobs` |
| `external-api` | `api` |
| `storage` | `api`, `data`, `identity` |
| `python` | none |
| `ai` | `api`, `data`, `identity` |
| `agentic-ai` | `ai`, `jobs`, `events` |
| `payments` | `api`, `data`, `jobs`, `events`, `external-api` |
| `notifications` | `data`, `jobs`, `events` |
| `cache` | none |
| `rate-limit` | `api`, `cache` |
| `search` | `data`, `jobs`, `events` |
| `rag` | `ai`, `search`, `storage`, `python`, `jobs`, `events` |
| `observability` | none |
| `feature-flags` | `api`, `data` |

The base profile is implicit. `durable-ai` remains a deprecated alias for
`agentic-ai` for one major release and generated metadata stores only the
canonical name. Provider options are explicit and valid only with their
capability: `--payment-providers`, `--ai-providers`, `--email-provider`,
`--cache-provider`, and `--observability-exporters`. Deterministic adapters
are fixture-only; local email is Mailpit, local Redis-compatible behavior is
Valkey, search is PostgreSQL FTS/trigram, RAG uses pgvector, and normal
validation never contacts live providers.

### Generator and provenance

Introduce a `CapabilityDefinition` registry containing dependency and conflict
rules, generated packages/apps, environment variables, local/deployment
services, release dependencies, fixtures, and documentation. Resolve the
graph topologically, reject unknown/duplicate/incompatible selections before
writing, produce a normalized manifest, and verify unselected profiles emit no
artifacts. Generate bounded modules under capability directories and keep
package roots as public exports only.

Create one canonical dependency/container catalog for generator manifests,
Compose, deployment, `starter-release.json`, and release checks. Pin Node,
PostgreSQL/pgvector, MinIO, Valkey, Mailpit, and OpenTelemetry Collector with
exact tags and full SHA-256 digests. Detect generator/release drift, missing or
`latest` tags, lockfile disagreement, unsupported providers, missing profile
evidence, and stale fixture counts. Correct the known Expo package-version
drift.

### Core services and boundaries

Keep application use cases, state transitions, policies, ownership,
idempotency decisions, transaction ports, errors, and provider/repository
interfaces in `packages/core`. Add `ActorContext`, explicit `PublicContext`,
Zod-validated service methods, the provider-independent error taxonomy, and
composition-only API/webhook/worker entry points. Enforce that transports and
workers do not import repositories, drivers, provider SDKs, or implement
authorization/state transitions; providers stay in `packages/adapters`;
database drivers stay in `packages/database`; and core stays independent of
transport/database/provider packages.

### Tenancy, authorization, and RLS

Add organization-scoped users, organizations, memberships, governance roles
(`owner`, `admin`, `member`), product roles, permissions, grants,
invitations, and authorization audit events. Enforce last-owner protection,
invitation scope/expiry/single-use/revocation, no self-promotion, and audited
administrative changes. Add a deny-by-default `AuthorizationService` and
ownership/resource policies. Add organization IDs and constraints to all
tenant-owned tables. Generate restricted runtime and migration/admin roles,
transaction-local tenant context, pool context clearing, and PostgreSQL RLS
that denies access when context is absent or incorrect.

### Events and transactional consistency

Add `events` with versioned Zod domain events, transactional outbox,
delivery-attempt and dead-letter records, inbox receipts, leases, fencing
tokens, bounded exponential retry/jitter, audited replay, destination
adapters, and post-commit Graphile notification with polling recovery. Store
business state and its durable event in one transaction. Require idempotent
consumers. Apply the same final-transaction pattern to AI artifacts and all
required evidence so failure leaves no partial completion.

### AI and agentic execution

Add logical model registry roles (`chat.fast`, `chat.quality`,
`structured.default`, `embedding.default`), OpenAI/Anthropic adapters through
the AI SDK, deterministic fixture adapters, approval/budget/concurrency/step
limits, normalized usage/cost, AI runs/attempts/audit/telemetry/evaluation
records, fenced agent leases, and typed risk-classified tools. Mutating tools
call domain services. Cover invalid input, auth, approval lifecycle, budgets,
timeouts, throttling, malformed output, streaming/tool-loop failure,
duplicate/stale workers, rollback, and retry behavior.

### Platform capabilities

Implement observability foundations, Valkey cache and risk-based distributed
rate limiting, typed/audited OpenFeature flags, versioned notification
templates with Resend/Mailpit and in-app delivery, provider-neutral Stripe and
Razorpay payments with signed raw-body webhooks/refunds/subscriptions and
reconciliation, PostgreSQL search with authorization-aware indexing and
tombstones, and pgvector RAG with controlled text/HTML/PDF ingestion,
deterministic chunking, versioned embeddings, ACL-safe retrieval and citation
evidence. Keep all optional capabilities artifact-free when unselected.

### Operations, fixtures, and evidence

Generate protected operational screens for selected capabilities, redacted
OpenTelemetry/Sentry correlation and portable alert/runbook definitions,
Railway service/secret/health/restore/rollback/monitoring/rotation verifier
artifacts, and EAS configuration/workflows with native proof classified as
`blocked_external` until credentials and terminal evidence exist. Generate
disposable LMS and bounded commerce acceptance fixtures. Provide unique
Compose project names, explicit ports, health waits, sanitized evidence,
disposable volume cleanup, browser/failure/load/restore/security/SBOM and
dependency validation. Do not claim PCI, SOC2, penetration testing, formal
certification, live provider, Railway, restore/rollback, or native mobile
proof from generated files or local tests.

### Acceptance and release gates

Generator tests cover profile closures, profile absence, providers, aliasing,
determinism, browser/server separation, env ownership, service allocation,
pinning, release agreement, Railway/EAS artifacts, docs and work records.
Architectural/database/auth/storage/jobs/events/AI/payment/notification/cache/
rate-limit/search/RAG/browser/Python/security tests cover the stated failure
and recovery cases. The standard SaaS reference gate is 100 concurrent
sessions, 50 RPS, 10-minute warm-up, 15-minute measured interval, p95 under
500ms, non-injected errors under 1%, no exhaustion/growth/duplicates, and
correct tenant isolation on a documented 4-vCPU/8-GiB reference environment.

CI fast gates run formatting, lint, typecheck, unit/contract, governance,
migration, minimal/critical fixtures, audit, secret scan, and generated drift.
Nightly gates run all profiles, containers, LMS/commerce, browser, faults,
Python/container scans, SBOM, load, restore, and evidence scans. Release gates
require candidate nightly evidence, catalog/digest consistency, vulnerability
review, Railway verification, native evidence, and this work record.

### Sequence

1. Governance/baseline and focused current-state evidence.
2. Registry modularization and release provenance.
3. Core contexts/services/errors and composition-only enforcement.
4. Tenancy, authorization, and PostgreSQL RLS.
5. Outbox, inbox, leases, fencing, retries, dead letters, and atomic evidence.
6. AI registry, providers, approvals, budgets, tools, workflows, and evidence.
7. Observability, cache/rate-limit, flags, notifications, payments, search, RAG.
8. LMS/commerce fixtures and full local acceptance harness.
9. Railway/EAS operational evidence tooling and documentation.
10. Release hardening and handoff with all claims classified accurately.

## Current state and baseline evidence

The required pre-edit command was run on 2026-08-20. Existing dirty paths are
preserved and classified as pre-existing user work: `IMPLEMENTATION.md`,
`tooling/starter-init/src/generator.ts`,
`tooling/starter-init/src/initializer.test.ts`,
`tooling/starter-init/src/validate-fixtures.ts`, and `STARTER-005.md`.
`STARTER-005` is complete and records the prior all-server local proof.

Initial owner search found the generator, initializer validation/parser,
fixture harness, boundary checker, release checker, and governance sync as the
architectural owners. No change to `thaarei-lms` is in scope.

## Selected profile and write scope

This is a starter-source V2 implementation; the registry supports the full
profile graph and provider choices. Write scope is the starter source,
generated templates/artifact emitters, governance/release tooling, docs, and
this work record. No live provider, remote, commit, client repository, or
secret is in scope.

## Changed paths

The following V2 implementation paths are intentional. Existing dirty paths
remain preserved; formatter-only changes were limited to the relevant
initializer sources.

- `tooling/starter-init/src/capabilities.ts`: V2 capability graph, provider
  selection contract, canonical profile normalization, dependency catalog, and
  pinned image catalog.
- `tooling/starter-init/src/generator.ts`: consumes the capability plan and
  catalog for generated manifests, Compose, deployment metadata, environments,
  and profile-gated local services.
- `tooling/starter-init/src/index.ts`: records canonical V2 profiles, deprecated
  alias usage, and provider selections in write-once initialization metadata.
- `tooling/starter-init/src/validation.ts`: validates V2 profiles and provider
  option ownership before generation.
- `tooling/starter-init/src/initializer.test.ts`: profile, provider, canonical
  alias, release-provenance, and core-boundary regression coverage.
- `tooling/starter-init/src/validate-fixtures.ts`: fixture matrix updates for
  the V2 capability graph.
- `tooling/governance/src/source-of-truth.ts`: recognizes exported interfaces
  and type aliases as architectural owners for port and policy contracts.
- `tooling/governance/tests/governance.test.ts`: interface-owner regression
  coverage.
- `pnpm-workspace.yaml`: published Expo SDK 57 catalog pins.
- `starter-release.json`: cataloged pgvector, MinIO, Valkey, Mailpit, and
  OpenTelemetry images, all with tag and digest provenance.
- `IMPLEMENTATION.md`: generated only by `pnpm implementation:sync`.

## Validation ledger

| Command | Result | Evidence |
| --- | --- | --- |
| `git status --short` baseline | passed | Existing paths recorded above |
| `pnpm test` | passed | 61 focused source tests |
| `pnpm check:boundaries` | passed | Included in the final source gate |
| `pnpm release:check` | passed | Included in the final source gate |
| `pnpm validate:starter` | passed | Source checks plus the generated fixture matrix completed with no remaining process or container |
| `pnpm audit --prod --audit-level high` | passed | No known vulnerabilities found |
| Railway deployment/restore/rollback | blocked_external | Requires client-owned environment |
| EAS native Android/iOS builds | blocked_external | Requires client-owned EAS credentials |

### 2026-08-21 implementation evidence

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test -- --runInBand` baseline | passed | 59 tests across 3 files before this correction |
| `pnpm check:boundaries` baseline | passed | Existing V2 generator changes obey current boundary gate |
| `pnpm release:check` baseline | passed | Existing source release metadata parsed successfully |
| `pnpm typecheck` baseline | passed | Existing V2 registry compiled before correction |
| `pnpm format:check && pnpm typecheck && pnpm test && pnpm check:boundaries && pnpm release:check` | passed | 61 tests across 3 files; V2 alias and image-catalog regressions included |
| `pnpm implementation:sync && pnpm validate:starter` | failed (repaired) | The V2 record lacked required governance headings; no source validation ran past `check:implementation` |
| `pnpm implementation:sync && pnpm validate:starter` | failed (repaired) | Biome found an unused generator import after catalog centralization |
| `pnpm implementation:sync && pnpm validate:starter` | passed | Release, governance, formatting, lint, typecheck, 61 source tests, and generated fixture validation completed |
| `pnpm audit --prod --audit-level high` | passed | No known production vulnerabilities found |
| `pnpm typecheck && pnpm test` after core boundary generation | passed | 62 tests across 3 files |
| `pnpm test && pnpm check:fixtures` after core boundary generation | failed (repaired) | Governance initially rejected interface ownership, then the mobile fixture proved `expo-secure-store@57.0.2` was unpublished; catalog corrected to `57.0.1` |
| `pnpm release:check && pnpm test && pnpm check:fixtures` | failed (repaired) | Mobile fixture proved `expo-notifications@57.0.15` was unpublished; registry verification established published pins: Expo/router `57.0.15`, notifications `57.0.13`, SecureStore `57.0.1` |
| `pnpm release:check && pnpm test && pnpm check:fixtures` after repairs | passed | 64 source tests; all nine generated fixtures passed, including mobile, durable AI, Railway, Python, PostgreSQL, and MinIO runtime paths |

The catalog correction aligns generated Expo package pins with the source
release catalog (`57.0.15`, `57.0.13`, `57.0.15`, and `57.0.1` respectively)
and makes generated PostgreSQL/pgvector, MinIO, Valkey, Mailpit, and collector
references consume the same image owner. This is local generator evidence only;
no image pull, provider call, or live deployment was performed.

## Decisions, dependencies, and exceptions

- Keep the existing package stack and upgrade the generator contract before
  adding runtime provider SDKs; provider SDKs remain generated only for their
  selected adapter boundary.
- Preserve `durable-ai` as a compatibility alias and normalize it to
  `agentic-ai` in V2 metadata.
- Use deterministic local adapters and fixtures for validation; never call
  paid providers during normal starter checks.
- Record any new dependency, provider exception, release waiver, or profile
  conflict here before changing its owner.
- No production dependency or provider SDK was added in this increment.
- Core error mapping remains a transport concern; this increment defines only
  the provider-neutral core error types and authorization invocation port.

## Blockers and unresolved decisions

Live Railway, external alert delivery, backup/restore against client systems,
rollback against a deployed revision, provider production verification, and
native EAS builds remain client-owned external evidence. No production-
readiness claim is made until those records exist.

## Completion

Incomplete. Complete only after the implementation, applicable local gates,
`pnpm implementation:sync`, and evidence classification are recorded. The
final handoff must confirm original user changes remain present, no secrets or
unexpected containers remain, and no commit or remote change was created.
