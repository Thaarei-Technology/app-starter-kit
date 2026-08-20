import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { checkBoundaries } from "../src/boundaries.js";
import {
  checkImplementation,
  createWorkItem,
  parseWorkItem,
  syncImplementation,
} from "../src/implementation.js";
import { checkSourceOfTruth } from "../src/source-of-truth.js";

const temporaryRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), "thaarei-governance-"));

const metadata = (id: string, keyword: string, how: string, extra = ""): string => `/**
 * SOURCE OF TRUTH ID: ${id}
 * SOURCE OF TRUTH KEYWORDS: ${keyword}
 * WHAT: Canonical owner.
 * WHY: Keeps the concern in one place.
 * WHEN: When the concern is used.
 * HOW: \`${how}\`
 * BOUNDARIES: ${extra || "Does not cross its declared boundary."}
 */`;

test("source-of-truth accepts a complete architectural owner", async () => {
  const root = await temporaryRoot();
  const file = join(root, "owner.ts");
  await writeFile(
    file,
    `${metadata("owner.service", "orders", "OrderService.execute")}\nexport class OrderService {\n  execute(): void {}\n}\n`,
  );
  const result = await checkSourceOfTruth(root);
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
});

test("source-of-truth rejects missing fields and stale HOW symbols", async () => {
  const root = await temporaryRoot();
  await writeFile(
    join(root, "owner.ts"),
    `/**\n * SOURCE OF TRUTH ID: broken\n * SOURCE OF TRUTH KEYWORDS: broken\n * WHAT: Missing required fields.\n * HOW: \`missingEntry\`\n */\nexport class BrokenOwner {}\n`,
  );
  const result = await checkSourceOfTruth(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SOT_MISSING_FIELD"));
  // A complete block with a stale entrypoint is a separate negative case.
  await writeFile(
    join(root, "stale.ts"),
    `${metadata("stale", "stale", "missingEntry")}\nexport class StaleOwner {}\n`,
  );
  const stale = await checkSourceOfTruth(root);
  assert.ok(stale.diagnostics.some((diagnostic) => diagnostic.code === "SOT_STALE_HOW"));
});

test("source-of-truth rejects duplicate IDs, overlapping keywords, and trivial helpers", async () => {
  const root = await temporaryRoot();
  await writeFile(
    join(root, "owners.ts"),
    `${metadata("duplicate", "shared", "FirstOwner")}\nexport class FirstOwner {}\n\n${metadata("duplicate", "shared", "SecondOwner")}\nexport class SecondOwner {}\n\n${metadata("trivial", "helper", "add")}\nexport function add(left: number, right: number): number { return left + right; }\n`,
  );
  const result = await checkSourceOfTruth(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SOT_DUPLICATE_ID"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SOT_OVERLAPPING_KEYWORD"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SOT_TRIVIAL_OWNER"));
});

test("source-of-truth rejects generic utility dumping grounds", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "utils"), { recursive: true });
  await writeFile(
    join(root, "utils", "index.ts"),
    `${metadata("utils", "utility", "utils")}\nexport function utils(): void {}\n`,
  );
  const result = await checkSourceOfTruth(root);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "SOT_GENERIC_DUMPING_GROUND"),
  );
});

test("boundaries reject database leakage, package-to-app imports, core dependencies, and provider SDKs", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "packages", "database"), { recursive: true });
  await mkdir(join(root, "packages", "core"), { recursive: true });
  await mkdir(join(root, "packages", "adapters"), { recursive: true });
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await writeFile(
    join(root, "packages", "database", "package.json"),
    JSON.stringify({ name: "@test/database" }),
  );
  await writeFile(
    join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@test/core" }),
  );
  await writeFile(
    join(root, "packages", "adapters", "package.json"),
    JSON.stringify({ name: "@test/adapters" }),
  );
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "@test/web" }));
  await writeFile(
    join(root, "packages", "core", "bad.ts"),
    `import { sql } from "drizzle-orm";\nimport postgres from "postgres";\nimport { web } from "@test/web";\nimport Stripe from "stripe";\n`,
  );
  await writeFile(join(root, "apps", "web", "bad.ts"), `import { db } from "@test/database";\n`);
  const result = await checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_DATABASE_DRIVER"),
  );
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_PACKAGE_TO_APP"));
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_CLIENT_DATABASE"),
  );
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_CORE_DEPENDENCY"),
  );
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_PROVIDER_SDK"));
});

