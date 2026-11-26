import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadConfig } from "../lib/config.mjs";
import { deepseekReply, geminiReply, interviewConfig, startDemo, startFakeUpstream } from "./helpers.mjs";

const cleanups = [];
after(async () => {
  for (const c of cleanups) await c();
});
async function setup(geminiResponses, deepseekResponses, env = {}) {
  const gemini = geminiResponses ? await startFakeUpstream(geminiResponses) : null;
  const deepseek = deepseekResponses ? await startFakeUpstream(deepseekResponses) : null;
  const demo = await startDemo({
    ...(gemini ? { GEMINI_API_KEY: "test-gemini-key", GEMINI_MODEL: "gemini-test", GEMINI_BASE_URL: gemini.url } : {}),
    ...(deepseek ? { DEEPSEEK_API_KEY: "test-deepseek-key", DEEPSEEK_MODEL: "deepseek-test", DEEPSEEK_BASE_URL: deepseek.url } : {}),
    ...env,
  });
  cleanups.push(demo.close);
  if (gemini) cleanups.push(gemini.close);
  if (deepseek) cleanups.push(deepseek.close);
  return { gemini, deepseek, demo };
}

const firstQuestion = { message: "Hello, welcome. How does a database index speed up queries?", type: "question", category: "Databases", difficulty: "medium", interviewComplete: false };
const answered = [
  { role: "interviewer", text: firstQuestion.message, category: "Databases", difficulty: "medium" },
  { role: "candidate", text: "An index is like a B-tree that lets the database find rows without scanning the whole table." },
];

describe("configuration", () => {
  it("drops a fallback that equals the primary and rejects unknown providers", () => {
    const c = loadConfig({ AI_INTERVIEW_PROVIDER: "gemini", AI_INTERVIEW_FALLBACK_PROVIDER: "gemini" });
    assert.equal(c.interview.fallback, undefined);
    assert.throws(() => loadConfig({ AI_EVALUATION_PROVIDER: "openai" }), /AI_EVALUATION_PROVIDER/);
  });
});

describe("without credentials", () => {
  it("reports providers as not configured and refuses to fake an interview", async () => {
    const { demo } = await setup(null, null);
    const status = await demo.get("/api/status");
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.interview[0], { name: "gemini", configured: false, missing: ["GEMINI_API_KEY", "GEMINI_MODEL"] });

    const turn = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });
    assert.equal(turn.status, 503);
    assert.equal(turn.body.error.code, "AI_NOT_CONFIGURED");
    assert.match(turn.body.error.message, /GEMINI_API_KEY/);
  });
});

