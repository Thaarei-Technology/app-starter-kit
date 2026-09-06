import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
});
