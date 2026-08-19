import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export const PROFILE_NAMES: readonly [
  "web",
  "mobile",
  "api",
  "data",
  "identity",
  "jobs",
  "ai",
  "durable-ai",
  "external-api",
  "storage",
  "python",
] = [
  "web",
  "mobile",
  "api",
  "data",
  "identity",
  "jobs",
  "ai",
  "durable-ai",
  "external-api",
  "storage",
  "python",
];
export type Profile = (typeof PROFILE_NAMES)[number];
export type Deployment = "dokploy" | "railway";

export interface MobileSettings {
  readonly scheme: string;
  readonly iosBundleId: string;
  readonly androidApplicationId: string;
}

export interface InitConfig {
  readonly productId: string;
  readonly clientId: string;
  readonly displayName: string;
  readonly packageScope: string;
  readonly profiles: readonly Profile[];
  readonly deployment: Deployment;
  readonly technicalOwner: string;
  readonly operationsOwner: string;
  readonly outputDir: string;
  readonly mobile: MobileSettings | null;
  readonly agentTemplate?: string;
}

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}
export interface GenerationResult {
  readonly config: InitConfig;
  readonly files: readonly GeneratedFile[];
}
export interface WriteResult {
  readonly outputDir: string;
  readonly files: readonly string[];
}

const PACKAGE_VERSION = "0.1.0";
const NODE_VERSION = "24.19.0";
const PNPM_VERSION = "11.22.0";
const NODE_IMAGE =
  "node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03";
const PYTHON_VERSION = "3.12.13";
const PYTHON_IMAGE =
  "python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b";
const DEPENDENCY_VERSIONS = {
  nodeTypes: "24.13.3",
  typescript: "6.0.3",
  trpcServer: "11.18.0",
  fastify: "5.12.1",
  next: "16.3.1",
  expo: "57.0.14",
  react: "19.2.3",
  drizzle: "0.45.2",
  postgres: "3.4.9",
  graphileWorker: "0.17.3",
  ai: "7.0.68",
  betterAuth: "1.7.1",
  zod: "4.4.3",
  biome: "2.5.9",
  turbo: "2.10.10",
  tsx: "4.23.12",
  vitest: "4.1.11",
  tailwind: "4.3.3",
  tailwindPostcss: "4.3.3",
  baseUi: "1.7.0",
  tanstackQuery: "5.101.4",
  tanstackForm: "1.33.5",
  expoRouter: "57.0.14",
  reactNative: "0.86.2",
  unistyles: "3.3.0",
  reanimated: "4.5.1",
  gestureHandler: "2.32.0",
  secureStore: "57.0.1",
  notifications: "57.0.12",
  trpcClient: "11.18.0",
  pino: "10.3.1",
  fastifySwagger: "9.8.1",
  fastifySwaggerUi: "6.1.1",
  openapiClient: "0.99.0",
  openapiFetch: "0.13.1",
  jsYaml: "4.3.1",
  awsS3: "3.1113.0",
  awsPresigner: "3.1113.0",
  reactTypes: "19.2.18",
  reactDomTypes: "19.2.4",
} as const;

/**
 * The profile graph is deliberately computed once.  Generation functions consume this
 * graph instead of independently deciding which capability owns a dependency, application,
 * readiness probe, or release claim.
 */
interface CapabilityPlan {
  readonly profiles: readonly Profile[];
  readonly needsApi: boolean;
  readonly needsApiClient: boolean;
  readonly needsDatabase: boolean;
  readonly needsWorker: boolean;
  readonly needsExternalApi: boolean;
  readonly needsIdentity: boolean;
  readonly needsAi: boolean;
  readonly needsStorage: boolean;
  readonly needsAdapters: boolean;
  readonly deployableApps: readonly string[];
  readonly apiEnvironment: readonly string[];
  readonly workerEnvironment: readonly string[];
  readonly testedPackages: Readonly<Record<string, string>>;
}

function hasProfile(config: InitConfig, profile: Profile): boolean {
  return config.profiles.includes(profile);
}

function createCapabilityPlan(config: InitConfig): CapabilityPlan {
  const selected = new Set(config.profiles);
  const has = (profile: Profile): boolean => selected.has(profile);
  const needsIdentity = has("identity");
  const needsAi = has("ai");
  const needsStorage = has("storage");
  const needsExternalApi = has("external-api");
  const needsWorker = has("jobs");
  if (needsAi && (!has("api") || !has("data") || !needsIdentity))
    throw new Error("Invalid capability plan: ai requires api, data, and identity");
  if (needsStorage && (!has("api") || !has("data") || !needsIdentity))
    throw new Error("Invalid capability plan: storage requires api, data, and identity");
  const needsDatabase = has("data") || needsIdentity || needsWorker || needsStorage;
  const needsApi = has("api") || needsIdentity || needsExternalApi || needsAi || needsStorage;
  const needsApiClient = needsApi && (has("web") || has("mobile") || needsExternalApi);
  const deployableApps = [
    ...(has("web") ? ["web"] : []),
    ...(needsApi ? ["api"] : []),
    ...(needsWorker ? ["worker"] : []),
    ...(has("python") ? ["python"] : []),
  ];
  const apiEnvironment = [
    "NODE_ENV",
    "PORT",
    ...(needsDatabase ? ["DATABASE_URL"] : []),
    ...(needsIdentity ? ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] : []),
    ...(needsAi ? ["AI_MAX_TOOL_BUDGET_USD"] : []),
    ...(needsStorage
      ? [
          "STORAGE_BUCKET",
          "STORAGE_REGION",
          "STORAGE_ENDPOINT",
          "STORAGE_ACCESS_KEY_ID",
          "STORAGE_SECRET_ACCESS_KEY",
        ]
      : []),
    ...(has("python") ? ["PYTHON_SERVICE_URL"] : []),
  ];
  const workerEnvironment = [
    "NODE_ENV",
    "PORT",
    ...(needsDatabase ? ["DATABASE_URL"] : []),
    "WORKER_CONCURRENCY",
  ];
  return {
    profiles: config.profiles,
    needsApi,
    needsApiClient,
    needsDatabase,
    needsWorker,
    needsExternalApi,
    needsIdentity,
    needsAi,
    needsStorage,
    needsAdapters: needsIdentity || needsAi || needsStorage,
    deployableApps,
    apiEnvironment,
    workerEnvironment,
    testedPackages: testedPackages(config),
  };
}
function packageName(config: InitConfig, name: string): string {
  return `${config.packageScope}/${name}`;
}

function jsonFile(path: string, value: unknown): GeneratedFile {
  return { path, content: `${JSON.stringify(value, null, 2)}\n` };
}
function textFile(path: string, content: string): GeneratedFile {
  return { path, content: content.endsWith("\n") ? content : `${content}\n` };
}

function sourceOfTruthBlock(values: {
  readonly id: string;
  readonly keywords: string;
  readonly what: string;
  readonly why: string;
  readonly when: string;
  readonly how: string;
  readonly boundaries: string;
}): string {
  return `/**
 * SOURCE OF TRUTH ID: ${values.id}
 * SOURCE OF TRUTH KEYWORDS: ${values.keywords}
 *
 * WHAT: ${values.what}
 * WHY: ${values.why}
 * WHEN: ${values.when}
 * HOW: ${values.how}
 * BOUNDARIES: ${values.boundaries}
 */`;
}

function packageManifest(
  config: InitConfig,
  name: string,
  dependencies: Readonly<Record<string, string>> = {},
): GeneratedFile {
  return jsonFile(`packages/${name}/package.json`, {
    name: packageName(config, name),
    private: true,
    version: PACKAGE_VERSION,
    type: "module",
    exports: { ".": { types: "./src/index.ts", import: "./dist/index.js" } },
    scripts: { build: "tsc -p tsconfig.json", typecheck: "tsc -p tsconfig.json --noEmit" },
    dependencies,
    devDependencies: {
      "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
      typescript: DEPENDENCY_VERSIONS.typescript,
    },
  });
}
function packageTsconfig(name: string): GeneratedFile {
  return jsonFile(`packages/${name}/tsconfig.json`, {
    extends: "../../tsconfig.json",
    compilerOptions: { noEmit: false, outDir: "dist", rootDir: "src" },
    include: ["src"],
  });
}
function apiClientTsconfig(): GeneratedFile {
  return jsonFile("packages/api-client/tsconfig.json", {
    extends: "../../tsconfig.json",
    compilerOptions: {
      exactOptionalPropertyTypes: false,
      noEmit: false,
      outDir: "dist",
      rootDir: "src",
    },
    include: ["src"],
  });
}
function appManifest(
  config: InitConfig,
  name: string,
  dependencies: Readonly<Record<string, string>> = {},
  devDependencies: Readonly<Record<string, string>> = {},
): GeneratedFile {
  return jsonFile(`apps/${name}/package.json`, {
    name: packageName(config, `${name}-app`),
    private: true,
    version: PACKAGE_VERSION,
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      typecheck: "tsc -p tsconfig.json --noEmit",
      start: "node dist/index.js",
    },
    dependencies,
    devDependencies: {
      "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
      typescript: DEPENDENCY_VERSIONS.typescript,
      ...devDependencies,
    },
  });
}
function appTsconfig(name: string): GeneratedFile {
  return jsonFile(`apps/${name}/tsconfig.json`, {
    extends: "../../tsconfig.json",
    compilerOptions: { noEmit: false, outDir: "dist", rootDir: "src" },
    include: ["src"],
  });
}

function placeholderPackageFile(id: string, description: string): GeneratedFile {
  return textFile(
    `packages/${id}/src/index.ts`,
    `/** ${description} Add source-of-truth metadata only when this package gains an architectural owner. */\nexport const packageId = "${id}" as const;\n`,
  );
}

function testedPackages(config: InitConfig): Readonly<Record<string, string>> {
  const packages: Record<string, string> = {
    "@biomejs/biome": DEPENDENCY_VERSIONS.biome,
    "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
    tsx: DEPENDENCY_VERSIONS.tsx,
    turbo: DEPENDENCY_VERSIONS.turbo,
    typescript: DEPENDENCY_VERSIONS.typescript,
    vitest: DEPENDENCY_VERSIONS.vitest,
  };
  if (hasProfile(config, "api")) {
    Object.assign(packages, {
      "@trpc/client": DEPENDENCY_VERSIONS.trpcClient,
      "@trpc/server": DEPENDENCY_VERSIONS.trpcServer,
      fastify: DEPENDENCY_VERSIONS.fastify,
      pino: DEPENDENCY_VERSIONS.pino,
      zod: DEPENDENCY_VERSIONS.zod,
    });
  }
  if (hasProfile(config, "data") || hasProfile(config, "storage")) {
    Object.assign(packages, {
      "drizzle-orm": DEPENDENCY_VERSIONS.drizzle,
      postgres: DEPENDENCY_VERSIONS.postgres,
    });
  }
  if (hasProfile(config, "identity")) packages["better-auth"] = DEPENDENCY_VERSIONS.betterAuth;
  if (hasProfile(config, "jobs")) packages["graphile-worker"] = DEPENDENCY_VERSIONS.graphileWorker;
  if (hasProfile(config, "ai")) packages.ai = DEPENDENCY_VERSIONS.ai;
  if (hasProfile(config, "external-api")) {
    Object.assign(packages, {
      "@fastify/swagger": DEPENDENCY_VERSIONS.fastifySwagger,
      "@fastify/swagger-ui": DEPENDENCY_VERSIONS.fastifySwaggerUi,
      "@hey-api/openapi-ts": DEPENDENCY_VERSIONS.openapiClient,
      "@hey-api/client-fetch": DEPENDENCY_VERSIONS.openapiFetch,
      "js-yaml": DEPENDENCY_VERSIONS.jsYaml,
    });
  }
  if (hasProfile(config, "storage")) {
    Object.assign(packages, {
      "@aws-sdk/client-s3": DEPENDENCY_VERSIONS.awsS3,
      "@aws-sdk/s3-request-presigner": DEPENDENCY_VERSIONS.awsPresigner,
    });
  }
  if (hasProfile(config, "web")) {
    Object.assign(packages, {
      "@base-ui/react": DEPENDENCY_VERSIONS.baseUi,
      "@tailwindcss/postcss": DEPENDENCY_VERSIONS.tailwindPostcss,
      "@tanstack/react-form": DEPENDENCY_VERSIONS.tanstackForm,
      "@tanstack/react-query": DEPENDENCY_VERSIONS.tanstackQuery,
      "@types/react": DEPENDENCY_VERSIONS.reactTypes,
      "@types/react-dom": DEPENDENCY_VERSIONS.reactDomTypes,
      next: DEPENDENCY_VERSIONS.next,
      react: DEPENDENCY_VERSIONS.react,
      "react-dom": DEPENDENCY_VERSIONS.react,
      tailwindcss: DEPENDENCY_VERSIONS.tailwind,
    });
  }
  if (hasProfile(config, "mobile")) {
    Object.assign(packages, {
      "@types/react": DEPENDENCY_VERSIONS.reactTypes,
      expo: DEPENDENCY_VERSIONS.expo,
      "expo-notifications": DEPENDENCY_VERSIONS.notifications,
      "expo-router": DEPENDENCY_VERSIONS.expoRouter,
      "expo-secure-store": DEPENDENCY_VERSIONS.secureStore,
      react: DEPENDENCY_VERSIONS.react,
      "react-native": DEPENDENCY_VERSIONS.reactNative,
      "react-native-gesture-handler": DEPENDENCY_VERSIONS.gestureHandler,
      "react-native-reanimated": DEPENDENCY_VERSIONS.reanimated,
      "react-native-unistyles": DEPENDENCY_VERSIONS.unistyles,
    });
  }
  return Object.fromEntries(
    Object.entries(packages).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function approvedMajors(
  packages: Readonly<Record<string, string>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(packages).map(([name, version]) => [name, Number.parseInt(version, 10)]),
  );
}

function stringLiteral(value: string): string {
  return JSON.stringify(value);
}

const EXTERNAL_HEALTH_PATH = "/v1/health";

function externalOpenApiDocument(config: InitConfig): Readonly<Record<string, unknown>> {
  return {
    openapi: "3.1.0",
    info: { title: `${config.displayName} external API`, version: PACKAGE_VERSION },
    paths: {
      [EXTERNAL_HEALTH_PATH]: {
        get: {
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
            "503": {
              description: "Service dependencies are unavailable",
              content: {
                "application/problem+json": {
                  schema: { $ref: "#/components/schemas/ProblemDetails" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: "object",
          required: ["status", "checkedAt"],
          properties: {
            status: { type: "string", enum: ["ok", "degraded"] },
            checkedAt: { type: "string", format: "date-time" },
          },
        },
        ProblemDetails: {
          type: "object",
          required: ["type", "title", "status"],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
          },
        },
      },
    },
  };
}

function generatedReleaseSchema(): Readonly<Record<string, unknown>> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://thaarei.example/schemas/starter-release.schema.json",
    title: "Thaarei starter release",
    type: "object",
    additionalProperties: false,
    required: [
      "$schema",
      "schemaVersion",
      "release",
      "status",
      "releasedAt",
      "runtime",
      "approvedMajors",
      "testedPackages",
      "containerImages",
      "enabledProfiles",
      "compatibilityEvidence",
    ],
    properties: {
      $schema: { type: "string", minLength: 1 },
      schemaVersion: { const: 1 },
      release: { type: "string", minLength: 1 },
      status: { enum: ["prerelease", "released", "superseded"] },
      releasedAt: { type: ["string", "null"], format: "date-time" },
      runtime: {
        type: "object",
        additionalProperties: false,
        required: ["node", "pnpm"],
        properties: {
          node: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
          pnpm: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
        },
      },
      approvedMajors: {
        type: "object",
        additionalProperties: { type: "integer", minimum: 0 },
      },
      testedPackages: {
        type: "object",
        additionalProperties: { type: "string", minLength: 1 },
      },
      containerImages: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: ["reference", "digest"],
          properties: {
            reference: { type: "string", minLength: 1 },
            digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          },
        },
      },
      enabledProfiles: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
      compatibilityEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["gate", "status", "evidence"],
          properties: {
            gate: { type: "string", minLength: 1 },
            status: { enum: ["passed", "failed", "pending", "blocked_external"] },
            evidence: { type: "string", minLength: 1 },
          },
        },
      },
    },
  };
}

