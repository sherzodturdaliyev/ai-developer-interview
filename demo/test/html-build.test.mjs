import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import vm from "node:vm";
import { buildHtml } from "../build-html.mjs";
import { geminiReply, interviewConfig, startFakeUpstream } from "./helpers.mjs";

const cleanups = [];
after(async () => {
  for (const c of cleanups) await c();
});

/** Runs the generated backend <script> in a VM with a minimal fake DOM. */
async function loadBackend({ key = "", model = "gemini-test", baseUrl } = {}) {
  const html = await buildHtml();
  const [backendScript] = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const fields = {
    "gemini-key": { value: key, addEventListener() {} },
    "gemini-model": { value: model, addEventListener() {} },
    "gemini-remember": { checked: false, addEventListener() {} },
  };
  const store = new Map();
  const context = {
    window: { ADI_GEMINI_BASE_URL: baseUrl },
    document: { getElementById: (id) => fields[id] ?? null },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    console: { info() {}, log() {} },
    fetch,
    AbortSignal,
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(backendScript, context);
  return { backend: context.window.ADI_LOCAL_BACKEND, html, fields };
}

describe("single-file HTML build", () => {
  it("is self-contained and contains no API key", async () => {
    const html = await buildHtml();
    assert.doesNotMatch(html, /src="\/|href="\/styles/);
    assert.doesNotMatch(html, /AIza[0-9A-Za-z_-]{20,}/);
    assert.match(html, /id="gemini-key"/);
  });

  it("reports Gemini as not configured until a key is entered", async () => {
    const { backend, fields } = await loadBackend();
    const before = await backend.request("/api/status");
    assert.equal(before.interview[0].configured, false);
    fields["gemini-key"].value = "typed-key";
    const after_ = await backend.request("/api/status");
    assert.equal(after_.interview[0].configured, true);
    assert.equal(after_.evaluation[0].name, "gemini");
  });

  it("runs an interview turn and an evaluation against the Gemini HTTP API from the page code", async () => {
    const question = { message: "Indeks qanday ishlaydi?", type: "question", category: "Databases", difficulty: "medium", interviewComplete: false };
    const evaluation = {
      summary: "Yaxshi.",
      criteria: ["technical_correctness", "conceptual_understanding", "problem_solving", "explanation", "practical_knowledge"].map((key) => ({
        key, score: 7, rationale: "ok", evidence: [{ answerIndex: 1, quote: "B-daraxt orqali" }],
      })),
      strengths: [], areasForFurtherAssessment: [], recommendation: "hire", uncertainty: { level: "low", reasons: [] },
    };
    const gemini = await startFakeUpstream([geminiReply(question), geminiReply(evaluation)]);
    cleanups.push(gemini.close);
    const { backend } = await loadBackend({ key: "typed-key", baseUrl: gemini.url });

    const turn = await backend.request("/api/interview/turn", { config: { ...interviewConfig, language: "uz" }, transcript: [], elapsedSeconds: 0 });
    assert.equal(turn.message, question.message);
    assert.equal(gemini.requests[0].headers["x-goog-api-key"], "typed-key");
    assert.match(gemini.requests[0].body.systemInstruction.parts[0].text, /Speak ONLY Uzbek/);

    const transcript = [
      { role: "interviewer", text: question.message, category: "Databases", difficulty: "medium" },
      { role: "candidate", text: "Indeks B-daraxt orqali qatorlarni tez topadi." },
    ];
    const report = await backend.request("/api/interview/evaluate", { config: interviewConfig, transcript });
    assert.equal(report.evaluation.overallScore, 70);
    assert.equal(report.meta.provider, "gemini");
  });

  it("surfaces validation and upstream errors with codes", async () => {
    const gemini = await startFakeUpstream([{ status: 400, body: { error: { message: "API key not valid" } } }]);
    cleanups.push(gemini.close);
    const { backend } = await loadBackend({ key: "bad", baseUrl: gemini.url });
    await assert.rejects(backend.request("/api/interview/turn", { config: { ...interviewConfig, durationMinutes: 0 }, transcript: [] }), {
      code: "VALIDATION_ERROR",
    });
    await assert.rejects(backend.request("/api/interview/turn", { config: interviewConfig, transcript: [] }), (err) => {
      assert.equal(err.code, "AI_UPSTREAM_ERROR");
      assert.match(err.message, /API key not valid/);
      return true;
    });
  });
});
