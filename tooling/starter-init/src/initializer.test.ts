import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
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
        generated.files.find((file) => file.path === ".github/workflows/starter-validation.yml")
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
    expect(mobile.files.some((file) => file.path === ".thaarei/security-waivers.json")).toBe(true);
    expect(web.files.some((file) => file.path === ".thaarei/security-waivers.json")).toBe(false);
  });

  test("generates transactional migrations without a custom outbox", () => {
    const generated = generateProject(config(["api", "data", "jobs"]));
    const migration = generated.files.find(
      (file) => file.path === "packages/database/migrations/0000_starter.sql",
    );
    expect(migration?.content).toMatch(/^BEGIN;/u);
    expect(migration?.content).toMatch(/COMMIT;\n$/u);
    expect(migration?.content).not.toMatch(/outbox/iu);
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
    expect(application?.match(/name: "storage"/gu)).toHaveLength(2);
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
      (file) => file.path === "packages/database/migrations/0000_starter.sql",
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
    expect(written.files).toContain(".thaarei/starter-init.json");
    expect(
      markerProfiles(
        JSON.parse(await readFile(join(outputDir, ".thaarei/starter-init.json"), "utf8")),
      ),
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
  test.each([
    ["identity", "identity requires api and data profiles"],
    ["jobs", "jobs requires data"],
    ["external-api", "external-api requires api"],
    ["ai", "ai requires api, data, and identity"],
    ["storage", "storage requires api, data, and identity"],
    ["durable-ai", "durable-ai requires ai and jobs"],
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
