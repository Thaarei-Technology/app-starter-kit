---
workId: STARTER-001
title: Implement the executable Thaarei engineering starter contract
origin: starter
status: complete
owner: primary-agent
createdAt: 2026-08-19
updatedAt: 2026-08-19
sourceOfTruthIds: []
affectedPaths:
  - AGENTS.md
  - docs/
  - tooling/
  - templates/
  - package.json
  - pnpm-workspace.yaml
  - starter-release.json
  - .github/workflows/
  - README.md
  - pnpm-lock.yaml
  - tsconfig.json
  - turbo.json
  - biome.jsonc
---

# Implement the executable Thaarei engineering starter contract

## Objective

Turn the documentation-only repository into a self-contained private GitHub template that generates a client repository with only the selected capability profiles.

## Scope

- Replace the conflicting engineering and agent contracts.
- Add the root agent contract and canonical work tracking.
- Add the one-time `starter:init` interface and profile validation.
- Add source-of-truth, boundary, implementation, and release checks.
- Add Dokploy and Railway deployment output.
- Generate and validate the approved fixture combinations plus bounded AI and
  storage profile proofs.

## Non-goals

- Deploy to a live Dokploy or Railway account.
- Provision production credentials, domains, databases, buckets, or virtual machines.
- Publish packages or synchronize generated client repositories with this starter.
- Claim native Better Auth and Expo SDK 57 compatibility without physical native build evidence.

## Prerequisites

- The approved correction plan in the 2026-08-19 user request.
- Node.js 24 LTS and pnpm 11 for the released starter baseline.

## Acceptance criteria

- [x] The architecture reference and agent contract agree on one package topology and one technology per concern.
- [x] `starter:init` rejects invalid profile combinations and requires mobile identifiers only for the mobile profile.
- [x] Generated repositories exclude unused profiles, source-only templates, and the broad engineering reference.
- [x] All generated TypeScript compiles in strict mode.
- [x] Source-of-truth and package-boundary checks fail on the approved negative cases.
- [x] The seven approved fixtures pass their applicable checks and builds.
- [x] Dokploy and Railway artifacts are generated only when their deployment target is selected.
- [x] Release evidence distinguishes local template validation from live deployment and native mobile proof.

## Work packages

- `WP-DOCS`: Rewrite `docs/engineering-starter-kit.md`, `docs/template-AGENTS.md`, and root `AGENTS.md`.
- `WP-GOV`: Implement source-of-truth checks and canonical work tracking.
- `WP-INIT`: Implement the initializer, profile payloads, generated fixtures, and deployment output.
- `WP-INTEGRATE`: Integrate package management, release pins, CI, and the validation matrix.

## Review remediation plan

The initial fixture matrix proved generation, installation, static governance,
type checking, tests, and builds. A subsequent runtime and contract review found
that those checks did not yet prove cross-capability composition or the full
behavior promised by several profiles. The following work reopens this item.

### Selected architecture

Keep the documented canonical package topology. Do not add packages named after
capabilities or introduce a generic composition package.

- `packages/core` owns domain policies, provider ports, job definitions, and AI
  execution rules.
- `packages/contracts` owns Zod wire schemas and RFC 9457 response contracts.
- `packages/database` owns Drizzle schemas, migrations, and repositories for
  application identity, workflow, object, approval, evaluation, and telemetry
  records.
- `packages/adapters` owns Better Auth, Graphile Worker, AI SDK, S3-compatible,
  and telemetry provider implementations.
- `packages/api` owns Fastify and tRPC transport composition, authenticated
  request context, REST/OpenAPI registration, error translation, liveness, and
  dependency-aware readiness.
- `apps/api` and `apps/worker` are the only process composition roots. They load
  validated configuration and explicitly construct the selected packages.

The initializer will derive a typed capability plan once from the selected
profiles. That plan will drive generated packages, application dependencies,
required environment, readiness dependencies, deployment services, fixture
tests, and release gates. Generation must fail if that plan is internally
inconsistent.

