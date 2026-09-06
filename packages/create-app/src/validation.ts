import {
  type Deployment,
  type InitConfig,
  type MobileSettings,
  PRESETS,
  PROFILE_NAMES,
  type Preset,
  type Profile,
  type ProviderSelection,
} from "./generator.js";
import { canonicalProfile, resolveCapabilities } from "./capabilities.js";

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
    if (value === "durable-ai")
      throw new InitValidationError("durable-ai was removed in Starter 1.0; use agentic-ai");
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
  const identityMailProvider =
    options.get("identity-mail-provider")?.trim() ||
    (profiles.includes("identity") ? "resend" : null);
  const notificationProvider = options.get("notification-provider")?.trim() || null;
  const cacheProvider = options.get("cache-provider")?.trim() || null;
  if (identityMailProvider !== null && identityMailProvider !== "resend")
    throw new InitValidationError("Unknown identity-mail-provider: expected resend");
  if (notificationProvider !== null && notificationProvider !== "resend")
    throw new InitValidationError("Unknown notification-provider: expected resend");
  if (cacheProvider !== null && cacheProvider !== "valkey")
    throw new InitValidationError("Unknown cache-provider: expected valkey");
  const selected = new Set(profiles.map(canonicalProfile));
  const choices: readonly [string, boolean, string][] = [
    ["payment-providers", paymentProviders.length > 0, "payments"],
    ["ai-providers", aiProviders.length > 0, "ai"],
    ["identity-mail-provider", identityMailProvider !== null, "identity"],
    ["notification-provider", notificationProvider !== null, "notifications"],
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
    identityMailProvider: identityMailProvider as "resend" | null,
    notificationProvider: notificationProvider as "resend" | null,
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

export function validateInitOptions(options: ReadonlyMap<string, string>): InitConfig {
  const productId = slug(required(options, "product-id"), "product-id");
  const clientId = slug(required(options, "client-id"), "client-id");
  const rawPreset = options.get("preset")?.trim();
  const rawProfiles = options.get("profiles")?.trim();
  if ((rawPreset === undefined) === (rawProfiles === undefined))
    throw new InitValidationError("Provide exactly one of --preset or --profiles");
  let preset: Preset | null = null;
  let requestedProfiles: Profile[];
  if (rawPreset !== undefined) {
    if (!(rawPreset in PRESETS))
      throw new InitValidationError(
        `Unknown preset: ${rawPreset}. Supported presets: ${Object.keys(PRESETS).join(", ")}`,
      );
    preset = rawPreset as Preset;
    const selected = new Set<Profile>(PRESETS[preset]);
    const additions = options.has("add-profile")
      ? profileList(options.get("add-profile") ?? "")
      : [];
    for (const profile of additions) selected.add(profile);
    const removed = options.get("remove-profile")
      ? profileList(options.get("remove-profile") ?? "")
      : [];
    for (const profile of removed) selected.delete(profile);
    requestedProfiles = PROFILE_NAMES.filter((profile) => selected.has(profile));
    const resolvedAfterRemoval = resolveCapabilities(requestedProfiles).profiles;
    const requiredAgain = removed.find((profile) =>
      resolvedAfterRemoval.includes(canonicalProfile(profile)),
    );
    if (requiredAgain)
      throw new InitValidationError(
        `Cannot remove ${requiredAgain}: it is required by a selected profile`,
      );
  } else {
    if (options.has("add-profile") || options.has("remove-profile"))
      throw new InitValidationError("--add-profile and --remove-profile require --preset");
    requestedProfiles = profileList(rawProfiles ?? "");
  }
  const preliminary = resolveCapabilities(requestedProfiles).profiles;
  const profiles = [...preliminary] as Profile[];
  if (
    profiles.includes("python") &&
    !profiles.some((profile) => profile === "api" || profile === "jobs")
  ) {
    throw new InitValidationError("python requires an api or jobs calling profile");
  }
  const selectedProviders = providers(options, profiles);
  if (profiles.includes("rag") && !selectedProviders.aiProviders.includes("openai"))
    throw new InitValidationError(
      "rag requires --ai-providers to include openai for embedding.default",
    );
  const experimental = resolveCapabilities(profiles, selectedProviders).definitions.filter(
    (definition) => definition.sourceMaturity === "experimental",
  );
  if (experimental.length > 0 && !options.has("allow-experimental"))
    throw new InitValidationError(
      `Experimental profiles require --allow-experimental: ${experimental.map((item) => item.id).join(", ")}`,
    );
  const selectedDeployment = deployment(required(options, "deployment"));
  if (selectedDeployment === "railway" && !options.has("allow-beta-target"))
    throw new InitValidationError("Railway is beta and requires --allow-beta-target");
  const topology = options.get("topology")?.trim() || "standard";
  if (topology !== "standard" && topology !== "hardened")
    throw new InitValidationError("--topology must be standard or hardened");
  const githubRepository = options.get("github-repo")?.trim() || null;
  const createRemote = options.has("create-remote");
  if ((githubRepository !== null) !== createRemote)
    throw new InitValidationError("--github-repo and --create-remote must be supplied together");
  if (githubRepository !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(githubRepository))
    throw new InitValidationError("--github-repo must use organization/name");
  const agentTemplate = options.get("agent-template")?.trim();
  const config: InitConfig = {
    productId,
    clientId,
    displayName: safeText(required(options, "display-name"), "display-name"),
    packageScope: packageScope(required(options, "package-scope")),
    profiles,
    requestedProfiles,
    preset,
    deployment: selectedDeployment,
    technicalOwner: owner(required(options, "technical-owner"), "technical-owner"),
    operationsOwner: owner(required(options, "operations-owner"), "operations-owner"),
    outputDir: options.get("output-dir")?.trim() || `.thaarei/generated/${clientId}`,
    mobile: mobileSettings(options, profiles),
    providers: selectedProviders,
    allowExperimental: options.has("allow-experimental"),
    allowBetaTarget: options.has("allow-beta-target"),
    topology,
    githubRepository,
    createRemote,
  };
  if (agentTemplate) return { ...config, agentTemplate };
  return config;
}
