import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, parseInput } from "../../lib/http.js";
import { getAuth, requireAuth } from "../../middleware/auth.js";
import type { AuthService, Session } from "./auth.service.js";

export const REFRESH_COOKIE = "adi_refresh";
const REFRESH_COOKIE_PATH = "/api/auth";

export const emailSchema = z.string().trim().email().max(254);
// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than truncated.
export const newPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be at most 72 characters");

const registerBody = z.object({
  companyName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: newPasswordSchema,
});

const loginBody = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export interface CookieSettings {
  secure: boolean;
}

export function setSessionCookie(res: Response, session: Session, cookie: CookieSettings): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: session.refreshExpiresAt,
  });
}

/** The refresh token is only ever sent as an httpOnly cookie, never in the JSON body. */
export const sessionBody = (s: Session) => ({ accessToken: s.accessToken, user: s.user, company: s.company });

const readRefreshCookie = (cookies: unknown): string | undefined => {
  if (typeof cookies !== "object" || cookies === null) return undefined;
  const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export function authRouter(auth: AuthService, cookie: CookieSettings): Router {
  const router = Router();

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const body = parseInput(registerBody, req.body);
      const session = await auth.register(body);
      setSessionCookie(res, session, cookie);
      res.status(201).json(sessionBody(session));
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const body = parseInput(loginBody, req.body);
      const session = await auth.login(body.email, body.password);
      setSessionCookie(res, session, cookie);
      res.json(sessionBody(session));
    }),
  );

  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      try {
        const session = await auth.refresh(readRefreshCookie(req.cookies));
        setSessionCookie(res, session, cookie);
        res.json(sessionBody(session));
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        throw err;
      }
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      await auth.logout(readRefreshCookie(req.cookies));
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    requireAuth(auth),
    asyncHandler(async (req, res) => {
      res.json({ user: getAuth(req) });
    }),
  );

  return router;
}
