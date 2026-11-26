import { createApp } from "./app.js";
import { getEnv, type Env } from "./config/env.js";
import { configureLogger, logger } from "./lib/logger.js";
import { disconnectPrisma, getPrisma } from "./lib/prisma.js";
import { PrismaAuthRepository } from "./modules/auth/auth.prisma-repository.js";

function loadEnvOrExit(): Env {
  try {
    return getEnv();
  } catch (err) {
    console.error((err as Error).message);
    console.error("See apps/api/.env.example and docs/SETUP.md.");
    process.exit(1);
  }
}

function main(): void {
  const env = loadEnvOrExit();
  configureLogger(env.LOG_LEVEL);

  const app = createApp({
    authRepo: new PrismaAuthRepository(getPrisma()),
    config: {
      webOrigin: env.WEB_ORIGIN,
      secureCookies: env.NODE_ENV === "production",
      jwtAccessSecret: env.JWT_ACCESS_SECRET,
      bcryptRounds: env.BCRYPT_ROUNDS,
      authRateLimit: env.AUTH_RATE_LIMIT,
      trustProxy: env.TRUST_PROXY,
    },
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "API listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
