import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "x".repeat(32),
};

describe("loadEnv", () => {
  it("applies defaults and treats empty strings as unset", () => {
    const env = loadEnv({ ...base, PORT: "", GEMINI_API_KEY: "", AI_INTERVIEW_FALLBACK_PROVIDER: "" });
    expect(env.PORT).toBe(4000);
    expect(env.AI_INTERVIEW_PROVIDER).toBe("gemini");
    expect(env.AI_EVALUATION_PROVIDER).toBe("deepseek");
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.AI_INTERVIEW_FALLBACK_PROVIDER).toBeUndefined();
    expect(env.DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
  });

  it("reports every missing or invalid variable by name", () => {
    expect(() => loadEnv({ JWT_ACCESS_SECRET: "short", PORT: "abc" })).toThrowError(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET|JWT_ACCESS_SECRET[\s\S]*DATABASE_URL/,
    );
  });

  it("rejects a fallback provider equal to the primary", () => {
    expect(() =>
      loadEnv({ ...base, AI_INTERVIEW_PROVIDER: "gemini", AI_INTERVIEW_FALLBACK_PROVIDER: "gemini" }),
    ).toThrowError(/AI_INTERVIEW_FALLBACK_PROVIDER: must differ from AI_INTERVIEW_PROVIDER/);
  });

  it("rejects unknown provider names", () => {
    expect(() => loadEnv({ ...base, AI_EVALUATION_PROVIDER: "openai" })).toThrowError(/AI_EVALUATION_PROVIDER/);
  });

  it("accepts a different fallback provider", () => {
    const env = loadEnv({ ...base, AI_EVALUATION_FALLBACK_PROVIDER: "gemini" });
    expect(env.AI_EVALUATION_FALLBACK_PROVIDER).toBe("gemini");
  });
});
