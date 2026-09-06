import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runInitializer } from "./index.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 48 * 1024;
const COMMAND_BUFFER = 8 * 1024 * 1024;
const DB_WAIT_MS = 90_000;
const APP_WAIT_MS = 90_000;
const sourceRoot = resolve(import.meta.dirname, "../../..");

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface ChildHandle {
  readonly child: ChildProcess;
  readonly output: () => string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bounded(value: string): string {
  const cleaned = value.replace(/(postgres(?:ql)?:\/\/[^\s/]+):[^\s@]+@/gi, "$1:<redacted>@");
  if (cleaned.length <= MAX_OUTPUT) return cleaned;
  return `${cleaned.slice(0, MAX_OUTPUT)}…`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unknown failure";
}

function errorOutput(error: unknown): string {
  if (!isRecord(error)) return "";
  const stdout = stringValue(error.stdout) ?? "";
  const stderr = stringValue(error.stderr) ?? "";
  return [stdout, stderr].filter((value) => value.length > 0).join("\n");
}

async function command(
  file: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: COMMAND_BUFFER,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const output = errorOutput(error);
    const context = output.length > 0 ? `\n${bounded(output)}` : "";
    throw new Error(`${file} ${args.join(" ")} failed: ${errorMessage(error)}${context}`);
  }
}

async function pnpm(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return command("pnpm", args, { cwd: root, env });
}

function startCommand(
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): ChildHandle {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  const append = (chunk: Buffer | string): void => {
    output = bounded(`${output}${chunk.toString()}`);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", append);
  return { child, output: () => output };
}

async function stopCommand(handle: ChildHandle): Promise<void> {
  const { child } = handle;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit").then(() => undefined),
    new Promise<void>((resolvePromise) => {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        resolvePromise();
      }, 3_000);
    }),
  ]);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local port");
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  return address.port;
}

async function jsonBody(response: Response): Promise<unknown> {
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch (error: unknown) {
    throw new Error(
      `Expected JSON from ${response.url}, received ${bounded(body)} (${errorMessage(error)})`,
    );
  }
}

function hasSubject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const result = isRecord(value.result) ? value.result : null;
  const data = result && isRecord(result.data) ? result.data : null;
  const json = data && isRecord(data.json) ? data.json : data;
  return Boolean(json && typeof json.subjectId === "string" && json.subjectId.length > 0);
}

function hasHealth(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const result = isRecord(value.result) ? value.result : null;
  const data = result && isRecord(result.data) ? result.data : null;
  const json = data && isRecord(data.json) ? data.json : data;
  return Boolean(json && json.status === "ok" && typeof json.checkedAt === "string");
}

function cookieHeader(response: Response): string {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0)
    throw new Error("Better Auth authentication did not establish a session cookie");
  const cookies = setCookies
    .map((value) => value.split(";", 1)[0])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (cookies.length === 0)
    throw new Error("Better Auth authentication returned an empty session cookie");
  return cookies.join("; ");
}

async function waitForMailLink(
  mailpitUrl: string,
  subjectFragment: string,
  pathFragment: string,
): Promise<string> {
  const deadline = Date.now() + APP_WAIT_MS;
  let lastFailure = "no matching message";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${mailpitUrl}/api/v1/messages`);
      const listing = (await jsonBody(response)) as JsonRecord;
      const messages = Array.isArray(listing.messages)
        ? listing.messages
        : Array.isArray(listing.Messages)
          ? listing.Messages
          : [];
      for (const candidate of messages) {
        if (!isRecord(candidate)) continue;
        const subject = String(candidate.Subject ?? candidate.subject ?? "");
        if (!subject.includes(subjectFragment)) continue;
        const id = candidate.ID ?? candidate.Id ?? candidate.id;
        if (typeof id !== "string" && typeof id !== "number") continue;
        const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${String(id)}`);
        const detail = JSON.stringify(await jsonBody(detailResponse));
        const links = detail.match(/https?:\/\/[^"\s<>]+/gu) ?? [];
        const link = links
          .map((value) => value.replace(/\\+$/u, "").replaceAll("&amp;", "&"))
          .find((value) => value.includes(pathFragment));
        if (link) return link;
        lastFailure = `message ${String(id)} contained no ${pathFragment} link`;
      }
    } catch (error: unknown) {
      lastFailure = errorMessage(error);
    }
    await delay(250);
  }
  throw new Error(`Mailpit did not receive ${subjectFragment}: ${lastFailure}`);
}