The rejected design added `packages/composition` plus separate `identity`,
`jobs`, `ai`, `external-api`, and `storage` packages. It offers explicit
lifecycle orchestration, but conflicts with the already-approved ownership
contract and would split provider and policy ownership across shallow modules.

### Confirmed defects

| ID | Finding | Required correction | Acceptance evidence |
| --- | --- | --- | --- |
| `DEF-01` | The generated external client calls `/health`; the server exposes `/v1/health`. The built client receives HTTP 404. | Define the external health path once and use it for route registration, OpenAPI, and the generated client. | A runtime client-to-server test returns HTTP 200 and the generated client drift check passes. |
| `DEF-02` | Selected data and identity packages are generated but not composed into `apps/api`; request context is always anonymous. | Move provider implementations to adapters, inject selected dependencies into `packages/api`, and compose them in `apps/api`. | An identity/data fixture proves authenticated and anonymous context behavior through the actual HTTP integration path. |
| `DEF-03` | Display names and owner values are interpolated into TypeScript, TSX, Markdown front matter, and YAML without safe serialization. A display name containing `<` produces invalid TSX. | Validate control characters and length, use syntax-specific serialization, and add adversarial initializer inputs. | Quotes, angle brackets, colons, and Unicode generate valid repositories; newlines and control characters are rejected with actionable errors. |
| `DEF-04` | `/health/ready` always returns 200 even when selected database and identity configuration is absent. | Separate liveness from readiness, parse configuration with Zod, probe required dependencies, and return 503 fail-closed. | Missing or failed selected dependencies return 503; configured local doubles return 200; liveness remains independent. |
| `DEF-05` | Active work overlap detects only identical strings, so `packages/core` and `packages/core/src` can be claimed concurrently. | Normalize repository-relative paths, reject unsafe claims, and detect ancestor/descendant overlap. | Exact, parent-child, traversal, and absolute-path negative tests pass. |
| `DEF-06` | Generated `AGENTS.md` tells client repositories to run the source-only `pnpm validate:starter` command. | List only commands emitted into generated repositories and include the unified release gate. | The generated instruction template names `pnpm release:check` and `pnpm check`; fixture checks prove both commands exist. |

### Standards gaps

| ID | Missed standard | Required correction | Acceptance evidence |
| --- | --- | --- | --- |
| `STD-01` | Better Auth and other provider SDKs are placed in capability packages instead of `packages/adapters`. | Enforce provider SDK placement for Better Auth, Graphile Worker, AI SDK/provider packages, and S3 SDKs. | Generated manifests/imports use adapters and boundary tests reject provider imports elsewhere. |
| `STD-02` | Generated process environment is read directly and required selected-profile configuration is not validated at the trust boundary. | Generate process-specific Zod configuration schemas with typed output and clear failure messages. | API and worker startup tests reject missing or invalid selected configuration. |
| `STD-03` | The external route contract and OpenAPI document are duplicated in multiple generated strings. | Generate route path, response schema, OpenAPI document, and client from one contract owner. | A parity test fails on path or response drift and passes for the generated fixture. |
| `STD-04` | The storage profile emits only a port and no provider implementation, metadata repository, or access policy. | Add an S3-compatible adapter and application-owned object metadata/access policy. | Contract tests cover authorization, metadata persistence, signed operations, and provider failure behavior. |
| `STD-05` | Existing fixture checks prove files/builds but not that selected capabilities are reachable at runtime. | Add bounded runtime smoke and negative tests to the generated fixture matrix. | Each server profile proves startup/configuration/readiness; relevant fixtures prove the selected capability path. |

### Specification gaps

