import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: ".artifacts/coverage",
      include: ["packages/**/src/**/*.ts"],
      exclude: [
        "packages/create-app/assets/**",
        "packages/create-app/src/index.ts",
        "packages/create-app/src/validate-fixtures.ts",
        "packages/create-app/src/validate-web-handoff.ts",
        "packages/tooling/src/governance/cli.ts",
        "packages/tooling/src/pack-check.ts",
        "packages/tooling/src/types.ts",
        "**/generated/**",
        "**/migrations/**",
      ],
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },
    include: ["packages/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
