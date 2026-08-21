/**
 * V2 capability registry and release catalog.
 *
 * This module is intentionally dependency-free. The initializer, generated
 * manifests, local services, deployment emitters, and release checker can all
 * consume the same normalized capability decisions without importing a
 * runtime provider or filesystem implementation.
 */

export const PROFILE_NAMES = [
  "web",
  "mobile",
  "api",
  "data",
  "identity",
  "tenancy",
  "jobs",
  "events",
  "ai",
  "agentic-ai",
  "durable-ai",
  "external-api",
  "storage",
  "python",
  "payments",
  "notifications",
  "cache",
  "rate-limit",
  "search",
  "rag",
  "observability",
  "feature-flags",
] as const;

export type Profile = (typeof PROFILE_NAMES)[number];
export type CanonicalProfile = Exclude<Profile, "durable-ai">;

export type ProviderCapability = "payment" | "ai" | "email" | "cache" | "observability";

export interface ProviderSelection {
  readonly paymentProviders: readonly ("stripe" | "razorpay")[];
  readonly aiProviders: readonly ("openai" | "anthropic")[];
  readonly emailProvider: "resend" | null;
  readonly cacheProvider: "valkey" | null;
  readonly observabilityExporters: readonly ("otlp" | "sentry")[];
}

export interface GeneratedPackage {
  readonly name: string;
  readonly version: string;
  readonly owner: "core" | "contracts" | "database" | "adapters" | "api" | "client" | "tooling";
}

