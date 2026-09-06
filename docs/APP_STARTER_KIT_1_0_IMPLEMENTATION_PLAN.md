# Thaarei App Starter Kit 1.0 — Company-Wide Foundation Plan

**Status:** Approved implementation baseline with final remediation decisions  
**Plan date:** 2026-09-05  
**Implementation repository:** `Thaarei-Technology/app-starter-kit`  
**Fleet source reviewed:** Fleet Compliance Version 2 product and technical plan  
**Audited starter baseline:** commit `49235c101ab20b005771d90594b0e45f489ae454`, prerelease `0.2.0-dev.1`

## 1. Purpose and execution boundary

Turn this repository into the company-wide App Starter Kit 1.0 used to create
new Thaarei applications with a production-capable local, CI, staging, and
production foundation.

All implementation for this plan belongs in the App Starter Kit repository.
The Fleet Compliance repository is reference material only and must not be
modified while implementing the starter. Once the applicable starter gates pass,
Fleet V2 will generate a new independent repository from the released starter.

The starter must remain product-neutral. It may own reusable application and
operational mechanisms, but it must not decide a product's domain model, legal
policy, commercial policy, provider entitlement, notification timing, capacity,
or service-level objectives.

## 2. Current-state assessment

The audited starter is a useful prerelease foundation. Its source validation ran
75 tests successfully, and a representative Fleet-style generated repository
passed 13 tests, typecheck, and build. Those results prove local generator and
static behavior, not production readiness.

The following findings block a company-wide stable release:

1. The generator globally replaces words such as `starter` and `thaarei` in
   generated content. This can corrupt package scopes, identifiers, scripts, and
   unrelated text. A tested example transformed `@thaarei-fleet` into
   `@fleet_v2-fleet`.
2. Generated CI can call a nonexistent `validate:<product-id>` command while the
   generated package exposes `validate:product`.
3. The declared capability graph and actual validation disagree, including the
   `web` to `api` relationship. Generation also uses non-strict capability
   resolution to retain prerelease behavior.
4. Several visible profiles are contracts or placeholders rather than runnable,
   production-qualified capabilities. The release catalog does not express that
   maturity accurately enough for consumers.
5. The current Railway and Dokploy directories are descriptive service manifests,
   not deployable infrastructure or automated promotion paths.
6. Railway output does not use the supported project-level
   `.railway/railway.ts` Infrastructure-as-Code model. Legacy Config as Code is
   unavailable to new services and stops being read on 2026-12-01.
7. Local Compose has no clear `core` and `full` lifecycle, and it does not model
   selected application services, optional dependencies, or production topology.
8. Runtime configuration relies primarily on `NODE_ENV`; it lacks trusted
   application environment, deployment profile, capability-state, resource-
   identity, and production-admission checks.
9. Generated Dockerfiles are single-stage, run as root, copy the complete source,
   and retain package managers, source, tests, and build dependencies at runtime.
10. API readiness can disclose raw dependency error details. Logging, request
    limits, proxy trust, forwarded headers, security headers, CSRF/origin checks,
    graceful drain, and safe error mapping are incomplete.
11. The web proxy forwards too much untrusted inbound state and does not own a
    strict header or trace-context policy.
12. Identity is a minimal email/password integration rather than a complete
    secure account system.
13. The tenancy profile does not create enforceable runtime/migration database
    roles, can encounter a membership/RLS bootstrap problem, and risks testing
    through a superuser that bypasses RLS.
14. Tenant authorization is not consistently composed into application
    operations. Generic owner/admin naming currently risks implying blanket
    product authority.
15. Platform/global rows and tenant rows are not cleanly separated; policies that
    allow `tenant_id IS NULL` can expose control-plane records.
16. IDs are largely unvalidated strings or UUIDv4 values rather than shared
    UUIDv7 string primitives. UTC persistence and serialization are not enforced
    as one contract.
17. Event append operations can open their own pool, so domain state, audit,
    idempotency, and outbox changes are not guaranteed to commit atomically.
18. Cache, rate limiting, notifications, payments, search, feature flags, storage,
    and observability often expose policy shapes without end-to-end runtime proof.
19. Observability lacks application instrumentation, operational dashboards,
    alerts, independent uptime checks, and cardinality/privacy enforcement.
20. CI lacks real PostgreSQL/RLS integration, hardened container checks, complete
    supply-chain evidence, same-digest staging promotion, and deployment/restore
    proof.
21. Backup and rollback documents are runbook outlines rather than executable,
    evidenced procedures.
22. The prerelease manifest can pass while important live gates are pending or
    blocked, and it lacks per-profile and per-target maturity.

## 3. Approved product boundary

