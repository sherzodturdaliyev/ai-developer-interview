import { createServer } from "node:http";
import { loadConfig } from "../lib/config.mjs";
import { createProviderManager } from "../lib/providers.mjs";
import { createDemoServer } from "../server.mjs";

/**
 * A fake upstream (Gemini or DeepSeek) HTTP server. `responses` is a queue of
 * { status, body, delayMs }. Every received request is recorded.
 */
export async function startFakeUpstream(responses) {
  const requests = [];
  const queue = [...responses];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const next = queue.shift() ?? { status: 500, body: { error: { message: "no scripted response" } } };
    if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
    if (res.destroyed) return;
    res.writeHead(next.status ?? 200, { "Content-Type": "application/json" });
    res.end(typeof next.body === "string" ? next.body : JSON.stringify(next.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

export const geminiReply = (obj, usage = { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 }) => ({
  status: 200,
  body: { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }], usageMetadata: usage },
});

export const deepseekReply = (obj) => ({
  status: 200,
  body: {
    model: "deepseek-test",
    choices: [{ message: { role: "assistant", content: JSON.stringify(obj) } }],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
  },
});

export async function startDemo(env = {}) {
  const config = loadConfig({ AI_MAX_RETRIES: "1", AI_REQUEST_TIMEOUT_MS: "2000", ...env });
  const logs = [];
  const manager = createProviderManager(config, { log: (e) => logs.push(e) });
  const server = createDemoServer({ config, manager, log: (e) => logs.push(e) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const get = async (path) => {
    const res = await fetch(base + path);
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* static file */ }
    return { status: res.status, body, headers: res.headers };
  };
  return { base, post, get, logs, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

export const interviewConfig = {
  position: "Backend Developer",
  seniority: "middle",
  programmingLanguage: "JavaScript",
  categories: ["Databases", "Algorithms"],
  durationMinutes: 10,
  difficulty: "adaptive",
  language: "en",
};
