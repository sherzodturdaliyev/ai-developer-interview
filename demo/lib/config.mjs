// Reads and validates configuration. The only module that touches process.env.

const PROVIDERS = ["gemini", "deepseek"];

const clean = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function int(name, raw, fallback, min, max) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function provider(name, raw, fallback) {
  const v = raw ?? fallback;
  if (v !== undefined && !PROVIDERS.includes(v)) {
    throw new Error(`${name} must be one of: ${PROVIDERS.join(", ")}`);
  }
  return v;
}

export function loadConfig(env = process.env) {
  const e = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, clean(v)]));
  const config = {
    port: int("PORT", e.PORT, 3000, 1, 65535),
    host: e.HOST ?? "127.0.0.1",
    timeoutMs: int("AI_REQUEST_TIMEOUT_MS", e.AI_REQUEST_TIMEOUT_MS, 30000, 1000, 300000),
    maxRetries: int("AI_MAX_RETRIES", e.AI_MAX_RETRIES, 2, 0, 5),
    interview: {
      primary: provider("AI_INTERVIEW_PROVIDER", e.AI_INTERVIEW_PROVIDER, "gemini"),
      fallback: provider("AI_INTERVIEW_FALLBACK_PROVIDER", e.AI_INTERVIEW_FALLBACK_PROVIDER, undefined),
    },
    evaluation: {
      primary: provider("AI_EVALUATION_PROVIDER", e.AI_EVALUATION_PROVIDER, "deepseek"),
      fallback: provider("AI_EVALUATION_FALLBACK_PROVIDER", e.AI_EVALUATION_FALLBACK_PROVIDER, "gemini"),
    },
    gemini: {
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      baseUrl: e.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
    },
    deepseek: {
      apiKey: e.DEEPSEEK_API_KEY,
      model: e.DEEPSEEK_MODEL,
      baseUrl: e.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    },
  };
  for (const job of ["interview", "evaluation"]) {
    if (config[job].fallback && config[job].fallback === config[job].primary) {
      config[job].fallback = undefined; // same provider twice adds nothing
    }
  }
  return config;
}

/** A provider is usable only when both its key and its model are set. */
export function missingSettings(config, name) {
  const p = config[name];
  const prefix = name.toUpperCase();
  const missing = [];
  if (!p.apiKey) missing.push(`${prefix}_API_KEY`);
  if (!p.model) missing.push(`${prefix}_MODEL`);
  return missing;
}
