# Agent instructions for generated repositories

The initializer installs this file as the root `AGENTS.md` in each private,
self-contained client repository. Keep the generated file short. Reach for the
active work item and the owning source file when a task needs more context.

## Start every task

1. Read the root `AGENTS.md` and the active `.thaarei/work/<work-id>.md` file.
2. Run `git status --short` and preserve unrelated user changes.
3. Search for the owner before reading broad directories. Use `rg -l '<keyword>'` or `grep -Rl '<keyword>'`.
4. Read the candidate owner, its tests, its callers, and its dependency boundaries.
5. Confirm the change belongs to the selected capability profiles.
6. Extend the existing owner when one exists. Record a new owner or dependency decision in the active work item first.

The task is ready for implementation when the owner, tests, callers, profile
selection, and allowed write scope are known.

## Preserve the architecture

- Keep strict TypeScript and validate external input with Zod.
- Keep domain rules in `packages/core` and persistence in `packages/database`.
- Keep `drizzle-orm`, `pg`, and `postgres` imports in `packages/database`.
- Keep provider SDKs in `packages/adapters`.
- Keep `packages/api` as a thin Fastify 5 and tRPC 11 transport adapter.
- Keep clients on `packages/api-client` or an explicit API boundary. Client code does not import server-only packages.
- Use Better Auth for authentication artifacts. Keep authorization in application code.
- Use Graphile Worker for idempotent tasks and PostgreSQL-backed workflow state. Enqueue jobs through the public SQL API inside the business transaction.
- Add REST and OpenAPI only through the `external-api` profile.
- Keep AI tools typed, authorized, risk-classified, observable, auditable, and budgeted.
- Add only the profiles and infrastructure that the product needs.

V2 profile names are `web`, `mobile`, `api`, `data`, `identity`, `tenancy`,
`jobs`, `events`, `ai`, `agentic-ai`, `external-api`, `storage`, `python`,
`payments`, `notifications`, `cache`, `rate-limit`, `search`, `rag`,
`observability`, and `feature-flags`. `durable-ai` was removed in Starter 1.0;
use `agentic-ai`.
Provider selections (Stripe/Razorpay, OpenAI/Anthropic, identity mail, general
notifications, Valkey, and OTLP/Sentry) must be reflected in generated
dependencies, environment schemas, adapters, readiness checks, and tests.
Local fixtures do not prove paid-provider, live deployment, restore/rollback,
or native mobile runtime behavior.

## Inline ownership metadata

Add a source-of-truth block only to an architectural owner: a schema, domain
service, tRPC router group, repository, adapter, policy, job definition, AI
tool, or reusable UI boundary. Do not annotate trivial helpers.

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

Keep the block accurate when the owner changes. The block records ownership and
rationale. Code, types, tests, and database constraints remain behavioral
truth.

## Work tracking

Create or update one canonical `.thaarei/work/<work-id>.md` file for every
active task. Record the plan, changed paths, validation commands, results,
blockers, and unresolved decisions there. Generate the bounded root
`IMPLEMENTATION.md` with `pnpm implementation:sync`; never edit it by hand.

## Required validation

Run the smallest relevant checks first. Before handoff, run the applicable
commands below and record each result in the active work item:

```text
pnpm check:source-of-truth
pnpm check:boundaries
pnpm check:implementation
pnpm release:check
pnpm check
```

Run `pnpm implementation:sync` when the work item or implementation status
changes. Run the profile-specific typecheck, tests, build, migration check, and
security scan when the selected profiles provide them.

Treat a failed check as feedback. Fix the owner or update the active work item
with the reason and a blocker. Do not claim production readiness from a local
build, a health check, or a successful login. Deployment, restore, rollback,
and native mobile claims require their own evidence.

## Change boundaries

Keep generated files under their generator. Keep secrets out of source,
configuration, logs, and work evidence. Keep new dependencies and provider
exceptions in the active work item with their owner, reason, and validation.
Do not publish packages or create an upstream synchronization path. Each client
repository remains an independent private repository.
