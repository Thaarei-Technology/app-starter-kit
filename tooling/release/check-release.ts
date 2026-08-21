import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const versionRecordSchema = z.record(z.string(), z.string().min(1));

const releaseSchema = z
  .object({
    $schema: z.string().min(1),
    schemaVersion: z.literal(1),
    release: z.string().min(1),
    status: z.enum(["prerelease", "released", "superseded"]),
    releasedAt: z.string().datetime().nullable(),
    runtime: z.object({
      node: z.string().regex(/^\d+\.\d+\.\d+$/),
      pnpm: z.string().regex(/^\d+\.\d+\.\d+$/),
    }),
    approvedMajors: z.record(z.string(), z.number().int().nonnegative()),
    testedPackages: versionRecordSchema,
    containerImages: z.record(
      z.string(),
      z.object({
        reference: z.string().min(1),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      }),
    ),
    enabledProfiles: z.array(z.string().min(1)).refine((profiles) => {
      return new Set(profiles).size === profiles.length;
    }, "enabledProfiles must not contain duplicates"),
    compatibilityEvidence: z.array(
      z.object({
        gate: z.string().min(1),
        status: z.enum(["passed", "failed", "pending", "blocked_external"]),
        evidence: z.string().min(1),
      }),
    ),
  })
  .strict();

const packageSchema = z.object({
  packageManager: z.string().min(1),
  engines: z.object({ node: z.string().min(1) }),
  devDependencies: versionRecordSchema,
});

const workspaceSchema = z.object({
  catalog: versionRecordSchema.optional(),
});

const PACKAGE_DIRECTORIES = ["apps", "packages"] as const;
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", ".next", ".turbo"]);
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type PackageManifest = {
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
};

export type ReleaseCheckResult =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly errors: readonly string[] };

async function parseJsonFile(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dependencyRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

const collectWorkspaceManifests = async (root: string): Promise<readonly PackageManifest[]> => {
  const manifests: PackageManifest[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: readonly Dirent[] = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "package.json" && entry.isFile()) {
        const path = join(directory, entry.name);
        const parsed = await parseJsonFile(path);
        if (!isRecord(parsed) || typeof parsed.name !== "string") continue;
        const dependencies = Object.fromEntries(
          DEPENDENCY_FIELDS.flatMap((field) => Object.entries(dependencyRecord(parsed[field]))),
        );
        manifests.push({ name: parsed.name, dependencies });
      } else if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        await visit(join(directory, entry.name));
      }
    }
  };
  for (const directory of PACKAGE_DIRECTORIES) await visit(join(root, directory));
  return manifests;
};

const isLocalOrBuiltinDependency = (
  name: string,
  version: string,
  localNames: ReadonlySet<string>,
): boolean =>
  localNames.has(name) ||
  version.startsWith("workspace:") ||
  version.startsWith("file:") ||
  version.startsWith("link:") ||
  name.startsWith("node:") ||
  builtinModules.includes(name);

const hasNonLatestImageTag = (reference: string): boolean => {
  const lastSlash = reference.lastIndexOf("/");
  const tagSeparator = reference.lastIndexOf(":");
  return tagSeparator > lastSlash && reference.slice(tagSeparator + 1) !== "latest";
};

