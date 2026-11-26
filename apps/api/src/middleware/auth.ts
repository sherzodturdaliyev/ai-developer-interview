import type { Request, RequestHandler } from "express";
import { forbidden, unauthorized } from "../lib/errors.js";
import { asyncHandler } from "../lib/http.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import type { AuthContext, Role } from "../modules/auth/auth.types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(auth: AuthService): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    if (!token) throw unauthorized("MISSING_TOKEN", "Authentication required");
    req.auth = await auth.authenticate(token);
    next();
  });
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized("MISSING_TOKEN", "Authentication required"));
    if (!roles.includes(req.auth.role)) {
      return next(forbidden("INSUFFICIENT_ROLE", "You do not have permission for this action"));
    }
    next();
  };
}

/** For handlers mounted behind requireAuth. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized("MISSING_TOKEN", "Authentication required");
  return req.auth;
}