### 3.1 Stable Starter 1.0 capabilities

The following capabilities must be runnable end to end locally and in CI, and
must have the production evidence described by this plan:

- Implicit base foundation.
- Web.
- API.
- Data.
- Identity.
- Optional tenancy.
- Jobs.
- Events.
- Cache.
- Rate limiting.
- Observability.
- Local development and CI foundations.
- Build, release, and promotion controls.
- Dokploy standard and Dokploy hardened deployment blueprints.

### 3.2 Visible experimental capabilities

Keep the following capabilities in the catalog, but label them `experimental`:

- Mobile.
- External/public API and generated clients.
- Object storage.
- General notification workflows.
- Payments.
- Search.
- Feature flags.
- Python services.
- AI.
- Agentic AI.
- RAG.

Experimental profiles require an explicit `--allow-experimental` selection.
Generated release metadata must say that the starter supplied scaffolding without
a production claim. A generated product must qualify the selected capability in
its own repository or remove it before production admission.

Mobile is the stricter exception for Starter 1.0: it is internal-only, requires
both explicit `mobile` selection and `--allow-experimental`, records blocked
security and unqualified native evidence, and has
`productionPolicy: "forbidden"` even when an internal build succeeds.

### 3.3 Product-owned decisions

Never place these decisions in the starter:

- Fleet, vehicle, driver, compliance, permit, document, or ULIP models and rules.
- Product role names or permission vocabulary.
- Billing plans, prices, taxes, quotas, or entitlement semantics.
- Notification content, timing, escalation, or communication preference rules.
- Upload formats, maximum sizes, scanning rules, legal holds, or retention periods.
- Country/region residency requirements and allowed subprocessors.
- Product-specific provider credentials, contracts, quotas, and admission evidence.
- Product SLOs, SLAs, RPOs, RTOs, capacity sizes, budgets, and topology thresholds.
- Product analytics events, experiments, funnels, and business dashboards.
- Customer onboarding, imports, approvals, support, or privacy workflows.

Provider-neutral ports and selectable provider adapters are starter concerns.
Selecting and legally/operationally qualifying a provider remains a product
decision.

## 4. Distribution and repository model

Publish three private packages under the GitHub Packages scope
`@thaarei-technology`:

- `@thaarei-technology/create-app`: versioned generator and validator.
- `@thaarei-technology/foundation`: deliberately small runtime primitives.
- `@thaarei-technology/tooling`: build, test, governance, and release tooling.

These are the only publishable packages in the starter workspace. Keep the root
workspace private; give each publishable package explicit files/exports/bin and
`publishConfig` allowlists, publish only to `https://npm.pkg.github.com` from the
protected workflow, use lockstep SemVer, publish prereleases to `next`, and pin
exact package versions in generated repositories. Generated product workspace
packages remain non-publishable.

Engineers create an application with an exact generator version:

```text
pnpm dlx @thaarei-technology/create-app@<exact-version> init
```

The command generates a clean local directory and initializes Git. It creates a
remote repository only when the caller explicitly supplies
`--github-repo <organization/name> --private`.

Every application remains an independent repository. There is no hidden template
synchronization or automatic source overwrite. Shared package updates arrive as
ordinary dependency pull requests and are reviewed and tested by the product.

### 4.1 Shared package boundary

`@thaarei-technology/foundation` may own only stable low-level primitives:

- Runtime configuration loading and redacted diagnostics.
- UUIDv7 generation and validation.
- UTC instant parsing and serialization.
- Request, correlation, and trusted trace context.
- Stable safe error codes and mappings.
- Structured logging redaction primitives.
- Versioned secret-envelope primitives and authenticated context.

`@thaarei-technology/tooling` owns:

- TypeScript, Biome, Vitest, and Playwright presets.
- Repository boundary and generated-file checks.
- Release/evidence schema validation.
- CI helpers that do not need application runtime authority.

Authentication, authorization, tenancy, database schemas, repositories, jobs,
events, and provider implementations are generated into the product repository.
They must not become centrally changing runtime packages.

## 5. Generator contract

### 5.1 Presets

Provide three maintained presets:

| Preset | Resolved stable profiles |
| --- | --- |
| `web-app` | base, web, api, data, identity, jobs, events, cache, rate-limit, observability |
| `multi-tenant-web-app` | `web-app` plus tenancy |
| `api-service` | base, api, data, identity, jobs, events, cache, rate-limit, observability |

Allow explicit additions and removals. Resolve dependencies automatically and
reject removing a dependency required by a remaining profile.

The stable dependency graph is:

