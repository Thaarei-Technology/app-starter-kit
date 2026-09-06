#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SECURITY_TOOL_CATALOG = {
  gitleaks: {
    version: "8.30.1",
    image: "ghcr.io/gitleaks/gitleaks:v8.30.1",
    digest: "sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f",
  },
  semgrep: {
    version: "1.176.0",
    image: "semgrep/semgrep:1.176.0",
    digest: "sha256:12672acdb0949e19f9f6a4c2b288edd0b404f268f0ca7738a2c06f372f50362e",
  },
  trivy: {
    version: "0.74.0",
    image: "aquasec/trivy:0.74.0",
    digest: "sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969",
  },
  zap: {
    version: "2.17.0",
    image: "ghcr.io/zaproxy/zaproxy:2.17.0",
    digest: "sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef",
  },
  k6: {
    version: "2.2.0",
    image: "grafana/k6:2.2.0",
    digest: "sha256:9bd01d6941fca969cb61bb57d2da5ee9b385fe2aa8881df3798c196564d6ace6",
  },
  playwright: {
    version: "1.63.0",
    image: "mcr.microsoft.com/playwright:v1.63.0-noble",
    digest: "sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27",
  },
} as const;

export type SecurityCommand =
  | "secrets"
  | "secrets-full"
  | "sast"
  | "fs"
  | "config"
  | "image"
  | "sbom"
  | "dast"
  | "performance";

export interface SecurityInvocation {
  readonly tool: keyof typeof SECURITY_TOOL_CATALOG;
  readonly image: string;
  readonly arguments: readonly string[];
  readonly networkDisabled: boolean;
  readonly needsDockerSocket: boolean;
  readonly environment?: Readonly<Record<string, string>>;
  readonly inheritedEnvironment?: readonly string[];
  readonly hostNetwork?: boolean;
}

const pinnedImage = (tool: keyof typeof SECURITY_TOOL_CATALOG): string => {
  const entry = SECURITY_TOOL_CATALOG[tool];
  return `${entry.image}@${entry.digest}`;
};

function containerTarget(command: "dast" | "performance", target?: string): string {
  if (!target) throw new Error(`${command} requires an explicit target URL`);
  const parsed = new URL(target);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`${command} target must use http or https`);
  return parsed.toString();
}