describe("interview turns (Gemini HTTP)", () => {
  it("sends a well-formed generateContent request and returns the validated question", async () => {
    const { gemini, demo } = await setup([geminiReply(firstQuestion)], null);
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });

    assert.equal(res.status, 200);
    assert.equal(res.body.message, firstQuestion.message);
    assert.equal(res.body.category, "Databases");
    assert.equal(res.body.phase, "opening");
    assert.equal(res.body.meta.provider, "gemini");
    assert.deepEqual(res.body.meta.usage, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });

    const req = gemini.requests[0];
    assert.equal(req.url, "/models/gemini-test:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "test-gemini-key");
    assert.equal(req.body.generationConfig.responseMimeType, "application/json");
    assert.match(req.body.systemInstruction.parts[0].text, /Ask exactly ONE question/);
    assert.match(req.body.systemInstruction.parts[0].text, /Backend Developer/);
    assert.equal(req.body.contents[0].role, "user");
  });

  it("instructs the interviewer to speak only the configured language (Uzbek)", async () => {
    const { gemini, demo } = await setup([geminiReply(firstQuestion)], null);
    await demo.post("/api/interview/turn", { config: { ...interviewConfig, language: "uz" }, transcript: [], elapsedSeconds: 0 });
    assert.match(gemini.requests[0].body.systemInstruction.parts[0].text, /Speak ONLY Uzbek/);
  });

  it("never sends the API key to the browser", async () => {
    const { demo } = await setup([geminiReply(firstQuestion)], null);
    const status = await demo.get("/api/status");
    const turn = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });
    assert.doesNotMatch(JSON.stringify(status.body) + JSON.stringify(turn.body), /test-gemini-key/);
  });

  it("retries a 503 from Gemini and succeeds", async () => {
    const { gemini, demo } = await setup([{ status: 503, body: { error: { message: "overloaded" } } }, geminiReply(firstQuestion)], null);
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });
    assert.equal(res.status, 200);
    assert.equal(gemini.requests.length, 2);
  });

  it("does not retry a 401 and falls back to DeepSeek when configured", async () => {
    const { gemini, deepseek, demo } = await setup(
      [{ status: 401, body: { error: { message: "API key not valid" } } }],
      [deepseekReply(firstQuestion)],
      { AI_INTERVIEW_FALLBACK_PROVIDER: "deepseek" },
    );
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });
    assert.equal(res.status, 200);
    assert.equal(gemini.requests.length, 1);
    assert.equal(res.body.meta.provider, "deepseek");
    assert.equal(res.body.meta.fallbackFrom, "gemini");
    assert.ok(demo.logs.some((l) => l.event === "ai_fallback" && l.from === "gemini" && l.to === "deepseek"));
  });

  it("returns 502 with the upstream message when Gemini fails and there is no fallback", async () => {
    const { demo } = await setup([{ status: 401, body: { error: { message: "API key not valid" } } }], null);
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, "AI_UPSTREAM_ERROR");
    assert.match(res.body.error.message, /API key not valid/);
  });

  it("returns 504 when Gemini times out", async () => {
    const { demo } = await setup([{ ...geminiReply(firstQuestion), delayMs: 1500 }, { ...geminiReply(firstQuestion), delayMs: 1500 }], null, {
      AI_REQUEST_TIMEOUT_MS: "1000",
      AI_MAX_RETRIES: "0",
    });
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [], elapsedSeconds: 0 });
    assert.equal(res.status, 504);
    assert.equal(res.body.error.code, "AI_TIMEOUT");
  });

  it("rejects a repeated question and asks the model to correct itself", async () => {
    const repeat = { ...firstQuestion, message: "How does a database index speed up queries?" };
    const fresh = { message: "Thanks. How would you find duplicates in a large array efficiently?", type: "question", category: "Algorithms", difficulty: "medium", interviewComplete: false };
    const { gemini, demo } = await setup([geminiReply(repeat), geminiReply(fresh)], null);
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: answered, elapsedSeconds: 60 });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, fresh.message);
    assert.equal(gemini.requests.length, 2);
    assert.match(gemini.requests[1].body.contents.at(-1).parts[0].text, /repeats an earlier question/);
  });

  it("forces a closing message once the configured duration is over", async () => {
    const stillAsking = { message: "Next, explain quicksort.", type: "question", category: "Algorithms", difficulty: "hard", interviewComplete: false };
    const closing = { message: "Thank you, that is all the time we have.", type: "closing", category: null, difficulty: null, interviewComplete: true };
    const { gemini, demo } = await setup([geminiReply(stillAsking), geminiReply(closing)], null);
    const res = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: answered, elapsedSeconds: 10 * 60 + 5 });
    assert.equal(res.status, 200);
    assert.equal(res.body.phase, "closing");
    assert.equal(res.body.interviewComplete, true);
    assert.match(gemini.requests[0].body.systemInstruction.parts[0].text, /Time is over/);
  });

  it("validates the request body", async () => {
    const { demo } = await setup([], null);
    const bad = await demo.post("/api/interview/turn", { config: { ...interviewConfig, durationMinutes: 999 }, transcript: [] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error.message, /durationMinutes/);
    const wrongOrder = await demo.post("/api/interview/turn", { config: interviewConfig, transcript: [answered[0]] });
    assert.equal(wrongOrder.status, 400);
  });
});

