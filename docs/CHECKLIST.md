# Development Checklist

Legend:
- `[x]` done and verified (compiled and tests pass)
- `[~]` code written but NOT compiled or run yet
- `[ ]` not started

Live-API items stay in the "needs live verification" list until run with real keys.

## Blocker (2026-11-26)
The build sandbox runs in `INTEGRATIONS_ONLY` network mode, so `npm install` returns 403 for every package. Code written there could not be type-checked or tested. First step in an environment with npm access: `npm install && npm run db:generate && npm run typecheck && npm test`, then fix whatever fails and change `[~]` to `[x]`.

## Phase 0: Architecture
- [x] Architecture doc
- [~] Prisma schema (companies, users, invitations, candidates, templates, interviews, messages, evaluations, reviews, reports, AI usage). Not yet checked with `prisma validate`.
- [~] Monorepo scaffolding

## Phase 1: Backend foundation and auth
- [~] Env config with Zod validation (`src/config/env.ts`)
- [~] Logger with secret redaction, typed errors, error handler, request logger
- [~] Register (company + owner), login, refresh rotation with reuse detection, logout, `me`
- [~] Role-based authorization middleware
- [~] Team member invites (owner/admin), role changes, deactivation
- [~] Auth rate limiting
- [~] Tests: `tests/auth.test.ts`, `tests/team.test.ts`, `tests/env.test.ts` (in-memory repository, no DB)
- [ ] Invite emails (not implemented; inviter copies the link)
- [ ] First Prisma migration (`npm run db:migrate -- --name init`)

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
- [~] App shell (sidebar, mobile menu), routing, route guards
- [~] Login, register, accept-invite pages; session restore via refresh cookie; refresh serialized across tabs
- [~] Overview page (account, company, team stats for owner/admin)
- [~] Team page (invite with copyable link, revoke, role change, deactivate/reactivate)
- [~] Docker Compose for local testing (PostgreSQL + API + nginx-served web on :8080)
- [ ] HR dashboard sections for candidates, templates, interviews
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
