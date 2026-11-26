import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";

/** Logs method, path, status and duration. Never logs bodies or headers. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info(
      { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) },
      "request",
    );
  });
  next();
};
