import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import { badRequest } from "./errors.js";

/** Express 4 does not catch rejected promises; forward them to the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validate untrusted input at the route boundary. Throws a 400 with field-level issues. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Invalid request",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
