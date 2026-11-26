import { pino, type Logger, type LevelWithSilent } from "pino";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.passwordHash",
  "*.apiKey",
  "*.token",
  "*.refreshToken",
  "*.accessToken",
];

function build(level: LevelWithSilent): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } });
}

// `export let` gives importers a live binding, so configureLogger() affects every module.
export let logger: Logger = build("info");

export function configureLogger(level: LevelWithSilent): void {
  logger = build(level);
}