export async function checkRelease(root: string): Promise<ReleaseCheckResult> {
  const manifestResult = releaseSchema.safeParse(
    await parseJsonFile(resolve(root, "starter-release.json")),
  );
  const packageResult = packageSchema.safeParse(await parseJsonFile(resolve(root, "package.json")));
  const workspaceText = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
  const parsedWorkspace: unknown = parseYaml(workspaceText);
  const workspaceResult = workspaceSchema.safeParse(parsedWorkspace);
  const errors: string[] = [];

  if (!manifestResult.success) {
    errors.push(
      ...manifestResult.error.issues.map((issue) => `starter-release.json: ${issue.message}`),
    );
  }
  if (!packageResult.success) {
    errors.push(...packageResult.error.issues.map((issue) => `package.json: ${issue.message}`));
  }
  if (!workspaceResult.success) {
    errors.push(
      ...workspaceResult.error.issues.map((issue) => `pnpm-workspace.yaml: ${issue.message}`),
    );
  }
  if (!manifestResult.success || !packageResult.success || !workspaceResult.success) {
    return { kind: "invalid", errors };
  }

  const manifest = manifestResult.data;
  const packageData = packageResult.data;
  const workspace = workspaceResult.data;

  if (packageData.packageManager !== `pnpm@${manifest.runtime.pnpm}`) {
    errors.push("packageManager must match starter-release.json runtime.pnpm");
  }

  const [nodeMajor, nodeMinor] = manifest.runtime.node.split(".");
  if (packageData.engines.node !== `${nodeMajor}.${nodeMinor}.x`) {
    errors.push("package.json engines.node must pin the released Node major and minor line");
  }

  for (const [name, version] of Object.entries(packageData.devDependencies)) {
    if (manifest.testedPackages[name] !== version) {
      errors.push(`devDependency ${name}@${version} is missing from testedPackages`);
    }
  }

  for (const [name, version] of Object.entries(workspace.catalog ?? {})) {
    if (manifest.testedPackages[name] !== version) {
      errors.push(`catalog package ${name}@${version} does not match testedPackages`);
    }
  }

  const workspaceManifests = await collectWorkspaceManifests(root);
  const localWorkspaceNames = new Set(workspaceManifests.map((manifest) => manifest.name));
  const catalog = workspace.catalog ?? {};
  for (const manifestFile of workspaceManifests) {
    for (const [name, declaredVersion] of Object.entries(manifestFile.dependencies)) {
      if (isLocalOrBuiltinDependency(name, declaredVersion, localWorkspaceNames)) continue;
      const resolvedVersion = declaredVersion.startsWith("catalog:")
        ? catalog[name]
        : declaredVersion;
      if (resolvedVersion === undefined || manifest.testedPackages[name] !== resolvedVersion) {
        const suffix =
          resolvedVersion === undefined
            ? " is not recorded in the workspace catalog"
            : ` resolves to ${resolvedVersion}`;
        errors.push(
          `workspace dependency ${manifestFile.name} ${name}@${declaredVersion}${suffix} and is missing from testedPackages`,
        );
      }
    }
  }

  for (const [name, version] of Object.entries(manifest.testedPackages)) {
    const major = Number.parseInt(version.split(".")[0] ?? "", 10);
    if (!Number.isInteger(major) || manifest.approvedMajors[name] !== major) {
      errors.push(`approvedMajors must contain ${name}: ${major}`);
    }
  }

  for (const name of Object.keys(manifest.approvedMajors)) {
    if (manifest.testedPackages[name] === undefined) {
      errors.push(`approved major ${name} has no exact tested package version`);
    }
  }

  for (const [name, image] of Object.entries(manifest.containerImages)) {
    if (!hasNonLatestImageTag(image.reference)) {
      errors.push(`container image ${name} must use a non-latest tag`);
    }
  }

  if (manifest.status === "released" && manifest.releasedAt === null) {
    errors.push("releasedAt is required when status is released");
  }
  if (
    manifest.status === "released" &&
    manifest.compatibilityEvidence.some((evidence) => evidence.status !== "passed")
  ) {
    errors.push("every compatibility gate must pass before release promotion");
  }
  if (manifest.status === "prerelease" && manifest.releasedAt !== null) {
    errors.push("releasedAt must remain null while status is prerelease");
  }

  return errors.length === 0 ? { kind: "valid" } : { kind: "invalid", errors };
}

async function main(): Promise<void> {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const result = await checkRelease(root);
  if (result.kind === "invalid") {
    for (const error of result.errors) {
      process.stderr.write(`${error}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("starter release manifest is consistent\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