function generatedReleaseChecker(): GeneratedFile {
  return textFile(
    "tooling/release/check-release.ts",
    `import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { builtinModules } from "node:module";

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringRecord = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((item) => typeof item === "string" && item.length > 0);
const isDateTime = (value: unknown): value is string => typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$/u.test(value) && !Number.isNaN(Date.parse(value));
const unknownKeys = (value: unknown, allowed: readonly string[], label: string): void => {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(\`\${label} has unknown property \${key}\`);
};
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

async function packageManifests(root: string): Promise<readonly JsonRecord[]> {
  const result: JsonRecord[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: readonly { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.name === "package.json" && entry.isFile()) {
        const value = await readJson(path);
        if (isRecord(value)) result.push(value);
      } else if (entry.isDirectory() && !["node_modules", "dist", "build", ".next", ".turbo"].includes(entry.name)) {
        await visit(path);
      }
    }
  };
  await Promise.all([visit(join(root, "packages")), visit(join(root, "apps"))]);
  return result;
}

function catalogFromWorkspace(value: string): Readonly<Record<string, string>> {
  const catalog: Record<string, string> = {};
  let inCatalog = false;
  for (const line of value.split(/\\r?\\n/u)) {
    if (/^catalog:\\s*$/u.test(line)) { inCatalog = true; continue; }
    if (inCatalog && /^\\S/u.test(line)) { inCatalog = false; }
    if (inCatalog) {
      const match = /^\\s{2,}['"]?([^'":]+)['"]?:\\s*([^\\s#]+)\\s*$/u.exec(line);
      if (match?.[1] && match[2]) catalog[match[1]] = match[2];
    }
  }
  return catalog;
}

const errors: string[] = [];
const root = resolve(process.argv[2] ?? process.cwd());
const release = await readJson(resolve(root, "starter-release.json"));
if (!isRecord(release)) errors.push("starter-release.json must be an object");
if (isRecord(release)) {
  for (const key of ["$schema", "schemaVersion", "release", "status", "releasedAt", "runtime", "approvedMajors", "testedPackages", "containerImages", "enabledProfiles", "compatibilityEvidence"]) {
    if (!(key in release)) errors.push(\`starter-release.json is missing \${key}\`);
  }
  if (release.$schema !== "./tooling/release/starter-release.schema.json") errors.push("starter-release.json must reference the bundled schema");
  unknownKeys(release, ["$schema", "schemaVersion", "release", "status", "releasedAt", "runtime", "approvedMajors", "testedPackages", "containerImages", "enabledProfiles", "compatibilityEvidence"], "starter-release.json");
  if (release.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof release.release !== "string" || release.release.length === 0) errors.push("release must be a non-empty string");
  if (release.status !== "prerelease" && release.status !== "released" && release.status !== "superseded") errors.push("release status is invalid");
  unknownKeys(release.runtime, ["node", "pnpm"], "runtime");
  if (!isRecord(release.runtime) || typeof release.runtime.node !== "string" || !/^\\d+\\.\\d+\\.\\d+$/u.test(release.runtime.node) || typeof release.runtime.pnpm !== "string" || !/^\\d+\\.\\d+\\.\\d+$/u.test(release.runtime.pnpm)) errors.push("runtime versions must be exact semantic versions");
  if (!isStringRecord(release.testedPackages)) errors.push("testedPackages must contain exact package versions");
  if (!isRecord(release.approvedMajors) || Object.values(release.approvedMajors).some((value) => !Number.isInteger(value) || Number(value) < 0)) errors.push("approvedMajors must contain non-negative integers");
  if (!Array.isArray(release.containerImages)) {
    if (!isRecord(release.containerImages)) errors.push("containerImages must be an object");
  } else errors.push("containerImages must be an object");
  if (isRecord(release.containerImages)) for (const [name, image] of Object.entries(release.containerImages)) {
    unknownKeys(image, ["reference", "digest"], \`container image \${name}\`);
    if (!isRecord(image) || typeof image.reference !== "string" || image.reference.length === 0 || typeof image.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(image.digest)) errors.push(\`container image \${name} must contain a non-empty reference and sha256 digest\`);
  }
  if (!Array.isArray(release.enabledProfiles) || !release.enabledProfiles.every((value) => typeof value === "string" && value.length > 0) || new Set(release.enabledProfiles).size !== release.enabledProfiles.length) errors.push("enabledProfiles must be a unique non-empty string array");
  if (!Array.isArray(release.compatibilityEvidence) || !release.compatibilityEvidence.every((item) => isRecord(item) && typeof item.gate === "string" && item.gate.length > 0 && ["passed", "failed", "pending", "blocked_external"].includes(String(item.status)) && typeof item.evidence === "string" && item.evidence.length > 0)) errors.push("compatibilityEvidence is invalid");
  if (Array.isArray(release.compatibilityEvidence)) for (const [index, item] of release.compatibilityEvidence.entries()) unknownKeys(item, ["gate", "status", "evidence"], \`compatibilityEvidence[\${index}]\`);
  if (release.releasedAt !== null && !isDateTime(release.releasedAt)) errors.push("releasedAt must be null or a valid UTC date-time");
  if (release.status === "released" && (typeof release.releasedAt !== "string" || !isDateTime(release.releasedAt))) errors.push("releasedAt is required when status is released");
  if (release.status === "prerelease" && release.releasedAt !== null) errors.push("releasedAt must remain null while status is prerelease");
  if (release.status === "released" && Array.isArray(release.compatibilityEvidence) && release.compatibilityEvidence.some((item) => !isRecord(item) || item.status !== "passed")) errors.push("every compatibility gate must pass before release promotion");
}
const packageJson = await readJson(resolve(root, "package.json"));
const runtime = isRecord(release) && isRecord(release.runtime) ? release.runtime : {};
if (isRecord(packageJson) && packageJson.packageManager !== \`pnpm@\${String(runtime.pnpm ?? "")}\`) errors.push("packageManager must match release runtime.pnpm");
if (isRecord(packageJson) && isRecord(packageJson.engines) && typeof runtime.node === "string") {
  const [major, minor] = runtime.node.split(".");
  if (packageJson.engines.node !== \`\${major}.\${minor}.x\`) errors.push("package.json engines.node must match the released Node line");
}
const tested = isRecord(release) && isRecord(release.testedPackages) ? release.testedPackages : {};
const approved = isRecord(release) && isRecord(release.approvedMajors) ? release.approvedMajors : {};
for (const [name, value] of Object.entries(tested)) {
  if (typeof value !== "string") continue;
  const major = Number.parseInt(value.split(".")[0] ?? "", 10);
  if (approved[name] !== major) errors.push(\`approvedMajors must contain \${name}: \${major}\`);
}
for (const name of Object.keys(approved)) if (!(name in tested)) errors.push(\`approved major \${name} has no exact tested package version\`);
const manifests = [...(isRecord(packageJson) ? [packageJson] : []), ...(await packageManifests(root))];
const localWorkspaceNames = new Set(manifests.filter((manifest) => typeof manifest.name === "string").map((manifest) => String(manifest.name)));
for (const manifest of manifests) {
  const dependencies = Object.fromEntries(dependencyFields.flatMap((field) => Object.entries(isRecord(manifest[field]) ? manifest[field] : {}))) as Record<string, unknown>;
  for (const [name, value] of Object.entries(dependencies)) {
    if (typeof value !== "string" || localWorkspaceNames.has(name) || value.startsWith("workspace:") || value.startsWith("file:") || value.startsWith("link:") || name.startsWith("node:") || builtinModules.includes(name)) continue;
    if (tested[name] !== value) errors.push(\`workspace dependency \${String(manifest.name)} \${name}@\${value} is missing from testedPackages\`);
  }
}
const workspace = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
for (const [name, version] of Object.entries(catalogFromWorkspace(workspace))) {
  if (tested[name] !== version) errors.push(\`catalog package \${name}@\${version} does not match testedPackages\`);
}
if (errors.length > 0) { for (const error of errors) process.stderr.write(\`\${error}\\n\`); process.exitCode = 1; }
else process.stdout.write("starter release manifest is consistent\\n");
`,
  );
}

function foundationPackageFile(): GeneratedFile {
  return textFile(
    "packages/foundation/src/index.ts",
    `export type EntityId = string & { readonly __brand: "EntityId" };
export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" };
export const entityId = (value: string): EntityId => value as EntityId;
export const isoTimestamp = (value: string): IsoTimestamp => value as IsoTimestamp;
`,
  );
}

function contractsPackageFile(plan: CapabilityPlan): GeneratedFile {
  const usesZod = plan.needsApi || plan.needsWorker;
  const zodImport = usesZod ? `import { z } from "zod";\n\n` : "";
  const apiSchemas = plan.needsApi
    ? `
export interface HealthResponse { readonly status: "ok" | "degraded"; readonly checkedAt: string; }
export interface ProblemDetails { readonly type: string; readonly title: string; readonly status: number; readonly detail?: string; }
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checkedAt: z.string().datetime(),
  detail: z.string().optional(),
  failedDependency: z.string().optional(),
});
export const problemDetailsSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
});
`
    : "";
  const jobSchema = plan.needsWorker
    ? `
export const jobPayloadSchema = z.object({
  kind: z.literal("starter.health"),
  requestId: z.string().min(1),
});
export type JobPayload = z.infer<typeof jobPayloadSchema>;
`
    : "";
  return textFile(
    "packages/contracts/src/index.ts",
    `${zodImport}${usesZod ? "" : 'export const packageId = "contracts" as const;\n'}${apiSchemas}${jobSchema}
`,
  );
}

