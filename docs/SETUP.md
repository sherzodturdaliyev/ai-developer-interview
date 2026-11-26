# Setup

This file grows with each phase. It currently covers the backend foundation (Phase 1) and the web UI for it.

## Quick test with Docker (recommended)

Needs only [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Create `.env` in the repository root:
   ```bash
   cp .env.example .env
   ```
   Set `JWT_ACCESS_SECRET` to any random string of 32+ characters, for example the output of `openssl rand -hex 32`.
2. Start everything:
   ```bash
   docker compose up --build
   ```
3. Open http://localhost:8080

### What to try
1. **Register** a company. You become its owner.
2. Open **Team** and invite a colleague as Recruiter. Copy the invite link.
3. Open the link in a private/incognito window, set a name and password. The new member appears in the team list.
4. As the owner, change the member's role, deactivate them, and confirm they are signed out in the other window on their next action.
5. Reload the page: you stay signed in (refresh cookie). Click the sign-out icon: you are signed out.

Stop with `Ctrl+C`. `docker compose down -v` also deletes the database.

## Local development without Docker

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
npm run dev:web        # http://localhost:5173 (proxies /api to :4000)
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
