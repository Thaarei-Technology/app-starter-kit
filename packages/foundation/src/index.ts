import { randomBytes } from "node:crypto";
import { z } from "zod";

export const assuranceLevelSchema = z.enum([
  "anonymous",
  "single_factor",
  "multi_factor",
  "phishing_resistant",
  "recovery",
]);
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>;

export const appEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;
export const deploymentProfileSchema = z.enum(["development", "standard", "hardened"]);
export type DeploymentProfile = z.infer<typeof deploymentProfileSchema>;
export const capabilityStateSchema = z.enum(["disabled", "emulated", "live"]);
export type CapabilityState = z.infer<typeof capabilityStateSchema>;

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export type EntityId = string & { readonly __brand: "EntityId" };
export type UtcInstant = string & { readonly __brand: "UtcInstant" };

export function entityId(value: string): EntityId {
  if (!uuidV7Pattern.test(value)) throw new Error("Entity ID must be a lowercase UUIDv7 string");
  return value as EntityId;
}

export function createEntityId(now = Date.now()): EntityId {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return entityId(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

export function utcInstant(value: string | Date): UtcInstant {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("UTC instant is invalid");
  const normalized = date.toISOString();
  if (typeof value === "string" && value !== normalized)
    throw new Error("UTC instant must use canonical ISO-8601 UTC serialization");
  return normalized as UtcInstant;
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export function loadRuntimeConfig<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): Readonly<z.output<TSchema>> {
  return deepFreeze(schema.parse(input));
}

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly actorId?: EntityId;
  readonly tenantId?: EntityId;
  readonly assurance: AssuranceLevel;
  readonly release: string;
}

export type SafeErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: SafeErrorCode;
  readonly retryable: boolean;
  readonly correlationId?: string;

  constructor(input: {
    readonly code: SafeErrorCode;
    readonly safeMessage: string;
    readonly retryable?: boolean;
    readonly correlationId?: string;
    readonly cause?: unknown;
  }) {
    super(input.safeMessage, { cause: input.cause });
    this.name = "AppError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    if (input.correlationId !== undefined) this.correlationId = input.correlationId;
  }
}

const sensitiveKey = /authorization|cookie|password|secret|token|api[-_]?key|signature/iu;
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(child),
    ]),
  );
}

export const secretEnvelopeSchema = z.object({
  version: z.number().int().positive(),
  algorithm: z.string().min(1),
  keyId: z.string().min(1),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
  context: z.string().min(1),
});
export type SecretEnvelope = z.infer<typeof secretEnvelopeSchema>;

export interface SecretProtector {
  protect(plaintext: Uint8Array, context: string): Promise<SecretEnvelope>;
  reveal(envelope: SecretEnvelope, expectedContext: string): Promise<Uint8Array>;
}
