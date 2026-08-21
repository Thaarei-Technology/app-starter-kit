import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runInitializer } from "./index.js";

const execFileAsync = promisify(execFile);
const sourceRoot = resolve(import.meta.dirname, "../../..");

interface Fixture {
  readonly name: string;
  readonly profiles: string;
  readonly deployment: "dokploy" | "railway";
  readonly mobile: boolean;
}

const FIXTURES: readonly Fixture[] = [
  { name: "web-only", profiles: "web", deployment: "dokploy", mobile: false },
  { name: "internal-tool", profiles: "web,api,data", deployment: "dokploy", mobile: false },
  {
    name: "web-developer-handoff",
    profiles: "web,api,data,identity",
    deployment: "dokploy",
    mobile: false,
  },
  {
    name: "web-mobile-product",
    profiles: "web,mobile,api,data,identity",
    deployment: "dokploy",
    mobile: true,
  },
  {
    name: "durable-agentic-workflow",
    profiles: "api,data,identity,ai,jobs,durable-ai",
    deployment: "dokploy",
    mobile: false,
  },
  {
    name: "all-server-capabilities",
    profiles: "web,api,data,identity,jobs,ai,durable-ai,external-api,storage,python",
    deployment: "railway",
    mobile: false,
  },
  {
    name: "external-rest-integration",
    profiles: "api,data,external-api",
    deployment: "railway",
    mobile: false,
  },
  {
    name: "optional-python-service",
    profiles: "api,python",
    deployment: "railway",
    mobile: false,
  },
  {
    name: "storage-service",
    profiles: "api,data,identity,storage",
    deployment: "dokploy",
    mobile: false,
  },
];

function initializerArguments(fixture: Fixture, output: string): readonly string[] {
  return [
    "--product-id",
    `fixture-${fixture.name}`,
    "--client-id",
    fixture.name,
    "--display-name",
    fixture.name === "web-only" ? `web-only "<: 产品 fixture` : `${fixture.name} fixture`,
    "--package-scope",
    "@fixture",
    "--profiles",
    fixture.profiles,
    "--deployment",
    fixture.deployment,
    "--technical-owner",
    "Fixture Engineering",
    "--operations-owner",
    "Fixture Operations",
    "--output",
    output,
    ...(fixture.mobile
      ? [
          "--mobile-scheme",
          "fixture",
          "--ios-bundle-id",
          "com.thaarei.fixture",
          "--android-application-id",
          "com.thaarei.fixture",
        ]
      : []),
  ];
}

async function runPnpm(root: string, arguments_: readonly string[]): Promise<void> {
  await execFileAsync("pnpm", arguments_, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
}

async function waitForHttp(url: string, expectedStatus = 200): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus) return;
      lastError = `HTTP ${response.status}`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function startProcess(root: string, arguments_: readonly string[]): ChildProcess {
  return spawn("pnpm", arguments_, {
    cwd: root,
    detached: true,
    env: { ...process.env },
    stdio: "ignore",
  });
}

async function stopProcess(processHandle: ChildProcess): Promise<void> {
  if (processHandle.pid === undefined) return;
  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 2_000);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function proveAllServerRuntime(root: string): Promise<void> {
  await copyFile(join(root, ".env.example"), join(root, ".env"));
  await runPnpm(root, ["db:up"]);
  await runPnpm(root, ["storage:up"]);
  await runPnpm(root, ["db:migrate"]);
  const processes = [
    startProcess(root, ["dev:python"]),
    startProcess(root, ["dev:api"]),
    startProcess(root, ["dev:worker"]),
    startProcess(root, ["dev:web"]),
  ];
  try {
    await waitForHttp("http://127.0.0.1:8000/health/ready");
    await waitForHttp("http://127.0.0.1:3001/health/live");
    await waitForHttp("http://127.0.0.1:3001/health/ready");
    await waitForHttp("http://127.0.0.1:3002/health/ready");
    await waitForHttp("http://127.0.0.1:3000/");
    await waitForHttp("http://127.0.0.1:9000/minio/health/live");
  } finally {
    await Promise.all(processes.map(stopProcess));
    await execFileAsync("docker", ["compose", "down", "-v"], {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    });
  }
}

async function validateGeneratedProject(root: string, mobile: boolean): Promise<void> {
  if (!mobile) {
    await runPnpm(root, ["check"]);
    return;
  }
  // Native export requires a platform-specific Hermes toolchain; keep the
  // mobile fixture covered by every platform-neutral gate in this Linux pass.
  for (const command of [
    "format:check",
    "lint",
    "release:check",
    "check:source-of-truth",
    "check:boundaries",
    "check:implementation",
    "check:migrations",
    "typecheck",
  ]) {
    await runPnpm(root, [command]);
  }
  await runPnpm(root, ["exec", "turbo", "run", "build", "--filter=!@fixture/mobile-app"]);
  await runPnpm(root, ["test"]);
}

