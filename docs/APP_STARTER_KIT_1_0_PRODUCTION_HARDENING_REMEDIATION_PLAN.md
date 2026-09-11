# Thaarei App Starter Kit 1.0 — Production Hardening Remediation Plan

> Historical plan. STARTER-022 and the current engineering contract supersede
> its workflow and company-default decisions.

- **Status:** Local implementation complete; external qualification pending
- **Plan date:** 2026-09-06
- **Implementation baseline:** `main`, merged from `codex/starter-kit-1-0-plan`
- **Canonical work record:** [STARTER-011](../.thaarei/work/STARTER-011.md)
- **Implementation records:** [STARTER-012](../.thaarei/work/STARTER-012.md)
  through [STARTER-018](../.thaarei/work/STARTER-018.md)
- **Remaining records:** [STARTER-019](../.thaarei/work/STARTER-019.md) and
  [STARTER-020](../.thaarei/work/STARTER-020.md)

## 1. Purpose and fixed contracts

This plan reconciles the production golden-path proposal with the implemented
Starter 1.0 baseline. It is a delta plan, not a rewrite. The existing package
split, generator, capability graph, stable application foundations, mobile
policy, and qualification model remain authoritative.

These creation entrypoints and their existing options remain unchanged:

```text
pnpm starter:init <existing options>
pnpm dlx @thaarei-technology/create-app@<exact-version> init <existing options>
```

Preset names, profile names, default output behavior, `/health/live`,
`/health/ready`, and the canonical `pnpm validate:starter` command remain stable.
Production hardening is implicit and does not introduce a selectable security or
operations profile.

## 2. Reconciled current state

### Preserve

- The three-package private publication boundary and exact-version consumption.
- Strict capability resolution, presets, deterministic recipes, atomic writes,
  semantic hashing, clean-consumer pack testing, and private generated workspaces.
- Mobile's explicit experimental opt-in, security waiver, native qualification
  block, and production prohibition.
- Stable identity, recovery, assurance, tenancy/RLS, migration roles, jobs,
  events, cache, rate-limit, and provider-boundary foundations.
- Selected-service local Compose, retained-volume safety, Node image digest pins,
  non-root Node runtimes, SBOM/provenance/attestation generation, qualification
  schemas, Dokploy-first deployment, and Railway beta classification.

### Implemented locally

- Executable Gitleaks, Semgrep CE, and Trivy gates in the starter source and
  generated repositories.
- Fast, deep, and release-candidate validation workflows.
- Central API/web security defaults and safe readiness diagnostics.
- Real OpenTelemetry trace/metric export for the selected observability profile.
- Browser, accessibility, coverage, k6 smoke, ZAP baseline, and PostgreSQL restore
  verification.
- Executable staging/promotion/rollback orchestration for Dokploy.
- Minimal repository governance, machine-validated project metadata, and concise
  security/operations/handover documentation.

### External qualification

Live Dokploy deployment, same-digest promotion, rollback, backup/restore,
monitoring receipt, package publication, and live provider behavior remain
`blocked_external` until exact evidence exists. Railway stays beta. Mobile stays
experimental and production-forbidden.

### Intentionally defer

Do not make Infisical, Grafana/Loki/Tempo/Prometheus, Uptime Kuma, a self-hosted
registry, hosted or self-hosted Renovate execution, analytics, Umami,
Dependency-Track, GlitchTip, Harbor, OpenBao, Kubernetes, Terraform, Backstage,
or native mobile qualification part of the Starter 1.0 repository deliverable.
The starter emits integration seams only.

## 3. Security toolchain and CI

Add immutable catalog entries for Gitleaks, Semgrep CE, Trivy, ZAP, and k6. Pin
versioned images by digest and record scanner versions plus vulnerability-database
timestamps in release evidence.

Generated and source repositories expose:

```text
pnpm security:secrets
pnpm security:secrets:full
pnpm security:sast
pnpm security:fs
pnpm security:config
pnpm security:image -- <image-ref>
pnpm security:sbom -- <image-ref>
```

