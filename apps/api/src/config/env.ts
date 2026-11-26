import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// The only module that reads process.env. Everything else receives typed config.

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Treat empty strings ("KEY=") the same as an unset variable. */
const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToUndefined, schema);

export const AI_PROVIDERS = ["gemini", "deepseek"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];
const provider = z.enum(AI_PROVIDERS);

export const envSchema = z
  .object({
    NODE_ENV: opt(z.enum(["development", "test", "production"]).default("development")),
    PORT: opt(z.coerce.number().int().min(1).max(65535).default(4000)),
    WEB_ORIGIN: opt(z.string().url().default("http://localhost:5173")),
    DATABASE_URL: opt(z.string({ required_error: "DATABASE_URL is required" }).min(1)),
    JWT_ACCESS_SECRET: opt(
      z
        .string({ required_error: "JWT_ACCESS_SECRET is required" })
        .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    ),
    BCRYPT_ROUNDS: opt(z.coerce.number().int().min(4).max(15).default(12)),
    AUTH_RATE_LIMIT: opt(z.coerce.number().int().min(1).default(50)),
    TRUST_PROXY: opt(z.coerce.number().int().min(0).max(10).default(0)),
    // Defaults to true in production. Set "false" only for local testing over plain http.
    COOKIE_SECURE: opt(
      z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional(),
    ),
    LOG_LEVEL: opt(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    ),

    AI_INTERVIEW_PROVIDER: opt(provider.default("gemini")),
    AI_INTERVIEW_FALLBACK_PROVIDER: opt(provider.optional()),
    AI_EVALUATION_PROVIDER: opt(provider.default("deepseek")),
    AI_EVALUATION_FALLBACK_PROVIDER: opt(provider.optional()),
    AI_REQUEST_TIMEOUT_MS: opt(z.coerce.number().int().min(1000).max(300_000).default(30_000)),
    AI_MAX_RETRIES: opt(z.coerce.number().int().min(0).max(5).default(2)),

    GEMINI_API_KEY: opt(z.string().trim().optional()),
    GEMINI_MODEL: opt(z.string().trim().optional()),
    GEMINI_LIVE_MODEL: opt(z.string().trim().optional()),
    DEEPSEEK_API_KEY: opt(z.string().trim().optional()),
    DEEPSEEK_MODEL: opt(z.string().trim().optional()),
    DEEPSEEK_BASE_URL: opt(z.string().url().default("https://api.deepseek.com")),

    ELEVENLABS_API_KEY: opt(z.string().trim().optional()),
    ELEVENLABS_VOICE_ID: opt(z.string().trim().optional()),
    DEEPGRAM_API_KEY: opt(z.string().trim().optional()),
  })
  .superRefine((env, ctx) => {
    const pairs = [
      ["AI_INTERVIEW_PROVIDER", "AI_INTERVIEW_FALLBACK_PROVIDER"],
      ["AI_EVALUATION_PROVIDER", "AI_EVALUATION_FALLBACK_PROVIDER"],
    ] as const;
    for (const [primaryKey, fallbackKey] of pairs) {
      if (env[fallbackKey] && env[fallbackKey] === env[primaryKey]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [fallbackKey],
          message: `must differ from ${primaryKey}`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Loads apps/api/.env (outside tests) and validates it once. */
export function getEnv(): Env {
  if (!cached) {
    if (process.env.NODE_ENV !== "test") loadDotenv();
    cached = loadEnv();
  }
  return cached;
}
