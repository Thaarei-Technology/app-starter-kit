#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type GeneratedFile,
  computeSemanticTreeHash,
  generateProject,
  type InitConfig,
  productIdentity,
  readAgentTemplate,
  writeGeneratedProject,
} from "./generator.js";
import { canonicalizeProfiles, CAPABILITY_REGISTRY, PRESETS } from "./capabilities.js";
import { InitValidationError, validateInitOptions } from "./validation.js";

const VALUE_FLAGS = new Set([
  "product-id",
  "client-id",
  "display-name",
  "package-scope",
  "profiles",
  "deployment",
  "technical-owner",
  "operations-owner",
  "mobile-scheme",
  "ios-bundle-id",
  "android-application-id",
  "output",
  "output-dir",
  "agent-template",
  "payment-providers",
  "ai-providers",
  "identity-mail-provider",
  "notification-provider",
  "cache-provider",
  "observability-exporters",
  "dry-run",
  "json",
  "allow-experimental",
  "allow-beta-target",
  "create-remote",
  "github-repo",
  "preset",
  "add-profile",
  "remove-profile",
  "topology",
]);
const execFileAsync = promisify(execFile);
const EXPERIMENTAL_PROFILE_NAMES: ReadonlySet<string> = new Set(
  Object.values(CAPABILITY_REGISTRY)
    .filter((profile) => profile.sourceMaturity === "experimental")
    .map((profile) => profile.id),
);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const packagedAssets = resolve(import.meta.dirname, "../assets");
const sourceRoot = existsSync(resolve(packagedAssets, "templates/AGENTS.md"))
  ? packagedAssets
  : repositoryRoot;
const BUNDLED_GOVERNANCE_FILES = [
  { source: "templates/tooling/check-generated.ts", destination: "tooling/check-generated.ts" },
  { source: "templates/tooling/check-migrations.ts", destination: "tooling/check-migrations.ts" },
  {
    source: "packages/tooling/src/governance/boundaries.ts",
    destination: "tooling/governance/src/boundaries.ts",
  },
  {
    source: "packages/tooling/src/governance/cli.ts",
    destination: "tooling/governance/src/cli.ts",
  },
  {
    source: "packages/tooling/src/governance/implementation.ts",
    destination: "tooling/governance/src/implementation.ts",
  },
  {
    source: "packages/tooling/src/governance/source-of-truth.ts",
    destination: "tooling/governance/src/source-of-truth.ts",
  },
  {
    source: "packages/tooling/src/governance/types.ts",
    destination: "tooling/governance/src/types.ts",
  },
  {
    source: "packages/tooling/tests/governance.test.ts",
    destination: "tooling/governance/tests/governance.test.ts",
  },
] as const;
const HELP = `Thaarei create-app initializer

Usage:
  pnpm starter:init --product-id <id> --client-id <id> --display-name <name> \\
    --package-scope <scope> --profiles <list> --deployment <dokploy|railway> \\
    --technical-owner <name> --operations-owner <name>

Presets: web-app,multi-tenant-web-app,api-service
Profiles: web,mobile,api,data,identity,jobs,events,ai,agentic-ai,external-api,storage,python,tenancy,payments,notifications,cache,rate-limit,search,rag,observability,feature-flags
Provider options: --payment-providers stripe,razorpay --ai-providers openai,anthropic --identity-mail-provider resend --notification-provider resend --cache-provider valkey --observability-exporters otlp,sentry
Mobile-only options: --mobile-scheme --ios-bundle-id --android-application-id
Safety options: --allow-experimental --allow-beta-target --dry-run --json
Output defaults to .thaarei/generated/<client-id>.
Test/automation options: --output <directory> --agent-template <path>
`;