function corePackageFile(plan: CapabilityPlan): GeneratedFile {
  const identity = plan.needsIdentity
    ? `export interface AuthenticationSession { readonly subjectId: string; }
export interface AuthenticationPort { resolveSession(headers: Headers): Promise<AuthenticationSession | null>; }
export interface IdentityRepository {
  ensureAuthenticationSubject(authenticationSubjectId: string): Promise<{ readonly subjectId: string }>;
  resolveAuthenticationSubject(authenticationSubjectId: string): Promise<{ readonly subjectId: string } | null>;
}
`
    : "";
  const jobs = plan.needsWorker
    ? `export interface WorkflowStore {
  begin(idempotencyKey: string, claimToken: string, now: Date, leaseExpiresAt: Date): Promise<boolean>;
  complete(idempotencyKey: string, claimToken: string): Promise<void>;
  fail(idempotencyKey: string, claimToken: string): Promise<void>;
}
${sourceOfTruthBlock({ id: "starter.jobs.workflow-policy", keywords: "jobs, idempotency, retry, workflow", what: "Retry-safe workflow claim and completion policy.", why: "Failed jobs must release their claim while completed work remains deduplicated.", when: "Wrap every durable task effect at the worker boundary.", how: "runIdempotentWorkflow", boundaries: "Persistence implements the state transitions; callers do not bypass this policy." })}
export async function runIdempotentWorkflow(
  store: WorkflowStore,
  idempotencyKey: string,
  effect: () => Promise<void>,
  options: { readonly now?: () => Date; readonly leaseMilliseconds?: number; readonly claimToken?: () => string } = {},
): Promise<"completed" | "duplicate"> {
  const now = (options.now ?? (() => new Date()))();
  const leaseMilliseconds = options.leaseMilliseconds ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds <= 0) throw new Error("Workflow lease must be a positive safe integer");
  const claimToken = (options.claimToken ?? (() => crypto.randomUUID()))();
  if (!claimToken) throw new Error("Workflow claim token must be non-empty");
  const leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds);
  if (!(await store.begin(idempotencyKey, claimToken, now, leaseExpiresAt))) return "duplicate";
  try {
    await effect();
    await store.complete(idempotencyKey, claimToken);
    return "completed";
  } catch (error: unknown) {
    await store.fail(idempotencyKey, claimToken);
    throw error;
  }
}
`
    : "";
  const storage = plan.needsStorage
    ? `export interface ObjectStorage {
  put(input: { readonly key: string; readonly contentType: string; readonly body: Uint8Array; readonly subjectId: string }): Promise<void>;
  getUrl(input: { readonly key: string; readonly subjectId: string }): Promise<string>;
}
export interface StorageMetadataStore {
  record(input: { readonly key: string; readonly contentType: string; readonly byteLength: number; readonly subjectId: string }): Promise<void>;
  find(key: string): Promise<{ readonly subjectId: string } | null>;
}
export interface StoragePolicy {
  authorize(operation: "put" | "get", key: string, subjectId: string): boolean;
  readonly maximumBytes: number;
}
export const defaultStoragePolicy: StoragePolicy = {
  maximumBytes: 50 * 1024 * 1024,
  authorize: (_operation, key, subjectId) => subjectId.length > 0 && key.startsWith(subjectId + "/") && !key.includes("..") && !key.startsWith("/"),
};
`
    : "";
  const ai = plan.needsAi
    ? `export interface AiSchema<T> { parse(value: unknown): T; }
export type ToolRisk = "low" | "medium" | "high";
export type AiOutcome = "success" | "invalid_tool" | "invalid_input" | "unauthorized" | "approval_required" | "cost_limit" | "provider_error" | "invalid_output";
export interface AiEvent { readonly toolName: string; readonly subjectId: string; readonly costUsd: number; readonly outcome: AiOutcome; }
export interface AiApprovalStore { isApproved(toolName: string, subjectId: string): Promise<boolean>; }
export interface AiAuditStore { recordAudit(event: AiEvent): Promise<void>; }
export interface AiTelemetryStore { recordTelemetry(event: AiEvent): Promise<void>; }
export interface AiEvaluationStore { recordEvaluation(input: { readonly name: string; readonly score: number; readonly subjectId: string }): Promise<void>; }
export interface AiPersistence extends AiApprovalStore, AiAuditStore, AiTelemetryStore, AiEvaluationStore {
  approve(toolName: string, subjectId: string): Promise<void>;
}
export interface AiExecutionContext {
  readonly subjectId: string;
  readonly budgetUsd: number;
  readonly approvals: AiApprovalStore;
  readonly audit: AiAuditStore;
  readonly telemetry: AiTelemetryStore;
}
export interface AgentTool<Input, Output> {
  readonly name: string;
  readonly risk: ToolRisk;
  readonly requiresApproval: boolean;
  readonly maximumCostUsd: number;
  readonly input: AiSchema<Input>;
  readonly output: AiSchema<Output>;
  readonly authorize: (input: Input, subjectId: string) => Promise<boolean>;
  readonly execute: (input: Input, subjectId: string) => Promise<Output>;
}
export class AiPolicyError extends Error {
  constructor(readonly code: "INVALID_TOOL" | "INVALID_INPUT" | "UNAUTHORIZED" | "APPROVAL_REQUIRED" | "COST_LIMIT" | "PROVIDER_ERROR" | "INVALID_OUTPUT", message: string) { super(message); this.name = "AiPolicyError"; }
}
export class ModelRegistry {
  readonly #models = new Map<string, { readonly generate: (prompt: string) => Promise<{ readonly text: string; readonly costUsd: number }> }>();
  register(name: string, model: { readonly generate: (prompt: string) => Promise<{ readonly text: string; readonly costUsd: number }> }): void {
    if (!name || this.#models.has(name)) throw new Error("AI model name must be unique and non-empty");
    this.#models.set(name, model);
  }
  get(name: string): { readonly generate: (prompt: string) => Promise<{ readonly text: string; readonly costUsd: number }> } {
    const model = this.#models.get(name);
    if (!model) throw new Error("AI model is not registered");
    return model;
  }
}
${sourceOfTruthBlock({ id: "starter.ai.tool-registry", keywords: "ai, tool, authorization, approval, cost", what: "Fail-closed AI tool registration and execution policy.", why: "Model-selected actions require application authorization, approval, validation, audit, telemetry, and cost enforcement.", when: "Execute typed AI tools after constructing an application-owned execution context.", how: "ToolRegistry", boundaries: "Provider adapters generate model output but cannot bypass application policy." })}
export class ToolRegistry {
  readonly #tools = new Map<string, AgentTool<unknown, unknown>>();
  register<Input, Output>(tool: AgentTool<Input, Output>): void {
    if (!tool.name || this.#tools.has(tool.name)) throw new AiPolicyError("INVALID_TOOL", "AI tool name must be unique and non-empty");
    if (!Number.isFinite(tool.maximumCostUsd) || tool.maximumCostUsd <= 0) throw new AiPolicyError("INVALID_TOOL", "AI tool cost limit must be positive");
    if (tool.risk === "high" && !tool.requiresApproval) throw new AiPolicyError("INVALID_TOOL", "High-risk AI tools require approval");
    this.#tools.set(tool.name, tool as AgentTool<unknown, unknown>);
  }
  names(): readonly string[] { return [...this.#tools.keys()].sort(); }
  async execute(name: string, rawInput: unknown, context: AiExecutionContext): Promise<unknown> {
    const tool = this.#tools.get(name);
    const record = async (outcome: AiOutcome, costUsd = 0) => {
      const event = { toolName: name, subjectId: context.subjectId, costUsd, outcome };
      await Promise.all([context.audit.recordAudit(event), context.telemetry.recordTelemetry(event)]);
    };
    if (!tool) { await record("invalid_tool"); throw new AiPolicyError("INVALID_TOOL", "AI tool is not registered"); }
    let input: unknown;
    try { input = tool.input.parse(rawInput); }
    catch { await record("invalid_input"); throw new AiPolicyError("INVALID_INPUT", "AI tool input is invalid"); }
    if (!(await tool.authorize(input, context.subjectId))) {
      await record("unauthorized");
      throw new AiPolicyError("UNAUTHORIZED", "AI tool authorization denied");
    }
    if (tool.requiresApproval && !(await context.approvals.isApproved(name, context.subjectId))) { await record("approval_required"); throw new AiPolicyError("APPROVAL_REQUIRED", "AI tool approval is required"); }
    if (tool.maximumCostUsd > context.budgetUsd) { await record("cost_limit"); throw new AiPolicyError("COST_LIMIT", "AI tool cost exceeds the configured application budget"); }
    let providerOutput: unknown;
    try { providerOutput = await tool.execute(input, context.subjectId); }
    catch { await record("provider_error"); throw new AiPolicyError("PROVIDER_ERROR", "AI tool provider failed"); }
    let output: unknown;
    try { output = tool.output.parse(providerOutput); }
    catch { await record("invalid_output"); throw new AiPolicyError("INVALID_OUTPUT", "AI tool output is invalid"); }
    await record("success", tool.maximumCostUsd);
    return output;
  }
}
`
    : "";
  const owners = [
    ...(plan.needsIdentity ? ["AuthenticationPort", "IdentityRepository"] : []),
    ...(plan.needsWorker ? ["runIdempotentWorkflow"] : []),
    ...(plan.needsStorage ? ["defaultStoragePolicy"] : []),
    ...(plan.needsAi ? ["ToolRegistry"] : []),
  ];
  return textFile(
    "packages/core/src/index.ts",
    `${owners.length === 0 ? 'export const packageId = "core" as const;\n' : ""}${identity}${jobs}${storage}${ai}`,
  );
}

function databasePackageFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const drizzleImports = [
    ...(plan.needsIdentity ? ["boolean"] : []),
    ...(plan.needsIdentity ? ["index"] : []),
    "pgTable",
    ...(plan.needsAi ? ["primaryKey"] : []),
    "text",
    ...(plan.needsStorage || plan.needsAi ? ["integer"] : []),
    ...(plan.needsIdentity || plan.needsWorker ? ["timestamp"] : []),
    ...(plan.needsIdentity ? ["uniqueIndex"] : []),
  ].join(", ");
  const identityTables = plan.needsIdentity
    ? `
export const authUser = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const authSession = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);
export const authAccount = pgTable("account", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("account_issuer_account_id_idx").on(table.issuer, table.accountId), index("account_user_id_idx").on(table.userId)]);
export const authVerification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
export const authSchema = { user: authUser, session: authSession, account: authAccount, verification: authVerification };
export const applicationUsers = pgTable("application_users", { id: text("id").primaryKey(), authenticationSubjectId: text("authentication_subject_id").notNull().unique() });
export const organizations = pgTable("organizations", { id: text("id").primaryKey(), name: text("name").notNull() });
export const memberships = pgTable("memberships", { id: text("id").primaryKey(), userId: text("user_id").notNull(), organizationId: text("organization_id").notNull(), role: text("role").notNull() });
export const permissions = pgTable("permissions", { id: text("id").primaryKey(), membershipId: text("membership_id").notNull(), permission: text("permission").notNull() });
export const invitations = pgTable("invitations", { id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), email: text("email").notNull() });
export const auditEvents = pgTable("audit_events", { id: text("id").primaryKey(), subjectId: text("subject_id").notNull(), action: text("action").notNull() });
`
    : "";
  const aiTables = plan.needsAi
    ? `
export const aiApprovals = pgTable("ai_approvals", { toolName: text("tool_name").notNull(), subjectId: text("subject_id").notNull() }, (table) => [primaryKey({ columns: [table.toolName, table.subjectId] })]);
export const aiEvaluations = pgTable("ai_evaluations", { id: text("id").primaryKey(), name: text("name").notNull(), score: integer("score").notNull(), subjectId: text("subject_id").notNull() });
export const aiTelemetry = pgTable("ai_telemetry", { id: text("id").primaryKey(), toolName: text("tool_name").notNull(), subjectId: text("subject_id").notNull(), costMicrousd: integer("cost_microusd").notNull(), outcome: text("outcome").notNull() });
export const aiAuditEvents = pgTable("ai_audit_events", { id: text("id").primaryKey(), toolName: text("tool_name").notNull(), subjectId: text("subject_id").notNull(), costMicrousd: integer("cost_microusd").notNull(), outcome: text("outcome").notNull() });
`
    : "";
  const storageTables = plan.needsStorage
    ? `
export const objectMetadata = pgTable("object_metadata", { key: text("key").primaryKey(), contentType: text("content_type").notNull(), byteLength: integer("byte_length").notNull(), subjectId: text("subject_id").notNull() });
`
    : "";
  const jobTables = plan.needsWorker
    ? `
export const workflowRuns = pgTable("workflow_runs", { idempotencyKey: text("idempotency_key").primaryKey(), status: text("status").notNull(), claimToken: text("claim_token").notNull(), claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }).notNull() });
`
    : "";
  const aiPersistence = plan.needsAi
    ? `
export function createInMemoryAiPersistence(): AiPersistence & { readonly evidence: () => readonly AiEvent[]; readonly evaluations: () => readonly { readonly name: string; readonly score: number; readonly subjectId: string }[] } {
  const approvals = new Map<string, Set<string>>();
  const events: AiEvent[] = [];
  const evaluations: Array<{ readonly name: string; readonly score: number; readonly subjectId: string }> = [];
  return {
    approve: async (toolName, subjectId) => { const subjects = approvals.get(toolName) ?? new Set<string>(); subjects.add(subjectId); approvals.set(toolName, subjects); },
    isApproved: async (toolName, subjectId) => approvals.get(toolName)?.has(subjectId) ?? false,
    recordAudit: async (event) => { events.push(event); },
    recordTelemetry: async (event) => { events.push(event); },
    recordEvaluation: async (input) => { evaluations.push(input); },
    evidence: () => [...events],
    evaluations: () => [...evaluations],
  };
}
`
    : "";
  const coreTypes = [
    ...(plan.needsIdentity ? ["IdentityRepository"] : []),
    ...(plan.needsWorker ? ["WorkflowStore"] : []),
    ...(plan.needsStorage ? ["StorageMetadataStore"] : []),
    ...(plan.needsAi ? ["AiEvent", "AiPersistence"] : []),
  ];
  const coreTypeImport =
    coreTypes.length > 0
      ? `import type { ${coreTypes.join(", ")} } from "${packageName(config, "core")}";\n`
      : "";
  const databaseOwners = [
    "createDatabaseRuntime",
    ...(plan.needsWorker ? ["workflowRuns"] : []),
    ...(plan.needsStorage ? ["objectMetadata"] : []),
    ...(plan.needsAi ? ["aiApprovals"] : []),
  ].join(", ");
  const databaseKeywords = [
    "database",
    "drizzle",
    "postgres",
    "schema",
    ...(plan.needsWorker ? ["workflow"] : []),
    ...(plan.needsStorage ? ["metadata"] : []),
    ...(plan.needsAi ? ["ai"] : []),
  ].join(", ");
  const workflowRuntime = plan.needsWorker
    ? `
export function createInMemoryWorkflowStore(): WorkflowStore {
  const claims = new Map<string, { readonly status: "running" | "complete"; readonly claimToken: string; readonly claimExpiresAt: Date }>();
  return {
    begin: async (key, claimToken, now, leaseExpiresAt) => {
      const claim = claims.get(key);
      if (claim?.status === "complete" || (claim?.status === "running" && claim.claimExpiresAt > now)) return false;
      claims.set(key, { status: "running", claimToken, claimExpiresAt: leaseExpiresAt });
      return true;
    },
    complete: async (key, claimToken) => { const claim = claims.get(key); if (claim?.claimToken === claimToken) claims.set(key, { ...claim, status: "complete" }); },
    fail: async (key, claimToken) => { if (claims.get(key)?.claimToken === claimToken) claims.delete(key); },
  };
}
`
    : "";
  const workflowDatabase = plan.needsWorker
    ? `
  const workflow: WorkflowStore = {
    begin: async (key, claimToken, now, leaseExpiresAt) => {
      const rows = await sql.unsafe("INSERT INTO workflow_runs (idempotency_key, status, claim_token, claim_expires_at) VALUES ($1, 'running', $2, $3) ON CONFLICT (idempotency_key) DO UPDATE SET status = 'running', claim_token = EXCLUDED.claim_token, claim_expires_at = EXCLUDED.claim_expires_at WHERE workflow_runs.status <> 'complete' AND workflow_runs.claim_expires_at <= $4 RETURNING idempotency_key", [key, claimToken, leaseExpiresAt.toISOString(), now.toISOString()]);
      return rows.length > 0;
    },
    complete: async (key, claimToken) => { await sql.unsafe("UPDATE workflow_runs SET status = 'complete' WHERE idempotency_key = $1 AND claim_token = $2", [key, claimToken]); },
    fail: async (key, claimToken) => { await sql.unsafe("DELETE FROM workflow_runs WHERE idempotency_key = $1 AND claim_token = $2 AND status = 'running'", [key, claimToken]); },
  };
`
    : "";
  const identityDatabase = plan.needsIdentity
    ? `
  const identity: IdentityRepository = {
    ensureAuthenticationSubject: async (authenticationSubjectId) => {
      const id = crypto.randomUUID();
      const rows = await sql.unsafe("INSERT INTO application_users (id, authentication_subject_id) VALUES ($1, $2) ON CONFLICT (authentication_subject_id) DO UPDATE SET authentication_subject_id = EXCLUDED.authentication_subject_id RETURNING id", [id, authenticationSubjectId]);
      const row = rows[0];
      if (!row || typeof row.id !== "string") throw new Error("Failed to map authentication subject");
      return { subjectId: row.id };
    },
    resolveAuthenticationSubject: async (authenticationSubjectId) => {
      const rows = await sql.unsafe("SELECT id FROM application_users WHERE authentication_subject_id = $1", [authenticationSubjectId]);
      const row = rows[0];
      return row && typeof row.id === "string" ? { subjectId: row.id } : null;
    },
  };
`
    : "";
  const metadataDatabase = plan.needsStorage
    ? `
  const metadata: StorageMetadataStore = {
    record: async (input) => { await sql.unsafe("INSERT INTO object_metadata (key, content_type, byte_length, subject_id) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, byte_length = EXCLUDED.byte_length, subject_id = EXCLUDED.subject_id", [input.key, input.contentType, input.byteLength, input.subjectId]); },
    find: async (key) => {
      const rows = await sql.unsafe("SELECT subject_id FROM object_metadata WHERE key = $1", [key]);
      const row = rows[0];
      return row && typeof row.subject_id === "string" ? { subjectId: row.subject_id } : null;
    },
  };
`
    : "";
  const aiDatabase = plan.needsAi
    ? `
  const ai: AiPersistence = {
    approve: async (toolName, subjectId) => { await sql.unsafe("INSERT INTO ai_approvals (tool_name, subject_id) VALUES ($1, $2) ON CONFLICT (tool_name, subject_id) DO NOTHING", [toolName, subjectId]); },
    isApproved: async (toolName, subjectId) => { const rows = await sql.unsafe("SELECT tool_name FROM ai_approvals WHERE tool_name = $1 AND subject_id = $2", [toolName, subjectId]); return rows.length > 0; },
    recordAudit: async (event) => { await sql.unsafe("INSERT INTO ai_audit_events (id, tool_name, subject_id, cost_microusd, outcome) VALUES ($1, $2, $3, $4, $5)", [crypto.randomUUID(), event.toolName, event.subjectId, Math.round(event.costUsd * 1_000_000), event.outcome]); },
    recordTelemetry: async (event) => { await sql.unsafe("INSERT INTO ai_telemetry (id, tool_name, subject_id, cost_microusd, outcome) VALUES ($1, $2, $3, $4, $5)", [crypto.randomUUID(), event.toolName, event.subjectId, Math.round(event.costUsd * 1_000_000), event.outcome]); },
    recordEvaluation: async (input) => { await sql.unsafe("INSERT INTO ai_evaluations (id, name, score, subject_id) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), input.name, Math.round(input.score * 1_000_000), input.subjectId]); },
  };
`
    : "";
  return textFile(
    "packages/database/src/index.ts",
    `import postgres from "postgres";
${plan.needsIdentity ? 'import { drizzle } from "drizzle-orm/postgres-js";\n' : ""}import { ${drizzleImports} } from "drizzle-orm/pg-core";
${coreTypeImport}

${sourceOfTruthBlock({ id: "starter.database.schema", keywords: databaseKeywords, what: "Persistence schema, readiness, and repositories for selected capabilities.", why: "Durable state and provider sessions need one explicit persistence owner.", when: "Use for migrations, repositories, idempotency, and operational readiness.", how: databaseOwners, boundaries: "Apps compose this package; core and adapters must not import its driver directly." })}
export const starterHealth = pgTable("starter_health", { id: text("id").primaryKey() });
${identityTables}${jobTables}${storageTables}${aiTables}
export interface DatabaseRuntime {
  readonly checkReadiness: () => Promise<void>;
  readonly close: () => Promise<void>;
${plan.needsIdentity ? "  readonly authentication: { readonly database: ReturnType<typeof drizzle>; readonly schema: typeof authSchema };\n  readonly identity: IdentityRepository;\n" : ""}${plan.needsWorker ? "  readonly workflow: WorkflowStore;\n" : ""}${plan.needsStorage ? "  readonly metadata: StorageMetadataStore;\n" : ""}${plan.needsAi ? "  readonly ai: AiPersistence;\n" : ""}
}
export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}
${workflowRuntime}
export function createDatabaseRuntime(url = databaseUrl()): DatabaseRuntime {
  const sql = postgres(url, { max: 2 });
${plan.needsIdentity ? "  const authentication = { database: drizzle(sql, { schema: authSchema }), schema: authSchema };\n" : ""}${identityDatabase}${workflowDatabase}${metadataDatabase}${aiDatabase}
  return {
    checkReadiness: async () => { await sql.unsafe("SELECT 1"); },
    close: async () => { await sql.end({ timeout: 5 }); },
${plan.needsIdentity ? "    authentication,\n    identity,\n" : ""}${plan.needsWorker ? "    workflow,\n" : ""}${plan.needsStorage ? "    metadata,\n" : ""}${plan.needsAi ? "    ai,\n" : ""}  };
}
${aiPersistence}
`,
  );
}

function adaptersPackageFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const providerOwners = [
    ...(plan.needsIdentity ? ["createBetterAuthAdapter"] : []),
    ...(plan.needsWorker ? ["startGraphileWorker"] : []),
    ...(plan.needsStorage ? ["createS3Storage"] : []),
    ...(plan.needsAi ? ["createAiSdkModel"] : []),
  ].join(", ");
  const identity = plan.needsIdentity
    ? `
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
${sourceOfTruthBlock({ id: "starter.identity.authentication-adapter", keywords: "identity, authentication, better-auth, session", what: "Better Auth server adapter for authentication artifacts and session resolution.", why: "Authentication stays provider-owned while application identity and authorization remain separate.", when: "Compose the API authentication routes and request context.", how: "createBetterAuthAdapter", boundaries: "The adapter never grants application permissions from an authentication session alone." })}
export function createBetterAuthAdapter(input: { readonly secret: string; readonly baseURL: string; readonly database: Parameters<typeof drizzleAdapter>[0]; readonly schema: Record<string, unknown>; readonly onUserCreated: (authenticationSubjectId: string) => Promise<void> }) {
  const auth = betterAuth({
    secret: input.secret,
    baseURL: input.baseURL,
    emailAndPassword: { enabled: true },
    database: drizzleAdapter(input.database, { provider: "pg", schema: input.schema }),
    databaseHooks: { user: { create: { after: async (user) => input.onUserCreated(user.id) } } },
  });
  return {
    auth,
    handler: auth.handler,
    resolveSession: async (headers: Headers) => {
      const session = await auth.api.getSession({ headers });
      return session?.user?.id ? { subjectId: session.user.id } : null;
    },
  };
}
`
    : "";
  const jobs = plan.needsWorker
    ? `
import { run } from "graphile-worker";
export function startGraphileWorker(options: Parameters<typeof run>[0]) { return run(options); }
`
    : "";
  const storage = plan.needsStorage
    ? `
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
${sourceOfTruthBlock({ id: "starter.storage.s3-adapter", keywords: "storage, s3, metadata, ownership, signed-url", what: "S3-compatible object operations behind application metadata and access policy.", why: "Bucket access must remain replaceable and subject-owned.", when: "Compose storage for authenticated API use cases.", how: "createS3Storage", boundaries: "Never return an object URL before policy and metadata ownership checks pass." })}
export function createS3Storage(input: { readonly bucket: string; readonly region: string; readonly endpoint?: string; readonly accessKeyId?: string; readonly secretAccessKey?: string; readonly metadata: StorageMetadataStore; readonly policy?: StoragePolicy; readonly send?: (command: unknown) => Promise<unknown> }): ObjectStorage & { readonly checkReadiness: () => Promise<void> } {
  const client = new S3Client({ region: input.region, ...(input.endpoint ? { endpoint: input.endpoint, forcePathStyle: true } : {}), ...(input.accessKeyId && input.secretAccessKey ? { credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey } } : {}) });
  const send = input.send ?? (async (command: unknown) => client.send(command as never));
  const policy = input.policy ?? defaultStoragePolicy;
  return {
    checkReadiness: async () => { await send(new HeadBucketCommand({ Bucket: input.bucket })); },
    put: async (value) => {
      if (value.body.byteLength > policy.maximumBytes || !policy.authorize("put", value.key, value.subjectId)) throw new Error("Storage policy denied object write");
      const existing = await input.metadata.find(value.key);
      if (existing && existing.subjectId !== value.subjectId) throw new Error("Storage object ownership denied");
      await send(new PutObjectCommand({ Bucket: input.bucket, Key: value.key, ContentType: value.contentType, Body: value.body }));
      await input.metadata.record({ key: value.key, contentType: value.contentType, byteLength: value.body.byteLength, subjectId: value.subjectId });
    },
    getUrl: async (value) => {
      if (!policy.authorize("get", value.key, value.subjectId)) throw new Error("Storage policy denied object read");
      const metadata = await input.metadata.find(value.key);
      if (!metadata || metadata.subjectId !== value.subjectId) throw new Error("Storage object ownership denied");
      return getSignedUrl(client, new GetObjectCommand({ Bucket: input.bucket, Key: value.key }), { expiresIn: 900 });
    },
  };
}
`
    : "";
  const ai = plan.needsAi
    ? `
import { generateText, type LanguageModel } from "ai";
export function createAiSdkModel(model: LanguageModel) {
  return { generate: async (prompt: string) => { const result = await generateText({ model, prompt }); return { text: result.text, costUsd: 0 }; } };
}
`
    : "";
  const storageTypeImport = plan.needsStorage
    ? `import type { ObjectStorage, StorageMetadataStore, StoragePolicy } from "${packageName(config, "core")}";\nimport { defaultStoragePolicy } from "${packageName(config, "core")}";\n`
    : "";
  return textFile(
    "packages/adapters/src/index.ts",
    `${storageTypeImport}${providerOwners ? "" : 'export const packageId = "adapters" as const;\n'}
${identity}${jobs}${storage}${ai}
`,
  );
}