- `web` requires `api`.
- `identity` requires `api` and `data`.
- `tenancy` requires `identity`, `api`, and `data`.
- `jobs` requires `data`.
- `events` requires `data` and `jobs`.
- `rate-limit` requires `api` and `cache`.
- `observability` and `cache` have no application-profile dependency.

Remove the deprecated `durable-ai` alias and non-strict prerelease resolution.

### 5.2 Reproducible recipe

Generate `.thaarei/starter.json` with a JSON Schema and these fields:

- Schema version and exact generator version.
- Application ID, display name, package scope, and owners.
- Selected preset and explicit profile overrides.
- Fully resolved profiles and their source maturity.
- Deployment target and topology blueprint.
- Enabled environments.
- Selected provider adapters.
- Generated tree hash and UTC generation time.

The recipe must never contain credentials or environment values.

### 5.3 Safe generation

- Replace global substitutions with typed templates and syntax-aware serializers.
- Never transform a validated user value after input normalization.
- Validate slugs, npm scopes, repository names, bundle identifiers, paths, and
  free text independently.
- Reject path traversal, duplicate output paths, control characters, dependency
  conflicts, and unsupported combinations.
- Provide interactive prompts and equivalent non-interactive flags.
- Provide deterministic dry-run output with resolved profiles, files, services,
  providers, maturity, and release gates.
- Generate only selected applications, packages, environment declarations,
  services, tests, and CI jobs.
- Test names containing `starter`, `thaarei`, punctuation, Unicode, quotes, and
  shell metacharacters.
- Ensure every generated workflow command exists in the generated root manifest.

### 5.4 Compatibility reset

Starter 1.0 is a clean breaking reset from `0.2.0-dev.1`. Publish a migration
guide mapping old flags, profiles, manifests, and deployment files to 1.0. Do not
silently modify repositories previously generated from the prerelease.

## 6. Generated application foundation

Generate a strict pnpm/Turbo TypeScript monorepo containing only the selected
applications and packages.

The base foundation must provide:

- One exact dependency catalog and committed frozen lockfile.
- Exact supported Node and pnpm declarations.
- Approved registries and a dependency lifecycle-script allowlist.
- Strict TypeScript, Zod trust-boundary validation, package boundaries, and
  source-of-truth/governance checks.
- UUIDv7 strings for application identifiers.
- PostgreSQL `timestamptz` and UTC API serialization.
- Typed and immutable runtime configuration.
- Generated `.env.example` with empty values and descriptions.
- An ignored local initializer that creates random development-only secrets.
- No generated production secret, default credential, or editable credential UI.
- Multi-stage production images with minimal runtime contents.
- Neutral ADR, threat-model, migration, incident, backup/restore, secret-rotation,
  deployment, and upgrade templates.

Do not treat the versions in the current prerelease as permanent 1.0 promises.
Pin exact dependencies and image digests only after the implementation-time
compatibility and security matrix passes.

## 7. Environment contract

Expose these trusted values:

```text
APP_ENV = local | ci | preview | staging | production | recovery
DEPLOYMENT_PROFILE = core | full | release | production | recovery
DEPLOYMENT_TARGET = dokploy | railway
capability state = disabled | emulated | test | live
```

Allow only these combinations:

| Environment | Allowed deployment profiles |
| --- | --- |
| Local | `core`, `full` |
| CI | `core`, `full` |
| Preview, when selected | `core` |
| Staging | `core`, `release` |
| Production | `production` |
| Recovery exercise, when selected | `recovery` |

Unknown combinations fail startup. Production also validates release identity,
database role and database identity, cookie/origin posture, provider mode,
resource namespaces, telemetry configuration, and non-default secrets.

Production rejects mocks, test providers, generated keys, insecure cookies,
wildcard or reflected credentialed CORS, debug/reload modes, and unqualified live
capabilities. No environment may infer identity from a hostname or silently fall
back to another environment's resource.

Local, CI, staging, and production are mandatory. Preview and recovery are
optional. Fleet selects recovery.

## 8. Stable capability implementation

### 8.1 Web

Generate a neutral Next.js App Router application using the current Tailwind and
Base UI direction:

- Responsive navigation and accessible layout primitives.
- Design tokens, theme hooks, and no product/company marketing skin.
- Loading, empty, error, not-found, offline, and authenticated/anonymous states.
- Identity screens when identity is selected.
- Keyboard, focus, reflow, reduced-motion, and screen-reader support.
- CSP, secure cookies, exact allowed origins, and `no-store` authenticated pages.
- Immutable caching only for content-hashed public static assets.
- A strict web-to-API header allowlist that strips hop-by-hop, spoofed forwarding,
  and untrusted trace headers.

### 8.2 API

Generate Fastify, tRPC, and Zod with:

