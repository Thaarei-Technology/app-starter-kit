import { describe, expect, it } from "vitest";
import { runInitializer, structuredInitializerFailure } from "./index.js";

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
});