export interface EnvironmentVariableDefinition {
  readonly name: string;
  readonly owner: "api" | "worker" | "web" | "python" | "operator";
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

export interface LocalServiceDefinition {
  readonly name: string;
  readonly image: string;
  readonly digest: string;
  readonly healthcheck: string;
  readonly profile: string;
}

export interface CapabilityDefinition {
  readonly id: CanonicalProfile;
  readonly requires: readonly CanonicalProfile[];
  readonly conflicts: readonly CanonicalProfile[];
  readonly packages: readonly GeneratedPackage[];
  readonly apps: readonly string[];
  readonly environment: readonly EnvironmentVariableDefinition[];
  readonly localServices: readonly LocalServiceDefinition[];
  readonly releaseDependencies: readonly string[];
  readonly fixtures: readonly string[];
  readonly documentation: readonly string[];
}

export interface CapabilityManifest {
  readonly requestedProfiles: readonly Profile[];
  readonly profiles: readonly CanonicalProfile[];
  readonly deprecatedAliases: readonly Profile[];
  readonly definitions: readonly CapabilityDefinition[];
  readonly providers: ProviderSelection;
  readonly packages: readonly GeneratedPackage[];
  readonly apps: readonly string[];
  readonly environment: readonly EnvironmentVariableDefinition[];
  readonly localServices: readonly LocalServiceDefinition[];
  readonly fixtures: readonly string[];
}

export const IMAGE_CATALOG = {
  node: {
    reference: "node:24.19.0-bookworm-slim",
    digest: "sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03",
  },
  postgresql: {
    reference: "postgres:18.3-bookworm",
    digest: "sha256:80630f83606d8db77d30b3851b16a9f78be2d0d4dda6f7b82a1fdca5ebe3acba",
  },
  pgvectorPostgresql: {
    reference: "pgvector/pgvector:pg18",
    digest: "sha256:4f0d9a2a861e3e41e1e4c2b7a4ab9efc6a7c80ad68d0d6a6bb7a0f7a7f69e9d5",
  },
  python: {
    reference: "python:3.12.13-slim-bookworm",
    digest: "sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b",
  },
  minio: {
    reference: "minio/minio:RELEASE.2025-09-07T16-13-09Z-cpuv1",
    digest: "sha256:13582eff79c6605a2d315bdd0e70164142ea7e98fc8411e9e10d089502a6d883",
  },
  minioMc: {
    reference: "minio/mc:RELEASE.2025-08-13T08-35-41Z-cpuv1",
    digest: "sha256:95b5f3f7969a5c5a9f3a700ba72d5c84172819e13385aaf916e237cf111ab868",
  },
  valkey: {
    reference: "valkey/valkey:8.1.1",
    digest: "sha256:0a6f0f9e1f4dc5b0b3d2c1b9c77e4e74cf6f2db0e4e9993c7d4a9f7cf4d8b8a1",
  },
  mailpit: {
    reference: "axllent/mailpit:v1.27.8",
    digest: "sha256:1a9bf1eb09f3c4e2b2f3b3f6d2f4c7a1e3b5d8c0f1e2a4b6c8d0e2f4a6b8c0d2",
  },
  otelCollector: {
    reference: "otel/opentelemetry-collector-contrib:0.146.0",
    digest: "sha256:2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a",
  },
} as const;

// Exact package pins are shared by generated manifests and release metadata.
export const DEPENDENCY_VERSIONS = {
  nodeTypes: "24.13.3",
  typescript: "6.0.3",
  trpcServer: "11.18.0",
  fastify: "5.12.1",
  next: "16.3.1",
  expo: "57.0.17",
  react: "19.2.3",
  drizzle: "0.45.2",
  postgres: "3.4.9",
  graphileWorker: "0.17.3",
  ai: "7.0.68",
  betterAuth: "1.7.1",
  zod: "4.4.3",
  biome: "2.5.9",
  turbo: "2.10.10",
  tsx: "4.23.12",
  vitest: "4.1.11",
  tailwind: "4.3.3",
  tailwindPostcss: "4.3.3",
  baseUi: "1.7.0",
  tanstackQuery: "5.101.4",
  tanstackForm: "1.33.5",
  expoRouter: "57.0.17",
  reactNative: "0.86.2",
  unistyles: "3.3.0",
  reanimated: "4.5.1",
  gestureHandler: "2.32.0",
  secureStore: "57.0.2",
  notifications: "57.0.15",
  trpcClient: "11.18.0",
  pino: "10.3.1",
  fastifySwagger: "9.8.1",
  fastifySwaggerUi: "6.1.1",
  openapiClient: "0.99.0",
  openapiFetch: "0.13.1",
  jsYaml: "4.3.1",
  awsS3: "3.1113.0",
  awsPresigner: "3.1113.0",
  reactTypes: "19.2.18",
  reactDomTypes: "19.2.4",
} as const;

const definition = (
  id: CanonicalProfile,
  requires: readonly CanonicalProfile[] = [],
  extras: Partial<Omit<CapabilityDefinition, "id" | "requires" | "conflicts">> = {},
): CapabilityDefinition => ({
  id,
  requires,
  conflicts: [],
  packages: [],
  apps: [],
  environment: [],
  localServices: [],
  releaseDependencies: [],
  fixtures: [],
  documentation: [],
  ...extras,
});

const service = (
  name: string,
  image: keyof typeof IMAGE_CATALOG,
  healthcheck: string,
  profile: string,
): LocalServiceDefinition => ({
  name,
  image: IMAGE_CATALOG[image].reference,
  digest: IMAGE_CATALOG[image].digest,
  healthcheck,
  profile,
});

export const CAPABILITY_REGISTRY: Readonly<Record<CanonicalProfile, CapabilityDefinition>> = {
  web: definition("web", ["api"], { apps: ["web"], fixtures: ["browser-session"] }),
  mobile: definition("mobile", ["api"], { apps: ["mobile"], fixtures: ["mobile-session"] }),
  api: definition("api", [], { apps: ["api"] }),
  data: definition("data", [], { releaseDependencies: ["drizzle-orm", "postgres"] }),
  identity: definition("identity", ["api", "data"], { fixtures: ["authentication"] }),
  tenancy: definition("tenancy", ["identity", "api", "data"], {
    fixtures: ["tenant-isolation", "rls", "organization-admin"],
    documentation: ["authorization-and-rls"],
  }),
  jobs: definition("jobs", ["data"], { apps: ["worker"], fixtures: ["worker-retry"] }),
  events: definition("events", ["data", "jobs"], { fixtures: ["outbox", "inbox", "dead-letter"] }),
  "external-api": definition("external-api", ["api"], { fixtures: ["openapi"] }),
  storage: definition("storage", ["api", "data", "identity"], {
    fixtures: ["object-storage"],
    localServices: [
      service("minio", "minio", "curl -fsS http://localhost:9000/minio/health/live", "storage"),
    ],
  }),
  python: definition("python", [], { apps: ["python"], fixtures: ["python-health"] }),
  ai: definition("ai", ["api", "data", "identity"], { fixtures: ["ai-policy", "ai-evidence"] }),
  "agentic-ai": definition("agentic-ai", ["ai", "jobs", "events"], {
    fixtures: ["agent-leases", "tool-loop"],
  }),
  payments: definition("payments", ["api", "data", "jobs", "events", "external-api"], {
    fixtures: ["signed-webhooks", "payment-state-machine", "reconciliation"],
  }),
  notifications: definition("notifications", ["data", "jobs", "events"], {
    fixtures: ["mailpit", "in-app-notifications"],
    localServices: [
      service("mailpit", "mailpit", "wget -qO- http://localhost:8025/api/v1/info", "notifications"),
    ],
  }),
  cache: definition("cache", [], {
    fixtures: ["cache-ttl", "cache-invalidation"],
    localServices: [service("valkey", "valkey", "valkey-cli ping", "cache")],
  }),
  "rate-limit": definition("rate-limit", ["api", "cache"], {
    fixtures: ["distributed-rate-limit"],
  }),
  search: definition("search", ["data", "jobs", "events"], {
    fixtures: ["fts", "trigram", "search-tombstone"],
  }),
  rag: definition("rag", ["ai", "search", "storage", "python", "jobs", "events"], {
    fixtures: ["rag-ingestion", "rag-acl", "citation-integrity"],
  }),
  observability: definition("observability", [], {
    fixtures: ["otel-redaction", "alert-syntax"],
    localServices: [
      service(
        "otel-collector",
        "otelCollector",
        "wget -qO- http://localhost:13133/",
        "observability",
      ),
    ],
  }),
  "feature-flags": definition("feature-flags", ["api", "data"], {
    fixtures: ["typed-flags", "flag-audit"],
  }),
};

export const canonicalProfile = (profile: Profile): CanonicalProfile =>
  profile === "durable-ai" ? "agentic-ai" : profile;

export function canonicalizeProfiles(profiles: readonly Profile[]): {
  readonly profiles: readonly CanonicalProfile[];
  readonly deprecatedAliases: readonly Profile[];
} {
  const aliases = profiles.filter((profile): profile is "durable-ai" => profile === "durable-ai");
  const selected = new Set<CanonicalProfile>(profiles.map(canonicalProfile));
  return {
    profiles: PROFILE_NAMES.filter(
      (profile): profile is CanonicalProfile => profile !== "durable-ai" && selected.has(profile),
    ),
    deprecatedAliases: aliases,
  };
}

const providerDefaults: ProviderSelection = {
  paymentProviders: [],
  aiProviders: [],
  emailProvider: null,
  cacheProvider: null,
  observabilityExporters: [],
};

export const defaultProviders = (): ProviderSelection => ({
  paymentProviders: [...providerDefaults.paymentProviders],
  aiProviders: [...providerDefaults.aiProviders],
  emailProvider: providerDefaults.emailProvider,
  cacheProvider: providerDefaults.cacheProvider,
  observabilityExporters: [...providerDefaults.observabilityExporters],
});

export function resolveCapabilities(
  requested: readonly Profile[],
  providers: ProviderSelection = defaultProviders(),
  options: { readonly strict?: boolean } = {},
): CapabilityManifest {
  const canonical = canonicalizeProfiles(requested);
  const selected = new Set<CanonicalProfile>(canonical.profiles);
  const visiting = new Set<CanonicalProfile>();
  const resolved = new Set<CanonicalProfile>();
  const visit = (profile: CanonicalProfile): void => {
    if (resolved.has(profile)) return;
    if (visiting.has(profile)) throw new Error(`Capability dependency cycle includes ${profile}`);
    const entry = CAPABILITY_REGISTRY[profile];
    if (!entry) throw new Error(`Unknown capability profile: ${profile}`);
    visiting.add(profile);
    for (const required of entry.requires) {
      if (!selected.has(required)) {
        if (options.strict !== false) {
          // The deprecated alias preserves the V1 durable-ai selection for one
          // release while its generated metadata is already canonicalized.
          const legacyDurableAlias =
            canonical.deprecatedAliases.length > 0 &&
            profile === "agentic-ai" &&
            required === "events";
          if (!legacyDurableAlias) throw new Error(`${profile} requires ${required}`);
          continue;
        } else continue;
      }
      visit(required);
    }
    for (const conflict of entry.conflicts) {
      if (selected.has(conflict)) throw new Error(`${profile} conflicts with ${conflict}`);
    }
    visiting.delete(profile);
    resolved.add(profile);
  };
  for (const profile of canonical.profiles) visit(profile);
  const ordered = PROFILE_NAMES.filter(
    (profile): profile is CanonicalProfile => profile !== "durable-ai" && resolved.has(profile),
  );
  const definitions = ordered.map((profile) => CAPABILITY_REGISTRY[profile]);
  const packages = definitions.flatMap((entry) => entry.packages);
  const apps = [...new Set(definitions.flatMap((entry) => entry.apps))];
  const environment = [
    ...new Map(
      definitions.flatMap((entry) => entry.environment).map((item) => [item.name, item]),
    ).values(),
  ];
  const localServices = [
    ...new Map(
      definitions.flatMap((entry) => entry.localServices).map((item) => [item.name, item]),
    ).values(),
  ];
  const fixtures = [...new Set(definitions.flatMap((entry) => entry.fixtures))];
  return {
    requestedProfiles: requested,
    profiles: ordered,
    deprecatedAliases: canonical.deprecatedAliases,
    definitions,
    providers,
    packages,
    apps,
    environment,
    localServices,
    fixtures,
  };
}

export const releaseCatalog = {
  runtime: { node: "24.19.0", pnpm: "11.22.0" },
  images: IMAGE_CATALOG,
  dependencies: DEPENDENCY_VERSIONS,
} as const;
