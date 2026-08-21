import {
  type Deployment,
  type InitConfig,
  type MobileSettings,
  PROFILE_NAMES,
  type Profile,
  type ProviderSelection,
} from "./generator.js";
import { canonicalProfile } from "./capabilities.js";

export class InitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitValidationError";
  }
}

function required(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)?.trim();
  if (!value) throw new InitValidationError(`Missing required option: --${name}`);
  return value;
}

function slug(value: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value))
    throw new InitValidationError(`Invalid ${name}: use lowercase letters, numbers, and hyphens`);
  return value;
}

function owner(value: string, name: string): string {
  if (value.length < 2) throw new InitValidationError(`Invalid ${name}: provide a name or team`);
  return safeText(value, name, 120);
}

function safeText(value: string, name: string, maximumLength = 200): string {
  // JSON, TSX, YAML, and shell-adjacent generated files all receive these values.
  // Reject control characters up front; quotes, angle brackets, colons, and Unicode
  // letters remain valid and are serialized by the generator for each syntax.
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
  if (hasControlCharacter)
    throw new InitValidationError(
      `Invalid ${name}: newlines and control characters are not allowed`,
    );
  if (value.length > maximumLength)
    throw new InitValidationError(`Invalid ${name}: must be ${maximumLength} characters or fewer`);
  return value;
}

function packageScope(value: string): string {
  const normalized = value.startsWith("@") ? value : `@${value}`;
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(normalized))
    throw new InitValidationError("Invalid package scope: expected @scope or scope");
  return normalized;
}

function profileList(raw: string): Profile[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0)
    throw new InitValidationError("--profiles must contain at least one profile");
  const selected = new Set<string>();
  for (const value of values) {
    const candidate = PROFILE_NAMES.find((profile) => profile === value);
    if (!candidate)
      throw new InitValidationError(
        `Unknown profile: ${value}. Supported profiles: ${PROFILE_NAMES.join(", ")}`,
      );
    if (selected.has(candidate)) throw new InitValidationError(`Duplicate profile: ${value}`);
    selected.add(candidate);
  }
  return PROFILE_NAMES.filter((profile) => selected.has(profile));
}

function csv<T extends string>(
  options: ReadonlyMap<string, string>,
  name: string,
  allowed: readonly T[],
): T[] {
  const raw = options.get(name)?.trim();
  if (!raw) return [];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const result: T[] = [];
  for (const value of values) {
    if (!allowed.includes(value as T))
      throw new InitValidationError(
        `Unknown ${name}: ${value}. Supported values: ${allowed.join(", ")}`,
      );
    if (result.includes(value as T)) throw new InitValidationError(`Duplicate ${name}: ${value}`);
    result.push(value as T);
  }
  return result;
}

function providers(
  options: ReadonlyMap<string, string>,
  profiles: readonly Profile[],
): ProviderSelection {
  const paymentProviders = csv(options, "payment-providers", ["stripe", "razorpay"] as const);
  const aiProviders = csv(options, "ai-providers", ["openai", "anthropic"] as const);
  const observabilityExporters = csv(options, "observability-exporters", [
    "otlp",
    "sentry",
  ] as const);
  const emailProvider = options.get("email-provider")?.trim() || null;
  const cacheProvider = options.get("cache-provider")?.trim() || null;
  if (emailProvider !== null && emailProvider !== "resend")
    throw new InitValidationError("Unknown email-provider: expected resend");
  if (cacheProvider !== null && cacheProvider !== "valkey")
    throw new InitValidationError("Unknown cache-provider: expected valkey");
  const selected = new Set(profiles.map(canonicalProfile));
  const choices: readonly [string, boolean, string][] = [
    ["payment-providers", paymentProviders.length > 0, "payments"],
    ["ai-providers", aiProviders.length > 0, "ai"],
    ["email-provider", emailProvider !== null, "notifications"],
    ["cache-provider", cacheProvider !== null, "cache"],
    ["observability-exporters", observabilityExporters.length > 0, "observability"],
  ];
  for (const [name, supplied, requiredProfile] of choices) {
    if (supplied && !selected.has(canonicalProfile(requiredProfile as Profile)))
      throw new InitValidationError(
        `--${name} is only valid when --profiles includes ${requiredProfile}`,
      );
  }
  return {
    paymentProviders,
    aiProviders,
    emailProvider: emailProvider as "resend" | null,
    cacheProvider: cacheProvider as "valkey" | null,
    observabilityExporters,
  };
}

function deployment(value: string): Deployment {
  if (value !== "dokploy" && value !== "railway")
    throw new InitValidationError("--deployment must be dokploy or railway");
  return value;
}

