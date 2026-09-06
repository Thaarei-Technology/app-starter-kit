# Thaarei engineering starter contract

This document is the reference contract for a private Thaarei starter that
generates independently owned client repositories. A generated product owns its
source and behavior, has no automatic template synchronization, and may consume
exact-version private foundation and tooling packages. It is a design contract
until the executable gates pass. A generated client repository copies the
selected profiles and the minimum agent guidance. It does not copy this reference
or any other broad documentation tree.

## Engineering invariants

- Use strict TypeScript for application code. Parse external input with Zod at every trust boundary.
- Keep one owner for each domain rule, wire contract, provider, job, and reusable UI boundary.
- Keep application authorization separate from authentication. Application code owns users, organizations, memberships, permissions, invitations, and audit records.
- Keep database access in `packages/database`. Web and mobile code uses an API boundary.
- Keep business logic in `packages/core` and keep framework and provider code at the edges.
- Add a capability profile only when the product needs it. An unused profile adds no package, service, environment variable, or CI job.
- Treat code, types, tests, and database constraints as behavioral truth. Inline source-of-truth blocks record ownership and rationale. They do not repeat implementation details.
- Extend an existing owner before creating an abstraction, library, component, service, or utility.
- Keep generated files under generation control. Never edit them by hand.
- Fail closed when required production or staging configuration is absent or invalid.
- Make external provider access explicit through adapters. Keep provider SDKs out of domain code.
- Graphile Worker owns job enqueueing for worker tasks. Cross-system event delivery that Graphile Worker cannot own requires an architecture decision record before implementation.
- Make AI tools typed, authorized, risk-classified, observable, auditable, and subject to cost limits.
- Keep deployment and scale choices behind the application interfaces. Moving from a Linux VM or Railway to a later cloud target must not change domain, API, or job contracts.

## Capability profiles

The base profile is always enabled. The initializer enables only the profiles
listed in the project configuration.

| Profile | Approved stack and boundary | Required profiles |
| --- | --- | --- |
| `base` | Node 24 LTS, pnpm 11, Turborepo, strict TypeScript, Biome, Vitest, CI gates, package boundaries, source-of-truth checks, and `.thaarei/work` | None |
| `web` | Next.js, React, Tailwind CSS v4, shadcn configured with Base UI, TanStack Query, TanStack Form, and `packages/design-tokens` | None |
| `mobile` | Experimental internal-only Expo SDK 57 profile. Selection requires `--allow-experimental`; production admission is forbidden in Starter 1.0 and native iOS/Android qualification remains blocked. | `api` |
| `api` | Fastify 5, tRPC 11, Zod, Pino, request context, and health checks | `base` |
| `data` | PostgreSQL and Drizzle, isolated in `packages/database` | `base` |
| `identity` | Better Auth for authentication artifacts only. The application owns authorization and its records. | `api`, `data` |
| `jobs` | Graphile Worker, idempotent task handlers, and PostgreSQL-backed workflow state in the `apps/worker` application | `data` |
| `ai` | AI SDK, a logical model registry, typed tools, authorization, risk classification, approval records, evaluations, telemetry, and cost limits | `api`, `data`, `identity` |
| `external-api` | Fastify REST adapters, OpenAPI, RFC 9457 Problem Details, and generated clients | `api` |
| `storage` | An S3-compatible object-storage adapter with application-owned metadata and access policy | `api`, `data`, `identity` |
| `python` | An isolated Python 3.12 service for work that TypeScript cannot meet cleanly | `api` or `jobs` |

The remaining V2 profiles complete the reusable foundation:

| Profile | Generated owner and local proof | Required profiles |
| --- | --- | --- |
| `tenancy` | Organization control-plane contracts, membership authorization, transaction-local PostgreSQL RLS, invitations, grants, and audit evidence; tenant-isolation and RLS fixtures | `identity`, `api`, `data` |
| `events` | Versioned Zod events, transactional outbox, inbox receipts, leases, fencing, retries, dead letters, replay, and SQL claim/delivery ports | `data`, `jobs` |
| `agentic-ai` | Fenced generic agent continuation and risk-tiered tool loop; application teams provide domain tools | `ai`, `jobs`, `events` |
| `payments` | Provider-neutral payment/refund/webhook ports plus Stripe/Razorpay signature adapters and recorded fixtures | `api`, `data`, `jobs`, `events`, `external-api` |
| `notifications` | Versioned templates, quiet-hour suppression, durable delivery contracts, Resend/Mailpit/Expo payload adapters | `data`, `jobs`, `events` |
| `cache` | Tenant-namespaced typed cache policy and Valkey contract with bounded TTL/invalidation | None |
| `rate-limit` | Risk-tiered distributed limiter policy and fail-closed middleware contract | `api`, `cache` |
| `search` | Tenant-filtered PostgreSQL FTS/trigram documents, indexes, tombstones, and authorization-aware retrieval | `data`, `jobs`, `events` |
| `rag` | pgvector 1536-dimension chunks, versioned provenance, ACL filtering, and citation verification | `ai`, `search`, `storage`, `python`, `jobs`, `events` |
| `observability` | Redacted correlation/telemetry contract, OTLP collector and injectable Sentry exporter | None |
| `feature-flags` | Typed, audited rollout evaluation that cannot grant permissions | `api`, `data` |

