import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { AppError, notFound } from "./lib/errors.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import type { AuthRepository } from "./modules/auth/auth.types.js";
import { invitationsRouter, teamRouter } from "./modules/team/team.routes.js";
import { TeamService } from "./modules/team/team.service.js";

export interface AppConfig {
  webOrigin: string;
  secureCookies: boolean;
  jwtAccessSecret: string;
  bcryptRounds: number;
  /** Max auth requests per client IP per 15 minutes. */
  authRateLimit: number;
  /** Express "trust proxy" hop count. 0 when not behind a proxy. */
  trustProxy: number;
}

export interface AppDeps {
  authRepo: AuthRepository;
  config: AppConfig;
  now?: () => Date;
}

export function createApp({ authRepo, config, now }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  const authService = new AuthService(
    authRepo,
    { jwtAccessSecret: config.jwtAccessSecret, bcryptRounds: config.bcryptRounds },
    now,
  );
  const teamService = new TeamService(authRepo, authService, { webOrigin: config.webOrigin }, now);
  const cookie = { secure: config.secureCookies };

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, "RATE_LIMITED", "Too many requests, please try again later")),
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authLimiter, authRouter(authService, cookie));
  app.use("/api/invitations", authLimiter, invitationsRouter(teamService, cookie));
  app.use("/api/team", requireAuth(authService), requireRole("OWNER", "ADMIN"), teamRouter(teamService));

  app.use((_req, _res, next) => next(notFound("ROUTE_NOT_FOUND", "Route not found")));
  app.use(errorHandler);

  return app;
}