async function proveGeneratedReleaseDrift(root: string): Promise<void> {
  const path = join(root, "starter-release.json");
  const original = await readFile(path, "utf8");
  const parsed = JSON.parse(original) as {
    testedPackages: Record<string, string>;
  };
  const packageName = Object.keys(parsed.testedPackages)[0];
  if (!packageName) throw new Error("Generated release has no tested package pins");
  parsed.testedPackages[packageName] = "0.0.0";
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  try {
    await runPnpm(root, ["release:check"]);
    throw new Error("Generated release checker accepted a drifted dependency pin");
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("accepted a drifted")) throw error;
  } finally {
    await writeFile(path, original, "utf8");
  }
}

async function proveGeneratedReleaseContract(root: string): Promise<void> {
  const path = join(root, "starter-release.json");
  const original = await readFile(path, "utf8");
  const mutations: readonly [string, (release: Record<string, unknown>) => void][] = [
    [
      "unknown release property",
      (release) => {
        release.unexpected = true;
      },
    ],
    [
      "invalid image digest",
      (release) => {
        const images = release.containerImages as Record<string, Record<string, unknown>>;
        const nodeImage = images.node;
        if (!nodeImage) throw new Error("Generated release has no node image");
        nodeImage.digest = "sha256:not-a-digest";
      },
    ],
    [
      "empty compatibility evidence",
      (release) => {
        const evidence = release.compatibilityEvidence as Array<Record<string, unknown>>;
        const firstEvidence = evidence[0];
        if (!firstEvidence) throw new Error("Generated release has no compatibility evidence");
        firstEvidence.evidence = "";
      },
    ],
    [
      "invalid superseded datetime",
      (release) => {
        release.status = "superseded";
        release.releasedAt = "not-a-date";
      },
    ],
    [
      "blocked release promotion",
      (release) => {
        release.status = "released";
        release.releasedAt = "2026-08-19T00:00:00.000Z";
      },
    ],
  ];
  for (const [label, mutate] of mutations) {
    const release = JSON.parse(original) as Record<string, unknown>;
    mutate(release);
    await writeFile(path, `${JSON.stringify(release, null, 2)}\n`, "utf8");
    try {
      await runPnpm(root, ["release:check"]);
      throw new Error(`Generated release checker accepted ${label}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("accepted")) throw error;
    } finally {
      await writeFile(path, original, "utf8");
    }
  }
}

export async function validateFixtures(): Promise<void> {
  for (const fixture of FIXTURES) {
    const root = await mkdtemp(join(tmpdir(), `thaarei-${fixture.name}-`));
    try {
      process.stdout.write(`Generating ${fixture.name} at ${root}\n`);
      await runInitializer(initializerArguments(fixture, root));
      const [installedAgents, expectedAgents] = await Promise.all([
        readFile(join(root, "AGENTS.md"), "utf8"),
        readFile(join(sourceRoot, "templates", "AGENTS.md"), "utf8"),
      ]);
      if (installedAgents !== expectedAgents)
        throw new Error(`${fixture.name} did not receive the canonical AGENTS.md template`);
      const developerGuide = await readFile(join(root, "docs", "developer-guide.md"), "utf8");
      for (const profile of fixture.profiles.split(",")) {
        if (!developerGuide.includes(`\`${profile}\``))
          throw new Error(`${fixture.name} developer guide omitted selected profile ${profile}`);
      }
      if (fixture.name === "web-only") {
        for (const unselected of ["api", "data", "identity", "mobile"]) {
          if (developerGuide.includes(`\`${unselected}\``))
            throw new Error(`web-only developer guide listed unselected profile ${unselected}`);
        }
        const marker = JSON.parse(
          await readFile(join(root, ".thaarei", "starter-init.json"), "utf8"),
        ) as { readonly generatedFiles: readonly string[] };
        for (const forbidden of ["compose.yaml", "packages/database/src/migrate.ts"]) {
          if (marker.generatedFiles.includes(forbidden))
            throw new Error(`web-only fixture received forbidden artifact ${forbidden}`);
        }
      }
      await runPnpm(root, ["install", "--frozen-lockfile", "--ignore-scripts"]);
      if (fixture.name === "web-only") {
        await proveGeneratedReleaseDrift(root);
        await proveGeneratedReleaseContract(root);
      }
      await runPnpm(root, [
        "audit",
        "--prod",
        "--audit-level",
        "high",
        ...(fixture.mobile
          ? ["--ignore", "GHSA-w3rx-r6r6-pgpr", "--ignore", "GHSA-5p2g-fcmc-qvqq"]
          : []),
      ]);
      if (fixture.mobile) {
        await runPnpm(root, [
          "--filter",
          "@fixture/mobile-app",
          "exec",
          "expo",
          "install",
          "--check",
        ]);
      }
      await validateGeneratedProject(root, fixture.mobile);
      if (fixture.name === "all-server-capabilities") await proveAllServerRuntime(root);
      process.stdout.write(`Validated ${fixture.name}\n`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

await validateFixtures();