describe("evaluation (DeepSeek HTTP)", () => {
  const transcript = [
    ...answered,
    { role: "interviewer", text: "How would you find duplicates in a large array?", category: "Algorithms", difficulty: "medium" },
    { role: "candidate", text: "I would put items in a Set and check membership, which is O(n) time." },
  ];
  const criterion = (key, score, evidence) => ({ key, score, rationale: `${key} rationale`, evidence });
  const modelOutput = {
    summary: "Solid fundamentals.",
    criteria: [
      criterion("technical_correctness", 8, [{ answerIndex: 1, quote: "B-tree that lets the database find rows" }]),
      criterion("conceptual_understanding", 7, [{ answerIndex: 3, quote: "put items in a Set" }]),
      // Fabricated quote: not in the transcript, must be removed.
      criterion("problem_solving", 9, [{ answerIndex: 3, quote: "I would use a bloom filter" }]),
      // Quote from the interviewer line, must be removed.
      criterion("explanation", 6, [{ answerIndex: 0, quote: "database index speed up" }]),
      criterion("practical_knowledge", 5, [{ answerIndex: 3, quote: "O(n) time" }]),
    ],
    strengths: ["Knows indexes"],
    areasForFurtherAssessment: ["Distributed systems"],
    recommendation: "hire",
    overallScore: 99, // must be ignored; computed server-side
    uncertainty: { level: "low", reasons: [] },
  };

  it("checks evidence against the transcript and computes the score server-side", async () => {
    const { deepseek, demo } = await setup(null, [deepseekReply(modelOutput)], { AI_EVALUATION_FALLBACK_PROVIDER: "" });
    const res = await demo.post("/api/interview/evaluate", { config: interviewConfig, transcript });
    assert.equal(res.status, 200);

    const ev = res.body.evaluation;
    const byKey = Object.fromEntries(ev.criteria.map((c) => [c.key, c]));
    assert.equal(byKey.technical_correctness.evidence.length, 1);
    assert.equal(byKey.problem_solving.evidence.length, 0);
    assert.equal(byKey.problem_solving.evidenceMissing, true);
    assert.equal(byKey.explanation.evidence.length, 0);
    assert.equal(ev.rejectedEvidence.length, 2);
    assert.equal(ev.uncertainty.level, "medium"); // raised from "low" because evidence is missing
    assert.deepEqual(ev.uncertainty.checks, [
      { code: "missing_evidence", criteria: ["problem_solving", "explanation"] },
      { code: "rejected_evidence", count: 2 },
    ]);
    // 8*.3 + 7*.25 + 9*.2 + 6*.1 + 5*.15 = 7.3 → 73
    assert.equal(ev.overallScore, 73);
    assert.equal(res.body.questionsAndAnswers.length, 2);
    assert.equal(res.body.meta.provider, "deepseek");

    const req = deepseek.requests[0];
    assert.equal(req.url, "/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-deepseek-key");
    assert.deepEqual(req.body.response_format, { type: "json_object" });
    assert.equal(req.body.model, "deepseek-test");
    assert.match(req.body.messages[0].content, /Ignore accent/);
    assert.match(req.body.messages[0].content, /JSON/);
  });

  it("falls back to Gemini when DeepSeek is not configured", async () => {
    const { gemini, demo } = await setup([geminiReply(modelOutput)], null);
    const res = await demo.post("/api/interview/evaluate", { config: interviewConfig, transcript });
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.provider, "gemini");
    assert.equal(gemini.requests.length, 1);
  });

  it("retries when a criterion is missing from the model output", async () => {
    const incomplete = { ...modelOutput, criteria: modelOutput.criteria.slice(0, 3) };
    const { deepseek, demo } = await setup(null, [deepseekReply(incomplete), deepseekReply(modelOutput)], { AI_EVALUATION_FALLBACK_PROVIDER: "" });
    const res = await demo.post("/api/interview/evaluate", { config: interviewConfig, transcript });
    assert.equal(res.status, 200);
    assert.equal(deepseek.requests.length, 2);
  });

  it("does not call any AI when the candidate gave no substantive answers", async () => {
    const { deepseek, demo } = await setup(null, [deepseekReply(modelOutput)]);
    const res = await demo.post("/api/interview/evaluate", { config: interviewConfig, transcript: [answered[0], { role: "candidate", text: "pass" }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.evaluation, null);
    assert.equal(deepseek.requests.length, 0);
  });
});

describe("static files", () => {
  it("serves the app with security headers and blocks path traversal", async () => {
    const { demo } = await setup(null, null);
    const page = await demo.get("/");
    assert.equal(page.status, 200);
    assert.match(page.body, /AI Developer Interview/);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(page.headers.get("permissions-policy"), "camera=(self), microphone=(self)");

    const traversal = await fetch(`${demo.base}/..%2f..%2fserver.mjs`);
    assert.ok([403, 404].includes(traversal.status));
    assert.equal((await demo.get("/nope.js")).status, 404);
  });
});
