import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type GeneratedFile,
  generateProject,
  type InitConfig,
  readAgentTemplate,
  writeGeneratedProject,
} from "./generator.js";
import { canonicalizeProfiles } from "./capabilities.js";
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
  "email-provider",
  "cache-provider",
  "observability-exporters",
]);
const execFileAsync = promisify(execFile);
const sourceRoot = resolve(import.meta.dirname, "../../..");
const BUNDLED_GOVERNANCE_FILES = [
  "templates/tooling/check-generated.ts",
  "templates/tooling/check-migrations.ts",
  "tooling/governance/src/boundaries.ts",
  "tooling/governance/src/cli.ts",
  "tooling/governance/src/implementation.ts",
  "tooling/governance/src/source-of-truth.ts",
  "tooling/governance/src/types.ts",
  "tooling/governance/tests/governance.test.ts",
] as const;
const HELP = `Thaarei starter initializer

Usage:
  pnpm starter:init --product-id <id> --client-id <id> --display-name <name> \\
    --package-scope <scope> --profiles <list> --deployment <dokploy|railway> \\
    --technical-owner <name> --operations-owner <name>

Profiles: web,mobile,api,data,identity,jobs,events,ai,agentic-ai,durable-ai,external-api,storage,python,tenancy,payments,notifications,cache,rate-limit,search,rag,observability,feature-flags
Provider options: --payment-providers stripe,razorpay --ai-providers openai,anthropic --email-provider resend --cache-provider valkey --observability-exporters otlp,sentry
Mobile-only options: --mobile-scheme --ios-bundle-id --android-application-id
Output defaults to .thaarei/generated/<client-id>.
Test/automation options: --output <directory> --agent-template <path>
`;

export function parseArguments(argv: readonly string[]): ReadonlyMap<string, string> {
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
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new InitValidationError(`Missing value for --${name}`);
    const canonicalName = name === "output" ? "output-dir" : name;
    if (options.has(canonicalName)) throw new InitValidationError(`Duplicate option: --${name}`);
    options.set(canonicalName, value);
    index += 1;
  }
  return options;
}

async function addAgentTemplate(
  config: InitConfig,
  files: readonly GeneratedFile[],
): Promise<readonly GeneratedFile[]> {
  const agentFile = await readAgentTemplate(
    config.agentTemplate ?? resolve(sourceRoot, "templates", "AGENTS.md"),
  );
  if (files.some((file) => file.path === agentFile.path))
    throw new InitValidationError("Agent template would overwrite a generated AGENTS.md");
  const bundledPaths = BUNDLED_GOVERNANCE_FILES.filter((path) => {
    if (path === "templates/tooling/check-generated.ts")
      return config.profiles.includes("external-api");
    if (path === "templates/tooling/check-migrations.ts") return config.profiles.includes("data");
    return true;
  });
  const governanceFiles = await Promise.all(
    bundledPaths.map(
      async (path): Promise<GeneratedFile> => ({
        path: path.startsWith("templates/") ? path.slice("templates/".length) : path,
        content: await readFile(resolve(sourceRoot, path), "utf8"),
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
    .filter((path) => path !== ".thaarei/starter-init.json")
    .sort();
  const normalizedProfiles = canonicalizeProfiles(config.profiles).profiles;
  const marker: GeneratedFile = {
    path: ".thaarei/starter-init.json",
    content: `${JSON.stringify({ schemaVersion: 2, initializedAt: "deterministic", productId: config.productId, clientId: config.clientId, displayName: config.displayName, packageScope: config.packageScope, profiles: normalizedProfiles, deprecatedAliases: canonicalizeProfiles(config.profiles).deprecatedAliases, providers: config.providers, deployment: config.deployment, owners: { technical: config.technicalOwner, operations: config.operationsOwner }, generatedFiles }, null, 2)}\n`,
  };
  return [...files.filter((file) => file.path !== marker.path), marker].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export async function runInitializer(argv: readonly string[]): Promise<string> {
  const options = parseArguments(argv);
  if (options.has("help")) return HELP;
  const config = validateInitOptions(options);
  if (config.profiles.includes("durable-ai"))
    process.stderr.write(
      "starter:init: --profiles durable-ai is deprecated; use agentic-ai in V2.\n",
    );
  const generated = generateProject(config);
  const bundledFiles = await addAgentTemplate(config, generated.files);
  const result = { config, files: refreshMarker(config, bundledFiles) };
  const written = await writeGeneratedProject(result);
  await execFileAsync(
    resolve(sourceRoot, "node_modules", ".bin", "biome"),
    ["format", "--write", "."],
    { cwd: written.outputDir },
  );
  await execFileAsync("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: written.outputDir,
  });
  if (config.profiles.includes("external-api")) {
    await execFileAsync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: written.outputDir,
    });
    await execFileAsync("pnpm", ["generate:api-client"], { cwd: written.outputDir });
  }
  // Dependency installation and generated OpenAPI output can add files after
  // the first formatting pass. Re-run the pinned formatter so every generated
  // repository starts in the same state validated by its own format gate.
  await execFileAsync(
    resolve(sourceRoot, "node_modules", ".bin", "biome"),
    ["format", "--write", "."],
    { cwd: written.outputDir },
  );
  return `Initialized ${config.displayName} in ${written.outputDir} (${written.files.length} files).`;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const result = await runInitializer(argv);
    process.stdout.write(`${result}\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Initializer failed";
    process.stderr.write(`starter:init: ${message}\n${HELP}`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) void main();