- Central request context and validated actor/optional tenant context.
- Request and trusted trace IDs.
- Default-deny server-side authorization hooks.
- Request size, content type, time, concurrency, and cancellation limits.
- Exact CORS/origin and trusted-proxy policy.
- Safe error codes and correlation IDs without raw dependency details.
- Logging that excludes bodies, cookies, authorization, raw query strings,
  credentials, authentication-provider bodies, and restricted identifiers.
- Graceful HTTP shutdown and connection draining.

Provide private health contracts:

- `/livez`: process health only.
- `/readyz`: environment, schema, and local critical dependency readiness.
- `/version`: safe release identity only.
- `/capabilities`: authenticated capability state and safe failure reasons.

External provider loss changes capability status rather than killing a healthy API.
Public REST/OpenAPI remains part of the experimental `external-api` profile; tRPC
is the stable first-party application API.

### 8.3 Data and authorization

Generate PostgreSQL/Drizzle with separate owner, migrator, and runtime identities.
Runtime roles must not own tables, be superusers, or have `BYPASSRLS`.

Generate a transaction-scoped unit of work. A business mutation, audit event,
idempotency record, and outbox event must use the same transaction handle and
commit or roll back together. These components must not silently open their own
connection pools.

Authorization remains application-owned and default-deny. The starter supplies
the enforcement mechanism, not product roles or actions. Every API command, query,
field, background task, and operational action must be capable of enforcing its
declared permission.

### 8.4 Optional tenancy

Use neutral `tenant` terminology internally:

- `tenants`, membership episodes, scoped grants, and tenant context primitives.
- A locked-down membership resolver establishes access before transaction-local
  tenant context is set.
- Every tenant table has a non-null tenant ID, foreign key, enabled and forced RLS,
  and explicit policies.
- Platform/control-plane records use separate tables or policies; do not expose
  global rows with `tenant_id IS NULL OR current_tenant`.
- Workers establish tenant context for every tenant-scoped transaction.
- Missing, stale, ended, or wrong-tenant membership fails safely.
- RLS tests connect with the actual non-owner runtime role.
- No generic `owner` or `admin` role receives blanket product authority.

Products may label Tenant as Organization, Workspace, Account, or another domain
term without changing the underlying isolation contract. Fleet maps Tenant to
Organization.

### 8.5 Identity

Keep Better Auth integration in generated product source. The stable profile must
include:

- Verified email/password.
- Passkeys/WebAuthn.
- TOTP.
- Single-use protected recovery codes.
- Active-session listing and revocation.
- Session rotation after password, email, authenticator, recovery, and sensitive
  account changes.
- Exact origin, CSRF, cookie, and redirect controls.
- Configurable recent-assurance/step-up hooks for product-defined actions.
- Versioned application encryption for authenticator and recovery secrets.
- A generic transactional-mail port.
- Mailpit for local/CI and explicit production adapters such as ZeptoMail or
  Resend.

General user-facing notification workflows remain an experimental profile and are
separate from identity transactional mail.

### 8.6 Jobs and events

Generate Graphile Worker with:

- Typed task registration and payload validation.
- Named queues, concurrency, retry/backoff, cancellation, dead-letter handling,
  and graceful drain.
- Transactional outbox and idempotent inbox APIs.
- Fenced claims where work can outlive a process lease.
- Event ID, schema version, tenant/control-plane scope, aggregate reference, UTC
  occurrence time, and safe metadata.
- Migration-safe task naming and explicit task removal procedures.
- No unrestricted domain/provider payload dumping into events or logs.

### 8.7 Cache and rate limiting

Generate a Valkey adapter with explicit key namespace/version, bounded TTLs,
connection limits, and no authoritative business state.

The distributed rate limiter supports global, subject, tenant, IP-risk, operation,
and cost dimensions. Products provide route-specific thresholds. Identity and
recovery routes receive conservative baseline policies.

Valkey loss must not reconstruct authority from cache. Ordinary cache loss may
fall back to bounded database reads. Security-sensitive rate-limit uncertainty
uses a declared fail-safe policy.

### 8.8 Observability

Instrument web, API, and workers with OpenTelemetry and structured Pino logging:

- Environment, service, release, request, trace, task, and safe tenant-correlation
  attributes.
- Central redaction and attribute/cardinality budgets.
- Metrics for HTTP, database pools, jobs, outbox lag, rate limits, authentication,
  dependency state, and graceful shutdown.
- No raw identifiers, provider/document content, secrets, or unrestricted URLs.
- Local `full` runs an OTel collector; production requires an explicit exporter.
- Dokploy hardened mode may run independent Gatus and notification monitoring on
  the recovery host.