| ID | Unimplemented or incomplete specification | Required correction | Acceptance evidence |
| --- | --- | --- | --- |
| `SPEC-01` | Generated `starter-release.json` does not conform to the source release schema and the generated repository has no release checker. | Emit the same schema fields and checker, add `release:check` to `pnpm check`, and verify dependency pins in generated manifests. | Every generated fixture passes the unified release checker; deliberate drift fails. |
| `SPEC-02` | The storage profile lacks the promised S3-compatible adapter, metadata, and access policy. | Implement the port in adapters and persistence/policy in the canonical owners. | Storage fixture contract and failure-path tests pass without a live provider. |
| `SPEC-03` | The AI profile declares metadata only; it lacks a logical model registry, persisted approvals/evaluations/telemetry, audit integration, and runtime enforcement of authorization, approval, risk, and cost. | Implement typed registries and a policy-enforcing tool executor, persistence contracts/schema, AI SDK adapter boundary, and local deterministic tests. | Unauthorized, unapproved, over-budget, invalid-input, invalid-output, and provider-failure cases fail closed; authorized execution records evidence. |
| `SPEC-04` | The jobs profile runs a no-op health task and lacks durable workflow state and idempotency. | Add a Zod payload contract, Graphile Worker adapter, workflow repository/schema, idempotent transition handler, and retry-safe errors. | Duplicate request IDs do not repeat effects; invalid payloads fail; workflow transitions persist in tests. |
| `SPEC-05` | RFC 9457 exists only as a TypeScript interface and is not used by external HTTP errors. | Add a scoped Fastify error translator and content type for external routes. | External 4xx/5xx tests assert RFC 9457 fields and `application/problem+json`. |

### Second-pass findings

The independent closing review and the first full-matrix rerun found the
following additional defects. These remain part of this work item rather than
being deferred to a later milestone.

| ID | Finding | Required correction | Acceptance evidence |
| --- | --- | --- | --- |
| `DEF-07` | `api,ai` is accepted but dereferences an absent database, while `api,storage` silently enables data infrastructure; both expose authenticated operations without requiring identity. | Make `data` and `identity` explicit prerequisites for AI and storage because both persist subject-owned evidence/metadata. | Invalid combinations fail validation; explicit identity-backed AI and storage fixtures pass. |
| `DEF-08` | AI composition creates empty registries, approval IDs can collide, and several denial/provider failures emit no audit or telemetry evidence. | Register a deterministic executable model/tool path, identify approvals by separate tool and subject columns, and record every terminal outcome. | Application-level tests cover success, collision safety, approval, budget, schema, and provider failure evidence. |
| `VERIFY-01` | Review questioned the required Better Auth account `issuer` field. Inspection of pinned Better Auth 1.7.1 shows `issuer` is a required standard account field and part of the unique account identity. | Retain `issuer`, add the matching composite unique index, and keep application identity as a separate mapping. | The Drizzle schema and migration agree with the pinned provider contract; generated identity type-check/build passes. |
| `DEF-10` | Storage writes can overwrite another subject's key and transfer metadata ownership. | Reject writes when existing metadata belongs to another subject before sending to the provider. | A cross-subject overwrite test proves no provider call or metadata update occurs. |
| `DEF-11` | A process crash can leave a workflow claim permanently `running`, causing all retries to be treated as duplicates. | Add an expiring claim lease and atomic stale-claim takeover policy. | Persistent SQL shape and deterministic lease tests cover active duplicate, expired recovery, completion, and caught failure. |
| `DEF-12` | The generated release checker validates dependency drift but not all source-schema invariants. | Add schema-equivalent checks for image digests, timestamps, compatibility/evidence non-emptiness, release gates, and unknown properties. | Focused negative mutations fail for every omitted invariant. |
| `DEF-13` | External readiness omits storage, and the health proof invokes Fastify directly instead of the generated client. | Reuse the selected readiness set and one generator-owned external path; execute the generated client against the live test server. | Storage failure makes both readiness routes 503 and the generated client receives 200 from the registered route. |
| `DEF-14` | A newly disclosed high-severity `js-yaml` advisory enters through the generated OpenAPI client toolchain. | Upgrade or override to a compatible patched transitive version and record the exact tested pin. | The external fixture passes `pnpm audit --prod --audit-level high` without a new waiver. |
| `STD-06` | The API profile installs OpenTelemetry without importing or configuring it. | Remove the unused production dependency until an observable API instrumentation owner is implemented. | API manifests and release pins contain no unowned OpenTelemetry package. |
| `DEF-15` | Workflow leases identify only the idempotency key, so an expired worker can complete or delete the replacement worker's active claim. | Give every lease a unique ownership token and require token equality for completion and failure transitions. | Deterministic stale-completion and stale-failure tests prove an old worker cannot mutate a replacement claim. |
| `DEF-16` | The authenticated AI procedure accepts a caller-supplied cost budget, allowing the caller to weaken application policy. | Remove budget from the public contract and derive a validated maximum from server-owned configuration. | The generated API rejects a caller-supplied budget and the composition root always uses the configured application limit. |

