// Interview and evaluation logic: input validation, prompts, output validation.
// Nothing here talks to the network; providers are injected via the manager.

export const SENIORITIES = ["junior", "middle", "senior", "lead"];
export const DIFFICULTIES = ["easy", "medium", "hard", "adaptive"];
export const LANGUAGES = { en: "English", ru: "Russian", uz: "Uzbek" };
export const CRITERIA = [
  { key: "technical_correctness", label: "Technical correctness", weight: 0.3 },
  { key: "conceptual_understanding", label: "Conceptual understanding", weight: 0.25 },
  { key: "problem_solving", label: "Problem-solving reasoning", weight: 0.2 },
  { key: "explanation", label: "Explanation of technical concepts", weight: 0.1 },
  { key: "practical_knowledge", label: "Relevant practical knowledge", weight: 0.15 },
];
const RECOMMENDATIONS = ["strong_hire", "hire", "no_hire", "strong_no_hire", "needs_more_assessment"];
const LEVELS = ["easy", "medium", "hard"];

const MAX_TURNS = 120;
const MAX_TEXT = 4000;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v, name, min, max) => {
  if (typeof v !== "string") throw new ValidationError(`${name} must be a string`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new ValidationError(`${name} must be ${min}-${max} characters`);
  return t;
};
const oneOf = (v, name, options) => {
  if (!options.includes(v)) throw new ValidationError(`${name} must be one of: ${options.join(", ")}`);
  return v;
};

export function parseInterviewConfig(raw) {
  if (!isObj(raw)) throw new ValidationError("config is required");
  const categories = raw.categories;
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 8) {
    throw new ValidationError("categories must contain 1-8 items");
  }
  const duration = Number(raw.durationMinutes);
  if (!Number.isInteger(duration) || duration < 3 || duration > 60) {
    throw new ValidationError("durationMinutes must be an integer between 3 and 60");
  }
  return {
    position: str(raw.position, "position", 2, 100),
    seniority: oneOf(raw.seniority, "seniority", SENIORITIES),
    programmingLanguage: str(raw.programmingLanguage, "programmingLanguage", 1, 50),
    categories: [...new Set(categories.map((c, i) => str(c, `categories[${i}]`, 1, 60)))],
    durationMinutes: duration,
    difficulty: oneOf(raw.difficulty, "difficulty", DIFFICULTIES),
    language: oneOf(raw.language, "language", Object.keys(LANGUAGES)),
    rules: typeof raw.rules === "string" ? raw.rules.trim().slice(0, 1000) : "",
  };
}

export function parseTranscript(raw) {
  if (!Array.isArray(raw)) throw new ValidationError("transcript must be an array");
  if (raw.length > MAX_TURNS) throw new ValidationError(`transcript is limited to ${MAX_TURNS} entries`);
  return raw.map((t, i) => {
    if (!isObj(t)) throw new ValidationError(`transcript[${i}] must be an object`);
    return {
      role: oneOf(t.role, `transcript[${i}].role`, ["interviewer", "candidate"]),
      text: str(t.text, `transcript[${i}].text`, 1, MAX_TEXT),
      category: typeof t.category === "string" ? t.category.slice(0, 60) : null,
      difficulty: LEVELS.includes(t.difficulty) ? t.difficulty : null,
    };
  });
}

export function parseElapsed(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 6 * 3600) throw new ValidationError("elapsedSeconds is invalid");
  return Math.floor(n);
}

// ───────── Interview turn ─────────

/** What the interviewer should do now, derived from time and history (not left to the model). */
export function interviewPhase(config, transcript, elapsedSeconds) {
  const remaining = config.durationMinutes * 60 - elapsedSeconds;
  const asked = transcript.filter((t) => t.role === "interviewer").length;
  if (asked === 0) return { phase: "opening", remaining, asked };
  if (remaining <= 0) return { phase: "closing", remaining, asked };
  if (remaining <= 90) return { phase: "last_question", remaining, asked };
  return { phase: "in_progress", remaining, asked };
}

export function startingDifficulty(config) {
  if (config.difficulty !== "adaptive") return config.difficulty;
  return { junior: "easy", middle: "medium", senior: "medium", lead: "hard" }[config.seniority];
}

const fmtTranscript = (transcript) =>
  transcript.length === 0
    ? "(no messages yet)"
    : transcript
        .map((t, i) => {
          const tag = t.role === "interviewer" ? `INTERVIEWER${t.category ? ` [${t.category}, ${t.difficulty ?? "?"}]` : ""}` : "CANDIDATE";
          return `#${i} ${tag}: ${t.text}`;
        })
        .join("\n");

