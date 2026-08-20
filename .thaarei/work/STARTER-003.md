---
workId: STARTER-003
title: Remediate the generated web developer handoff
origin: web-developer-handoff-remediation
status: complete
owner: primary-agent
createdAt: 2026-08-19
updatedAt: 2026-08-19
sourceOfTruthIds: []
affectedPaths:
  - .thaarei/work/STARTER-003.md
  - IMPLEMENTATION.md
  - starter-release.json
  - package.json
  - templates/tooling/check-migrations.ts
  - tooling/governance/src/boundaries.ts
  - tooling/governance/tests/governance.test.ts
  - tooling/starter-init/src/generator.ts
  - tooling/starter-init/src/initializer.test.ts
  - tooling/starter-init/src/validate-fixtures.ts
  - tooling/starter-init/src/validate-web-handoff.ts
---

# Remediate the generated web developer handoff

## Objective

Make the generated `web,api,data,identity` repository usable without starter
maintainer guidance and prove a real typed browser-to-API-to-database path.

## Scope

- Generate a concise root README and a profile-aware developer guide.
- Generate PostgreSQL 18.3 local Compose and a checksum-verified migration
  runner only when the data profile is selected.
- Add local development commands for the generated root, web app, and API app.
- Add a same-origin Next.js proxy for tRPC and Better Auth.
- Replace the placeholder first-party API client and static web page with a
  typed reference flow for health, signup, signin, and viewer.
- Strengthen the API, health schema, OpenAPI parity, and identity repository
  types at their existing owners.
- Add a dedicated `web,api,data,identity` fixture and Docker-backed acceptance
  command.
- Add the `web-developer-handoff` compatibility gate after its evidence passes.

## Non-goals

- Mobile client integration or native-device proof.
- Live Dokploy or Railway deployment, restore, rollback, or production
  readiness evidence.
- Product organization, RBAC, AI, jobs, storage, or deployment features.
- Published packages, upstream synchronization, or shared client runtime
  dependencies outside the generated private repository.

## Acceptance criteria

- [x] Generated documentation lists only selected profiles and classifies each
  selected module as `ready baseline`, `scaffold`, or `deferred integration`.
- [x] A web-only repository contains no database, identity, or Compose output.
- [x] Data-enabled output exposes non-destructive `db:up`, `db:migrate`, and
  `db:down` commands with a pinned PostgreSQL 18.3 image.
- [x] The migration runner loads root `.env`, applies numbered migrations in
  transactions, records checksums, skips unchanged files, and rejects edits.
- [x] Generated web and API development use ports 3000 and 3001.
- [x] The Next.js proxy forwards tRPC and Better Auth requests, cookies, and
  `set-cookie` through server-only `API_INTERNAL_URL`.
- [x] `createApiClient()` is parameterized by the exported `AppRouter`, uses
  credential-preserving fetch, and has no runtime server-only import.
- [x] The reference web slice proves typed health, anonymous viewer rejection,
  Better Auth signup and signin, and authenticated viewer identity.
- [x] Identity-enabled API production composition requires authentication,
  identity, and database dependencies at compile time and startup.
- [x] Health response types derive from Zod, include readiness detail, and keep
  optional OpenAPI output in parity.
- [x] Identity persistence returns Drizzle-inferred or boundary-validated rows.
- [x] Generated production web-stack code contains no explicit `any`, double
  assertions, or unvalidated response casts.
- [x] The dedicated fixture typechecks and builds all selected packages without
  duplicate frontend contracts.
- [x] PostgreSQL readiness, two migration runs, the real proxy flow, persisted
  identity rows, and generated web and API container health checks pass.
- [x] Pinned `pnpm validate:starter` and `pnpm validate:web-handoff` pass.
- [x] `starter-release.json` records the passed `web-developer-handoff` gate
  while the starter remains `prerelease` and external gates remain unclaimed.

## Interface and module sketch

Caller usage is the contract:

```ts
const api = createApiClient();
await api.health.query();
await api.viewer.query();
await authClient.signUp.email({ email, password, name });
await authClient.signIn.email({ email, password });
```

- `packages/api` exports `AppRouter` as a type and owns health and viewer wire
  schemas through `packages/contracts`.
- `packages/api-client` imports `AppRouter` only with `import type`, creates the
  tRPC proxy client against `/trpc`, and conditionally exports a Better Auth
  browser client against `/api/auth`.
- `apps/web` owns server-only proxy route handlers and the demonstrative client
  component. Browser code calls only same-origin paths.
- `apps/api` loads the root `.env` in local execution and supplies required
  composition dependencies to `buildApi`.
