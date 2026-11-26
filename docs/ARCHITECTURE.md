# Architecture

AI Developer Interview is a multi-tenant SaaS. A company's HR team configures technical interviews. Candidates take them over text or voice. A separate evaluation pipeline scores the transcript. Humans review and can override the AI.

## Monorepo layout

```
apps/
  api/   Node + Express + TypeScript, Prisma/PostgreSQL, Zod, Vitest
  web/   React + Vite + TypeScript, Tailwind CSS
docs/    ARCHITECTURE.md, CHECKLIST.md, SETUP.md (added in the docs phase)
```

## Backend modules (`apps/api/src`)

| Path | Responsibility |
|---|---|
| `config/` | Zod-validated environment. Nothing else reads `process.env`. |
| `lib/` | Logger, typed errors, Prisma client. |
| `middleware/` | Auth, role checks, request validation, error handler. |
| `modules/auth` | Register (creates company and owner), login, refresh rotation, logout, team invites. |
| `modules/candidates`, `templates`, `interviews` | Recruiting CRUD, interview configuration, invite links. |
| `ai/providers` | `AIProvider` interface, `GeminiProvider`, `DeepSeekProvider`, `AIProviderManager`. |
| `ai/services` | `InterviewAIService`, `QuestionGenerationService`, `AdaptiveInterviewService`, `TechnicalEvaluationService`, `ReportGenerationService`, `AIResponseValidator`. |
| `ai/voice` | Gemini Live session creation (ephemeral tokens), optional ElevenLabs TTS and Deepgram STT. |
| `ai/usage` | Token and cost tracking written to `AiUsageLog`. |

Routes only parse input and call services. Services hold business logic. Providers hold the HTTP details of one vendor.

## AI design

- **Provider interface.** Each provider exposes `generateText` and `generateStructured` (JSON validated against a Zod schema). The base layer adds timeout, retry with backoff on 429/5xx/network errors, logging and usage reporting.
- **Provider manager.** Backend config assigns a primary and an optional fallback provider per job (`AI_INTERVIEW_PROVIDER`, `AI_EVALUATION_PROVIDER`, and `*_FALLBACK_PROVIDER`). A fallback is used only when the primary fails after its retries. Every usage log records which provider served the request and which failed.
- **Separation of processes.** The interview conversation (Gemini by default) never produces scores. After the interview ends, `TechnicalEvaluationService` (DeepSeek by default) reads the stored transcript and produces scores with quoted evidence. `ReportGenerationService` builds the report from the transcript and the evaluation.
- **Structured output.** All model JSON passes through Zod. Invalid output triggers one repair retry, then fails with a typed error. Evidence quotes are checked against the real transcript, and quotes that do not appear in the candidate's messages are rejected.
- **Human review.** AI evaluations are immutable. A `Review` row stores reviewer overrides and notes. The final decision shown in reports is the reviewer's when one exists.
- **Fairness.** The evaluation prompt receives transcript text only. Camera data is never sent to any model. Optional camera use is limited to a candidate-side preview, with consent, and is not stored or analyzed.
- **Missing credentials.** If a provider key is missing, the manager reports the provider as unconfigured. AI endpoints return a clear configuration error (HTTP 503, code `AI_NOT_CONFIGURED`). There is no canned or fake interviewer.

## Voice

Gemini Live runs in the browser over WebSocket. The browser must not hold the permanent key, so the backend mints a short-lived ephemeral token (constrained to the interview's model and system instruction) and the client connects with it. Transcripts from the session are posted back and stored as `InterviewMessage` rows with `source = VOICE_TRANSCRIPT`. Evaluation then runs on those stored transcripts, the same as for text.

Deepgram (STT) and ElevenLabs (TTS) are optional. Each is enabled only when its key is set.

## Auth and tenancy

- Access JWT (15 min) plus rotating refresh token in an httpOnly cookie. Refresh tokens are stored hashed.
- Every query is scoped by `companyId` taken from the verified token, never from request input.
- Roles: `OWNER`, `ADMIN` (manage team and settings), `RECRUITER` (candidates, interviews), `REVIEWER` (review evaluations).
- Candidates do not have accounts. They use an unguessable invite token (stored hashed) that grants access to one interview only.

## Testing policy

- Unit and route tests run without a database or network. Stores are in-memory fakes and provider HTTP is mocked.
- Passing tests show that our code handles the documented request and response shapes. They do not show that the live Gemini, DeepSeek, ElevenLabs or Deepgram APIs accept our requests.
- `docs/CHECKLIST.md` marks each integration as "tested with mocks" or "needs live verification".