test("boundaries reject direct postgres driver imports outside packages/database", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "packages", "core"), { recursive: true });
  await writeFile(
    join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@test/core" }),
  );
  await writeFile(join(root, "packages", "core", "bad.ts"), 'import postgres from "postgres";\n');
  const result = await checkBoundaries(root);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_DATABASE_DRIVER"),
  );
});

test("boundaries allow selected provider SDKs only in packages/adapters", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "packages", "adapters"), { recursive: true });
  await mkdir(join(root, "packages", "core"), { recursive: true });
  await writeFile(
    join(root, "packages", "adapters", "package.json"),
    JSON.stringify({ name: "@test/adapters" }),
  );
  await writeFile(
    join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@test/core" }),
  );
  await writeFile(
    join(root, "packages", "adapters", "providers.ts"),
    'import "better-auth"; import "graphile-worker"; import "ai"; import "@ai-sdk/openai"; import "@aws-sdk/client-s3";\n',
  );
  await writeFile(
    join(root, "packages", "core", "providers.ts"),
    'import "better-auth"; import "graphile-worker"; import "ai"; import "@ai-sdk/openai"; import "@aws-sdk/client-s3";\n',
  );
  const result = await checkBoundaries(root);
  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "BOUNDARY_PROVIDER_SDK").length,
    5,
  );
});

test("boundaries allow only the Better Auth browser client in packages/api-client", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "packages", "api-client"), { recursive: true });
  await writeFile(
    join(root, "packages", "api-client", "package.json"),
    JSON.stringify({ name: "@test/api-client" }),
  );
  await writeFile(
    join(root, "packages", "api-client", "client.ts"),
    'import { createAuthClient } from "better-auth/client";\n',
  );
  const allowed = await checkBoundaries(root);
  assert.equal(allowed.ok, true);

  await writeFile(
    join(root, "packages", "api-client", "server.ts"),
    'import { betterAuth } from "better-auth";\n',
  );
  const rejected = await checkBoundaries(root);
  assert.ok(rejected.diagnostics.some((diagnostic) => diagnostic.code === "BOUNDARY_PROVIDER_SDK"));
});

test("provider matching does not classify unrelated names such as airtable", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "packages", "core"), { recursive: true });
  await writeFile(
    join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@test/core" }),
  );
  await writeFile(join(root, "packages", "core", "unrelated.ts"), 'import "airtable";\n');
  const result = await checkBoundaries(root);
  assert.equal(result.ok, true);
});

test("core tests may import their own package source", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "packages", "core", "src"), { recursive: true });
  await mkdir(join(root, "packages", "core", "tests"), { recursive: true });
  await writeFile(
    join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@test/core" }),
  );
  await writeFile(join(root, "packages", "core", "src", "index.ts"), "export const value = 1;\n");
  await writeFile(
    join(root, "packages", "core", "tests", "core.test.ts"),
    'import { value } from "../src/index.js";\nvoid value;\n',
  );
  const result = await checkBoundaries(root);
  assert.equal(result.ok, true);
});