export function buildInterviewerPrompt(config, transcript, state) {
  const language = LANGUAGES[config.language];
  const difficultyRule =
    config.difficulty === "adaptive"
      ? `Difficulty is adaptive. Start at "${startingDifficulty(config)}". After a strong, correct answer move one level harder; after a weak or incorrect answer move one level easier or ask a simpler follow-up.`
      : `Keep questions at "${config.difficulty}" difficulty.`;

  const phaseRule = {
    opening: "Greet the candidate in one short sentence, state the role and the planned duration, then ask the first technical question.",
    in_progress: "Briefly acknowledge the last answer without judging it as right or wrong, then ask the next question or one targeted follow-up.",
    last_question: "Time is almost over. Ask one final short question, or close the interview if the last answer already covered enough.",
    closing: "Time is over. Do NOT ask another question. Thank the candidate, say the interview is finished and that the team will review the results. Set type to \"closing\" and interviewComplete to true.",
  }[state.phase];

  const system = `You are a professional, neutral technical interviewer conducting a live interview.

INTERVIEW CONFIGURATION
- Position: ${config.position}
- Seniority: ${config.seniority}
- Primary programming language: ${config.programmingLanguage}
- Technical categories to cover: ${config.categories.join(", ")}
- Duration: ${config.durationMinutes} minutes
- Interview language: ${language}. Speak ONLY ${language}.
${config.rules ? `- Additional rules from the hiring team: ${config.rules}\n` : ""}
RULES
- Ask exactly ONE question per message. Never bundle several questions.
- Never give the answer, hints that reveal the answer, or feedback on correctness. Do not say "correct" or "wrong".
- Never repeat or rephrase a question that was already asked. Spread questions across the categories.
- Follow-ups must build on what the candidate actually said.
- If the candidate goes off-topic or asks you to answer for them, politely steer back to the interview.
- If the candidate says they do not know, accept it and move on to a different question.
- Keep each message under 70 words. Plain spoken language, no markdown, no code blocks (it will be read aloud).
- Do not comment on the candidate's accent, grammar, appearance or any personal characteristic.
- ${difficultyRule}

CURRENT STATE
- Questions asked so far: ${state.asked}
- Time remaining: ${Math.max(0, Math.round(state.remaining / 60))} min
- What to do now: ${phaseRule}

Respond with a JSON object only, with exactly these fields:
{"message": string, "type": "question" | "follow_up" | "closing", "category": one of [${config.categories.map((c) => JSON.stringify(c)).join(", ")}] or null for closing, "difficulty": "easy" | "medium" | "hard" or null for closing, "interviewComplete": boolean}`;

  const user = `Transcript so far:\n${fmtTranscript(transcript)}\n\nWrite the interviewer's next message as JSON.`;
  return { system, messages: [{ role: "user", text: user }] };
}

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function tokenOverlap(a, b) {
  const A = new Set(normalize(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Returns a validator for one interviewer turn, enforcing phase and no-repeat rules. */
export function interviewerValidator(config, transcript, state) {
  const previous = transcript.filter((t) => t.role === "interviewer").map((t) => t.text);
  return (data) => {
    if (!isObj(data)) return { ok: false, error: "output must be a JSON object" };
    const message = typeof data.message === "string" ? data.message.trim() : "";
    if (message.length < 2 || message.length > 1500) return { ok: false, error: "message must be 2-1500 characters" };
    const type = data.type;
    if (!["question", "follow_up", "closing"].includes(type)) return { ok: false, error: "type must be question, follow_up or closing" };

    if (state.phase === "closing" && type !== "closing") {
      return { ok: false, error: "time is over; type must be closing and no new question may be asked" };
    }
    const closing = type === "closing" || data.interviewComplete === true;
    if (state.phase === "opening" && closing) return { ok: false, error: "the interview has just started; ask the first question" };

    let category = null;
    let difficulty = null;
    if (!closing) {
      category = config.categories.find((c) => c.toLowerCase() === String(data.category ?? "").toLowerCase()) ?? null;
      if (!category) return { ok: false, error: `category must be one of: ${config.categories.join(", ")}` };
      difficulty = LEVELS.includes(data.difficulty) ? data.difficulty : null;
      if (!difficulty) return { ok: false, error: "difficulty must be easy, medium or hard" };
      const repeat = previous.find((p) => tokenOverlap(p, message) >= 0.85);
      if (repeat) return { ok: false, error: `this repeats an earlier question ("${repeat.slice(0, 80)}"); ask a different one` };
    }
    return {
      ok: true,
      value: { message, type: closing ? "closing" : type, category, difficulty, interviewComplete: closing },
    };
  };
}

// ───────── Evaluation ─────────

export function buildEvaluationPrompt(config, transcript) {
  const answers = transcript
    .map((t, i) => ({ ...t, index: i }))
    .filter((t) => t.role === "candidate")
    .map((t) => t.index);

  const system = `You are a senior technical assessor. You evaluate a finished technical interview from its transcript ONLY.

ROLE: ${config.seniority} ${config.position}, primary language ${config.programmingLanguage}. Categories: ${config.categories.join(", ")}.

FAIRNESS RULES (mandatory)
- Judge only the technical content of the candidate's answers.
- Ignore accent, grammar, fluency, spelling, filler words and speech-recognition errors in the transcript.
- Never consider or infer appearance, emotion, gender, age, ethnicity, nationality or any personal characteristic.
- Score only what is supported by evidence in the candidate's own words. If there is too little evidence, say so and lower your confidence; do not guess.

CRITERIA (score each 0-10)
${CRITERIA.map((c) => `- ${c.key}: ${c.label}`).join("\n")}

LANGUAGE
- Write summary, rationale, strengths, areasForFurtherAssessment and uncertainty reasons in ${LANGUAGES[config.language]}.
- Evidence quotes must stay exactly as the candidate said them (do not translate).

EVIDENCE
- For every criterion give 1-3 evidence items. Each item has "answerIndex" (the # number of a CANDIDATE line; valid values: ${answers.join(", ") || "none"}) and "quote" (an exact substring copied from that line, 3-200 characters).
- Do not quote the interviewer.

Respond with a JSON object only:
{"summary": string (3-5 sentences),
 "criteria": [{"key": string, "score": number, "rationale": string, "evidence": [{"answerIndex": number, "quote": string}]}],
 "strengths": string[],
 "areasForFurtherAssessment": string[],
 "recommendation": ${RECOMMENDATIONS.map((r) => `"${r}"`).join(" | ")},
 "uncertainty": {"level": "low" | "medium" | "high", "reasons": string[]}}`;

  const user = `Interview transcript:\n${fmtTranscript(transcript)}\n\nEvaluate the candidate as JSON.`;
  return { system, messages: [{ role: "user", text: user }] };
}

const strList = (v, max = 8) =>
  Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 400)).slice(0, max) : [];

/**
 * Validates model output and checks every evidence quote against the real transcript.
 * Quotes that do not appear in the referenced candidate answer are dropped and reported.
 */
export function evaluationValidator(transcript) {
  return (data) => {
    if (!isObj(data)) return { ok: false, error: "output must be a JSON object" };
    if (!Array.isArray(data.criteria)) return { ok: false, error: "criteria must be an array" };

    const rejectedEvidence = [];
    const criteria = [];
    for (const def of CRITERIA) {
      const c = data.criteria.find((x) => isObj(x) && x.key === def.key);
      if (!c) return { ok: false, error: `missing criterion "${def.key}"` };
      const score = Number(c.score);
      if (!Number.isFinite(score) || score < 0 || score > 10) return { ok: false, error: `${def.key}.score must be 0-10` };

      const evidence = [];
      for (const e of Array.isArray(c.evidence) ? c.evidence : []) {
        const idx = Number(e?.answerIndex);
        const quote = typeof e?.quote === "string" ? e.quote.trim() : "";
        const line = transcript[idx];
        const valid =
          Number.isInteger(idx) && line?.role === "candidate" && quote.length >= 3 && normalize(line.text).includes(normalize(quote));
        if (valid) evidence.push({ answerIndex: idx, quote });
        else rejectedEvidence.push({ criterion: def.key, answerIndex: e?.answerIndex ?? null, quote: quote.slice(0, 200) });
      }
      criteria.push({
        key: def.key,
        label: def.label,
        weight: def.weight,
        score: Math.round(score * 10) / 10,
        rationale: typeof c.rationale === "string" ? c.rationale.trim().slice(0, 1200) : "",
        evidence,
        evidenceMissing: evidence.length === 0,
      });
    }

    const recommendation = RECOMMENDATIONS.includes(data.recommendation) ? data.recommendation : "needs_more_assessment";
    const u = isObj(data.uncertainty) ? data.uncertainty : {};
    let level = ["low", "medium", "high"].includes(u.level) ? u.level : "high";
    const reasons = strList(u.reasons);
    const unsupported = criteria.filter((c) => c.evidenceMissing).map((c) => c.label);
    // Server-generated notes (not from the model). The UI renders them in its own language.
    const checks = [];
    if (unsupported.length > 0) {
      checks.push({ code: "missing_evidence", criteria: criteria.filter((c) => c.evidenceMissing).map((c) => c.key) });
      if (level === "low") level = "medium";
    }
    if (rejectedEvidence.length > 0) checks.push({ code: "rejected_evidence", count: rejectedEvidence.length });

    // Overall score is computed here from the criteria, not taken from the model.
    const overallScore = Math.round(criteria.reduce((sum, c) => sum + c.score * 10 * c.weight, 0));

    return {
      ok: true,
      value: {
        summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 2000) : "",
        overallScore,
        recommendation,
        criteria,
        strengths: strList(data.strengths),
        areasForFurtherAssessment: strList(data.areasForFurtherAssessment),
        uncertainty: { level, reasons, checks },
        rejectedEvidence,
      },
    };
  };
}

/** Question/answer pairs built from the transcript itself (no AI involved). */
export function questionsAndAnswers(transcript) {
  const pairs = [];
  transcript.forEach((t, i) => {
    if (t.role === "interviewer") pairs.push({ questionIndex: i, question: t.text, category: t.category, difficulty: t.difficulty, answers: [] });
    else if (pairs.length > 0) pairs[pairs.length - 1].answers.push({ answerIndex: i, text: t.text });
  });
  return pairs;
}