### Work sequence

1. `WP-REVIEW-GOVERNANCE`: reopen this record; fix nested work ownership,
   provider boundary enforcement, and unified release checking.
2. `WP-REVIEW-PLAN`: add the typed initializer capability plan, safe input
   serialization, and canonical profile-to-package mapping.
3. `WP-REVIEW-API`: implement the API, data, identity, configuration, request
   context, liveness, readiness, and RFC 9457 vertical slice.
4. `WP-REVIEW-JOBS`: implement validated, idempotent, persistent worker flow.
5. `WP-REVIEW-STORAGE`: implement storage policy, metadata, and provider adapter.
6. `WP-REVIEW-AI`: implement model/tool registries and fail-closed execution
   policy with persistence and telemetry boundaries.
7. `WP-REVIEW-PROOF`: add runtime fixture tests, run the pinned full matrix,
   inspect generated repositories, and reconcile documentation and release
   evidence.

### Remediation acceptance criteria

- [x] Every confirmed defect has a focused regression or generated-fixture proof.
- [x] Generated packages follow the canonical topology and provider SDK boundaries.
- [x] Unselected profiles add no packages, dependencies, environment variables, services, tests, or release claims.
- [x] API and worker configuration is parsed with Zod and readiness fails closed.
- [x] Identity, jobs, AI, external API, and storage profiles have executable behavior through their generated composition roots.
- [x] Generated release manifests pass the same release contract as this source repository.
- [x] The pinned full fixture matrix and targeted runtime proofs pass.
- [x] External deployment, database integration, restore, rollback, physical native, security-waiver, and container-build gates remain explicitly unproven until their separate evidence exists.

## Validation

- Source release consistency, source-of-truth governance, boundaries, canonical
  work tracking, formatting, lint, strict TypeScript, and 49 tests passed under
  Node 24.19.0 and pnpm 11.22.0.
- One uninterrupted `pnpm check:fixtures` run passed web-only, internal-tool,
  web/mobile/identity, durable agentic workflow, external REST, optional
  Python, and storage repositories.
- Every fixture passed frozen installation, production audit, generated release
  validation, applicable migration/client/Python checks, package type checking,
  builds, and tests. The mobile fixture also passed `expo install --check` and
  deterministic iOS and Android exports.
- A standalone identity-backed AI fixture passed its complete `pnpm check`
  across eight packages and 22 tests. A standalone external fixture reported no
  known production vulnerabilities and passed nine-package validation plus 19
  tests. A standalone Python fixture passed seven-package validation plus 17
  tests.
- The fresh all-capability repository passed 13-package type checking/build,
  both native exports, and 24 tests after the implementation dashboard parser
  correction.

## Evidence

- Initial repository inspection: only two documentation files existed outside `.git`.
- Initial Git state: no commits on `main`; one staged documentation file and one untracked documentation file.
- The final fixture matrix generated all seven approved repositories in fresh
  temporary directories and completed without a failure.
