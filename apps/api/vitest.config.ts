import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
      BCRYPT_ROUNDS: "4",
      LOG_LEVEL: "silent",
    },
  },
});
