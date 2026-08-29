import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEPENDENCY_VERSIONS, IMAGE_CATALOG, resolveCapabilities } from "./capabilities.js";
import {
  generateProject,
  type InitConfig,
  type Profile,
  writeGeneratedProject,
} from "./generator.js";
import { InitValidationError, validateInitOptions } from "./validation.js";

function config(profiles: readonly Profile[], mobile = false): InitConfig {
  return {
    productId: "product",
    clientId: "client",
    displayName: "Fixture Client",
    packageScope: "@fixture",
    profiles,
    deployment: "dokploy",
    technicalOwner: "Engineering",
    operationsOwner: "Operations",
    outputDir: ".",
    mobile: mobile
      ? {
          scheme: "fixture",
          iosBundleId: "com.fixture.app",
          androidApplicationId: "com.fixture.app",
        }
      : null,
  };
}

function options(
  profiles: string,
  extra: Readonly<Record<string, string>> = {},
): ReadonlyMap<string, string> {
  return new Map(
    Object.entries({
      "product-id": "product",
      "client-id": "client",
      "display-name": "Fixture Client",
      "package-scope": "@fixture",
      profiles,
      deployment: "dokploy",
      "technical-owner": "Engineering",
      "operations-owner": "Operations",
      ...extra,
    }),
  );
}

function markerProfiles(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || !("profiles" in value))
    throw new Error("Invalid marker");
  const profiles = value.profiles;
  if (
    !Array.isArray(profiles) ||
    !profiles.every((profile): profile is string => typeof profile === "string")
  )
    throw new Error("Invalid marker profiles");
  return profiles;
}

function generatedJson(generated: ReturnType<typeof generateProject>, path: string): unknown {
  const file = generated.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Missing generated file: ${path}`);
  return JSON.parse(file.content);
}

function jsonRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is not a JSON object`);
  return Object.fromEntries(Object.entries(value));
}

function dependencyNames(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || !("dependencies" in value)) return [];
  const dependencies = value.dependencies;
  if (typeof dependencies !== "object" || dependencies === null) return [];
  return Object.keys(dependencies);
}