Railway health checks are deployment readiness probes rather than continuous
monitoring, so the Railway adapter must also declare an external monitoring path.

## 9. Local development and CI

Use Docker Compose profiles instead of one always-on dependency stack:

- `core`: selected watch-mode applications, disposable PostgreSQL, Mailpit, and
  generated development credentials.
- `full`: core plus selected Valkey and telemetry services.
- Experimental capabilities add separate opt-in profiles.

Provide:

- `pnpm dev` for the selected core stack.
- `pnpm dev:full` for all selected local capabilities.
- Health-based dependency ordering and deterministic synthetic fixtures.
- `pnpm dev:down` that stops disposable resources without deleting explicitly
  retained volumes.
- A separate confirmed cleanup command for destructive local removal.
- The same service images and adapters in CI with ephemeral data.

No production customer data, provider credential, encryption key, backup, or
certificate may enter local, preview, CI, or ordinary staging.

## 10. Container and supply-chain baseline

Every generated production image must:

- Use multi-stage builds and a digest-pinned supported base image.
- Install from the frozen lockfile with lifecycle scripts denied by default.
- Contain only the selected compiled runtime and production dependencies.
- Exclude source, tests, compilers, package manager caches, VCS data, credentials,
  and public production source maps.
- Run as a fixed non-root UID/GID.
- Support a read-only root with declared writable paths.
- Drop Linux capabilities and enable `no-new-privileges`.
- Declare health, stop signal, and graceful termination behavior.
- Be constrained by CPU, memory, PID, file descriptor, and log budgets in
  deployment definitions.

CI must attach an SPDX or CycloneDX SBOM, signed provenance, vulnerability report,
and keyless GitHub OIDC signature to every promoted digest.

Pin third-party GitHub Actions to full commit SHAs. Untrusted pull requests receive
no registry, package publication, staging, deployment, backup, or production
credentials.

## 11. Deployment adapters

Every generated repository contains exactly one selected deployment adapter. The
starter source continuously validates both targets.

### 11.1 Dokploy standard

Use one Dokploy server with separate application and stateful dependency Compose
projects. Updating an application must not recreate or remount PostgreSQL, Valkey,
backup, or monitoring services.

Generate:

- Immutable GHCR digest references.
- Private networks and explicit cross-project connections.
- Traefik labels only for intended public services.
- Health checks, resource limits, restart rules, log limits, and persistent-volume
  inventories.
- Staging and production as separate projects, domains, credentials, databases,
  networks, and volumes.
- Idempotent plan/apply/deploy/inspect/rollback scripts using the official Dokploy
  API/SDK.

Dokploy must pull application images; it must not build application source in
staging or production.

### 11.2 Dokploy hardened

Provide extensible independently deployable projects:

- `platform-app`.
- `platform-data`.
- `platform-security` when selected capabilities require it.
- `platform-observability`.
- Optional separately administered recovery/monitoring host definitions.

The blueprint owns isolation and extension points, not Fleet-specific service
choices. Fleet selects this blueprint and enables the recovery environment.

Generate PostgreSQL backup/restore mechanisms and recovery evidence schemas, but
require the product to declare retention, RPO, RTO, destination, encryption,
custody, and residency. The starter makes no universal HA, zero-downtime, regional,
capacity, or recovery-time claim.

### 11.3 Railway managed

Generate supported project-level `.railway/railway.ts` Infrastructure as Code:

- Isolated staging and production projects.
- Immutable GHCR image sources.
- Selected web, API, and worker services.
- Managed PostgreSQL and Valkey when selected.
- Preserved secrets, domains, health checks, pre-deploy migrations, and service
  configuration.
- `railway config plan` before a protected apply.

Do not generate legacy `railway.json`, `railway.toml`, or custom manifests that
cannot be directly applied.

Railway volume snapshots are not independent disaster recovery. A production
product must validate a separate export and restore path.

The Railway adapter ships as `beta` in Starter 1.0. It may pass static generation,
typecheck, and IaC plan gates, but it cannot claim production qualification until
the complete deployment/rollback/restore suite passes against a disposable live
Railway project.

## 12. Build, release, promotion, and rollback

Use trunk-based delivery:

1. Pull requests run formatting, lint, type, boundaries, units, real PostgreSQL/RLS,
   browser/accessibility, generated-repository, migration, secret, dependency,
   licence, container, and IaC checks applicable to the change.
2. Merge to `main` builds each selected production image once.
3. CI pushes private GHCR images by digest with SBOM, provenance, vulnerability,
   and signature evidence.
4. The exact release manifest and image digests deploy automatically to staging.
5. A one-off migration command runs under a PostgreSQL advisory lock with bounded
   statement and lock timeouts.
