import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { allocatePorts, configureFixtureEnvironment } from "./validate-fixtures.js";

describe("fixture port allocation", () => {
  test("reserves a unique port for every service in one allocation", async () => {
    const names = ["api", "web", "worker", "python", "postgres", "storage"];
    const ports = await allocatePorts(names);

    expect(Object.keys(ports)).toEqual(names);
    expect(new Set(Object.values(ports)).size).toBe(names.length);
  });

  test("rewrites every database URL, including the admin URL, to the allocated port", async () => {
    const root = await mkdtemp(join(tmpdir(), "starter-fixture-env-"));
    try {
      await writeFile(
        join(root, ".env.example"),
        `${[
          "DATABASE_ADMIN_URL=postgres://starter_admin:starter_admin_local@127.0.0.1:5432/starter",
          "DATABASE_URL=postgres://starter_runtime:starter_runtime_local@127.0.0.1:5432/starter",
          "MIGRATOR_DATABASE_URL=postgres://starter_migrator:starter_migrator_local@127.0.0.1:5432/starter",
          "PORT=3001",
        ].join("\n")}\n`,
      );

      await configureFixtureEnvironment(
        root,
        { api: 41001, web: 41002, postgres: 41003 },
        "fixture-port-rewrite",
      );

      const environment = await readFile(join(root, ".env"), "utf8");
      expect(environment).toContain(
        "DATABASE_ADMIN_URL=postgres://starter_admin:starter_admin_local@127.0.0.1:41003/starter",
      );
      expect(environment).toContain(
        "DATABASE_URL=postgres://starter_runtime:starter_runtime_local@127.0.0.1:41003/starter",
      );
      expect(environment).toContain(
        "MIGRATOR_DATABASE_URL=postgres://starter_migrator:starter_migrator_local@127.0.0.1:41003/starter",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