function baseFiles(config: InitConfig, plan: CapabilityPlan): GeneratedFile[] {
  const releasePackages = plan.testedPackages;
  const files: GeneratedFile[] = [
    jsonFile("package.json", {
      name: packageName(config, config.clientId),
      private: true,
      version: PACKAGE_VERSION,
      type: "module",
      packageManager: `pnpm@${PNPM_VERSION}`,
      engines: { node: "24.19.x" },
      scripts: {
        build: "turbo run build",
        "check:boundaries": "tsx tooling/governance/src/cli.ts check:boundaries",
        "check:implementation": "tsx tooling/governance/src/cli.ts check:implementation",
        ...(hasProfile(config, "python")
          ? { "check:python": "python3 -m compileall -q services/python/src" }
          : {}),
        "check:source-of-truth": "tsx tooling/governance/src/cli.ts check:source-of-truth",
        ...(plan.needsDatabase ? { "check:migrations": "tsx tooling/check-migrations.ts" } : {}),
        "release:check": "tsx tooling/release/check-release.ts",
        format: "biome format --write .",
        "format:check": "biome format .",
        "implementation:list": "tsx tooling/governance/src/cli.ts implementation:list",
        "implementation:new": "tsx tooling/governance/src/cli.ts implementation:new",
        "implementation:sync": "tsx tooling/governance/src/cli.ts implementation:sync",
        ...(hasProfile(config, "external-api") ? { "generate:api-client": "openapi-ts" } : {}),
        ...(hasProfile(config, "external-api")
          ? { "check:generated": "tsx tooling/check-generated.ts" }
          : {}),
        lint: "biome lint .",
        test: "vitest run --passWithNoTests",
        typecheck: "turbo run typecheck",
        check: `pnpm format:check && pnpm lint && pnpm release:check && pnpm check:source-of-truth && pnpm check:boundaries && pnpm check:implementation${plan.needsDatabase ? " && pnpm check:migrations" : ""}${plan.needsExternalApi ? " && pnpm check:generated" : ""}${hasProfile(config, "python") ? " && pnpm check:python" : ""} && pnpm typecheck && pnpm build && pnpm test`,
        "validate:starter": "pnpm check",
      },
      devDependencies: {
        "@biomejs/biome": DEPENDENCY_VERSIONS.biome,
        ...(hasProfile(config, "external-api")
          ? { "@hey-api/openapi-ts": DEPENDENCY_VERSIONS.openapiClient }
          : {}),
        "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
        tsx: DEPENDENCY_VERSIONS.tsx,
        turbo: DEPENDENCY_VERSIONS.turbo,
        typescript: DEPENDENCY_VERSIONS.typescript,
        vitest: DEPENDENCY_VERSIONS.vitest,
      },
    }),
    jsonFile("pnpm-workspace.yaml", {
      packages: ["packages/*", "apps/*"],
      ...(hasProfile(config, "external-api")
        ? { overrides: { "js-yaml": DEPENDENCY_VERSIONS.jsYaml } }
        : {}),
    }),
    jsonFile("tsconfig.json", {
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2023", "DOM"],
        strict: true,
        noEmit: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noImplicitOverride: true,
        noFallthroughCasesInSwitch: true,
        noImplicitReturns: true,
        useUnknownInCatchVariables: true,
        forceConsistentCasingInFileNames: true,
        isolatedModules: true,
        esModuleInterop: true,
        jsx: "react-jsx",
        types: ["node"],
        skipLibCheck: true,
      },
      include: ["packages/**/*.ts", "apps/**/*.ts", "apps/**/*.tsx"],
      exclude: ["node_modules", "dist"],
    }),
    jsonFile("turbo.json", {
      $schema: "https://turbo.build/schema.json",
      tasks: {
        build: { dependsOn: ["^build"], outputs: ["dist/**", ".next/**", "!**/.next/cache/**"] },
        typecheck: { dependsOn: ["^typecheck"] },
      },
    }),
    jsonFile("biome.jsonc", {
      $schema: "https://biomejs.dev/schemas/2.5.9/schema.json",
      files: {
        includes: [
          "**",
          "!!node_modules",
          "!!dist",
          "!!.next",
          "!!.turbo",
          "!!**/.turbo",
          "!!packages/api-client/src/generated",
        ],
      },
      formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
      linter: {
        enabled: true,
        rules: {
          preset: "recommended",
          correctness: { noUnusedImports: "error", noUnusedVariables: "error" },
          suspicious: { noExplicitAny: "error" },
        },
      },
    }),
    textFile(".nvmrc", `${NODE_VERSION}\n`),
    textFile(".npmrc", "save-exact=true\nprefer-frozen-lockfile=true\n"),
    textFile(".gitignore", "node_modules\ndist\n.next\n.turbo\n.env\n"),
    textFile(
      ".dockerignore",
      ".git\n.github\n.thaarei\n.turbo\nnode_modules\n**/node_modules\n**/dist\n**/.next\ncoverage\n*.log\n.env\n.env.*\n!.env.example\n",
    ),
    textFile(
      "README.md",
      `# ${config.displayName}\n\nGenerated from the Thaarei engineering starter. Profiles: ${config.profiles.join(", ") || "base"}. Deployment: ${config.deployment}.\n${hasProfile(config, "external-api") ? "\nThe generated API client package disables exactOptionalPropertyTypes only for generator-owned output. Do not edit generated client files by hand.\n" : ""}`,
    ),
    textFile(
      ".thaarei/work/INIT-001.md",
      `---\nworkId: INIT-001\ntitle: ${stringLiteral(`Initialize ${config.displayName}`)}\norigin: starter:init\nstatus: in_progress\nowner: ${stringLiteral(config.technicalOwner)}\ncreatedAt: 2026-08-19\nupdatedAt: 2026-08-19\nsourceOfTruthIds: []\naffectedPaths:\n  - apps/\n  - packages/\n  - deployment/\n---\n\n# Initialize ${config.displayName}\n\n## Objective\n\nValidate the generated repository and record environment-specific evidence.\n\n## Scope\n\nGenerated profiles and the selected deployment adapter.\n\n## Non-goals\n\nLive production deployment without separate approval and evidence.\n\n## Acceptance criteria\n\n- [ ] Local checks pass.\n- [ ] Selected deployment gates have evidence.\n\n## Validation\n\nPending.\n\n## Evidence\n\nGenerated by starter:init with profiles: ${config.profiles.join(", ") || "base"}.\n\n## Decisions\n\nDeployment target: ${config.deployment}.\n\n## Blockers\n\nLive deployment and native mobile gates require their target environments.\n\n## Handoff\n\n${config.technicalOwner} owns technical validation. ${config.operationsOwner} owns operational validation.\n\n## Completion\n\nIncomplete.\n`,
    ),
    textFile(
      "IMPLEMENTATION.md",
      `<!-- GENERATED FILE. Run \`pnpm implementation:sync\`. Do not edit. -->\n\n# Implementation Dashboard\n\nCanonical records: \`.thaarei/work/*.md\`.\n\n## INIT-001: Initialize ${config.displayName}\n\n- Status: in_progress\n- Owner: ${config.technicalOwner}\n- Updated: 2026-08-19\n- Paths: apps/, packages/, deployment/\n`,
    ),
    textFile(
      ".github/workflows/starter-validation.yml",
      `name: Starter validation\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n      - uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa\n        with:\n          version: ${PNPM_VERSION}\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version-file: .nvmrc\n          cache: pnpm\n      - run: pnpm install --frozen-lockfile --ignore-scripts\n      - run: pnpm audit --prod --audit-level high${hasProfile(config, "mobile") ? " --ignore GHSA-w3rx-r6r6-pgpr --ignore GHSA-5p2g-fcmc-qvqq" : ""}\n${hasProfile(config, "python") ? "      - run: docker build --file services/python/Dockerfile .\n" : ""}      - run: pnpm validate:starter\n`,
    ),
    jsonFile("starter-release.json", {
      $schema: "./tooling/release/starter-release.schema.json",
      schemaVersion: 1,
      release: `${PACKAGE_VERSION}-dev.1`,
      status: "prerelease",
      releasedAt: null,
      runtime: { node: NODE_VERSION, pnpm: PNPM_VERSION },
      approvedMajors: approvedMajors(releasePackages),
      testedPackages: releasePackages,
      containerImages: {
        node: {
          reference: "node:24.19.0-bookworm-slim",
          digest: "sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03",
        },
        ...(plan.needsDatabase
          ? {
              postgresql: {
                reference: "postgres:18.3-bookworm",
                digest: "sha256:80630f83606d8db77d30b3851b16a9f78be2d0d4dda6f7b82a1fdca5ebe3acba",
              },
            }
          : {}),
        ...(hasProfile(config, "python")
          ? {
              python: {
                reference: `python:${PYTHON_VERSION}-slim-bookworm`,
                digest: "sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b",
              },
            }
          : {}),
      },
      enabledProfiles: config.profiles,
      compatibilityEvidence: [
        {
          gate: "generated-fixture-validation",
          status: "pending",
          evidence: "Run pnpm check and record the result in INIT-001.",
        },
        {
          gate: "deployment-and-recovery",
          status: "blocked_external",
          evidence:
            "Requires a disposable selected deployment environment and restore/rollback proof.",
        },
        ...(hasProfile(config, "mobile") && hasProfile(config, "identity")
          ? [
              {
                gate: "better-auth-expo-native-build",
                status: "blocked_external" as const,
                evidence: "Requires iOS and Android development-build proof.",
              },
            ]
          : []),
      ],
    }),
    jsonFile("tooling/release/starter-release.schema.json", generatedReleaseSchema()),
    generatedReleaseChecker(),
    ...(hasProfile(config, "mobile")
      ? [
          jsonFile(".thaarei/security-waivers.json", {
            schemaVersion: 1,
            waivers: [
              {
                package: "image-size",
                advisories: ["GHSA-w3rx-r6r6-pgpr", "GHSA-5p2g-fcmc-qvqq"],
                severity: "high",
                path: "Expo and Metro build tooling",
                reason:
                  "The advisory's patched image-size 2.0.3 release is not published. Build inputs must be version-controlled project assets only.",
                reviewBy: "2026-09-19",
                removalCondition:
                  "Remove the waiver and rerun the fixture matrix when Expo supports a published patched image-size release.",
              },
            ],
          }),
        ]
      : []),
  ];
  const basePackages: Array<readonly [string, string, string]> = [
    ["foundation", "foundation", "Foundation primitives shared by every application."],
    ["core", "core", "Provider-neutral domain ports and policy boundaries."],
    ["contracts", "contracts", "Wire-safe request, response, and job contracts."],
    ["adapters", "adapters", "Provider implementations behind domain ports."],
    ...(plan.needsDatabase
      ? [["database", "database", "Persistence schema and repositories."] as const]
      : []),
    ["test-support", "test-support", "Small deterministic test helpers."],
  ];
  const needsApi = plan.needsApi;
  const needsApiClient = plan.needsApiClient;
  const needsDesignTokens = hasProfile(config, "web") || hasProfile(config, "mobile");
  if (needsApi) basePackages.push(["api", "api", "Reusable Fastify and tRPC transport contracts."]);
  if (needsApiClient)
    basePackages.push(["api-client", "api-client", "Generated client-facing API contracts."]);
  if (needsDesignTokens)
    basePackages.push(["design-tokens", "design-tokens", "Cross-platform design tokens."]);
  for (const [name, id, description] of basePackages) {
    if (name === "foundation") {
      files.push(packageManifest(config, name), packageTsconfig(name), foundationPackageFile());
    } else if (name === "core") {
      files.push(
        packageManifest(config, name, { [packageName(config, "foundation")]: "workspace:*" }),
        packageTsconfig(name),
        corePackageFile(plan),
        ...(plan.needsAi
          ? [
              textFile(
                "packages/core/tests/ai-policy.test.ts",
                `import { beforeEach, expect, test } from "vitest";
import { ToolRegistry, type AiExecutionContext } from "../src/index.js";

const schema = { parse: (value: unknown) => { if (typeof value !== "string") throw new Error("invalid input"); return value; } };
const evidence: string[] = [];
beforeEach(() => { evidence.length = 0; });
const context = (approved: boolean, budgetUsd = 1): AiExecutionContext => ({
  subjectId: "subject-1",
  budgetUsd,
  approvals: { isApproved: async () => approved },
  audit: { recordAudit: async (event) => { evidence.push(["audit", event.outcome].join(":")); } },
  telemetry: { recordTelemetry: async (event) => { evidence.push(["telemetry", event.outcome].join(":")); } },
});

test("high-risk AI execution fails closed until approved, then parses and audits output", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "echo", risk: "high", requiresApproval: true, maximumCostUsd: 0.25, input: schema, output: schema, authorize: async () => true, execute: async (input) => input });
  await expect(registry.execute("echo", "hello", context(false))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  await expect(registry.execute("echo", "hello", context(true))).resolves.toBe("hello");
  expect(evidence).toEqual(["audit:approval_required", "telemetry:approval_required", "audit:success", "telemetry:success"]);
});

test("AI execution records every denial and provider or schema failure", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "denied", risk: "low", requiresApproval: false, maximumCostUsd: 0.25, input: schema, output: schema, authorize: async () => false, execute: async (input) => input });
  await expect(registry.execute("denied", "hello", context(true))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const allowed = new ToolRegistry();
  allowed.register({ name: "allowed", risk: "low", requiresApproval: false, maximumCostUsd: 0.25, input: schema, output: schema, authorize: async () => true, execute: async (input) => input });
  await expect(allowed.execute("allowed", "hello", context(true, 0.1))).rejects.toMatchObject({ code: "COST_LIMIT" });
  await expect(allowed.execute("allowed", 123, context(true))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const invalidOutput = new ToolRegistry();
  invalidOutput.register({ name: "invalid-output", risk: "low", requiresApproval: false, maximumCostUsd: 0.25, input: schema, output: schema, authorize: async () => true, execute: async () => 123 as unknown as string });
  await expect(invalidOutput.execute("invalid-output", "hello", context(true))).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  const providerFailure = new ToolRegistry();
  providerFailure.register({ name: "provider", risk: "low", requiresApproval: false, maximumCostUsd: 0.25, input: schema, output: schema, authorize: async () => true, execute: async () => { throw new Error("offline"); } });
  await expect(providerFailure.execute("provider", "hello", context(true))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  expect(evidence.filter((entry) => entry.startsWith("audit:"))).toEqual(["audit:unauthorized", "audit:cost_limit", "audit:invalid_input", "audit:invalid_output", "audit:provider_error"]);
});
`,
              ),
            ]
          : []),
        ...(plan.needsWorker
          ? [
              textFile(
                "packages/core/tests/workflow.test.ts",
                `import { expect, test } from "vitest";
import { runIdempotentWorkflow, type WorkflowStore } from "../src/index.js";

function store(): WorkflowStore {
  const claims = new Map<string, { status: "running" | "complete"; token: string; expiresAt: Date }>();
  return {
    begin: async (key, token, now, expiresAt) => { const claim = claims.get(key); if (claim?.status === "complete" || (claim?.status === "running" && claim.expiresAt > now)) return false; claims.set(key, { status: "running", token, expiresAt }); return true; },
    complete: async (key, token) => { const claim = claims.get(key); if (claim?.token === token) claims.set(key, { ...claim, status: "complete" }); },
    fail: async (key, token) => { if (claims.get(key)?.token === token) claims.delete(key); },
  };
}

test("workflow suppresses duplicates and releases a failed claim for retry", async () => {
  const workflow = store();
  await expect(runIdempotentWorkflow(workflow, "request-1", async () => { throw new Error("retry"); })).rejects.toThrow("retry");
  await expect(runIdempotentWorkflow(workflow, "request-1", async () => undefined)).resolves.toBe("completed");
  await expect(runIdempotentWorkflow(workflow, "request-1", async () => undefined)).resolves.toBe("duplicate");
});

test("workflow rejects an active claim and takes over an expired crash lease", async () => {
  const workflow = store();
  const startedAt = new Date("2026-08-19T00:00:00.000Z");
  await expect(workflow.begin("crashed", "crashed-token", startedAt, new Date("2026-08-19T00:05:00.000Z"))).resolves.toBe(true);
  await expect(runIdempotentWorkflow(workflow, "crashed", async () => undefined, { now: () => new Date("2026-08-19T00:01:00.000Z") })).resolves.toBe("duplicate");
  await expect(runIdempotentWorkflow(workflow, "crashed", async () => undefined, { now: () => new Date("2026-08-19T00:06:00.000Z") })).resolves.toBe("completed");
});

test("an expired worker cannot complete or fail a replacement claim", async () => {
  const workflow = store();
  const startedAt = new Date("2026-08-19T00:00:00.000Z");
  const replacedAt = new Date("2026-08-19T00:06:00.000Z");
  const replacementExpiry = new Date("2026-08-19T00:11:00.000Z");

  await workflow.begin("stale-complete", "old-complete", startedAt, new Date("2026-08-19T00:05:00.000Z"));
  await workflow.begin("stale-complete", "replacement-complete", replacedAt, replacementExpiry);
  await workflow.complete("stale-complete", "old-complete");
  await expect(runIdempotentWorkflow(workflow, "stale-complete", async () => undefined, { now: () => new Date("2026-08-19T00:12:00.000Z"), claimToken: () => "third-complete" })).resolves.toBe("completed");

  await workflow.begin("stale-fail", "old-fail", startedAt, new Date("2026-08-19T00:05:00.000Z"));
  await workflow.begin("stale-fail", "replacement-fail", replacedAt, replacementExpiry);
  await workflow.fail("stale-fail", "old-fail");
  await expect(runIdempotentWorkflow(workflow, "stale-fail", async () => undefined, { now: () => new Date("2026-08-19T00:07:00.000Z"), claimToken: () => "third-fail" })).resolves.toBe("duplicate");
});
`,
              ),
            ]
          : []),
        ...(plan.needsStorage
          ? [
              textFile(
                "packages/core/tests/storage-policy.test.ts",
                `import { expect, test } from "vitest";
import { defaultStoragePolicy } from "../src/index.js";

test("storage policy rejects cross-subject, unsafe, anonymous, and oversized writes", () => {
  expect(defaultStoragePolicy.authorize("get", "subject-1/file.txt", "subject-1")).toBe(true);
  expect(defaultStoragePolicy.authorize("get", "subject-1/file.txt", "subject-2")).toBe(false);
  expect(defaultStoragePolicy.authorize("get", "../secret", "subject-1")).toBe(false);
  expect(defaultStoragePolicy.authorize("put", "tenant/file.txt", "")).toBe(false);
  expect(defaultStoragePolicy.maximumBytes).toBe(50 * 1024 * 1024);
});
`,
              ),
            ]
          : []),
      );
    } else if (name === "contracts") {
      files.push(
        packageManifest(
          config,
          name,
          needsApi || plan.needsWorker || plan.needsAi ? { zod: DEPENDENCY_VERSIONS.zod } : {},
        ),
        packageTsconfig(name),
        contractsPackageFile(plan),
      );
    } else if (name === "adapters") {
      const adapterDependencies: Record<string, string> = {
        [packageName(config, "core")]: "workspace:*",
      };
      if (plan.needsIdentity) adapterDependencies["better-auth"] = DEPENDENCY_VERSIONS.betterAuth;
      if (plan.needsWorker)
        adapterDependencies["graphile-worker"] = DEPENDENCY_VERSIONS.graphileWorker;
      if (plan.needsStorage) {
        adapterDependencies["@aws-sdk/client-s3"] = DEPENDENCY_VERSIONS.awsS3;
        adapterDependencies["@aws-sdk/s3-request-presigner"] = DEPENDENCY_VERSIONS.awsPresigner;
      }
      if (plan.needsAi) adapterDependencies.ai = DEPENDENCY_VERSIONS.ai;
      files.push(
        packageManifest(config, name, adapterDependencies),
        packageTsconfig(name),
        adaptersPackageFile(config, plan),
        ...(plan.needsStorage
          ? [
              textFile(
                "packages/adapters/tests/storage.test.ts",
                `import { expect, test } from "vitest";
import { createS3Storage } from "../src/index.js";

test("storage enforces ownership and propagates provider failures", async () => {
  const metadata = {
    record: async () => undefined,
    find: async () => ({ subjectId: "owner-1" }),
  };
  const failing = createS3Storage({ bucket: "test", region: "test", metadata, send: async () => { throw new Error("provider offline"); } });
  await expect(failing.put({ key: "owner-1/file.txt", contentType: "text/plain", body: new Uint8Array([1]), subjectId: "owner-1" })).rejects.toThrow("provider offline");
  const owned = createS3Storage({ bucket: "test", region: "test", metadata, send: async () => ({}) });
  await expect(owned.getUrl({ key: "owner-1/file.txt", subjectId: "other" })).rejects.toThrow("policy denied");
  let providerCalls = 0;
  const takeover = createS3Storage({ bucket: "test", region: "test", metadata, send: async () => { providerCalls += 1; return {}; } });
  await expect(takeover.put({ key: "owner-1/file.txt", contentType: "text/plain", body: new Uint8Array([1]), subjectId: "other" })).rejects.toThrow("policy denied");
  expect(providerCalls).toBe(0);
  const bounded = createS3Storage({ bucket: "test", region: "test", metadata, policy: { maximumBytes: 1, authorize: () => true }, send: async () => ({}) });
  await expect(bounded.put({ key: "owner-1/file.txt", contentType: "text/plain", body: new Uint8Array(2), subjectId: "owner-1" })).rejects.toThrow("policy denied");
});
`,
              ),
            ]
          : []),
      );
    } else if (name === "database") {
      files.push(
        packageManifest(config, name, {
          [packageName(config, "core")]: "workspace:*",
          "drizzle-orm": DEPENDENCY_VERSIONS.drizzle,
          postgres: DEPENDENCY_VERSIONS.postgres,
        }),
        packageTsconfig(name),
        databasePackageFile(config, plan),
        textFile(
          "packages/database/migrations/0000_starter.sql",
          `BEGIN;\n${[
            "CREATE TABLE starter_health (id text PRIMARY KEY);",
            ...(plan.needsIdentity
              ? [
                  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());',
                  'CREATE TABLE "session" (id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
                  'CREATE INDEX session_user_id_idx ON "session" (user_id);',
                  'CREATE TABLE "account" (id text PRIMARY KEY, issuer text NOT NULL, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (issuer, account_id));',
                  'CREATE INDEX account_user_id_idx ON "account" (user_id);',
                  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());',
                  'CREATE INDEX verification_identifier_idx ON "verification" (identifier);',
                  "CREATE TABLE application_users (id text PRIMARY KEY, authentication_subject_id text NOT NULL UNIQUE);",
                  "CREATE TABLE organizations (id text PRIMARY KEY, name text NOT NULL);",
                  "CREATE TABLE memberships (id text PRIMARY KEY, user_id text NOT NULL, organization_id text NOT NULL, role text NOT NULL);",
                  "CREATE TABLE permissions (id text PRIMARY KEY, membership_id text NOT NULL, permission text NOT NULL);",
                  "CREATE TABLE invitations (id text PRIMARY KEY, organization_id text NOT NULL, email text NOT NULL);",
                  "CREATE TABLE audit_events (id text PRIMARY KEY, subject_id text NOT NULL, action text NOT NULL);",
                ]
              : []),
            ...(plan.needsWorker
              ? [
                  "CREATE TABLE workflow_runs (idempotency_key text PRIMARY KEY, status text NOT NULL, claim_token text NOT NULL, claim_expires_at timestamptz NOT NULL);",
                ]
              : []),
            ...(plan.needsStorage
              ? [
                  "CREATE TABLE object_metadata (key text PRIMARY KEY, content_type text NOT NULL, byte_length integer NOT NULL, subject_id text NOT NULL);",
                ]
              : []),
            ...(plan.needsAi
              ? [
                  "CREATE TABLE ai_approvals (tool_name text NOT NULL, subject_id text NOT NULL, PRIMARY KEY (tool_name, subject_id));",
                  "CREATE TABLE ai_evaluations (id text PRIMARY KEY, name text NOT NULL, score integer NOT NULL, subject_id text NOT NULL);",
                  "CREATE TABLE ai_telemetry (id text PRIMARY KEY, tool_name text NOT NULL, subject_id text NOT NULL, cost_microusd integer NOT NULL, outcome text NOT NULL);",
                  "CREATE TABLE ai_audit_events (id text PRIMARY KEY, tool_name text NOT NULL, subject_id text NOT NULL, cost_microusd integer NOT NULL, outcome text NOT NULL);",
                ]
              : []),
          ].join("\n")}\nCOMMIT;\n`,
        ),
        ...(plan.needsAi
          ? [
              textFile(
                "packages/database/tests/ai-persistence.test.ts",
                `import { expect, test } from "vitest";
import { createInMemoryAiPersistence } from "../src/index.js";

test("AI approvals keep tool and subject identities collision-safe", async () => {
  const persistence = createInMemoryAiPersistence();
  await persistence.approve("a:b", "c");
  await expect(persistence.isApproved("a:b", "c")).resolves.toBe(true);
  await expect(persistence.isApproved("a", "b:c")).resolves.toBe(false);
  await persistence.recordEvaluation({ name: "quality", score: 0.9, subjectId: "c" });
  expect(persistence.evaluations()).toEqual([{ name: "quality", score: 0.9, subjectId: "c" }]);
});
`,
              ),
            ]
          : []),
      );
    } else if (name === "api") {
      const apiDependencies: Record<string, string> = {
        [packageName(config, "core")]: "workspace:*",
        [packageName(config, "contracts")]: "workspace:*",
        "@trpc/server": DEPENDENCY_VERSIONS.trpcServer,
        fastify: DEPENDENCY_VERSIONS.fastify,
        pino: DEPENDENCY_VERSIONS.pino,
        zod: DEPENDENCY_VERSIONS.zod,
      };
      if (plan.needsExternalApi) {
        apiDependencies["@fastify/swagger"] = DEPENDENCY_VERSIONS.fastifySwagger;
        apiDependencies["@fastify/swagger-ui"] = DEPENDENCY_VERSIONS.fastifySwaggerUi;
      }
      files.push(
        packageManifest(config, name, apiDependencies),
        packageTsconfig(name),
        apiPackageFile(config, plan),
        textFile(
          "packages/api/tests/authorization.test.ts",
          `import { expect, test } from "vitest";\nimport { appRouter, createContext } from "../src/index.js";\n\ntest("protected procedures reject anonymous callers", async () => {\n  const caller = appRouter.createCaller(createContext(null));\n  await expect(caller.viewer()).rejects.toMatchObject({ code: "UNAUTHORIZED" });\n});\n`,
        ),
        textFile(
          "packages/api/tests/runtime.test.ts",
          `import { expect, test } from "vitest";
import { buildApi${plan.needsIdentity ? ", registerAuthenticationRoutes" : ""}${plan.needsExternalApi ? ", EXTERNAL_HEALTH_PATH, registerExternalApi" : ""} } from "../src/index.js";

test("liveness stays local while failed dependencies make readiness unavailable", async () => {
  const server = buildApi({ readinessChecks: [{ name: "provider", check: async () => { throw new Error("provider unavailable"); } }] });
  const live = await server.inject({ method: "GET", url: "/health/live" });
  const ready = await server.inject({ method: "GET", url: "/health/ready" });
  expect(live.statusCode).toBe(200);
  expect(ready.statusCode).toBe(503);
  expect(ready.json()).toMatchObject({ status: "degraded", failedDependency: "provider" });
  await server.close();
});
${
  plan.needsIdentity
    ? `
test("HTTP request context resolves authenticated and anonymous sessions", async () => {
  const server = buildApi({ authentication: { resolveSession: async (headers) => headers.get("x-subject") ? { subjectId: headers.get("x-subject") as string } : null }, identity: { ensureAuthenticationSubject: async (subjectId) => ({ subjectId }), resolveAuthenticationSubject: async (subjectId) => ({ subjectId }) } });
  const anonymous = await server.inject({ method: "GET", url: "/trpc/viewer" });
  const authenticated = await server.inject({ method: "GET", url: "/trpc/viewer", headers: { "x-subject": "subject-1" } });
  expect(anonymous.statusCode).toBe(401);
  expect(authenticated.statusCode).toBe(200);
  expect(authenticated.body).toContain("subject-1");
  await server.close();
});

test("authentication routes forward Fastify JSON bodies and response cookies", async () => {
  const server = buildApi();
  let receivedBody: unknown;
  registerAuthenticationRoutes(server, "http://auth.example.test", async (request) => {
    receivedBody = await request.json();
    return new Response(JSON.stringify({ accepted: true }), {
      status: 201,
      headers: { "content-type": "application/json", "set-cookie": "session=test; HttpOnly; SameSite=Lax" },
    });
  });
  const response = await server.inject({ method: "POST", url: "/api/auth/sign-up/email", payload: { email: "local@example.test" } });
  expect(response.statusCode).toBe(201);
  expect(receivedBody).toEqual({ email: "local@example.test" });
  expect(String(response.headers["set-cookie"])).toContain("session=test");
  await server.close();
});
`
    : ""
}${
  plan.needsExternalApi
    ? `
test("external health route matches OpenAPI and uses RFC 9457 on dependency failure", async () => {
  const healthy = buildApi();
  await registerExternalApi(healthy);
  const ok = await healthy.inject({ method: "GET", url: EXTERNAL_HEALTH_PATH });
  expect(ok.statusCode).toBe(200);
  await healthy.close();

  const failed = buildApi();
  await registerExternalApi(failed, { readinessChecks: [{ name: "database", check: async () => { throw new Error("offline"); } }] });
  const unavailable = await failed.inject({ method: "GET", url: EXTERNAL_HEALTH_PATH });
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.headers["content-type"]).toContain("application/problem+json");
  expect(unavailable.json()).toMatchObject({ type: "about:blank", title: "Service Unavailable", status: 503 });
  await failed.close();
});
`
    : ""
}`,
        ),
        ...(plan.needsAi
          ? [
              textFile(
                "packages/api/tests/ai-runtime.test.ts",
                `import { expect, test } from "vitest";
import { buildApi } from "../src/index.js";

test("authenticated HTTP callers can execute the composed AI tool boundary", async () => {
  const server = buildApi({
    authentication: { resolveSession: async () => ({ subjectId: "auth-1" }) },
    identity: { ensureAuthenticationSubject: async () => ({ subjectId: "subject-1" }), resolveAuthenticationSubject: async () => ({ subjectId: "subject-1" }) },
    ai: { toolNames: ["starter.echo"], executeTool: async (_name, input) => input, recordEvaluation: async () => undefined },
  });
  const response = await server.inject({ method: "POST", url: "/trpc/aiExecute", headers: { "content-type": "application/json" }, payload: { toolName: "starter.echo", input: { message: "hello" } } });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain("hello");
  const callerBudget = await server.inject({ method: "POST", url: "/trpc/aiExecute", headers: { "content-type": "application/json" }, payload: { toolName: "starter.echo", input: { message: "hello" }, budgetUsd: 100 } });
  expect(callerBudget.statusCode).toBe(400);
  await server.close();
});
`,
              ),
            ]
          : []),
      );
    } else if (name === "api-client") {
      files.push(
        packageManifest(
          config,
          name,
          plan.needsExternalApi
            ? { "@hey-api/client-fetch": DEPENDENCY_VERSIONS.openapiFetch }
            : { "@trpc/client": DEPENDENCY_VERSIONS.trpcClient },
        ),
        apiClientTsconfig(),
        hasProfile(config, "external-api")
          ? textFile("packages/api-client/src/index.ts", `export * from "./generated/index.js";\n`)
          : placeholderPackageFile(id, description),
      );
    } else if (name === "test-support") {
      files.push(
        packageManifest(
          config,
          name,
          plan.needsExternalApi
            ? {
                [packageName(config, "api")]: "workspace:*",
                [packageName(config, "api-client")]: "workspace:*",
              }
            : {},
        ),
        packageTsconfig(name),
        placeholderPackageFile(id, description),
        ...(plan.needsExternalApi
          ? [
              textFile(
                "packages/test-support/tests/external-client.test.ts",
                `import { expect, test } from "vitest";
import { buildApi, registerExternalApi } from "${packageName(config, "api")}";
import { getHealth } from "${packageName(config, "api-client")}";

test("generated external client reaches the registered Fastify route", async () => {
  const server = buildApi();
  await registerExternalApi(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test address");
  const response = await getHealth({ baseUrl: \`http://127.0.0.1:\${address.port}\` });
  expect(response.response.status).toBe(200);
  expect(response.data).toMatchObject({ status: "ok" });
  await server.close();
});
`,
              ),
            ]
          : []),
      );
    } else {
      files.push(
        packageManifest(config, name),
        packageTsconfig(name),
        placeholderPackageFile(id, description),
      );
    }
  }
  return files;
}

function apiPackageFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const contractImports = [
    "healthResponseSchema",
    ...(plan.needsExternalApi ? ["problemDetailsSchema"] : []),
  ].join(", ");
  const coreTypes = [
    ...(plan.needsIdentity ? ["AuthenticationPort", "IdentityRepository"] : []),
    ...(plan.needsStorage ? ["ObjectStorage"] : []),
  ];
  const coreTypeImport =
    coreTypes.length > 0
      ? `import type { ${coreTypes.join(", ")} } from "${packageName(config, "core")}";\n`
      : "";
  const zodImport = plan.needsStorage || plan.needsAi ? `import { z } from "zod";\n` : "";
  const externalImports = plan.needsExternalApi
    ? `import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
`
    : "";
  const externalDocument = plan.needsExternalApi
    ? `
export const openApiDocument = ${JSON.stringify(externalOpenApiDocument(config))} as const;
export const EXTERNAL_HEALTH_PATH = ${stringLiteral(EXTERNAL_HEALTH_PATH)} as const;
export async function registerExternalApi(server: FastifyInstance, dependencies: ApiDependencies = {}): Promise<void> {
  await server.register(swagger, { openapi: openApiDocument as never });
  await server.register(swaggerUi, { routePrefix: "/documentation" });
  await server.register(async (external) => {
    external.setErrorHandler((error, _request, reply) => {
      const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
      const detail = error instanceof Error ? error.message : "request failed";
      return reply.code(status).type("application/problem+json").send(problemDetailsSchema.parse({ type: "about:blank", title: status >= 500 ? "Internal Server Error" : "Request Error", status, ...(status >= 500 ? {} : { detail }) }));
    });
    external.setNotFoundHandler((_request, reply) => reply.code(404).type("application/problem+json").send(problemDetailsSchema.parse({ type: "about:blank", title: "Not Found", status: 404 })));
    external.get(EXTERNAL_HEALTH_PATH, async (_request, reply) => {
      const checks = [
        ...(dependencies.database ? [{ name: "database", check: dependencies.database.checkReadiness }] : []),
        ...(dependencies.readinessChecks ?? []),
      ];
      const response = await readinessResponse(checks);
      if (response.status === "ok") return reply.code(200).send(response);
      return reply.code(503).type("application/problem+json").send(problemDetailsSchema.parse({ type: "about:blank", title: "Service Unavailable", status: 503, ...(response.detail ? { detail: response.detail } : {}) }));
    });
  });
}
`
    : "";
  return textFile(
    "packages/api/src/index.ts",
    `import Fastify, { ${plan.needsIdentity || plan.needsExternalApi ? "type FastifyInstance, " : ""}type FastifyRequest } from "fastify";
import { initTRPC, TRPCError } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { ${contractImports} } from "${packageName(config, "contracts")}";
${coreTypeImport}${zodImport}
${externalImports}

export interface AiRuntime {
  readonly toolNames: readonly string[];
  executeTool(name: string, input: unknown, subjectId: string): Promise<unknown>;
  recordEvaluation(name: string, score: number, subjectId: string): Promise<void>;
}
export interface RequestContext { readonly subjectId: string | null;${plan.needsStorage ? " readonly storage?: ObjectStorage;" : ""}${plan.needsAi ? " readonly ai?: AiRuntime;" : ""} }
export interface ApiDependencies {
${plan.needsIdentity ? "  readonly authentication?: AuthenticationPort;\n" : ""}
${plan.needsIdentity ? "  readonly identity?: IdentityRepository;\n" : ""}
  readonly database?: { readonly checkReadiness: () => Promise<void> };
${plan.needsStorage ? "  readonly storage?: ObjectStorage;\n" : ""}
${plan.needsAi ? "  readonly ai?: AiRuntime;\n" : ""}
  readonly readinessChecks?: readonly { readonly name: string; readonly check: () => Promise<void> }[];
}
export function createContext(subjectId: string | null${plan.needsStorage ? ", storage?: ObjectStorage" : ""}${plan.needsAi ? ", ai?: AiRuntime" : ""}): RequestContext { return { subjectId${plan.needsStorage ? ", ...(storage ? { storage } : {})" : ""}${plan.needsAi ? ", ...(ai ? { ai } : {})" : ""} }; }
${
  plan.needsIdentity
    ? `
function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(","));
  }
  return headers;
}

