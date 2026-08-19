# Thaarei engineering starter contract

This document is the reference contract for a private, self-contained Thaarei
template. It is a design contract until the executable gates pass. A generated
client repository copies the selected profiles and the minimum agent guidance.
It does not copy this reference or any other broad documentation tree.

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
| `mobile` | Expo SDK 57, Expo Router, React Native, Unistyles, Reanimated, Gesture Handler, SecureStore, and notifications | None |
| `api` | Fastify 5, tRPC 11, Zod, Pino, request context, and health checks | `base` |
| `data` | PostgreSQL and Drizzle, isolated in `packages/database` | `base` |
| `identity` | Better Auth for authentication artifacts only. The application owns authorization and its records. | `api`, `data` |
| `jobs` | Graphile Worker, idempotent task handlers, and PostgreSQL-backed workflow state in the `apps/worker` application | `data` |
| `ai` | AI SDK, a logical model registry, typed tools, authorization, risk classification, approval records, evaluations, telemetry, and cost limits | `api`, `data`, `identity` |
| `external-api` | Fastify REST adapters, OpenAPI, RFC 9457 Problem Details, and generated clients | `api` |
| `storage` | An S3-compatible object-storage adapter with application-owned metadata and access policy | `api`, `data`, `identity` |
| `python` | An isolated Python 3.12 service for work that TypeScript cannot meet cleanly | `api` or `jobs` |

Durable agent workflows select both `ai` and `jobs`. A REST adapter does not
duplicate a tRPC operation unless it has an explicit external boundary.

The Better Auth mobile integration remains a release gate. Do not claim
identity compatibility until native development builds pass on iOS and
Android. See the [Better Auth Expo integration guide](https://better-auth.com/docs/integrations/expo).

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

Store the canonical plan, evidence, validation results, and blockers in
`.thaarei/work/<work-id>.md`. Generate the bounded root
`IMPLEMENTATION.md` with `pnpm implementation:sync`. Never edit that generated
file by hand.

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
and compatibility evidence in `starter-release.json`. Commit
`pnpm-lock.yaml`, pin the Node LTS patch, set the `packageManager` field, and
use frozen-lockfile installs in CI. Change versions only through a starter
release that reruns the compatibility matrix. Keep [Node's release policy](https://nodejs.org/en/about/previous-releases)
as the versioning reference.

Security scans may ignore an advisory only when the patched version is not
available and the generated repository records the exact advisory IDs, affected
path, mitigation, review date, and removal condition. A broad or undocumented
audit exception is forbidden, and an active high-severity waiver blocks release
promotion.

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