6. Staging verifies readiness, safe version identity, current/previous-client
   compatibility, workers, migrations, and smoke journeys.
7. A protected GitHub production environment requires approval by a person other
   than the initiating developer.
8. Production receives the same staging-tested digests without rebuilding.
9. Candidate routes are checked before traffic switches, and old web/API/worker
   processes drain gracefully.
10. Rollback restores the previous application digest against a forward-compatible
    schema. It never automatically runs a down migration.

Database changes follow expand, migrate, contract. Contraction waits until no valid
rollback/recovery application requires the old shape.

## 13. Release and qualification records

Make a release manifest—not an individual tag—the unit of promotion. Record:

- Commit and source-tree identity.
- Generator, foundation, and tooling versions.
- Selected profiles, providers, target, and topology blueprint.
- Application image names and digests.
- SBOM, provenance, signature, and vulnerability evidence.
- Schema/migration set and task-contract version.
- Configuration and client-compatibility fingerprints.
- Staging, deployment, rollback, and backup/restore evidence.
- Required approval identity and time.
- Per-profile source maturity and product qualification.

Represent source maturity separately from qualification and evidence status:

- `SourceMaturity`: `stable | beta | experimental`.
- `QualificationStatus`: `not_required | unqualified | qualified | blocked | expired`.
- `EvidenceStatus`: `passed | failed | pending | blocked_external | waived`.
- `ProductionPolicy`: `starter_qualified | requires_product_qualification | forbidden`.

Evidence identifies its subject and version, generator and recipe hashes, source
commit, environment, provider, target, topology, artifact and migration digests,
gate, result, URI, verifier, observation time, and expiry. A stable starter release
requires current passing evidence for every stable profile and Dokploy blueprint.
Railway remains beta and needs exact product-target live evidence for production.
Experimental profiles require product qualification or removal; mobile remains
production-forbidden in Starter 1.0. Disabled profiles require no evidence and
must contribute no dependency, service, variable, or CI job.

## 14. Public interfaces and types

Implement and document these stable contracts:

- `StarterRecipe`: validated generator input and resolved output recipe.
- `ProfileDefinition`: ID, maturity, dependencies, conflicts, applications, local
  services, environment requirements, provider ports, tests, and release gates.
- `AppEnvironment`, `DeploymentProfile`, `DeploymentTarget`, and `CapabilityState`.
- `RuntimeConfig`: typed, immutable, redacted configuration returned only after
  environment and resource validation.
- `RequestContext`: request ID, trusted trace context, actor, optional tenant,
  assurance level, and release identity.
- `AppError`: stable code, safe message, transport mapping, retryability, and
  correlation ID.
- `AuthorizationPort.authorize(context, action, resource)`: default-deny server
  authorization.
- `UnitOfWork.run(context, operation)`: shared mutation transaction boundary.
- `AuditWriter`, `OutboxWriter`, and `InboxDeduplicator`: transaction-bound
  persistence interfaces.
- `TaskDefinition` and `EventEnvelope`: versioned job and event contracts.
- `CachePort` and `RateLimitPort`: namespaced, bounded, non-authoritative state.
- `TransactionalMailPort`: identity delivery separate from notification workflows.
- `TelemetryPort` and the safe logger factory.
- `SecretProtector`: versioned authenticated encryption with environment-bound
  context.
- `DeploymentAdapter`: plan, apply staging, inspect, promote digest, rollback
  digest, and collect evidence.
- `ReleaseManifest` and `QualificationEvidence`: machine-validated promotion
  records.

## 15. Documentation deliverables

Update the starter documentation to include:

- Company quick start and GitHub Packages authentication.
- Preset/profile/provider catalog with maturity and dependency graph.
- Generated repository structure and ownership boundaries.
- Environment and capability-state reference.
- Local core/full development guide.
- Identity and tenancy security model.
- Jobs/events transaction and replay model.
- Docker and supply-chain baseline.
- Dokploy standard and hardened operator guides.
- Railway managed guide with beta limitations.
- CI, release, migration, promotion, rollback, backup, and restore runbooks.
- Starter 0.2 to 1.0 migration guide.
- Product qualification and experimental-profile promotion guide.

## 16. Test matrix

### 16.1 Generator

- Snapshot/property coverage for every stable profile, preset, deployment target,
  and optional environment.
- Unicode names, names containing `starter` or `thaarei`, package scopes, quotes,
  whitespace, control characters, shell metacharacters, invalid paths, and output
  collisions.
- Repeated generation produces identical tracked output apart from declared time
  fields.
- Every generated workflow command exists.
- Every generated dependency, service, variable, file, and test is owned by a
  selected profile.
- Unselected profiles leave no residue.