export function registerAuthenticationRoutes(server: FastifyInstance, baseURL: string, handler: (request: Request) => Promise<Response>): void {
  server.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const headers = toHeaders(request);
      headers.delete("content-length");
      const authRequest = new Request(new URL(request.url, baseURL), {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const response = await handler(authRequest);
      for (const [name, value] of response.headers) {
        if (name !== "set-cookie") reply.header(name, value);
      }
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);
      reply.code(response.status);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
`
    : ""
}
export async function resolveContext(${plan.needsIdentity ? "request" : "_request"}: FastifyRequest, ${plan.needsIdentity || plan.needsStorage || plan.needsAi ? "dependencies" : "_dependencies"}: ApiDependencies): Promise<RequestContext> {
  ${plan.needsIdentity ? "const session = await dependencies.authentication?.resolveSession(toHeaders(request));\n  const applicationSubject = session ? await dependencies.identity?.resolveAuthenticationSubject(session.subjectId) : null;\n  " : ""}return createContext(${plan.needsIdentity ? "applicationSubject?.subjectId ?? null" : "null"}${plan.needsStorage ? ", dependencies.storage" : ""}${plan.needsAi ? ", dependencies.ai" : ""});
}

const t = initTRPC.context<RequestContext>().create();
export const publicProcedure = t.procedure;
export const authenticatedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.subjectId === null) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, subjectId: ctx.subjectId } });
});
${sourceOfTruthBlock({ id: "starter.api.transport", keywords: "api, fastify, trpc, health, readiness", what: "Thin Fastify and tRPC transport composition root.", why: "Separates request handling from domain and provider code.", when: "Use for first-party API routes and health probes.", how: "buildApi, appRouter", boundaries: "Do not place SQL, authorization policy, or provider SDK calls here." })}
export const appRouter = t.router({
  health: publicProcedure.query(() => healthResponseSchema.parse({ status: "ok", checkedAt: new Date().toISOString() })),
  viewer: authenticatedProcedure.query(({ ctx }) => ({ subjectId: ctx.subjectId })),
${
  plan.needsStorage
    ? `  storageUrl: authenticatedProcedure.input(z.object({ key: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    if (!ctx.storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured" });
    return { url: await ctx.storage.getUrl({ key: input.key, subjectId: ctx.subjectId }) };
  }),
`
    : ""
}${
  plan.needsAi
    ? `  aiCapabilities: authenticatedProcedure.query(({ ctx }) => {
    if (!ctx.ai) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI runtime is not configured" });
    return { toolNames: ctx.ai.toolNames };
  }),
  aiExecute: authenticatedProcedure.input(z.object({ toolName: z.string().min(1), input: z.unknown() }).strict()).mutation(async ({ ctx, input }) => {
    if (!ctx.ai) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI runtime is not configured" });
    return { output: await ctx.ai.executeTool(input.toolName, input.input, ctx.subjectId) };
  }),
  aiRecordEvaluation: authenticatedProcedure.input(z.object({ name: z.string().min(1), score: z.number().min(0).max(1) })).mutation(async ({ ctx, input }) => {
    if (!ctx.ai) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI runtime is not configured" });
    await ctx.ai.recordEvaluation(input.name, input.score, ctx.subjectId);
    return { recorded: true };
  }),
`
    : ""
}});
export type AppRouter = typeof appRouter;

async function readinessResponse(checks: readonly { readonly name: string; readonly check: () => Promise<void> }[]) {
  const checkedAt = new Date().toISOString();
  for (const check of checks) {
    try { await check.check(); } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "dependency check failed";
      return healthResponseSchema.parse({ status: "degraded", checkedAt, detail, failedDependency: check.name });
    }
  }
  return healthResponseSchema.parse({ status: "ok", checkedAt });
}

export function buildApi(dependencies: ApiDependencies = {}) {
  const server = Fastify({ logger: true });
  server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext: ({ req }: { readonly req: FastifyRequest }) => resolveContext(req, dependencies) },
  });
  server.get("/health/live", async () => healthResponseSchema.parse({ status: "ok", checkedAt: new Date().toISOString() }));
  server.get("/health/ready", async (_request, reply) => {
    const checks = [
      ...(dependencies.database ? [{ name: "database", check: dependencies.database.checkReadiness }] : []),
      ...(dependencies.readinessChecks ?? []),
    ];
    const response = await readinessResponse(checks);
    return reply.code(response.status === "ok" ? 200 : 503).send(response);
  });
  return server;
}
${externalDocument}
`,
  );
}

function apiFiles(config: InitConfig): GeneratedFile[] {
  const plan = createCapabilityPlan(config);
  const imports = [
    `import { buildApi${plan.needsIdentity ? ", registerAuthenticationRoutes" : ""}${plan.needsExternalApi ? ", registerExternalApi" : ""} } from "${packageName(config, "api")}";`,
    ...(plan.needsAi ? [`import { ToolRegistry } from "${packageName(config, "core")}";`] : []),
    ...(plan.needsDatabase
      ? [`import { createDatabaseRuntime } from "${packageName(config, "database")}";`]
      : []),
    ...(plan.needsIdentity
      ? [`import { createBetterAuthAdapter } from "${packageName(config, "adapters")}";`]
      : []),
    ...(plan.needsStorage
      ? [`import { createS3Storage } from "${packageName(config, "adapters")}";`]
      : []),
  ].join("\n");
  const setup = [
    ...(plan.needsDatabase
      ? ["  const database = createDatabaseRuntime(environment.DATABASE_URL);"]
      : []),
    ...(plan.needsIdentity
      ? [
          `  const authentication = createBetterAuthAdapter({ secret: environment.BETTER_AUTH_SECRET, baseURL: environment.BETTER_AUTH_URL, database: database.authentication.database, schema: database.authentication.schema, onUserCreated: async (authenticationSubjectId) => { await database.identity.ensureAuthenticationSubject(authenticationSubjectId); } });`,
          "  const identity = database.identity;",
        ]
      : []),
    ...(plan.needsStorage
      ? [
          `  const storage = createS3Storage({ bucket: environment.STORAGE_BUCKET, region: environment.STORAGE_REGION, ...(environment.STORAGE_ENDPOINT ? { endpoint: environment.STORAGE_ENDPOINT } : {}), ...(environment.STORAGE_ACCESS_KEY_ID && environment.STORAGE_SECRET_ACCESS_KEY ? { accessKeyId: environment.STORAGE_ACCESS_KEY_ID, secretAccessKey: environment.STORAGE_SECRET_ACCESS_KEY } : {}), metadata: database.metadata });`,
        ]
      : []),
    ...(plan.needsAi
      ? [
          "  const tools = new ToolRegistry();",
          `  const recordSchema = { parse: (value: unknown) => z.record(z.string(), z.unknown()).parse(value) };
  tools.register({ name: "starter.echo", risk: "low", requiresApproval: false, maximumCostUsd: 0.001, input: recordSchema, output: recordSchema, authorize: async (_input, subjectId) => subjectId.length > 0, execute: async (input) => input });`,
          "  const ai = { toolNames: tools.names(), executeTool: async (name: string, input: unknown, subjectId: string) => tools.execute(name, input, { subjectId, budgetUsd: environment.AI_MAX_TOOL_BUDGET_USD, approvals: database.ai, audit: database.ai, telemetry: database.ai }), recordEvaluation: async (name: string, score: number, subjectId: string) => database.ai.recordEvaluation({ name, score, subjectId }) };",
        ]
      : []),
    `  const server = buildApi({ ${[
      ...(plan.needsDatabase ? ["database"] : []),
      ...(plan.needsIdentity ? ["authentication"] : []),
      ...(plan.needsIdentity ? ["identity"] : []),
      ...(plan.needsStorage ? ["storage"] : []),
      ...(plan.needsAi ? ["ai"] : []),
    ]
      .map((name) => `${name},`)
      .join(" ")}${
      plan.needsStorage
        ? ` readinessChecks: [${[
            ...(plan.needsStorage ? ['{ name: "storage", check: storage.checkReadiness }'] : []),
          ].join(", ")}],`
        : ""
    } });`,
    ...(plan.needsIdentity
      ? [
          "  registerAuthenticationRoutes(server, environment.BETTER_AUTH_URL, authentication.handler);",
        ]
      : []),
    ...(plan.needsExternalApi
      ? [
          `  await registerExternalApi(server, { ${plan.needsDatabase ? "database," : ""} ${plan.needsStorage ? 'readinessChecks: [{ name: "storage", check: storage.checkReadiness }],' : ""} });`,
        ]
      : []),
  ].join("\n");
  const environmentSchema = [
    "const environmentSchema = z.object({",
    "  PORT: z.coerce.number().int().min(1).max(65535).default(3000),",
    ...(plan.needsDatabase ? ["  DATABASE_URL: z.string().min(1),"] : []),
    ...(plan.needsIdentity
      ? ["  BETTER_AUTH_SECRET: z.string().min(1),", "  BETTER_AUTH_URL: z.string().url(),"]
      : []),
    ...(plan.needsAi
      ? ["  AI_MAX_TOOL_BUDGET_USD: z.coerce.number().positive().finite().max(100).default(1),"]
      : []),
    ...(plan.needsStorage
      ? [
          "  STORAGE_BUCKET: z.string().min(1),",
          "  STORAGE_REGION: z.string().min(1),",
          "  STORAGE_ENDPOINT: z.string().url().optional(),",
          "  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),",
          "  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),",
        ]
      : []),
    plan.needsStorage
      ? `}).superRefine((value, context) => {
  if (Boolean(value.STORAGE_ACCESS_KEY_ID) !== Boolean(value.STORAGE_SECRET_ACCESS_KEY)) {
    context.addIssue({ code: "custom", message: "storage access key and secret must be supplied together" });
  }
});`
      : "});",
    "const environment = environmentSchema.parse(process.env);",
  ].join("\n");
  return [
    appManifest(config, "api", {
      [packageName(config, "api")]: "workspace:*",
      ...(plan.needsAi ? { [packageName(config, "core")]: "workspace:*" } : {}),
      ...(plan.needsAdapters ? { [packageName(config, "adapters")]: "workspace:*" } : {}),
      ...(plan.needsDatabase ? { [packageName(config, "database")]: "workspace:*" } : {}),
      zod: DEPENDENCY_VERSIONS.zod,
    }),
    appTsconfig("api"),
    textFile(
      "apps/api/src/index.ts",
      `${imports}
import { z } from "zod";

${environmentSchema}
export async function startApi(): Promise<void> {
${setup}
  await server.listen({ host: "0.0.0.0", port: environment.PORT });
}

await startApi();
`,
    ),
    textFile(
      "apps/api/Dockerfile",
      `FROM ${NODE_IMAGE}
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter ${packageName(config, "api-app")}... build
CMD ["pnpm", "--filter", "${packageName(config, "api-app")}", "start"]
`,
    ),
  ];
}

function workerFiles(config: InitConfig): GeneratedFile[] {
  const adaptersPackage = packageName(config, "adapters");
  const contractsPackage = packageName(config, "contracts");
  const corePackage = packageName(config, "core");
  const databasePackage = packageName(config, "database");
  return [
    appManifest(config, "worker", {
      [adaptersPackage]: "workspace:*",
      [contractsPackage]: "workspace:*",
      [corePackage]: "workspace:*",
      [databasePackage]: "workspace:*",
      zod: DEPENDENCY_VERSIONS.zod,
    }),
    appTsconfig("worker"),
    textFile(
      "apps/worker/src/index.ts",
      `import { createServer } from "node:http";
import { startGraphileWorker } from "${adaptersPackage}";
import { jobPayloadSchema } from "${contractsPackage}";
import { runIdempotentWorkflow } from "${corePackage}";
import { createDatabaseRuntime } from "${databasePackage}";
import { z } from "zod";

const environment = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
}).parse(process.env);
export async function startWorker(): Promise<void> {
  const database = createDatabaseRuntime(environment.DATABASE_URL);
  const runner = await startGraphileWorker({
    connectionString: environment.DATABASE_URL,
    concurrency: environment.WORKER_CONCURRENCY,
    taskList: {
      "starter.health": async (payload) => {
        const parsed = jobPayloadSchema.parse(payload);
        await runIdempotentWorkflow(database.workflow, parsed.requestId, async () => undefined);
      },
    },
  });
  const healthServer = createServer(async (request, response) => {
    if (request.url !== "/health/ready") { response.writeHead(404).end(); return; }
    try { await database.checkReadiness(); response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", checkedAt: new Date().toISOString() })); }
    catch { response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "degraded", checkedAt: new Date().toISOString() })); }
  });
  healthServer.listen(environment.PORT, "0.0.0.0");
  try { await runner.promise; } finally { healthServer.close(); await database.close(); }
}

await startWorker();
`,
    ),
    textFile(
      "apps/worker/Dockerfile",
      `FROM ${NODE_IMAGE}
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter ${packageName(config, "worker-app")}... build
CMD ["pnpm", "--filter", "${packageName(config, "worker-app")}", "start"]
`,
    ),
  ];
}

function webFiles(config: InitConfig): GeneratedFile[] {
  return [
    jsonFile("apps/web/package.json", {
      name: packageName(config, "web-app"),
      private: true,
      version: PACKAGE_VERSION,
      scripts: { build: "next build", start: "next start", typecheck: "tsc --noEmit" },
      dependencies: {
        "@base-ui/react": DEPENDENCY_VERSIONS.baseUi,
        "@tanstack/react-form": DEPENDENCY_VERSIONS.tanstackForm,
        "@tanstack/react-query": DEPENDENCY_VERSIONS.tanstackQuery,
        next: DEPENDENCY_VERSIONS.next,
        react: DEPENDENCY_VERSIONS.react,
        "react-dom": DEPENDENCY_VERSIONS.react,
        tailwindcss: DEPENDENCY_VERSIONS.tailwind,
      },
      devDependencies: {
        "@tailwindcss/postcss": DEPENDENCY_VERSIONS.tailwindPostcss,
        "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
        "@types/react": DEPENDENCY_VERSIONS.reactTypes,
        "@types/react-dom": DEPENDENCY_VERSIONS.reactDomTypes,
        typescript: DEPENDENCY_VERSIONS.typescript,
      },
    }),
    jsonFile("apps/web/tsconfig.json", {
      extends: "../../tsconfig.json",
      compilerOptions: { noEmit: true, plugins: [{ name: "next" }] },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    }),
    jsonFile("apps/web/components.json", {
      $schema: "https://ui.shadcn.com/schema.json",
      style: "new-york",
      rsc: true,
      tsx: true,
      tailwind: { css: "app/globals.css", baseColor: "neutral", cssVariables: true },
      iconLibrary: "lucide",
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
      registries: { "@basecn": "https://basecn.dev/r/{name}.json" },
    }),
    textFile(
      "apps/web/postcss.config.mjs",
      `export default { plugins: { "@tailwindcss/postcss": {} } };\n`,
    ),
    textFile("apps/web/global.d.ts", `declare module "*.css";\n`),
    textFile("apps/web/app/globals.css", `@import "tailwindcss";\n`),
    textFile(
      "apps/web/app/layout.tsx",
      `import "./globals.css";\n\nexport default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }\n`,
    ),
    textFile(
      "apps/web/app/page.tsx",
      `export default function Page() {\n  return <main><h1>{${stringLiteral(config.displayName)}}</h1><p>Thaarei web profile</p></main>;\n}\n`,
    ),
    textFile(
      "apps/web/Dockerfile",
      `FROM ${NODE_IMAGE}\nWORKDIR /app\nCOPY . .\nRUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts\nRUN pnpm --filter ${packageName(config, "web-app")}... build\nCMD ["pnpm", "--filter", "${packageName(config, "web-app")}", "start"]\n`,
    ),
  ];
}

function mobileFiles(config: InitConfig): GeneratedFile[] {
  const settings = config.mobile;
  if (!settings) throw new Error("Internal error: mobile settings are missing");
  return [
    jsonFile("apps/mobile/package.json", {
      name: packageName(config, "mobile-app"),
      private: true,
      version: PACKAGE_VERSION,
      main: "expo-router/entry",
      scripts: {
        build: "expo export --platform ios && expo export --platform android",
        start: "expo start",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        expo: DEPENDENCY_VERSIONS.expo,
        "expo-notifications": DEPENDENCY_VERSIONS.notifications,
        "expo-router": DEPENDENCY_VERSIONS.expoRouter,
        "expo-secure-store": DEPENDENCY_VERSIONS.secureStore,
        react: DEPENDENCY_VERSIONS.react,
        "react-native": DEPENDENCY_VERSIONS.reactNative,
        "react-native-gesture-handler": DEPENDENCY_VERSIONS.gestureHandler,
        "react-native-reanimated": DEPENDENCY_VERSIONS.reanimated,
        "react-native-unistyles": DEPENDENCY_VERSIONS.unistyles,
      },
      devDependencies: {
        "@types/react": DEPENDENCY_VERSIONS.reactTypes,
        typescript: DEPENDENCY_VERSIONS.typescript,
      },
    }),
    jsonFile("apps/mobile/tsconfig.json", {
      extends: "expo/tsconfig.base",
      compilerOptions: {
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
      },
      include: ["app", "expo-env.d.ts"],
    }),
    jsonFile("apps/mobile/app.json", {
      expo: {
        name: config.displayName,
        slug: config.clientId,
        scheme: settings.scheme,
        plugins: ["expo-router", "expo-secure-store", "expo-notifications"],
        ios: { bundleIdentifier: settings.iosBundleId },
        android: { package: settings.androidApplicationId },
      },
    }),
    textFile(
      "apps/mobile/app/_layout.tsx",
      `import { Stack } from "expo-router";\n\nexport default function RootLayout() { return <Stack />; }\n`,
    ),
    textFile(
      "apps/mobile/app/index.tsx",
      `import { Text, View } from "react-native";\nimport { GestureHandlerRootView } from "react-native-gesture-handler";\n\nexport default function Index() {\n  return <GestureHandlerRootView><View><Text>{${stringLiteral(config.displayName)}}</Text></View></GestureHandlerRootView>;\n}\n`,
    ),
  ];
}

function pythonFiles(): GeneratedFile[] {
  return [
    textFile(
      "services/python/pyproject.toml",
      `[project]\nname = "thaarei-python-service"\nversion = "${PACKAGE_VERSION}"\nrequires-python = ">=${PYTHON_VERSION},<3.13"\ndependencies = []\n\n[build-system]\nrequires = ["setuptools>=75"]\nbuild-backend = "setuptools.build_meta"\n`,
    ),
    textFile("services/python/src/__init__.py", ""),
    textFile(
      "services/python/src/main.py",
      `"""Optional Python service boundary; keep it isolated from TypeScript packages."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def health() -> dict[str, str]:
    return {"status": "ok"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health/ready":
            self.send_response(404)
            self.end_headers()
            return
        payload = json.dumps(health()).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
`,
    ),
    textFile(
      "services/python/README.md",
      "Use Python only for requirements that cannot be met cleanly in TypeScript. Keep the interface explicit and versioned.\n",
    ),
    textFile(
      "services/python/Dockerfile",
      `FROM ${PYTHON_IMAGE}\nWORKDIR /app\nCOPY services/python .\nRUN python -m compileall -q src\nEXPOSE 8000\nCMD ["python", "-m", "src.main"]\n`,
    ),
  ];
}

function environmentFile(config: InitConfig): GeneratedFile {
  const plan = createCapabilityPlan(config);
  const lines = [
    "NODE_ENV=development",
    "PORT=3000",
    ...(plan.needsDatabase ? ["DATABASE_URL="] : []),
    ...(plan.needsIdentity ? ["BETTER_AUTH_SECRET=", "BETTER_AUTH_URL="] : []),
    ...(plan.needsAi ? ["AI_MAX_TOOL_BUDGET_USD=1"] : []),
    ...(plan.needsWorker ? ["WORKER_CONCURRENCY=2"] : []),
    ...(hasProfile(config, "external-api") ? ["EXTERNAL_API_BASE_URL="] : []),
    ...(plan.needsStorage
      ? [
          "STORAGE_BUCKET=",
          "STORAGE_REGION=",
          "STORAGE_ENDPOINT=",
          "STORAGE_ACCESS_KEY_ID=",
          "STORAGE_SECRET_ACCESS_KEY=",
        ]
      : []),
    ...(hasProfile(config, "python") ? ["PYTHON_SERVICE_URL="] : []),
  ];
  return textFile(".env.example", `${lines.join("\n")}\n`);
}

function deploymentFiles(config: InitConfig): GeneratedFile[] {
  const plan = createCapabilityPlan(config);
  const deployableApps = plan.deployableApps;
  const variablesFor = (name: string): readonly string[] => [
    "NODE_ENV",
    "PORT",
    ...((name === "api" || name === "worker") && plan.needsDatabase ? ["DATABASE_URL"] : []),
    ...(name === "api" && plan.needsIdentity ? ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] : []),
    ...(name === "api" && plan.needsAi ? ["AI_MAX_TOOL_BUDGET_USD"] : []),
    ...(name === "api" && plan.needsStorage
      ? [
          "STORAGE_BUCKET",
          "STORAGE_REGION",
          "STORAGE_ENDPOINT",
          "STORAGE_ACCESS_KEY_ID",
          "STORAGE_SECRET_ACCESS_KEY",
        ]
      : []),
    ...(name === "worker" ? ["WORKER_CONCURRENCY"] : []),
    ...(name !== "python" && hasProfile(config, "python") ? ["PYTHON_SERVICE_URL"] : []),
  ];
  const services = deployableApps.map((name) => ({
    name,
    source: name === "python" ? "services/python" : `apps/${name}`,
    dockerfile: name === "python" ? "services/python/Dockerfile" : `apps/${name}/Dockerfile`,
    healthCheck: { type: "http", path: name === "web" ? "/" : "/health/ready" },
    variables: variablesFor(name),
  }));
  const database = { provider: "managed-postgresql", variable: "DATABASE_URL" };
  if (config.deployment === "dokploy") {
    return [
      jsonFile("deployment/dokploy/services.json", {
        controlPlane: "dokploy",
        repository: { branch: "main", autoDeployTrigger: "push-to-selected-branch" },
        services: services.map((service) => ({
          ...service,
          applicationMode: "dockerfile",
          imagePromotion: "registry-digest-required",
          domain: {
            required: service.name === "web" || service.name === "api",
            provider: "dokploy-traefik",
          },
        })),
        ...(plan.needsDatabase
          ? {
              database,
              backup: {
                required: true,
                provider: "s3",
                restoreTestRequired: true,
              },
            }
          : {}),
      }),
      textFile(
        "deployment/dokploy/README.md",
        "# Dokploy runbook\n\nCreate one Dokploy application per listed service. Configure the recorded branch and enable auto-deploy only for pushes to that branch. Build and promote registry images by digest, configure native domains and Traefik routing, then verify each health path. Use Dokploy-managed PostgreSQL when listed. Compose is reserved for a genuinely coupled dependency. Record the deployed digest and terminal deployment result in the active work item.\n",
      ),
      textFile(
        "deployment/dokploy/rollback.md",
        "# Rollback\n\nFor an application, select the last verified registry-backed image in Dokploy and redeploy it. Verify readiness and the expected digest after rollback. Compose rollback is manual: restore the previously recorded image digests and redeploy each service.\n",
      ),
      ...(plan.needsDatabase
        ? [
            textFile(
              "deployment/dokploy/backup-restore.md",
              "# Database backup and restore\n\nConfigure encrypted S3 backups for the Dokploy-managed PostgreSQL database. On a disposable environment, create a marker record, run a backup, restore it into a separate database, verify the marker and application readiness, and record timestamps and object identifiers in the active work item.\n",
            ),
            textFile(
              "deployment/dokploy/credential-rotation.md",
              "# Credential rotation\n\nCreate the replacement secret, update Dokploy variables without logging the value, redeploy affected applications, verify readiness, revoke the prior secret, and record only the secret identifier and verification result.\n",
            ),
          ]
        : []),
    ];
  }
  return [
    jsonFile("deployment/railway/services.json", {
      controlPlane: "railway",
      services: services.map((service) => ({
        ...service,
        buildCommand:
          service.name === "python"
            ? "python3 -m compileall -q services/python/src"
            : `pnpm install --frozen-lockfile --ignore-scripts && pnpm --filter ${packageName(config, `${service.name}-app`)}... build`,
        startCommand:
          service.name === "python"
            ? "cd services/python && python3 -m src.main"
            : `pnpm --filter ${packageName(config, `${service.name}-app`)} start`,
        watchPaths:
          service.name === "python"
            ? ["/services/python/**"]
            : [`/apps/${service.name}/**`, "/packages/**"],
      })),
      ...(plan.needsDatabase ? { database } : {}),
    }),
    textFile(
      "deployment/railway/README.md",
      "# Railway runbook\n\nCreate one Railway service per listed application and copy its build command, start command, watch paths, variables, and health path. Provision managed PostgreSQL only when listed. Railway maps Compose services to separate Railway services; do not treat a production Compose file as the deployment unit. After a repository push, verify each service reaches terminal SUCCESS status and record the deployed commit separately from health evidence.\n",
    ),
    ...(plan.needsDatabase
      ? [
          textFile(
            "deployment/railway/backup-restore.md",
            "# Database recovery\n\nUse the approved managed PostgreSQL backup mechanism. Prove restore on a disposable service, verify a marker record and application readiness, and record the terminal deployment and recovery evidence separately.\n",
          ),
          textFile(
            "deployment/railway/credential-rotation.md",
            "# Credential rotation\n\nCreate the replacement variable, update affected Railway services without logging its value, redeploy, verify terminal SUCCESS and readiness, then revoke the prior credential.\n",
          ),
        ]
      : []),
  ];
}

function generatedMarker(config: InitConfig, files: readonly GeneratedFile[]): GeneratedFile {
  return jsonFile(".thaarei/starter-init.json", {
    schemaVersion: 1,
    initializedAt: "deterministic",
    productId: config.productId,
    clientId: config.clientId,
    displayName: config.displayName,
    packageScope: config.packageScope,
    profiles: config.profiles,
    deployment: config.deployment,
    owners: { technical: config.technicalOwner, operations: config.operationsOwner },
    generatedFiles: files.map((file) => file.path).sort(),
  });
}

function relativeFilePath(path: string): string {
  const normalized = normalize(path);
  if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${join("", "/")}`))
    throw new Error(`Generated path escapes output directory: ${path}`);
  return normalized;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function generateProject(config: InitConfig): GenerationResult {
  const plan = createCapabilityPlan(config);
  const files = baseFiles(config, plan);
  if (plan.needsApi) files.push(...apiFiles(config));
  if (plan.needsExternalApi) {
    files.push(
      jsonFile("openapi-ts.config.json", {
        input: "./openapi.json",
        output: "./packages/api-client/src/generated",
        plugins: ["@hey-api/client-fetch"],
      }),
      jsonFile("openapi.json", externalOpenApiDocument(config)),
    );
  }
  if (plan.needsWorker) files.push(...workerFiles(config));
  if (hasProfile(config, "web")) files.push(...webFiles(config));
  if (hasProfile(config, "mobile")) files.push(...mobileFiles(config));
  if (hasProfile(config, "python")) files.push(...pythonFiles());
  files.push(environmentFile(config), ...deploymentFiles(config));
  const unique = new Map<string, GeneratedFile>();
  for (const file of files) {
    const path = relativeFilePath(file.path);
    if (unique.has(path)) throw new Error(`Generator produced duplicate path: ${path}`);
    unique.set(path, { path, content: file.content });
  }
  const withoutMarker = [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  unique.set(".thaarei/starter-init.json", generatedMarker(config, withoutMarker));
  const finalFiles = [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return { config, files: finalFiles };
}

export async function writeGeneratedProject(result: GenerationResult): Promise<WriteResult> {
  const outputDir = resolve(result.config.outputDir);
  const markerPath = join(outputDir, ".thaarei", "starter-init.json");
  try {
    await stat(markerPath);
    throw new Error(`Output directory is already initialized: ${outputDir}`);
  } catch (error: unknown) {
    if (!isMissingPath(error)) throw error;
  }
  const plannedFiles = result.files.map((file) => {
    const path = relativeFilePath(file.path);
    const target = join(outputDir, path);
    const targetRelative = relative(outputDir, target);
    if (targetRelative.startsWith("..") || isAbsolute(targetRelative))
      throw new Error(`Refusing to write outside output directory: ${path}`);
    return { file, path, target };
  });
  for (const planned of plannedFiles) {
    try {
      await stat(planned.target);
      throw new Error(`Refusing to overwrite existing file: ${planned.target}`);
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error;
    }
  }
  for (const planned of plannedFiles) {
    await mkdir(dirname(planned.target), { recursive: true });
    await writeFile(planned.target, planned.file.content, { encoding: "utf8", flag: "wx" });
  }
  return { outputDir, files: result.files.map((file) => file.path) };
}

export async function readAgentTemplate(path: string): Promise<GeneratedFile> {
  return textFile("AGENTS.md", await readFile(path, { encoding: "utf8" }));
}
