import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
  DEPENDENCY_VERSIONS,
  IMAGE_CATALOG,
  resolveCapabilities,
  type Profile,
  type ProviderSelection,
  type EnvironmentVariableDefinition,
} from "./capabilities.js";

export { PRESETS, PROFILE_NAMES } from "./capabilities.js";
export type { Preset, Profile, ProviderSelection } from "./capabilities.js";
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
  readonly requestedProfiles?: readonly Profile[];
  readonly preset?: import("./capabilities.js").Preset | null;
  readonly deployment: Deployment;
  readonly technicalOwner: string;
  readonly operationsOwner: string;
  readonly outputDir: string;
  readonly mobile: MobileSettings | null;
  readonly providers?: ProviderSelection;
  readonly agentTemplate?: string;
  readonly allowExperimental?: boolean;
  readonly allowBetaTarget?: boolean;
  readonly topology?: "standard" | "hardened";
  readonly githubRepository?: string | null;
  readonly createRemote?: boolean;
}

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}
export interface GenerationResult {
  readonly config: InitConfig;
  readonly files: readonly GeneratedFile[];
}

export interface StarterRecipe {
  readonly schemaVersion: 1;
  readonly generatorVersion: string;
  readonly application: {
    readonly id: string;
    readonly displayName: string;
    readonly packageScope: string;
    readonly owners: { readonly technical: string; readonly operations: string };
  };
  readonly preset: import("./capabilities.js").Preset | null;
  readonly requestedProfiles: readonly Profile[];
  readonly resolvedProfiles: readonly {
    readonly id: string;
    readonly sourceMaturity: import("./capabilities.js").SourceMaturity;
    readonly productionPolicy: import("./capabilities.js").ProductionPolicy;
    readonly nativeQualification?: "unqualified";
    readonly securityQualification?: "blocked";
  }[];
  readonly deployment: { readonly target: Deployment; readonly topology: "standard" | "hardened" };
  readonly environments: readonly ["local", "ci", "staging", "production"];
  readonly providers: ProviderSelection;
  readonly generatedTreeHash: string;
  readonly generatedAt: string;
}
export interface WriteResult {
  readonly outputDir: string;
  readonly files: readonly string[];
}

export interface ProductIdentity {
  readonly namespace: string;
  readonly sqlPrefix: string;
  readonly environmentPrefix: string;
  readonly workPrefix: string;
}

export function productIdentity(config: Pick<InitConfig, "productId">): ProductIdentity {
  const sqlPrefix = config.productId.replaceAll("-", "_");
  return {
    namespace: ".thaarei",
    sqlPrefix,
    environmentPrefix: sqlPrefix.toUpperCase(),
    workPrefix: sqlPrefix.toUpperCase(),
  };
}

const PACKAGE_VERSION = "0.1.0";
const GENERATOR_VERSION = "1.0.0-dev.1";
const FOUNDATION_VERSION = "1.0.0-dev.1";
const TOOLING_VERSION = "1.0.0-dev.1";
const MOBILE_WAIVER_EXPIRES_AT = "2026-10-05T00:00:00.000Z";
const NODE_VERSION = "24.20.0";
const PNPM_VERSION = "11.22.0";
const NODE_IMAGE = `${IMAGE_CATALOG.node.reference}@${IMAGE_CATALOG.node.digest}`;
const PYTHON_VERSION = "3.12.13";
const PYTHON_IMAGE = `${IMAGE_CATALOG.python.reference}@${IMAGE_CATALOG.python.digest}`;
const POSTGRES_IMAGE = `${IMAGE_CATALOG.postgresql.reference}@${IMAGE_CATALOG.postgresql.digest}`;
const MINIO_IMAGE = `${IMAGE_CATALOG.minio.reference}@${IMAGE_CATALOG.minio.digest}`;
const MINIO_MC_IMAGE = `${IMAGE_CATALOG.minioMc.reference}@${IMAGE_CATALOG.minioMc.digest}`;

/**
 * The profile graph is deliberately computed once.  Generation functions consume this
 * graph instead of independently deciding which capability owns a dependency, application,
 * readiness probe, or release claim.
 */
interface CapabilityPlan {
  readonly profiles: readonly Profile[];
  readonly canonicalProfiles: readonly string[];
  readonly deprecatedAliases: readonly Profile[];
  readonly capabilityFixtures: readonly string[];
  readonly localServices: readonly string[];
  readonly providers: ProviderSelection;
  readonly needsApi: boolean;
  readonly needsApiClient: boolean;
  readonly needsDatabase: boolean;
  readonly needsWorker: boolean;
  readonly needsEvents: boolean;
  readonly needsExternalApi: boolean;
  readonly needsIdentity: boolean;
  readonly needsTenancy: boolean;
  readonly needsAi: boolean;
  readonly needsStorage: boolean;
  readonly needsObservability: boolean;
  readonly needsCache: boolean;
  readonly needsRateLimit: boolean;
  readonly needsFeatureFlags: boolean;
  readonly needsNotifications: boolean;
  readonly needsPayments: boolean;
  readonly needsSearch: boolean;
  readonly needsRag: boolean;
  readonly needsAdapters: boolean;
  readonly deployableApps: readonly string[];
  readonly apiEnvironment: readonly string[];
  readonly workerEnvironment: readonly string[];
  readonly capabilityEnvironment: readonly EnvironmentVariableDefinition[];
  readonly testedPackages: Readonly<Record<string, string>>;
}

function hasProfile(config: InitConfig, profile: Profile): boolean {
  const canonical = resolveCapabilities(config.profiles, config.providers).profiles;
  return canonical.includes(profile);
}

function createCapabilityPlan(config: InitConfig): CapabilityPlan {
  const manifest = resolveCapabilities(config.profiles, config.providers);
  const selected = new Set(manifest.profiles);
  const has = (profile: Profile): boolean => selected.has(profile);
  const needsIdentity = has("identity");
  const needsTenancy = has("tenancy");
  const needsAi = has("ai");
  const needsStorage = has("storage");
  const needsExternalApi = has("external-api");
  const needsWorker = has("jobs");
  const needsEvents = has("events");
  const needsObservability = has("observability");
  const needsCache = has("cache");
  const needsRateLimit = has("rate-limit");
  const needsFeatureFlags = has("feature-flags");
  const needsNotifications = has("notifications");
  const needsPayments = has("payments");
  const needsSearch = has("search");
  const needsRag = has("rag");
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
  const providerEnvironment: readonly EnvironmentVariableDefinition[] = [
    ...(manifest.providers.aiProviders.includes("openai")
      ? [
          {
            name: "OPENAI_API_KEY",
            owner: "api" as const,
            required: false,
            secret: true,
            description: "OpenAI API key; deterministic fixtures do not require it.",
          },
          {
            name: "OPENAI_BASE_URL",
            owner: "api" as const,
            required: false,
            secret: false,
            description: "Optional OpenAI-compatible endpoint for contract tests.",
          },
        ]
      : []),
    ...(manifest.providers.aiProviders.includes("anthropic")
      ? [
          {
            name: "ANTHROPIC_API_KEY",
            owner: "api" as const,
            required: false,
            secret: true,
            description: "Anthropic API key; deterministic fixtures do not require it.",
          },
          {
            name: "ANTHROPIC_BASE_URL",
            owner: "api" as const,
            required: false,
            secret: false,
            description: "Optional Anthropic-compatible endpoint for contract tests.",
          },
        ]
      : []),
    ...(manifest.providers.paymentProviders.includes("stripe")
      ? [
          {
            name: "STRIPE_SECRET_KEY",
            owner: "api" as const,
            required: false,
            secret: true,
            description: "Stripe secret key; signed fixtures do not require it.",
          },
        ]
      : []),
    ...(manifest.providers.paymentProviders.includes("razorpay")
      ? [
          {
            name: "RAZORPAY_KEY_ID",
            owner: "api" as const,
            required: false,
            secret: false,
            description: "Razorpay key identifier; contract fixtures do not require it.",
          },
          {
            name: "RAZORPAY_KEY_SECRET",
            owner: "api" as const,
            required: false,
            secret: true,
            description: "Razorpay secret; signed fixtures do not require it.",
          },
        ]
      : []),
  ];
  const capabilityEnvironment = [
    ...new Map(
      [...manifest.environment, ...providerEnvironment].map((item) => [item.name, item]),
    ).values(),
  ];
  const environmentNames = (owner: EnvironmentVariableDefinition["owner"]): readonly string[] =>
    capabilityEnvironment.filter((item) => item.owner === owner).map((item) => item.name);
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
    ...environmentNames("api"),
  ];
  const workerEnvironment = [
    "NODE_ENV",
    "WORKER_PORT",
    ...(needsDatabase ? ["DATABASE_URL"] : []),
    "WORKER_CONCURRENCY",
    ...(has("cache") ? ["VALKEY_URL"] : []),
    ...(has("python") ? ["PYTHON_SERVICE_TOKEN"] : []),
    ...(has("observability") ? ["OTEL_EXPORTER_OTLP_ENDPOINT"] : []),
    ...environmentNames("worker"),
  ];
  return {
    profiles: manifest.profiles,
    canonicalProfiles: manifest.profiles,
    deprecatedAliases: manifest.deprecatedAliases,
    capabilityFixtures: manifest.fixtures,
    localServices: manifest.localServices.map((service) => service.name),
    providers: manifest.providers,
    needsApi,
    needsApiClient,
    needsDatabase,
    needsWorker,
    needsEvents,
    needsExternalApi,
    needsIdentity,
    needsTenancy,
    needsAi,
    needsStorage,
    needsObservability,
    needsCache,
    needsRateLimit,
    needsFeatureFlags,
    needsNotifications,
    needsPayments,
    needsSearch,
    needsRag,
    needsAdapters:
      needsIdentity || needsAi || needsStorage || needsPayments || needsNotifications || needsCache,
    deployableApps,
    apiEnvironment,
    workerEnvironment,
    capabilityEnvironment,
    testedPackages: testedPackages(config),
  };
}
function packageName(config: InitConfig, name: string): string {
  if (name === "foundation") return "@thaarei-technology/foundation";
  return `${config.packageScope}/${name}`;
}

function jsonFile(path: string, value: unknown): GeneratedFile {
  return { path, content: `${JSON.stringify(value, null, 2)}\n` };
}

function starterRecipe(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const definitions = resolveCapabilities(plan.profiles, plan.providers).definitions;
  const recipe: StarterRecipe = {
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    application: {
      id: config.productId,
      displayName: config.displayName,
      packageScope: config.packageScope,
      owners: { technical: config.technicalOwner, operations: config.operationsOwner },
    },
    preset: config.preset ?? null,
    requestedProfiles: config.requestedProfiles ?? config.profiles,
    resolvedProfiles: definitions.map((definition) => ({
      id: definition.id,
      sourceMaturity: definition.sourceMaturity,
      productionPolicy: definition.productionPolicy,
      ...(definition.id === "mobile"
        ? {
            nativeQualification: "unqualified" as const,
            securityQualification: "blocked" as const,
          }
        : {}),
    })),
    deployment: { target: config.deployment, topology: config.topology ?? "standard" },
    environments: ["local", "ci", "staging", "production"],
    providers: plan.providers,
    generatedTreeHash: "pending",
    generatedAt: "pending",
  };
  return jsonFile(".thaarei/starter.json", recipe);
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
 * ${"SOURCE OF " + "TRUTH"} ID: ${values.id}
 * ${"SOURCE OF " + "TRUTH"} KEYWORDS: ${values.keywords}
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
  extraDevDependencies: Readonly<Record<string, string>> = {},
  options: {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
  } = {},
): GeneratedFile {
  return jsonFile(`packages/${name}/package.json`, {
    name: packageName(config, name),
    private: true,
    version: PACKAGE_VERSION,
    type: "module",
    files: ["dist"],
    exports: options.exports ?? { ".": { types: "./src/index.ts", import: "./dist/index.js" } },
    scripts: {
      build: "tsc -p tsconfig.json",
      typecheck: "tsc -p tsconfig.json --noEmit",
      ...options.scripts,
    },
    dependencies,
    devDependencies: {
      "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
      typescript: DEPENDENCY_VERSIONS.typescript,
      ...extraDevDependencies,
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
      declaration: true,
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
    files: ["dist"],
    scripts: {
      build: "tsc -p tsconfig.json",
      dev:
        name === "api" || name === "worker"
          ? `pnpm --filter ${packageName(config, `${name}-app`)}... build && node --env-file=../../.env --import tsx --watch src/index.ts`
          : "tsx watch src/index.ts",
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
    "@thaarei-technology/foundation": FOUNDATION_VERSION,
    "@thaarei-technology/tooling": TOOLING_VERSION,
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
  if (hasProfile(config, "jobs") && !hasProfile(config, "api")) {
    packages.zod = DEPENDENCY_VERSIONS.zod;
  }
  if (hasProfile(config, "data") || hasProfile(config, "storage")) {
    Object.assign(packages, {
      "drizzle-orm": DEPENDENCY_VERSIONS.drizzle,
      postgres: DEPENDENCY_VERSIONS.postgres,
    });
  }
  if (hasProfile(config, "identity")) {
    packages["better-auth"] = DEPENDENCY_VERSIONS.betterAuth;
    packages["@better-auth/passkey"] = DEPENDENCY_VERSIONS.betterAuthPasskey;
  }
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
      "@aws-sdk/s3-presigned-post": DEPENDENCY_VERSIONS.awsPresignedPost,
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
  if (config.deployment === "railway") packages.railway = DEPENDENCY_VERSIONS.railway;
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
            detail: { type: "string" },
            failedDependency: { type: "string" },
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
    $id: "https://example.invalid/schemas/release-manifest.schema.json",
    title: "Product release manifest",
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
      "qualifications",
      "evidence",
      "securityWaivers",
    ],
    properties: {
      $schema: { type: "string", minLength: 1 },
      schemaVersion: { const: 2 },
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
            status: { enum: ["passed", "failed", "pending", "blocked_external", "waived"] },
            evidence: { type: "string", minLength: 1 },
          },
        },
      },
      qualifications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "sourceMaturity", "productionPolicy", "qualification", "requiredGates"],
          properties: {
            id: { type: "string", minLength: 1 },
            sourceMaturity: { enum: ["stable", "beta", "experimental"] },
            productionPolicy: {
              enum: ["starter_qualified", "requires_product_qualification", "forbidden"],
            },
            qualification: {
              enum: ["not_required", "unqualified", "qualified", "blocked", "expired"],
            },
            requiredGates: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      },
      evidence: { type: "array" },
      securityWaivers: { type: "array" },
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
const hasNonLatestImageTag = (reference: string): boolean => {
  const lastSlash = reference.lastIndexOf("/");
  const tagSeparator = reference.lastIndexOf(":");
  return tagSeparator > lastSlash && reference.slice(tagSeparator + 1) !== "latest";
};
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
const release = await readJson(resolve(root, "release-manifest.json"));
if (!isRecord(release)) errors.push("release-manifest.json must be an object");
if (isRecord(release)) {
  for (const key of ["$schema", "schemaVersion", "release", "status", "releasedAt", "runtime", "approvedMajors", "testedPackages", "containerImages", "enabledProfiles", "compatibilityEvidence", "qualifications", "evidence", "securityWaivers"]) {
    if (!(key in release)) errors.push(\`starter-release.json is missing \${key}\`);
  }
  if (release.$schema !== "./tooling/release/release-manifest.schema.json") errors.push("release-manifest.json must reference the bundled schema");
  unknownKeys(release, ["$schema", "schemaVersion", "release", "status", "releasedAt", "runtime", "approvedMajors", "testedPackages", "containerImages", "enabledProfiles", "compatibilityEvidence", "qualifications", "evidence", "securityWaivers"], "starter-release.json");
  if (release.schemaVersion !== 2) errors.push("schemaVersion must be 2");
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
    else if (!hasNonLatestImageTag(image.reference)) errors.push(\`container image \${name} must use a non-latest tag\`);
  }
  if (!Array.isArray(release.enabledProfiles) || !release.enabledProfiles.every((value) => typeof value === "string" && value.length > 0) || new Set(release.enabledProfiles).size !== release.enabledProfiles.length) errors.push("enabledProfiles must be a unique non-empty string array");
  if (!Array.isArray(release.compatibilityEvidence) || !release.compatibilityEvidence.every((item) => isRecord(item) && typeof item.gate === "string" && item.gate.length > 0 && ["passed", "failed", "pending", "blocked_external", "waived"].includes(String(item.status)) && typeof item.evidence === "string" && item.evidence.length > 0)) errors.push("compatibilityEvidence is invalid");
  if (Array.isArray(release.compatibilityEvidence)) for (const [index, item] of release.compatibilityEvidence.entries()) unknownKeys(item, ["gate", "status", "evidence"], \`compatibilityEvidence[\${index}]\`);
  if (release.releasedAt !== null && !isDateTime(release.releasedAt)) errors.push("releasedAt must be null or a valid UTC date-time");
  if (release.status === "released" && (typeof release.releasedAt !== "string" || !isDateTime(release.releasedAt))) errors.push("releasedAt is required when status is released");
  if (release.status === "prerelease" && release.releasedAt !== null) errors.push("releasedAt must remain null while status is prerelease");
  if (!Array.isArray(release.qualifications)) errors.push("qualifications must be an array");
  if (!Array.isArray(release.evidence)) errors.push("evidence must be an array");
  if (!Array.isArray(release.securityWaivers)) errors.push("securityWaivers must be an array");
  if (release.status === "released" && Array.isArray(release.qualifications) && release.qualifications.some((item) => isRecord(item) && item.sourceMaturity === "stable" && item.qualification !== "qualified")) errors.push("every stable subject must be qualified before release promotion");
  if (release.status === "released" && Array.isArray(release.compatibilityEvidence) && release.compatibilityEvidence.some((item) => !isRecord(item) || (item.status !== "passed" && !String(item.gate).startsWith("experimental-") && !String(item.gate).startsWith("beta-")))) errors.push("every stable compatibility gate must pass before release promotion");
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
else process.stdout.write("product release manifest is consistent\\n");
`,
  );
}

function generatedSecurityWaiverChecker(): GeneratedFile {
  return textFile(
    "tooling/security/check-waivers.ts",
    `import { readFile } from "node:fs/promises";

const waiverFile = JSON.parse(await readFile(".thaarei/security-waivers.json", "utf8")) as { waivers?: Array<{ advisoryIds?: string[]; expiresAt?: string; blocksProduction?: boolean }> };
const auditText = await readFile(".thaarei/pnpm-audit.json", "utf8");
const active = waiverFile.waivers?.[0];
if (!active?.expiresAt || Date.parse(active.expiresAt) <= Date.now()) throw new Error("The experimental mobile security waiver is expired; generation and validation are disabled");
if (active.blocksProduction !== true) throw new Error("The experimental mobile waiver must block production");
const observed = new Set(auditText.match(/GHSA-[a-z0-9-]+/giu) ?? []);
if (observed.size === 0) throw new Error("Audit failed without a recognized advisory identifier");
const allowed = new Set(active.advisoryIds ?? []);
const unexpected = [...observed].filter((id) => !allowed.has(id));
if (unexpected.length > 0) throw new Error(\`Unwaived advisories: \${unexpected.join(", ")}\`);
process.stdout.write("Only the active production-blocking experimental mobile waiver was observed\\n");
`,
  );
}

function contractsPackageFile(plan: CapabilityPlan): GeneratedFile {
  const usesZod = plan.needsApi || plan.needsWorker;
  const zodImport = usesZod ? `import { z } from "zod";\n\n` : "";
  const apiSchemas = plan.needsApi
    ? `
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checkedAt: z.string().datetime(),
  instanceId: z.string().min(1),
  detail: z.string().optional(),
  failedDependency: z.string().optional(),
});
export const problemDetailsSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
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
  const zodImport = plan.needsEvents ? 'import { z } from "zod";\n\n' : "";
  const applicationBoundary =
    plan.needsApi || plan.needsWorker
      ? `export type GovernanceRole = "owner" | "admin" | "member";
export type Permission = string & { readonly __brand: "Permission" };
${sourceOfTruthBlock({ id: "starter.core.application-boundary", keywords: "actor-context, authorization, application-service, core-errors", what: "Provider-neutral application invocation context, authorization port, and error taxonomy.", why: "Transports and workers need a shared, authenticated context without deciding domain policy or leaking infrastructure errors.", when: "Every authenticated command or query entering a core application service.", how: "ActorContext", boundaries: "Core defines policy contracts and normalized errors; transports map errors and adapters implement ports." })}
export interface ActorContext {
  readonly subjectId: string;
  readonly organizationId?: string;
  readonly membershipId?: string;
  readonly governanceRole?: GovernanceRole;
  readonly permissions: readonly Permission[];
  readonly productRoles: readonly string[];
  readonly correlationId: string;
  readonly traceId?: string;
  readonly idempotencyKey?: string;
}
export interface PublicContext { readonly correlationId: string; readonly traceId?: string; }
export interface ResourceDescriptor {
  readonly type: string;
  readonly id: string;
  readonly organizationId?: string;
  readonly owningSubjectId?: string;
  readonly owningMembershipId?: string;
  readonly visibility?: "draft" | "published" | "private" | "public";
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}
export interface AuthorizationDecision { readonly allowed: boolean; readonly reason?: string; }
export interface AuthorizationService {
  authorize(actor: ActorContext, permission: Permission, resource: ResourceDescriptor): Promise<AuthorizationDecision>;
}
export abstract class CoreError extends Error { abstract readonly code: string; }
export class UnauthenticatedError extends CoreError { readonly code = "UNAUTHENTICATED"; }
export class ForbiddenError extends CoreError { readonly code = "FORBIDDEN"; }
export class ResourceNotFoundError extends CoreError { readonly code = "NOT_FOUND"; }
export class ConflictError extends CoreError { readonly code = "CONFLICT"; }
export class ValidationError extends CoreError { readonly code = "VALIDATION"; }
export class RateLimitedError extends CoreError { readonly code = "RATE_LIMITED"; }
export class BudgetExceededError extends CoreError { readonly code = "BUDGET_EXCEEDED"; }
export class ProviderUnavailableError extends CoreError { readonly code = "PROVIDER_UNAVAILABLE"; }
export class RetryableWorkflowError extends CoreError { readonly code = "RETRYABLE_WORKFLOW"; }
export class PermanentWorkflowError extends CoreError { readonly code = "PERMANENT_WORKFLOW"; }
`
      : "";
  const identity = plan.needsIdentity
    ? `export type AssuranceLevel = "anonymous" | "single_factor" | "multi_factor" | "phishing_resistant" | "recovery";
export type AuthenticationMethod = "password" | "password_totp" | "passkey" | "recovery_code";
export interface AuthenticationSession { readonly subjectId: string; readonly assurance: AssuranceLevel; readonly authenticatedAt: string; }
export interface AuthenticationPort {
  resolveSession(headers: Headers): Promise<AuthenticationSession | null>;
  listSessions(headers: Headers): Promise<readonly unknown[]>;
  revokeSession(headers: Headers, token: string): Promise<void>;
  revokeAllSessions(headers: Headers): Promise<void>;
}
export interface IdentityRepository {
  ensureAuthenticationSubject(authenticationSubjectId: string): Promise<{ readonly subjectId: string }>;
  resolveAuthenticationSubject(authenticationSubjectId: string): Promise<{ readonly subjectId: string } | null>;
}
export interface IdentityMailPort {
  sendVerification(input: { readonly email: string; readonly url: string }): Promise<void>;
  sendPasswordReset(input: { readonly email: string; readonly url: string }): Promise<void>;
}
export const assuranceForMethod = (method: AuthenticationMethod): AssuranceLevel => ({
  password: "single_factor",
  password_totp: "multi_factor",
  passkey: "phishing_resistant",
  recovery_code: "recovery",
})[method] as AssuranceLevel;
export function canPerformSensitiveAccountChange(input: { readonly assurance: AssuranceLevel; readonly authenticatedAt: string }, now = new Date(), maximumAgeMs = 5 * 60 * 1000): boolean {
  if (input.assurance === "anonymous" || input.assurance === "single_factor" || input.assurance === "recovery") return false;
  const age = now.getTime() - Date.parse(input.authenticatedAt);
  return Number.isFinite(age) && age >= 0 && age <= maximumAgeMs;
}
export const identitySecurityPolicy = Object.freeze({
  requireVerifiedEmail: true,
  resetTokenSingleUse: true,
  resetTokenExpiresInSeconds: 3600,
  enumerationSafeResponses: true,
  revokeAllSessionsAfterReset: true,
  loginRequiredAfterReset: true,
  rotateSessionAfterAuthenticationOrAssuranceChange: true,
  trustedDeviceBypass: false,
  rateLimitedOperations: ["login", "email-verification", "password-recovery"] as const,
});
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
  const events = plan.needsEvents
    ? `export interface DomainEvent<TPayload> {
  readonly id: string;
  readonly organizationId?: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
}
export interface OutboxPort {
  append<TPayload>(event: DomainEvent<TPayload>, destination: string, idempotencyKey: string): Promise<void>;
}
export interface OutboxDeliveryPort {
  claim(eventId: string, leaseOwner: string, now: Date, leaseMilliseconds: number): Promise<{ readonly fencingToken: number } | null>;
  recordAttempt(eventId: string, fencingToken: number, outcome: "delivered" | "retry" | "dead_letter", failure?: string): Promise<void>;
  markDelivered(eventId: string, fencingToken: number): Promise<void>;
  replay(eventId: string, actorSubjectId: string): Promise<void>;
}
export const domainEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  type: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
}).strict();
export function retryDelayMilliseconds(attemptNumber: number, randomValue = 0.5): number {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 || !Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) throw new Error("Invalid outbox retry input");
  const exponential = Math.min(15 * 60 * 1000, 1000 * 2 ** Math.min(attemptNumber - 1, 10));
  return Math.min(15 * 60 * 1000, Math.floor(exponential * (0.5 + randomValue)));
}
export function isCurrentFencingToken(expected: number, actual: number): boolean {
  return Number.isSafeInteger(expected) && expected > 0 && actual === expected;
}
export function validateDomainEvent(value: unknown): DomainEvent<Record<string, unknown>> {
  return domainEventSchema.parse(value) as DomainEvent<Record<string, unknown>>;
}
`
    : "";
  const storage = plan.needsStorage
    ? `export interface StorageUploadRequest {
  readonly key: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly subjectId: string;
  readonly organizationId?: string;
}
export interface PresignedUpload {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly key: string;
  readonly expiresAt: string;
}
export interface StorageMetadata {
  readonly key: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly subjectId: string;
  readonly organizationId?: string;
  readonly status: "pending" | "available" | "quarantined";
}
export interface ObjectStorage {
  createUpload(input: StorageUploadRequest): Promise<PresignedUpload>;
  completeUpload(input: { readonly key: string; readonly subjectId: string; readonly organizationId?: string }): Promise<StorageMetadata>;
  put(input: { readonly key: string; readonly contentType: string; readonly body: Uint8Array; readonly subjectId: string; readonly organizationId?: string }): Promise<void>;
  getUrl(input: { readonly key: string; readonly subjectId: string; readonly organizationId?: string }): Promise<string>;
}
export interface StorageMetadataStore {
  record(input: { readonly key: string; readonly contentType: string; readonly byteLength: number; readonly subjectId: string; readonly organizationId?: string; readonly status?: "pending" | "available" | "quarantined" }): Promise<void>;
  find(input: { readonly key: string; readonly subjectId: string; readonly organizationId?: string }): Promise<StorageMetadata | null>;
}
export interface StoragePolicy {
  authorize(operation: "create-upload" | "complete-upload" | "put" | "get", key: string, subjectId: string, organizationId?: string): boolean;
  readonly maximumBytes: number;
  readonly allowedContentTypes: readonly string[];
}
export const defaultStoragePolicy: StoragePolicy = {
  maximumBytes: 50 * 1024 * 1024,
  allowedContentTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "text/plain"],
  authorize: (_operation, key, subjectId, organizationId) => {
    const prefix = organizationId ? organizationId.concat("/", subjectId, "/") : subjectId.concat("/");
    return subjectId.length > 0 && key.startsWith(prefix) && !key.includes("..") && !key.startsWith("/");
  },
};
export function validateStorageUpload(input: StorageUploadRequest, policy = defaultStoragePolicy): void {
  if (!policy.authorize("create-upload", input.key, input.subjectId, input.organizationId)) throw new Error("Storage policy denied upload authorization");
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0 || input.byteLength > policy.maximumBytes) throw new Error("Storage policy denied upload size");
  if (!policy.allowedContentTypes.includes(input.contentType)) throw new Error("Storage policy denied content type");
}
`
    : "";
  const ai = plan.needsAi
    ? `export interface AiSchema<T> { parse(value: unknown): T; }
export type ToolRisk = "low" | "medium" | "high";
export type AiOutcome = "success" | "invalid_tool" | "invalid_input" | "unauthorized" | "approval_required" | "cost_limit" | "provider_error" | "invalid_output";
export interface AiEvent { readonly toolName: string; readonly subjectId: string; readonly costUsd: number; readonly outcome: AiOutcome; }
export interface ApprovalScope { readonly organizationId?: string; readonly runId?: string; readonly toolName: string; readonly subjectId: string; readonly inputHash?: string; readonly maximumCostUsd?: number; }
export interface AiApprovalStore { isApproved(toolName: string, subjectId: string): Promise<boolean>; consumeApproval?(scope: ApprovalScope): Promise<boolean>; }
export interface AiAuditStore { recordAudit(event: AiEvent): Promise<void>; }
export interface AiTelemetryStore { recordTelemetry(event: AiEvent): Promise<void>; }
export interface AiEvaluationStore { recordEvaluation(input: { readonly name: string; readonly score: number; readonly subjectId: string }): Promise<void>; }
export interface AiPersistence extends AiApprovalStore, AiAuditStore, AiTelemetryStore, AiEvaluationStore {
  approve(toolName: string, subjectId: string, scope?: Omit<ApprovalScope, "toolName" | "subjectId">): Promise<void>;
}
export type LogicalModel = "chat.fast" | "chat.quality" | "structured.default" | "embedding.default";
export interface ModelGeneration { readonly text: string; readonly inputTokens: number; readonly outputTokens: number; }
export interface ModelDescriptor {
  readonly provider: string;
  readonly modelId: string;
  readonly allowedUseCases: readonly string[];
  readonly maximumInputTokens: number;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
  readonly maximumRetries: number;
  readonly inputMicrousdPerMillionTokens: number;
  readonly outputMicrousdPerMillionTokens: number;
  readonly structuredOutput: boolean;
  readonly tools: boolean;
  readonly streaming: boolean;
  readonly environments: readonly ("development" | "test" | "staging" | "production")[];
  readonly generate: (prompt: string) => Promise<ModelGeneration>;
}
export interface AiCompletionTransaction {
  complete(input: {
    readonly runId: string;
    readonly organizationId: string;
    readonly leaseToken: string;
    readonly artifact: Readonly<Record<string, unknown>>;
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costMicrousd: number };
    readonly evaluation: { readonly name: string; readonly scoreMillionths: number };
    readonly event: { readonly id: string; readonly type: string; readonly payload: Readonly<Record<string, unknown>>; readonly correlationId: string };
  }): Promise<void>;
}
export async function completeAiRun(transaction: AiCompletionTransaction, input: Parameters<AiCompletionTransaction["complete"]>[0]): Promise<void> {
  if (!input.runId || !input.organizationId || !input.leaseToken || Object.keys(input.artifact).length === 0) throw new AiPolicyError("INVALID_INPUT", "AI completion evidence is incomplete");
  if (!Number.isSafeInteger(input.usage.inputTokens) || input.usage.inputTokens < 0 || !Number.isSafeInteger(input.usage.outputTokens) || input.usage.outputTokens < 0 || !Number.isSafeInteger(input.usage.costMicrousd) || input.usage.costMicrousd < 0) throw new AiPolicyError("INVALID_INPUT", "AI usage evidence is invalid");
  if (!input.evaluation.name || !Number.isSafeInteger(input.evaluation.scoreMillionths) || input.evaluation.scoreMillionths < 0 || input.evaluation.scoreMillionths > 1_000_000) throw new AiPolicyError("INVALID_INPUT", "AI evaluation evidence is invalid");
  if (!input.event.id || !input.event.type || !input.event.correlationId || Object.keys(input.event.payload).length === 0) throw new AiPolicyError("INVALID_INPUT", "AI event evidence is incomplete");
  await transaction.complete(input);
}
export interface AiExecutionContext {
  readonly subjectId: string;
  readonly organizationId?: string;
  readonly runId?: string;
  readonly inputHash?: string;
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
  readonly #models = new Map<LogicalModel, ModelDescriptor>();
  register(name: LogicalModel, model: ModelDescriptor): void {
    if (this.#models.has(name)) throw new Error("AI logical model must be unique");
    if (model.maximumInputTokens <= 0 || model.maximumOutputTokens <= 0 || model.timeoutMilliseconds <= 0) throw new Error("AI model limits must be positive");
    if (model.environments.length === 0 || model.allowedUseCases.length === 0) throw new Error("AI model policy scope is required");
    this.#models.set(name, model);
  }
  get(name: LogicalModel, environment: ModelDescriptor["environments"][number], useCase: string): ModelDescriptor {
    const model = this.#models.get(name);
    if (!model) throw new Error("AI model is not registered");
    if (!model.environments.includes(environment) || !model.allowedUseCases.includes(useCase)) throw new Error("AI model policy denied");
    return model;
  }
}
export function createDefaultModelRegistry(): ModelRegistry {
  const registry = new ModelRegistry();
  const provider = '${plan.providers.aiProviders[0] ?? "deterministic"}';
  const descriptor = (modelId: string, useCases: readonly string[], structuredOutput = false): ModelDescriptor => ({ provider, modelId, allowedUseCases: useCases, maximumInputTokens: 8_000, maximumOutputTokens: 2_000, timeoutMilliseconds: 15_000, maximumRetries: 2, inputMicrousdPerMillionTokens: 0, outputMicrousdPerMillionTokens: 0, structuredOutput, tools: true, streaming: false, environments: ["development", "test", "staging", "production"], generate: async (prompt) => ({ text: prompt, inputTokens: Math.ceil(prompt.length / 4), outputTokens: 0 }) });
  registry.register("chat.fast", descriptor("gpt-4o-mini", ["triage", "classification"]));
  registry.register("chat.quality", descriptor("claude-3-5-sonnet-latest", ["drafting", "reasoning"]));
  registry.register("structured.default", descriptor("gpt-4o-mini", ["structured-output"], true));
  registry.register("embedding.default", descriptor("text-embedding-3-small", ["embedding"]));
  return registry;
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
    if (tool.requiresApproval) {
      const scope = { toolName: name, subjectId: context.subjectId, ...(context.organizationId ? { organizationId: context.organizationId } : {}), ...(context.runId ? { runId: context.runId } : {}), ...(context.inputHash ? { inputHash: context.inputHash } : {}), maximumCostUsd: tool.maximumCostUsd };
      const approved = context.approvals.consumeApproval ? await context.approvals.consumeApproval(scope) : await context.approvals.isApproved(name, context.subjectId);
      if (!approved) { await record("approval_required"); throw new AiPolicyError("APPROVAL_REQUIRED", "AI tool approval is required"); }
    }
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
  const tenancy = plan.needsTenancy
    ? `${sourceOfTruthBlock({ id: "starter.tenancy.authorization-policy", keywords: "tenancy, authorization, organization, permission, deny-by-default", what: "Organization-scoped authorization policy that separates governance roles from product permissions.", why: "Tenant isolation and server-side authorization must remain authoritative even when a client sends a guessed resource identifier.", when: "Every organization-scoped application service authorizes an actor before loading or mutating a resource.", how: "DefaultAuthorizationService", boundaries: "The policy owns decisions only; database repositories enforce persistence constraints and transports only map the result." })}
export class DefaultAuthorizationService implements AuthorizationService {
  async authorize(actor: ActorContext, permission: Permission, resource: ResourceDescriptor): Promise<AuthorizationDecision> {
    if (!actor.subjectId || !actor.organizationId) return { allowed: false, reason: "organization-context-required" };
    if (resource.organizationId !== undefined && resource.organizationId !== actor.organizationId) return { allowed: false, reason: "organization-mismatch" };
    if (actor.governanceRole === "owner") return { allowed: true };
    if (actor.governanceRole === "admin" && permission !== ("organization.owner.manage" as Permission)) return { allowed: true };
    return actor.permissions.includes(permission) ? { allowed: true } : { allowed: false, reason: "permission-required" };
  }
}
export interface InvitationDecision { readonly valid: boolean; readonly reason?: "expired" | "revoked" | "accepted" | "invalid-role"; }
export function validateInvitation(input: { readonly status: "pending" | "accepted" | "revoked" | "expired"; readonly expiresAt: Date; readonly now: Date; readonly governanceRole: GovernanceRole }): InvitationDecision {
  if (input.status === "accepted") return { valid: false, reason: "accepted" };
  if (input.status === "revoked") return { valid: false, reason: "revoked" };
  if (input.status === "expired" || input.expiresAt.getTime() <= input.now.getTime()) return { valid: false, reason: "expired" };
  if (!["owner", "admin", "member"].includes(input.governanceRole)) return { valid: false, reason: "invalid-role" };
  return { valid: true };
}
`
    : "";
  const observability = plan.needsObservability
    ? `${sourceOfTruthBlock({ id: "starter.observability.redaction", keywords: "observability, telemetry, redaction, correlation", what: "Portable telemetry redaction and correlation context for application evidence.", why: "Operational evidence must be useful without copying credentials, cookies, authorization headers, or sensitive payloads.", when: "Before exporting logs, traces, audit metadata, or provider diagnostics.", how: "redactSensitive", boundaries: "This helper never emits secrets; exporters and adapters remain outside core." })}
export interface CorrelationContext { readonly correlationId: string; readonly traceId?: string; readonly organizationId?: string; readonly subjectId?: string; }
export interface TelemetryEvent { readonly name: string; readonly context: CorrelationContext; readonly attributes: Readonly<Record<string, unknown>>; }
const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sensitiveKey = /authorization|cookie|password|secret|token|api[-_]?key|signature|prompt|body/iu;
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!isRecordValue(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(item)]));
}
`
    : "";
  const cache = plan.needsCache
    ? `${sourceOfTruthBlock({ id: "starter.cache.port", keywords: "cache, ttl, invalidation, typed-value", what: "Provider-neutral cache port with bounded TTL and explicit invalidation semantics.", why: "Cache outages must not change authorization or durable business truth, and cached values require caller validation.", when: "A read model or risk-tolerant computation can be cached without replacing the source of truth.", how: "cacheTtlForRisk", boundaries: "Adapters implement storage; core owns TTL policy and callers own value parsing." })}