- Gitleaks uses its CLI/container, redacted reports, default rules plus reviewed
  local configuration, changed-worktree/commit scanning on pull requests, and a
  full-history manual/nightly scan.
- Semgrep CE uses a checked-in, reviewed local rule pack and produces JSON/SARIF
  without a hosted account or mutable remote rules.
- Trivy owns filesystem dependency/license, configuration, exact-image, and SBOM
  scanning. Gitleaks remains the secret scanner to avoid duplicate findings.
- Critical and high findings block stable promotion. A high waiver is accepted
  only when subject-specific, time-bounded, fully mitigated, and production-
  blocking for the affected artifact/profile.

Extend the security-waiver schema with scanner, rule/finding ID, severity,
affected path/artifact, mitigation, owner, review/expiry, removal condition, and
evidence digest. Migrate the mobile waiver without weakening it.

Generate three workflow levels:

1. `product-validation.yml`: pull-request format, lint, types, governance,
   migration/generated drift, units/contracts, dependency audit, Gitleaks,
   Semgrep, Trivy filesystem/configuration, build, and one web smoke where valid.
2. `deep-validation.yml`: scheduled, manual, and reusable full fixtures, coverage,
   Playwright/accessibility, image scans, SBOM, ZAP, k6, restore, and waiver expiry.
3. `release-candidate.yml`: invoke deep validation for the exact commit, build
   each image once, scan, attest, verify, and emit immutable release evidence.

Third-party Actions remain pinned to full commit SHAs. Pull requests receive no
registry, deployment, backup, package-publication, or production credentials.

## 4. Runtime security, reliability, and telemetry

Centralize Fastify and web security behavior:

- explicit trusted-proxy and forwarded-header policy;
- exact origin/CORS validation and cookie-authenticated CSRF/origin enforcement;
- CSP, HSTS in real HTTPS production, content-type, frame, referrer, and
  permissions headers;
- request body, header, connection, request, and response-size limits;
- safe errors and readiness codes without raw dependency exceptions;
- production stack suppression, request/correlation identifiers, and graceful
  HTTP/worker shutdown.

Standardize Pino serializers and redaction. Never log authorization, cookies,
credentials, raw bodies, unrestricted URLs, AI prompts, document contents, or
other sensitive payloads.

Add one generated adapter-owned outbound HTTP policy with abortable timeouts,
bounded response sizes, bounded retries with exponential jitter, safe-method and
idempotency rules, correlation headers, a stable user agent, redacted logs,
metrics, and spans. Provider SDKs remain in adapters and domain code remains
transport-independent.

When `observability` is selected, compose the smallest tested ESM-compatible
OpenTelemetry SDK/exporter set. Instrument API, worker, database readiness,
outbound requests, and selected domain boundaries. Pino remains the log owner.
Exporter failure must not corrupt business readiness. The local collector fixture
must receive correlated trace and metric evidence.

Keep current digest-pinned multi-stage non-root Node images and add OCI labels,
runtime health checks, graceful signals, and deployment-level read-only root,
dropped capabilities, `no-new-privileges`, and bounded resources. Convert the
experimental Python image to a multi-stage non-root image without changing its
maturity.

## 5. Browser, security, performance, and recovery tests

- Generate Playwright only with `web`: public health/navigation smoke plus
  conditional identity and tenancy journeys.
- Generate `@axe-core/playwright` checks for representative public and
  authenticated pages. Do not claim WCAG certification from automation.
- Add `test:coverage` with 70% line/function and 60% branch thresholds, excluding
  generated clients, migrations, and process-only bootstrap files. Security
  owners require direct tests regardless of aggregate percentage.
- Generate a pinned k6 API smoke suite with five virtual users for 30 seconds,
  functional checks passing, and request failures below 1%. Do not impose a
  generic latency SLO; products own latency and capacity targets.
- Generate a pinned ZAP Automation Framework passive scan for disposable deep
  validation. Active scanning requires an explicit manual disposable target and
  is never aimed at production by default.
