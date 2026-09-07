import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePackCheckArguments } from "./pack-check.js";

describe("resolvePackCheckArguments", () => {
  it("ignores the -- separator before --manifest", () => {
    expect(
      resolvePackCheckArguments(["node", "pack-check.ts", "--", "--manifest", "out.json"]),
    ).toEqual({ root: process.cwd(), manifestPath: "out.json" });
  });

  it("defaults to the working directory without arguments", () => {
    expect(resolvePackCheckArguments(["node", "pack-check.ts"])).toEqual({
      root: process.cwd(),
      manifestPath: undefined,
    });
  });

  it("accepts an explicit root alongside --manifest", () => {
    expect(
      resolvePackCheckArguments(["node", "pack-check.ts", "some-root", "--manifest", "out.json"]),
    ).toEqual({ root: resolve("some-root"), manifestPath: "out.json" });
  });

  it("rejects a missing --manifest path", () => {
    expect(() => resolvePackCheckArguments(["node", "pack-check.ts", "--manifest"])).toThrow(
      "--manifest requires a path",
    );
  });
});
