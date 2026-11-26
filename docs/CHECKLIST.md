# Development Checklist

Legend: `[x]` done and verified here, `[ ]` not started. Live-API items stay in the "needs live verification" list until run with real keys.

## Phase 0: Architecture
- [x] Architecture doc
- [x] Prisma schema (companies, users, candidates, templates, interviews, messages, evaluations, reviews, reports, AI usage)
- [x] Monorepo scaffolding

## Blocker (2026-11-26)
The current sandbox runs in `INTEGRATIONS_ONLY` network mode, so `npm install` returns 403 for every package. Phase 1 cannot be built or tested here until dependencies can be installed.

## Phase 1: Backend foundation and auth
- [ ] Env config with Zod validation
- [ ] Logger, typed errors, error handler
- [ ] Register (company + owner), login, refresh rotation, logout, `me`
- [ ] Role-based authorization middleware
- [ ] Team member invites (owner/admin)
- [ ] Tests (in-memory store)

## Phase 2: Recruiting domain
- [ ] Candidates CRUD
- [ ] Interview templates (context configuration)
- [ ] Interview creation and invite links

## Phase 3: AI provider layer
- [ ] AIProvider interface, timeout, retry, logging
- [ ] GeminiProvider
- [ ] DeepSeekProvider
- [ ] AIProviderManager with configurable fallback
- [ ] Usage tracking and cost estimation
- [ ] Response validator

## Phase 4: Text interview engine
- [ ] Prompt builder from interview context
- [ ] InterviewAIService, QuestionGenerationService, AdaptiveInterviewService
- [ ] Candidate interview API (invite token)

## Phase 5: Voice
- [ ] Gemini Live ephemeral token endpoint
- [ ] Transcript ingestion
- [ ] Optional Deepgram / ElevenLabs

## Phase 6: Evaluation and reports
- [ ] TechnicalEvaluationService with evidence checks
- [ ] ReportGenerationService
- [ ] Human review and overrides

## Phase 7: Frontend
- [ ] App shell, auth, routing
- [ ] HR dashboard, candidates, templates, interviews
- [ ] Candidate interview room (text, voice, optional camera preview)
- [ ] Review and report views, history
- [ ] Company analytics

## Phase 8: Docs and hardening
- [ ] SETUP.md with credentials and run instructions
- [ ] Rate limits, security review

## Needs live verification (cannot be confirmed without real keys)
- Gemini text generation and structured output
- Gemini Live ephemeral tokens and WebSocket session
- DeepSeek chat completions with JSON output
- ElevenLabs TTS, Deepgram STT
- Database migrations against a real PostgreSQL