The deprecated `durable-ai` alias is not accepted by Starter 1.0. New projects
select `agentic-ai` directly.

Provider selections are explicit and affect generated environment schemas,
adapter dependencies, deployment variables, readiness fixtures, and release
metadata. Supported selections are Stripe/Razorpay, OpenAI/Anthropic,
Resend, Valkey, and OTLP/Sentry. RAG requires OpenAI because
`embedding.default` is pinned to `text-embedding-3-small` with 1536 dimensions;
Anthropic remains available for chat roles. Local proof uses deterministic AI,
Mailpit, MinIO, Valkey, PostgreSQL/pgvector, and an OpenTelemetry collector.
It does not claim paid-provider, live deployment, restore/rollback, or native
iOS/Android runtime evidence.

Durable agent workflows select both `ai` and `jobs`. A REST adapter does not
duplicate a tRPC operation unless it has an explicit external boundary.

Mobile is visible only as an experimental internal profile and requires explicit
`--allow-experimental` selection. Its recipe records
`productionPolicy: forbidden`, unqualified native evidence, blocked security
qualification, and the active `image-size` advisory waiver. Do not claim identity
compatibility until native development builds pass on iOS and Android. See the
[Better Auth Expo integration guide](https://better-auth.com/docs/integrations/expo).

An experimental mobile waiver must name the advisory IDs and dependency path,
record build-time reachability, accept only version-controlled local build assets,
prohibit untrusted input through the affected parser, expire within 30 days, name
an owner and removal condition, and set `blocksProduction: true`. Expiry disables
mobile generation until review or remediation.

## Starter package publication

The starter source may publish exactly these private GitHub Packages:

- `@thaarei-technology/create-app`
- `@thaarei-technology/foundation`
- `@thaarei-technology/tooling`

The root workspace remains `private`. Individual publishable manifests target
`https://npm.pkg.github.com`, use explicit file/export/bin allowlists, share one
lockstep version, and are released only by the protected workflow after clean
tarball-consumer validation. Prereleases use the `next` tag and stable releases
use `latest`. Generated repositories pin exact versions. Their own workspace
packages remain private and non-publishable.

## Package ownership

The generated monorepo uses these private workspace packages when their
profiles require them:

- `packages/foundation` contains shared primitives and configuration-free utilities.
- `packages/core` contains domain rules, use cases, and provider ports.
- `packages/contracts` contains product wire schemas and shared contract types.
- `packages/database` contains Drizzle schema, migrations, transactions, and repositories that need persistence.
- `packages/adapters` contains provider implementations and infrastructure clients.
- `packages/api` contains the Fastify and tRPC transport composition.
- `packages/api-client` contains generated external clients. Generated output is not hand-edited.
- `packages/design-tokens` contains shared design values and UI boundary types.
- `packages/test-support` contains test fixtures and explicit local test doubles.

Deployable applications are created only for selected profiles. The usual
server applications are `apps/api`, `apps/worker`, and `apps/web`. Mobile
projects use `apps/mobile` when the `mobile` profile is enabled.

## API, data, and AI rules

Use strict TypeScript settings, including `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, and
`useUnknownInCatchVariables`.

Use tRPC for first-party application calls. Build reusable immutable procedures
with centralized context and base procedures. Use REST and OpenAPI only through
the `external-api` profile. Keep RFC 9457 errors at external boundaries.

Use PostgreSQL transactions for business state and Graphile Worker enqueueing.
Task payloads must be validated, idempotent, and safe to retry. Store durable
workflow state in application tables.

AI tools must declare their input and output schemas, authorization rule, risk
class, approval requirement, telemetry fields, and cost budget. Provider and
model selection belongs in the logical model registry, not in domain code.

## Source-of-truth blocks

Add an inline block to architectural owners only: schemas, domain services,
tRPC router groups, repositories, adapters, policies, job definitions, AI
tools, and reusable UI boundaries. Do not annotate trivial helpers.

Use this exact shape:

```ts
/**
 * SOURCE OF TRUTH ID: <unique-id>
 * SOURCE OF TRUTH KEYWORDS: <keyword1>, <keyword2>, <keyword3>
 *
 * WHAT: <what this owner does>
 * WHY: <why this owner exists>
 * WHEN: <when callers use this owner>
 * HOW: <entrypoint function or class method>
 * BOUNDARIES: <what this owner may and may not do>
 */
```

`pnpm check:source-of-truth` enforces required fields, unique IDs, resolvable
`HOW` symbols, owner boundaries, and useful keywords. The check also rejects
duplicate ownership and generic catch-all owners.

## Work tracking and initialization

Store the canonical plan, evidence, validation results, and blockers in the
generated product namespace, `.<product-id>/work/<work-id>.md`. Generate the bounded root
`IMPLEMENTATION.md` with `pnpm implementation:sync`. Never edit that generated
file by hand.

For the end-to-end workflow, including destination-repository setup, initializer
options, profile selection, and generated-repository validation, see [Create a
client project](create-client-project.md).

Initialize a client repository with one deterministic command:

```text
pnpm starter:init --product-id <id> --client-id <id> --display-name <name> --package-scope <scope> --profiles <list> --deployment <dokploy|railway> --technical-owner <name> --operations-owner <name>
```

The initializer validates profile dependencies and rejects unknown profiles.
It requests a mobile scheme and application identifiers only when `mobile` is
selected. It requires `identity` to include `api` and `data`, `jobs` to include
`data` and `apps/worker`, `external-api` to include `api`, and durable AI
workflows to include `ai` and `jobs`.
The `python` profile requires `api` or `jobs`, emits its own health-checked
service and immutable container, and remains outside the pnpm workspace.

## Deployment and release

Deploy to a Linux VM through Dokploy by default. Deploy `web`, `api`, and
`worker` as separate applications from immutable images. Use Dokploy-managed
PostgreSQL, native domains and Traefik routing, health checks, S3 backups, and
registry-backed rollback. Use Dokploy Compose only for a dependency that must
run as one coupled group. Record the repository branch and deployment trigger.
See the [Dokploy rollback guide](https://docs.dokploy.com/docs/core/applications/rollbacks),
[backup guide](https://docs.dokploy.com/docs/core/databases/backups), and
[auto-deploy guide](https://docs.dokploy.com/docs/core/auto-deploy).

Railway is the supported alternative. Map each deployable application to its
own Railway service with explicit build and start commands, watch paths,
variables, health checks, and managed PostgreSQL. Railway maps Compose
services to separate services. See the [Railway Compose guide](https://docs.railway.com/guides/docker-compose)
and [monorepo deployment guide](https://docs.railway.com/deployments/monorepo).

Record approved majors, exact tested versions, image digests, enabled profiles,
and product release gates in generated `release-manifest.json`. The starter source keeps
its own `starter-release.json`. Commit
`pnpm-lock.yaml`, pin the Node LTS patch, set the `packageManager` field, and
use frozen-lockfile installs in CI. Change versions only through a starter
release that reruns the compatibility matrix. Keep [Node's release policy](https://nodejs.org/en/about/previous-releases)
as the versioning reference.

Security scans may waive an advisory only when the patched version is not
available and the affected record contains the exact advisory IDs, dependency
path, reachability, mitigation, owner, review and expiry dates, removal condition,
affected subject, and whether it blocks production. A broad or undocumented audit
exception is forbidden. An active high-severity waiver blocks promotion of the
affected artifact or profile. A starter release may contain an explicitly
experimental template with such a waiver only when the dependency is absent from
the published packages and stable generated repositories and that profile is
production-forbidden.

Azure, AWS, Kubernetes, and other scale targets are later deployment adapters.
They require compatibility evidence and must preserve the application
interfaces. A build, health check, or login is not live deployment, restore,
rollback, or native mobile proof.

## Governance commands

The starter exposes these commands. The implementation must keep their names
stable and record their results in the active work file:

- `pnpm check:source-of-truth`
- `pnpm check:boundaries`
- `pnpm check:implementation`
- `pnpm implementation:sync`
- `pnpm release:check`
- `pnpm validate:starter`

Escalate a missing owner, a new dependency, a provider exception, a profile
dependency change, a cross-system event path, or a production-readiness claim
to the active work item before changing code.
