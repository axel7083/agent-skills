import { z } from "zod";

const Secret = z.string().min(16, "looks too short to be a real credential");
const Id = z.coerce.number().int().positive();

/** Every environment variable the server reads. */
const RawEnv = z.object({
  NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  /** Public base URL of the server; also the audience GitHub OIDC tokens must carry. */
  PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "expected a postgres:// URL"),

  /** The repository whose bench workflow may call us: its slug, and immutable ids pinned in the OIDC check. */
  GITHUB_REPOSITORY: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  GITHUB_REPOSITORY_ID: Id,
  GITHUB_OWNER_ID: Id,
  BENCH_WORKFLOW: z.string().regex(/^[a-z0-9-]+\.ya?ml$/).default("bench.yml"),
  /** Require main to be a protected branch (OIDC `ref_protected`). */
  REQUIRE_PROTECTED_REF: z.stringbool().default(true),
  /** GitHub user ids allowed to dispatch a benchmark, comma-separated. */
  ALLOWED_ACTOR_IDS: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((value) => new Set(value.split(",").map(Number))),

  /** Bifrost's admin API, cluster-internal; its credentials never leave the server. */
  BIFROST_ADMIN_URL: z.url(),
  BIFROST_ADMIN_USERNAME: z.string().min(1),
  BIFROST_ADMIN_PASSWORD: Secret,
  /** What runners reach: the edge in front of Bifrost's inference paths. */
  BIFROST_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  /** The provider holding the upstream key, declared in Bifrost's config. */
  BIFROST_PROVIDER: z.string().regex(/^[a-z0-9-]+$/).default("enmaas"),
  /** USD per token for every model a run may use: a model without a price is refused. */
  PRICES_FILE: z.string().min(1).default("/etc/bench/prices.json"),

  /** The server's cap on one run, whatever the run asks for. */
  MAX_RUN_USD: z.coerce.number().positive().default(50),
  /** Rolling 24 h cap over every run. */
  DAILY_USD: z.coerce.number().positive().default(100),
  MAX_SHARDS: z.coerce.number().int().positive().default(240),
  KEY_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /** Bifrost counts spend shortly after a request ends: usage is read this long after a key is disabled. */
  USAGE_LAG_MS: z.coerce.number().int().nonnegative().default(15_000),
  /** A run still running after this many hours is abandoned, and its keys settled. */
  RUN_TTL_HOURS: z.coerce.number().positive().default(12),
});

export type AppEnv = z.output<typeof RawEnv>;

export const APP_ENV = Symbol("APP_ENV");

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const parsed = RawEnv.safeParse(source);
  if (!parsed.success) {
    // Names and reasons only: a value may be a credential.
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`invalid configuration: ${problems.join("; ")}`);
  }
  return parsed.data;
}