export type CacheRisk = "public" | "authenticated" | "tenant" | "sensitive";
export interface CachePort { get<T>(key: string, parse: (value: unknown) => T): Promise<T | null>; set<T>(key: string, value: T, ttlSeconds: number): Promise<void>; delete(key: string): Promise<void>; }
export function cacheTtlForRisk(risk: CacheRisk): number {
  const values: Record<CacheRisk, number> = { public: 300, authenticated: 60, tenant: 30, sensitive: 0 };
  return values[risk];
}
export function cacheKey(organizationId: string | null, namespace: string, key: string): string {
  if (!organizationId || !namespace || !key || key.includes("..") || key.startsWith("/")) throw new Error("Invalid cache key");
  return [namespace, organizationId, key].join(":");
}
`
    : "";
  const rateLimit = plan.needsRateLimit
    ? `${sourceOfTruthBlock({ id: "starter.rate-limit.policy", keywords: "rate-limit, risk, distributed, fail-closed", what: "Risk-based rate-limit decision policy independent of the backing counter.", why: "Abuse controls must be stricter for sensitive or mutating actions and cannot be bypassed by a UI-only check.", when: "At the application boundary before an expensive, mutating, or provider-backed operation.", how: "evaluateRateLimit", boundaries: "Adapters provide atomic distributed counters; this policy never grants permissions." })}
export type RateLimitRisk = "read" | "write" | "auth" | "provider";
export interface RateLimitDecision { readonly allowed: boolean; readonly remaining: number; readonly retryAfterSeconds: number; }
export function evaluateRateLimit(input: { readonly risk: RateLimitRisk; readonly count: number; readonly nowEpochSeconds: number; readonly windowSeconds?: number }): RateLimitDecision {
  const limits: Record<RateLimitRisk, number> = { read: 120, write: 30, auth: 10, provider: 5 };
  const windowSeconds = input.windowSeconds ?? 60;
  if (!Number.isSafeInteger(input.count) || input.count < 0 || !Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) throw new Error("Invalid rate-limit counter");
  const limit = limits[input.risk];
  return { allowed: input.count < limit, remaining: Math.max(0, limit - input.count - 1), retryAfterSeconds: input.count < limit ? 0 : windowSeconds - (Math.max(0, input.nowEpochSeconds) % windowSeconds) };
}
`
    : "";
  const featureFlags = plan.needsFeatureFlags
    ? `${sourceOfTruthBlock({ id: "starter.feature-flags.authorization", keywords: "feature-flags, permission, audit, deny-by-default", what: "Typed feature-flag evaluation that cannot replace authorization.", why: "Flags control rollout and exposure, while permissions remain the authoritative security decision.", when: "A server-side application service evaluates an optional rollout after authorization has passed.", how: "evaluateFeatureFlag", boundaries: "The evaluator fails closed and never grants a permission or governance role." })}
export interface FeatureFlagDefinition { readonly key: string; readonly enabled: boolean; readonly requiredPermission?: Permission; readonly allowedSubjects?: readonly string[]; }
export function evaluateFeatureFlag(flag: FeatureFlagDefinition, actor: Pick<ActorContext, "subjectId" | "permissions">): boolean {
  if (!flag.enabled || !flag.key) return false;
  if (flag.requiredPermission !== undefined && !actor.permissions.includes(flag.requiredPermission)) return false;
  return flag.allowedSubjects === undefined || flag.allowedSubjects.includes(actor.subjectId);
}
`
    : "";
  const notifications = plan.needsNotifications
    ? `${sourceOfTruthBlock({ id: "starter.notifications.delivery-policy", keywords: "notifications, template, suppression, retry", what: "Versioned notification template and suppression policy for durable delivery.", why: "Notification retries must be safe and user preferences must suppress delivery without deleting durable application facts.", when: "A notification application service creates an in-app or provider delivery request.", how: "shouldSuppressNotification", boundaries: "Adapters deliver messages; this policy never logs message bodies or provider secrets." })}
export type NotificationChannel = "email" | "in-app";
export interface NotificationTemplate { readonly key: string; readonly version: number; readonly channel: NotificationChannel; readonly subject: string; readonly body: string; }
export interface NotificationDelivery { readonly idempotencyKey: string; readonly recipient: string; readonly channel: NotificationChannel; readonly template: NotificationTemplate; readonly variables: Readonly<Record<string, string>>; readonly organizationId?: string; }
export interface NotificationPort { deliver(input: NotificationDelivery): Promise<{ readonly deliveryId: string; readonly status: "queued" | "delivered" | "suppressed" }>; }
export function shouldSuppressNotification(input: { readonly disabled: boolean; readonly alreadyDelivered: boolean; readonly quietHours: boolean; }): boolean {
  return input.disabled || input.alreadyDelivered || input.quietHours;
}
export function renderNotificationTemplate(template: NotificationTemplate, variables: Readonly<Record<string, string>>): { readonly subject: string; readonly body: string; } {
  if (!template.key || template.version <= 0) throw new Error("Invalid notification template");
  const render = (value: string): string => value.replace(/\\{\\{([a-zA-Z0-9_.-]+)\\}\\}/gu, (_match, name: string) => variables[name] ?? "");
  return { subject: render(template.subject), body: render(template.body) };
}
`
    : "";
  const payments = plan.needsPayments
    ? `import { createHmac, timingSafeEqual } from "node:crypto";