- A separate API-and-Python fixture proved the caller dependency, Python syntax gate, pinned container artifact, health endpoint, and Dokploy/Railway service mapping.
- Negative governance tests cover duplicate source IDs, stale `HOW` symbols, overlapping ownership, trivial annotations, forbidden imports, direct database access, unauthorized tRPC procedures, invalid job payloads, and AI tools without authorization or risk metadata.
- `starter-release.json` records exact tested package versions, approved majors, immutable container image digests, and the remaining release gates.
- Generated release mutation proofs reject dependency drift, unknown fields,
  invalid image digests, empty evidence, invalid release timestamps, and blocked
  release promotion.
- Runtime tests prove anonymous 401 and authenticated 200 context, dependency
  readiness 503, RFC 9457 external 503, generated-client-to-live-server 200,
  AI tool execution/evidence, rejection of caller-controlled AI budgets,
  token-owned workflow lease takeover, stale-worker isolation, and storage
  ownership denial before provider access.
- The external client override pins `js-yaml` 4.3.1; the external production
  audit reports no known vulnerabilities.
- The mobile security scan found two high-severity `image-size` advisories in Expo and Metro. Because the stated patched version is not published, generated mobile repositories carry a narrow advisory-ID waiver, a build-input mitigation, a review date, and a removal condition; release promotion remains blocked.

## Decisions

- Use a mandatory base plus capability profiles.
- Use Fastify 5 and tRPC 11 for first-party APIs.
- Add REST and OpenAPI only through the `external-api` profile.
- Apply inline source-of-truth blocks only to architectural owners.
- Use Dokploy as the default VM control plane and Railway as the alternative.
- Use a release manifest plus a committed lockfile for tested versions.
- Pin the optional Python 3.12 service image by digest, keep it outside pnpm, and deploy it only with an `api` or `jobs` caller.
- Allow only exact, recorded security advisory waivers when no patched version is published; active high-severity waivers block release promotion.
- Require `data` and `identity` whenever AI or storage is selected, because both
  profiles expose subject-owned operations and persist evidence or metadata.
- Keep AI provider-neutral: the generated process composes an executable typed
  tool-policy path, while a client-specific model provider must be selected and
  registered through the AI SDK adapter rather than receiving a fabricated
  default credential.
- Keep the maximum AI tool budget application-owned and validated from
  `AI_MAX_TOOL_BUDGET_USD`; authenticated callers cannot supply or override it.
- Require a unique claim token for every workflow lease and token-match every
  completion or failure transition so expired workers cannot mutate a
  replacement claim.
- Retain Better Auth 1.7.1's required account `issuer` field and composite
  identity after verifying the pinned provider schema.
- Remove the unused OpenTelemetry dependency until an instrumentation owner is
  implemented.

## Blockers

- Live Dokploy, Railway, backup restore, rollback, and physical native build proof require external environments and remain release gates.
- The Expo and Metro `image-size` waiver remains a release gate until a compatible patched version is published and the fixture matrix passes without the waiver.
- The Python container build remains a release gate because this local runner has no Docker engine; only the pinned artifact, syntax, and generated deployment contract were verified locally.
- A disposable PostgreSQL server was not available locally. Applying the
  generated migration and exercising a real Better Auth sign-up/session plus
  crash-lease takeover against PostgreSQL remain environment-backed integration
  gates; local schema, migration, type, build, HTTP-double, and policy proofs
  passed.

## Handoff

Local review remediation is complete. Release promotion remains owned by the
technical and operations owners after the separate external gates pass.

## Completion

The starter's local generation, governance, runtime-policy, and fixture
contracts are complete. Production-ready status remains withheld until every
blocked compatibility, database-integration, and operational gate passes.

## Follow-up validation

- Changed `tsconfig.json` to include `templates/**/*.ts`, allowing template tooling to use the configured Node typings.
- `pnpm typecheck` passed.
- File diagnostics for `templates/tooling/check-migrations.ts` report no errors.
