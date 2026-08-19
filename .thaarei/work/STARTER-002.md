---
workId: STARTER-002
title: Validate local containers and PostgreSQL-backed starter scenarios
origin: local-environment-validation
status: complete
owner: primary-agent
createdAt: 2026-08-19
updatedAt: 2026-08-19
sourceOfTruthIds: []
affectedPaths:
  - .thaarei/work/STARTER-002.md
  - IMPLEMENTATION.md
  - starter-release.json
  - tooling/starter-init/src/generator.ts
  - tooling/starter-init/src/initializer.test.ts
---

# Validate local containers and PostgreSQL-backed starter scenarios

## Objective

Install a low-memory local Docker Engine runtime and directly exercise the
container and PostgreSQL-backed scenarios that were blocked in `STARTER-001`,
without representing local evidence as live deployment, restore, rollback, or
physical-device proof.

## Scope

- Install Homebrew Docker CLI, Compose, and an on-demand Colima Docker runtime
  outside the repository.
- Generate a disposable client repository containing API, data, identity,
  jobs, and Python profiles.
- Build and run the generated Python container.
- Apply the generated migration to disposable PostgreSQL 18.
- Exercise real Better Auth signup/session persistence and application identity
  mapping through the generated HTTP server.
- Exercise workflow lease takeover and stale-worker isolation through the real
  generated PostgreSQL repository.
- Rerun applicable audits, native exports, and starter validation, then update
  this evidence record and generated `IMPLEMENTATION.md`.

## Non-goals

- Installing Docker Desktop or accepting its separate subscription agreement.
- Modifying production or remote Dokploy/Railway resources.
- Claiming local container results as live deployment, backup restore,
  registry rollback, native development-build, simulator, or physical-device
  evidence.
- Retaining test credentials, containers, volumes, or disposable fixture data.

## Acceptance criteria

- [x] Docker reports both a reachable client and Linux server and runs
  `hello-world` under a resource-capped, on-demand Colima profile.
- [x] The generated Python image builds, starts, returns HTTP 200 from
  `/health/ready`, and is removed after the proof.
- [x] PostgreSQL 18 reaches readiness and accepts the generated migration.
- [x] Better Auth signup and session retrieval work over HTTP, with user,
  session, account, and application identity rows persisted in PostgreSQL.
- [x] Real SQL workflow tests prove expired takeover, stale completion
  isolation, and stale failure isolation.
- [x] Applicable production audit, generated repository checks, and source
  validation pass.
- [x] Named disposable containers and volumes are removed; Colima is stopped
  after validation to release its 2 GiB memory allocation.
- [x] External-only release gates remain explicit and unclaimed.

## Validation

- Installed `colima` 0.10.3, Docker CLI 29.7.2, Compose 5.5.0, and Buildx
  0.36.1 with Homebrew. Docker Engine 29.5.2 ran in the named
  `thaarei-starter` Colima profile with two CPUs, 2 GiB RAM, a 30 GiB disk,
  x86_64 architecture, and the macOS Virtualization framework. Colima has no
  Homebrew login service. `docker run --rm hello-world` passed.
- The generated Python 3.12.13 image built from the pinned digest, transferred
  a 299.5 kB build context after the `.dockerignore` correction, started with
  a loopback-only published port, and returned `{"status":"ok"}` from
  `/health/ready`.
- PostgreSQL 18.3 reached `pg_isready`; the generated migration created the
  expected 12 tables. A Better Auth signup and cookie-backed session request
  returned HTTP 200, and PostgreSQL contained matching `user`, `session`,
  `account`, and `application_users` rows.
- The generated SQL workflow repository passed real expired-lease takeover,
  stale-completion isolation, completed-run deduplication, stale-failure
  isolation, and active-owner failure release scenarios.
- A custom-format `pg_dump` with SHA-256
  `3282a5261017da4060beb1545c1713bf07c7b13d7432336b4576ad20dce7aad2`
  restored into a separate disposable database with matching identity and
  workflow row counts. This is local logical-restore evidence only.
- API and worker images built from a 209.20 kB generated context. The first
  runtime attempt exposed missing compiled workspace dependencies; after
  `RUNTIME-05`, both rebuilt images stayed running and returned HTTP 200 from
  `/health/ready`. A signup/session round trip through the built API image also
  persisted the expected four identity record types.
- `pnpm typecheck` passed and the focused initializer suite passed all 28 tests
  after `RUNTIME-06`. The shell uses Node 26.4.0 and emitted the expected engine
  warning; pinned generated validation uses Node 24.19.0.
