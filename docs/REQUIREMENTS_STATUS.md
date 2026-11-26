# Requirements status

How each original requirement maps to the code. "Written" means the code exists but has not been compiled or run, because the build sandbox has no npm access. "Planned" means the phase that will implement it.

## Platform

| Requirement | Status | Where |
|---|---|---|
| Authentication and authorization | Written | `apps/api/src/modules/auth`, `middleware/auth.ts`, web `auth/` |
| Company workspace (multi-tenant) | Written | Every query scoped by `companyId` from the token |
| Team roles and invitations | Written | `modules/team`, web `pages/TeamPage.tsx` |
| HR dashboard | Partly written | Overview page; candidate and interview sections in Phase 2 |
| Candidate management | Planned (Phase 2) | Schema: `Candidate` |
| Interview configuration (position, seniority, language, categories, duration, difficulty, interview language, rules, criteria) | Planned (Phase 2) | Schema: `InterviewTemplate`, snapshot on `Interview.configSnapshot` |
| Interview history | Planned (Phase 2/6) | Schema: `Interview`, `InterviewMessage` |
| Company analytics | Planned (Phase 7) | Schema: `Interview`, `Evaluation`, `AiUsageLog` |
| Optional camera | Planned (Phase 5) | Candidate-side preview only, with consent; never sent to AI or stored |
| Professional SaaS UI, no fake buttons | Written for implemented features | Navigation shows only sections that work |

## AI

| Requirement | Status | Where |
|---|---|---|
| Gemini as interviewer; DeepSeek for technical evaluation | Config written; providers planned (Phase 3) | `AI_INTERVIEW_PROVIDER`, `AI_EVALUATION_PROVIDER` in `config/env.ts` |
| Switch providers through backend config; configurable fallback | Config written; manager planned (Phase 3) | `*_FALLBACK_PROVIDER`; must differ from primary |
| Models from env only, no hardcoded names | Config written | `GEMINI_MODEL`, `GEMINI_LIVE_MODEL`, `DEEPSEEK_MODEL` |
| Keys never in frontend | Enforced by design | Keys exist only in API env; the web app calls only `/api` |
| Timeouts, retries, logging, usage tracking | Config written; implementation Phase 3 | `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES`, schema `AiUsageLog` |
| Missing credentials: clear error, no fake AI | Planned (Phase 3) | Will return HTTP 503 `AI_NOT_CONFIGURED` |
| One question at a time, adaptive difficulty, no repeats, respects duration | Planned (Phase 4) | `Interview.state` tracks asked topics and difficulty |
| Gemini Live voice with temporary credentials | Planned (Phase 5) | Ephemeral tokens minted by the API |
| ElevenLabs TTS, Deepgram STT (optional) | Planned (Phase 5) | Enabled only when keys are set |
| Evaluation separate from conversation, evidence-based | Planned (Phase 6) | Schema: `Evaluation`, `CriterionScore.evidence` |
| Human review and overrides | Planned (Phase 6) | Schema: `Review`; AI values are never overwritten |
| Structured reports stored in DB | Planned (Phase 6) | Schema: `Report` |
| No evaluation on appearance, emotion, gender, age, ethnicity, accent | Enforced by design | Evaluation receives transcript text only |
| Tests with mocked HTTP; untested live integrations labelled | Policy in place | `docs/ARCHITECTURE.md` testing policy, `docs/CHECKLIST.md` |
