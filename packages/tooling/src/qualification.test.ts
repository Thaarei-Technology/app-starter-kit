import { describe, expect, it } from "vitest";
import { evaluateProductionAdmission, qualificationEvidenceSchema } from "./qualification.js";

const digest = `sha256:${"a".repeat(64)}`;
const evidence = qualificationEvidenceSchema.parse({
  schemaVersion: 1,
  subject: { kind: "profile", id: "api", version: "1.0.0-dev.1" },
  generatorVersion: "1.0.0-dev.1",
  recipeHash: digest,
  sourceCommit: "a".repeat(40),
  environment: "production",
  provider: null,
  deploymentTarget: "dokploy",
  topology: "standard",
  artifactDigests: { api: digest },
  migrationDigests: [],
  gate: "runtime",
  status: "passed",
  evidenceUri: "artifact://api-runtime",
  verifier: "ci",
  observedAt: "2026-09-05T00:00:00.000Z",
  expiresAt: "2026-10-05T00:00:00.000Z",
});
const expected = {
  subjectVersion: "1.0.0-dev.1",
  generatorVersion: "1.0.0-dev.1",
  recipeHash: digest,
  sourceCommit: "a".repeat(40),
  provider: null,
  deploymentTarget: "dokploy" as const,
  topology: "standard",
  artifactDigests: { api: digest },
  migrationDigests: [] as readonly string[],
};

describe("production admission", () => {
  it("accepts current exact stable evidence", () => {
    expect(
      evaluateProductionAdmission({
        profiles: [
          {
            id: "api",
            sourceMaturity: "stable",
            productionPolicy: "starter_qualified",
            qualification: "qualified",
            requiredGates: ["runtime"],
          },
        ],
        evidence: [evidence],
        expected,
        now: new Date("2026-09-06T00:00:00.000Z"),
      }).allowed,
    ).toBe(true);
  });

  it("rejects mobile even when evidence passes", () => {
    const decision = evaluateProductionAdmission({
      profiles: [
        {
          id: "mobile",
          sourceMaturity: "experimental",
          productionPolicy: "forbidden",
          qualification: "unqualified",
          requiredGates: [],
        },
      ],
      evidence: [],
      expected,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("mobile is forbidden in production");
  });

  it("rejects expired evidence", () => {
    const decision = evaluateProductionAdmission({
      profiles: [
        {
          id: "api",
          sourceMaturity: "stable",
          productionPolicy: "starter_qualified",
          qualification: "qualified",
          requiredGates: ["runtime"],
        },
      ],
      evidence: [evidence],
      expected,
      now: new Date("2026-11-05T00:00:00.000Z"),
    });
    expect(decision.allowed).toBe(false);
  });

  it("rejects evidence for a different subject or recipe", () => {
    const profile = {
      id: "api",
      sourceMaturity: "stable" as const,
      productionPolicy: "starter_qualified" as const,
      qualification: "qualified" as const,
      requiredGates: ["runtime"],
    };
    expect(
      evaluateProductionAdmission({
        profiles: [profile],
        evidence: [evidence],
        expected: { ...expected, subjectVersion: "1.0.0" },
      }).allowed,
    ).toBe(false);
    expect(
      evaluateProductionAdmission({
        profiles: [profile],
        evidence: [evidence],
        expected: { ...expected, recipeHash: `sha256:${"b".repeat(64)}` },
      }).allowed,
    ).toBe(false);
  });

  it("rejects an unqualified starter-qualified profile", () => {
    const decision = evaluateProductionAdmission({
      profiles: [
        {
          id: "api",
          sourceMaturity: "stable",
          productionPolicy: "starter_qualified",
          qualification: "unqualified",
          requiredGates: ["runtime"],
        },
      ],
      evidence: [evidence],
      expected,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("api is not qualified for production");
  });
});
