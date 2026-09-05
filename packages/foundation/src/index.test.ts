import { describe, expect, it } from "vitest";
import {
  createEntityId,
  entityId,
  loadRuntimeConfig,
  redactSensitive,
  utcInstant,
} from "./index.js";
import { z } from "zod";

describe("foundation primitives", () => {
  it("creates and validates UUIDv7 identifiers", () => {
    const id = createEntityId(1_700_000_000_000);
    expect(entityId(id)).toBe(id);
    expect(id.split("-")[2]?.startsWith("7")).toBe(true);
  });

  it("requires canonical UTC serialization", () => {
    expect(utcInstant("2026-09-05T00:00:00.000Z")).toBe("2026-09-05T00:00:00.000Z");
    expect(() => utcInstant("2026-09-05T00:00:00Z")).toThrow(/canonical/u);
  });

  it("validates and freezes product-owned runtime configuration", () => {
    const config = loadRuntimeConfig(z.object({ nested: z.object({ enabled: z.boolean() }) }), {
      nested: { enabled: true },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.nested)).toBe(true);
  });

  it("redacts nested sensitive values", () => {
    expect(redactSensitive({ apiKey: "secret", nested: { ok: true } })).toEqual({
      apiKey: "[REDACTED]",
      nested: { ok: true },
    });
  });
});
