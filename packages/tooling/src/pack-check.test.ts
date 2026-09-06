import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePnpmCommand } from "./pack-check.js";

async function makeExecutable(directory: string, name: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return path;
}

describe("resolvePnpmCommand", () => {
  it("prefers a pnpm executable found on PATH", async () => {
    const fakeBin = await mkdtemp(join(tmpdir(), "thaarei-pnpm-path-"));
    const previousPath = process.env.PATH;
    const previousPnpmHome = process.env.PNPM_HOME;
    try {
      const expected = await makeExecutable(fakeBin, "pnpm");
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ""}`;
      delete process.env.PNPM_HOME;
      await expect(resolvePnpmCommand()).resolves.toBe(expected);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPnpmHome === undefined) delete process.env.PNPM_HOME;
      else process.env.PNPM_HOME = previousPnpmHome;
      await rm(fakeBin, { recursive: true, force: true });
    }
  });

  it("falls back to PNPM_HOME when PATH has no pnpm", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "thaarei-pnpm-empty-"));
    const pnpmHome = await mkdtemp(join(tmpdir(), "thaarei-pnpm-home-"));
    const previousPath = process.env.PATH;
    const previousPnpmHome = process.env.PNPM_HOME;
    try {
      const expected = await makeExecutable(pnpmHome, "pnpm");
      process.env.PATH = emptyDir;
      process.env.PNPM_HOME = pnpmHome;
      await expect(resolvePnpmCommand()).resolves.toBe(expected);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPnpmHome === undefined) delete process.env.PNPM_HOME;
      else process.env.PNPM_HOME = previousPnpmHome;
      await rm(emptyDir, { recursive: true, force: true });
      await rm(pnpmHome, { recursive: true, force: true });
    }
  });
});
