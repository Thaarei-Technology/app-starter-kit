import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
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
  readonly providers?: readonly string[];
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
    profiles: "web,api,data,identity,tenancy,jobs,events,ai,durable-ai,external-api,storage,python",
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
  {
    name: "platform-capabilities",
    profiles:
      "api,data,identity,tenancy,jobs,events,ai,external-api,payments,notifications,cache,rate-limit,search,observability,feature-flags",
    deployment: "railway",
    mobile: false,
  },
  {
    name: "rag-capability",
    profiles: "api,data,identity,jobs,events,ai,storage,python,search,rag",
    deployment: "railway",
    mobile: false,
    providers: ["--ai-providers", "openai"],
  },
  {
    name: "full-profile-capabilities",
    profiles:
      "web,mobile,api,data,identity,tenancy,jobs,events,ai,agentic-ai,external-api,storage,python,payments,notifications,cache,rate-limit,search,rag,observability,feature-flags",
    deployment: "railway",
    mobile: true,
    providers: [
      "--payment-providers",
      "stripe,razorpay",
      "--ai-providers",
      "openai,anthropic",
      "--email-provider",
      "resend",
      "--cache-provider",
      "valkey",
      "--observability-exporters",
      "otlp,sentry",
    ],
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
    ...(fixture.providers ?? []),
  ];
}

