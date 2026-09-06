import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLISHABLE_PACKAGES = [
  "@thaarei-technology/create-app",
  "@thaarei-technology/foundation",
  "@thaarei-technology/tooling",
] as const;
const allowlist = new Set<string>(PUBLISHABLE_PACKAGES);

interface PublicationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function checkPublicationPolicy(root: string): Promise<PublicationResult> {
  const errors: string[] = [];
  const rootManifest: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (!record(rootManifest) || rootManifest.private !== true)
    errors.push("the starter workspace root must remain private");
  const rootVersion = record(rootManifest) ? rootManifest.version : undefined;
  const packageRoot = resolve(root, "packages");
  const entries = await readdir(packageRoot, { withFileTypes: true });
  const discovered = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(resolve(packageRoot, entry.name, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (!record(parsed) || typeof parsed.name !== "string") continue;
    const publishable = parsed.private !== true;
    if (!publishable) continue;
    discovered.add(parsed.name);
    if (!allowlist.has(parsed.name)) errors.push(`unapproved publishable package: ${parsed.name}`);
    if (parsed.version !== rootVersion)
      errors.push(`${parsed.name} must use the root lockstep version ${String(rootVersion)}`);
    const publishConfig = parsed.publishConfig;
    if (
      !record(publishConfig) ||
      publishConfig.registry !== "https://npm.pkg.github.com" ||
      publishConfig.access !== "restricted"
    ) {
      errors.push(`${parsed.name} must publish privately to GitHub Packages`);
    }
    if (!Array.isArray(parsed.files) || parsed.files.length === 0)
      errors.push(`${parsed.name} must declare an explicit files allowlist`);
    if (!record(parsed.exports)) errors.push(`${parsed.name} must declare explicit exports`);
    if (!record(parsed.repository))
      errors.push(`${parsed.name} must link to its source repository`);
  }
  for (const name of PUBLISHABLE_PACKAGES) {
    if (!discovered.has(name)) errors.push(`approved package is missing or private: ${name}`);
  }
  return { ok: errors.length === 0, errors };
}

async function main(): Promise<void> {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const result = await checkPublicationPolicy(root);
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("package publication policy is consistent\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
