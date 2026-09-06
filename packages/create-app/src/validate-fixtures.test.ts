import { describe, expect, test } from "vitest";
import { allocatePorts } from "./validate-fixtures.js";

describe("fixture port allocation", () => {
  test("reserves a unique port for every service in one allocation", async () => {
    const names = ["api", "web", "worker", "python", "postgres", "storage"];
    const ports = await allocatePorts(names);

    expect(Object.keys(ports)).toEqual(names);
    expect(new Set(Object.values(ports)).size).toBe(names.length);
  });
});
