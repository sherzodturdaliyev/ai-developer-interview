// API operations shared by the Node server (server.mjs) and the single-file HTML build.
// Pure functions of (manager, body); no HTTP or DOM here.

import {
  ValidationError,
  buildEvaluationPrompt,
  buildInterviewerPrompt,
  evaluationValidator,
  interviewPhase,
  interviewerValidator,
  parseElapsed,
  parseInterviewConfig,
  parseTranscript,
  questionsAndAnswers,
} from "./interview.mjs";

export function createHandlers(manager) {
  return {
    "GET /api/status": async () => ({
      interview: manager.describe("interview"),
      evaluation: manager.describe("evaluation"),
    }),

    "POST /api/interview/turn": async (body) => {
      const interviewConfig = parseInterviewConfig(body?.config);
      const transcript = parseTranscript(body?.transcript ?? []);
      const elapsedSeconds = parseElapsed(body?.elapsedSeconds ?? 0);
      if (transcript.length > 0 && transcript[transcript.length - 1].role !== "candidate") {
        throw new ValidationError("The last transcript entry must be the candidate's answer");
      }
      const state = interviewPhase(interviewConfig, transcript, elapsedSeconds);
      const prompt = buildInterviewerPrompt(interviewConfig, transcript, state);
      const result = await manager.run(
        "interview",
        "interview_turn",
        { ...prompt, temperature: 0.6 },
        interviewerValidator(interviewConfig, transcript, state),
      );
      return {
        ...result.data,
        phase: state.phase,
        meta: { provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom, usage: result.usage },
      };
    },

    "POST /api/interview/evaluate": async (body) => {
      const interviewConfig = parseInterviewConfig(body?.config);
      const transcript = parseTranscript(body?.transcript ?? []);
      const qa = questionsAndAnswers(transcript);
      const answered = transcript.some((t) => t.role === "candidate" && t.text.trim().split(/\s+/).length >= 3);

      // Avoid an AI call when there is nothing to evaluate.
      if (!answered) {
        return {
          evaluation: null,
          reason: "The candidate gave no substantive answers, so there is no evidence to evaluate.",
          questionsAndAnswers: qa,
          config: interviewConfig,
        };
      }
      const prompt = buildEvaluationPrompt(interviewConfig, transcript);
      const result = await manager.run(
        "evaluation",
        "technical_evaluation",
        { ...prompt, temperature: 0.1 },
        evaluationValidator(transcript),
      );
      return {
        evaluation: result.data,
        questionsAndAnswers: qa,
        config: interviewConfig,
        generatedAt: new Date().toISOString(),
        meta: { provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom, usage: result.usage },
      };
    },
  };
}