- `packages/database` owns migration execution, its checksum ledger, database
  schema, and identity repository parsing.

## Allowed write scope

The starter work record, release metadata, root scripts, generator and its
tests, generated templates owned by the generator, validation tooling, and the
generated implementation summary. Do not modify unrelated user work or live
infrastructure.

## Validation

- `pnpm dlx node@24.19.0 /usr/local/bin/pnpm validate:starter` passed on the
  final code. It passed release and governance checks, formatting, lint,
  strict TypeScript, 57 source tests, package audits and builds, and all eight
  generated fixtures.
- `pnpm dlx node@24.19.0 /usr/local/bin/pnpm validate:web-handoff` passed on
  the final code. It started PostgreSQL 18.3, verified readiness, applied
  migrations and a second no-op, rejected changed and deleted applied
  migrations, and typechecked and built the selected packages. Generated
  static checks and the runner both reject non-numbered SQL filenames.
- The Docker-backed gate used the built generated `createApiClient()` through
  the real web proxy, proved credential-preserving fetch, anonymous viewer
  rejection, Better Auth signup and session cookie creation, authenticated
  viewer mapping, and persisted user, account, session, and application
  identity rows. Double-encoded traversal probes proved that neither the API
  readiness path nor the authentication path can escape the `/trpc` proxy
  prefix.
- The same gate built the generated web and API images, started them with
  `NODE_ENV=production`, verified their health paths, proved `db:down`
  preserved the named volume, and removed containers, images, volumes, and
  the disposable repository.

## Evidence

- `WEB-HANDOFF-01`: PostgreSQL 18 rejected the pre-18 data-volume target and
  restarted. The generated Compose file now mounts the PostgreSQL 18 parent
  data directory and supports an isolated loopback host port.
- `WEB-HANDOFF-02`: the first generated web typecheck exposed an optional
  Better Auth error message and a tRPC fetch type mismatch. The client now
  preserves credentials through a boundary-compatible fetch function and
  handles absent provider error messages.
- `WEB-HANDOFF-03`: the generated database package imported `eq` from the
  wrong Drizzle entrypoint. It now imports `eq` from `drizzle-orm` and uses
  Drizzle-inferred identity rows.
- `WEB-HANDOFF-04`: the first web build ran before its API client dependency
  was built, and the next attempt used `NODE_ENV=development` for a production
  Next.js build. The validator now builds packages in dependency order and
  uses production mode only for builds.
- `WEB-HANDOFF-05`: Better Auth rejected a relative client base URL during
  prerender. The generated browser client now uses the same-origin
  `/api/auth` base path.
- `WEB-HANDOFF-06`: the first signup reached Better Auth through the proxy but
  failed origin validation. `BETTER_AUTH_URL` now names the browser-visible
  origin, `API_INTERNAL_URL` names the server-only API target, and the
  acceptance request includes the browser origin.
- `WEB-HANDOFF-07`: independent review found that applied migration deletion
  was not rejected. The ledger now fails when an applied file is missing, and
  the Docker gate proves both checksum mutation and deletion failures.
- `WEB-HANDOFF-08`: independent review found profile-inaccurate documentation
  and an external-API web reference-flow conflict. Documentation is now
  conditional across every selected profile, and external API output no
  longer imports the first-party tRPC reference flow.
- `WEB-HANDOFF-09`: generated client behavior is exercised at runtime, the
  OpenAPI health schemas are compared exactly, all fixture roots are removed
  in `finally`, and container health uses production runtime mode.
- `WEB-HANDOFF-10`: final security review found that decoded catch-all segments
  could be normalized outside their proxy prefix. Each segment is now encoded
  before URL construction, with live double-encoded traversal regression
  checks for API health and authentication siblings.
- `WEB-HANDOFF-11`: one validation rerun encountered an unrelated local port
  collision. The Docker gate now allocates free host ports instead of deriving
  them from its process ID; both pinned commands passed after this correction.

## Decisions

- Accept only the `web,api,data,identity` profile set for this handoff gate.
- Keep `API_INTERNAL_URL` server-only. Browser code uses same-origin paths.
- Preserve the local PostgreSQL volume on `db:down`.
- Keep the starter at `prerelease` after this gate passes.

## Blockers

No blockers remain for the web developer handoff. Live Dokploy and Railway
deployment, restore, rollback, and native mobile gates remain external and
unclaimed.

## Handoff

The generated `web,api,data,identity` repository is ready for web developer
handoff. The starter remains `prerelease`; this record does not claim live
deployment operations or mobile acceptance.

## Completion

Complete. Both required pinned Node 24.19.0 validation commands passed on the
final implementation, and `web-developer-handoff` is recorded as passed.