export function buildSecurityInvocation(
  command: SecurityCommand,
  target?: string,
): SecurityInvocation {
  switch (command) {
    case "secrets":
      return {
        tool: "gitleaks",
        image: pinnedImage("gitleaks"),
        arguments: [
          "dir",
          "/workspace",
          "--config",
          "/workspace/tooling/security/gitleaks.toml",
          "--redact=100",
          "--no-banner",
          "--report-format",
          "sarif",
          "--report-path",
          "/reports/gitleaks.sarif",
        ],
        networkDisabled: true,
        needsDockerSocket: false,
      };
    case "secrets-full":
      return {
        tool: "gitleaks",
        image: pinnedImage("gitleaks"),
        arguments: [
          "git",
          "/workspace",
          "--config",
          "/workspace/tooling/security/gitleaks.toml",
          "--redact=100",
          "--no-banner",
          "--report-format",
          "sarif",
          "--report-path",
          "/reports/gitleaks-full.sarif",
        ],
        networkDisabled: true,
        needsDockerSocket: false,
      };
    case "sast":
      return {
        tool: "semgrep",
        image: pinnedImage("semgrep"),
        arguments: [
          "semgrep",
          "scan",
          "--config",
          "/src/tooling/security/semgrep.yml",
          "--metrics",
          "off",
          "--disable-version-check",
          "--error",
          "--sarif",
          "--output",
          "/reports/semgrep.sarif",
          "/src",
        ],
        networkDisabled: true,
        needsDockerSocket: false,
      };
    case "fs":
      return {
        tool: "trivy",
        image: pinnedImage("trivy"),
        arguments: [
          "fs",
          "--cache-dir",
          "/reports/cache/trivy",
          "--scanners",
          "vuln,license",
          "--severity",
          "HIGH,CRITICAL",
          "--exit-code",
          "1",
          "--format",
          "json",
          "--output",
          "/reports/trivy-fs.json",
          "/workspace",
        ],
        networkDisabled: false,
        needsDockerSocket: false,
      };
    case "config":
      return {
        tool: "trivy",
        image: pinnedImage("trivy"),
        arguments: [
          "fs",
          "--cache-dir",
          "/reports/cache/trivy",
          "--scanners",
          "misconfig",
          "--severity",
          "HIGH,CRITICAL",
          "--exit-code",
          "1",
          "--format",
          "json",
          "--output",
          "/reports/trivy-config.json",
          "/workspace",
        ],
        networkDisabled: false,
        needsDockerSocket: false,
      };
    case "image": {
      if (!target) throw new Error("security:image requires an image reference");
      return {
        tool: "trivy",
        image: pinnedImage("trivy"),
        arguments: [
          "image",
          "--cache-dir",
          "/reports/cache/trivy",
          "--scanners",
          "vuln",
          "--severity",
          "HIGH,CRITICAL",
          "--exit-code",
          "1",
          "--format",
          "json",
          "--output",
          "/reports/trivy-image.json",
          target,
        ],
        networkDisabled: false,
        needsDockerSocket: true,
        inheritedEnvironment: ["TRIVY_USERNAME", "TRIVY_PASSWORD"],
      };
    }
    case "sbom": {
      if (!target) throw new Error("security:sbom requires an image reference");
      return {
        tool: "trivy",
        image: pinnedImage("trivy"),
        arguments: [
          "image",
          "--cache-dir",
          "/reports/cache/trivy",
          "--format",
          "cyclonedx",
          "--output",
          "/reports/sbom.cdx.json",
          target,
        ],
        networkDisabled: false,
        needsDockerSocket: true,
        inheritedEnvironment: ["TRIVY_USERNAME", "TRIVY_PASSWORD"],
      };
    }
    case "dast": {
      const baseUrl = containerTarget(command, target);
      return {
        tool: "zap",
        image: pinnedImage("zap"),
        arguments: ["zap.sh", "-cmd", "-autorun", "/workspace/tooling/security/zap.yaml"],
        environment: { TARGET_URL: baseUrl },
        hostNetwork: true,
        networkDisabled: false,
        needsDockerSocket: false,
      };
    }
    case "performance": {
      const baseUrl = containerTarget(command, target);
      return {
        tool: "k6",
        image: pinnedImage("k6"),
        arguments: [
          "run",
          "--summary-export",
          "/reports/k6-summary.json",
          "/workspace/tooling/performance/smoke.js",
        ],
        environment: { BASE_URL: baseUrl },
        hostNetwork: true,
        networkDisabled: false,
        needsDockerSocket: false,
      };
    }
  }
}

export function dockerArguments(
  invocation: SecurityInvocation,
  root: string,
  reportDirectory: string,
): readonly string[] {
  const containerRoot = invocation.tool === "semgrep" ? "/src" : "/workspace";
  const user =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? [`--user`, `${process.getuid()}:${process.getgid()}`]
      : [];
  const socket =
    invocation.needsDockerSocket && existsSync("/var/run/docker.sock")
      ? ["--volume", "/var/run/docker.sock:/var/run/docker.sock"]
      : [];
  const environment = Object.entries(invocation.environment ?? {}).flatMap(([name, value]) => [
    "--env",
    `${name}=${value}`,
  ]);
  const inheritedEnvironment = (invocation.inheritedEnvironment ?? []).flatMap((name) => [
    "--env",
    name,
  ]);
  return [
    "run",
    "--rm",
    ...user,
    ...(invocation.networkDisabled ? ["--network", "none"] : []),
    ...(invocation.hostNetwork ? ["--network", "host"] : []),
    "--env",
    "SEMGREP_SEND_METRICS=off",
    "--env",
    "HOME=/tmp",
    ...environment,
    ...inheritedEnvironment,
    "--volume",
    `${root}:${containerRoot}:ro`,
    "--volume",
    `${reportDirectory}:/reports`,
    "--workdir",
    containerRoot,
    ...socket,
    invocation.image,
    ...invocation.arguments,
  ];
}

