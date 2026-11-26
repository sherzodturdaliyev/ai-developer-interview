// AI interview demo server. No dependencies: run with `node server.mjs` (Node 20.12+).
// API keys stay here; the browser only talks to /api/* on this server.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { AiError, createProviderManager } from "./lib/providers.mjs";
import { createHandlers } from "./lib/handlers.mjs";
import { ValidationError } from "./lib/interview.mjs";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const MAX_BODY = 512 * 1024;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob: mediastream:; connect-src 'self'; frame-ancestors 'none'",
  // Camera and microphone only for this origin.
  "Permissions-Policy": "camera=(self), microphone=(self)",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": isJson ? "application/json; charset=utf-8" : headers["Content-Type"] ?? "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

const sendError = (res, status, code, message) => send(res, status, { error: { code, message } });

async function readJson(req) {
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("application/json")) throw new ValidationError("Content-Type must be application/json");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError("Request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("Request body is not valid JSON");
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, "FORBIDDEN", "Forbidden");
  try {
    const data = await readFile(filePath);
    send(res, 200, data, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  } catch {
    sendError(res, 404, "NOT_FOUND", "Not found");
  }
}

export function createDemoServer({ config, manager, log = () => {} }) {
  const handlers = createHandlers(manager);

  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return serveStatic(req, res);
    }
    const handler = handlers[`${req.method} ${path}`];
    if (!handler) return sendError(res, 404, "NOT_FOUND", "Route not found");
    try {
      const body = req.method === "POST" ? await readJson(req) : undefined;
      send(res, 200, await handler(body));
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 400, "VALIDATION_ERROR", err.message);
      if (err instanceof AiError) {
        const status = err.code === "AI_NOT_CONFIGURED" ? 503 : err.code === "AI_TIMEOUT" ? 504 : 502;
        return sendError(res, status, err.code, err.message);
      }
      log({ event: "unhandled_error", path, error: String(err?.stack ?? err) });
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
    }
  });
}

// ───────── Entry point ─────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  try {
    process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), ".env"));
  } catch {
    /* .env is optional; real environment variables also work */
  }
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  const log = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));
  const manager = createProviderManager(config, { log });
  const server = createDemoServer({ config, manager, log });
  server.listen(config.port, config.host, () => {
    console.log(`\nAI interview demo: http://localhost:${config.port}\n`);
    for (const job of ["interview", "evaluation"]) {
      for (const p of manager.describe(job)) {
        console.log(`  ${job.padEnd(10)} ${p.name.padEnd(8)} ${p.configured ? "ready" : `not configured (missing ${p.missing.join(", ")})`}`);
      }
    }
    console.log("");
  });
}