test("implementation sync is deterministic and check mode does not mutate", async () => {
  const root = await temporaryRoot();
  await createWorkItem(root, { workId: "B-002", title: "Second", owner: "team" });
  await createWorkItem(root, {
    workId: "A-001",
    title: "First",
    owner: "team",
    status: "in_progress",
    affectedPaths: ["packages/core"],
  });
  const first = await syncImplementation(root);
  const second = await syncImplementation(root);
  assert.equal(first, second);
  await writeFile(join(root, "IMPLEMENTATION.md"), `${first}stale\n`);
  const before = await readFile(join(root, "IMPLEMENTATION.md"), "utf8");
  const result = await checkImplementation(root);
  const after = await readFile(join(root, "IMPLEMENTATION.md"), "utf8");
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "IMPLEMENTATION_STALE"));
  assert.equal(after, before);
});

test("work frontmatter decodes JSON-quoted titles and owners", () => {
  const work = parseWorkItem(
    `---\nworkId: A-001\ntitle: "Initialize Acme \\"quoted\\" 产品"\nstatus: planned\nowner: "Engineering \\"platform\\""\nsourceOfTruthIds: []\naffectedPaths:\n  - packages/core\n---\n\n# Work\n`,
    ".thaarei/work/A-001.md",
  );
  assert.equal(work.title, 'Initialize Acme "quoted" 产品');
  assert.equal(work.owner, 'Engineering "platform"');
});

test("implementation checks required sections, false completion, and overlapping active paths", async () => {
  const root = await temporaryRoot();
  await createWorkItem(root, {
    workId: "A-001",
    title: "First",
    owner: "team",
    status: "in_progress",
    affectedPaths: ["packages/core"],
  });
  await createWorkItem(root, {
    workId: "B-002",
    title: "Second",
    owner: "team",
    status: "blocked",
    affectedPaths: ["packages/core"],
  });
  await createWorkItem(root, {
    workId: "C-003",
    title: "Third",
    owner: "team",
    status: "complete",
  });
  await syncImplementation(root);
  const result = await checkImplementation(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "IMPLEMENTATION_OVERLAPPING_PATH"),
  );
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "IMPLEMENTATION_FALSE_COMPLETION"),
  );
});

test("implementation detects parent-child path overlap in either claim order", async () => {
  for (const [first, second] of [
    ["packages/core", "packages/core/src/index.ts"],
    ["packages/core/src/index.ts", "packages/core"],
    ["docs/", "docs/file.md"],
    ["docs/file.md", "docs/"],
  ] as const) {
    const root = await temporaryRoot();
    await createWorkItem(root, {
      workId: "A-001",
      title: "First",
      owner: "team",
      status: "in_progress",
      affectedPaths: [first],
    });
    await createWorkItem(root, {
      workId: "B-002",
      title: "Second",
      owner: "team",
      status: "in_progress",
      affectedPaths: [second],
    });
    await syncImplementation(root);
    const result = await checkImplementation(root);
    assert.equal(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "IMPLEMENTATION_OVERLAPPING_PATH",
      ),
      true,
    );
  }
});

test("implementation rejects unsafe affected paths", async () => {
  for (const unsafe of [
    "",
    "/etc/passwd",
    "../outside",
    "packages/../../outside",
    "packages\\core",
    ".",
    "./",
  ]) {
    const root = await temporaryRoot();
    await createWorkItem(root, {
      workId: "A-001",
      title: "Unsafe",
      owner: "team",
      status: "in_progress",
      affectedPaths: [unsafe],
    });
    await syncImplementation(root);
    const result = await checkImplementation(root);
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.code === "IMPLEMENTATION_UNSAFE_PATH"),
      true,
    );
  }
});

test("implementation accepts a completed item with validation and evidence", async () => {
  const root = await temporaryRoot();
  const path = await createWorkItem(root, {
    workId: "A-001",
    title: "Complete work",
    owner: "team",
    status: "complete",
  });
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source
      .replace("Record commands and their results here.", "`pnpm check` passed.")
      .replace("Record artifact or runtime evidence here.", "Fixture output was inspected.")
      .replace("Incomplete.", "Completed and verified."),
  );
  await syncImplementation(root);
  const result = await checkImplementation(root);
  assert.equal(result.ok, true);
});