### 16.2 Generated repositories

For every preset and supported deployment selection, run:

- Frozen install.
- Format check and lint.
- Typecheck.
- Unit tests.
- Real PostgreSQL integration tests.
- Production web/API/worker builds.
- Production Docker image builds.
- Generated CI validation.

### 16.3 Database, tenancy, and authorization

- Migrations and grants under migrator/runtime identities.
- Forced RLS using the actual non-owner runtime role.
- Missing, wrong, stale, ended, and cross-tenant context.
- Tenant isolation in API calls, repositories, jobs, events, audit, and reports.
- Control-plane separation.
- Concurrent membership/grant changes.
- Server-side permission enforcement when the frontend control is absent or forged.

### 16.4 Identity

- Email verification and password flows.
- Passkey registration, authentication, naming, and revocation.
- TOTP enrollment, challenge, replacement, and clock-window behavior.
- Single-use recovery codes and attempted reuse.
- Active-session listing, revocation, and rotation.
- CSRF, hostile origin, redirect, cookie, and session fixation cases.
- Expired step-up assurance and revoked permissions.
- Transactional mail through Mailpit and production adapter contracts.

### 16.5 Jobs and events

- Atomic domain/audit/outbox commit and rollback.
- Crash before commit and after commit.
- Duplicate, reordered, retried, delayed, and poison deliveries.
- Inbox idempotency and outbox leases/fencing.
- Cancellation, dead-letter handling, worker restart, and graceful drain.
- Forward/backward event and task compatibility.

### 16.6 Cache, rate limiting, and observability

- Namespace isolation, TTL, invalidation, connection exhaustion, and Valkey loss.
- Concurrent and distributed rate limits and bypass attempts.
- Declared fail-safe behavior for security-sensitive routes.
- Trace/log/metric correlation and redaction.
- Attribute/cardinality bounds and prohibited-data fixtures.
- Telemetry exporter loss without corrupting business readiness.

### 16.7 Web and API security

- Header stripping and trusted proxy behavior.
- Safe error mapping and correlation IDs.
- CORS, CSP, cookies, no-store behavior, content types, request sizes, and timeouts.
- No credential, body, raw query, provider payload, or restricted identifier leakage.
- Keyboard, focus, screen reader, reflow, reduced motion, and error recovery.

### 16.8 Containers and supply chain

- Runtime images use non-root identities and declared read-only/writable paths.
- Runtime images contain no compilers, package manager caches, tests, VCS data,
  credentials, or unnecessary source.
- Dependency, licence, secret, SBOM, provenance, signature, and vulnerability gates.
- Digest pins and approved base-image/platform verification.

### 16.9 Deployment and recovery

Dokploy qualification must:

- Create disposable staging and production projects.
- Apply the same definition twice to prove idempotence.
- Pull signed GHCR digests without building source.
- Run bounded migrations and candidate health checks.
- Promote, drain, and roll back application digests.
- Prove application deployment does not recreate stateful services.
- Restore PostgreSQL from independent backup evidence.
- Exercise the hardened project boundaries and optional recovery host.

Railway validation must cover generated IaC typechecking and plan output for every
preset. Live deploy, promotion, rollback, and restore evidence is mandatory before
changing Railway from beta to stable.

Production receives only non-mutating synthetic probes. Mutation, DAST, load,
failure injection, destructive security tests, and restore exercises run only in
isolated environments.

## 17. Delivery sequence

### Phase 0 — Reconcile governance and baseline

- Record the final publication, experimental-mobile, qualification, and waiver
  contracts under `STARTER-010`.
- Refresh the generated implementation dashboard and validate the documentation
  baseline before changing runtime code.

**Exit gate:** governance and the implementation plan agree and all documentation
checks pass.

### Phase 1 — Establish package and schema boundaries

- Scaffold the three public packages and lockstep versioning.
- Implement recipe, evidence, release, and qualification schemas and governance
  allowlists.
- Pack-test each package locally without publishing.

**Exit gate:** clean temporary consumers install the local tarballs, and a fourth
publishable package is rejected.

### Phase 2 — Correct the generator

- Implement typed template rendering.
- Fix generated scripts and CI.
- Replace profile validation with one strict capability graph.
- Add maturity, presets, deterministic recipes, and clean 1.0 flags.
- Add adversarial and full generated-project matrices.

**Exit gate:** Every stable preset generates deterministically, builds, tests, and
contains no unselected capability residue.

### Phase 3 — Publish the minimal shared foundation

- Create and publish `create-app`, `foundation`, and `tooling` prereleases.
- Implement environment, ID/time, errors, correlation, redaction, and secret
  primitives.
