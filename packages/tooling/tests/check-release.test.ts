import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRelease } from "../src/release/check-release.js";

const root = resolve(import.meta.dirname, "../../..");

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

  it("rejects a root version that is not the release-manifest version", async () => {
    const fixture = await createFixture();
    const packagePath = resolve(fixture, "package.json");
    const packageData = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
    packageData.version = "1.0.0-dev.2";
    await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`);

    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors).toContain(
        "package.json version must match starter-release.json release 1.0.0-dev.1",
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
    await writeFile(manifestPath, manifest.replace("node:24.20.0-bookworm-slim", "node:latest"));

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
        "every stable profile and deployment topology must be qualified before release promotion",
      );
    }
  });

  it("rejects release promotion when qualification summaries lack current evidence", async () => {
    const fixture = await createFixture();
    const manifestPath = resolve(fixture, "starter-release.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      status: string;
      releasedAt: string | null;
      qualifications: Array<{ sourceMaturity: string; qualification: string }>;
      compatibilityEvidence: Array<{ gate: string; status: string }>;
    };
    manifest.status = "released";
    manifest.releasedAt = "2026-09-05T00:00:00.000Z";
    for (const qualification of manifest.qualifications) {
      if (qualification.sourceMaturity === "stable") qualification.qualification = "qualified";
    }
    for (const evidence of manifest.compatibilityEvidence) {
      if (!evidence.gate.startsWith("experimental-") && !evidence.gate.startsWith("beta-")) {
        evidence.status = "passed";
      }
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await checkRelease(fixture);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors).toContain("web is missing current release evidence for generation");
      expect(result.errors).toContain(
        "dokploy-hardened is missing current release evidence for restore",
      );
    }
  });

  it("accepts release promotion with current evidence for every stable gate", async () => {
    const fixture = await createFixture();
    const manifestPath = resolve(fixture, "starter-release.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      release: string;
      status: string;
      releasedAt: string | null;
      qualifications: Array<{
        id: string;
        sourceMaturity: string;
        qualification: string;
        requiredGates: string[];
      }>;
      compatibilityEvidence: Array<{ gate: string; status: string }>;
      evidence: unknown[];
    };
    manifest.status = "released";
    manifest.releasedAt = "2026-09-05T00:00:00.000Z";
    for (const qualification of manifest.qualifications) {
      if (qualification.sourceMaturity === "stable") qualification.qualification = "qualified";
    }
    for (const evidence of manifest.compatibilityEvidence) {
      if (!evidence.gate.startsWith("experimental-") && !evidence.gate.startsWith("beta-")) {
        evidence.status = "passed";
      }
    }
    const digest = `sha256:${"a".repeat(64)}`;
    manifest.evidence = manifest.qualifications
      .filter((qualification) => qualification.sourceMaturity === "stable")
      .flatMap((qualification) => {
        const topology = qualification.id.startsWith("dokploy-")
          ? qualification.id.slice("dokploy-".length)
          : null;
        return qualification.requiredGates.map((gate) => ({
          schemaVersion: 1,
          subject: {
            kind: topology === null ? "profile" : "topology",
            id: qualification.id,
            version: manifest.release,
          },
          generatorVersion: manifest.release,
          recipeHash: digest,
          sourceCommit: "a".repeat(40),
          environment: gate === "restore" ? "recovery" : "ci",
          provider: null,
          deploymentTarget: topology === null ? null : "dokploy",
          topology,
          artifactDigests: {},
          migrationDigests: [],
          gate,
          status: "passed",
          evidenceUri: `artifact://${qualification.id}/${gate}`,
          verifier: "release-test",
          observedAt: "2026-09-05T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }));
      });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(checkRelease(fixture)).resolves.toEqual({ kind: "valid" });
  });
});