export async function runSecurityCommand(
  command: SecurityCommand,
  target?: string,
  root = process.cwd(),
): Promise<void> {
  const absoluteRoot = resolve(root);
  const reportDirectory = resolve(
    process.env.THAAREI_SECURITY_REPORT_DIR ?? `${absoluteRoot}/.artifacts/security`,
  );
  await mkdir(`${reportDirectory}/cache/trivy`, { recursive: true });
  const reportNames: Readonly<Record<SecurityCommand, string>> = {
    secrets: "gitleaks.sarif",
    "secrets-full": "gitleaks-full.sarif",
    sast: "semgrep.sarif",
    fs: "trivy-fs.json",
    config: "trivy-config.json",
    image: "trivy-image.json",
    sbom: "sbom.cdx.json",
    dast: "zap.json",
    performance: "k6-summary.json",
  };
  await rm(resolve(reportDirectory, reportNames[command]), { force: true });
  const invocation = buildSecurityInvocation(command, target);
  const result = spawnSync("docker", dockerArguments(invocation, absoluteRoot, reportDirectory), {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${invocation.tool} ${command} failed with exit code ${result.status ?? 1}`);
  }
}

export async function runSecurityPolicySelfTest(): Promise<void> {
  const fixture = await mkdtemp(resolve(tmpdir(), "thaarei-security-policy-"));
  try {
    await mkdir(resolve(fixture, "tooling/security"), { recursive: true });
    await writeFile(
      resolve(fixture, "tooling/security/gitleaks.toml"),
      "[extend]\nuseDefault = true\n",
    );
    await writeFile(
      resolve(fixture, "tooling/security/semgrep.yml"),
      "rules:\n  - id: policy-test.no-eval\n    message: eval is forbidden\n    severity: ERROR\n    languages: [typescript]\n    pattern: eval(...)\n",
    );
    await writeFile(
      resolve(fixture, "positive-secret.txt"),
      `token = ${["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_")}\n`,
    );
    await writeFile(resolve(fixture, "positive-sast.ts"), 'eval("untrusted")\n');
    for (const command of ["secrets", "sast"] as const) {
      let blocked = false;
      try {
        await runSecurityCommand(command, undefined, fixture);
      } catch {
        blocked = true;
      }
      if (!blocked) throw new Error(`${command} policy did not block its synthetic finding`);
    }
    await rm(resolve(fixture, "positive-secret.txt"));
    await rm(resolve(fixture, "positive-sast.ts"));
    await writeFile(resolve(fixture, "negative.ts"), "export const safe = true;\n");
    await runSecurityCommand("secrets", undefined, fixture);
    await runSecurityCommand("sast", undefined, fixture);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] as SecurityCommand | "policy-test" | undefined;
  if (command === "policy-test") {
    await runSecurityPolicySelfTest();
    return;
  }
  if (
    !command ||
    ![
      "secrets",
      "secrets-full",
      "sast",
      "fs",
      "config",
      "image",
      "sbom",
      "dast",
      "performance",
    ].includes(command)
  ) {
    throw new Error(
      "Expected secrets, secrets-full, sast, fs, config, image, sbom, dast, performance, or policy-test",
    );
  }
  await runSecurityCommand(
    command,
    process.argv.slice(3).find((argument) => argument !== "--"),
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "security scan failed"}\n`);
    process.exitCode = 1;
  });
}
