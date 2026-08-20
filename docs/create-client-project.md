# Create a client project

Use this guide to create an independent private client repository from the
Thaarei starter source. The generated repository contains only the selected
profiles and their supporting files. It does not synchronize with the starter
source after initialization.

The generated repository has its own `docs/developer-guide.md`. That guide
covers work inside the client repository. This guide covers the creation step
from the starter source.

## Choose a creation route

Use one of these routes. In both routes, the destination must have no tracked
files. A cloned empty Git repository may contain its `.git` directory.

### Generate locally, then publish

Use this route when you want to inspect the generated files before creating the
GitHub repository.

1. Clone the private starter source and enter the checkout.

   ```bash
   git clone <starter-repository-url> thaarei-starter
   cd thaarei-starter
   ```

2. Install the pinned toolchain and validate the source.

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm validate:starter
   ```

3. Run `pnpm starter:init` with the project values and an output directory
   outside the starter checkout.

   ```bash
   pnpm starter:init \
     --product-id example-product \
     --client-id example-client \
     --display-name "Example Product" \
     --package-scope @example \
     --profiles web,api,data,identity \
     --deployment dokploy \
     --technical-owner engineering@example.com \
     --operations-owner operations@example.com \
     --output ../example-client
   ```

4. Inspect and validate the generated directory as described in [Validate the
   generated repository](#validate-the-generated-repository).

5. Create an independent private repository and push the generated directory.

   ```bash
   cd ../example-client
   git init -b main
   git add .
   git commit -m "Initialize example client"
   git remote add origin https://github.com/<owner>/<repository>.git
   git push -u origin main
   ```

   Create the empty private GitHub repository before `git remote add`, or use
   `gh repo create <owner>/<repository> --private --source . --remote origin --push`.

### Clone an empty private repository, then generate

Use this route when the GitHub repository must exist before initialization.

1. Create an empty private repository. Do not add a README, license, or
   `.gitignore`.

2. Clone the repository.

   ```bash
   git clone https://github.com/<owner>/<repository>.git example-client
   ```

3. Run the initializer from the starter checkout and point `--output` at the
   cloned directory.

   ```bash
   cd /path/to/thaarei-starter
   pnpm starter:init \
     --product-id example-product \
     --client-id example-client \
     --display-name "Example Product" \
     --package-scope @example \
     --profiles web,api,data,identity \
     --deployment dokploy \
     --technical-owner engineering@example.com \
     --operations-owner operations@example.com \
     --output /path/to/example-client
   ```

4. Validate the generated repository, commit the result, and push it.

   ```bash
   cd /path/to/example-client
   git add .
   git commit -m "Initialize example client"
   git push -u origin main
   ```

GitHub's **Use this template** action copies the starter source repository. It
does not run `starter:init`, select profiles, or create a client configuration.
Do not use that action as the client initialization route.

## Run the initializer

Run this command from a checkout of the starter source:

```bash
pnpm starter:init \
  --product-id <product-id> \
  --client-id <client-id> \
  --display-name "<display name>" \
  --package-scope <scope> \
  --profiles <profile-list> \
  --deployment <dokploy|railway> \
  --technical-owner "<name or team>" \
  --operations-owner "<name or team>"
