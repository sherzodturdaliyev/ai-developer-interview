// Real HTTP integrations with Gemini and DeepSeek, plus a manager that applies the
// configured primary/fallback order. Uses only Node built-ins (global fetch).

import { missingSettings } from "./config.mjs";

export class AiError extends Error {
  /**
   * @param {string} code  e.g. AI_NOT_CONFIGURED, AI_TIMEOUT, AI_UPSTREAM_ERROR, AI_INVALID_OUTPUT
   * @param {boolean} retryable
   */
  constructor(code, message, { status, retryable = false, provider } = {}) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, headers, body, timeoutMs, provider) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new AiError("AI_TIMEOUT", `${provider} did not respond within ${timeoutMs} ms`, { retryable: true, provider });
    }
    throw new AiError("AI_NETWORK_ERROR", `Cannot reach ${provider}: ${err?.message ?? err}`, { retryable: true, provider });
  }
  const text = await res.text();
  if (!res.ok) {
    // Never echo request headers (they contain the key). The upstream message is safe to log.
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text)?.error?.message ?? detail;
    } catch {
      /* keep raw snippet */
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new AiError("AI_UPSTREAM_ERROR", `${provider} returned ${res.status}: ${detail}`, {
      status: res.status,
      retryable,
      provider,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("AI_UPSTREAM_ERROR", `${provider} returned a non-JSON response`, { provider });
  }
}

/** Extracts a JSON object from model text, tolerating ```json fences. */
export function parseModelJson(text, provider) {
  const trimmed = String(text ?? "").trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AiError("AI_INVALID_OUTPUT", `${provider} did not return valid JSON`, { provider });
  }
}

/**
 * Each provider implements generateJson({ system, messages, temperature }) where messages are
 * [{ role: "user" | "assistant", text }]. Returns { data, usage, model }.
 */
export function createGeminiProvider(cfg, timeoutMs) {
  return {
    name: "gemini",
    async generateJson({ system, messages, temperature = 0.4 }) {
      const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
        generationConfig: { temperature, responseMimeType: "application/json" },
      };
      const json = await postJson(url, { "x-goog-api-key": cfg.apiKey }, body, timeoutMs, "gemini");
      const candidate = json?.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) {
        const reason = candidate?.finishReason ?? json?.promptFeedback?.blockReason ?? "empty response";
        throw new AiError("AI_INVALID_OUTPUT", `gemini returned no text (${reason})`, { provider: "gemini", retryable: true });
      }
      const u = json.usageMetadata ?? {};
      return {
        data: parseModelJson(text, "gemini"),
        model: cfg.model,
        usage: { promptTokens: u.promptTokenCount, completionTokens: u.candidatesTokenCount, totalTokens: u.totalTokenCount },
      };
    },
  };
}

export function createDeepSeekProvider(cfg, timeoutMs) {
  return {
    name: "deepseek",
    async generateJson({ system, messages, temperature = 0.2 }) {
      const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const body = {
        model: cfg.model,
        temperature,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))],
      };
      const json = await postJson(url, { Authorization: `Bearer ${cfg.apiKey}` }, body, timeoutMs, "deepseek");
      const text = json?.choices?.[0]?.message?.content;
      if (!text) throw new AiError("AI_INVALID_OUTPUT", "deepseek returned no content", { provider: "deepseek", retryable: true });
      const u = json.usage ?? {};
      return {
        data: parseModelJson(text, "deepseek"),
        model: json.model ?? cfg.model,
        usage: { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens },
      };
    },
  };
}

/**
 * Runs a job on the primary provider, retrying transient errors with backoff, then on the
 * fallback provider if configured. Output is validated by `validate`; one invalid output
 * is retried with a correction message before moving on.
 */
export function createProviderManager(config, { log = () => {}, providers } = {}) {
  const all = providers ?? {
    gemini: createGeminiProvider(config.gemini, config.timeoutMs),
    deepseek: createDeepSeekProvider(config.deepseek, config.timeoutMs),
  };
  const isConfigured = (name) => (providers ? Boolean(all[name]) : missingSettings(config, name).length === 0);

  function chain(job) {
    const { primary, fallback } = config[job];
    return [primary, fallback].filter((n, i, arr) => n && arr.indexOf(n) === i);
  }

  async function attempt(provider, request, validate, task) {
    let lastError;
    let messages = request.messages;
    for (let i = 0; i <= config.maxRetries; i++) {
      const started = Date.now();
      try {
        const result = await provider.generateJson({ ...request, messages });
        const checked = validate(result.data);
        if (!checked.ok) {
          log({ event: "ai_request", task, provider: provider.name, model: result.model, ok: false, error: "AI_INVALID_OUTPUT", detail: checked.error, latencyMs: Date.now() - started, ...result.usage });
          lastError = new AiError("AI_INVALID_OUTPUT", `${provider.name} output failed validation: ${checked.error}`, { provider: provider.name, retryable: true });
          // Ask the model to fix its own output once, then treat as a normal retry.
          messages = [
            ...request.messages,
            { role: "assistant", text: JSON.stringify(result.data) },
            { role: "user", text: `Your previous JSON was invalid: ${checked.error}. Return corrected JSON only.` },
          ];
          continue;
        }
        log({ event: "ai_request", task, provider: provider.name, model: result.model, ok: true, attempt: i + 1, latencyMs: Date.now() - started, ...result.usage });
        return { data: checked.value, provider: provider.name, model: result.model, usage: result.usage };
      } catch (err) {
        lastError = err instanceof AiError ? err : new AiError("AI_UPSTREAM_ERROR", String(err?.message ?? err), { provider: provider.name });
        log({ event: "ai_request", task, provider: provider.name, ok: false, attempt: i + 1, error: lastError.code, detail: lastError.message, latencyMs: Date.now() - started });
        if (!lastError.retryable || i === config.maxRetries) break;
        await sleep(500 * 2 ** i);
      }
    }
    throw lastError;
  }

  return {
    /** Which providers would serve a job right now, and what is missing. */
    describe(job) {
      return chain(job).map((name) => ({
        name,
        configured: isConfigured(name),
        missing: providers ? [] : missingSettings(config, name),
      }));
    },

    async run(job, task, request, validate) {
      const names = chain(job).filter(isConfigured);
      if (names.length === 0) {
        const needed = chain(job).flatMap((n) => missingSettings(config, n));
        throw new AiError(
          "AI_NOT_CONFIGURED",
          `No AI provider is configured for ${job}. Set ${needed.join(" and/or ")} in demo/.env.`,
        );
      }
      let lastError;
      for (const [index, name] of names.entries()) {
        try {
          const result = await attempt(all[name], request, validate, task);
          return { ...result, fallbackFrom: index > 0 ? names[0] : undefined };
        } catch (err) {
          lastError = err;
          if (index < names.length - 1) log({ event: "ai_fallback", task, from: name, to: names[index + 1], reason: err.code });
        }
      }
      throw lastError;
    },
  };
}
