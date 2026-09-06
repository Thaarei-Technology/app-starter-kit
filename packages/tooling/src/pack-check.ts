import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PUBLISHABLE_PACKAGES } from "./publication.js";

const execFileAsync = promisify(execFile);

export interface PackedPackageEvidence {
  readonly package: string;
  readonly version: string;
  readonly filename: string;
  readonly bytes: number;
  readonly sha256: string;
}

export async function checkPackedPackages(root: string): Promise<readonly PackedPackageEvidence[]> {
  const output = await mkdtemp(resolve(tmpdir(), "thaarei-pack-"));
  const consumer = await mkdtemp(resolve(tmpdir(), "thaarei-consumer-"));
  try {
    const evidence: PackedPackageEvidence[] = [];
    for (const packageName of PUBLISHABLE_PACKAGES) {
      const directory = packageName.slice("@thaarei-technology/".length);
      const before = new Set(await readdir(output));
      await execFileAsync("pnpm", ["pack", "--pack-destination", output], {
        cwd: resolve(root, "packages", directory),
      });
      const filename = (await readdir(output)).find(
        (entry) => entry.endsWith(".tgz") && !before.has(entry),
      );
      if (!filename) throw new Error(`pnpm pack did not produce a tarball for ${packageName}`);
      const content = await readFile(resolve(output, filename));
      const manifest = JSON.parse(
        await readFile(resolve(root, "packages", directory, "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof manifest.version !== "string")
        throw new Error(`${packageName} has no package version`);
      evidence.push({
        package: packageName,
        version: manifest.version,
        filename,
        bytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
    const tarballs = evidence.map((entry) => resolve(output, entry.filename));
    await writeFile(
      resolve(consumer, "package.json"),
      `${JSON.stringify({ name: "thaarei-package-consumer", version: "1.0.0", private: true }, null, 2)}\n`,
    );
    await execFileAsync("pnpm", ["add", "--offline", "--ignore-scripts", ...tarballs], {
      cwd: consumer,
    });
    const installed = JSON.parse(await readFile(resolve(consumer, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const packageName of PUBLISHABLE_PACKAGES) {
      if (installed.dependencies?.[packageName] === undefined)
        throw new Error(`clean consumer did not install ${packageName}`);
    }
    return evidence;
  } finally {
    await Promise.all([
      rm(output, { recursive: true, force: true }),
      rm(consumer, { recursive: true, force: true }),
    ]);
  }
}

async function main(): Promise<void> {
  const manifestIndex = process.argv.indexOf("--manifest");
  const manifestPath = manifestIndex >= 0 ? process.argv[manifestIndex + 1] : undefined;
  if (manifestIndex >= 0 && !manifestPath) throw new Error("--manifest requires a path");
  const rootArgument = process.argv
    .slice(2)
    .find((argument) => argument !== "--manifest" && argument !== manifestPath);
  const evidence = await checkPackedPackages(rootArgument ? resolve(rootArgument) : process.cwd());
  if (manifestPath) {
    await writeFile(
      resolve(manifestPath),
      `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), packages: evidence }, null, 2)}\n`,
    );
  }
  process.stdout.write("publishable package tarballs passed clean-consumer validation\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
