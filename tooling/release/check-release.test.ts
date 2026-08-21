import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRelease } from "./check-release.js";

const root = resolve(import.meta.dirname, "../..");

async function createFixture(): Promise<string> {
  const fixture = await mkdtemp(join(tmpdir(), "thaarei-release-"));
  for (const path of ["package.json", "pnpm-workspace.yaml", "starter-release.json"]) {
    await cp(resolve(root, path), resolve(fixture, path));
  }
  return fixture;
}

describe("checkRelease", () => {
  it("accepts the committed release contract", async () => {
    await expect(checkRelease(root)).resolves.toEqual({ kind: "valid" });
  });

  it("rejects catalog drift", async () => {
    const fixture = await createFixture();
    const workspacePath = resolve(fixture, "pnpm-workspace.yaml");
    const workspace = await readFile(workspacePath, "utf8");
    await writeFile(workspacePath, workspace.replace("fastify: 5.12.1", "fastify: 5.12.0"));

    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors).toContain(
        "catalog package fastify@5.12.0 does not match testedPackages",
      );
    }
  });

  it("rejects a tested package without its approved major", async () => {
    const fixture = await createFixture();
    const manifestPath = resolve(fixture, "starter-release.json");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, manifest.replace('    "@biomejs/biome": 2,\n', ""));

    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors).toContain("approvedMajors must contain @biomejs/biome: 2");
    }
  });

  it("rejects an unpinned or latest container image tag", async () => {
    const fixture = await createFixture();
    const manifestPath = resolve(fixture, "starter-release.json");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, manifest.replace("node:24.19.0-bookworm-slim", "node:latest"));

    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors).toContain("container image node must use a non-latest tag");
    }
  });

  it("accepts generated-style workspaces without a catalog when workspace pins match", async () => {
    const fixture = await createFixture();
    const workspacePath = resolve(fixture, "pnpm-workspace.yaml");
    const workspace = await readFile(workspacePath, "utf8");
    await writeFile(workspacePath, workspace.slice(0, workspace.indexOf("\ncatalog:")));
    await mkdir(resolve(fixture, "packages", "api"), { recursive: true });
    await writeFile(
      resolve(fixture, "packages", "api", "package.json"),
      JSON.stringify({ name: "@generated/api", dependencies: { fastify: "5.12.1", zod: "4.4.3" } }),
    );
    await expect(checkRelease(fixture)).resolves.toEqual({ kind: "valid" });
  });

  it("rejects unrecorded and drifted workspace dependency pins", async () => {
    const fixture = await createFixture();
    await mkdir(resolve(fixture, "packages", "api"), { recursive: true });
    await writeFile(
      resolve(fixture, "packages", "api", "package.json"),
      JSON.stringify({
        name: "@generated/api",
        dependencies: {
          fastify: "5.12.0",
          "not-tested": "1.0.0",
          "@generated/local": "workspace:*",
        },
      }),
    );
    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors.some((error) => error.includes("fastify@5.12.0"))).toBe(true);
      expect(result.errors.some((error) => error.includes("not-tested@1.0.0"))).toBe(true);
      expect(result.errors.some((error) => error.includes("@generated/local"))).toBe(false);
    }
  });

  it("rejects release promotion while a compatibility gate is blocked", async () => {
    const fixture = await createFixture();
    const manifestPath = resolve(fixture, "starter-release.json");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest
        .replace('"status": "prerelease"', '"status": "released"')
        .replace('"releasedAt": null', '"releasedAt": "2026-08-19T00:00:00.000Z"'),
    );

    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors).toContain(
        "every compatibility gate must pass before release promotion",
      );
    }
  });
});