function mobileSettings(
  options: ReadonlyMap<string, string>,
  profiles: readonly Profile[],
): MobileSettings | null {
  const isMobile = profiles.includes("mobile");
  const keys = ["mobile-scheme", "ios-bundle-id", "android-application-id"];
  if (!isMobile) {
    const supplied = keys.find((key) => options.has(key));
    if (supplied)
      throw new InitValidationError(`--${supplied} is only valid when --profiles includes mobile`);
    return null;
  }
  const scheme = required(options, "mobile-scheme");
  const iosBundleId = required(options, "ios-bundle-id");
  const androidApplicationId = required(options, "android-application-id");
  if (!/^[a-z][a-z0-9+.-]*$/iu.test(scheme))
    throw new InitValidationError("Invalid mobile-scheme: expected a URI scheme");
  if (!/^[a-z][a-z0-9.-]*$/iu.test(iosBundleId) || !iosBundleId.includes("."))
    throw new InitValidationError("Invalid ios-bundle-id: expected a reverse-domain identifier");
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(androidApplicationId))
    throw new InitValidationError(
      "Invalid android-application-id: expected a lowercase reverse-domain identifier",
    );
  return { scheme, iosBundleId, androidApplicationId };
}

function requireProfiles(
  profiles: readonly Profile[],
  required: readonly Profile[],
  reason: string,
): void {
  const missing = required.filter((profile) => !profiles.includes(profile));
  if (missing.length > 0)
    throw new InitValidationError(`${reason}; missing: ${missing.join(", ")}`);
}

export function validateInitOptions(options: ReadonlyMap<string, string>): InitConfig {
  const productId = slug(required(options, "product-id"), "product-id");
  const clientId = slug(required(options, "client-id"), "client-id");
  const profiles = profileList(required(options, "profiles"));
  if (profiles.includes("identity"))
    requireProfiles(profiles, ["api", "data"], "identity requires api and data profiles");
  if (profiles.includes("jobs"))
    requireProfiles(
      profiles,
      ["data"],
      "jobs requires data; the worker app is generated automatically",
    );
  if (profiles.includes("external-api"))
    requireProfiles(profiles, ["api"], "external-api requires api");
  if (profiles.includes("ai"))
    requireProfiles(profiles, ["api", "data", "identity"], "ai requires api, data, and identity");
  if (profiles.includes("storage"))
    requireProfiles(
      profiles,
      ["api", "data", "identity"],
      "storage requires api, data, and identity",
    );
  if (
    profiles.includes("python") &&
    !profiles.some((profile) => profile === "api" || profile === "jobs")
  ) {
    throw new InitValidationError("python requires an api or jobs calling profile");
  }
  if (profiles.includes("durable-ai"))
    requireProfiles(profiles, ["ai", "jobs"], "durable-ai requires ai and jobs");
  if (profiles.includes("tenancy"))
    requireProfiles(
      profiles,
      ["identity", "api", "data"],
      "tenancy requires identity, api, and data",
    );
  if (profiles.includes("events"))
    requireProfiles(profiles, ["data", "jobs"], "events requires data and jobs");
  if (profiles.includes("agentic-ai"))
    requireProfiles(profiles, ["ai", "jobs", "events"], "agentic-ai requires ai, jobs, and events");
  if (profiles.includes("payments"))
    requireProfiles(
      profiles,
      ["api", "data", "jobs", "events", "external-api"],
      "payments requires api, data, jobs, events, and external-api",
    );
  if (profiles.includes("notifications"))
    requireProfiles(
      profiles,
      ["data", "jobs", "events"],
      "notifications requires data, jobs, and events",
    );
  if (profiles.includes("rate-limit"))
    requireProfiles(profiles, ["api", "cache"], "rate-limit requires api and cache");
  if (profiles.includes("search"))
    requireProfiles(profiles, ["data", "jobs", "events"], "search requires data, jobs, and events");
  if (profiles.includes("rag"))
    requireProfiles(
      profiles,
      ["ai", "search", "storage", "python", "jobs", "events"],
      "rag requires ai, search, storage, python, jobs, and events",
    );
  if (profiles.includes("feature-flags"))
    requireProfiles(profiles, ["api", "data"], "feature-flags requires api and data");
  const agentTemplate = options.get("agent-template")?.trim();
  const config: InitConfig = {
    productId,
    clientId,
    displayName: safeText(required(options, "display-name"), "display-name"),
    packageScope: packageScope(required(options, "package-scope")),
    profiles,
    deployment: deployment(required(options, "deployment")),
    technicalOwner: owner(required(options, "technical-owner"), "technical-owner"),
    operationsOwner: owner(required(options, "operations-owner"), "operations-owner"),
    outputDir: options.get("output-dir")?.trim() || `.thaarei/generated/${clientId}`,
    mobile: mobileSettings(options, profiles),
    providers: providers(options, profiles),
  };
  if (agentTemplate) return { ...config, agentTemplate };
  return config;
}
