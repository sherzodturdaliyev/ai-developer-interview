import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** body-parser errors carry a `type` such as "entity.parse.failed". */
const bodyParserErrorType = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "type" in err && typeof err.type === "string"
    ? err.type
    : undefined;

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  const type = bodyParserErrorType(err);
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } });
    return;
  }

  logger.error({ err, method: req.method, path: req.path }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};