- The first pinned full-matrix run stopped on `RUNTIME-06` in the minimal
  internal-tool fixture. After the capability-aware import correction,
  `pnpm dlx node@24.19.0 /usr/local/bin/pnpm validate:starter` passed release,
  source-of-truth, boundaries, implementation tracking, format, lint, strict
  TypeScript, all 49 source tests, and all seven generated fixtures. The mobile
  fixture passed deterministic iOS and Android exports without booting a
  simulator.
- Removed the four named test containers, the anonymous PostgreSQL volume, the
  test network, generated application images, cookie files, and disposable
  repositories. The retained Colima profile is stopped and has no login
  service, so it consumes no Docker VM RAM while idle.
- After `RUNTIME-07`, a clean Railway API/data/identity/jobs repository emitted
  `--ignore-scripts` install commands and transitive `...` workspace builds for
  API and worker. Both exact build paths passed under Node 24.19.0; their
  emitted start commands connected to a fresh migrated PostgreSQL 18.3
  database and each returned HTTP 200 from `/health/ready`. The process,
  database volume, fixture, and readiness files were then removed and Colima
  was stopped again.
- The final post-review pinned `validate:starter` rerun passed all source gates,
  49 tests, and all seven generated fixtures after `RUNTIME-07`.

## Evidence

- `RUNTIME-01`: a real Better Auth signup returned HTTP 400 because Fastify had
  parsed the JSON body before the generated raw Node handler received it. No
  identity rows were persisted. Replace the raw-handler bridge with the pinned
  provider's documented Fetch `Request`/`Response` Fastify integration and add
  a body/cookie regression test.
- `RUNTIME-02`: the first Python container build transferred approximately
  245 MB because the generated repository omitted `.dockerignore` and included
  local `node_modules`. Generate a bounded `.dockerignore` and prove the rebuilt
  context excludes workspace artifacts.
- `RUNTIME-03`: after repairing body forwarding, real signup reached Better
  Auth but failed closed because no authentication method was enabled. Enable
  the starter's basic email/password flow explicitly and prove persisted signup
  and session behavior against PostgreSQL.
- `RUNTIME-04`: the generated API image failed to build because its plain
  frozen install triggered pnpm's unapproved-build policy for `esbuild`. Make
  all generated Node Dockerfiles use the same `--ignore-scripts` supply-chain
  policy as fixture installation and prove API/worker images build.
- `RUNTIME-05`: the generated API and worker images built but exited at runtime
  because their Dockerfiles compiled only the selected application workspace,
  leaving internal workspace dependencies without `dist` output. Build each
  selected app together with its transitive workspace dependency closure and
  prove readiness from the resulting images.
- `RUNTIME-06`: the full matrix found that an API-plus-data fixture without
  identity or an external API emitted an unused `FastifyInstance` type import.
  Make the generated import capability-aware and assert the minimal API owner
  does not receive that type.
- `RUNTIME-07`: the closing review found that generated GitHub CI and Railway
  commands did not share the corrected install/build policy. CI could fail on
  the unapproved `esbuild` lifecycle, and Railway could start an app whose
  internal workspace dependencies had no compiled output. Apply
  `--ignore-scripts` consistently and build each Railway app's transitive
  workspace dependency closure.

## Decisions

- Use Colima with Docker Engine rather than Docker Desktop because this Intel
  Mac is RAM-sensitive and Docker Desktop adds an always-on UI plus separate
  commercial licensing terms.
- Use a named `thaarei-starter` profile with two CPUs, 2 GiB RAM, 30 GiB data
  disk, the macOS Virtualization framework, and no login service.
- Use only disposable generated repositories, test identities, named
  containers, and named volumes.

## Blockers

- Dokploy/Railway deployment, backup restore, registry rollback, and
  simulator/physical native authentication proof require separate target
  environments.
- The generator records Better Auth Expo native compatibility as a release
  gate but does not yet emit a mobile Better Auth client integration. A future
  identity-plus-mobile work item must implement that client boundary before
  simulator or physical-device authentication can be meaningfully proven.
- The active Expo/Metro advisory waiver cannot be removed until a compatible
  patched dependency is published and the matrix passes without the waiver.

## Handoff

The local Docker, PostgreSQL, authentication, workflow, logical restore, and
fixture blockers recorded in `STARTER-001` are superseded by this evidence.
Technical and operations owners still own live deployment, scheduled backup
restore, registry rollback, and the separate mobile Better Auth integration and
native-device proof.

## Completion

Local environment validation is complete. The starter remains correctly
blocked from release promotion by its external operational, native
authentication, and active security-waiver gates.
