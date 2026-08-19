# Thaarei starter source

This repository builds independent private client repositories from one tested
engineering contract. It is not a published package and it does not synchronize
changes into clients after initialization.

The source repository contains profile templates, validation tooling, and the
engineering reference. A generated client repository contains only its selected
applications, packages, deployment target, root agent instructions, and work
records.

## Source status

`starter-release.json` marks this version as `prerelease`. Local checks do not
prove live Dokploy or Railway deployment, backup restore, rollback, or native
Better Auth compatibility with Expo SDK 57. Those gates need separate evidence.
The mobile profile also carries a narrow, recorded waiver for two high-severity
`image-size` advisories until the advisory's patched release is published.

## Initialize a client fixture

Install the pinned toolchain and run the initializer with explicit profiles:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm starter:init \
  --product-id example-product \
  --client-id example-client \
  --display-name "Example Product" \
  --package-scope @example \
  --profiles web,api,data,identity \
  --deployment dokploy \
  --technical-owner engineering@example.com \
  --operations-owner operations@example.com \
  --output .thaarei/fixtures/example-product
```

When `--output` is absent, the command writes a self-contained repository to
`.thaarei/generated/<client-id>`. Move that directory to its independent private
GitHub repository. Use `--output` when a different empty destination is needed;
the initializer refuses to overwrite existing files or rerun an initialized
repository.

## Validate the source template

Run the complete local gate:

```bash
pnpm validate:starter
```

Use the focused commands in [AGENTS.md](AGENTS.md) while developing the
template. The architecture reference is
[docs/engineering-starter-kit.md](docs/engineering-starter-kit.md).