async function waitForUrl(
  url: string,
  expectedStatus: number,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus) return response;
      lastFailure = `status ${response.status}: ${bounded(await response.text())}`;
    } catch (error: unknown) {
      lastFailure = errorMessage(error);
    }
    await delay(500);
  }
  throw new Error(`${label} did not become ready: ${lastFailure}`);
}

async function composeFile(root: string): Promise<string> {
  const candidates = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"];
  for (const candidate of candidates) {
    const path = join(root, candidate);
    try {
      await stat(path);
      return path;
    } catch {
      // Try the next generated Compose filename.
    }
  }
  throw new Error("Generated data fixture did not contain a Compose configuration");
}

function composeArgs(file: string, project: string, args: readonly string[]): readonly string[] {
  return ["compose", "--project-name", project, "--file", file, ...args];
}

async function compose(
  file: string,
  project: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return command("docker", composeArgs(file, project, args), { cwd: dirname(file), env });
}

async function composeNames(
  file: string,
  project: string,
  kind: "services" | "volumes",
  env: NodeJS.ProcessEnv,
): Promise<readonly string[]> {
  const result = await compose(file, project, ["config", `--${kind}`], env);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function waitForPostgres(
  file: string,
  project: string,
  service: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const deadline = Date.now() + DB_WAIT_MS;
  let lastFailure = "no readiness result";
  while (Date.now() < deadline) {
    try {
      await compose(file, project, ["exec", "-T", service, "pg_isready"], env);
      return;
    } catch (error: unknown) {
      lastFailure = errorMessage(error);
    }
    await delay(750);
  }
  throw new Error(`PostgreSQL did not become ready: ${lastFailure}`);
}

async function assertCount(
  file: string,
  project: string,
  service: string,
  sql: string,
  label: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const result = await compose(
    file,
    project,
    ["exec", "-T", service, "psql", "-U", "starter_admin", "-d", "starter", "-tAc", sql],
    env,
  );
  const count = Number(result.stdout.trim());
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`${label} database row count was not positive`);
}

async function packageExists(root: string, packageName: string): Promise<boolean> {
  const packageDirectories = ["packages", "apps"];
  for (const directory of packageDirectories) {
    const parent = join(root, directory);
    let entries: string[];
    try {
      entries = await readdir(parent);
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        const parsed: unknown = JSON.parse(
          await readFile(join(parent, entry, "package.json"), "utf8"),
        );
        const manifest = parsed;
        if (isRecord(manifest) && manifest.name === packageName) return true;
      } catch {
        // A non-package directory is not a match.
      }
    }
  }
  return false;
}

async function validatePackage(
  root: string,
  packageName: string,
  script: "typecheck" | "build",
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (!(await packageExists(root, packageName)))
    throw new Error(`Generated fixture is missing expected package ${packageName}`);
  await pnpm(root, ["--filter", packageName, script], env);
}

function fixtureArguments(output: string): readonly string[] {
  return [
    "--product-id",
    "fixture-web-handoff",
    "--client-id",
    "web-handoff",
    "--display-name",
    "Web handoff fixture",
    "--package-scope",
    "@fixture",
    "--profiles",
    "web,api,data,identity",
    "--deployment",
    "dokploy",
    "--technical-owner",
    "Fixture Engineering",
    "--operations-owner",
    "Fixture Operations",
    "--output",
    output,
  ];
}