describe("starter profile generation", () => {
  const approvedFixtures: ReadonlyArray<readonly [string, readonly Profile[]]> = [
    ["web-only", ["web"]],
    ["internal-tool", ["web", "api", "data"]],
    ["web-mobile", ["web", "mobile", "api", "data", "identity"]],
    ["durable-agent", ["api", "data", "identity", "ai", "jobs", "durable-ai"]],
    ["external-rest", ["api", "data", "external-api"]],
    ["dms-core", ["api", "data", "identity", "jobs", "external-api", "storage"]],
  ];
  test.each(approvedFixtures)(
    "generates the approved %s fixture without source docs",
    (_name, profiles) => {
      const generated = generateProject(config(profiles, profiles.includes("mobile")));
      const paths = generated.files.map((file) => file.path);
      expect(paths).toContain(".dockerignore");
      expect(generated.files.find((file) => file.path === ".dockerignore")?.content).toContain(
        "**/node_modules",
      );
      expect(
        generated.files.find((file) => file.path === ".github/workflows/product-validation.yml")
          ?.content,
      ).toContain("pnpm install --frozen-lockfile --ignore-scripts");
      for (const file of generated.files.filter(
        (candidate) =>
          candidate.path.endsWith("Dockerfile") && candidate.path !== "services/python/Dockerfile",
      )) {
        expect(file.content).toContain("pnpm install --frozen-lockfile --ignore-scripts");
        expect(file.content).toMatch(/pnpm --filter @[^\s]+\.\.\. build/);
      }
      expect(paths).not.toContain("docs/engineering-starter-kit.md");
      expect(paths).not.toContain("templates/AGENTS.md");
      if (!profiles.includes("mobile"))
        expect(paths.some((path) => path.startsWith("apps/mobile/"))).toBe(false);
      if (!profiles.includes("web"))
        expect(paths.some((path) => path.startsWith("apps/web/"))).toBe(false);
      if (!profiles.includes("jobs"))
        expect(paths.some((path) => path.startsWith("apps/worker/"))).toBe(false);
      if (!profiles.includes("data") && !profiles.includes("storage"))
        expect(paths.some((path) => path.startsWith("packages/database/"))).toBe(false);
      for (const capability of ["identity", "jobs", "ai", "external-api", "storage"])
        expect(paths.some((path) => path.startsWith(`packages/${capability}/`))).toBe(false);
      expect(
        paths
          .filter((path) => path.startsWith("packages/"))
          .every((path) =>
            [
              "foundation",
              "core",
              "contracts",
              "database",
              "adapters",
              "api",
              "api-client",
              "design-tokens",
              "test-support",
            ].some((owner) => path.startsWith(`packages/${owner}/`)),
          ),
      ).toBe(true);
      const needsApi =
        profiles.includes("api") ||
        profiles.includes("identity") ||
        profiles.includes("external-api");
      const needsClient =
        needsApi &&
        (profiles.includes("web") ||
          profiles.includes("mobile") ||
          profiles.includes("external-api"));
      if (!needsApi) expect(paths.some((path) => path.startsWith("packages/api/"))).toBe(false);
      if (needsApi && !profiles.includes("identity") && !profiles.includes("external-api")) {
        expect(
          generated.files.find((file) => file.path === "packages/api/src/index.ts")?.content,
        ).not.toContain("FastifyInstance");
      }
      if (!needsClient)
        expect(paths.some((path) => path.startsWith("packages/api-client/"))).toBe(false);
      if (!profiles.includes("web") && !profiles.includes("mobile"))
        expect(paths.some((path) => path.startsWith("packages/design-tokens/"))).toBe(false);
      expect(paths.some((path) => path.startsWith("deployment/dokploy/"))).toBe(true);
    },
  );

  test("generates Railway output only when Railway is selected", () => {
    const generated = generateProject({
      ...config(["web", "api", "data", "jobs"]),
      deployment: "railway",
    });
    const paths = generated.files.map((file) => file.path);
    const services = JSON.stringify(generatedJson(generated, "deployment/railway/services.json"));
    expect(paths.some((path) => path.startsWith("deployment/railway/"))).toBe(true);
    expect(paths.some((path) => path.startsWith("deployment/dokploy/"))).toBe(false);
    for (const application of ["web", "api", "worker"]) {
      expect(services).toContain(
        `pnpm install --frozen-lockfile --ignore-scripts && pnpm --filter @fixture/${application}-app... build`,
      );
    }
  });

  test("keeps optional dependencies and environment variables inside selected profiles", () => {
    const web = generateProject(config(["web"]));
    expect(dependencyNames(generatedJson(web, "apps/web/package.json"))).toEqual(
      expect.arrayContaining([
        "@base-ui/react",
        "@tanstack/react-form",
        "@tanstack/react-query",
        "next",
        "tailwindcss",
      ]),
    );
    const webPaths = web.files.map((file) => file.path);
    expect(webPaths.some((path) => path.startsWith("packages/api/"))).toBe(false);
    expect(web.files.find((file) => file.path === ".env.example")?.content).not.toContain(
      "DATABASE_URL",
    );

    const mobile = generateProject(config(["mobile"], true));
    expect(dependencyNames(generatedJson(mobile, "apps/mobile/package.json"))).toEqual(
      expect.arrayContaining([
        "expo-notifications",
        "expo-router",
        "expo-secure-store",
        "react-native-gesture-handler",
        "react-native-reanimated",
        "react-native-unistyles",
      ]),
    );
    expect(mobile.files.some((file) => file.path === ".product/security-waivers.json")).toBe(true);
    expect(web.files.some((file) => file.path === ".product/security-waivers.json")).toBe(false);
  });

  test("generates database-owned transactional migrations without a custom outbox", () => {
    const generated = generateProject(config(["api", "data", "jobs"]));
    const migration = generated.files.find(
      (file) => file.path === "packages/database/migrations/0000_product.sql",
    );
    const runner = generated.files.find((file) => file.path === "packages/database/src/migrate.ts");
    expect(runner?.content).toContain('createHash("sha256")');
    expect(runner?.content).toContain("product_migrations");
    expect(runner?.content).toMatch(/\.begin\(/u);
    expect(runner?.content).toMatch(/checksum/iu);
    expect(migration?.content).not.toMatch(/^BEGIN;/u);
    expect(migration?.content).not.toMatch(/COMMIT;\n$/u);
    expect(migration?.content).not.toMatch(/outbox/iu);
  });

  test("generates the web handoff contract only for selected profiles", () => {
    const generated = generateProject(config(["web", "api", "data", "identity"]));
    const paths = generated.files.map((file) => file.path);
    const rootManifest = JSON.stringify(generatedJson(generated, "package.json"));
    const apiManifest = JSON.stringify(generatedJson(generated, "apps/api/package.json"));
    const webManifest = JSON.stringify(generatedJson(generated, "apps/web/package.json"));
    const turbo = JSON.stringify(generatedJson(generated, "turbo.json"));
    const release = JSON.stringify(generatedJson(generated, "release-manifest.json"));
    const readme = generated.files.find((file) => file.path === "README.md")?.content ?? "";
    const guide =
      generated.files.find((file) => file.path === "docs/developer-guide.md")?.content ?? "";
    const environment = generated.files.find((file) => file.path === ".env.example")?.content ?? "";
    const compose = generated.files.find((file) => file.path === "compose.yaml")?.content ?? "";
    const apiClient =
      generated.files.find((file) => file.path === "packages/api-client/src/index.ts")?.content ??
      "";
    const api =
      generated.files.find((file) => file.path === "packages/api/src/index.ts")?.content ?? "";
    const web = generated.files
      .filter((file) => file.path.startsWith("apps/web/"))
      .map((file) => file.content)
      .join("\n");

    expect(paths).toEqual(
      expect.arrayContaining([
        "compose.yaml",
        "docs/developer-guide.md",
        "packages/database/src/migrate.ts",
        "apps/web/app/api/auth/[...path]/route.ts",
        "apps/web/app/trpc/[...path]/route.ts",
      ]),
    );
    for (const command of ["dev", "db:up", "db:migrate", "db:down", "smoke:web"])
      expect(rootManifest).toContain(`"${command}"`);
    expect(apiManifest).toContain("node --env-file=../../.env --import tsx --watch src/index.ts");
    expect(webManifest).toContain("next dev -p 3000");
    expect(turbo).toContain('"persistent":true');
    expect(compose).toMatch(/127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432/u);
    expect(compose).toContain("product-postgres-data:/var/lib/postgresql");
    expect(readme).toContain("pnpm dev");
    for (const profile of ["web", "api", "data", "identity"])
      expect(guide).toContain(`\`${profile}\``);
    for (const maturity of ["ready baseline", "scaffold", "deferred integration"])
      expect(guide).toContain(maturity);
    for (const moduleName of ["identity", "test-support", "design-tokens"])
      expect(guide).toContain(`| ${moduleName} |`);
    for (const variable of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "API_INTERNAL_URL",
      "PORT",
    ])
      expect(environment).toContain(variable);
    expect(apiClient).toContain("createApiClient");
    expect(apiClient).toContain('credentials: "include"');
    expect(apiClient).toMatch(/import type \{ AppRouter \}/u);
    expect(apiClient).not.toMatch(/import \{[^}]*AppRouter/u);
    expect(apiClient).toContain("createAuthClient");
    expect(api).toMatch(/export type AppRouter = typeof appRouter/u);
    expect(api).not.toContain("readonly authentication?:");
    expect(api).not.toContain("readonly identity?:");
    expect(release).toContain('"gate":"web-developer-handoff"');
    expect(release).toContain('"status":"passed"');
    expect(web).toContain("API_INTERNAL_URL");
    expect(web).toContain("path.map((segment) => encodeURIComponent(segment))");
    expect(web).toContain("signUp.email");
    expect(web).toContain("signIn.email");
  });

  test("keeps the web-only handoff free of server capability artifacts", () => {
    const generated = generateProject(config(["web"]));
    const paths = generated.files.map((file) => file.path);
    const content = generated.files.map((file) => file.content).join("\n");
    const guide =
      generated.files.find((file) => file.path === "docs/developer-guide.md")?.content ?? "";
    const environment =
      generated.files.find((file) => file.path === "docs/environment-reference.md")?.content ?? "";
    expect(paths).not.toContain("compose.yaml");
    expect(paths.some((path) => path.startsWith("packages/database/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("packages/api-client/"))).toBe(false);
    expect(content).not.toMatch(
      /db:up|db:migrate|db:down|DATABASE_URL|BETTER_AUTH|API_INTERNAL_URL/u,
    );
    expect(guide).toContain("`web`");
    for (const profile of ["`api`", "`data`", "`identity`", "`mobile`"])
      expect(guide).not.toContain(profile);
    expect(guide).not.toContain("authentication transport");
    expect(environment).toContain("| PORT | 3000 |");
    expect(environment).not.toContain("3001");
  });

  test("derives health types and keeps OpenAPI readiness fields in parity", () => {
    const generated = generateProject(config(["api", "external-api"]));
    const contracts =
      generated.files.find((file) => file.path === "packages/contracts/src/index.ts")?.content ??
      "";
    const openApi = generatedJson(generated, "openapi.json");
    expect(contracts).toContain(
      "export type HealthResponse = z.infer<typeof healthResponseSchema>",
    );
    expect(contracts).toContain(
      "export type ProblemDetails = z.infer<typeof problemDetailsSchema>",
    );
    const components = jsonRecord(jsonRecord(openApi, "OpenAPI document").components, "components");
    const schemas = jsonRecord(components.schemas, "schemas");
    expect(schemas.HealthResponse).toEqual({
      type: "object",
      required: ["status", "checkedAt"],
      properties: {
        status: { type: "string", enum: ["ok", "degraded"] },
        checkedAt: { type: "string", format: "date-time" },
        detail: { type: "string" },
        failedDependency: { type: "string" },
      },
    });
    expect(schemas.ProblemDetails).toEqual({
      type: "object",
      required: ["type", "title", "status"],
      properties: {
        type: { type: "string" },
        title: { type: "string" },
        status: { type: "integer" },
        detail: { type: "string" },
      },
    });
  });

  test("keeps the external API web profile internally consistent", () => {
    const generated = generateProject(config(["web", "api", "data", "identity", "external-api"]));
    const paths = generated.files.map((file) => file.path);
    const page = generated.files.find((file) => file.path === "apps/web/app/page.tsx")?.content;
    const apiClient = generated.files.find(
      (file) => file.path === "packages/api-client/src/index.ts",
    )?.content;

    expect(page).toContain("ReferenceFlow");
    expect(paths).toContain("apps/web/app/reference-flow.tsx");
    expect(apiClient).toContain("createApiClient");
    expect(apiClient).toContain("authClient");
    expect(apiClient).toContain('export * as externalApi from "./generated/index.js"');
    expect(apiClient).not.toContain("packages/api/src");
    expect(paths).toEqual(
      expect.arrayContaining([
        "apps/web/app/trpc/[...path]/route.ts",
        "apps/web/app/api/auth/[...path]/route.ts",
        "apps/web/app/v1/[...path]/route.ts",
      ]),
    );
  });

  test("adds local object storage only when storage is selected", () => {
    const withStorage = generateProject(config(["api", "data", "identity", "storage"]));
    const withoutStorage = generateProject(config(["api", "data", "identity"]));
    const compose = withStorage.files.find((file) => file.path === "compose.yaml")?.content ?? "";
    const environment =
      withStorage.files.find((file) => file.path === ".env.example")?.content ?? "";
    const plainCompose =
      withoutStorage.files.find((file) => file.path === "compose.yaml")?.content ?? "";
    expect(compose).toContain("minio/minio:");
    expect(compose).toContain("object-storage-init:");
    expect(environment).toContain("STORAGE_ENDPOINT=http://127.0.0.1:9000");
    expect(environment).toContain("STORAGE_BUCKET=product");
    expect(plainCompose).not.toContain("object-storage");
  });

  test("separates worker environment and local port from the API", () => {
    const generated = generateProject(config(["api", "data", "jobs"]));
    const workerManifest =
      generated.files.find((file) => file.path === "apps/worker/package.json")?.content ?? "";
    const worker =
      generated.files.find((file) => file.path === "apps/worker/src/index.ts")?.content ?? "";
    const environment = generated.files.find((file) => file.path === ".env.example")?.content ?? "";
    expect(workerManifest).toContain("--env-file=../../.env");
    expect(worker).toContain("WORKER_PORT");
    expect(worker).toContain("default(3002)");
    expect(environment).toContain("WORKER_PORT=3002");
  });

  test("keeps non-web developer guidance profile accurate", () => {
    const generated = generateProject(config(["api", "data"]));
    const guide =
      generated.files.find((file) => file.path === "docs/developer-guide.md")?.content ?? "";
    const environment =
      generated.files.find((file) => file.path === "docs/environment-reference.md")?.content ?? "";

    expect(guide).toContain("| database |");
    expect(guide).toContain("| api |");
    expect(guide).not.toMatch(/browser|Next\.js|API_INTERNAL_URL|dev:web|port 3000/iu);
    expect(environment).toContain("| PORT | 3001 | API port. |");
    expect(environment).not.toContain("web app");
  });

  test("documents selected storage modules without claiming product completion", () => {
    const generated = generateProject(config(["api", "data", "identity", "storage"]));
    const guide =
      generated.files.find((file) => file.path === "docs/developer-guide.md")?.content ?? "";

    expect(guide).toContain("| identity | ready baseline |");
    expect(guide).toContain("| storage | scaffold |");
    expect(guide).toContain("deferred integration");
    expect(guide).not.toMatch(/browser|Next\.js|API_INTERNAL_URL|dev:web|port 3000/iu);
  });

  test("does not emit unsafe assertions in generated production web stack", () => {
    const generated = generateProject(config(["web", "api", "data", "identity"]));
    const production = generated.files
      .filter(
        (file) =>
          /^(?:apps\/(?:api|web)|packages\/(?:api|api-client|contracts|database|adapters))\/src\//u.test(
            file.path,
          ) || file.path.startsWith("apps/web/app/"),
      )
      .map((file) => file.content)
      .join("\n");
    expect(production).not.toMatch(/:\s*any\b|<any>|\bas\s+unknown\s+as\b|\bas\s+any\b/u);
  });

  test("does not leak Graphile Worker into data without jobs", () => {
    const generated = generateProject(config(["api", "data"]));
    const content = generated.files.map((file) => file.content).join("\n");
    const paths = generated.files.map((file) => file.path);
    expect(content).not.toMatch(/graphile[_-]worker|WORKER_CONCURRENCY/iu);
    expect(paths.some((path) => path.startsWith("apps/worker/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("packages/jobs/"))).toBe(false);
  });

  test("refuses internally inconsistent AI and storage generation plans", () => {
    expect(() => generateProject(config(["api", "ai"]))).toThrow(
      "ai requires api, data, and identity",
    );
    expect(() => generateProject(config(["api", "data", "storage"]))).toThrow(
      "storage requires api, data, and identity",
    );
  });

  test("passes storage readiness to first-party and external health routes", () => {
    const generated = generateProject(
      config(["api", "data", "identity", "storage", "external-api"]),
    );
    const application = generated.files.find(
      (file) => file.path === "apps/api/src/index.ts",
    )?.content;
    const api = generated.files.find((file) => file.path === "packages/api/src/index.ts")?.content;
    expect(application?.match(/name: "storage"/gu)).toHaveLength(2);
    expect(api).toContain('Partial<Pick<ApiDependencies, "database" | "readinessChecks">>');
  });

  test("persists Better Auth artifacts and maps them to application identity", () => {
    const generated = generateProject(config(["api", "data", "identity"]));
    const database = generated.files.find(
      (file) => file.path === "packages/database/src/index.ts",
    )?.content;
    const adapters = generated.files.find(
      (file) => file.path === "packages/adapters/src/index.ts",
    )?.content;
    const application = generated.files.find(
      (file) => file.path === "apps/api/src/index.ts",
    )?.content;
    const migration = generated.files.find(
      (file) => file.path === "packages/database/migrations/0000_product.sql",
    )?.content;

    expect(database).toContain('pgTable("session"');
    expect(database).toContain("ensureAuthenticationSubject");
    expect(adapters).toContain('from "better-auth/adapters/drizzle"');
    expect(adapters).toContain("databaseHooks");
    expect(application).toContain("database.authentication.database");
    expect(migration).toContain('CREATE TABLE "session"');
  });

  test("keeps provider capabilities out of a web-only repository", () => {
    const generated = generateProject(config(["web"]));
    const content = generated.files.map((file) => file.content).join("\n");
    expect(content).not.toMatch(
      /better-auth|graphile-worker|@aws-sdk|AI_MODEL|DATABASE_URL|STORAGE_BUCKET/u,
    );
  });

  test("generates a separately deployable Python service only with a caller", () => {
    expect(() => validateInitOptions(options("python"))).toThrow(
      "python requires an api or jobs calling profile",
    );
    const generated = generateProject(config(["api", "python"]));
    const services = generatedJson(generated, "deployment/dokploy/services.json");
    expect(generated.files.some((file) => file.path === "services/python/Dockerfile")).toBe(true);
    expect(generated.files.find((file) => file.path === "package.json")?.content).toContain(
      "check:python",
    );
    expect(JSON.stringify(services)).toContain('"source":"services/python"');
  });

  test("writes once and leaves a deterministic marker", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "thaarei-starter-"));
    const generated = generateProject({ ...config(["web"]), outputDir });
    const written = await writeGeneratedProject(generated);
    expect(written.files).toContain(".product/project.json");
    expect(
      markerProfiles(JSON.parse(await readFile(join(outputDir, ".product/project.json"), "utf8"))),
    ).toEqual(["web"]);
    await expect(writeGeneratedProject(generated)).rejects.toThrow("already initialized");
  });

  test("preflights every target before writing any generated file", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "thaarei-starter-collision-"));
    await mkdir(join(outputDir, "tooling", "governance", "src"), { recursive: true });
    const collision = join(outputDir, "turbo.json");
    await writeFile(collision, "user-owned\n");
    const generated = generateProject({ ...config(["web"]), outputDir });

    await expect(writeGeneratedProject(generated)).rejects.toThrow("Refusing to overwrite");
    await expect(readFile(join(outputDir, "package.json"), "utf8")).rejects.toThrow();
    await expect(readFile(collision, "utf8")).resolves.toBe("user-owned\n");
  });
});