- Add `recovery:verify` for data projects. It uses the pinned PostgreSQL image to
  back up a synthetic database, restore into a fresh database, verify migration
  digests and a marker, run readiness/smoke checks, clean up, and emit evidence.
- Object-storage restore remains product qualification for the experimental
  storage profile.

## 6. Deployment, repository governance, and documentation

Make Dokploy staging, inspection, promotion, rollback, and evidence workflows
executable while retaining fail-closed server-version qualification. Build once,
deploy staging by immutable digest, run advisory-lock migrations and smoke checks,
then promote the exact verified digest. Never rebuild for production or run an
automatic down migration.

Keep GHCR and GitHub attestations as the initial defaults. Another OCI registry
may later replace GHCR through configuration without changing application or
initializer contracts.

Use GitHub environments when the organization plan can enforce them. Otherwise,
manual promotion records the actor and external approval evidence rather than
claiming enforced two-person approval.

Keep secrets as environment injection. Generate a short secrets and rotation
runbook plus an optional Infisical CLI example, but no application SDK or runtime
dependency.

Generate:

- `SECURITY.md`;
- pull-request template and bug, feature, and private-security issue forms;
- repository Renovate policy for grouped non-major updates, isolated majors,
  lockfile maintenance, Docker digests, and Action SHA updates;
- ownership/first-release checklist;
- one security/threat-model checklist;
- one operations runbook for deployment, rollback, recovery, secrets, and
  incidents;
- one ADR template and one client-handover checklist.

Do not infer `CODEOWNERS` from free-text owners or add a required initializer
flag. A real GitHub user/team remains a first-release configuration requirement.

Extend and validate `.thaarei/project.json` using only known services,
environments, capabilities, deployment target/topology, owners, and starter
version. Do not invent SLO, RPO, RTO, residency, classification, or commercial
values and do not add `project.yaml`.

## 7. Qualification and release

Add structured security, browser, telemetry, image-scan, recovery, and approval
evidence to the existing qualification model. Bump prerelease schema versions
only where strict current schemas cannot represent those facts and document the
pre-1.0 migration.

Starter 1.0 admission requires:

- pinned-runtime clean source validation and package-consumer checks;
- all generated fixtures and profile-isolation checks;
- security scans and current waiver validation;
- browser/accessibility and coverage proof;
- local collector trace/metric proof;
- exact-image scan, SBOM, provenance, and attestation verification;
- ZAP and k6 disposable proof;
- PostgreSQL restore proof;
- both Dokploy topology live deployment, migration, same-digest promotion,
  rollback, restore, and monitoring evidence.

Only then mark stable profiles/topologies qualified and publish lockstep packages
and Starter 1.0. Railway remains beta and mobile remains experimental,
security-blocked, native-unqualified, and production-forbidden.

## 8. Acceptance and implementation governance

- Existing invocations, presets, profiles, health paths, and output behavior stay
  compatible except for added hardening files and evidence fields.
- Unselected capabilities add no dependency, service, variable, test, or CI work.
- Each scanner has synthetic positive and negative tests without committing real
  or realistic credentials.
- API regression tests cover headers, CORS/CSRF/origin, proxy trust, limits, safe
  errors/readiness, redaction, cancellation, and graceful shutdown.
- Browser suites cover selected public, identity, authorization, tenancy, logout,
  and accessibility paths.
- ZAP, k6, and recovery operate only against disposable targets and emit
  machine-readable evidence.
- Runtime inspection verifies UID, contents, labels, health, read-only operation,
  capabilities, signals, and absence of source or credentials.
- Staging and production evidence proves digest equality and attestation
  verification.
- `pnpm validate:starter` remains the final local gate.

Local implementation was completed through the bounded `STARTER-012` to
`STARTER-018` records. Protected stable-release qualification continues under
`STARTER-019`, and the time-bound experimental mobile waiver review is tracked by
`STARTER-020`. Continue to regenerate `IMPLEMENTATION.md` only through
`pnpm implementation:sync`.
