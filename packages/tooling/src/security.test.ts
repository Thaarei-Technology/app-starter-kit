import { describe, expect, test } from "vitest";
import { SECURITY_TOOL_CATALOG, buildSecurityInvocation, dockerArguments } from "./security.js";

describe("security tool catalog", () => {
  test("pins every scanner to an exact version and sha256 image digest", () => {
    for (const tool of Object.values(SECURITY_TOOL_CATALOG)) {
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(tool.image).not.toContain(":latest");
      expect(tool.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });

  test("keeps secret and SAST scans offline with redacted/local configuration", () => {
    const secrets = buildSecurityInvocation("secrets");
    const sast = buildSecurityInvocation("sast");
    expect(secrets.networkDisabled).toBe(true);
    expect(secrets.arguments).toContain("--redact=100");
    expect(secrets.arguments).toContain("/workspace/tooling/security/gitleaks.toml");
    expect(sast.networkDisabled).toBe(true);
    expect(sast.arguments).toContain("/src/tooling/security/semgrep.yml");
  });

  test("requires an explicit image and mounts the Docker socket without a shell", () => {
    expect(() => buildSecurityInvocation("image")).toThrow("requires an image reference");
    const invocation = buildSecurityInvocation("image", "example.test/app@sha256:abc");
    expect(invocation.needsDockerSocket).toBe(true);
    expect(invocation.arguments.at(-1)).toBe("example.test/app@sha256:abc");
    const args = dockerArguments(invocation, "/workspace", "/reports");
    expect(args).not.toContain("sh");
    expect(args).not.toContain("-c");
    expect(args).toEqual(
      expect.arrayContaining(["--env", "TRIVY_USERNAME", "--env", "TRIVY_PASSWORD"]),
    );
    expect(args.some((argument) => argument.startsWith("TRIVY_PASSWORD="))).toBe(false);
  });

  test("keeps DAST and performance targets explicit and reachable from their containers", () => {
    expect(() => buildSecurityInvocation("dast")).toThrow("explicit target URL");
    expect(() => buildSecurityInvocation("performance", "file:///tmp/result")).toThrow(
      "http or https",
    );
    for (const command of ["dast", "performance"] as const) {
      const invocation = buildSecurityInvocation(command, "http://127.0.0.1:3000");
      expect(invocation.environment).toMatchObject({
        [command === "dast" ? "TARGET_URL" : "BASE_URL"]: "http://127.0.0.1:3000/",
      });
      expect(invocation.hostNetwork).toBe(true);
      const args = dockerArguments(invocation, "/workspace", "/reports");
      expect(args).toEqual(expect.arrayContaining(["--network", "host"]));
      expect(args).not.toContain("/bin/sh");
      expect(args).not.toContain("-c");
    }
  });
});
