# Setup

This file grows with each phase. It currently covers the backend foundation (Phase 1).

## Requirements
- Node.js 20 or newer (developed against Node 22)
- PostgreSQL 14 or newer

## 1. Install
```bash
npm install
```

## 2. Configure
```bash
cp apps/api/.env.example apps/api/.env
```
Required values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | At least 32 random characters, e.g. `openssl rand -hex 32` |

Optional values have defaults; see comments in `apps/api/.env.example`. The server validates the whole file at startup and prints every invalid variable by name.

AI provider keys (`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`) are not used yet. They become relevant from Phase 3 onward. Keep them in `apps/api/.env` only; never put them in the frontend.

## 3. Database
A local PostgreSQL via Docker:
```bash
docker run -d --name adi-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_interview -p 5432:5432 postgres:16
```
Create the first migration and generate the client:
```bash
npm run db:migrate -- --name init
```

## 4. Run and test
```bash
npm run dev:api        # http://localhost:4000/api/health
npm test               # Vitest, no database or network needed
npm run typecheck
```

## Phase 1 API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create company + owner. Body: `companyName, name, email, password` |
| POST | `/api/auth/login` | public | Body: `email, password` |
| POST | `/api/auth/refresh` | refresh cookie | Rotates the refresh token, returns a new access token |
| POST | `/api/auth/logout` | refresh cookie | Revokes the current refresh token |
| GET | `/api/auth/me` | bearer | Current user |
| GET | `/api/team/members` | owner, admin | List members |
| PATCH | `/api/team/members/:id` | owner, admin | Body: `role?`, `isActive?` |
| GET | `/api/team/invitations` | owner, admin | Pending invitations |
| POST | `/api/team/invitations` | owner, admin | Body: `email, role`. Returns `inviteUrl` (shown once) |
| DELETE | `/api/team/invitations/:id` | owner, admin | Revoke |
| GET | `/api/invitations/:token` | public | Invitation details for the accept page |
| POST | `/api/invitations/accept` | public | Body: `token, name, password` |

Errors always have the shape `{ "error": { "code": "...", "message": "...", "details"?: ... } }`.