```

Run `pnpm starter:init --help` to print the same usage summary.

The initializer requires these values:

| Option | Accepted value | Notes |
| --- | --- | --- |
| `--product-id` | Lowercase letters, numbers, and hyphens. The first character must be a letter or number. | Used as the product identifier. |
| `--client-id` | Lowercase letters, numbers, and hyphens. The first character must be a letter or number. | Used in the default output path and generated package name. |
| `--display-name` | Non-empty text, up to 200 characters. Newlines and control characters are rejected. | The name shown in generated documentation and application text. |
| `--package-scope` | `scope` or `@scope`, using lowercase letters, numbers, `.`, `_`, and `-`. | The initializer normalizes `scope` to `@scope`. |
| `--profiles` | A comma-separated list of supported profile names. Whitespace around commas is allowed. | Select at least one profile. Do not repeat a profile. The `base` profile is always included and is not passed in this list. |
| `--deployment` | `dokploy` or `railway` | Selects the generated deployment files. |
| `--technical-owner` | Non-empty text, at least 2 and at most 120 characters. Newlines and control characters are rejected. | The technical owner recorded in `INIT-001`. |
| `--operations-owner` | Non-empty text, at least 2 and at most 120 characters. Newlines and control characters are rejected. | The operations owner recorded in `INIT-001`. |

The output options are:

| Option | Default or behavior |
| --- | --- |
| `--output <directory>` | Alias for `--output-dir`. |
| `--output-dir <directory>` | Writes to `.thaarei/generated/<client-id>` when omitted. Pass an absolute path or a path relative to the starter checkout. Do not pass both output aliases. |
| `--agent-template <path>` | Test and automation option. Uses the default `templates/AGENTS.md` when omitted. The supplied file becomes the generated repository's root `AGENTS.md`. |
| `--help` or `-h` | Prints usage and exits without generating files. |

When the initializer writes a repository, it also runs Biome formatting and
creates a lockfile. The `external-api` profile triggers a frozen install and
OpenAPI client generation during initialization.

## Select profiles

The base profile is always enabled. Select only the capabilities that the
product needs. An unselected profile adds no application, package, environment
variable, or CI job.

| Profile | Adds | Required profiles |
| --- | --- | --- |
| `web` | Next.js web application and presentation packages | None |
| `mobile` | Expo and React Native application | None |
| `api` | Fastify and tRPC API | Base, which is implicit |
| `data` | PostgreSQL, Drizzle, migrations, and database package | Base, which is implicit |
| `identity` | Better Auth authentication artifacts | `api`, `data` |
| `jobs` | Graphile Worker and `apps/worker` | `data` |
| `ai` | AI SDK adapter and policy components | `api`, `data`, `identity` |
| `durable-ai` | Durable AI workflow seam | `ai`, `jobs` |
| `external-api` | REST and OpenAPI contract plus generated client | `api` |
| `storage` | S3-compatible storage adapter and metadata persistence | `api`, `data`, `identity` |
| `python` | Separate Python 3.12 service | `api` or `jobs` |

These combinations are valid starting points:

```text
web
web,api,data
web,mobile,api,data,identity
api,data,identity,ai,jobs,durable-ai
api,data,external-api
api,python
api,data,identity,storage
```

The profile order does not change the generated profile set. The initializer
rejects unknown and duplicate names and reports missing dependencies before it
writes files.

### Add mobile identifiers

When `mobile` is selected, pass all three mobile options:

```bash
--mobile-scheme exampleapp \
--ios-bundle-id com.example.app \
--android-application-id com.example.app
```

`--mobile-scheme` must be a valid URI scheme. `--ios-bundle-id` must be a
reverse-domain identifier containing a period. `--android-application-id`
must be a lowercase reverse-domain identifier. The initializer rejects these
options when `mobile` is not selected.

## Inspect the generated repository

The generator writes a self-contained repository with only the selected
applications, packages, and deployment adapter. Common output includes:

- `AGENTS.md`, `README.md`, `package.json`, `pnpm-workspace.yaml`, `.nvmrc`,
  and the pinned `pnpm-lock.yaml`.
- `apps/web`, `apps/api`, `apps/worker`, and `apps/mobile` only when the
  selected profiles need them. The `api` application is also generated for
  profiles that require an API, such as `identity` or `external-api`.
- `services/python` when `python` is selected. This service stays outside the
  pnpm workspace.
- `packages/core`, `packages/database`, `packages/adapters`, `packages/api`,
  `packages/api-client`, and `packages/design-tokens` only when their selected
  capabilities require them, along with the always-present base packages.
- `docs/developer-guide.md`, `docs/environment-reference.md`, and
  `.env.example`.
- `deployment/<deployment>/services.json` and the selected deployment runbook.
  Database-enabled projects also receive backup, restore, and credential
  rotation runbooks.
- `.thaarei/starter-init.json`, `.thaarei/work/INIT-001.md`, and the generated
  root `IMPLEMENTATION.md`.
- `.github/workflows/starter-validation.yml`, `starter-release.json`, and the
  profile-specific governance and security files.

The generated `IMPLEMENTATION.md` is derived from `.thaarei/work/*.md`. Update
the active work item and run `pnpm implementation:sync`; never edit
`IMPLEMENTATION.md` by hand.

## Validate the generated repository

Complete local validation before creating a deployment or declaring the client
ready:

1. Change to the generated repository.

   ```bash
   cd /path/to/example-client
   ```

2. Install the generated lockfile.

   ```bash
   pnpm install --frozen-lockfile
   ```

3. Copy the environment template and fill in local values. Never commit `.env`.

   ```bash
   cp .env.example .env
   ```

4. If `data`, `identity`, `jobs`, or `storage` is selected, start PostgreSQL
   and apply the generated migrations.

   ```bash
   pnpm db:up
   pnpm db:migrate
   ```

5. Run the generated repository's complete local gate.

   ```bash
   pnpm validate:starter
   ```

   In a generated repository, `validate:starter` runs the repository's
   `check` command. That command covers formatting, linting, release metadata,
   source-of-truth and boundary checks, implementation records, typecheck,
   build, tests, and the selected profile checks.

6. Record the commands, results, and any blockers in
   `.thaarei/work/INIT-001.md`. Run `pnpm implementation:sync` after changing
   that work item.

Local validation does not prove deployment, backup restore, rollback, or native
mobile behavior. For Dokploy or Railway, follow the generated runbook and record
the deployed commit, image or service result, health evidence, and recovery
evidence separately. For `mobile`, produce iOS and Android development-build
evidence. If `identity` and `mobile` are both selected, Better Auth's native
integration remains a separate release gate.

## Keep the client independent

Commit the generated files to the new private repository. Do not publish the
starter as a package, add an upstream synchronization workflow, or copy the
starter's source-only documentation tree into the client. Extend the generated
repository under its own work item and keep generated files under their
generators.

The initializer is write-once for generated paths. It rejects a destination
that already contains `.thaarei/starter-init.json` and refuses to overwrite any
planned existing file before writing. Use a new empty destination when a prior
initialization or a file collision exists.
