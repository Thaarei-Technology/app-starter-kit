import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import type { CheckResult, Diagnostic } from "./types.js";

interface PackageInfo {
  readonly name: string;
  readonly directory: string;
  readonly kind: "app" | "package" | "root";
}

const IGNORED = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"]);
const PROVIDER_MODULES = [
  "@aws-sdk/",
  "@azure/",
  "@google-cloud/",
  "@ai-sdk/",
  "ai",
  "better-auth",
  "graphile-worker",
  "openai",
  "redis",
  "resend",
  "stripe",
];

const isRelative = (specifier: string): boolean => specifier.startsWith(".");
const isProviderModule = (specifier: string): boolean =>
  PROVIDER_MODULES.some((prefix) =>
    prefix.endsWith("/")
      ? specifier.startsWith(prefix)
      : specifier === prefix || specifier.startsWith(`${prefix}/`),
  );

const importSpecifiers = (source: string): readonly string[] => {
  const specifiers: string[] = [];
  const expressions = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
};

const readPackages = async (root: string): Promise<readonly PackageInfo[]> => {
  const packages: PackageInfo[] = [];
  const visit = async (directory: string, kind: PackageInfo["kind"]): Promise<void> => {
    let entries: readonly Dirent[] = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "package.json" && kind !== "root") {
        try {
          const parsed: unknown = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
          if (isRecord(parsed) && typeof parsed.name === "string")
            packages.push({ name: parsed.name, directory, kind });
        } catch {
          // Invalid manifests are handled by the repository's package check.
        }
      } else if (entry.isDirectory() && !IGNORED.has(entry.name)) {
        await visit(join(directory, entry.name), kind);
      }
    }
  };
  await visit(join(root, "apps"), "app");
  await visit(join(root, "packages"), "package");
  return packages.sort((left, right) => left.directory.localeCompare(right.directory));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const packageForFile = (
  file: string,
  packages: readonly PackageInfo[],
  root: string,
): PackageInfo | undefined => {
  const discovered = packages
    .filter((entry) => file === entry.directory || file.startsWith(`${entry.directory}/`))
    .sort((left, right) => right.directory.length - left.directory.length)[0];
  if (discovered !== undefined) return discovered;
  const segments = relative(root, file).split("/");
  if (segments[0] !== "packages" && segments[0] !== "apps") return undefined;
  const packageDirectory = resolve(root, segments[0], segments[1] ?? "");
  const packageName = segments[1];
  return packageName === undefined
    ? undefined
    : {
        name: `${segments[0]}/${packageName}`,
        directory: packageDirectory,
        kind: segments[0] === "apps" ? "app" : "package",
      };
};

const packageForSpecifier = (
  specifier: string,
  packages: readonly PackageInfo[],
): PackageInfo | undefined => {
  const exact = packages.find(
    (entry) => specifier === entry.name || specifier.startsWith(`${entry.name}/`),
  );
  return exact;
};

const resolveRelativeImport = (file: string, specifier: string): string => {
  const base = resolve(file, "..");
  const candidate = resolve(base, specifier);
  return candidate.replace(/\.(?:[cm]?tsx?|jsx?)$/u, "");
};

const under = (file: string, root: string, segment: string): boolean => {
  const path = relative(root, file).split("/");
  return path[0] === segment;
};

const diagnostic = (code: string, message: string, file: string): Diagnostic => ({
  code,
  message,
  file,
  severity: "error",
});

export const checkBoundaries = async (root: string): Promise<CheckResult> => {
  const absoluteRoot = resolve(root);
  const packages = await readPackages(absoluteRoot);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: readonly Dirent[] = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED.has(entry.name)) await visit(join(directory, entry.name));
      else if (
        entry.isFile() &&
        [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(entry.name))
      )
        files.push(join(directory, entry.name));
    }
  };
  await Promise.all([visit(join(absoluteRoot, "apps")), visit(join(absoluteRoot, "packages"))]);
  const diagnostics: Diagnostic[] = [];
  for (const file of files.sort()) {
    const owner = packageForFile(file, packages, absoluteRoot);
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const target = isRelative(specifier) ? undefined : packageForSpecifier(specifier, packages);
      const relativeTargetPath = isRelative(specifier)
        ? resolveRelativeImport(file, specifier)
        : undefined;
      const importedPath = target?.directory ?? relativeTargetPath ?? specifier;
      const relativeTarget =
        relativeTargetPath === undefined
          ? undefined
          : packageForFile(relativeTargetPath, packages, absoluteRoot);
      const resolvedTarget = target ?? relativeTarget;
      const importedText = importedPath.toLowerCase();
      if (
        (specifier === "drizzle-orm" ||
          specifier.startsWith("drizzle-orm/") ||
          specifier === "pg" ||
          specifier.startsWith("pg/") ||
          specifier === "postgres" ||
          specifier.startsWith("postgres/")) &&
        !(owner?.directory.endsWith("/packages/database") ?? false)
      ) {
        diagnostics.push(
          diagnostic(
            "BOUNDARY_DATABASE_DRIVER",
            "Drizzle, pg, and postgres imports are allowed only in packages/database.",
            file,
          ),
        );
      }
      if (
        owner?.kind === "package" &&
        (resolvedTarget?.kind === "app" || /(?:^|[/_-])apps(?:[/_-]|$)/u.test(importedText))
      ) {
        diagnostics.push(
          diagnostic("BOUNDARY_PACKAGE_TO_APP", "A package must not import an application.", file),
        );
      }
      if (
        owner !== undefined &&
        under(file, absoluteRoot, "apps") &&
        (relative(absoluteRoot, file).startsWith("apps/web/") ||
          relative(absoluteRoot, file).startsWith("apps/mobile/")) &&
        (resolvedTarget?.name.endsWith("/database") ||
          importedText.includes("/packages/database") ||
          importedText.endsWith("/database"))
      ) {
        diagnostics.push(
          diagnostic(
            "BOUNDARY_CLIENT_DATABASE",
            "Web and mobile code must not import packages/database.",
            file,
          ),
        );
      }
      if (
        owner?.name.endsWith("/core") &&
        resolvedTarget !== undefined &&
        resolvedTarget.directory !== owner.directory &&
        !resolvedTarget.name.endsWith("/foundation") &&
        !resolvedTarget.name.endsWith("/contracts")
      ) {
        diagnostics.push(
          diagnostic(
            "BOUNDARY_CORE_DEPENDENCY",
            "packages/core may depend only on foundation and contracts workspace packages.",
            file,
          ),
        );
      }
      if (isProviderModule(specifier) && !(owner?.name.endsWith("/adapters") ?? false)) {
        diagnostics.push(
          diagnostic(
            "BOUNDARY_PROVIDER_SDK",
            `Provider SDK ${specifier} is allowed only in an adapters package.`,
            file,
          ),
        );
      }
    }
  }
  return { diagnostics, ok: diagnostics.length === 0 };
};