export async function validateWebHandoff(): Promise<void> {
  const POSTGRES_PORT = await availablePort();
  const API_PORT = await availablePort();
  const WEB_PORT = await availablePort();
  const CONTAINER_API_PORT = await availablePort();
  const CONTAINER_WEB_PORT = await availablePort();
  const MAILPIT_SMTP_PORT = await availablePort();
  const MAILPIT_UI_PORT = await availablePort();
  const fixtureParent = await mkdtemp(join(tmpdir(), "thaarei-web-handoff-"));
  const fixtureRoot = join(fixtureParent, "generated");
  const runId = `thaarei-web-handoff-${process.pid}-${Date.now()}`;
  const imageNames: readonly [string, string] = [`${runId}-api`, `${runId}-web`];
  const containerNames: readonly [string, string] = [`${runId}-api`, `${runId}-web`];
  const runningProcesses: ChildHandle[] = [];
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    COMPOSE_PROJECT_NAME: runId,
    APP_ENV: "local",
    POSTGRES_PORT: String(POSTGRES_PORT),
    POSTGRES_USER: "starter_admin",
    POSTGRES_PASSWORD: "starter_admin_local",
    POSTGRES_DB: "starter",
    DATABASE_URL: `postgresql://starter_runtime:starter_runtime_local@127.0.0.1:${POSTGRES_PORT}/starter`,
    MIGRATOR_DATABASE_URL: `postgresql://starter_migrator:starter_migrator_local@127.0.0.1:${POSTGRES_PORT}/starter`,
    BETTER_AUTH_SECRET: "local-web-handoff-secret-please-change",
    BETTER_AUTH_URL: `http://127.0.0.1:${WEB_PORT}`,
    API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
    PORT: String(API_PORT),
    NODE_ENV: "development",
    IDENTITY_MAIL_PROVIDER: "mailpit",
    IDENTITY_FROM_EMAIL: "identity@example.test",
    IDENTITY_MAILPIT_URL: `http://127.0.0.1:${MAILPIT_UI_PORT}`,
    MAILPIT_SMTP_PORT: String(MAILPIT_SMTP_PORT),
    MAILPIT_UI_PORT: String(MAILPIT_UI_PORT),
  };
  let composePath: string | null = null;
  let postgresService: string | null = null;
  let volumeNames: readonly string[] = [];

  try {
    process.stdout.write(`Generating web handoff fixture in ${fixtureRoot}\n`);
    process.env.THAAREI_LOCAL_PACKAGE_ROOT = sourceRoot;
    await pnpm(sourceRoot, ["packages:build"], process.env);
    await runInitializer(fixtureArguments(fixtureRoot));
    await writeFile(
      join(fixtureRoot, ".env"),
      `${[
        "APP_ENV=local",
        "NODE_ENV=development",
        `PORT=${API_PORT}`,
        `DATABASE_URL=${environment.DATABASE_URL}`,
        `MIGRATOR_DATABASE_URL=${environment.MIGRATOR_DATABASE_URL}`,
        `BETTER_AUTH_SECRET=${environment.BETTER_AUTH_SECRET}`,
        `BETTER_AUTH_URL=${environment.BETTER_AUTH_URL}`,
        `API_INTERNAL_URL=${environment.API_INTERNAL_URL}`,
        `IDENTITY_MAIL_PROVIDER=${environment.IDENTITY_MAIL_PROVIDER}`,
        `IDENTITY_FROM_EMAIL=${environment.IDENTITY_FROM_EMAIL}`,
        `IDENTITY_MAILPIT_URL=${environment.IDENTITY_MAILPIT_URL}`,
        `POSTGRES_PORT=${environment.POSTGRES_PORT}`,
        `POSTGRES_USER=${environment.POSTGRES_USER}`,
        `POSTGRES_PASSWORD=${environment.POSTGRES_PASSWORD}`,
        `POSTGRES_DB=${environment.POSTGRES_DB}`,
        `MAILPIT_SMTP_PORT=${environment.MAILPIT_SMTP_PORT}`,
        `MAILPIT_UI_PORT=${environment.MAILPIT_UI_PORT}`,
      ].join("\n")}\n`,
      "utf8",
    );
    await command("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: fixtureRoot,
      env: environment,
    });
    composePath = await composeFile(fixtureRoot);
    const services = await composeNames(composePath, runId, "services", environment);
    postgresService =
      services.find((service) => /postgres|database|db/i.test(service)) ?? services[0] ?? null;
    if (!postgresService) throw new Error("Generated Compose configuration declared no service");
    await pnpm(fixtureRoot, ["dev:deps"], environment);
    const logicalVolumeNames = await composeNames(composePath, runId, "volumes", environment);
    const resolvedVolumes: string[] = [];
    for (const logicalVolume of logicalVolumeNames) {
      const candidates = logicalVolume.startsWith(`${runId}_`)
        ? [logicalVolume]
        : [`${runId}_${logicalVolume}`, logicalVolume];
      for (const candidate of candidates) {
        try {
          await command("docker", ["volume", "inspect", candidate], { env: environment });
          resolvedVolumes.push(candidate);
          break;
        } catch {
          // Try the next Compose volume naming form.
        }
      }
    }
    volumeNames = resolvedVolumes;
    await waitForPostgres(composePath, runId, postgresService, environment);
    await waitForUrl(
      `${environment.IDENTITY_MAILPIT_URL}/api/v1/info`,
      200,
      APP_WAIT_MS,
      "Mailpit",
    );
    await pnpm(fixtureRoot, ["db:migrate"], environment);
    const secondMigration = await pnpm(fixtureRoot, ["db:migrate"], environment);
    const migrationOutput = `${secondMigration.stdout}\n${secondMigration.stderr}`;
    if (
      !/no pending|up to date|nothing to do|already applied|0 migrations|no migrations/i.test(
        migrationOutput,
      )
    ) {
      throw new Error(`Second db:migrate run did not report a no-op: ${bounded(migrationOutput)}`);
    }
    const migrationPath = join(
      fixtureRoot,
      "packages",
      "database",
      "migrations",
      "0000_starter.sql",
    );
    const migrationSource = await readFile(migrationPath, "utf8");
    try {
      await writeFile(migrationPath, `${migrationSource}\n-- changed checksum\n`, "utf8");
      try {
        await pnpm(fixtureRoot, ["db:migrate"], environment);
        throw new Error("db:migrate accepted a changed applied migration checksum");
      } catch (error: unknown) {
        if (!errorMessage(error).includes("Migration checksum changed")) throw error;
      }
    } finally {
      await writeFile(migrationPath, migrationSource, "utf8");
    }
    try {
      await rm(migrationPath);
      try {
        await pnpm(fixtureRoot, ["db:migrate"], environment);
        throw new Error("db:migrate accepted a deleted applied migration");
      } catch (error: unknown) {
        if (!errorMessage(error).includes("Applied migration file is missing")) throw error;
      }
    } finally {
      await writeFile(migrationPath, migrationSource, "utf8");
    }

    const packageNames = [
      "@fixture/core",
      "@fixture/contracts",
      "@fixture/database",
      "@fixture/adapters",
      "@fixture/api",
      "@fixture/api-client",
      "@fixture/api-app",
      "@fixture/web-app",
    ];
    for (const packageName of packageNames)
      await validatePackage(fixtureRoot, packageName, "typecheck", environment);
    for (const packageName of packageNames)
      await validatePackage(fixtureRoot, packageName, "build", {
        ...environment,
        NODE_ENV: "production",
      });
    const builtClient = await readFile(
      join(fixtureRoot, "packages", "api-client", "dist", "index.js"),
      "utf8",
    );
    if (builtClient.includes("@fixture/api"))
      throw new Error("Built API client retained a runtime import of the server package");

    const api = startCommand("pnpm", ["--filter", "@fixture/api-app", "start"], {
      cwd: fixtureRoot,
      env: { ...environment, NODE_ENV: "production" },
    });
    const web = startCommand("pnpm", ["--filter", "@fixture/web-app", "start"], {
      cwd: fixtureRoot,
      env: {
        ...environment,
        NODE_ENV: "production",
        PORT: String(WEB_PORT),
        API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
      },
    });
    runningProcesses.push(api, web);
    await waitForUrl(`http://127.0.0.1:${API_PORT}/health/ready`, 200, APP_WAIT_MS, "built API");
    await waitForUrl(`http://127.0.0.1:${WEB_PORT}/`, 200, APP_WAIT_MS, "built web");

    const clientProofPath = join(fixtureRoot, "tooling", "runtime-client-proof.mjs");
    await writeFile(
      clientProofPath,
      `import { createApiClient } from "../packages/api-client/dist/index.js";

const origin = process.env.WEB_ORIGIN;
if (!origin) throw new Error("WEB_ORIGIN is required");
const nativeFetch = globalThis.fetch;
let credentialsIncluded = false;
globalThis.fetch = (input, init) => {
  credentialsIncluded ||= init?.credentials === "include";
  const target = typeof input === "string" || input instanceof URL ? input : input.url;
  return nativeFetch(new URL(target, origin), init);
};
const health = await createApiClient().health.query();
if (health.status !== "ok") throw new Error("Generated API client health request failed");
if (!credentialsIncluded) throw new Error("Generated API client did not preserve credentials");
process.stdout.write("Generated API client runtime proof passed\\n");
`,
      "utf8",
    );
    await command("node", [clientProofPath], {
      cwd: fixtureRoot,
      env: { ...environment, WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}` },
    });

    const healthResponse = await fetch(
      `http://127.0.0.1:${WEB_PORT}/trpc/health?input=${encodeURIComponent("{}")}`,
    );
    if (healthResponse.status !== 200 || !hasHealth(await jsonBody(healthResponse)))
      throw new Error("Same-origin web proxy health request failed");
    for (const traversalPath of [
      "/trpc/%252e%252e/health/ready",
      "/trpc/%252e%252e/api/auth/get-session",
    ]) {
      const traversalResponse = await fetch(`http://127.0.0.1:${WEB_PORT}${traversalPath}`, {
        redirect: "manual",
      });
      if (traversalResponse.status === 200)
        throw new Error(`Proxy path traversal reached an upstream sibling: ${traversalPath}`);
    }
    const anonymousViewer = await fetch(
      `http://127.0.0.1:${WEB_PORT}/trpc/viewer?input=${encodeURIComponent("{}")}`,
    );
    if (anonymousViewer.status !== 401)
      throw new Error(`Anonymous viewer request returned ${anonymousViewer.status}, expected 401`);

    const email = `handoff-${process.pid}-${Date.now()}@example.test`;
    const signup = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${WEB_PORT}`,
      },
      body: JSON.stringify({ email, password: "local-web-handoff-password", name: "Web Handoff" }),
    });
    if (signup.status < 200 || signup.status >= 300)
      throw new Error(
        `Better Auth signup failed with status ${signup.status}: ${bounded(await signup.text())}`,
      );
    if (signup.headers.getSetCookie().length > 0)
      throw new Error("Unverified signup unexpectedly received an authenticated session");
    const verificationLink = await waitForMailLink(
      String(environment.IDENTITY_MAILPIT_URL),
      "Verify your email",
      "/api/auth/verify-email",
    );
    const verification = await fetch(verificationLink, { redirect: "manual" });
    if (verification.status < 200 || verification.status >= 400)
      throw new Error(
        `Email verification failed with status ${verification.status} for ${verificationLink}: ${bounded(await verification.text())}`,
      );
    const signIn = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${WEB_PORT}`,
      },
      body: JSON.stringify({ email, password: "local-web-handoff-password" }),
    });
    if (signIn.status < 200 || signIn.status >= 300)
      throw new Error(`Verified login failed with status ${signIn.status}`);
    const sessionCookie = cookieHeader(signIn);
    const authenticatedViewer = await fetch(
      `http://127.0.0.1:${WEB_PORT}/trpc/viewer?input=${encodeURIComponent("{}")}`,
      {
        headers: { cookie: sessionCookie },
      },
    );
    if (authenticatedViewer.status !== 200 || !hasSubject(await jsonBody(authenticatedViewer)))
      throw new Error("Authenticated viewer did not return an application subject");

    const recoveryEndpoint = `http://127.0.0.1:${WEB_PORT}/api/auth/request-password-reset`;
    const recoveryHeaders = {
      "content-type": "application/json",
      origin: `http://127.0.0.1:${WEB_PORT}`,
    };
    const knownRecovery = await fetch(recoveryEndpoint, {
      method: "POST",
      headers: recoveryHeaders,
      body: JSON.stringify({ email, redirectTo: `http://127.0.0.1:${WEB_PORT}/reset-password` }),
    });
    const unknownRecovery = await fetch(recoveryEndpoint, {
      method: "POST",
      headers: recoveryHeaders,
      body: JSON.stringify({
        email: `unknown-${email}`,
        redirectTo: `http://127.0.0.1:${WEB_PORT}/reset-password`,
      }),
    });
    if (knownRecovery.status !== unknownRecovery.status)
      throw new Error("Password recovery leaked account existence through status behavior");
    const resetLink = await waitForMailLink(
      String(environment.IDENTITY_MAILPIT_URL),
      "Reset your password",
      "/reset-password",
    );
    const resetUrl = new URL(resetLink);
    const resetPathToken = resetUrl.pathname.split("/").filter(Boolean).at(-1);
    const resetToken =
      resetUrl.searchParams.get("token") ??
      new URLSearchParams(resetUrl.hash.slice(1)).get("token") ??
      (resetPathToken && resetPathToken !== "reset-password" ? resetPathToken : null);
    if (!resetToken)
      throw new Error(`Password recovery link omitted its reset token: ${resetLink}`);
    const reset = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth/reset-password`, {
      method: "POST",
      headers: recoveryHeaders,
      body: JSON.stringify({ newPassword: "new-local-web-handoff-password", token: resetToken }),
    });
    if (reset.status < 200 || reset.status >= 300)
      throw new Error(
        `Password reset failed with status ${reset.status}: ${bounded(await reset.text())}`,
      );
    const revokedViewer = await fetch(
      `http://127.0.0.1:${WEB_PORT}/trpc/viewer?input=${encodeURIComponent("{}")}`,
      { headers: { cookie: sessionCookie } },
    );
    if (revokedViewer.status !== 401)
      throw new Error("Password reset did not revoke the existing authenticated session");
    const postResetLogin = await fetch(`http://127.0.0.1:${WEB_PORT}/api/auth/sign-in/email`, {
      method: "POST",
      headers: recoveryHeaders,
      body: JSON.stringify({ email, password: "new-local-web-handoff-password" }),
    });
    if (postResetLogin.status < 200 || postResetLogin.status >= 300)
      throw new Error("Ordinary login with the reset password failed");
    cookieHeader(postResetLogin);
    await assertCount(
      composePath,
      runId,
      postgresService,
      'SELECT COUNT(*) FROM "user"',
      "authentication user",
      environment,
    );
    await assertCount(
      composePath,
      runId,
      postgresService,
      'SELECT COUNT(*) FROM "session"',
      "authentication session",
      environment,
    );
    await assertCount(
      composePath,
      runId,
      postgresService,
      'SELECT COUNT(*) FROM "account"',
      "authentication account",
      environment,
    );
    await assertCount(
      composePath,
      runId,
      postgresService,
      "SELECT COUNT(*) FROM application_users",
      "application identity",
      environment,
    );

    for (const [imageName, dockerfile] of [
      [imageNames[0], "apps/api/Dockerfile"] as const,
      [imageNames[1], "apps/web/Dockerfile"] as const,
    ]) {
      await command("docker", ["build", "--file", dockerfile, "--tag", imageName, "."], {
        cwd: fixtureRoot,
        env: environment,
      });
      if (!imageName) throw new Error("Generated image name was empty");
      const containerName = imageName;
      const containerEnvironment = dockerfile.includes("api")
        ? [
            "--env",
            "NODE_ENV=production",
            "--env",
            `PORT=${CONTAINER_API_PORT}`,
            "--env",
            `DATABASE_URL=postgresql://starter_runtime:starter_runtime_local@${postgresService}:5432/starter`,
            "--env",
            "BETTER_AUTH_SECRET=local-web-handoff-secret-please-change",
            "--env",
            `BETTER_AUTH_URL=http://${containerNames[1]}:${CONTAINER_WEB_PORT}`,
            "--env",
            "IDENTITY_MAIL_PROVIDER=mailpit",
            "--env",
            "IDENTITY_FROM_EMAIL=identity@example.test",
            "--env",
            `IDENTITY_MAILPIT_URL=http://${runId}-mailpit:8025`,
          ]
        : [
            "--env",
            "NODE_ENV=production",
            "--env",
            `PORT=${CONTAINER_WEB_PORT}`,
            "--env",
            `API_INTERNAL_URL=http://${containerNames[0]}:${CONTAINER_API_PORT}`,
          ];
      await command(
        "docker",
        [
          "run",
          "--detach",
          "--name",
          containerName,
          "--network",
          `${runId}_default`,
          ...containerEnvironment,
          "--publish",
          `${dockerfile.includes("api") ? API_PORT + 3 : WEB_PORT + 3}:${dockerfile.includes("api") ? CONTAINER_API_PORT : CONTAINER_WEB_PORT}`,
          imageName,
        ],
        { env: environment },
      );
      await waitForUrl(
        `http://127.0.0.1:${dockerfile.includes("api") ? API_PORT + 3 : WEB_PORT + 3}/${dockerfile.includes("api") ? "health/ready" : ""}`,
        200,
        APP_WAIT_MS,
        `${dockerfile.includes("api") ? "API" : "web"} container`,
      );
    }
    for (const container of containerNames) {
      await command("docker", ["rm", "--force", container], { env: environment });
    }
    await pnpm(fixtureRoot, ["db:down"], environment);
    for (const volume of volumeNames) {
      const inspected = await command("docker", ["volume", "inspect", volume], {
        env: environment,
      });
      if (inspected.stdout.trim().length === 0)
        throw new Error(`db:down removed the named database volume ${volume}`);
    }
    process.stdout.write("Validated web developer handoff\n");
  } catch (error: unknown) {
    const processOutput = runningProcesses
      .map((handle) => handle.output())
      .filter((value) => value.length > 0)
      .join("\n");
    const detail = processOutput.length > 0 ? `\n${bounded(processOutput)}` : "";
    throw new Error(`Web handoff validation failed: ${errorMessage(error)}${detail}`);
  } finally {
    for (const handle of runningProcesses) await stopCommand(handle);
    for (const container of containerNames) {
      await command("docker", ["rm", "--force", container], { env: environment }).catch(
        () => undefined,
      );
    }
    for (const image of imageNames) {
      await command("docker", ["image", "rm", "--force", image], { env: environment }).catch(
        () => undefined,
      );
    }
    if (composePath) {
      await compose(
        composePath,
        runId,
        ["down", "--volumes", "--remove-orphans"],
        environment,
      ).catch(() => undefined);
    }
    for (const volume of volumeNames) {
      await command("docker", ["volume", "rm", "--force", volume], { env: environment }).catch(
        () => undefined,
      );
    }
    await rm(fixtureParent, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await validateWebHandoff().catch((error: unknown) => {
    process.stderr.write(`validate:web-handoff: ${bounded(errorMessage(error))}\n`);
    process.exitCode = 1;
  });
  process.exit(process.exitCode ?? 0);
}