- Add package authentication, versioning, compatibility, and upgrade procedures.

**Exit gate:** A clean environment can authenticate, generate, install from the
frozen lockfile, and build without access to starter source.

### Phase 4 — Harden the generated base

- Implement the environment contract, local profiles, neutral web/API shell,
  Docker baseline, supply-chain evidence, and release schema.
- Add safe configuration and production-admission checks.

**Exit gate:** Local core/full, CI, production builds, and runtime-image inspection
pass for all presets.

### Phase 5 — Complete stable application profiles

- Finish data/authorization, secure identity, optional tenancy, jobs/events,
  cache/rate limiting, and observability.
- Integrate the transaction, authorization, health, and evidence contracts end to
  end.

**Exit gate:** Every stable profile passes alone where valid, through all presets,
and with tenancy enabled.

### Phase 6 — Implement deployment and promotion

- Generate Dokploy standard/hardened and Railway-managed adapters.
- Add GHCR build/sign/attest, staging automation, protected promotion, migration,
  drain, rollback, backup, and restore evidence.

**Exit gate:** Both adapters pass static/IaC validation; both Dokploy blueprints
pass live disposable deployment and restore tests.

### Phase 7 — Qualify Starter 1.0

- Run clean generation, local core/full, CI, staging, production promotion,
  rollback, and recovery exercises with synthetic data.
- Complete documentation, threat review, dependency review, and release evidence.
- Publish the packages and Starter 1.0 release.

**Exit gate:** Every stable profile and Dokploy blueprint is green. Railway remains
clearly beta until separately qualified live.

### Phase 8 — Admit Fleet V2

- Generate Fleet from `multi-tenant-web-app`.
- Select Dokploy hardened and recovery.
- Pin exact Starter 1.0 and shared package versions.
- Record generated tree, recipe, and release evidence in the new Fleet repository.
- Implement Fleet-owned advanced and domain capabilities there.

**Exit gate:** Fleet work begins only after the selected stable profile matrix and
live Dokploy hardened qualification pass.

## 18. Starter 1.0 acceptance criteria

Starter 1.0 is ready only when all of the following are true:

- The generator no longer performs global product-name replacements.
- All presets and supported combinations generate valid independent repositories.
- Stable profiles are runnable end to end locally and in CI.
- Identity and tenancy security tests use production-equivalent enforcement paths.
- Domain mutation, audit, idempotency, and outbox changes are atomic.
- Runtime images and supply-chain evidence meet the declared policy.
- Merge-to-main builds once, stages automatically, and production promotes the
  identical signed digests after protected approval.
- Dokploy standard and hardened pass live deployment, rollback, and restore proof.
- Railway is either live-qualified or unmistakably labeled beta everywhere.
- Experimental profiles cannot accidentally create a stable production claim.
- Documentation distinguishes starter mechanisms from product decisions.
- A new engineer can generate, run, test, and stage an approved preset using only
  the documented company credentials and commands.

## 19. Approved defaults and assumptions

- This plan supersedes the current prerelease architecture where they conflict.
- Starter 1.0 may make breaking generator and profile changes.
- GitHub Packages uses `@thaarei-technology`; application images use private GHCR.
- New applications are independent repositories with no automatic template sync.
- Dokploy is qualified first and is Fleet's deployment target.
- Railway support ships as beta until live qualification exists.
- Generated products contain one deployment adapter.
- Local, CI, staging, and production are mandatory; preview and recovery are
  optional.
- Tenancy is optional and internally named Tenant; Fleet labels it Organization.
- Starter 1.0 stabilizes the core web platform only.
- Fleet does not select experimental starter profiles for its initial generation.
- Mailpit/emulators are local or CI adapters; production providers are explicit.
- Main builds immutable images once, staging deploys automatically, and protected
  approval promotes the same digests to production.
- India residency, exact Fleet topology contents, Garage document security,
  ZeptoMail agent separation, Razorpay/ULIP rules, legal retention, pricing,
  infrastructure budgets, SLO, RPO, and RTO values remain Fleet-owned.

## 20. Implementation governance

Do not implement this entire plan under one oversized work record. Create bounded
work items aligned to the delivery phases and keep one active item at a time.
Before modifying an architectural owner, record its paths, dependencies, tests,
allowed profile scope, decisions, and production claims in that work item.

Run the smallest relevant checks during development and the complete starter
validation before each phase handoff. Record live deployment, rollback, backup,
restore, and Railway qualification separately from local or CI evidence.

Never mark a profile, target, or blueprint stable because code exists, a build
passes, a service starts, or a health endpoint responds. Stability requires every
applicable contract, integration, security, deployment, and recovery gate in this
plan to have recorded evidence.
