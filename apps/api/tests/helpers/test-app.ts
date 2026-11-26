import type { Express } from "express";
import request from "supertest";
import { createApp, type AppConfig } from "../../src/app.js";
import { REFRESH_COOKIE } from "../../src/modules/auth/auth.routes.js";
import { MemoryAuthRepository } from "./memory-auth-repository.js";

export const testConfig: AppConfig = {
  webOrigin: "http://localhost:5173",
  secureCookies: false,
  jwtAccessSecret: "test-secret-that-is-at-least-32-characters-long",
  bcryptRounds: 4,
  authRateLimit: 10_000,
  trustProxy: 0,
};

export function buildTestApp(overrides: Partial<AppConfig> = {}, now?: () => Date) {
  const repo = new MemoryAuthRepository();
  const app = createApp({ authRepo: repo, config: { ...testConfig, ...overrides }, now });
  return { repo, app };
}

/** Returns "adi_refresh=<value>" from a response's Set-Cookie header, or undefined. */
export function refreshCookieFrom(res: request.Response): string | undefined {
  const raw: unknown = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : [];
  const cookie = list.find((c) => c.startsWith(`${REFRESH_COOKIE}=`) && !c.startsWith(`${REFRESH_COOKIE}=;`));
  return cookie?.split(";")[0];
}

export const owner = {
  companyName: "Acme Software",
  name: "Olivia Owner",
  email: "olivia@acme.test",
  password: "correct-horse-battery",
};

export async function registerOwner(app: Express) {
  const res = await request(app).post("/api/auth/register").send(owner);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.accessToken as string, cookie: refreshCookieFrom(res), body: res.body };
}