async function runPnpm(root: string, arguments_: readonly string[]): Promise<void> {
  await execFileAsync("pnpm", arguments_, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
}

interface ManagedProcess {
  readonly handle: ChildProcess;
  readonly name: string;
  readonly logPath: string;
  readonly output: string[];
}

async function waitForHttp(
  url: string,
  expectedStatus = 200,
  processes: readonly ManagedProcess[] = [],
  expectedInstanceId?: string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    const exited = processes.find((process) => process.handle.exitCode !== null);
    if (exited) {
      throw new Error(
        `${exited.name} exited before ${url} became ready (exit ${exited.handle.exitCode})`,
      );
    }
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.status === expectedStatus) {
        if (expectedInstanceId !== undefined && !body.includes(expectedInstanceId)) {
          lastError = `HTTP ${response.status} did not contain fixture instance ${expectedInstanceId}`;
        } else {
          return;
        }
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function allocatePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to allocate a TCP port");
  const port = address.port;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return port;
}

async function allocatePorts(names: readonly string[]): Promise<Readonly<Record<string, number>>> {
  const ports: Record<string, number> = {};
  for (const name of names) ports[name] = await allocatePort();
  return ports;
}

async function configureFixtureEnvironment(
  root: string,
  ports: Readonly<Record<string, number>>,
): Promise<Record<string, string>> {
  const path = join(root, ".env");
  const original = await readFile(join(root, ".env.example"), "utf8");
  const values: Record<string, string> = {};
  for (const line of original.split("\n")) {
    const match = /^(\w+)=(.*)$/.exec(line);
    if (match?.[1]) values[match[1]] = match[2] ?? "";
  }
  const replacements: Readonly<Record<string, string>> = {
    PORT: String(ports.api ?? ports.web),
    WORKER_PORT: String(ports.worker ?? 0),
    API_INTERNAL_URL: `http://127.0.0.1:${ports.api ?? 0}`,
    BETTER_AUTH_URL: `http://127.0.0.1:${ports.web ?? ports.api ?? 0}`,
    PYTHON_SERVICE_URL: `http://127.0.0.1:${ports.python ?? 0}`,
    STORAGE_ENDPOINT: `http://127.0.0.1:${ports.storage ?? 0}`,
    MAILPIT_URL: `http://127.0.0.1:${ports.mailpitUi ?? 0}`,
    VALKEY_URL: `redis://127.0.0.1:${ports.valkey ?? 0}`,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${ports.otelHttp ?? 0}`,
    POSTGRES_PORT: String(ports.postgres ?? 0),
    STORAGE_PORT: String(ports.storage ?? 0),
    STORAGE_CONSOLE_PORT: String(ports.storageConsole ?? 0),
    VALKEY_PORT: String(ports.valkey ?? 0),
    MAILPIT_SMTP_PORT: String(ports.mailpitSmtp ?? 0),
    MAILPIT_UI_PORT: String(ports.mailpitUi ?? 0),
    OTEL_HEALTH_PORT: String(ports.otelHealth ?? 0),
    OTEL_HTTP_PORT: String(ports.otelHttp ?? 0),
    STARTER_FIXTURE_ID: `fixture-${ports.api ?? ports.web}`,
    COMPOSE_PROJECT_NAME: `thaarei-fixture-${ports.api ?? ports.web}`,
  };
  for (const [name, value] of Object.entries(replacements)) {
    values[name] = value;
  }
  if (values.DATABASE_URL && ports.postgres) {
    values.DATABASE_URL = values.DATABASE_URL.replace(
      /127\.0\.0\.1:\d+/u,
      `127.0.0.1:${ports.postgres}`,
    );
  }
  const known = new Set(Object.keys(values));
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  for (const [name, value] of Object.entries(replacements)) {
    if (!known.has(name)) lines.push(`${name}=${value}`);
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return values;
}

function startProcess(
  root: string,
  name: string,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
): ManagedProcess {
  const logPath = join(root, `.fixture-${name}.log`);
  const output: string[] = [];
  const handle = spawn("pnpm", arguments_, {
    cwd: root,
    detached: true,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk: Buffer): void => {
    const text = chunk.toString();
    output.push(text);
    if (output.length > 40) output.shift();
    void appendFile(logPath, text);
  };
  handle.stdout?.on("data", capture);
  handle.stderr?.on("data", capture);
  return { handle, name, logPath, output };
}

async function stopProcess(processHandle: ManagedProcess): Promise<void> {
  const handle = processHandle.handle;
  if (handle.pid === undefined) return;
  try {
    process.kill(-handle.pid, "SIGTERM");
  } catch {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 2_000);
    handle.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function proveAllServerRuntime(root: string): Promise<void> {
  const ports = await allocatePorts([
    "api",
    "web",
    "worker",
    "python",
    "postgres",
    "storage",
    "storageConsole",
    "valkey",
    "mailpitUi",
    "otelHealth",
    "otelHttp",
  ]);
  const environment = await configureFixtureEnvironment(root, ports);
  await runPnpm(root, ["db:up"]);
  await runPnpm(root, ["storage:up"]);
  await execFileAsync("docker", ["compose", "up", "-d"], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
  });
  await runPnpm(root, ["db:migrate"]);
  await runPnpm(root, ["build"]);
  const processes = [
    startProcess(root, "python", ["dev:python"], { ...environment, PORT: String(ports.python) }),
    startProcess(root, "api", ["--filter", "@fixture/api-app", "start"], {
      ...environment,
      PORT: String(ports.api),
    }),
    startProcess(root, "worker", ["--filter", "@fixture/worker-app", "start"], {
      ...environment,
      PORT: String(ports.api),
      WORKER_PORT: String(ports.worker),
    }),
    startProcess(root, "web", ["--filter", "@fixture/web-app", "start"], {
      ...environment,
      PORT: String(ports.web),
    }),
  ];
  let cleanupError: Error | null = null;
  try {
    const fixtureInstanceId = environment.STARTER_FIXTURE_ID;
    await waitForHttp(
      `http://127.0.0.1:${ports.python}/health/ready`,
      200,
      processes,
      fixtureInstanceId,
    );
    await waitForHttp(
      `http://127.0.0.1:${ports.api}/health/live`,
      200,
      processes,
      fixtureInstanceId,
    );
    await waitForHttp(
      `http://127.0.0.1:${ports.api}/health/ready`,
      200,
      processes,
      fixtureInstanceId,
    );
    await waitForHttp(
      `http://127.0.0.1:${ports.worker}/health/ready`,
      200,
      processes,
      fixtureInstanceId,
    );
    await waitForHttp(`http://127.0.0.1:${ports.web}/`, 200, processes);
    await waitForHttp(`http://127.0.0.1:${ports.storage}/minio/health/live`, 200, processes);
  } finally {
    await Promise.all(processes.map(stopProcess));
    try {
      await execFileAsync("docker", ["compose", "down", "-v"], {
        cwd: root,
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      cleanupError = new Error(`Fixture cleanup failed: ${detail}`);
    }
  }
  if (cleanupError) throw cleanupError;
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
  const path = join(root, "release-manifest.json");
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
  const path = join(root, "release-manifest.json");
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
        readFile(join(sourceRoot, "templates", "AGENTS.md"), "utf8").then((source) =>
          source.replaceAll("{{PRODUCT_NAMESPACE}}", `.fixture-${fixture.name}`),
        ),
      ]);
      if (installedAgents !== expectedAgents)
        throw new Error(`${fixture.name} did not receive the canonical AGENTS.md template`);
      const developerGuide = await readFile(join(root, "docs", "developer-guide.md"), "utf8");
      for (const profile of fixture.profiles.split(",")) {
        if (!developerGuide.includes(`\`${profile}\``))
          throw new Error(`${fixture.name} developer guide omitted selected profile ${profile}`);
      }
      if (fixture.name === "full-profile-capabilities") {
        const manifest = JSON.parse(
          await readFile(join(root, `.fixture-${fixture.name}`, "capabilities.json"), "utf8"),
        ) as {
          readonly profiles: readonly string[];
          readonly providers: {
            readonly paymentProviders: readonly string[];
            readonly aiProviders: readonly string[];
            readonly emailProvider: string | null;
            readonly cacheProvider: string | null;
            readonly observabilityExporters: readonly string[];
          };
        };
        const expectedProfiles = fixture.profiles.split(",").sort();
        if (JSON.stringify([...manifest.profiles].sort()) !== JSON.stringify(expectedProfiles)) {
          throw new Error("full-profile-capabilities manifest profile closure drifted");
        }
        if (
          JSON.stringify(manifest.providers) !==
          JSON.stringify({
            paymentProviders: ["stripe", "razorpay"],
            aiProviders: ["openai", "anthropic"],
            emailProvider: "resend",
            cacheProvider: "valkey",
            observabilityExporters: ["otlp", "sentry"],
          })
        ) {
          throw new Error("full-profile-capabilities provider selection drifted");
        }
      }
      if (fixture.name === "web-only") {
        for (const unselected of ["api", "data", "identity", "mobile"]) {
          if (developerGuide.includes(`\`${unselected}\``))
            throw new Error(`web-only developer guide listed unselected profile ${unselected}`);
        }
        const marker = JSON.parse(
          await readFile(join(root, `.fixture-${fixture.name}`, "project.json"), "utf8"),
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
