import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArguments, runInitializer, structuredInitializerFailure } from "./index.js";

const dryRunArguments = [
  "--product-id",
  "product",
  "--client-id",
  "client",
  "--display-name",
  "Fixture Client",
  "--package-scope",
  "@fixture",
  "--profiles",
  "web",
  "--deployment",
  "dokploy",
  "--technical-owner",
  "Engineering",
  "--operations-owner",
  "Operations",
  "--dry-run",
  "--json",
] as const;

describe("structured initializer output", () => {
  it("models --skip-git as a boolean and documents it", async () => {
    expect(parseArguments(["--skip-git"]).get("skip-git")).toBe("true");
    expect(await runInitializer(["--help"])).toContain("--skip-git");
  });

  it("returns a complete read-only path plan", async () => {
    const result = JSON.parse(await runInitializer(dryRunArguments)) as {
      ok: boolean;
      pathPlan: { files: string[] };
      validationErrors: unknown[];
    };
    expect(result.ok).toBe(true);
    expect(result.pathPlan.files).toContain("AGENTS.md");
    expect(result.pathPlan.files).toContain("pnpm-lock.yaml");
    expect(result.pathPlan.files).toContain("tooling/governance/src/cli.ts");
    expect(result.validationErrors).toEqual([]);
  });

  it("serializes validation errors when dry-run JSON mode fails", () => {
    const output = structuredInitializerFailure(
      ["--dry-run", "--json"],
      new Error("Unknown preset"),
    );
    expect(output).not.toBeNull();
    expect(JSON.parse(output ?? "null")).toMatchObject({
      ok: false,
      validationErrors: [{ message: "Unknown preset" }],
    });
  });

  it("leaves ordinary CLI errors in human-readable mode", () => {
    expect(structuredInitializerFailure(["--dry-run"], new Error("failure"))).toBeNull();
  });

  it("validates a complete generated project without creating Git metadata when requested", async () => {
    const scratchParent = resolve(import.meta.dirname, "../../../.thaarei/generated");
    await mkdir(scratchParent, { recursive: true });
    const root = await mkdtemp(join(scratchParent, "thaarei-skip-git-"));
    const outputDir = join(root, "generated");
    const previousPackageRoot = process.env.THAAREI_LOCAL_PACKAGE_ROOT;
    process.env.THAAREI_LOCAL_PACKAGE_ROOT = resolve(import.meta.dirname, "../../..");
    try {
      await runInitializer([
        "--product-id",
        "product",
        "--client-id",
        "client",
        "--display-name",
        "Fixture Client",
        "--package-scope",
        "@fixture",
        "--profiles",
        "web",
        "--deployment",
        "dokploy",
        "--technical-owner",
        "Engineering",
        "--operations-owner",
        "Operations",
        "--output-dir",
        outputDir,
        "--skip-git",
      ]);
      await expect(
        readFile(join(outputDir, ".thaarei", "project.json"), "utf8"),
      ).resolves.toContain('"generatedFiles"');
      await expect(stat(join(outputDir, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousPackageRoot === undefined) delete process.env.THAAREI_LOCAL_PACKAGE_ROOT;
      else process.env.THAAREI_LOCAL_PACKAGE_ROOT = previousPackageRoot;
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("uses a temporary trusted user config for private package installation", async () => {
    const scratchParent = resolve(import.meta.dirname, "../../../.thaarei/generated");
    await mkdir(scratchParent, { recursive: true });
    const root = await mkdtemp(join(scratchParent, "thaarei-registry-auth-"));
    const bin = join(root, "bin");
    const outputDir = join(root, "generated");
    const capturePath = join(root, "captured-user-config");
    const fakePnpm = join(bin, "pnpm");
    const previousPath = process.env.PATH;
    const previousToken = process.env.NODE_AUTH_TOKEN;
    const previousCapture = process.env.THAAREI_TEST_CAPTURE_USER_CONFIG;
    const previousPackageRoot = process.env.THAAREI_LOCAL_PACKAGE_ROOT;
    await mkdir(bin);
    await writeFile(
      fakePnpm,
      `#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (process.argv[2] === "install") {
  const userConfig = process.env.NPM_CONFIG_USERCONFIG;
  if (!userConfig) {
    writeFileSync(process.env.THAAREI_TEST_CAPTURE_USER_CONFIG, "missing-user-config");
    process.exit(41);
  }
  const expected = "//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}\\n";
  if (readFileSync(userConfig, "utf8") !== expected) {
    writeFileSync(process.env.THAAREI_TEST_CAPTURE_USER_CONFIG, "unexpected-user-config");
    process.exit(42);
  }
  if ((statSync(userConfig).mode & 0o777) !== 0o600) {
    writeFileSync(process.env.THAAREI_TEST_CAPTURE_USER_CONFIG, "unsafe-user-config-mode");
    process.exit(43);
  }
  writeFileSync(process.env.THAAREI_TEST_CAPTURE_USER_CONFIG, userConfig);
  writeFileSync(join(process.cwd(), "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n");
}
`,
      "utf8",
    );
    await chmod(fakePnpm, 0o700);
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    process.env.NODE_AUTH_TOKEN = "test-token-that-must-not-be-written";
    process.env.THAAREI_TEST_CAPTURE_USER_CONFIG = capturePath;
    delete process.env.THAAREI_LOCAL_PACKAGE_ROOT;
    try {
      try {
        await runInitializer([
          "--product-id",
          "product",
          "--client-id",
          "client",
          "--display-name",
          "Fixture Client",
          "--package-scope",
          "@fixture",
          "--profiles",
          "web",
          "--deployment",
          "dokploy",
          "--technical-owner",
          "Engineering",
          "--operations-owner",
          "Operations",
          "--output-dir",
          outputDir,
          "--skip-git",
        ]);
      } catch (error: unknown) {
        const diagnostic = await readFile(capturePath, "utf8").catch(() => "no-diagnostic");
        throw new Error(`Registry auth fixture failed: ${diagnostic}`, { cause: error });
      }
      const userConfig = await readFile(capturePath, "utf8");
      expect(userConfig.startsWith(root)).toBe(false);
      await expect(stat(userConfig)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(outputDir, ".npmrc"), "utf8")).resolves.not.toContain(
        "test-token-that-must-not-be-written",
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousToken === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = previousToken;
      if (previousCapture === undefined) delete process.env.THAAREI_TEST_CAPTURE_USER_CONFIG;
      else process.env.THAAREI_TEST_CAPTURE_USER_CONFIG = previousCapture;
      if (previousPackageRoot === undefined) delete process.env.THAAREI_LOCAL_PACKAGE_ROOT;
      else process.env.THAAREI_LOCAL_PACKAGE_ROOT = previousPackageRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
});
