import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPublicationPolicy } from "./publication.js";

const root = resolve(import.meta.dirname, "../../..");

describe("package publication policy", () => {
  it("accepts only the three approved lockstep packages", async () => {
    await expect(checkPublicationPolicy(root)).resolves.toEqual({ ok: true, errors: [] });
  });

  it("rejects a fourth publishable package", async () => {
    const fixture = await mkdtemp(resolve(tmpdir(), "thaarei-publication-"));
    await cp(resolve(root, "package.json"), resolve(fixture, "package.json"));
    for (const name of ["create-app", "foundation", "tooling"]) {
      await mkdir(resolve(fixture, "packages", name), { recursive: true });
      await cp(
        resolve(root, "packages", name, "package.json"),
        resolve(fixture, "packages", name, "package.json"),
      );
    }
    await mkdir(resolve(fixture, "packages", "unexpected"), { recursive: true });
    const foundation = JSON.parse(
      await readFile(resolve(root, "packages/foundation/package.json"), "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      resolve(fixture, "packages/unexpected/package.json"),
      JSON.stringify({ ...foundation, name: "@thaarei-technology/unexpected" }),
    );
    const result = await checkPublicationPolicy(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "unapproved publishable package: @thaarei-technology/unexpected",
    );
  });
});