${sourceOfTruthBlock({ id: "starter.payments.webhook-policy", keywords: "payments, webhook, signature, idempotency, state-machine", what: "Provider-neutral payment webhook verification and monotonic payment state transitions.", why: "Payment state changes must require a verified raw body, resist replay, and remain idempotent across duplicate deliveries.", when: "The payment transport receives a provider webhook before invoking an application service.", how: "verifySignedWebhook", boundaries: "Provider adapters supply secrets and normalized events; this owner never charges or refunds a provider." })}
export function verifySignedWebhook(rawBody: string, signature: string, secret: string, nowEpochSeconds: number, toleranceSeconds = 300): boolean {
  if (!rawBody || !signature || !secret || !Number.isSafeInteger(nowEpochSeconds) || toleranceSeconds <= 0) return false;
  const fields = new Map(signature.split(",").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = Number(fields.get("t"));
  const supplied = fields.get("v1");
  if (!Number.isSafeInteger(timestamp) || !supplied || Math.abs(nowEpochSeconds - timestamp) > toleranceSeconds || !/^[a-f0-9]{64}$/u.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(String(timestamp)).update(".").update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function verifyRazorpayWebhook(rawBody: string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret || !/^[a-f0-9]{64}$/u.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function verifyPaymentWebhook(provider: "stripe" | "razorpay", rawBody: string, signature: string, secret: string, nowEpochSeconds: number): boolean {
  return provider === "stripe" ? verifySignedWebhook(rawBody, signature, secret, nowEpochSeconds) : verifyRazorpayWebhook(rawBody, signature, secret);
}
export type PaymentState = "created" | "authorized" | "captured" | "refunded" | "failed";
export function nextPaymentState(current: PaymentState, event: "authorize" | "capture" | "refund" | "fail"): PaymentState {
  const transitions: Record<PaymentState, Partial<Record<"authorize" | "capture" | "refund" | "fail", PaymentState>>> = { created: { authorize: "authorized", fail: "failed" }, authorized: { capture: "captured", fail: "failed" }, captured: { refund: "refunded" }, refunded: {}, failed: {} };
  const next = transitions[current][event];
  if (!next) throw new Error("Invalid payment state transition");
  return next;
}
`
    : "";
  const search = plan.needsSearch
    ? `${sourceOfTruthBlock({ id: "starter.search.authorization", keywords: "search, tenant, authorization, tombstone", what: "Authorization-aware search document contract with tombstone handling.", why: "Search indexes are derived data and must not reveal documents after ownership or visibility changes.", when: "A search application service filters candidate documents before returning results.", how: "canReadSearchDocument", boundaries: "Index adapters may rank candidates but cannot bypass tenant or permission checks." })}
export interface SearchDocument { readonly id: string; readonly organizationId: string; readonly requiredPermission?: Permission; readonly tombstoned: boolean; readonly text: string; }
export interface SearchResult { readonly id: string; readonly score: number; readonly snippet: string; readonly sourceVersion: string; }
export interface SearchPort { search(input: { readonly organizationId: string; readonly query: string; readonly permissions: readonly Permission[]; readonly limit?: number }): Promise<readonly SearchResult[]>; index(input: SearchDocument & { readonly sourceVersion: string }): Promise<void>; tombstone(input: { readonly id: string; readonly organizationId: string }): Promise<void>; }
export function canReadSearchDocument(actor: Pick<ActorContext, "organizationId" | "permissions">, document: SearchDocument): boolean {
  return Boolean(actor.organizationId && actor.organizationId === document.organizationId && !document.tombstoned && (document.requiredPermission === undefined || actor.permissions.includes(document.requiredPermission)));
}
`
    : "";
  const rag = plan.needsRag
    ? `${sourceOfTruthBlock({ id: "starter.rag.citation-policy", keywords: "rag, chunking, citation, acl, embedding", what: "Deterministic text chunking and citation-integrity policy for ACL-safe retrieval.", why: "Retrieved context must remain traceable to authorized source chunks and deterministic ingestion versions.", when: "An ingestion or retrieval service prepares chunks or validates model citations.", how: "chunkText", boundaries: "Embedding and vector adapters operate on approved chunks; this policy does not fetch unauthorized source content." })}
export interface RagChunk { readonly id: string; readonly documentId: string; readonly ordinal: number; readonly text: string; readonly version: string; }
export interface RagRetrievalPort { retrieve(input: { readonly organizationId: string; readonly queryEmbedding: readonly number[]; readonly permissions: readonly Permission[]; readonly limit?: number }): Promise<readonly RagChunk[]>; index(input: RagChunk & { readonly organizationId: string; readonly embedding: readonly number[] }): Promise<void>; }
export function chunkText(documentId: string, text: string, version: string, maximumCharacters = 1200, overlapCharacters = 100): readonly RagChunk[] {
  if (!documentId || !version || maximumCharacters <= 0 || overlapCharacters < 0 || overlapCharacters >= maximumCharacters) throw new Error("Invalid RAG chunk policy");
  const chunks: RagChunk[] = [];
  let start = 0;
  let ordinal = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maximumCharacters);
    chunks.push({ id: [documentId, version, ordinal].join(":"), documentId, ordinal, text: text.slice(start, end), version });
    if (end === text.length) break;
    start = end - overlapCharacters;
    ordinal += 1;
  }
  return chunks;
}
export function validateCitations(citations: readonly string[], chunks: readonly RagChunk[]): boolean {
  const allowed = new Set(chunks.map((chunk) => chunk.id));
  return citations.length > 0 && citations.every((citation) => allowed.has(citation));
}
`
    : "";
  const owners = [
    ...(plan.needsIdentity ? ["AuthenticationPort", "IdentityRepository"] : []),
    ...(plan.needsWorker ? ["runIdempotentWorkflow"] : []),
    ...(plan.needsEvents ? ["OutboxPort"] : []),
    ...(plan.needsStorage ? ["defaultStoragePolicy"] : []),
    ...(plan.needsAi ? ["ToolRegistry"] : []),
    ...(plan.needsAi ? ["completeAiRun"] : []),
    ...(plan.needsTenancy ? ["DefaultAuthorizationService"] : []),
    ...(plan.needsObservability ? ["redactSensitive"] : []),
    ...(plan.needsCache ? ["cacheTtlForRisk"] : []),
    ...(plan.needsRateLimit ? ["evaluateRateLimit"] : []),
    ...(plan.needsFeatureFlags ? ["evaluateFeatureFlag"] : []),
    ...(plan.needsNotifications ? ["shouldSuppressNotification"] : []),
    ...(plan.needsPayments ? ["verifySignedWebhook"] : []),
    ...(plan.needsSearch ? ["canReadSearchDocument"] : []),
    ...(plan.needsRag ? ["chunkText"] : []),
  ];
  return textFile(
    "packages/core/src/index.ts",
    `${zodImport}${owners.length === 0 ? 'export const packageId = "core" as const;\n' : ""}${applicationBoundary}${identity}${jobs}${events}${storage}${ai}${tenancy}${observability}${cache}${rateLimit}${featureFlags}${notifications}${payments}${search}${rag}`,
  );
}

function migrationRunnerFile(plan: CapabilityPlan): GeneratedFile {
  return textFile(
    "packages/database/src/migrate.ts",
    `import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
${plan.needsWorker ? 'import { runMigrations as runGraphileWorkerMigrations } from "graphile-worker";' : ""}

try { process.loadEnvFile(resolve(process.cwd(), ".env")); } catch (error: unknown) {
  if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) throw error;
}
const appEnvironment = process.env.APP_ENV ?? "local";
const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
if (appEnvironment !== "local" && !migratorUrl) throw new Error("MIGRATOR_DATABASE_URL is required outside local development");
const databaseUrl = migratorUrl ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATOR_DATABASE_URL or local DATABASE_URL is required");
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const sql = postgres(databaseUrl, { max: 1 });
const checksum = (content: string): string => createHash("sha256").update(content).digest("hex");
const migrationName = (name: string): boolean => /^\\d{4}_[a-z0-9-]+\\.sql$/u.test(name);

try {
  await sql.unsafe("SET lock_timeout = '15s'");
  await sql.unsafe("SET statement_timeout = '5min'");
  await sql.unsafe("SELECT pg_advisory_lock(hashtextextended('thaarei:starter:migrations', 0))");
  await sql.unsafe("CREATE TABLE IF NOT EXISTS thaarei_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const appliedRows = await sql.unsafe("SELECT name, checksum FROM thaarei_migrations ORDER BY name");
  const applied = new Map<string, string>();
  for (const row of appliedRows) {
    if (typeof row.name !== "string" || typeof row.checksum !== "string") throw new Error("Migration ledger row is invalid");
    applied.set(row.name, row.checksum);
  }
  const files = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const invalidName = files.find((name) => !migrationName(name));
  if (invalidName) throw new Error(\`Invalid numbered migration filename: \${invalidName}\`);
  const missingFile = [...applied.keys()].find((name) => !files.includes(name));
  if (missingFile) throw new Error(\`Applied migration file is missing: \${missingFile}\`);
  for (const name of files) {
    const startedAt = performance.now();
    const content = await readFile(join(migrationsDirectory, name), "utf8");
    const digest = checksum(content);
    const previous = applied.get(name);
    if (previous) {
      if (previous !== digest) throw new Error(\`Migration checksum changed: \${name}\`);
      process.stdout.write(\`Skipping unchanged migration \${name}\\n\`);
      continue;
    }
    await sql.begin(async (transaction) => {
      await transaction.unsafe(content);
      await transaction.unsafe("INSERT INTO thaarei_migrations (name, checksum) VALUES ($1, $2)", [name, digest]);
    });
    process.stdout.write(\`{"migration":"\${name}","digest":"sha256:\${digest}","durationMs":\${Math.round(performance.now() - startedAt)}}\\n\`);
  }
${
  plan.needsWorker
    ? `  const workerMigrationStartedAt = performance.now();
  await runGraphileWorkerMigrations({ connectionString: databaseUrl });
  await sql.unsafe("GRANT USAGE ON SCHEMA graphile_worker TO starter_runtime");
  await sql.unsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO starter_runtime");
  await sql.unsafe("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA graphile_worker TO starter_runtime");
  await sql.unsafe("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO starter_runtime");
  process.stdout.write(\`{"migration":"graphile-worker@${DEPENDENCY_VERSIONS.graphileWorker}","durationMs":\${Math.round(performance.now() - workerMigrationStartedAt)}}\\n\`);
`
    : ""
}  process.stdout.write(files.length === applied.size ? "No migrations to apply (second run is a no-op)\\n" : "Migration run complete\\n");
} finally {
  try { await sql.unsafe("SELECT pg_advisory_unlock(hashtextextended('thaarei:starter:migrations', 0))"); } catch {}
  await sql.end({ timeout: 5 });
}
`,
  );
}

function databasePackageFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const drizzleImports = [
    ...(plan.needsEvents || plan.needsAi ? ["bigint"] : []),
    ...(plan.needsIdentity ? ["boolean"] : []),
    ...(plan.needsIdentity ? ["index"] : []),
    "pgTable",
    ...(plan.needsEvents ? ["jsonb"] : []),
    "text",
    ...(plan.needsIdentity || plan.needsStorage || plan.needsAi || plan.needsEvents
      ? ["integer"]
      : []),
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
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
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
export const authTwoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").default(false).notNull(),
  failedVerificationCount: integer("failed_verification_count").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
export const authPasskey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull().unique(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  aaguid: text("aaguid"),
});
export const authSchema = { user: authUser, session: authSession, account: authAccount, verification: authVerification, twoFactor: authTwoFactor, passkey: authPasskey };
export const applicationUsers = pgTable("application_users", { id: text("id").primaryKey(), authenticationSubjectId: text("authentication_subject_id").notNull().unique() });
`
    : "";
  const tenancyTables = plan.needsTenancy
    ? `
export const organizations = pgTable("organizations", { id: text("id").primaryKey(), name: text("name").notNull(), createdBySubjectId: text("created_by_subject_id").notNull() });
export const memberships = pgTable("memberships", { id: text("id").primaryKey(), userId: text("user_id").notNull(), organizationId: text("organization_id").notNull(), status: text("status").notNull() });
export const governanceRoleAssignments = pgTable("governance_role_assignments", { id: text("id").primaryKey(), membershipId: text("membership_id").notNull(), organizationId: text("organization_id").notNull(), role: text("role").notNull() });
export const productRoleAssignments = pgTable("product_role_assignments", { id: text("id").primaryKey(), membershipId: text("membership_id").notNull(), organizationId: text("organization_id").notNull(), role: text("role").notNull() });
export const permissionDefinitions = pgTable("permission_definitions", { id: text("id").primaryKey(), permission: text("permission").notNull().unique() });
export const permissionGrants = pgTable("permission_grants", { id: text("id").primaryKey(), membershipId: text("membership_id").notNull(), organizationId: text("organization_id").notNull(), permissionId: text("permission_id").notNull() });
export const invitations = pgTable("invitations", { id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), email: text("email").notNull(), tokenHash: text("token_hash").notNull().unique(), status: text("status").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull() });
export const authorizationAuditEvents = pgTable("authorization_audit_events", { id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), actorSubjectId: text("actor_subject_id").notNull(), action: text("action").notNull(), outcome: text("outcome").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() });
`
    : "";
  const aiTables = plan.needsAi
    ? `
export const aiApprovals = pgTable("ai_approvals", { id: text("id").primaryKey(), organizationId: text("organization_id"), toolName: text("tool_name").notNull(), subjectId: text("subject_id").notNull(), runId: text("run_id"), toolCallId: text("tool_call_id"), inputHash: text("input_hash"), maximumCostMicrousd: bigint("maximum_cost_microusd", { mode: "number" }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }) });
export const aiRuns = pgTable("ai_runs", { id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), subjectId: text("subject_id").notNull(), logicalModel: text("logical_model").notNull(), status: text("status").notNull(), correlationId: text("correlation_id").notNull() });
export const aiAttempts = pgTable("ai_attempts", { id: text("id").primaryKey(), runId: text("run_id").notNull(), attemptNumber: integer("attempt_number").notNull(), outcome: text("outcome").notNull() });
export const aiUsage = pgTable("ai_usage", { id: text("id").primaryKey(), runId: text("run_id").notNull(), inputTokens: integer("input_tokens").notNull(), outputTokens: integer("output_tokens").notNull(), costMicrousd: integer("cost_microusd").notNull() });
export const aiEvaluations = pgTable("ai_evaluations", { id: text("id").primaryKey(), name: text("name").notNull(), score: integer("score").notNull(), subjectId: text("subject_id").notNull() });
export const aiTelemetry = pgTable("ai_telemetry_events", { id: text("id").primaryKey(), toolName: text("tool_name").notNull(), subjectId: text("subject_id").notNull(), costMicrousd: integer("cost_microusd").notNull(), outcome: text("outcome").notNull() });
export const aiAuditEvents = pgTable("ai_audit_events", { id: text("id").primaryKey(), toolName: text("tool_name").notNull(), subjectId: text("subject_id").notNull(), costMicrousd: integer("cost_microusd").notNull(), outcome: text("outcome").notNull() });
export const agentToolCalls = pgTable("agent_tool_calls", { id: text("id").primaryKey(), runId: text("run_id").notNull(), toolName: text("tool_name").notNull(), risk: text("risk").notNull(), outcome: text("outcome").notNull() });
export const agentRunLeases = pgTable("agent_run_leases", { runId: text("run_id").primaryKey(), leaseToken: text("lease_token").notNull(), leaseOwner: text("lease_owner").notNull(), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(), fencingToken: bigint("fencing_token", { mode: "number" }).notNull() });
`
    : "";
  const storageTables = plan.needsStorage
    ? `
export const objectMetadata = pgTable("object_metadata", { key: text("key").primaryKey(), contentType: text("content_type").notNull(), byteLength: integer("byte_length").notNull(), subjectId: text("subject_id").notNull(), organizationId: text("organization_id")${plan.needsTenancy ? ".notNull()" : ""}, status: text("status").notNull().default("available") });
`
    : "";
  const jobTables = plan.needsWorker
    ? `
export const workflowRuns = pgTable("workflow_runs", { idempotencyKey: text("idempotency_key").primaryKey(), status: text("status").notNull(), claimToken: text("claim_token").notNull(), claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }).notNull() });
`
    : "";
  const eventTables = plan.needsEvents
    ? `
export const outboxEvents = pgTable("outbox_events", { id: text("id").primaryKey(), organizationId: text("organization_id"), type: text("type").notNull(), schemaVersion: integer("schema_version").notNull(), aggregateType: text("aggregate_type").notNull(), aggregateId: text("aggregate_id").notNull(), payload: jsonb("payload").notNull(), destination: text("destination").notNull(), idempotencyKey: text("idempotency_key").notNull(), status: text("status").notNull(), availableAt: timestamp("available_at", { withTimezone: true }).notNull(), attemptCount: integer("attempt_count").notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), fencingToken: bigint("fencing_token", { mode: "number" }).notNull(), correlationId: text("correlation_id").notNull(), causationId: text("causation_id") });
export const outboxDeliveryAttempts = pgTable("outbox_delivery_attempts", { id: text("id").primaryKey(), eventId: text("event_id").notNull(), attemptNumber: integer("attempt_number").notNull(), fencingToken: bigint("fencing_token", { mode: "number" }).notNull(), outcome: text("outcome").notNull(), normalizedFailure: text("normalized_failure"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() });
export const outboxDeadLetters = pgTable("outbox_dead_letters", { eventId: text("event_id").primaryKey(), organizationId: text("organization_id"), reason: text("reason").notNull(), replayedBySubjectId: text("replayed_by_subject_id"), replayedAt: timestamp("replayed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() });
export const inboxReceipts = pgTable("inbox_receipts", { id: text("id").primaryKey(), organizationId: text("organization_id"), consumer: text("consumer").notNull(), eventId: text("event_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull() });
`
    : "";
  const aiPersistence = plan.needsAi
    ? `
export function createInMemoryAiPersistence(): AiPersistence & { readonly evidence: () => readonly AiEvent[]; readonly evaluations: () => readonly { readonly name: string; readonly score: number; readonly subjectId: string }[] } {
  const approvals = new Map<string, Set<string>>();
  const scopedApprovals = new Map<string, { readonly expiresAt: number; readonly maximumCostUsd?: number }>();
  const events: AiEvent[] = [];
  const evaluations: Array<{ readonly name: string; readonly score: number; readonly subjectId: string }> = [];
  return {
    approve: async (toolName, subjectId, scope) => { const subjects = approvals.get(toolName) ?? new Set<string>(); subjects.add(subjectId); approvals.set(toolName, subjects); if (scope) scopedApprovals.set([scope.organizationId ?? "", scope.runId ?? "", toolName, subjectId, scope.inputHash ?? ""].join("\u0000"), { expiresAt: Date.now() + 15 * 60 * 1000, ...(scope.maximumCostUsd === undefined ? {} : { maximumCostUsd: scope.maximumCostUsd }) }); },
    isApproved: async (toolName, subjectId) => approvals.get(toolName)?.has(subjectId) ?? false,
    consumeApproval: async (scope) => { const key = [scope.organizationId ?? "", scope.runId ?? "", scope.toolName, scope.subjectId, scope.inputHash ?? ""].join("\u0000"); const approval = scopedApprovals.get(key); if (!approval || approval.expiresAt <= Date.now() || (scope.maximumCostUsd !== undefined && approval.maximumCostUsd !== undefined && scope.maximumCostUsd > approval.maximumCostUsd)) return false; scopedApprovals.delete(key); return true; },
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
    ...(plan.needsIdentity ? ["AssuranceLevel", "IdentityRepository"] : []),
    ...(plan.needsWorker ? ["WorkflowStore"] : []),
    ...(plan.needsEvents ? ["OutboxPort", "OutboxDeliveryPort"] : []),
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
  const eventDatabase = plan.needsEvents
    ? `
  const outbox: OutboxPort & OutboxDeliveryPort = {
    append: async (event, destination, idempotencyKey) => { await sql.unsafe("INSERT INTO outbox_events (id, organization_id, type, schema_version, aggregate_type, aggregate_id, payload, destination, idempotency_key, status, available_at, attempt_count, fencing_token, correlation_id, causation_id, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'available', now(), 0, 0, $10, $11, $12) ON CONFLICT (destination, idempotency_key) DO NOTHING", [event.id, event.organizationId ?? null, event.type, event.schemaVersion, event.aggregateType, event.aggregateId, JSON.stringify(event.payload), destination, idempotencyKey, event.correlationId, event.causationId ?? null, event.occurredAt]); },
    claim: async (eventId, leaseOwner, now, leaseMilliseconds) => { const rows = await sql.unsafe("UPDATE outbox_events SET status = 'processing', lease_owner = $2, lease_expires_at = $3, fencing_token = fencing_token + 1, attempt_count = attempt_count + 1 WHERE id = $1 AND (status = 'available' OR (status = 'processing' AND lease_expires_at <= $4)) RETURNING fencing_token", [eventId, leaseOwner, new Date(now.getTime() + leaseMilliseconds).toISOString(), now.toISOString()]); const token = rows[0]?.fencing_token; return typeof token === 'number' ? { fencingToken: token } : null; },
    recordAttempt: async (eventId, fencingToken, outcome, failure) => { await sql.unsafe("INSERT INTO outbox_delivery_attempts (id, event_id, attempt_number, fencing_token, outcome, normalized_failure) SELECT $1, id, attempt_count, $2, $3, $4 FROM outbox_events WHERE id = $5 AND fencing_token = $2 ON CONFLICT (event_id, attempt_number) DO NOTHING", [crypto.randomUUID(), fencingToken, outcome, failure ?? null, eventId]); },
    markDelivered: async (eventId, fencingToken) => { await sql.unsafe("UPDATE outbox_events SET status = 'delivered', lease_owner = NULL, lease_expires_at = NULL WHERE id = $1 AND status = 'processing' AND fencing_token = $2", [eventId, fencingToken]); },
    replay: async (eventId, actorSubjectId) => { await sql.unsafe("UPDATE outbox_events SET status = 'available', available_at = now(), lease_owner = NULL, lease_expires_at = NULL, last_failure = NULL WHERE id = $1 AND status = 'dead_letter'", [eventId]); await sql.unsafe("UPDATE outbox_dead_letters SET replayed_by_subject_id = $2, replayed_at = now() WHERE event_id = $1", [eventId, actorSubjectId]); },
  };
`
    : "";
  const identityDatabase = plan.needsIdentity
    ? `
  const identity: IdentityRepository = {
      ensureAuthenticationSubject: async (authenticationSubjectId) => {
      const existing = await identityDatabase.select().from(applicationUsers).where(eq(applicationUsers.authenticationSubjectId, authenticationSubjectId)).limit(1);
      if (existing[0]) return { subjectId: existing[0].id };
      const inserted = await identityDatabase.insert(applicationUsers).values({ id: crypto.randomUUID(), authenticationSubjectId }).onConflictDoNothing().returning({ id: applicationUsers.id });
      if (inserted[0]) return { subjectId: inserted[0].id };
      const concurrent = await identityDatabase.select().from(applicationUsers).where(eq(applicationUsers.authenticationSubjectId, authenticationSubjectId)).limit(1);
      if (!concurrent[0]) throw new Error("Failed to map authentication subject");
      return { subjectId: concurrent[0].id };
    },
    resolveAuthenticationSubject: async (authenticationSubjectId) => {
      const rows = await identityDatabase.select().from(applicationUsers).where(eq(applicationUsers.authenticationSubjectId, authenticationSubjectId)).limit(1);
      const row = rows[0];
      return row ? { subjectId: row.id } : null;
    },
  };
`
    : "";
  const metadataDatabase = plan.needsStorage
    ? plan.needsTenancy
      ? `
  const metadata: StorageMetadataStore = {
    record: async (input) => {
      const organizationId = input.organizationId;
      if (!organizationId) throw new Error("Tenant storage metadata requires an organization");
      await withOrganizationContext(sql, organizationId, input.subjectId, async (transaction) => {
        await transaction.unsafe("INSERT INTO object_metadata (key, content_type, byte_length, subject_id, organization_id, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, byte_length = EXCLUDED.byte_length, status = EXCLUDED.status WHERE object_metadata.subject_id = EXCLUDED.subject_id AND object_metadata.organization_id = EXCLUDED.organization_id", [input.key, input.contentType, input.byteLength, input.subjectId, organizationId, input.status ?? "available"]);
      });
    },
    find: async (input) => {
      const organizationId = input.organizationId;
      if (!organizationId) throw new Error("Tenant storage metadata requires an organization");
      return withOrganizationContext(sql, organizationId, input.subjectId, async (transaction) => {
        const rows = await transaction.unsafe("SELECT subject_id, content_type, byte_length, organization_id, status FROM object_metadata WHERE key = $1 AND subject_id = $2 AND organization_id = $3", [input.key, input.subjectId, organizationId]);
        const row = rows[0];
        return row && typeof row.subject_id === "string" && typeof row.content_type === "string" && typeof row.byte_length === "number" ? { key: input.key, subjectId: row.subject_id, contentType: row.content_type, byteLength: row.byte_length, ...(typeof row.organization_id === "string" ? { organizationId: row.organization_id } : {}), status: row.status === "pending" || row.status === "quarantined" ? row.status : "available" } : null;
      });
    },
  };
`
      : `
  const metadata: StorageMetadataStore = {
    record: async (input) => { await sql.unsafe("INSERT INTO object_metadata (key, content_type, byte_length, subject_id, organization_id, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, byte_length = EXCLUDED.byte_length, subject_id = EXCLUDED.subject_id, organization_id = EXCLUDED.organization_id, status = EXCLUDED.status", [input.key, input.contentType, input.byteLength, input.subjectId, input.organizationId ?? null, input.status ?? "available"]); },
    find: async (input) => {
      const rows = await sql.unsafe("SELECT subject_id, content_type, byte_length, organization_id, status FROM object_metadata WHERE key = $1", [input.key]);
      const row = rows[0];
      return row && typeof row.subject_id === "string" && typeof row.content_type === "string" && typeof row.byte_length === "number" ? { key: input.key, subjectId: row.subject_id, contentType: row.content_type, byteLength: row.byte_length, ...(typeof row.organization_id === "string" ? { organizationId: row.organization_id } : {}), status: row.status === "pending" || row.status === "quarantined" ? row.status : "available" } : null;
    },
  };
`
    : "";
  const aiDatabase = plan.needsAi
    ? `
  const ai: AiPersistence = {
    approve: async (toolName, subjectId, scope) => { await sql.unsafe("INSERT INTO ai_approvals (id, organization_id, tool_name, subject_id, input_hash, maximum_cost_microusd, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '15 minutes') ON CONFLICT DO NOTHING", [crypto.randomUUID(), scope?.organizationId ?? null, toolName, subjectId, scope?.inputHash ?? null, Math.round((scope?.maximumCostUsd ?? 0) * 1000000)]); },
    isApproved: async (toolName, subjectId) => { const rows = await sql.unsafe("SELECT tool_name FROM ai_approvals WHERE tool_name = $1 AND subject_id = $2", [toolName, subjectId]); return rows.length > 0; },
    consumeApproval: async (scope) => { const rows = await sql.unsafe("UPDATE ai_approvals SET consumed_at = now() WHERE tool_name = $1 AND subject_id = $2 AND (organization_id IS NULL OR organization_id = $3) AND (input_hash IS NULL OR input_hash = $4) AND consumed_at IS NULL AND expires_at > now() AND maximum_cost_microusd >= $5 RETURNING id", [scope.toolName, scope.subjectId, scope.organizationId ?? null, scope.inputHash ?? null, Math.round((scope.maximumCostUsd ?? 0) * 1000000)]); return rows.length > 0; },
    recordAudit: async (event) => { await sql.unsafe("INSERT INTO ai_audit_events (id, tool_name, subject_id, cost_microusd, outcome) VALUES ($1, $2, $3, $4, $5)", [crypto.randomUUID(), event.toolName, event.subjectId, Math.round(event.costUsd * 1_000_000), event.outcome]); },
    recordTelemetry: async (event) => { await sql.unsafe("INSERT INTO ai_telemetry_events (id, tool_name, subject_id, cost_microusd, outcome) VALUES ($1, $2, $3, $4, $5)", [crypto.randomUUID(), event.toolName, event.subjectId, Math.round(event.costUsd * 1_000_000), event.outcome]); },
    recordEvaluation: async (input) => { await sql.unsafe("INSERT INTO ai_evaluations (id, name, score, subject_id) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), input.name, Math.round(input.score * 1_000_000), input.subjectId]); },
  };
`
    : "";
  const tenantRuntime = plan.needsTenancy
    ? `
export async function withOrganizationContext<T>(sql: ReturnType<typeof postgres>, organizationId: string, subjectId: string, callback: (transaction: postgres.TransactionSql) => Promise<T>): Promise<T> {
  if (!organizationId || !subjectId) throw new Error("Tenant context requires organization and subject");
  const result = await sql.begin(async (transaction) => {
    await transaction.unsafe("SELECT set_config('app.organization_id', $1, true), set_config('app.subject_id', $2, true)", [organizationId, subjectId]);
    return callback(transaction);
  });
  return result as unknown as T;
}
`
    : "";
  const organizationDatabase = plan.needsTenancy
    ? `
  const organization = {
    hasMembership: async (subjectId: string, organizationId: string): Promise<boolean> => {
      return withOrganizationContext(sql, organizationId, subjectId, async (transaction) => {
        const rows = await transaction.unsafe("SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2 AND status = 'active' LIMIT 1", [subjectId, organizationId]);
        return rows.length > 0;
      });
    },
  };
`
    : "";
  return textFile(
    "packages/database/src/index.ts",
    `import postgres from "postgres";
${plan.needsIdentity ? 'import { eq } from "drizzle-orm";\nimport { drizzle } from "drizzle-orm/postgres-js";\n' : ""}import { ${drizzleImports} } from "drizzle-orm/pg-core";
${coreTypeImport}

${sourceOfTruthBlock({ id: "starter.database.schema", keywords: databaseKeywords, what: "Persistence schema, readiness, and repositories for selected capabilities.", why: "Durable state and provider sessions need one explicit persistence owner.", when: "Use for migrations, repositories, idempotency, and operational readiness.", how: databaseOwners, boundaries: "Apps compose this package; core and adapters must not import its driver directly." })}
export const starterHealth = pgTable("starter_health", { id: text("id").primaryKey() });
${identityTables}${tenancyTables}${jobTables}${eventTables}${storageTables}${aiTables}
export interface DatabaseRuntime {
  readonly checkReadiness: () => Promise<void>;
  readonly close: () => Promise<void>;
${plan.needsTenancy ? "  readonly withOrganizationContext: <T>(organizationId: string, subjectId: string, callback: (transaction: postgres.TransactionSql) => Promise<T>) => Promise<T>;\n" : ""}
${plan.needsTenancy ? "  readonly organization: { readonly hasMembership: (subjectId: string, organizationId: string) => Promise<boolean>; };\n" : ""}
${plan.needsEvents ? "  readonly outbox: OutboxPort & OutboxDeliveryPort;\n" : ""}
${plan.needsIdentity ? "  readonly authentication: { readonly database: ReturnType<typeof drizzle>; readonly schema: typeof authSchema; readonly recordAssurance: (sessionToken: string, assurance: AssuranceLevel) => Promise<void>; readonly resolveAssurance: (sessionToken: string) => Promise<{ readonly assurance: AssuranceLevel; readonly authenticatedAt: string } | null> };\n  readonly identity: IdentityRepository;\n" : ""}${plan.needsWorker ? "  readonly workflow: WorkflowStore;\n" : ""}${plan.needsStorage ? "  readonly metadata: StorageMetadataStore;\n" : ""}${plan.needsAi ? "  readonly ai: AiPersistence;\n" : ""}
}
export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}
${workflowRuntime}
${tenantRuntime}
export function createDatabaseRuntime(url = databaseUrl()): DatabaseRuntime {
  const sql = postgres(url, { max: 2 });
${organizationDatabase}
${plan.needsIdentity ? '  const authentication = { database: drizzle(sql, { schema: authSchema }), schema: authSchema, recordAssurance: async (sessionToken: string, assurance: AssuranceLevel) => { await sql.unsafe("INSERT INTO authentication_assurance (session_token, assurance, authenticated_at) VALUES ($1, $2, now()) ON CONFLICT (session_token) DO UPDATE SET assurance = EXCLUDED.assurance, authenticated_at = EXCLUDED.authenticated_at", [sessionToken, assurance]); }, resolveAssurance: async (sessionToken: string) => { const rows = await sql.unsafe("SELECT assurance, authenticated_at FROM authentication_assurance WHERE session_token = $1", [sessionToken]); const row = rows[0]; return row && typeof row.assurance === "string" && row.authenticated_at instanceof Date ? { assurance: row.assurance as AssuranceLevel, authenticatedAt: row.authenticated_at.toISOString() } : null; } };\n  const identityDatabase = drizzle(sql, { schema: { applicationUsers } });\n' : ""}${identityDatabase}${workflowDatabase}${eventDatabase}${metadataDatabase}${aiDatabase}
  return {
    checkReadiness: async () => { await sql.unsafe("SELECT 1"); },
    close: async () => { await sql.end({ timeout: 5 }); },
${plan.needsTenancy ? "    withOrganizationContext: (organizationId, subjectId, callback) => withOrganizationContext(sql, organizationId, subjectId, callback),\n    organization,\n" : ""}${plan.needsIdentity ? "    authentication,\n    identity,\n" : ""}${plan.needsWorker ? "    workflow,\n" : ""}${plan.needsEvents ? "    outbox,\n" : ""}${plan.needsStorage ? "    metadata,\n" : ""}${plan.needsAi ? "    ai,\n" : ""}  };
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
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { canPerformSensitiveAccountChange, type AssuranceLevel, type IdentityMailPort } from "${packageName(config, "core")}";
${sourceOfTruthBlock({ id: "starter.identity.authentication-adapter", keywords: "identity, authentication, better-auth, session", what: "Better Auth server adapter for authentication artifacts and session resolution.", why: "Authentication stays provider-owned while application identity and authorization remain separate.", when: "Compose the API authentication routes and request context.", how: "createBetterAuthAdapter", boundaries: "The adapter never grants application permissions from an authentication session alone." })}
export function createIdentityMailAdapter(input: { readonly provider: "mailpit" | "resend"; readonly from: string; readonly mailpitUrl?: string; readonly resendApiKey?: string; readonly fetch?: typeof fetch }): IdentityMailPort {
  const request = input.fetch ?? fetch;
  const send = async (message: { readonly email: string; readonly url: string; readonly kind: "verification" | "password-reset" }): Promise<void> => {
    const subject = message.kind === "verification" ? "Verify your email" : "Reset your password";
    const endpoint = input.provider === "resend" ? "https://api.resend.com/emails" : \`\${input.mailpitUrl ?? "http://127.0.0.1:8025"}/api/v1/send\`;
    if (input.provider === "resend" && !input.resendApiKey) throw new Error("IDENTITY_RESEND_API_KEY is required for Resend identity mail");
    const response = await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(input.resendApiKey ? { authorization: \`Bearer \${input.resendApiKey}\` } : {}) },
      body: JSON.stringify(input.provider === "resend"
        ? { from: input.from, to: [message.email], subject, html: \`<p><a href="\${message.url}">\${subject}</a></p>\` }
        : { From: { Email: input.from }, To: [{ Email: message.email }], Subject: subject, HTML: \`<p><a href="\${message.url}">\${subject}</a></p>\` }),
    });
    if (!response.ok) throw new Error(\`Identity mail provider rejected delivery: \${response.status}\`);
  };
  return {
    sendVerification: (message) => send({ ...message, kind: "verification" }),
    sendPasswordReset: (message) => send({ ...message, kind: "password-reset" }),
  };
}
export function assuranceForCompletedAuthenticationPath(path: string): AssuranceLevel {
  if (path === "/passkey/verify-authentication") return "phishing_resistant";
  if (path === "/two-factor/verify-totp") return "multi_factor";
  if (path === "/two-factor/verify-backup-code") return "recovery";
  return "single_factor";
}
const sensitiveAccountPaths = new Set([
  "/change-password",
  "/change-email",
  "/delete-user",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/passkey/add-passkey",
  "/passkey/delete-passkey",
]);
export function requiresRecentAccountAssurance(path: string): boolean {
  return sensitiveAccountPaths.has(path);
}
export function createBetterAuthAdapter(input: {
  readonly appName: string;
  readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins: readonly string[];
  readonly database: Parameters<typeof drizzleAdapter>[0];
  readonly schema: Record<string, unknown>;
  readonly identityMail: IdentityMailPort;
  readonly onUserCreated: (authenticationSubjectId: string) => Promise<void>;
  readonly recordAssurance: (sessionToken: string, assurance: AssuranceLevel) => Promise<void>;
  readonly resolveAssurance: (sessionToken: string) => Promise<{ readonly assurance: AssuranceLevel; readonly authenticatedAt: string } | null>;
}) {
  const auth = betterAuth({
    appName: input.appName,
    secret: input.secret,
    baseURL: input.baseURL,
    trustedOrigins: [...input.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => input.identityMail.sendPasswordReset({ email: user.email, url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => input.identityMail.sendVerification({ email: user.email, url }),
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 300, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    plugins: [twoFactor({ issuer: input.appName }), passkey()],
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(context.path)) {
          const body = context.body as { trustDevice?: unknown } | undefined;
          if (body?.trustDevice === true) throw new APIError("BAD_REQUEST", { message: "Trusted-device MFA bypass is disabled" });
        }
      }),
      after: createAuthMiddleware(async (context) => {
        const newSession = context.context.newSession;
        if (!newSession) return;
        const assurance = assuranceForCompletedAuthenticationPath(context.path);
        await input.recordAssurance(newSession.session.token, assurance);
      }),
    },
    database: drizzleAdapter(input.database, { provider: "pg", schema: input.schema }),
    databaseHooks: { user: { create: { after: async (user) => input.onUserCreated(user.id) } } },
  });
  const handler = async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const path = pathname.startsWith("/api/auth") ? pathname.slice("/api/auth".length) : pathname;
    if (requiresRecentAccountAssurance(path)) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.session?.token) return new Response(null, { status: 401 });
      const assurance = await input.resolveAssurance(session.session.token);
      if (!assurance || !canPerformSensitiveAccountChange(assurance)) {
        return Response.json({ code: "RECENT_ASSURANCE_REQUIRED" }, { status: 403 });
      }
    }
    return auth.handler(request);
  };
  return {
    auth,
    handler,
    resolveSession: async (headers: Headers) => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) return null;
      const assurance = await input.resolveAssurance(session.session.token);
      return { subjectId: session.user.id, assurance: assurance?.assurance ?? "single_factor", authenticatedAt: assurance?.authenticatedAt ?? session.session.createdAt.toISOString() };
    },
    listSessions: async (headers: Headers) => auth.api.listSessions({ headers }),
    revokeSession: async (headers: Headers, token: string) => { await auth.api.revokeSession({ headers, body: { token } }); },
    revokeAllSessions: async (headers: Headers) => { await auth.api.revokeSessions({ headers }); },
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
import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
${sourceOfTruthBlock({ id: "starter.storage.s3-adapter", keywords: "storage, s3, metadata, ownership, signed-url", what: "S3-compatible object operations behind application metadata and access policy.", why: "Bucket access must remain replaceable and subject-owned.", when: "Compose storage for authenticated API use cases.", how: "createS3Storage", boundaries: "Never return an object URL before policy and metadata ownership checks pass." })}
export function createS3Storage(input: { readonly bucket: string; readonly region: string; readonly endpoint?: string; readonly accessKeyId?: string; readonly secretAccessKey?: string; readonly metadata: StorageMetadataStore; readonly policy?: StoragePolicy; readonly send?: (command: unknown) => Promise<unknown>; readonly presign?: typeof createPresignedPost }): ObjectStorage & { readonly checkReadiness: () => Promise<void> } {
  const client = new S3Client({ region: input.region, ...(input.endpoint ? { endpoint: input.endpoint, forcePathStyle: true } : {}), ...(input.accessKeyId && input.secretAccessKey ? { credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey } } : {}) });
  const send = input.send ?? (async (command: unknown) => client.send(command as never));
  const policy = input.policy ?? defaultStoragePolicy;
  const presign = input.presign ?? createPresignedPost;
  return {
    checkReadiness: async () => { await send(new HeadBucketCommand({ Bucket: input.bucket })); },
    createUpload: async (value) => {
      validateStorageUpload(value, policy);
      const expiresIn = 900;
      const result = await presign(client, { Bucket: input.bucket, Key: value.key, Expires: expiresIn, Fields: { "Content-Type": value.contentType }, Conditions: [["content-length-range", 1, value.byteLength], ["eq", "$Content-Type", value.contentType]] });
      await input.metadata.record({ key: value.key, contentType: value.contentType, byteLength: value.byteLength, subjectId: value.subjectId, ...(value.organizationId ? { organizationId: value.organizationId } : {}), status: "pending" });
      return { url: result.url, fields: result.fields, key: value.key, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
    },
    completeUpload: async (value) => {
      if (!policy.authorize("complete-upload", value.key, value.subjectId, value.organizationId)) throw new Error("Storage policy denied upload completion");
      const existing = await input.metadata.find({ key: value.key, subjectId: value.subjectId, ...(value.organizationId ? { organizationId: value.organizationId } : {}) });
      if (!existing || existing.subjectId !== value.subjectId) throw new Error("Storage upload metadata missing");
      const head = await send(new HeadObjectCommand({ Bucket: input.bucket, Key: value.key }));
      const byteLength = typeof (head as { readonly ContentLength?: unknown }).ContentLength === "number" ? (head as { readonly ContentLength: number }).ContentLength : existing.byteLength;
      if (byteLength > policy.maximumBytes) throw new Error("Storage policy denied upload size");
      await input.metadata.record({ key: value.key, contentType: existing.contentType, byteLength, subjectId: value.subjectId, ...(existing.organizationId ? { organizationId: existing.organizationId } : {}), status: "available" });
      return { ...existing, byteLength, status: "available" };
    },
    put: async (value) => {
      validateStorageUpload({ key: value.key, contentType: value.contentType, byteLength: value.body.byteLength, subjectId: value.subjectId, ...(value.organizationId ? { organizationId: value.organizationId } : {}) }, policy);
      const existing = await input.metadata.find({ key: value.key, subjectId: value.subjectId, ...(value.organizationId ? { organizationId: value.organizationId } : {}) });
      if (existing && existing.subjectId !== value.subjectId) throw new Error("Storage object ownership denied");
      await send(new PutObjectCommand({ Bucket: input.bucket, Key: value.key, ContentType: value.contentType, Body: value.body }));
      await input.metadata.record({ key: value.key, contentType: value.contentType, byteLength: value.body.byteLength, subjectId: value.subjectId, ...(value.organizationId ? { organizationId: value.organizationId } : {}), status: "available" });
    },
    getUrl: async (value) => {
      if (!policy.authorize("get", value.key, value.subjectId, value.organizationId)) throw new Error("Storage policy denied object read");
      const metadata = await input.metadata.find({ key: value.key, subjectId: value.subjectId, ...(value.organizationId ? { organizationId: value.organizationId } : {}) });
      if (!metadata || metadata.subjectId !== value.subjectId || metadata.status !== "available") throw new Error("Storage object ownership denied");
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
  const platform =
    plan.needsPayments || plan.needsNotifications || plan.needsCache || plan.needsObservability
      ? `
export function createJsonProvider(input: { readonly baseUrl: string; readonly apiKey: string; readonly fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch;
  return { request: async (path: string, body: Readonly<Record<string, unknown>>) => {
    const response = await fetchImpl(new URL(path, input.baseUrl), { method: "POST", headers: { "content-type": "application/json", authorization: \`Bearer \${input.apiKey}\` }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(\`provider request failed: \${response.status}\`);
    return response.json() as Promise<unknown>;
  } };
}
${
  plan.needsCache
    ? `export function createValkeyCacheAdapter(input: { readonly execute: (command: string, args: readonly string[]) => Promise<unknown>; readonly organizationId: string }) {
  const prefix = (key: string) => cacheKey(input.organizationId, "starter", key);
  return {
    get: async <T>(key: string, parse: (value: unknown) => T): Promise<T | null> => {
      const value = await input.execute("GET", [prefix(key)]);
      if (typeof value !== "string") return null;
      return parse(JSON.parse(value));
    },
    set: async <T>(key: string, value: T, ttlSeconds: number): Promise<void> => {
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) throw new Error("Cache TTL is outside the bounded policy");
      await input.execute("SETEX", [prefix(key), String(ttlSeconds), JSON.stringify(value)]);
    },
    delete: async (key: string): Promise<void> => { await input.execute("DEL", [prefix(key)]); },
    checkReadiness: async (): Promise<void> => { await input.execute("PING", []); },
  } satisfies CachePort & { readonly checkReadiness: () => Promise<void> };
}
`
    : ""
}
${
  plan.needsRateLimit
    ? `export function createValkeyRateLimiter(input: { readonly increment: (key: string, windowSeconds: number) => Promise<number> }) {
  return { evaluate: async (risk: RateLimitRisk, key: string, nowEpochSeconds = Math.floor(Date.now() / 1000)): Promise<RateLimitDecision> => {
    try { return evaluateRateLimit({ risk, count: await input.increment(key, 60), nowEpochSeconds }); }
    catch { return { allowed: false, remaining: 0, retryAfterSeconds: 60 }; }
  } };
}
`
    : ""
}
${
  plan.needsNotifications
    ? `export function createResendEmailAdapter(input: { readonly apiKey: string; readonly baseUrl?: string; readonly fetchImpl?: typeof fetch }) {
  const provider = createJsonProvider({ baseUrl: input.baseUrl ?? "https://api.resend.com", apiKey: input.apiKey, ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) });
  return { send: (message: { readonly from: string; readonly to: readonly string[]; readonly subject: string; readonly html: string }) => provider.request("/emails", message as unknown as Readonly<Record<string, unknown>>) };
}
`
    : ""
}${
  plan.needsPayments
    ? `export function createStripePaymentAdapter(input: { readonly secretKey: string; readonly fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch;
  return { refund: async (paymentId: string, amountMinor?: number) => {
    const body = amountMinor === undefined ? "" : \`amount=\${amountMinor}\`;
    const payload = [body, body ? "&" : "", "payment_intent=", encodeURIComponent(paymentId)].join("");
    const response = await fetchImpl("https://api.stripe.com/v1/refunds", { method: "POST", headers: { authorization: \`Bearer \${input.secretKey}\`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": paymentId }, body: payload });
    if (!response.ok) throw new Error(\`stripe refund failed: \${response.status}\`);
    return response.json() as Promise<unknown>;
  } };
}
export function createRazorpayPaymentAdapter(input: { readonly keyId: string; readonly keySecret: string; readonly fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch;
  return { refund: async (paymentId: string, amountMinor: number) => {
    const response = await fetchImpl(["https://api.razorpay.com/v1/payments/", encodeURIComponent(paymentId), "/refund"].join(""), { method: "POST", headers: { authorization: \`Basic \${Buffer.from([input.keyId, input.keySecret].join(":")).toString("base64") }\`, "content-type": "application/json", "x-idempotency-key": paymentId }, body: JSON.stringify({ amount: amountMinor }) });
    if (!response.ok) throw new Error(\`razorpay refund failed: \${response.status}\`);
    return response.json() as Promise<unknown>;
  } };
}
`
    : ""
}${
  plan.needsObservability
    ? `export function createRedactedTelemetryExporter(input: { readonly send: (value: unknown) => Promise<void> }) {
  return { export: async (value: unknown) => input.send(redactSensitive(value)) };
}
`
    : ""
}
`
      : "";
  const storageTypeImport = plan.needsStorage
    ? `import type { ObjectStorage, StorageMetadataStore, StoragePolicy } from "${packageName(config, "core")}";\nimport { defaultStoragePolicy, validateStorageUpload } from "${packageName(config, "core")}";\n`
    : "";
  const observabilityTypeImport = plan.needsObservability
    ? `import { redactSensitive } from "${packageName(config, "core")}";\n`
    : "";
  const cacheTypeImport = plan.needsCache
    ? `import type { CachePort${plan.needsRateLimit ? ", RateLimitRisk, RateLimitDecision" : ""} } from "${packageName(config, "core")}";\nimport { cacheKey${plan.needsRateLimit ? ", evaluateRateLimit" : ""} } from "${packageName(config, "core")}";\n`
    : "";
  return textFile(
    "packages/adapters/src/index.ts",
    `${storageTypeImport}${observabilityTypeImport}${cacheTypeImport}${providerOwners ? "" : 'export const packageId = "adapters" as const;\n'}
${identity}${jobs}${storage}${ai}${platform}
`,
  );
}

function developerGuideFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const hasWeb = hasProfile(config, "web");
  const hasMobile = hasProfile(config, "mobile");
  const hasPython = hasProfile(config, "python");
  const modules = [
    ["@thaarei-technology/foundation", "exact private dependency", "shared primitives"],
    ["core", "ready baseline", "domain rules and ports"],
    ["contracts", "ready baseline", "Zod-backed wire contracts"],
    ...(plan.needsDatabase
      ? [["database", "ready baseline", "schema, repositories, migrations"] as const]
      : []),
    ...(plan.needsApi
      ? [
          [
            "api",
            "ready baseline",
            plan.needsIdentity
              ? "Fastify, tRPC, health, authentication transport"
              : "Fastify, tRPC, and health",
          ] as const,
        ]
      : []),
    ...(plan.needsApiClient
      ? [
          [
            "api-client",
            "ready baseline",
            plan.needsExternalApi
              ? "generated OpenAPI client types"
              : "typed tRPC application client",
          ] as const,
        ]
      : []),
    ...(plan.needsIdentity
      ? [
          [
            "identity",
            "ready baseline",
            "authentication adapter and application identity mapping",
          ] as const,
        ]
      : []),
    ["test-support", "ready baseline", "shared test helpers"],
    ...(hasWeb || hasMobile
      ? [["design-tokens", "ready baseline", "shared presentation tokens"] as const]
      : []),
    ["adapters", "scaffold", "replaceable provider integrations"],
    ...(hasWeb ? [["web", "scaffold", "browser application shell"] as const] : []),
    ...(hasMobile ? [["mobile", "scaffold", "native application shell"] as const] : []),
    ...(plan.needsWorker ? [["worker", "scaffold", "Graphile Worker process"] as const] : []),
    ...(plan.needsAi ? [["AI", "scaffold", "AI SDK adapter and tool budget policy"] as const] : []),
    ...(plan.needsTenancy
      ? [
          [
            "tenancy",
            "ready baseline",
            "organization authorization, RLS context, invitations, grants, and audit contracts",
          ] as const,
        ]
      : []),
    ...(plan.needsEvents
      ? [
          [
            "events",
            "ready baseline",
            "versioned outbox, inbox, lease, fencing, retry, and replay contracts",
          ] as const,
        ]
      : []),
    ...(hasProfile(config, "agentic-ai")
      ? [["durable AI", "scaffold", "durable job orchestration seam"] as const]
      : []),
    ...(plan.needsStorage
      ? [["storage", "scaffold", "object storage adapter and metadata persistence"] as const]
      : []),
    ...(plan.needsExternalApi
      ? [["external API", "ready baseline", "OpenAPI contract and generated client"] as const]
      : []),
    ...(hasPython ? [["python", "scaffold", "optional Python service boundary"] as const] : []),
    ...(plan.needsPayments
      ? [
          [
            "payments",
            "contract-validated",
            "Stripe/Razorpay-neutral signed webhook and state contracts",
          ] as const,
        ]
      : []),
    ...(plan.needsNotifications
      ? [
          [
            "notifications",
            "contract-validated",
            "versioned template, suppression, and delivery contracts",
          ] as const,
        ]
      : []),
    ...(plan.needsCache
      ? [
          [
            "cache",
            "contract-validated",
            "tenant namespacing, TTL, invalidation, and Valkey boundary",
          ] as const,
        ]
      : []),
    ...(plan.needsRateLimit
      ? [
          [
            "rate-limit",
            "contract-validated",
            "risk-tiered distributed fail-closed policy",
          ] as const,
        ]
      : []),
    ...(plan.needsSearch
      ? [
          [
            "search",
            "contract-validated",
            "FTS/trigram tenant filtering and tombstone contract",
          ] as const,
        ]
      : []),
    ...(plan.needsRag
      ? [
          [
            "rag",
            "contract-validated",
            "pgvector chunk provenance and citation verification",
          ] as const,
        ]
      : []),
    ...(plan.needsObservability
      ? [
          [
            "observability",
            "contract-validated",
            "redacted correlation and telemetry boundary",
          ] as const,
        ]
      : []),
    ...(plan.needsFeatureFlags
      ? [
          [
            "feature-flags",
            "contract-validated",
            "typed rollout evaluation downstream of authorization",
          ] as const,
        ]
      : []),
    [
      "product integrations",
      "deferred integration",
      "organization, RBAC, AI, jobs, storage, and deployment operations unless selected and implemented",
    ],
  ];
  const table = modules
    .map(([name, maturity, purpose]) => `| ${name} | ${maturity} | ${purpose} |`)
    .join("\n");
  const databaseCommands = plan.needsDatabase
    ? `    pnpm db:up
    pnpm db:migrate
${plan.needsStorage ? "    pnpm storage:up\n" : ""}`
    : "";
  const prerequisites = plan.needsDatabase
    ? `Use Node ${NODE_VERSION}, pnpm ${PNPM_VERSION}, and Docker. Copy .env.example to .env and never commit secrets.`
    : `Use Node ${NODE_VERSION} and pnpm ${PNPM_VERSION}. Copy .env.example to .env and never commit secrets.`;
  const architecture = [
    "Domain rules belong in packages/core, persistence belongs in packages/database when selected, and provider implementations belong in packages/adapters.",
    ...(plan.needsApi
      ? [
          "The API validates transport data and composes selected persistence and provider dependencies.",
        ]
      : []),
    ...(hasWeb && plan.needsApi && !plan.needsExternalApi
      ? [
          "Browser code uses the typed tRPC client. Server-only Next.js routes proxy selected API paths through API_INTERNAL_URL and preserve cookies.",
        ]
      : []),
    ...(hasWeb && plan.needsExternalApi
      ? [
          "The web profile is an application shell; the external API profile owns the OpenAPI contract and generated client types.",
        ]
      : []),
    ...(hasWeb && !plan.needsApi
      ? ["The web application imports shared presentation values from packages/design-tokens."]
      : []),
    ...(hasMobile
      ? ["The mobile application imports shared presentation values from packages/design-tokens."]
      : []),
    ...(plan.needsWorker ? ["The worker process executes selected durable background jobs."] : []),
    ...(hasPython
      ? ["The optional Python service remains behind its explicit service boundary."]
      : []),
  ].join(" ");
  const extensionRecipes = [
    "Add domain rules in packages/core.",
    ...(plan.needsApi ? ["Add typed procedures in packages/api."] : []),
    ...(plan.needsDatabase
      ? [
          "Add persistence changes as numbered migrations. Run pnpm db:migrate, and never edit an applied migration.",
        ]
      : []),
    "Add providers in packages/adapters behind an existing core port.",
    ...(hasWeb && plan.needsApiClient && !plan.needsExternalApi
      ? [
          "Extend the reference flow only after you understand the typed client and same-origin proxy.",
        ]
      : []),
    ...(plan.needsExternalApi
      ? ["Regenerate the OpenAPI client after changing the external contract."]
      : []),
    ...(plan.needsWorker
      ? ["Add background work through the jobs port and worker composition."]
      : []),
    ...(plan.needsStorage ? ["Implement storage behavior behind the core storage ports."] : []),
  ].join(" ");
  const troubleshooting = [
    ...(plan.needsApi
      ? ["Verify the API health endpoint and confirm that port 3001 is available."]
      : []),
    ...(hasWeb
      ? [
          "If the web app does not start, confirm that port 3000 is available and rerun pnpm dev:web.",
        ]
      : []),
    ...(hasWeb && plan.needsApi && !plan.needsExternalApi
      ? ["If proxied browser requests fail, check server-only API_INTERNAL_URL."]
      : []),
    ...(plan.needsIdentity
      ? ["Verify signup, signin, the session cookie, viewer mapping, and persisted identity rows."]
      : []),
    ...(plan.needsExternalApi
      ? ["Run pnpm check:generated when the OpenAPI client is stale."]
      : []),
    ...(plan.needsWorker
      ? ["Check worker logs and WORKER_CONCURRENCY for background job failures."]
      : []),
    ...(hasMobile ? ["Use the Expo development command when diagnosing the native shell."] : []),
  ].join(" ");
  return textFile(
    "docs/developer-guide.md",
    `# ${config.displayName} developer guide

This private repository is independently owned. Resolved profiles: ${plan.canonicalProfiles.map((profile) => `\`${profile}\``).join(", ")}.

## Prerequisites

${prerequisites}

## Quick start

    pnpm install --frozen-lockfile
${databaseCommands}    pnpm dev

## Commands and configuration

See environment-reference.md for the selected variables. pnpm dev starts selected applications.${hasWeb ? " The web uses port 3000." : ""}${plan.needsApi ? " The API uses port 3001." : ""} pnpm check runs formatting, governance, typecheck, build, and tests.
${plan.needsApi ? "pnpm dev:api starts API watch mode." : ""} ${hasProfile(config, "web") ? "pnpm dev:web starts the Next.js app." : ""} ${plan.needsWorker ? "pnpm dev:worker starts the worker on port 3002." : ""} ${hasProfile(config, "python") ? "pnpm dev:python starts the Python service on port 8000." : ""} ${plan.needsDatabase ? "pnpm db:down stops local containers." : ""} ${plan.needsStorage ? "pnpm storage:init creates the local object-storage bucket." : ""}

## Architecture and data flow

${architecture}

## Package ownership and maturity

| Module | Maturity | Ownership |
| --- | --- | --- |
${table}

ready baseline is runnable and typed. scaffold provides an extension seam. Deferred product integrations remain unclaimed.

## Extension recipes

${extensionRecipes}

## Validation and troubleshooting

Run pnpm check before handoff. If variables are missing, check the root .env. ${troubleshooting}${plan.needsDatabase ? " If readiness is degraded, run pnpm db:up and pnpm db:migrate. If a checksum is rejected, restore the applied file and create a new migration." : ""}

## Deferred gates

This handoff does not claim live deployment, backup restore, rollback, paid-provider delivery, or native-device proof. The generic starter contracts do not constitute an OmniDesk product implementation.
`,
  );
}

function environmentReferenceFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const portExample = plan.needsApi ? "3001" : "3000";
  const portPurpose = plan.needsApi
    ? hasProfile(config, "web")
      ? "API port; the selected web app uses 3000."
      : "API port."
    : "Selected application port; the web app uses 3000.";
  const values = [
    ["APP_ENV", "local", "Admission environment: local, ci, staging, or production."],
    ["NODE_ENV", "development", "Set by local development; production platform supplies it."],
    ["PORT", portExample, portPurpose],
    ...(plan.needsDatabase
      ? [
          [
            "DATABASE_URL",
            "postgres://starter_runtime:starter_runtime_local@127.0.0.1:5432/starter",
            "Non-owner runtime role; must not own schemas, migrate, or have BYPASSRLS.",
          ],
          [
            "MIGRATOR_DATABASE_URL",
            "postgres://starter_migrator:starter_migrator_local@127.0.0.1:5432/starter",
            "Dedicated environment-specific migrator role; never expose to application processes.",
          ] as const,
        ]
      : []),
    ...(plan.needsIdentity
      ? ([
          [
            "BETTER_AUTH_SECRET",
            "replace-with-a-local-secret",
            "Use generated high-entropy production secret.",
          ],
          [
            "BETTER_AUTH_URL",
            hasProfile(config, "web") ? "http://127.0.0.1:3000" : "http://127.0.0.1:3001",
            "Configure the browser-visible origin that serves the authentication path.",
          ],
          [
            "IDENTITY_MAIL_PROVIDER",
            "mailpit",
            "Use mailpit only in local/CI and resend in staging/production.",
          ],
          ["IDENTITY_FROM_EMAIL", "identity@example.test", "Use a verified sender in production."],
          ["IDENTITY_RESEND_API_KEY", "", "Required and secret when identity mail uses Resend."],
          ["IDENTITY_MAILPIT_URL", "http://127.0.0.1:8025", "Local and CI only."],
        ] as const)
      : []),
    ...(hasProfile(config, "web") && plan.needsApi
      ? [
          [
            "API_INTERNAL_URL",
            "http://127.0.0.1:3001",
            "Server-only proxy target; never public browser configuration.",
          ] as const,
        ]
      : []),
    ...(plan.needsWorker
      ? [["WORKER_PORT", "3002", "Worker health port; separate from the API port."] as const]
      : []),
    ...(plan.needsStorage
      ? [
          [
            "STORAGE_BUCKET",
            "starter",
            "Local MinIO bucket; use a managed bucket in production.",
          ] as const,
          ["STORAGE_REGION", "us-east-1", "S3-compatible region."] as const,
          [
            "STORAGE_ENDPOINT",
            "http://127.0.0.1:9000",
            "Local MinIO endpoint; omit for managed S3.",
          ] as const,
          [
            "STORAGE_ACCESS_KEY_ID",
            "starter_local",
            "Local-only credential; use a secret in production.",
          ] as const,
          [
            "STORAGE_SECRET_ACCESS_KEY",
            "starter_local_secret",
            "Local-only credential; use a secret in production.",
          ] as const,
        ]
      : []),
    ...(hasProfile(config, "python")
      ? [
          [
            "PYTHON_SERVICE_URL",
            "http://127.0.0.1:8000",
            "Optional Python service boundary.",
          ] as const,
          [
            "PYTHON_SERVICE_TOKEN",
            "fixture-python-token",
            "Worker-to-Python token; never log it.",
          ] as const,
        ]
      : []),
    ...(hasProfile(config, "payments")
      ? ([
          ["PAYMENT_PROVIDER", "fixture", "Select a configured payment adapter in production."],
          ["PAYMENT_WEBHOOK_SECRET", "replace-with-a-local-secret", "Never log webhook secrets."],
          ...(plan.providers.paymentProviders.includes("stripe")
            ? [
                [
                  "STRIPE_SECRET_KEY",
                  "",
                  "Optional Stripe contract credential; local fixtures are signed offline.",
                ],
              ]
            : []),
          ...(plan.providers.paymentProviders.includes("razorpay")
            ? [["RAZORPAY_KEY_ID", "", "Optional Razorpay key identifier."]]
            : []),
          ...(plan.providers.paymentProviders.includes("razorpay")
            ? [
                [
                  "RAZORPAY_KEY_SECRET",
                  "",
                  "Optional Razorpay contract credential; local fixtures are signed offline.",
                ],
              ]
            : []),
        ] as const)
      : []),
    ...(hasProfile(config, "notifications")
      ? ([
          [
            "RESEND_API_KEY",
            "fixture-only",
            "General notifications only; separate from identity mail.",
          ],
          ["MAILPIT_URL", "http://127.0.0.1:8025", "General-notification inspection endpoint."],
        ] as const)
      : []),
    ...(plan.providers.aiProviders.includes("openai")
      ? ([
          [
            "OPENAI_API_KEY",
            "",
            "Optional OpenAI key; deterministic local adapters do not call the provider.",
          ],
          ["OPENAI_BASE_URL", "", "Optional OpenAI-compatible contract endpoint."],
        ] as const)
      : []),
    ...(plan.providers.aiProviders.includes("anthropic")
      ? ([
          [
            "ANTHROPIC_API_KEY",
            "",
            "Optional Anthropic key; deterministic local adapters do not call the provider.",
          ],
          ["ANTHROPIC_BASE_URL", "", "Optional Anthropic-compatible contract endpoint."],
        ] as const)
      : []),
    ...(hasProfile(config, "cache")
      ? ([
          ["VALKEY_URL", "redis://127.0.0.1:6379", "Valkey is a cache, never authoritative state."],
        ] as const)
      : []),
    ...(hasProfile(config, "observability")
      ? ([
          ["OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318", "Local collector endpoint."],
          ["SENTRY_DSN", "", "Optional Sentry adapter DSN; do not commit a value."],
        ] as const)
      : []),
  ];
  const rows = values
    .map(([name, example, note]) => `| ${name} | ${example} | ${note} |`)
    .join("\n");
  return textFile(
    "docs/environment-reference.md",
    `# Environment reference

Copy .env.example to .env for local work. Production receives values from its deployment platform. Never commit secrets.

| Variable | Safe local example | Production requirement |
| --- | --- | --- |
${rows}
`,
  );
}

function localComposeFile(config: InitConfig, plan: CapabilityPlan): GeneratedFile {
  const selected = new Set(plan.canonicalProfiles);
  const selectedProfile = (profile: Profile): boolean => selected.has(profile);
  const includeStorage = plan.needsStorage;
  const storageServices = includeStorage
    ? `
  object-storage:
    profiles: ["experimental"]
    image: ${MINIO_IMAGE}
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: starter_local
      MINIO_ROOT_PASSWORD: starter_local_secret
    ports:
      - "127.0.0.1:\${STORAGE_PORT:-9000}:9000"
      - "127.0.0.1:\${STORAGE_CONSOLE_PORT:-9001}:9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 2s
      timeout: 5s
      retries: 20
    volumes:
      - starter-object-storage:/data
  object-storage-init:
    profiles: ["experimental"]
    image: ${MINIO_MC_IMAGE}
    depends_on:
      object-storage:
        condition: service_healthy
    entrypoint: ["/bin/sh", "-c"]
    command: >-
      "mc alias set local http://object-storage:9000 starter_local starter_local_secret
      && mc mb --ignore-existing local/starter"
    restart: "no"
`
    : "";
  const cacheServices = selectedProfile("cache")
    ? `
  valkey:
    image: ${IMAGE_CATALOG.valkey.reference}@${IMAGE_CATALOG.valkey.digest}
    ports:
      - "127.0.0.1:\${VALKEY_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 2s
      timeout: 5s
      retries: 20
    volumes:
      - starter-valkey-data:/data
`
    : "";
  const notificationServices =
    selectedProfile("identity") || selectedProfile("notifications")
      ? `
  mailpit:
    image: ${IMAGE_CATALOG.mailpit.reference}@${IMAGE_CATALOG.mailpit.digest}
    ports:
      - "127.0.0.1:\${MAILPIT_SMTP_PORT:-1025}:1025"
      - "127.0.0.1:\${MAILPIT_UI_PORT:-8025}:8025"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8025/api/v1/info"]
      interval: 2s
      timeout: 5s
      retries: 20
`
      : "";
  const observabilityServices = selectedProfile("observability")
    ? `
  otel-collector:
    image: ${IMAGE_CATALOG.otelCollector.reference}@${IMAGE_CATALOG.otelCollector.digest}
    ports:
      - "127.0.0.1:\${OTEL_HEALTH_PORT:-13133}:13133"
`
    : "";
  const postgresImage = selectedProfile("rag")
    ? `${IMAGE_CATALOG.pgvectorPostgresql.reference}@${IMAGE_CATALOG.pgvectorPostgresql.digest}`
    : POSTGRES_IMAGE;
  const postgresService = plan.needsDatabase
    ? `services:
  postgres:
    image: ${postgresImage}
    restart: unless-stopped
    environment:
      POSTGRES_DB: starter
      POSTGRES_USER: starter_admin
      POSTGRES_PASSWORD: starter_admin_local
    ports:
      - "127.0.0.1:\${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U starter_admin -d starter"]
      interval: 2s
      timeout: 5s
      retries: 20
    volumes:
      - starter-postgres-data:/var/lib/postgresql
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/001-roles.sql:ro
`
    : "services:\n";
  const volumes = [
    ...(plan.needsDatabase ? ["  starter-postgres-data:"] : []),
    ...(includeStorage ? ["  starter-object-storage:"] : []),
    ...(selectedProfile("cache") ? ["  starter-valkey-data:"] : []),
  ];
  return textFile(
    "compose.yaml",
    `name: ${config.productId}\n${postgresService}${storageServices}${cacheServices}${notificationServices}${observabilityServices}${volumes.length > 0 ? `volumes:\n${volumes.join("\n")}\n` : ""}
`,
  );
}

function devCleanFile(config: InitConfig): GeneratedFile {
  return textFile(
    "tooling/dev-clean.ts",
    `import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("dev:clean requires an interactive terminal");
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const answer = await terminal.question("Type ${config.productId} to delete this project's retained development volumes: ");
terminal.close();
if (answer !== "${config.productId}") throw new Error("Confirmation did not match; no volumes were deleted");
const child = spawn("docker", ["compose", "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
const exitCode = await new Promise<number>((resolveExit) => child.once("exit", (code) => resolveExit(code ?? 1)));
if (exitCode !== 0) process.exitCode = exitCode;
`,
  );
}

function supplyChainWorkflowFile(plan: CapabilityPlan): GeneratedFile {
  const matrix = plan.deployableApps.map((application) => ({
    application,
    dockerfile:
      application === "python" ? "services/python/Dockerfile" : `apps/${application}/Dockerfile`,
  }));
  return textFile(
    ".github/workflows/supply-chain.yml",
    `name: Build and attest immutable images

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: ${JSON.stringify({ include: matrix })}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa
        with:
          version: ${PNPM_VERSION}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm config set "//npm.pkg.github.com/:_authToken" "$GITHUB_TOKEN"
        env:
          GITHUB_TOKEN: \${{ github.token }}
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm validate:starter
      - name: Record dependency vulnerability report
        run: ${plan.profiles.includes("mobile") ? "pnpm audit --prod --json > dependency-vulnerabilities.json || (cp dependency-vulnerabilities.json .thaarei/pnpm-audit.json && pnpm security:waiver-check)" : "pnpm audit --prod --json > dependency-vulnerabilities.json"}
      - uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ github.token }}
      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f
      - id: image
        shell: bash
        run: echo "image=ghcr.io/\${GITHUB_REPOSITORY,,}-\${{ matrix.application }}" >> "$GITHUB_OUTPUT"
      - id: build
        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
        with:
          context: .
          file: \${{ matrix.dockerfile }}
          push: true
          tags: \${{ steps.image.outputs.image }}:\${{ github.sha }}
      - uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610
        with:
          image: \${{ steps.image.outputs.image }}@\${{ steps.build.outputs.digest }}
          format: spdx-json
          output-file: sbom.spdx.json
          artifact-name: sbom-\${{ matrix.application }}.spdx.json
      - uses: actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a
        with:
          subject-name: \${{ steps.image.outputs.image }}
          subject-digest: \${{ steps.build.outputs.digest }}
          push-to-registry: true
      - name: Verify registry attestation before recording evidence
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh attestation verify "oci://\${{ steps.image.outputs.image }}@\${{ steps.build.outputs.digest }}" --repo "$GITHUB_REPOSITORY"
      - name: Record immutable application digest
        shell: bash
        run: printf '{"application":"%s","image":"%s","digest":"%s","sourceCommit":"%s"}\\n' "\${{ matrix.application }}" "\${{ steps.image.outputs.image }}" "\${{ steps.build.outputs.digest }}" "$GITHUB_SHA" > application-image.json
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: release-evidence-\${{ matrix.application }}
          path: |
            application-image.json
            dependency-vulnerabilities.json
            sbom.spdx.json
          if-no-files-found: error
          retention-days: 30
`,
  );
}

function baseFiles(config: InitConfig, plan: CapabilityPlan): GeneratedFile[] {
  const identity = productIdentity(config);
  const releasePackages = plan.testedPackages;
  const files: GeneratedFile[] = [
    jsonFile("package.json", {
      name: packageName(config, config.productId),
      private: true,
      version: PACKAGE_VERSION,
      type: "module",
      packageManager: `pnpm@${PNPM_VERSION}`,
      engines: { node: "24.20.x" },
      scripts: {
        build: hasProfile(config, "mobile")
          ? `turbo run build --filter=!${packageName(config, "mobile-app")}`
          : "turbo run build",
        ...(hasProfile(config, "mobile")
          ? { "build:mobile": `pnpm --filter ${packageName(config, "mobile-app")} build` }
          : {}),
        "dev:deps": `docker compose${resolveCapabilities(plan.profiles, plan.providers).definitions.some((definition) => definition.sourceMaturity === "experimental" && definition.localServices.length > 0) ? " --profile experimental" : ""} up -d`,
        dev: `pnpm dev:deps && turbo run dev --parallel`,
        "dev:full": `pnpm dev:deps && turbo run dev --parallel`,
        "dev:down": "docker compose down --remove-orphans",
        "dev:clean": "tsx tooling/dev-clean.ts",
        ...(plan.needsApi
          ? { "dev:api": `pnpm --filter ${packageName(config, "api-app")} dev` }
          : {}),
        ...(hasProfile(config, "web")
          ? { "dev:web": `pnpm --filter ${packageName(config, "web-app")} dev` }
          : {}),
        ...(plan.needsWorker
          ? { "dev:worker": `pnpm --filter ${packageName(config, "worker-app")} dev` }
          : {}),
        ...(hasProfile(config, "python")
          ? { "dev:python": "python3 services/python/src/main.py" }
          : {}),
        ...(plan.needsDatabase
          ? {
              "db:up": "docker compose up -d postgres",
              "db:migrate": "tsx packages/database/src/migrate.ts",
              "db:down": "docker compose down",
            }
          : {}),
        ...(plan.needsStorage
          ? {
              "storage:up": "docker compose up -d object-storage object-storage-init",
              "storage:init": "docker compose run --rm object-storage-init",
              "storage:down": "docker compose stop object-storage object-storage-init",
            }
          : {}),
        ...(hasProfile(config, "web") ? { "smoke:web": "tsx tooling/smoke-web.ts" } : {}),
        "check:boundaries": "tsx tooling/governance/src/cli.ts check:boundaries",
        "check:implementation": "tsx tooling/governance/src/cli.ts check:implementation",
        ...(hasProfile(config, "python")
          ? { "check:python": "python3 -m compileall -q services/python/src" }
          : {}),
        "check:source-of-truth": "tsx tooling/governance/src/cli.ts check:source-of-truth",
        ...(plan.needsDatabase ? { "check:migrations": "tsx tooling/check-migrations.ts" } : {}),
        "release:check": "tsx tooling/release/check-release.ts",
        ...(hasProfile(config, "mobile")
          ? { "security:waiver-check": "tsx tooling/security/check-waivers.ts" }
          : {}),
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
        "validate:product": "pnpm check",
      },
      devDependencies: {
        "@thaarei-technology/tooling": TOOLING_VERSION,
        "@biomejs/biome": DEPENDENCY_VERSIONS.biome,
        ...(hasProfile(config, "external-api")
          ? { "@hey-api/openapi-ts": DEPENDENCY_VERSIONS.openapiClient }
          : {}),
        "@types/node": DEPENDENCY_VERSIONS.nodeTypes,
        tsx: DEPENDENCY_VERSIONS.tsx,
        turbo: DEPENDENCY_VERSIONS.turbo,
        typescript: DEPENDENCY_VERSIONS.typescript,
        vitest: DEPENDENCY_VERSIONS.vitest,
        ...(config.deployment === "railway" ? { railway: DEPENDENCY_VERSIONS.railway } : {}),
      },
    }),
    jsonFile("pnpm-workspace.yaml", {
      packages: ["packages/*", "apps/*"],
      forceLegacyDeploy: true,
      allowBuilds: { esbuild: true },
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
    textFile(
      "vitest.config.ts",
      `import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const packages = ${JSON.stringify(
        [
          "core",
          "contracts",
          "adapters",
          "test-support",
          ...(plan.needsDatabase ? ["database"] : []),
          ...(plan.needsApi ? ["api"] : []),
          ...(plan.needsApiClient ? ["api-client"] : []),
          ...(hasProfile(config, "web") || hasProfile(config, "mobile") ? ["design-tokens"] : []),
        ].map((name) => [packageName(config, name), name]),
      )} as const;

export default defineConfig({
  resolve: { alias: Object.fromEntries(packages.map(([name, directory]) => [name, resolve(root, "packages", directory, "src", "index.ts")])) },
  test: { include: ["packages/**/tests/**/*.test.ts"], testTimeout: 30_000 },
});
`,
    ),
    jsonFile("turbo.json", {
      $schema: "https://turbo.build/schema.json",
      tasks: {
        build: { dependsOn: ["^build"], outputs: ["dist/**", ".next/**", "!**/.next/cache/**"] },
        dev: { cache: false, persistent: true },
        typecheck: { dependsOn: ["^typecheck"] },
      },
    }),
    jsonFile("biome.jsonc", {
      $schema: "https://biomejs.dev/schemas/2.5.9/schema.json",
      files: {
        includes: [
          "**",
          "!!node_modules",
          "!!**/dist",
          "!!**/.next",
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
    textFile(
      ".npmrc",
      "save-exact=true\nprefer-frozen-lockfile=true\n@thaarei-technology:registry=https://npm.pkg.github.com\nalways-auth=true\n",
    ),
    textFile(".gitignore", "node_modules\ndist\n.next\n.turbo\n.env\n"),
    textFile(
      ".dockerignore",
      `.git\n.github\n${identity.namespace}\n.turbo\nnode_modules\n**/node_modules\n**/dist\n**/.next\ncoverage\n*.log\n.env\n.env.*\n!.env.example\n`,
    ),
    textFile(
      "README.md",
      `# ${config.displayName}\n\nPrivate, independently owned ${config.displayName} application. Resolved profiles: ${plan.canonicalProfiles.join(", ") || "base"}.\n\n## Start here\n\nRead docs/developer-guide.md, copy .env.example to .env, then run pnpm install --frozen-lockfile and pnpm dev.${plan.needsDatabase ? " Data-enabled projects also run pnpm db:up and pnpm db:migrate." : ""}\n`,
    ),
    developerGuideFile(config, plan),
    environmentReferenceFile(config, plan),
    ...(plan.needsDatabase || plan.localServices.length > 0
      ? [localComposeFile(config, plan), devCleanFile(config)]
      : []),
    ...(plan.needsDatabase
      ? [
          textFile(
            "docker/postgres/init.sql",
            `CREATE ROLE starter_migrator LOGIN PASSWORD 'starter_migrator_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE starter_runtime LOGIN PASSWORD 'starter_runtime_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
	GRANT CONNECT ON DATABASE starter TO starter_migrator, starter_runtime;
	GRANT CREATE ON DATABASE starter TO starter_migrator;
GRANT CREATE, USAGE ON SCHEMA public TO starter_migrator;
GRANT USAGE ON SCHEMA public TO starter_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE starter_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO starter_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE starter_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO starter_runtime;
`,
          ),
        ]
      : []),
    ...(hasProfile(config, "web")
      ? [
          textFile(
            "tooling/smoke-web.ts",
            `const response = await fetch("http://127.0.0.1:3000");\nif (!response.ok) throw new Error(\`web smoke failed: \${response.status}\`);\nprocess.stdout.write("web smoke passed\\n");\n`,
          ),
        ]
      : []),
    textFile(
      `${identity.namespace}/work/${identity.workPrefix}-INIT-001.md`,
      `---\nworkId: INIT-001\ntitle: ${stringLiteral(`Initialize ${config.displayName}`)}\norigin: starter:init\nstatus: in_progress\nowner: ${stringLiteral(config.technicalOwner)}\ncreatedAt: 2026-08-19\nupdatedAt: 2026-08-19\nsourceOfTruthIds: []\naffectedPaths:\n  - apps/\n  - packages/\n  - deployment/\n---\n\n# Initialize ${config.displayName}\n\n## Objective\n\nValidate the generated repository and record environment-specific evidence.\n\n## Scope\n\nGenerated profiles and the selected deployment adapter.\n\n## Non-goals\n\nLive production deployment without separate approval and evidence.\n\n## Acceptance criteria\n\n- [ ] Local checks pass.\n- [ ] Selected deployment gates have evidence.\n\n## Validation\n\nPending.\n\n## Evidence\n\nGenerated by starter:init with profiles: ${config.profiles.join(", ") || "base"}.\n\n## Decisions\n\nDeployment target: ${config.deployment}.\n\n## Blockers\n\nLive deployment and native mobile gates require their target environments.\n\n## Handoff\n\n${config.technicalOwner} owns technical validation. ${config.operationsOwner} owns operational validation.\n\n## Completion\n\nIncomplete.\n`,
    ),
    textFile(
      "IMPLEMENTATION.md",
      `<!-- GENERATED FILE. Run \`pnpm implementation:sync\`. Do not edit. -->\n\n# Implementation Dashboard\n\nCanonical records: \`.thaarei/work/*.md\`.\n\n## INIT-001: Initialize ${config.displayName}\n\n- Status: in_progress\n- Owner: ${config.technicalOwner}\n- Updated: 2026-08-19\n- Paths: apps/, packages/, deployment/\n`,
    ),
    textFile(
      ".github/workflows/product-validation.yml",
      `name: Starter validation\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n  packages: read\n\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n      - uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa\n        with:\n          version: ${PNPM_VERSION}\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version-file: .nvmrc\n          cache: pnpm\n      - run: pnpm config set "//npm.pkg.github.com/:_authToken" "$GITHUB_TOKEN"\n        env:\n          GITHUB_TOKEN: \${{ github.token }}\n      - run: pnpm install --frozen-lockfile --ignore-scripts\n      - run: ${hasProfile(config, "mobile") ? "pnpm audit --prod --audit-level high --json > .thaarei/pnpm-audit.json || pnpm security:waiver-check" : "pnpm audit --prod --audit-level high"}\n${hasProfile(config, "python") ? "      - run: docker build --file services/python/Dockerfile .\n" : ""}      - run: pnpm validate:starter\n`,
    ),
    ...(plan.deployableApps.length > 0 ? [supplyChainWorkflowFile(plan)] : []),
    jsonFile(`${identity.namespace}/capabilities.json`, {
      schemaVersion: 2,
      requestedProfiles: config.profiles,
      profiles: plan.canonicalProfiles,
      deprecatedAliases: plan.deprecatedAliases,
      providers: plan.providers,
      environment: plan.capabilityEnvironment,
      fixtures: plan.capabilityFixtures,
      localServices: plan.localServices,
    }),
    jsonFile("release-manifest.json", {
      $schema: "./tooling/release/release-manifest.schema.json",
      schemaVersion: 2,
      release: `${PACKAGE_VERSION}-dev.1`,
      status: "prerelease",
      releasedAt: null,
      runtime: { node: NODE_VERSION, pnpm: PNPM_VERSION },
      approvedMajors: approvedMajors(releasePackages),
      testedPackages: releasePackages,
      containerImages: {
        node: {
          reference: IMAGE_CATALOG.node.reference,
          digest: IMAGE_CATALOG.node.digest,
        },
        ...(plan.needsDatabase
          ? {
              postgresql: {
                reference: hasProfile(config, "rag")
                  ? IMAGE_CATALOG.pgvectorPostgresql.reference
                  : IMAGE_CATALOG.postgresql.reference,
                digest: hasProfile(config, "rag")
                  ? IMAGE_CATALOG.pgvectorPostgresql.digest
                  : IMAGE_CATALOG.postgresql.digest,
              },
            }
          : {}),
        ...(hasProfile(config, "python")
          ? {
              python: {
                reference: IMAGE_CATALOG.python.reference,
                digest: IMAGE_CATALOG.python.digest,
              },
            }
          : {}),
        ...(plan.needsStorage
          ? {
              minio: {
                reference: IMAGE_CATALOG.minio.reference,
                digest: IMAGE_CATALOG.minio.digest,
              },
              minioClient: {
                reference: IMAGE_CATALOG.minioMc.reference,
                digest: IMAGE_CATALOG.minioMc.digest,
              },
            }
          : {}),
        ...(plan.needsCache
          ? {
              valkey: {
                reference: IMAGE_CATALOG.valkey.reference,
                digest: IMAGE_CATALOG.valkey.digest,
              },
            }
          : {}),
        ...(plan.needsNotifications
          ? {
              mailpit: {
                reference: IMAGE_CATALOG.mailpit.reference,
                digest: IMAGE_CATALOG.mailpit.digest,
              },
            }
          : {}),
        ...(plan.needsObservability
          ? {
              otelCollector: {
                reference: IMAGE_CATALOG.otelCollector.reference,
                digest: IMAGE_CATALOG.otelCollector.digest,
              },
            }
          : {}),
      },
      enabledProfiles: plan.canonicalProfiles,
      compatibilityEvidence: [
        {
          gate: "generated-fixture-validation",
          status: "pending",
          evidence: "Run pnpm check and record the result in INIT-001.",
        },
        ...(hasProfile(config, "web") &&
        hasProfile(config, "api") &&
        hasProfile(config, "data") &&
        hasProfile(config, "identity")
          ? [
              {
                gate: "web-developer-handoff",
                status: "passed" as const,
                evidence:
                  "The starter's dedicated web, API, data, and identity fixture passed typed proxy, authentication, persistence, migration, build, and container checks under Node 24.20.0.",
              },
            ]
          : []),
        {
          gate:
            config.deployment === "railway"
              ? "beta-deployment-and-recovery"
              : "deployment-and-recovery",
          status: "blocked_external",
          evidence:
            "Requires a disposable selected deployment environment and restore/rollback proof.",
        },
        ...(hasProfile(config, "mobile") && hasProfile(config, "identity")
          ? [
              {
                gate: "experimental-better-auth-expo-native-build",
                status: "blocked_external" as const,
                evidence: "Requires iOS and Android development-build proof.",
              },
            ]
          : []),
      ],
      qualifications: [
        ...resolveCapabilities(plan.profiles, plan.providers).definitions.map((definition) => ({
          id: definition.id,
          sourceMaturity: definition.sourceMaturity,
          productionPolicy: definition.productionPolicy,
          qualification: definition.productionPolicy === "forbidden" ? "blocked" : "unqualified",
          requiredGates: definition.requiredGates,
        })),
        {
          id: `${config.deployment}-${config.topology ?? "standard"}`,
          sourceMaturity: config.deployment === "railway" ? "beta" : "stable",
          productionPolicy:
            config.deployment === "railway"
              ? "requires_product_qualification"
              : "starter_qualified",
          qualification: config.deployment === "railway" ? "blocked" : "unqualified",
          requiredGates: ["deploy", "migration", "rollback", "restore", "monitoring"],
        },
      ],
      evidence: [],
      securityWaivers: hasProfile(config, "mobile")
        ? [
            {
              id: "mobile-image-size-2026-09",
              advisoryIds: ["GHSA-5p2g-fcmc-qvqq"],
              affectedSubject: { kind: "fixture", id: "experimental-mobile" },
              expiresAt: MOBILE_WAIVER_EXPIRES_AT,
              blocksProduction: true,
            },
          ]
        : [],
    }),
    jsonFile("tooling/release/release-manifest.schema.json", generatedReleaseSchema()),
    generatedReleaseChecker(),
    ...(hasProfile(config, "mobile") ? [generatedSecurityWaiverChecker()] : []),
    ...(hasProfile(config, "mobile")
      ? [
          jsonFile(`${identity.namespace}/security-waivers.json`, {
            schemaVersion: 1,
            waivers: [
              {
                id: "mobile-image-size-2026-09",
                advisoryIds: ["GHSA-5p2g-fcmc-qvqq"],
                severity: "high",
                affectedSubject: { kind: "fixture", id: "experimental-mobile" },
                dependencyPath: ["expo", "@expo/metro-config", "image-size@2.0.2"],
                reachability:
                  "The parser is reachable only while Metro processes generated mobile build assets; it is absent from stable packages and stable generated repositories.",
                controls: [
                  "Never process untrusted image assets through the affected parser.",
                  "Use version-controlled local build assets only.",
                  "Do not deploy or promote the mobile artifact to production.",
                ],
                owner: config.technicalOwner,
                reviewedAt: "2026-09-05T00:00:00.000Z",
                expiresAt: MOBILE_WAIVER_EXPIRES_AT,
                removalCondition:
                  "Remove the waiver and rerun the fixture matrix when Expo supports a published patched image-size release.",
                blocksProduction: true,
              },
            ],
          }),
        ]
      : []),
  ];
  const basePackages: Array<readonly [string, string, string]> = [
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
    if (name === "core") {
      files.push(
        packageManifest(config, name, {
          [packageName(config, "foundation")]: FOUNDATION_VERSION,
          ...(plan.needsEvents ? { zod: DEPENDENCY_VERSIONS.zod } : {}),
        }),
        packageTsconfig(name),
        corePackageFile(plan),
        ...(plan.needsIdentity
          ? [
              textFile(
                "packages/core/tests/identity-security.test.ts",
                `import { expect, test } from "vitest";
import { assuranceForMethod, canPerformSensitiveAccountChange, identitySecurityPolicy } from "../src/index.js";

test("maps authentication methods to explicit assurance and restricts recovery", () => {
  expect(assuranceForMethod("password_totp")).toBe("multi_factor");
  expect(assuranceForMethod("passkey")).toBe("phishing_resistant");
  expect(assuranceForMethod("recovery_code")).toBe("recovery");
  const now = new Date("2026-09-05T00:04:00.000Z");
  expect(canPerformSensitiveAccountChange({ assurance: "phishing_resistant", authenticatedAt: "2026-09-05T00:00:00.000Z" }, now)).toBe(true);
  expect(canPerformSensitiveAccountChange({ assurance: "recovery", authenticatedAt: "2026-09-05T00:04:00.000Z" }, now)).toBe(false);
  expect(identitySecurityPolicy.trustedDeviceBypass).toBe(false);
  expect(identitySecurityPolicy.revokeAllSessionsAfterReset).toBe(true);
});
`,
              ),
            ]
          : []),
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
        ...(plan.needsEvents
          ? [
              textFile(
                "packages/core/tests/outbox-policy.test.ts",
                `import { expect, test } from "vitest";
import { isCurrentFencingToken, retryDelayMilliseconds, validateDomainEvent } from "../src/index.js";

test("outbox retry delay is bounded and fencing rejects stale workers", () => {
  expect(retryDelayMilliseconds(1, 0.5)).toBe(1000);
  expect(retryDelayMilliseconds(99, 1)).toBe(900000);
  expect(isCurrentFencingToken(2, 2)).toBe(true);
  expect(isCurrentFencingToken(2, 1)).toBe(false);
});

test("domain event validation rejects unversioned or non-object payloads", () => {
  expect(() => validateDomainEvent({ id: "event-1", type: "example.created", schemaVersion: 1, aggregateType: "example", aggregateId: "example-1", payload: {}, occurredAt: new Date().toISOString(), correlationId: "correlation-1" })).not.toThrow();
  expect(() => validateDomainEvent({ id: "event-2", type: "example.created", schemaVersion: 0, aggregateType: "example", aggregateId: "example-1", payload: {} })).toThrow();
});
`,
              ),
            ]
          : []),
        ...(plan.needsAi
          ? [
              textFile(
                "packages/core/tests/ai-completion.test.ts",
                `import { expect, test } from "vitest";
import { completeAiRun, type AiCompletionTransaction } from "../src/index.js";

const input = {
  runId: "run-1",
  organizationId: "org-1",
  leaseToken: "lease-1",
  artifact: { answer: "complete" },
  usage: { inputTokens: 1, outputTokens: 2, costMicrousd: 3 },
  evaluation: { name: "quality", scoreMillionths: 900000 },
  event: { id: "event-1", type: "ai.completed", payload: { runId: "run-1" }, correlationId: "correlation-1" },
};

test("AI completion sends one complete evidence bundle to the transaction port", async () => {
  const calls: unknown[] = [];
  const transaction: AiCompletionTransaction = { complete: async (value) => { calls.push(value); } };
  await expect(completeAiRun(transaction, input)).resolves.toBeUndefined();
  expect(calls).toHaveLength(1);
});

test("AI completion rejects incomplete artifacts before persistence", async () => {
  const transaction: AiCompletionTransaction = { complete: async () => { throw new Error("must not persist"); } };
  await expect(completeAiRun(transaction, { ...input, artifact: {} })).rejects.toMatchObject({ code: "INVALID_INPUT" });
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
  expect(defaultStoragePolicy.authorize("get", "org-1/subject-1/file.txt", "subject-1", "org-1")).toBe(true);
  expect(defaultStoragePolicy.authorize("get", "org-2/subject-1/file.txt", "subject-1", "org-1")).toBe(false);
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
      if (plan.needsIdentity)
        adapterDependencies["@better-auth/passkey"] = DEPENDENCY_VERSIONS.betterAuthPasskey;
      if (plan.needsWorker)
        adapterDependencies["graphile-worker"] = DEPENDENCY_VERSIONS.graphileWorker;
      if (plan.needsStorage) {
        adapterDependencies["@aws-sdk/client-s3"] = DEPENDENCY_VERSIONS.awsS3;
        adapterDependencies["@aws-sdk/s3-request-presigner"] = DEPENDENCY_VERSIONS.awsPresigner;
        adapterDependencies["@aws-sdk/s3-presigned-post"] = DEPENDENCY_VERSIONS.awsPresignedPost;
      }
      if (plan.needsAi) adapterDependencies.ai = DEPENDENCY_VERSIONS.ai;
      files.push(
        packageManifest(config, name, adapterDependencies),
        packageTsconfig(name),
        adaptersPackageFile(config, plan),
        ...(plan.needsIdentity
          ? [
              textFile(
                "packages/adapters/tests/identity-assurance.test.ts",
                `import { expect, test } from "vitest";
import { assuranceForCompletedAuthenticationPath, requiresRecentAccountAssurance } from "../src/index.js";

test("maps completed authentication routes to assurance levels", () => {
  expect(assuranceForCompletedAuthenticationPath("/passkey/verify-authentication")).toBe("phishing_resistant");
  expect(assuranceForCompletedAuthenticationPath("/two-factor/verify-totp")).toBe("multi_factor");
  expect(assuranceForCompletedAuthenticationPath("/two-factor/verify-backup-code")).toBe("recovery");
  expect(assuranceForCompletedAuthenticationPath("/sign-in/email")).toBe("single_factor");
});

test("requires recent assurance before recovery-code rotation", () => {
  expect(requiresRecentAccountAssurance("/two-factor/generate-backup-codes")).toBe(true);
});
`,
              ),
            ]
          : []),
        ...(plan.needsStorage
          ? [
              textFile(
                "packages/adapters/tests/storage.test.ts",
                `import { expect, test } from "vitest";
import { createS3Storage } from "../src/index.js";

test("storage enforces ownership and propagates provider failures", async () => {
  const metadata = {
    record: async () => undefined,
    find: async () => ({ subjectId: "owner-1", contentType: "text/plain", byteLength: 1, status: "available" as const }),
  };
  const failing = createS3Storage({ bucket: "test", region: "test", metadata, send: async () => { throw new Error("provider offline"); } });
  await expect(failing.put({ key: "owner-1/file.txt", contentType: "text/plain", body: new Uint8Array([1]), subjectId: "owner-1" })).rejects.toThrow("provider offline");
  const owned = createS3Storage({ bucket: "test", region: "test", metadata, send: async () => ({}) });
  await expect(owned.getUrl({ key: "owner-1/file.txt", subjectId: "other" })).rejects.toThrow("policy denied");
  let providerCalls = 0;
  const takeover = createS3Storage({ bucket: "test", region: "test", metadata, send: async () => { providerCalls += 1; return {}; } });
  await expect(takeover.put({ key: "owner-1/file.txt", contentType: "text/plain", body: new Uint8Array([1]), subjectId: "other" })).rejects.toThrow("policy denied");
  expect(providerCalls).toBe(0);
  const bounded = createS3Storage({ bucket: "test", region: "test", metadata, policy: { maximumBytes: 1, allowedContentTypes: ["text/plain"], authorize: () => true }, send: async () => ({}) });
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
          ...(plan.needsWorker ? { "graphile-worker": DEPENDENCY_VERSIONS.graphileWorker } : {}),
          postgres: DEPENDENCY_VERSIONS.postgres,
        }),
        packageTsconfig(name),
        databasePackageFile(config, plan),
        migrationRunnerFile(plan),
        textFile(
          "packages/database/migrations/0000_starter.sql",
          `${[
            "CREATE TABLE starter_health (id text PRIMARY KEY);",
            ...(plan.needsIdentity
              ? [
                  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false, two_factor_enabled boolean DEFAULT false, image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());',
                  'CREATE TABLE "session" (id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
                  'CREATE INDEX session_user_id_idx ON "session" (user_id);',
                  'CREATE TABLE "account" (id text PRIMARY KEY, issuer text NOT NULL, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (issuer, account_id));',
                  'CREATE INDEX account_user_id_idx ON "account" (user_id);',
                  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());',
                  'CREATE INDEX verification_identifier_idx ON "verification" (identifier);',
                  'CREATE TABLE "two_factor" (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, secret text NOT NULL, backup_codes text NOT NULL, verified boolean NOT NULL DEFAULT false, failed_verification_count integer NOT NULL DEFAULT 0, locked_until timestamptz);',
                  'CREATE TABLE "passkey" (id text PRIMARY KEY, name text, public_key text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, credential_id text NOT NULL UNIQUE, counter integer NOT NULL, device_type text NOT NULL, backed_up boolean NOT NULL, transports text, created_at timestamptz DEFAULT now(), aaguid text);',
                  "CREATE TABLE authentication_assurance (session_token text PRIMARY KEY REFERENCES \"session\"(token) ON DELETE CASCADE, assurance text NOT NULL CHECK (assurance IN ('single_factor', 'multi_factor', 'phishing_resistant', 'recovery')), authenticated_at timestamptz NOT NULL DEFAULT now());",
                  "CREATE TABLE application_users (id text PRIMARY KEY, authentication_subject_id text NOT NULL UNIQUE);",
                ]
              : []),
            ...(plan.needsTenancy
              ? [
                  "CREATE TABLE organizations (id text PRIMARY KEY, name text NOT NULL, created_by_subject_id text NOT NULL REFERENCES application_users(id), created_at timestamptz NOT NULL DEFAULT now());",
                  "CREATE TABLE memberships (id text PRIMARY KEY, user_id text NOT NULL REFERENCES application_users(id), organization_id text NOT NULL REFERENCES organizations(id), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, user_id), UNIQUE (id, organization_id));",
                  "CREATE TABLE governance_role_assignments (id text PRIMARY KEY, membership_id text NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE CASCADE, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')), granted_by_subject_id text NOT NULL REFERENCES application_users(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY (membership_id, organization_id) REFERENCES memberships(id, organization_id));",
                  "CREATE TABLE product_role_assignments (id text PRIMARY KEY, membership_id text NOT NULL REFERENCES memberships(id) ON DELETE CASCADE, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, role text NOT NULL, granted_by_subject_id text NOT NULL REFERENCES application_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (membership_id, role), FOREIGN KEY (membership_id, organization_id) REFERENCES memberships(id, organization_id));",
                  "CREATE TABLE permission_definitions (id text PRIMARY KEY, permission text NOT NULL UNIQUE);",
                  "CREATE TABLE permission_grants (id text PRIMARY KEY, membership_id text NOT NULL REFERENCES memberships(id) ON DELETE CASCADE, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, permission_id text NOT NULL REFERENCES permission_definitions(id), granted_by_subject_id text NOT NULL REFERENCES application_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (membership_id, permission_id), FOREIGN KEY (membership_id, organization_id) REFERENCES memberships(id, organization_id));",
                  "CREATE TABLE invitations (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, email text NOT NULL, token_hash text NOT NULL UNIQUE, governance_role text NOT NULL CHECK (governance_role IN ('owner', 'admin', 'member')), product_roles text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')), expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz, invited_by_subject_id text NOT NULL REFERENCES application_users(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK ((status = 'accepted') = (accepted_at IS NOT NULL)), CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)));",
                  "CREATE TABLE authorization_audit_events (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), actor_subject_id text NOT NULL REFERENCES application_users(id), action text NOT NULL, resource_type text NOT NULL, resource_id text, outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')), correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());",
                  "CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '') $$;",
                  "CREATE OR REPLACE FUNCTION app_current_subject_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.subject_id', true), '') $$;",
                  "CREATE OR REPLACE FUNCTION protect_last_organization_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') AND NOT EXISTS (SELECT 1 FROM governance_role_assignments role_assignment JOIN memberships membership ON membership.id = role_assignment.membership_id WHERE role_assignment.organization_id = OLD.organization_id AND role_assignment.membership_id <> OLD.membership_id AND role_assignment.role = 'owner' AND membership.status = 'active') THEN RAISE EXCEPTION 'organization must retain an active owner'; END IF; RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END $$;",
                  "CREATE TRIGGER governance_role_last_owner BEFORE UPDATE OR DELETE ON governance_role_assignments FOR EACH ROW EXECUTE FUNCTION protect_last_organization_owner();",
                  "ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;",
                  "ALTER TABLE organizations FORCE ROW LEVEL SECURITY;",
                  "CREATE POLICY organizations_tenant_isolation ON organizations USING (id = app_current_organization_id()) WITH CHECK (id = app_current_organization_id());",
                  ...[
                    "memberships",
                    "governance_role_assignments",
                    "product_role_assignments",
                    "permission_grants",
                    "invitations",
                    "authorization_audit_events",
                  ].flatMap((table) => [
                    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
                    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
                    `CREATE POLICY ${table}_tenant_isolation ON ${table} USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());`,
                  ]),
                ]
              : []),
            ...(plan.needsWorker
              ? [
                  "CREATE TABLE workflow_runs (idempotency_key text PRIMARY KEY, status text NOT NULL, claim_token text NOT NULL, claim_expires_at timestamptz NOT NULL);",
                ]
              : []),
            ...(plan.needsEvents
              ? [
                  "CREATE TABLE outbox_events (id text PRIMARY KEY, organization_id text, type text NOT NULL, schema_version integer NOT NULL CHECK (schema_version > 0), aggregate_type text NOT NULL, aggregate_id text NOT NULL, payload jsonb NOT NULL, destination text NOT NULL, idempotency_key text NOT NULL, status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'processing', 'delivered', 'dead_letter')), available_at timestamptz NOT NULL DEFAULT now(), attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), lease_owner text, lease_expires_at timestamptz, fencing_token bigint NOT NULL DEFAULT 0, correlation_id text NOT NULL, causation_id text, occurred_at timestamptz NOT NULL, last_failure text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (destination, idempotency_key));",
                  "CREATE INDEX outbox_events_claim_idx ON outbox_events (status, available_at, lease_expires_at);",
                  "CREATE TABLE outbox_delivery_attempts (id text PRIMARY KEY, event_id text NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE, attempt_number integer NOT NULL CHECK (attempt_number > 0), fencing_token bigint NOT NULL, outcome text NOT NULL CHECK (outcome IN ('delivered', 'retry', 'dead_letter')), normalized_failure text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id, attempt_number));",
                  "CREATE TABLE outbox_dead_letters (event_id text PRIMARY KEY REFERENCES outbox_events(id) ON DELETE CASCADE, organization_id text, reason text NOT NULL, replayed_by_subject_id text, replayed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());",
                  "CREATE TABLE inbox_receipts (id text PRIMARY KEY, organization_id text, consumer text NOT NULL, event_id text NOT NULL, idempotency_key text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (consumer, event_id), UNIQUE (consumer, idempotency_key));",
                  ...(plan.needsTenancy
                    ? [
                        "ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);",
                        "ALTER TABLE outbox_dead_letters ADD CONSTRAINT outbox_dead_letters_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);",
                        "ALTER TABLE inbox_receipts ADD CONSTRAINT inbox_receipts_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);",
                        ...["outbox_events", "outbox_dead_letters", "inbox_receipts"].flatMap(
                          (table) => [
                            `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
                            `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
                            `CREATE POLICY ${table}_tenant_isolation ON ${table} USING (organization_id IS NULL OR organization_id = app_current_organization_id()) WITH CHECK (organization_id IS NULL OR organization_id = app_current_organization_id());`,
                          ],
                        ),
                      ]
                    : []),
                ]
              : []),
            ...(plan.needsStorage
              ? [
                  `CREATE TABLE object_metadata (key text PRIMARY KEY, content_type text NOT NULL, byte_length integer NOT NULL CHECK (byte_length > 0), subject_id text NOT NULL, organization_id text${plan.needsTenancy ? " NOT NULL" : ""}, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'quarantined')));`,
                  ...(plan.needsTenancy
                    ? [
                        "ALTER TABLE object_metadata ADD CONSTRAINT object_metadata_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);",
                        "ALTER TABLE object_metadata ENABLE ROW LEVEL SECURITY;",
                        "ALTER TABLE object_metadata FORCE ROW LEVEL SECURITY;",
                        "CREATE POLICY object_metadata_tenant_isolation ON object_metadata USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());",
                      ]
                    : []),
                ]
              : []),
            ...(plan.needsSearch
              ? [
                  "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
                  "CREATE TABLE search_documents (id text PRIMARY KEY, organization_id text, source_type text NOT NULL, source_id text NOT NULL, source_version text NOT NULL, text_content text NOT NULL, required_permission text, tombstoned boolean NOT NULL DEFAULT false, search_vector tsvector NOT NULL DEFAULT to_tsvector('simple', ''), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, source_type, source_id, source_version));",
                  "CREATE INDEX search_documents_fts_idx ON search_documents USING gin (search_vector);",
                  "CREATE INDEX search_documents_trgm_idx ON search_documents USING gin (text_content gin_trgm_ops);",
                  "CREATE OR REPLACE FUNCTION refresh_search_document_vector() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.search_vector := to_tsvector('simple', NEW.text_content); NEW.updated_at := now(); RETURN NEW; END $$;",
                  "CREATE TRIGGER search_documents_vector_refresh BEFORE INSERT OR UPDATE OF text_content ON search_documents FOR EACH ROW EXECUTE FUNCTION refresh_search_document_vector();",
                  ...(plan.needsTenancy
                    ? [
                        "ALTER TABLE search_documents ADD CONSTRAINT search_documents_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);",
                        "ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY;",
                        "ALTER TABLE search_documents FORCE ROW LEVEL SECURITY;",
                        "CREATE POLICY search_documents_tenant_isolation ON search_documents USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());",
                      ]
                    : []),
                ]
              : []),
            ...(plan.needsRag
              ? [
                  "CREATE EXTENSION IF NOT EXISTS vector;",
                  "CREATE TABLE knowledge_documents (id text PRIMARY KEY, organization_id text NOT NULL, object_key text NOT NULL, version text NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'tombstoned')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, object_key, version));",
                  "CREATE TABLE knowledge_chunks (id text PRIMARY KEY, document_id text NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE, organization_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), page_number integer, section text, text_content text NOT NULL, embedding vector(1536), version text NOT NULL, tombstoned boolean NOT NULL DEFAULT false, UNIQUE (document_id, ordinal, version));",
                  "CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);",
                  "CREATE INDEX knowledge_chunks_org_idx ON knowledge_chunks (organization_id, document_id, tombstoned);",
                  "CREATE TABLE knowledge_citations (id text PRIMARY KEY, run_id text NOT NULL, chunk_id text NOT NULL REFERENCES knowledge_chunks(id), organization_id text NOT NULL, citation text NOT NULL, verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());",
                  ...(plan.needsTenancy
                    ? [
                        ...[
                          "knowledge_documents",
                          "knowledge_chunks",
                          "knowledge_citations",
                        ].flatMap((table) => [
                          `ALTER TABLE ${table} ADD CONSTRAINT ${table}_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);`,
                          `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
                          `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
                          `CREATE POLICY ${table}_tenant_isolation ON ${table} USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());`,
                        ]),
                      ]
                    : []),
                ]
              : []),
            ...(plan.needsAi
              ? [
                  "CREATE TABLE ai_approvals (id text PRIMARY KEY, organization_id text, tool_name text NOT NULL, subject_id text NOT NULL, run_id text, tool_call_id text, resource_scope jsonb NOT NULL DEFAULT '{}', input_hash text, maximum_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (maximum_cost_microusd >= 0), expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'), consumed_at timestamptz, granted_by_subject_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tool_name, subject_id, organization_id, input_hash));",
                  "CREATE TABLE ai_runs (id text PRIMARY KEY, organization_id text NOT NULL, subject_id text NOT NULL, logical_model text NOT NULL CHECK (logical_model IN ('chat.fast', 'chat.quality', 'structured.default', 'embedding.default')), use_case text NOT NULL, status text NOT NULL CHECK (status IN ('requested', 'running', 'completed', 'failed')), idempotency_key text NOT NULL, correlation_id text NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, idempotency_key));",
                  "CREATE TABLE ai_attempts (id text PRIMARY KEY, run_id text NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE, attempt_number integer NOT NULL CHECK (attempt_number > 0), provider text, provider_model text, outcome text NOT NULL, normalized_failure text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE (run_id, attempt_number));",
                  "CREATE TABLE ai_usage (id text PRIMARY KEY, run_id text NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE, attempt_id text REFERENCES ai_attempts(id), input_tokens integer NOT NULL CHECK (input_tokens >= 0), output_tokens integer NOT NULL CHECK (output_tokens >= 0), cost_microusd bigint NOT NULL CHECK (cost_microusd >= 0), created_at timestamptz NOT NULL DEFAULT now());",
                  "CREATE TABLE ai_evaluations (id text PRIMARY KEY, run_id text REFERENCES ai_runs(id) ON DELETE CASCADE, name text NOT NULL, score integer NOT NULL CHECK (score BETWEEN 0 AND 1000000), subject_id text NOT NULL);",
                  "CREATE TABLE ai_telemetry_events (id text PRIMARY KEY, run_id text REFERENCES ai_runs(id) ON DELETE CASCADE, tool_name text NOT NULL, subject_id text NOT NULL, cost_microusd integer NOT NULL CHECK (cost_microusd >= 0), outcome text NOT NULL);",
                  "CREATE TABLE ai_audit_events (id text PRIMARY KEY, run_id text REFERENCES ai_runs(id) ON DELETE CASCADE, tool_name text NOT NULL, subject_id text NOT NULL, cost_microusd integer NOT NULL CHECK (cost_microusd >= 0), outcome text NOT NULL);",
                  "CREATE TABLE agent_tool_calls (id text PRIMARY KEY, run_id text NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE, tool_name text NOT NULL, risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')), mutating boolean NOT NULL DEFAULT false, approval_id text REFERENCES ai_approvals(id), input_hash text NOT NULL, outcome text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);",
                  "CREATE TABLE agent_run_leases (run_id text PRIMARY KEY REFERENCES ai_runs(id) ON DELETE CASCADE, lease_token text NOT NULL, lease_owner text NOT NULL, lease_expires_at timestamptz NOT NULL, fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0), updated_at timestamptz NOT NULL DEFAULT now());",
                  ...(plan.needsTenancy
                    ? [
                        ...["ai_approvals", "ai_runs"].map(
                          (table) =>
                            `ALTER TABLE ${table} ADD CONSTRAINT ${table}_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);`,
                        ),
                        ...["ai_approvals", "ai_runs"].flatMap((table) => [
                          `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
                          `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
                          `CREATE POLICY ${table}_tenant_isolation ON ${table} USING (organization_id = app_current_organization_id()) WITH CHECK (organization_id = app_current_organization_id());`,
                        ]),
                      ]
                    : []),
                ]
              : []),
          ].join("\n")}\n`,
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
      const identityTestDependencies = plan.needsIdentity
        ? `authentication: { resolveSession: async () => null }, identity: { ensureAuthenticationSubject: async (subjectId: string) => ({ subjectId }), resolveAuthenticationSubject: async () => null }, database: { checkReadiness: async () => undefined }, `
        : "";
      const testBuildApi = plan.needsIdentity
        ? `buildApi({ ${identityTestDependencies}`
        : "buildApi()";
      const testBuildApiEnd = plan.needsIdentity ? " })" : "";
      const testReadinessApi = plan.needsIdentity
        ? `${testBuildApi}readinessChecks: [{ name: "provider", check: async () => { throw new Error("provider unavailable"); } }]${testBuildApiEnd}`
        : `buildApi({ readinessChecks: [{ name: "provider", check: async () => { throw new Error("provider unavailable"); } }] })`;
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
  const server = ${testReadinessApi};
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
  const server = buildApi({ authentication: { resolveSession: async (headers) => { const subjectId = headers.get("x-subject"); return subjectId ? { subjectId } : null; } }, identity: { ensureAuthenticationSubject: async (subjectId) => ({ subjectId }), resolveAuthenticationSubject: async (subjectId) => ({ subjectId }) }, database: { checkReadiness: async () => undefined } });
  const anonymous = await server.inject({ method: "GET", url: "/trpc/viewer" });
  const authenticated = await server.inject({ method: "GET", url: "/trpc/viewer", headers: { "x-subject": "subject-1" } });
  expect(anonymous.statusCode).toBe(401);
  expect(authenticated.statusCode).toBe(200);
  expect(authenticated.body).toContain("subject-1");
  await server.close();
});

test("authentication routes forward Fastify JSON bodies and response cookies", async () => {
  const server = ${testBuildApi}${testBuildApiEnd};
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
  const healthy = ${testBuildApi}${testBuildApiEnd};
  await registerExternalApi(healthy);
  const ok = await healthy.inject({ method: "GET", url: EXTERNAL_HEALTH_PATH });
  expect(ok.statusCode).toBe(200);
  await healthy.close();

  const failed = ${testBuildApi}${testBuildApiEnd};
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
    database: { checkReadiness: async () => undefined },
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
      const firstPartyClient =
        plan.needsApi && (hasProfile(config, "web") || hasProfile(config, "mobile"));
      const clientDependencies = {
        ...(plan.needsExternalApi
          ? { "@hey-api/client-fetch": DEPENDENCY_VERSIONS.openapiFetch }
          : {}),
        ...(firstPartyClient
          ? {
              "@trpc/client": DEPENDENCY_VERSIONS.trpcClient,
              [packageName(config, "api")]: "workspace:*",
            }
          : {}),
        ...(plan.needsIdentity ? { "better-auth": DEPENDENCY_VERSIONS.betterAuth } : {}),
      };
      files.push(
        packageManifest(
          config,
          name,
          clientDependencies,
          {},
          {
            scripts: { typecheck: "tsc -p tsconfig.json" },
            exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
          },
        ),
        apiClientTsconfig(),
        textFile(
          "packages/api-client/src/index.ts",
          `${
            firstPartyClient
              ? `import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "${packageName(config, "api")}";
${plan.needsIdentity ? 'import { createAuthClient } from "better-auth/client";\n' : ""}
export function createApiClient() {
  return createTRPCProxyClient<AppRouter>({ links: [httpBatchLink({
    url: "/trpc",
    fetch: (input, init) => fetch(input, {
      ...(init?.method ? { method: init.method } : {}),
      ...(init?.body ? { body: init.body } : {}),
      ...(init?.headers ? { headers: init.headers } : {}),
      signal: init?.signal ?? null,
      credentials: "include",
    }),
  })] });
}
${plan.needsIdentity ? 'export const authClient = createAuthClient({ basePath: "/api/auth", fetchOptions: { credentials: "include" } });\n' : ""}`
              : ""
          }${plan.needsExternalApi ? 'export * as externalApi from "./generated/index.js";\n' : ""}`,
        ),
      );
    } else if (name === "test-support") {
      const testSupportBuildApi = plan.needsIdentity
        ? `buildApi({ authentication: { resolveSession: async () => null }, identity: { ensureAuthenticationSubject: async (subjectId: string) => ({ subjectId }), resolveAuthenticationSubject: async () => null }, database: { checkReadiness: async () => undefined } })`
        : "buildApi()";
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
import { externalApi } from "${packageName(config, "api-client")}";

test("generated external client reaches the registered Fastify route", async () => {
  const server = ${testSupportBuildApi};
  await registerExternalApi(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test address");
  const response = await externalApi.getHealth({ baseUrl: \`http://127.0.0.1:\${address.port}\` });
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
  const storageProcedure = plan.needsTenancy ? "organizationProcedure" : "authenticatedProcedure";
  const storageOrganizationArgument = plan.needsTenancy
    ? ", organizationId: ctx.organizationId"
    : "";
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
  const zodImport =
    plan.needsStorage || plan.needsAi || plan.needsTenancy ? `import { z } from "zod";\n` : "";
  const externalImports = plan.needsExternalApi
    ? `import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
`
    : "";
  const externalDocument = plan.needsExternalApi
    ? `
export const openApiDocument = ${JSON.stringify(externalOpenApiDocument(config))} as const;
export const EXTERNAL_HEALTH_PATH = ${stringLiteral(EXTERNAL_HEALTH_PATH)} as const;
export async function registerExternalApi(server: FastifyInstance, dependencies: ${plan.needsIdentity ? 'Partial<Pick<ApiDependencies, "database" | "readinessChecks">>' : "ApiDependencies"} = {}): Promise<void> {
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
export interface RequestContext { readonly subjectId: string | null;${plan.needsTenancy ? " readonly organizationId: string | null;" : ""}${plan.needsStorage ? " readonly storage?: ObjectStorage;" : ""}${plan.needsAi ? " readonly ai?: AiRuntime;" : ""} }
export interface ApiDependencies {
${plan.needsIdentity ? "  readonly authentication: AuthenticationPort;\n" : ""}
${plan.needsIdentity ? "  readonly identity: IdentityRepository;\n" : ""}
  readonly database${plan.needsIdentity ? "" : "?"}: { readonly checkReadiness: () => Promise<void> };
${plan.needsStorage ? "  readonly storage?: ObjectStorage;\n" : ""}
${plan.needsAi ? "  readonly ai?: AiRuntime;\n" : ""}
${plan.needsTenancy ? "  readonly organizationAuthorization?: { readonly hasMembership: (subjectId: string, organizationId: string) => Promise<boolean>; };\n" : ""}
  readonly readinessChecks?: readonly { readonly name: string; readonly check: () => Promise<void> }[];
}
export function createContext(subjectId: string | null${plan.needsTenancy ? ", organizationId: string | null = null" : ""}${plan.needsStorage ? ", storage?: ObjectStorage" : ""}${plan.needsAi ? ", ai?: AiRuntime" : ""}): RequestContext { return { subjectId${plan.needsTenancy ? ", organizationId" : ""}${plan.needsStorage ? ", ...(storage ? { storage } : {})" : ""}${plan.needsAi ? ", ...(ai ? { ai } : {})" : ""} }; }
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
export async function resolveContext(${plan.needsIdentity ? "request" : "_request"}: FastifyRequest, ${plan.needsIdentity || plan.needsStorage || plan.needsAi || plan.needsTenancy ? "dependencies" : "_dependencies"}: ApiDependencies): Promise<RequestContext> {
  ${plan.needsIdentity ? "const session = await dependencies.authentication.resolveSession(toHeaders(request));\n  const applicationSubject = session ? await dependencies.identity.resolveAuthenticationSubject(session.subjectId) : null;\n  " : ""}${plan.needsTenancy ? 'const requestedOrganizationId = typeof request.headers["x-organization-id"] === "string" ? request.headers["x-organization-id"].trim() : "";\n  const organizationId = applicationSubject?.subjectId && requestedOrganizationId && dependencies.organizationAuthorization && (await dependencies.organizationAuthorization.hasMembership(applicationSubject.subjectId, requestedOrganizationId)) ? requestedOrganizationId : null;\n  ' : ""}return createContext(${plan.needsIdentity ? "applicationSubject?.subjectId ?? null" : "null"}${plan.needsTenancy ? ", organizationId" : ""}${plan.needsStorage ? ", dependencies.storage" : ""}${plan.needsAi ? ", dependencies.ai" : ""});
}

const t = initTRPC.context<RequestContext>().create();
export const publicProcedure = t.procedure;
export const authenticatedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.subjectId === null) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, subjectId: ctx.subjectId } });
});
${
  plan.needsTenancy
    ? `export const organizationProcedure = authenticatedProcedure.use(({ ctx, next }) => {
  if (!ctx.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "x-organization-id is required" });
  return next({ ctx: { ...ctx, organizationId: ctx.organizationId } });
});
`
    : ""
}
${sourceOfTruthBlock({ id: "starter.api.transport", keywords: "api, fastify, trpc, health, readiness", what: "Thin Fastify and tRPC transport composition root.", why: "Separates request handling from domain and provider code.", when: "Use for first-party API routes and health probes.", how: "buildApi, appRouter", boundaries: "Do not place SQL, authorization policy, or provider SDK calls here." })}
export const appRouter = t.router({
  health: publicProcedure.query(() => healthResponseSchema.parse({ status: "ok", checkedAt: new Date().toISOString(), instanceId: process.env["${productIdentity(config).environmentPrefix}_FIXTURE_ID"] ?? "local" })),
  viewer: authenticatedProcedure.query(({ ctx }) => ({ subjectId: ctx.subjectId })),
${
  plan.needsStorage
    ? `  storageUrl: ${storageProcedure}.input(z.object({ key: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    if (!ctx.storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured" });
    return { url: await ctx.storage.getUrl({ key: input.key, subjectId: ctx.subjectId${storageOrganizationArgument} }) };
  }),
  storageUpload: ${storageProcedure}.input(z.object({ key: z.string().min(1), contentType: z.string().min(1), byteLength: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => {
    if (!ctx.storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured" });
    return ctx.storage.createUpload({ key: input.key, contentType: input.contentType, byteLength: input.byteLength, subjectId: ctx.subjectId${storageOrganizationArgument} });
  }),
  storageComplete: ${storageProcedure}.input(z.object({ key: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
    if (!ctx.storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured" });
    return ctx.storage.completeUpload({ key: input.key, subjectId: ctx.subjectId${storageOrganizationArgument} });
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
      return healthResponseSchema.parse({ status: "degraded", checkedAt, instanceId: process.env["${productIdentity(config).environmentPrefix}_FIXTURE_ID"] ?? "local", detail, failedDependency: check.name });
    }
  }
  return healthResponseSchema.parse({ status: "ok", checkedAt, instanceId: process.env["${productIdentity(config).environmentPrefix}_FIXTURE_ID"] ?? "local" });
}

export function buildApi(dependencies: ApiDependencies${plan.needsIdentity ? "" : " = {}"}) {
  const server = Fastify({ logger: true });
  server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext: ({ req }: { readonly req: FastifyRequest }) => resolveContext(req, dependencies) },
  });
  server.get("/health/live", async () => healthResponseSchema.parse({ status: "ok", checkedAt: new Date().toISOString(), instanceId: process.env["${productIdentity(config).environmentPrefix}_FIXTURE_ID"] ?? "local" }));
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
  const identity = productIdentity(config);
  const imports = [
    `import { buildApi${plan.needsIdentity ? ", registerAuthenticationRoutes" : ""}${plan.needsExternalApi ? ", registerExternalApi" : ""} } from "${packageName(config, "api")}";`,
    ...(plan.needsAi ? [`import { ToolRegistry } from "${packageName(config, "core")}";`] : []),
    ...(plan.needsDatabase
      ? [`import { createDatabaseRuntime } from "${packageName(config, "database")}";`]
      : []),
    ...(plan.needsIdentity
      ? [
          `import { createBetterAuthAdapter, createIdentityMailAdapter } from "${packageName(config, "adapters")}";`,
        ]
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
          `  const identityMail = createIdentityMailAdapter({ provider: environment.IDENTITY_MAIL_PROVIDER, from: environment.IDENTITY_FROM_EMAIL, ...(environment.IDENTITY_MAILPIT_URL ? { mailpitUrl: environment.IDENTITY_MAILPIT_URL } : {}), ...(environment.IDENTITY_RESEND_API_KEY ? { resendApiKey: environment.IDENTITY_RESEND_API_KEY } : {}) });`,
          `  const authentication = createBetterAuthAdapter({ appName: ${stringLiteral(config.displayName)}, secret: environment.BETTER_AUTH_SECRET, baseURL: environment.BETTER_AUTH_URL, trustedOrigins: [new URL(environment.BETTER_AUTH_URL).origin], database: database.authentication.database, schema: database.authentication.schema, identityMail, onUserCreated: async (authenticationSubjectId) => { await database.identity.ensureAuthenticationSubject(authenticationSubjectId); }, recordAssurance: database.authentication.recordAssurance, resolveAssurance: database.authentication.resolveAssurance });`,
          "  const identity = database.identity;",
        ]
      : []),
    ...(plan.needsTenancy ? ["  const organizationAuthorization = database.organization;"] : []),
    ...(plan.needsStorage
      ? [
          `  const storage = createS3Storage({ bucket: environment.STORAGE_BUCKET, region: environment.STORAGE_REGION, ...(environment.STORAGE_ENDPOINT ? { endpoint: environment.STORAGE_ENDPOINT } : {}), ...(environment.STORAGE_ACCESS_KEY_ID && environment.STORAGE_SECRET_ACCESS_KEY ? { accessKeyId: environment.STORAGE_ACCESS_KEY_ID, secretAccessKey: environment.STORAGE_SECRET_ACCESS_KEY } : {}), metadata: database.metadata });`,
        ]
      : []),
    ...(plan.needsAi
      ? [
          "  const tools = new ToolRegistry();",
          `  const recordSchema = { parse: (value: unknown) => z.record(z.string(), z.unknown()).parse(value) };
  tools.register({ name: "${identity.sqlPrefix}.echo", risk: "low", requiresApproval: false, maximumCostUsd: 0.001, input: recordSchema, output: recordSchema, authorize: async (_input, subjectId) => subjectId.length > 0, execute: async (input) => input });`,
          "  const ai = { toolNames: tools.names(), executeTool: async (name: string, input: unknown, subjectId: string) => tools.execute(name, input, { subjectId, budgetUsd: environment.AI_MAX_TOOL_BUDGET_USD, approvals: database.ai, audit: database.ai, telemetry: database.ai }), recordEvaluation: async (name: string, score: number, subjectId: string) => database.ai.recordEvaluation({ name, score, subjectId }) };",
        ]
      : []),
    `  const server = buildApi({ ${[
      ...(plan.needsDatabase ? ["database"] : []),
      ...(plan.needsIdentity ? ["authentication"] : []),
      ...(plan.needsIdentity ? ["identity"] : []),
      ...(plan.needsTenancy ? ["organizationAuthorization"] : []),
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
  const capabilitySchemaFields = plan.capabilityEnvironment
    .filter((item) => item.owner === "api" && !item.name.startsWith("IDENTITY_"))
    .map(
      (item) =>
        `  ${item.name}: ${item.required ? "z.string().min(1)" : 'z.string().optional().default("")'},`,
    );
  const environmentSchema = [
    "const environmentSchema = z.object({",
    '  APP_ENV: z.enum(["local", "ci", "staging", "production"]).default("local"),',
    "  PORT: z.coerce.number().int().min(1).max(65535).default(3001),",
    ...(plan.needsDatabase ? ["  DATABASE_URL: z.string().min(1),"] : []),
    ...(plan.needsIdentity
      ? [
          "  BETTER_AUTH_SECRET: z.string().min(1),",
          "  BETTER_AUTH_URL: z.string().url(),",
          '  IDENTITY_MAIL_PROVIDER: z.enum(["mailpit", "resend"]),',
          "  IDENTITY_FROM_EMAIL: z.string().email(),",
          '  IDENTITY_RESEND_API_KEY: z.string().optional().default(""),',
          "  IDENTITY_MAILPIT_URL: z.string().url().optional(),",
        ]
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
    ...capabilitySchemaFields,
    plan.needsStorage || plan.needsIdentity
      ? `}).superRefine((value, context) => {
${plan.needsStorage ? '  if (Boolean(value.STORAGE_ACCESS_KEY_ID) !== Boolean(value.STORAGE_SECRET_ACCESS_KEY)) context.addIssue({ code: "custom", message: "storage access key and secret must be supplied together" });\n' : ""}${plan.needsIdentity ? '  if ((value.APP_ENV === "staging" || value.APP_ENV === "production") && value.IDENTITY_MAIL_PROVIDER !== "resend") context.addIssue({ code: "custom", message: "emulated identity mail is forbidden outside local and CI" });\n  if (value.IDENTITY_MAIL_PROVIDER === "resend" && !value.IDENTITY_RESEND_API_KEY) context.addIssue({ code: "custom", message: "IDENTITY_RESEND_API_KEY is required for Resend" });\n' : ""}});`
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
import { resolve } from "node:path";
import { z } from "zod";

try { process.loadEnvFile(resolve(process.cwd(), ".env")); } catch (error: unknown) {
  if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) throw error;
}
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
      `FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter ${packageName(config, "api-app")}... build
RUN pnpm --filter ${packageName(config, "api-app")} --prod deploy /runtime && rm -rf /runtime/src
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1000:1000 /runtime/ ./
USER 1000:1000
EXPOSE 3001
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
`,
    ),
  ];
}

function workerFiles(config: InitConfig): GeneratedFile[] {
  const plan = createCapabilityPlan(config);
  const identity = productIdentity(config);
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
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
${plan.capabilityEnvironment
  .filter((item) => item.owner === "worker")
  .map(
    (item) =>
      `  ${item.name}: ${item.required ? "z.string().min(1)" : 'z.string().optional().default("")'},`,
  )
  .join("\n")}
}).parse(process.env);
export async function startWorker(): Promise<void> {
  const database = createDatabaseRuntime(environment.DATABASE_URL);
  const runner = await startGraphileWorker({
    connectionString: environment.DATABASE_URL,
    concurrency: environment.WORKER_CONCURRENCY,
    taskList: {
      "${identity.sqlPrefix}.health": async (payload) => {
        const parsed = jobPayloadSchema.parse(payload);
        await runIdempotentWorkflow(database.workflow, parsed.requestId, async () => undefined);
      },
${
  plan.needsEvents
    ? `      "${identity.sqlPrefix}.outbox.dispatch": async (payload) => {
        const parsed = z.object({ eventId: z.string().min(1), leaseOwner: z.string().min(1).default("worker") }).parse(payload);
        await runIdempotentWorkflow(database.workflow, \`outbox:\${parsed.eventId}\`, async () => {
          const claim = await database.outbox.claim(parsed.eventId, parsed.leaseOwner, new Date(), 60_000);
          if (!claim) return;
          await database.outbox.recordAttempt(parsed.eventId, claim.fencingToken, "delivered");
          await database.outbox.markDelivered(parsed.eventId, claim.fencingToken);
        });
      },`
    : ""
}${
  plan.needsStorage && hasProfile(config, "python")
    ? `
      "${identity.sqlPrefix}.document.extract": async (payload) => {
        const parsed = z.object({ documentId: z.string().min(1) }).parse(payload);
        await runIdempotentWorkflow(database.workflow, \`document:\${parsed.documentId}\`, async () => undefined);
      },`
    : ""
}${
  plan.needsAi && plan.needsEvents
    ? `
      "${identity.sqlPrefix}.agent.continue": async (payload) => {
        const parsed = z.object({ runId: z.string().min(1) }).parse(payload);
        await runIdempotentWorkflow(database.workflow, \`agent:\${parsed.runId}\`, async () => undefined);
      },`
    : ""
}
    },
  });
  const healthServer = createServer(async (request, response) => {
    if (request.url !== "/health/ready") { response.writeHead(404).end(); return; }
    try {
      await database.checkReadiness();
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          status: "ok",
          checkedAt: new Date().toISOString(),
          instanceId: process.env["${identity.environmentPrefix}_FIXTURE_ID"] ?? "local",
        }),
      );
    } catch {
      response.writeHead(503, { "content-type": "application/json" }).end(
        JSON.stringify({
          status: "degraded",
          checkedAt: new Date().toISOString(),
          instanceId: process.env["${identity.environmentPrefix}_FIXTURE_ID"] ?? "local",
        }),
      );
    }
  });
  healthServer.listen(environment.WORKER_PORT, "0.0.0.0");
  try { await runner.promise; } finally { healthServer.close(); await database.close(); }
}

await startWorker();
`,
    ),
    textFile(
      "apps/worker/Dockerfile",
      `FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter ${packageName(config, "worker-app")}... build
RUN pnpm --filter ${packageName(config, "worker-app")} --prod deploy /runtime && rm -rf /runtime/src
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1000:1000 /runtime/ ./
USER 1000:1000
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
`,
    ),
  ];
}

function webProxyFiles(includeExternalApi = false): GeneratedFile[] {
  const proxy = `import { type NextRequest, NextResponse } from "next/server";

type ProxyContext = { readonly params: Promise<{ readonly path: string[] }> };

async function forward(request: NextRequest, context: ProxyContext, prefix: string): Promise<NextResponse> {
  const internalUrl = process.env.API_INTERNAL_URL;
  if (!internalUrl) return NextResponse.json({ error: "API_INTERNAL_URL is not configured" }, { status: 503 });
  const { path } = await context.params;
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const target = new URL(prefix.concat(encodedPath.length > 0 ? \`/\${encodedPath}\` : ""), internalUrl);
  target.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("set-cookie");
  for (const cookie of upstream.headers.getSetCookie())
    responseHeaders.append("set-cookie", cookie);
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = (request: NextRequest, context: ProxyContext) => forward(request, context, "__PREFIX__");
export const POST = (request: NextRequest, context: ProxyContext) => forward(request, context, "__PREFIX__");
export const PUT = (request: NextRequest, context: ProxyContext) => forward(request, context, "__PREFIX__");
export const PATCH = (request: NextRequest, context: ProxyContext) => forward(request, context, "__PREFIX__");
export const DELETE = (request: NextRequest, context: ProxyContext) => forward(request, context, "__PREFIX__");
`;
  return [
    textFile("apps/web/app/trpc/[...path]/route.ts", proxy.replaceAll("__PREFIX__", "/trpc")),
    textFile(
      "apps/web/app/api/auth/[...path]/route.ts",
      proxy.replaceAll("__PREFIX__", "/api/auth"),
    ),
    ...(includeExternalApi
      ? [textFile("apps/web/app/v1/[...path]/route.ts", proxy.replaceAll("__PREFIX__", "/v1"))]
      : []),
  ];
}

function webReferenceFlow(config: InitConfig): GeneratedFile {
  const identity = hasProfile(config, "identity")
    ? `
  const [email, setEmail] = useState("developer@example.test");
  const [password, setPassword] = useState("local-password-123");
async function signUp(email: string, password: string): Promise<void> {
  const result = await authClient.signUp.email({ email, password, name: "Starter Developer" });
  setMessage(result.error ? result.error.message ?? "Signup failed" : "Signed up; session cookie established.");
}
async function signIn(email: string, password: string): Promise<void> {
  const result = await authClient.signIn.email({ email, password });
  setMessage(result.error ? result.error.message ?? "Signin failed" : "Signed in; session cookie established.");
}
`
    : "";
  const imports = hasProfile(config, "identity")
    ? `import { authClient, createApiClient } from "${packageName(config, "api-client")}";`
    : `import { createApiClient } from "${packageName(config, "api-client")}";`;
  return textFile(
    "apps/web/app/reference-flow.tsx",
    `"use client";

import { useState } from "react";
${imports}

const api = createApiClient();

export function ReferenceFlow() {
  const [message, setMessage] = useState("Ready");
  const [result, setResult] = useState<unknown>(null);
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    try { setResult(await operation()); setMessage("Request succeeded"); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : "Request failed"); }
  };
  const health = () => run(() => api.health.query());
  const viewer = () => run(() => api.viewer.query());
${hasProfile(config, "identity") ? "" : "// Authentication is deferred because the identity profile is not selected."}
${identity}
  return <main>
    <h1>{${stringLiteral(config.displayName)}} reference flow</h1>
    <p>This is demonstrative starter code, not a product UI.</p>
    <button type="button" onClick={health}>Typed health</button>
    <button type="button" onClick={viewer}>Viewer (401 until signed in)</button>
${
  hasProfile(config, "identity")
    ? `    <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button type="button" onClick={() => signUp(email, password)}>Sign up</button>
    <button type="button" onClick={() => signIn(email, password)}>Sign in</button>
`
    : ""
}    <p>{message}</p><pre>{result ? JSON.stringify(result, null, 2) : "No result yet"}</pre>
  </main>;
}
`,
  );
}

function webFiles(config: InitConfig): GeneratedFile[] {
  const plan = createCapabilityPlan(config);
  const hasTypedReferenceFlow = plan.needsApiClient && plan.needsApi;
  return [
    jsonFile("apps/web/package.json", {
      name: packageName(config, "web-app"),
      private: true,
      version: PACKAGE_VERSION,
      files: [".next", "public", "next.config.ts"],
      scripts: {
        build: "next build",
        dev: "next dev -p 3000",
        start: "next start",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@base-ui/react": DEPENDENCY_VERSIONS.baseUi,
        "@tanstack/react-form": DEPENDENCY_VERSIONS.tanstackForm,
        "@tanstack/react-query": DEPENDENCY_VERSIONS.tanstackQuery,
        next: DEPENDENCY_VERSIONS.next,
        react: DEPENDENCY_VERSIONS.react,
        "react-dom": DEPENDENCY_VERSIONS.react,
        tailwindcss: DEPENDENCY_VERSIONS.tailwind,
        ...(plan.needsApiClient ? { [packageName(config, "api-client")]: "workspace:*" } : {}),
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
      hasTypedReferenceFlow
        ? `import { ReferenceFlow } from "./reference-flow";\n\nexport default function Page() { return <ReferenceFlow />; }\n`
        : `export default function Page() {\n  return <main><h1>{${stringLiteral(config.displayName)}}</h1><p>{${stringLiteral(`${config.displayName} web profile`)}}</p></main>;\n}\n`,
    ),
    ...(hasTypedReferenceFlow ? [webReferenceFlow(config)] : []),
    ...(plan.needsApi ? webProxyFiles(plan.needsExternalApi) : []),
    textFile(
      "apps/web/Dockerfile",
      `FROM ${NODE_IMAGE} AS build\nWORKDIR /workspace\nCOPY . .\nRUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts\nRUN pnpm --filter ${packageName(config, "web-app")}... build\nRUN pnpm --filter ${packageName(config, "web-app")} --prod deploy /runtime\nFROM ${NODE_IMAGE} AS runtime\nENV NODE_ENV=production\nWORKDIR /app\nCOPY --from=build --chown=1000:1000 /runtime/ ./\nUSER 1000:1000\nEXPOSE 3000\nSTOPSIGNAL SIGTERM\nCMD ["./node_modules/.bin/next", "start"]\n`,
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

function pythonFiles(config: InitConfig): GeneratedFile[] {
  return [
    textFile(
      "services/python/pyproject.toml",
      `[project]\nname = "${config.productId}-python-service"\nversion = "${PACKAGE_VERSION}"\nrequires-python = ">=${PYTHON_VERSION},<3.13"\ndependencies = [\n  "fastapi==0.116.1",\n  "uvicorn==0.35.0",\n  "python-multipart==0.0.20",\n  "pymupdf==1.26.6",\n  "python-docx==1.2.0",\n  "pillow==11.3.0",\n  "pytesseract==0.3.13",\n]\n\n[build-system]\nrequires = ["setuptools>=75"]\nbuild-backend = "setuptools.build_meta"\n`,
    ),
    textFile("services/python/src/__init__.py", ""),
    textFile(
      "services/python/src/main.py",
      `"""Bounded document extraction service; keep it isolated from TypeScript packages."""

import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 50 * 1024 * 1024
MAX_PAGES = 500
SERVICE_TOKEN = os.environ.get("PYTHON_SERVICE_TOKEN", "fixture-python-token")


def health() -> dict[str, str]:
    return {"status": "ok", "instanceId": os.environ.get("${productIdentity(config).environmentPrefix}_FIXTURE_ID", "local")}


def extract_document(filename: str, content_type: str, body: bytes) -> dict[str, object]:
    if len(body) > MAX_BYTES:
        raise ValueError("document exceeds maximum byte length")
    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        import fitz
        document = fitz.open(stream=body, filetype="pdf")
        if document.page_count > MAX_PAGES:
            raise ValueError("document exceeds maximum page count")
        pages = []
        for index, page in enumerate(document):
            text = page.get_text("text").strip()
            if not text:
                try:
                    from PIL import Image
                    import pytesseract
                    pixels = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
                    text = pytesseract.image_to_string(Image.open(io.BytesIO(pixels.tobytes("png")))).strip()
                except (ImportError, RuntimeError, OSError):
                    text = ""
            pages.append({"page": index + 1, "text": text})
        return {"format": "pdf", "pages": pages, "sections": pages, "diagnostics": {"pageCount": len(pages)}}
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" or filename.lower().endswith(".docx"):
        from docx import Document
        document = Document(io.BytesIO(body))
        pages = [{"page": 1, "text": "\\n".join(paragraph.text for paragraph in document.paragraphs).strip()}]
        return {"format": "docx", "pages": pages, "sections": pages, "diagnostics": {"pageCount": 1}}
    if content_type.startswith("text/") or filename.lower().endswith(".txt"):
        pages = [{"page": 1, "text": body.decode("utf-8", errors="strict").strip()}]
        return {"format": "text", "pages": pages, "sections": pages, "diagnostics": {"pageCount": 1}}
    raise ValueError("unsupported document type")


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

    def do_POST(self) -> None:
        if self.path != "/v1/extract" or self.headers.get("x-service-token", "") != SERVICE_TOKEN:
            self.send_response(404 if self.path != "/v1/extract" else 401)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_BYTES:
                raise ValueError("invalid document length")
            body = self.rfile.read(length)
            result = extract_document(self.headers.get("x-filename", "document"), self.headers.get("content-type", "application/octet-stream"), body)
            payload = json.dumps(result).encode("utf-8")
            self.send_response(200)
        except (ValueError, UnicodeError, RuntimeError, OSError) as error:
            payload = json.dumps({"error": str(error)}).encode("utf-8")
            self.send_response(422)
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
      `FROM ${PYTHON_IMAGE}\nWORKDIR /app\nCOPY services/python .\nRUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*\nRUN python -m pip install --no-cache-dir .\nRUN python -m compileall -q src\nEXPOSE 8000\nCMD ["python", "-m", "src.main"]\n`,
    ),
  ];
}

function environmentFile(config: InitConfig): GeneratedFile {
  const plan = createCapabilityPlan(config);
  const capabilityDefaults: Readonly<Record<string, string>> = {
    PAYMENT_PROVIDER: "fixture",
    PAYMENT_WEBHOOK_SECRET: "replace-with-a-local-secret",
    RESEND_API_KEY: "fixture-only",
    MAILPIT_URL: "http://127.0.0.1:8025",
    IDENTITY_MAIL_PROVIDER: "mailpit",
    IDENTITY_FROM_EMAIL: "identity@example.test",
    IDENTITY_RESEND_API_KEY: "",
    IDENTITY_MAILPIT_URL: "http://127.0.0.1:8025",
    VALKEY_URL: "redis://127.0.0.1:6379",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
    SENTRY_DSN: "",
    PYTHON_SERVICE_TOKEN: "fixture-python-token",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_BASE_URL: "",
    STRIPE_SECRET_KEY: "",
    RAZORPAY_KEY_ID: "",
    RAZORPAY_KEY_SECRET: "",
  };
  const capabilityLines = plan.capabilityEnvironment.map(
    (item) => `${item.name}=${capabilityDefaults[item.name] ?? ""}`,
  );
  const lines = [
    "APP_ENV=local",
    "NODE_ENV=development",
    `${productIdentity(config).environmentPrefix}_FIXTURE_ID=local`,
    `PORT=${plan.needsApi ? "3001" : "3000"}`,
    ...(plan.needsDatabase
      ? [
          "DATABASE_URL=postgres://starter_runtime:starter_runtime_local@127.0.0.1:5432/starter",
          "MIGRATOR_DATABASE_URL=postgres://starter_migrator:starter_migrator_local@127.0.0.1:5432/starter",
        ]
      : []),
    ...(plan.needsIdentity
      ? [
          "BETTER_AUTH_SECRET=replace-with-a-local-secret",
          `BETTER_AUTH_URL=http://127.0.0.1:${hasProfile(config, "web") ? "3000" : "3001"}`,
        ]
      : []),
    ...(hasProfile(config, "web") && plan.needsApi
      ? ["API_INTERNAL_URL=http://127.0.0.1:3001"]
      : []),
    ...(plan.needsAi ? ["AI_MAX_TOOL_BUDGET_USD=1"] : []),
    ...(plan.needsWorker ? ["WORKER_PORT=3002", "WORKER_CONCURRENCY=2"] : []),
    ...(hasProfile(config, "external-api") ? ["EXTERNAL_API_BASE_URL="] : []),
    ...(plan.needsStorage
      ? [
          "STORAGE_BUCKET=starter",
          "STORAGE_REGION=us-east-1",
          "STORAGE_ENDPOINT=http://127.0.0.1:9000",
          "STORAGE_ACCESS_KEY_ID=starter_local",
          "STORAGE_SECRET_ACCESS_KEY=starter_local_secret",
        ]
      : []),
    ...(hasProfile(config, "python") ? ["PYTHON_SERVICE_URL=http://127.0.0.1:8000"] : []),
    ...capabilityLines,
  ];
  return textFile(".env.example", `${lines.join("\n")}\n`);
}

function deploymentFiles(config: InitConfig): GeneratedFile[] {
  const plan = createCapabilityPlan(config);
  const deployableApps = plan.deployableApps;
  const variablesFor = (name: string): readonly string[] => [
    "APP_ENV",
    "NODE_ENV",
    name === "worker" ? "WORKER_PORT" : "PORT",
    ...(name === "web" && plan.needsApi ? ["API_INTERNAL_URL"] : []),
    ...((name === "api" || name === "worker") && plan.needsDatabase ? ["DATABASE_URL"] : []),
    ...(name === "api" && plan.needsIdentity
      ? [
          "BETTER_AUTH_SECRET",
          "BETTER_AUTH_URL",
          "IDENTITY_MAIL_PROVIDER",
          "IDENTITY_FROM_EMAIL",
          "IDENTITY_RESEND_API_KEY",
          "IDENTITY_MAILPIT_URL",
        ]
      : []),
    ...(name === "api" && plan.needsAi ? ["AI_MAX_TOOL_BUDGET_USD"] : []),
    ...(name === "api" && plan.providers.aiProviders.includes("openai")
      ? ["OPENAI_API_KEY", "OPENAI_BASE_URL"]
      : []),
    ...(name === "api" && plan.providers.aiProviders.includes("anthropic")
      ? ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]
      : []),
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
    ...(hasProfile(config, "python") && (name === "python" || name === "worker")
      ? ["PYTHON_SERVICE_TOKEN"]
      : []),
    ...(name === "api" && hasProfile(config, "payments")
      ? [
          "PAYMENT_PROVIDER",
          "PAYMENT_WEBHOOK_SECRET",
          ...(plan.providers.paymentProviders.includes("stripe") ? ["STRIPE_SECRET_KEY"] : []),
          ...(plan.providers.paymentProviders.includes("razorpay")
            ? ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]
            : []),
        ]
      : []),
    ...(name === "worker" && hasProfile(config, "notifications")
      ? ["RESEND_API_KEY", "MAILPIT_URL"]
      : []),
    ...((name === "api" || name === "worker") && hasProfile(config, "cache") ? ["VALKEY_URL"] : []),
    ...(name !== "python" && hasProfile(config, "observability")
      ? ["OTEL_EXPORTER_OTLP_ENDPOINT"]
      : []),
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
        serverVersion: { candidate: "0.29.5", qualification: "unqualified" },
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
        "deployment/dokploy/adapter.ts",
        `import { readFile } from "node:fs/promises";

type Command = "plan" | "apply" | "inspect" | "promote" | "rollback" | "evidence";
const command = process.argv[2] as Command | undefined;
if (!command || !["plan", "apply", "inspect", "promote", "rollback", "evidence"].includes(command)) throw new Error("Expected plan, apply, inspect, promote, rollback, or evidence");
const baseUrl = process.env.DOKPLOY_URL;
const apiKey = process.env.DOKPLOY_API_KEY;
if (!baseUrl || !apiKey) throw new Error("DOKPLOY_URL and DOKPLOY_API_KEY are required");
const definition = JSON.parse(await readFile("deployment/dokploy/services.json", "utf8")) as { serverVersion: { candidate: string; qualification: string }; services: Array<{ name: string }> };
if ((command === "promote" || command === "apply") && definition.serverVersion.qualification !== "qualified") throw new Error("Dokploy candidate version has not passed its disposable live qualification suite");
const request = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(new URL(\`api/\${path}\`, baseUrl), { ...init, headers: { "content-type": "application/json", "x-api-key": apiKey, ...init?.headers } });
  if (!response.ok) throw new Error(\`Dokploy \${path} failed with HTTP \${response.status}\`);
  return response.json();
};
const evidence: unknown[] = [];
for (const service of definition.services) {
  const key = service.name.toUpperCase().replaceAll("-", "_");
  const applicationId = process.env[\`DOKPLOY_\${key}_APPLICATION_ID\`];
  const digest = process.env[\`RELEASE_\${key}_DIGEST\`];
  if (!applicationId) throw new Error(\`Missing DOKPLOY_\${key}_APPLICATION_ID\`);
  if (["apply", "promote"].includes(command) && (!digest || !/^sha256:[a-f0-9]{64}$/u.test(digest))) throw new Error(\`Missing immutable RELEASE_\${key}_DIGEST\`);
  const deployments = await request(\`deployment.all?applicationId=\${encodeURIComponent(applicationId)}\`);
  if (command === "plan" || command === "inspect" || command === "evidence") evidence.push({ service: service.name, applicationId, desiredDigest: digest ?? null, deployments });
  if (command === "apply" || command === "promote") {
    if (JSON.stringify(deployments).includes(String(digest))) evidence.push({ service: service.name, status: "unchanged", digest });
    else evidence.push(await request("application.deploy", { method: "POST", body: JSON.stringify({ applicationId, imageDigest: digest }) }));
  }
  if (command === "rollback") {
    const deploymentId = process.env[\`ROLLBACK_\${key}_DEPLOYMENT_ID\`];
    const previousDigest = process.env[\`ROLLBACK_\${key}_DIGEST\`];
    if (!deploymentId || !previousDigest) throw new Error("Rollback requires a release-manifest deployment id and compatible previous digest");
    evidence.push(await request("application.redeploy", { method: "POST", body: JSON.stringify({ applicationId, deploymentId, imageDigest: previousDigest }) }));
  }
}
process.stdout.write(\`{"command":"\${command}","observedAt":"\${new Date().toISOString()}","results":\${JSON.stringify(evidence)}}\\n\`);
`,
      ),
      textFile(
        "deployment/dokploy/README.md",
        "# Dokploy runbook\n\nThe adapter exposes idempotent plan/apply/inspect/promote/rollback/evidence command surfaces and uses administrator-controlled API access. The recorded server version is a candidate until its contract and disposable live suite qualify it; apply and promote fail closed before then. Keep stateful dependencies in separate projects, deploy applications by immutable digest, map rollback deployment IDs to the release manifest, and treat encrypted external restore exercises—not successful backup jobs—as recovery evidence.\n",
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
    textFile(
      ".railway/railway.ts",
      `import { defineRailway, ${plan.needsDatabase ? "postgres, " : ""}preserve, project, service } from "railway/iac";

export default defineRailway((context) => {
  if (context.environment !== "staging" && context.environment !== "production") throw new Error("Railway requires separate staging or production environments");
${plan.needsDatabase ? '  const database = postgres("postgres");\n' : ""}${services
  .map(
    (item) => `  const ${item.name.replaceAll("-", "_")} = service(${JSON.stringify(item.name)}, {
    build: ${JSON.stringify(item.name === "python" ? "python3 -m compileall -q services/python/src" : `pnpm --filter ${packageName(config, `${item.name}-app`)}... build`)},
    start: ${JSON.stringify(item.name === "python" ? "cd services/python && python3 -m src.main" : `pnpm --filter ${packageName(config, `${item.name}-app`)} start`)},
    healthcheck: ${JSON.stringify(item.healthCheck.path)},
    ${item.name === "api" && plan.needsDatabase ? 'preDeploy: "pnpm db:migrate",\n    ' : ""}env: { APP_ENV: context.environment, NODE_ENV: "production", ${item.variables
      .filter((name) => name !== "NODE_ENV" && name !== "APP_ENV")
      .map((name) => `${name}: preserve()`)
      .join(", ")} },
  });`,
  )
  .join("\n")}
  return project(${JSON.stringify(config.productId)}, { resources: [${[
    ...(plan.needsDatabase ? ["database"] : []),
    ...services.map((item) => item.name.replaceAll("-", "_")),
  ].join(", ")}] });
});
`,
    ),
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
      "# Railway beta runbook\n\nKeep `.railway/railway.ts` as the only project configuration source. Use separate staging and production projects. Run `railway config plan --out railway-plan.json` and review it before a protected apply. Configure distinct runtime and migrator database roles, an independent export/restore path, and external uptime monitoring; Railway deployment health checks do not replace continuous monitoring. Production admission remains blocked until the exact recipe, provider, project, migration set, and image digests pass deploy, migration, rollback, restore, and monitoring gates.\n",
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
  return jsonFile(`${productIdentity(config).namespace}/project.json`, {
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

function productizeGeneratedFile(config: InitConfig, file: GeneratedFile): GeneratedFile {
  return {
    path: file.path,
    content: file.content.replaceAll("OmniDesk", config.displayName),
  };
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function generateProject(config: InitConfig): GenerationResult {
  const plan = createCapabilityPlan(config);
  const experimentalProfiles = resolveCapabilities(plan.profiles, plan.providers)
    .definitions.filter((definition) => definition.sourceMaturity === "experimental")
    .map((definition) => definition.id);
  if (experimentalProfiles.length > 0 && config.allowExperimental !== true) {
    throw new Error(
      `Experimental profiles require explicit approval: ${experimentalProfiles.join(", ")}`,
    );
  }
  if (config.deployment === "railway" && config.allowBetaTarget !== true) {
    throw new Error("Railway is beta and requires explicit approval");
  }
  if (plan.profiles.includes("mobile") && Date.now() >= Date.parse(MOBILE_WAIVER_EXPIRES_AT)) {
    throw new Error(
      `Mobile generation is disabled because security waiver mobile-image-size-2026-09 expired at ${MOBILE_WAIVER_EXPIRES_AT}`,
    );
  }
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
  if (hasProfile(config, "python")) files.push(...pythonFiles(config));
  files.push(environmentFile(config), ...deploymentFiles(config), starterRecipe(config, plan));
  const unique = new Map<string, GeneratedFile>();
  const caseInsensitivePaths = new Map<string, string>();
  for (const originalFile of files) {
    const file = productizeGeneratedFile(config, originalFile);
    const path = relativeFilePath(file.path);
    if (unique.has(path)) throw new Error(`Generator produced duplicate path: ${path}`);
    const folded = path.toLocaleLowerCase("en-US");
    const previous = caseInsensitivePaths.get(folded);
    if (previous !== undefined && previous !== path)
      throw new Error(
        `Generator produced a case-insensitive path collision: ${previous} and ${path}`,
      );
    if (/(?<!\$)\{\{[^}]+\}\}|__[A-Z0-9_]+__/u.test(file.content))
      throw new Error(`Generator left an unresolved template token in ${path}`);
    caseInsensitivePaths.set(folded, path);
    unique.set(path, { path, content: file.content });
  }
  const withoutMarker = [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  unique.set(
    `${productIdentity(config).namespace}/project.json`,
    generatedMarker(config, withoutMarker),
  );
  const finalFiles = [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return { config, files: finalFiles };
}

const HASH_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

export async function computeSemanticTreeHash(root: string): Promise<string> {
  const entries: { readonly path: string; readonly mode: number; readonly content: Buffer }[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (HASH_IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split("\\").join("/");
      if (entry.isSymbolicLink())
        throw new Error(`Generated output contains a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const metadata = await stat(absolute);
        let content = await readFile(absolute);
        if (relativePath === ".thaarei/starter.json") {
          const parsed = JSON.parse(content.toString("utf8")) as Record<string, unknown>;
          parsed.generatedAt = "normalized";
          parsed.generatedTreeHash = "normalized";
          content = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        }
        entries.push({ path: relativePath, mode: metadata.mode & 0o777, content });
      }
    }
  };
  await visit(resolve(root));
  const hash = createHash("sha256");
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${entry.path}\0${entry.mode.toString(8)}\0${entry.content.byteLength}\0`);
    hash.update(entry.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function writeGeneratedProject(result: GenerationResult): Promise<WriteResult> {
  const outputDir = resolve(result.config.outputDir);
  const markerPath = join(outputDir, productIdentity(result.config).namespace, "project.json");
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