describe("starter profile validation", () => {
  test("normalizes the deprecated durable-ai alias in the V2 capability manifest", () => {
    const manifest = resolveCapabilities([
      "api",
      "data",
      "identity",
      "ai",
      "jobs",
      "events",
      "durable-ai",
    ]);
    expect(manifest.profiles).toContain("agentic-ai");
    expect(manifest.profiles).not.toContain("durable-ai");
    expect(manifest.deprecatedAliases).toEqual(["durable-ai"]);
  });

  test("generates image provenance from the shared catalog", () => {
    const generated = generateProject(config(["api", "data", "identity", "storage"]));
    const compose = generated.files.find((file) => file.path === "compose.yaml")?.content ?? "";
    const release = generatedJson(generated, "release-manifest.json");
    expect(compose).toContain(
      `${IMAGE_CATALOG.postgresql.reference}@${IMAGE_CATALOG.postgresql.digest}`,
    );
    expect(compose).toContain(`${IMAGE_CATALOG.minio.reference}@${IMAGE_CATALOG.minio.digest}`);
    expect(JSON.stringify(release)).toContain(IMAGE_CATALOG.minio.digest);
  });

  test("uses published Expo package pins from the shared dependency catalog", () => {
    const mobile = generatedJson(
      generateProject(config(["mobile"], true)),
      "apps/mobile/package.json",
    );
    expect(jsonRecord(mobile, "mobile package").dependencies).toMatchObject({
      expo: DEPENDENCY_VERSIONS.expo,
      "expo-notifications": DEPENDENCY_VERSIONS.notifications,
      "expo-router": DEPENDENCY_VERSIONS.expoRouter,
      "expo-secure-store": DEPENDENCY_VERSIONS.secureStore,
    });
  });

  test("derives the external API boundary for the exact DMS Core profile", () => {
    const generated = generateProject(
      config(["api", "data", "identity", "jobs", "external-api", "storage"]),
    );
    const api = generated.files.find((file) => file.path === "packages/api/src/index.ts")?.content;

    expect(api).toContain('Partial<Pick<ApiDependencies, "database" | "readinessChecks">>');
  });

  test("generates provider-neutral core invocation and authorization boundaries", () => {
    const generated = generateProject(config(["api", "data", "identity", "jobs"]));
    const core =
      generated.files.find((file) => file.path === "packages/core/src/index.ts")?.content ?? "";
    expect(core).toContain("export interface ActorContext");
    expect(core).toContain("export interface PublicContext");
    expect(core).toContain("export interface AuthorizationService");
    for (const error of [
      "UnauthenticatedError",
      "ForbiddenError",
      "ResourceNotFoundError",
      "RetryableWorkflowError",
    ]) {
      expect(core).toContain(`export class ${error}`);
    }
  });

  test("keeps tenancy artifacts optional and generates fail-closed RLS when selected", () => {
    const identity = generateProject(config(["api", "data", "identity"]));
    const tenant = generateProject(config(["api", "data", "identity", "tenancy"]));
    const identityMigration =
      identity.files.find((file) => file.path === "packages/database/migrations/0000_product.sql")
        ?.content ?? "";
    const tenantMigration =
      tenant.files.find((file) => file.path === "packages/database/migrations/0000_product.sql")
        ?.content ?? "";
    expect(identityMigration).not.toContain("CREATE TABLE organizations");
    for (const owner of [
      "organizations",
      "memberships",
      "governance_role_assignments",
      "product_role_assignments",
      "permission_definitions",
      "permission_grants",
      "invitations",
      "authorization_audit_events",
    ]) {
      expect(tenantMigration).toContain(`CREATE TABLE ${owner}`);
    }
    expect(tenantMigration).toContain("FORCE ROW LEVEL SECURITY");
    expect(tenantMigration).toContain("app_current_organization_id()");
    expect(tenantMigration).toContain("protect_last_organization_owner");
    const tenantDatabase =
      tenant.files.find((file) => file.path === "packages/database/src/index.ts")?.content ?? "";
    expect(tenantDatabase).toContain("callback(transaction)");
    expect(tenantDatabase).toContain("postgres.TransactionSql");
  });

  test("generates transactional outbox, dead-letter, and inbox persistence only for events", () => {
    const jobs = generateProject(config(["data", "jobs"]));
    const events = generateProject(config(["data", "jobs", "events"]));
    const jobsMigration =
      jobs.files.find((file) => file.path === "packages/database/migrations/0000_product.sql")
        ?.content ?? "";
    const eventMigration =
      events.files.find((file) => file.path === "packages/database/migrations/0000_product.sql")
        ?.content ?? "";
    expect(jobsMigration).not.toContain("outbox_events");
    for (const table of [
      "outbox_events",
      "outbox_delivery_attempts",
      "outbox_dead_letters",
      "inbox_receipts",
    ]) {
      expect(eventMigration).toContain(`CREATE TABLE ${table}`);
    }
    expect(eventMigration).toContain("fencing_token bigint");
    expect(eventMigration).toContain("UNIQUE (destination, idempotency_key)");
    expect(eventMigration).toContain("UNIQUE (consumer, event_id)");
    const core =
      events.files.find((file) => file.path === "packages/core/src/index.ts")?.content ?? "";
    expect(core).toContain("export const domainEventSchema = z.object");
  });

  test("records Zod for a jobs-only contract package in release provenance", () => {
    const generated = generateProject(config(["data", "jobs"]));
    const contracts = jsonRecord(
      generatedJson(generated, "packages/contracts/package.json"),
      "contracts",
    );
    const dependencies = jsonRecord(contracts.dependencies, "contract dependencies");
    expect(dependencies.zod).toBe(DEPENDENCY_VERSIONS.zod);
    const release = jsonRecord(generatedJson(generated, "release-manifest.json"), "release");
    const testedPackages = jsonRecord(release.testedPackages, "tested packages");
    expect(testedPackages.zod).toBe(DEPENDENCY_VERSIONS.zod);
  });

  test("generates logical AI models and durable run evidence", () => {
    const generated = generateProject(config(["api", "data", "identity", "ai"]));
    const core =
      generated.files.find((file) => file.path === "packages/core/src/index.ts")?.content ?? "";
    const migration =
      generated.files.find((file) => file.path === "packages/database/migrations/0000_product.sql")
        ?.content ?? "";
    for (const logicalModel of [
      "chat.fast",
      "chat.quality",
      "structured.default",
      "embedding.default",
    ]) {
      expect(core).toContain(logicalModel);
    }
    expect(core).toContain("export interface AiCompletionTransaction");
    for (const table of [
      "ai_runs",
      "ai_attempts",
      "ai_usage",
      "ai_audit_events",
      "ai_telemetry_events",
      "ai_evaluations",
      "agent_tool_calls",
      "agent_run_leases",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration).toContain("UNIQUE (organization_id, idempotency_key)");
    expect(migration).toContain("fencing_token bigint");
  });

  test("generates platform policy owners only for selected capabilities", () => {
    const platform = generateProject(
      config([
        "api",
        "data",
        "identity",
        "tenancy",
        "jobs",
        "events",
        "ai",
        "payments",
        "notifications",
        "cache",
        "rate-limit",
        "search",
        "rag",
        "storage",
        "python",
        "observability",
        "feature-flags",
      ]),
    );
    const core =
      platform.files.find((file) => file.path === "packages/core/src/index.ts")?.content ?? "";
    expect(core).toContain("DefaultAuthorizationService");
    expect(core).toContain("redactSensitive");
    expect(core).toContain("verifySignedWebhook");
    expect(core).toContain("evaluateRateLimit");
    expect(core).toContain("evaluateFeatureFlag");
    expect(core).toContain("canReadSearchDocument");
    expect(core).toContain("chunkText");
    const manifest = generatedJson(platform, ".product/capabilities.json");
    expect(JSON.stringify(manifest)).toContain("PAYMENT_WEBHOOK_SECRET");
    const release = JSON.stringify(generatedJson(platform, "release-manifest.json"));
    expect(release).toContain(IMAGE_CATALOG.valkey.digest);
    expect(release).toContain(IMAGE_CATALOG.mailpit.digest);
    expect(release).toContain(IMAGE_CATALOG.otelCollector.digest);
    const worker =
      platform.files.find((file) => file.path === "apps/worker/src/index.ts")?.content ?? "";
    expect(worker).toContain("RESEND_API_KEY");
    const railway = JSON.stringify(generatedJson(platform, "deployment/dokploy/services.json"));
    expect(railway).toContain("RESEND_API_KEY");

    const plain = generateProject(config(["api"]));
    const plainCore =
      plain.files.find((file) => file.path === "packages/core/src/index.ts")?.content ?? "";
    expect(plainCore).not.toContain("verifySignedWebhook");
    expect(plainCore).not.toContain("chunkText");
  });

  test("keeps cache-only Compose output free of an unselected database", () => {
    const cache = generateProject(config(["cache"]));
    const compose = cache.files.find((file) => file.path === "compose.yaml")?.content ?? "";
    expect(compose).toContain(`${IMAGE_CATALOG.valkey.reference}@${IMAGE_CATALOG.valkey.digest}`);
    expect(compose).not.toContain("postgres:");
    expect(compose).not.toContain("starter-postgres-data");
  });

  test("rejects selecting a canonical profile and its deprecated alias together", () => {
    expect(() =>
      resolveCapabilities([
        "api",
        "data",
        "identity",
        "ai",
        "jobs",
        "events",
        "agentic-ai",
        "durable-ai",
      ]),
    ).toThrow("Duplicate capability selection after canonicalization");
  });

  test.each([
    ["identity", "identity requires api and data profiles"],
    ["jobs", "jobs requires data"],
    ["external-api", "external-api requires api"],
    ["ai", "ai requires api, data, and identity"],
    ["storage", "storage requires api, data, and identity"],
    ["durable-ai", "durable-ai requires ai and jobs"],
    ["tenancy", "tenancy requires identity, api, and data"],
  ])("rejects invalid %s combinations", (profile, message) => {
    expect(() => validateInitOptions(options(profile))).toThrow(message);
  });

  test("requires mobile identifiers only for mobile", () => {
    expect(() => validateInitOptions(options("web", { "mobile-scheme": "fixture" }))).toThrow(
      "only valid",
    );
    expect(() =>
      validateInitOptions(
        options("mobile", {
          "mobile-scheme": "fixture",
          "ios-bundle-id": "com.fixture.app",
          "android-application-id": "com.fixture.app",
        }),
      ),
    ).not.toThrow();
    expect(() => validateInitOptions(options("mobile"))).toThrow(
      "Missing required option: --mobile-scheme",
    );
  });

  test("validates native application identifiers before generation", () => {
    expect(() =>
      validateInitOptions(
        options("mobile", {
          "mobile-scheme": "bad scheme",
          "ios-bundle-id": "com.fixture.app",
          "android-application-id": "com.fixture.app",
        }),
      ),
    ).toThrow("Invalid mobile-scheme");
    expect(() =>
      validateInitOptions(
        options("mobile", {
          "mobile-scheme": "fixture",
          "ios-bundle-id": "com.fixture.app",
          "android-application-id": "Com.Fixture.App",
        }),
      ),
    ).toThrow("Invalid android-application-id");
  });

  test("rejects unknown and duplicate profiles", () => {
    expect(() => validateInitOptions(options("web,unknown"))).toThrow(InitValidationError);
    expect(() => validateInitOptions(options("web,web"))).toThrow("Duplicate profile");
  });

  test("uses a safe deterministic output directory when output is omitted", () => {
    expect(validateInitOptions(options("web")).outputDir).toBe(".thaarei/generated/client");
  });

  test("accepts syntax-sensitive Unicode text and rejects control characters", () => {
    const value = options("web", { "display-name": `Acme "<: 产品 🚀` });
    expect(validateInitOptions(value).displayName).toBe(`Acme "<: 产品 🚀`);
    expect(() => validateInitOptions(options("web", { "display-name": "bad\nname" }))).toThrow(
      "newlines and control characters",
    );
    expect(() =>
      validateInitOptions(options("web", { "technical-owner": "ops\u0000team" })),
    ).toThrow("newlines and control characters");
  });

  test("serializes syntax-sensitive display names in generated TSX", () => {
    const generated = generateProject({
      ...config(["web"]),
      displayName: `Acme "<: 产品 🚀`,
    });
    const page = generated.files.find((file) => file.path === "apps/web/app/page.tsx")?.content;
    expect(page).toContain('{"Acme \\"<: 产品 🚀"}');
  });
});
