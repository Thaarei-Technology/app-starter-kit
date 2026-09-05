import { z } from "zod";

export const sourceMaturitySchema = z.enum(["stable", "beta", "experimental"]);
export const qualificationStatusSchema = z.enum([
  "not_required",
  "unqualified",
  "qualified",
  "blocked",
  "expired",
]);
export const evidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "pending",
  "blocked_external",
  "waived",
]);
export const productionPolicySchema = z.enum([
  "starter_qualified",
  "requires_product_qualification",
  "forbidden",
]);

export type SourceMaturity = z.infer<typeof sourceMaturitySchema>;
export type QualificationStatus = z.infer<typeof qualificationStatusSchema>;
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type ProductionPolicy = z.infer<typeof productionPolicySchema>;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const qualificationEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    subject: z.object({
      kind: z.enum(["release", "profile", "provider", "deployment_target", "topology"]),
      id: z.string().min(1),
      version: z.string().min(1),
    }),
    generatorVersion: z.string().min(1),
    recipeHash: sha256Schema,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    environment: z.enum(["ci", "staging", "production", "recovery"]),
    provider: z.string().min(1).nullable(),
    deploymentTarget: z.enum(["dokploy", "railway"]).nullable(),
    topology: z.string().min(1).nullable(),
    artifactDigests: z.record(z.string(), sha256Schema),
    migrationDigests: z.array(sha256Schema),
    gate: z.string().min(1),
    status: evidenceStatusSchema,
    evidenceUri: z.string().min(1),
    verifier: z.string().min(1),
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();
export type QualificationEvidence = z.infer<typeof qualificationEvidenceSchema>;

export const profileQualificationSchema = z
  .object({
    id: z.string().min(1),
    sourceMaturity: sourceMaturitySchema,
    productionPolicy: productionPolicySchema,
    qualification: qualificationStatusSchema,
    requiredGates: z.array(z.string().min(1)),
  })
  .strict();
export type ProfileQualification = z.infer<typeof profileQualificationSchema>;

export const securityWaiverSchema = z
  .object({
    id: z.string().min(1),
    advisoryIds: z.array(z.string().min(1)).min(1),
    affectedSubject: z.object({
      kind: z.enum(["package", "profile", "fixture"]),
      id: z.string().min(1),
    }),
    dependencyPath: z.array(z.string().min(1)).min(1),
    reachability: z.string().min(1),
    controls: z.array(z.string().min(1)).min(1),
    owner: z.string().min(1),
    reviewedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    removalCondition: z.string().min(1),
    blocksProduction: z.literal(true),
  })
  .strict();
export type SecurityWaiver = z.infer<typeof securityWaiverSchema>;

export interface AdmissionDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

function sameDigestRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

export function evaluateProductionAdmission(input: {
  readonly profiles: readonly ProfileQualification[];
  readonly evidence: readonly QualificationEvidence[];
  readonly expected: Readonly<{
    subjectVersion: string;
    generatorVersion: string;
    recipeHash: string;
    sourceCommit: string;
    provider: string | null;
    deploymentTarget: "dokploy" | "railway";
    topology: string;
    artifactDigests: Readonly<Record<string, string>>;
    migrationDigests: readonly string[];
  }>;
  readonly now?: Date;
}): AdmissionDecision {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  for (const profile of input.profiles) {
    if (profile.productionPolicy === "forbidden") {
      reasons.push(`${profile.id} is forbidden in production`);
      continue;
    }
    if (
      (profile.productionPolicy === "requires_product_qualification" ||
        profile.productionPolicy === "starter_qualified") &&
      profile.qualification !== "qualified"
    ) {
      reasons.push(`${profile.id} is not qualified for production`);
    }
    for (const gate of profile.requiredGates) {
      const matching = input.evidence.filter(
        (item) =>
          item.subject.kind === "profile" && item.subject.id === profile.id && item.gate === gate,
      );
      const currentPass = matching.some((item) => {
        if (
          item.environment !== "production" ||
          item.status !== "passed" ||
          (item.expiresAt !== null && new Date(item.expiresAt) <= now)
        )
          return false;
        const expected = input.expected;
        return (
          item.subject.version === expected.subjectVersion &&
          item.generatorVersion === expected.generatorVersion &&
          item.recipeHash === expected.recipeHash &&
          item.sourceCommit === expected.sourceCommit &&
          item.provider === expected.provider &&
          item.deploymentTarget === expected.deploymentTarget &&
          item.topology === expected.topology &&
          sameDigestRecord(item.artifactDigests, expected.artifactDigests) &&
          JSON.stringify(item.migrationDigests) === JSON.stringify(expected.migrationDigests)
        );
      });
      if (!currentPass)
        reasons.push(`${profile.id} is missing current production evidence for ${gate}`);
    }
  }
  return { allowed: reasons.length === 0, reasons };
}