export function parseArguments(rawArgv: readonly string[]): ReadonlyMap<string, string> {
  const argv = rawArgv[0] === "init" ? rawArgv.slice(1) : rawArgv;
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.set("help", "true");
      continue;
    }
    if (!argument?.startsWith("--"))
      throw new InitValidationError(`Unexpected argument: ${argument ?? ""}`);
    const name = argument.slice(2);
    if (!VALUE_FLAGS.has(name)) throw new InitValidationError(`Unknown option: --${name}`);
    if (
      ["dry-run", "json", "allow-experimental", "allow-beta-target", "create-remote"].includes(name)
    ) {
      options.set(name, "true");
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new InitValidationError(`Missing value for --${name}`);
    const canonicalName = name === "output" ? "output-dir" : name;
    if (options.has(canonicalName)) {
      if (canonicalName === "add-profile" || canonicalName === "remove-profile") {
        options.set(canonicalName, `${options.get(canonicalName)},${value}`);
      } else throw new InitValidationError(`Duplicate option: --${name}`);
    } else options.set(canonicalName, value);
    index += 1;
  }
  return options;
}

async function addAgentTemplate(
  config: InitConfig,
  files: readonly GeneratedFile[],
): Promise<readonly GeneratedFile[]> {
  const agentTemplate = await readAgentTemplate(
    config.agentTemplate ?? resolve(sourceRoot, "templates", "AGENTS.md"),
  );
  const agentFile = {
    ...agentTemplate,
    content: agentTemplate.content.replaceAll(
      "{{PRODUCT_NAMESPACE}}",
      productIdentity(config).namespace,
    ),
  };
  if (files.some((file) => file.path === agentFile.path))
    throw new InitValidationError("Agent template would overwrite a generated AGENTS.md");
  const bundledPaths = BUNDLED_GOVERNANCE_FILES.filter((entry) => {
    if (entry.source === "templates/tooling/check-generated.ts")
      return config.profiles.includes("external-api");
    if (entry.source === "templates/tooling/check-migrations.ts")
      return config.profiles.includes("data");
    return true;
  });
  const governanceFiles = await Promise.all(
    bundledPaths.map(
      async (entry): Promise<GeneratedFile> => ({
        path: entry.destination,
        content: (await readFile(resolve(sourceRoot, entry.source), "utf8")).replaceAll(
          ".thaarei",
          productIdentity(config).namespace,
        ),
      }),
    ),
  );
  return [...files, agentFile, ...governanceFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function refreshMarker(
  config: InitConfig,
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const generatedFiles = [
    ...files.map((file) => file.path),
    "pnpm-lock.yaml",
    ...(config.profiles.includes("external-api") ? ["packages/api-client/src/generated/"] : []),
  ]
    .filter((path) => path !== `${productIdentity(config).namespace}/project.json`)
    .sort();
  const normalizedProfiles = canonicalizeProfiles(config.profiles).profiles;
  const marker: GeneratedFile = {
    path: `${productIdentity(config).namespace}/project.json`,
    content: `${JSON.stringify({ schemaVersion: 2, initializedAt: "deterministic", productId: config.productId, clientId: config.clientId, displayName: config.displayName, packageScope: config.packageScope, profiles: normalizedProfiles, deprecatedAliases: canonicalizeProfiles(config.profiles).deprecatedAliases, providers: config.providers, deployment: config.deployment, owners: { technical: config.technicalOwner, operations: config.operationsOwner }, generatedFiles }, null, 2)}\n`,
  };
  return [...files.filter((file) => file.path !== marker.path), marker].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

async function applyLocalPackageOverrides(outputDir: string): Promise<void> {
  const localRoot = process.env.THAAREI_LOCAL_PACKAGE_ROOT;
  if (!localRoot) return;
  const localPackageDirectory = resolve(outputDir, ".local-packages");
  await mkdir(localPackageDirectory, { recursive: true });
  const replacements = [
    {
      path: resolve(outputDir, "package.json"),
      field: "devDependencies",
      packageName: "@thaarei-technology/tooling",
      source: resolve(localRoot, "packages/tooling"),
      specifierPrefix: ".local-packages",
    },
    {
      path: resolve(outputDir, "packages/core/package.json"),
      field: "dependencies",
      packageName: "@thaarei-technology/foundation",
      source: resolve(localRoot, "packages/foundation"),
      specifierPrefix: "../../.local-packages",
    },
  ] as const;
  for (const replacement of replacements) {
    if (!existsSync(replacement.path)) continue;
    const manifest = JSON.parse(await readFile(replacement.path, "utf8")) as Record<
      string,
      Record<string, string>
    >;
    const dependencies = manifest[replacement.field];
    if (!dependencies?.[replacement.packageName]) continue;
    const sourceManifest = JSON.parse(
      await readFile(resolve(replacement.source, "package.json"), "utf8"),
    ) as { readonly name?: string; readonly version?: string };
    if (sourceManifest.name !== replacement.packageName || !sourceManifest.version)
      throw new Error(`Invalid local package source for ${replacement.packageName}`);
    const tarballName = `${replacement.packageName.slice(1).replace("/", "-")}-${sourceManifest.version}.tgz`;
    await execFileAsync("pnpm", ["pack", "--pack-destination", localPackageDirectory], {
      cwd: replacement.source,
    });
    if (!existsSync(resolve(localPackageDirectory, tarballName)))
      throw new Error(`Packing ${replacement.packageName} did not produce ${tarballName}`);
    dependencies[replacement.packageName] = `file:${replacement.specifierPrefix}/${tarballName}`;
    await writeFile(replacement.path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

export async function runInitializer(argv: readonly string[]): Promise<string> {
  const options = parseArguments(argv);
  if (options.has("help")) return HELP;
  const config = validateInitOptions(options);
  if (options.has("dry-run")) {
    const generated = generateProject(config);
    const bundledFiles = await addAgentTemplate(config, generated.files);
    const plannedFiles = refreshMarker(config, bundledFiles);
    return JSON.stringify(
      {
        ok: true,
        recipe: {
          product: config.displayName,
          preset: config.preset ?? null,
          requestedProfiles: config.requestedProfiles ?? config.profiles,
          resolvedProfiles: config.profiles,
          deployment: { target: config.deployment, topology: config.topology },
        },
        warnings: config.profiles.includes("mobile")
          ? ["mobile is experimental, unqualified, and forbidden in production"]
          : [],
        pathPlan: {
          files: [
            ...plannedFiles.map((file) => file.path),
            "pnpm-lock.yaml",
            ...(config.profiles.includes("external-api")
              ? ["packages/api-client/src/generated/"]
              : []),
          ].sort(),
        },
        validationErrors: [],
      },
      null,
      2,
    );
  }
  const finalOutput = resolve(config.outputDir);
  try {
    await stat(finalOutput);
    throw new InitValidationError(`Output directory already exists: ${finalOutput}`);
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(finalOutput), { recursive: true });
  const stagingOutput = await mkdtemp(
    resolve(dirname(finalOutput), `.${basename(finalOutput)}.tmp-`),
  );
  try {
    const stagedConfig = { ...config, outputDir: stagingOutput };
    const generated = generateProject(stagedConfig);
    const bundledFiles = await addAgentTemplate(stagedConfig, generated.files);
    const result = { config: stagedConfig, files: refreshMarker(stagedConfig, bundledFiles) };
    const written = await writeGeneratedProject(result);
    await applyLocalPackageOverrides(written.outputDir);
    await execFileAsync("pnpm", ["install", "--ignore-scripts"], { cwd: written.outputDir });
    if (config.profiles.includes("external-api"))
      await execFileAsync("pnpm", ["generate:api-client"], { cwd: written.outputDir });
    await execFileAsync("pnpm", ["exec", "biome", "format", "--write", "."], {
      cwd: written.outputDir,
    });
    await execFileAsync("pnpm", ["exec", "biome", "format", "--write", "."], {
      cwd: written.outputDir,
    });
    await execFileAsync("pnpm", ["validate:starter"], { cwd: written.outputDir });
    const recipePath = resolve(written.outputDir, ".thaarei/starter.json");
    const recipe = JSON.parse(await readFile(recipePath, "utf8")) as Record<string, unknown>;
    recipe.generatedAt = new Date().toISOString();
    recipe.generatedTreeHash = await computeSemanticTreeHash(written.outputDir);
    await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");
    await execFileAsync("pnpm", ["exec", "biome", "format", "--write", ".thaarei/starter.json"], {
      cwd: written.outputDir,
    });
    await rename(stagingOutput, finalOutput);
    await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: finalOutput });
    if (config.createRemote && config.githubRepository) {
      await execFileAsync(
        "gh",
        [
          "repo",
          "create",
          config.githubRepository,
          "--private",
          "--source",
          finalOutput,
          "--remote",
          "origin",
        ],
        { cwd: finalOutput },
      );
    }
    return `Initialized ${config.displayName} in ${finalOutput} (${written.files.length} files).`;
  } catch (error: unknown) {
    await rm(stagingOutput, { recursive: true, force: true });
    throw error;
  }
}

export function structuredInitializerFailure(
  argv: readonly string[],
  error: unknown,
): string | null {
  if (!argv.includes("--dry-run") || !argv.includes("--json")) return null;
  const message = error instanceof Error ? error.message : "Initializer failed";
  return JSON.stringify(
    {
      ok: false,
      recipe: null,
      warnings: [],
      pathPlan: { files: [] },
      validationErrors: [{ message }],
    },
    null,
    2,
  );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const effectiveArguments = argv.length === 0 ? await interactiveArguments() : argv;
    const result = await runInitializer(effectiveArguments);
    process.stdout.write(`${result}\n`);
  } catch (error: unknown) {
    const structured = structuredInitializerFailure(argv, error);
    if (structured !== null) {
      process.stdout.write(`${structured}\n`);
      process.exitCode = 1;
      return;
    }
    const message = error instanceof Error ? error.message : "Initializer failed";
    process.stderr.write(`starter:init: ${message}\n${HELP}`);
    process.exitCode = 1;
  }
}

async function interactiveArguments(): Promise<readonly string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new InitValidationError(
      "Noninteractive mode requires --preset or --profiles and all required options",
    );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const preset = (
      await terminal.question(`Preset (${Object.keys(PRESETS).join(" | ")}): `)
    ).trim();
    if (!preset)
      throw new InitValidationError("Interactive generation requires an explicit preset selection");
    const additions = (
      await terminal.question("Additional profiles (comma-separated, or blank): ")
    ).trim();
    const deployment = (await terminal.question("Deployment target (dokploy | railway): ")).trim();
    const productId = (await terminal.question("Product id: ")).trim();
    const clientId = (await terminal.question("Client id: ")).trim();
    const displayName = (await terminal.question("Display name: ")).trim();
    const packageScope = (await terminal.question("Package scope: ")).trim();
    const technicalOwner = (await terminal.question("Technical owner: ")).trim();
    const operationsOwner = (await terminal.question("Operations owner: ")).trim();
    const result = ["--preset", preset];
    if (additions) result.push("--add-profile", additions);
    result.push(
      "--deployment",
      deployment,
      "--product-id",
      productId,
      "--client-id",
      clientId,
      "--display-name",
      displayName,
      "--package-scope",
      packageScope,
      "--technical-owner",
      technicalOwner,
      "--operations-owner",
      operationsOwner,
    );
    const addedProfiles = additions
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const experimentalProfiles = addedProfiles.filter((profile) =>
      EXPERIMENTAL_PROFILE_NAMES.has(profile),
    );
    if (experimentalProfiles.length > 0) {
      const confirmation = (
        await terminal.question(
          `Profiles ${experimentalProfiles.join(", ")} are experimental. Type EXPERIMENTAL to continue: `,
        )
      ).trim();
      if (confirmation !== "EXPERIMENTAL")
        throw new InitValidationError("Experimental generation was not confirmed");
      result.push("--allow-experimental");
    }
    if (addedProfiles.includes("mobile")) {
      process.stdout.write(
        "Mobile is security-blocked, native-unqualified, and production-forbidden in Starter 1.0.\n",
      );
      result.push("--mobile-scheme", await terminal.question("Mobile URL scheme: "));
      result.push("--ios-bundle-id", await terminal.question("iOS bundle id: "));
      result.push("--android-application-id", await terminal.question("Android application id: "));
    }
    if (deployment === "railway") {
      const confirmation = (
        await terminal.question("Railway is beta. Type BETA to continue: ")
      ).trim();
      if (confirmation !== "BETA")
        throw new InitValidationError("Beta Railway generation was not confirmed");
      result.push("--allow-beta-target");
    }
    return result;
  } finally {
    terminal.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) void main();
