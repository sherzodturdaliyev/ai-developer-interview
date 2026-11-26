import { createHash, randomBytes } from "node:crypto";

/** URL-safe random secret, used for refresh and invite tokens. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const randomHex = (bytes: number): string => randomBytes(bytes).toString("hex");

/** Tokens are stored as SHA-256 hashes so a database leak does not leak live tokens. */
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
