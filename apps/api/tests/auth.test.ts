import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, owner, refreshCookieFrom, registerOwner } from "./helpers/test-app.js";

describe("auth: register", () => {
  it("creates a company and owner, returns an access token and sets an httpOnly refresh cookie", async () => {
    const { app, repo } = buildTestApp();
    const res = await request(app).post("/api/auth/register").send(owner);

    expect(res.status).toBe(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.user).toMatchObject({ email: owner.email, role: "OWNER", name: owner.name });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.company).toMatchObject({ name: owner.companyName, slug: "acme-software" });

    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api/auth");

    const stored = [...repo.users.values()][0];
    expect(stored?.passwordHash).not.toBe(owner.password);
    // Refresh tokens are stored hashed, never raw.
    const rawToken = refreshCookieFrom(res)?.split("=")[1];
    const storedTokens = [...repo.refreshTokens.values()].map((t) => t.tokenHash);
    expect(storedTokens).not.toContain(rawToken);
  });

  it("normalizes email case and rejects duplicates with 409", async () => {
    const { app } = buildTestApp();
    await registerOwner(app);
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...owner, companyName: "Other Co", email: "  OLIVIA@acme.test " });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("gives a second company with the same name a distinct slug", async () => {
    const { app } = buildTestApp();
    await registerOwner(app);
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...owner, email: "second@acme.test" });
    expect(res.status).toBe(201);
    expect(res.body.company.slug).toMatch(/^acme-software-[0-9a-f]{6}$/);
  });

  it("returns 400 with field details for invalid input", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ companyName: "A", name: "", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["companyName", "name", "email", "password"]));
  });

  it("returns 400 for malformed JSON", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("auth: login and me", () => {
  it("logs in with correct credentials and /me returns the user", async () => {
    const { app } = buildTestApp();
    await registerOwner(app);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: owner.email, password: owner.password });
    expect(login.status).toBe(200);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: owner.email, role: "OWNER" });
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const { app } = buildTestApp();
    await registerOwner(app);
    const wrong = await request(app).post("/api/auth/login").send({ email: owner.email, password: "wrong-password" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@acme.test", password: owner.password });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("rejects /me without a token, with a garbage token, and with a token signed by another secret", async () => {
    const { app } = buildTestApp();
    const { app: otherApp } = buildTestApp({ jwtAccessSecret: "another-secret-that-is-also-32-chars-long" });
    const { accessToken: foreignToken } = await registerOwner(otherApp);
    await registerOwner(app);

    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer abc.def.ghi")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${foreignToken}`)).status).toBe(401);
  });
});

describe("auth: refresh rotation", () => {
  it("issues a new refresh token and invalidates the old one", async () => {
    const { app } = buildTestApp();
    const { cookie } = await registerOwner(app);

    const first = await request(app).post("/api/auth/refresh").set("Cookie", cookie!);
    expect(first.status).toBe(200);
    const rotated = refreshCookieFrom(first);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(cookie);

    const second = await request(app).post("/api/auth/refresh").set("Cookie", rotated!);
    expect(second.status).toBe(200);
  });

  it("treats reuse of a rotated token as theft and revokes every session of that user", async () => {
    const { app } = buildTestApp();
    const { cookie: original } = await registerOwner(app);

    const rotated = refreshCookieFrom(await request(app).post("/api/auth/refresh").set("Cookie", original!));

    const reuse = await request(app).post("/api/auth/refresh").set("Cookie", original!);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("REFRESH_TOKEN_REUSED");

    // The legitimately rotated token is now revoked too.
    const afterReuse = await request(app).post("/api/auth/refresh").set("Cookie", rotated!);
    expect(afterReuse.status).toBe(401);
  });

  it("rejects an expired refresh token", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { app } = buildTestApp({}, () => now);
    const { cookie } = await registerOwner(app);

    now = new Date("2026-03-01T00:00:00Z"); // past the 30-day lifetime
    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookie!);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("returns 401 without a cookie", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_REFRESH_TOKEN");
  });
});

describe("auth: logout", () => {
  it("revokes the refresh token", async () => {
    const { app } = buildTestApp();
    const { cookie } = await registerOwner(app);

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie!);
    expect(out.status).toBe(204);

    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", cookie!);
    expect(refresh.status).toBe(401);
  });
});

describe("app", () => {
  it("serves /api/health and a JSON 404 for unknown routes", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok" });
    const missing = await request(app).get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rate-limits auth endpoints", async () => {
    const { app } = buildTestApp({ authRateLimit: 2 });
    const send = () => request(app).post("/api/auth/login").send({ email: owner.email, password: "x" });
    await send();
    await send();
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});
