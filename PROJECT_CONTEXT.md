# PROJECT_CONTEXT.md — session handoff

<!-- Living doc. Update §5–§9 at the end of every session and at each phase boundary.
     Do NOT duplicate the spec docs — link to them. Keep it under ~2 min to read.
     Frozen specs: requirements.md, IMPLEMENTATION.md, DB_DESIGN.md, API_DESIGN.md, CODING_GUIDELINES.md -->

**Last updated:** 2026-09-06 — Backend Phase 1 (Foundation & Infrastructure) implemented and verified (Docker stack unverified locally — no Docker on the dev machine).

---

## 1. Project identity

Smart Interview Scheduler — a portal that automates coordinating interviews between a candidate,
recruiter, hiring manager, and panelists. A recruiter creates an interview request, the candidate
submits availability, the system pulls panelist free/busy from Google Calendar, a deterministic
engine generates valid slots, **scores/ranks/explains** them, the recruiter books one, and a real
Google Calendar event + Meet link is created with a confirmation.

Differentiator: *"Don't just schedule an interview. Explain why this is the best possible slot."*
The score breakdown + explanation are a persisted product surface, not a debug log.

Full spec: `requirements.md`. GitHub: `harshit0109/smart-interview-scheduler`.

---

## 2. Locked architecture — do not re-litigate

- Modular-monolith **FastAPI** backend + **Next.js 14** frontend. No microservices, no K8s/Kafka.
- Layering: **Router → Service → Engine → Repository**.
- The **Scheduling Engine is PURE**: `engine.py` / `scoring.py` / `explain.py` import nothing from
  `sqlalchemy`, `redis`, `httpx`/`requests`, `fastapi`, or any Google client. Zero I/O.
- **Two separate Google OAuth flows, never merged:** identity login (`openid`/`email`/`profile`)
  vs. Calendar connection (`calendar.events`/`calendar.freebusy`). Separate client configs,
  separate env var groups (`GOOGLE_LOGIN_OAUTH_*` vs `GOOGLE_CALENDAR_OAUTH_*`).
- Booking consistency = **compensating-action sequence, NOT a distributed transaction**. Google
  Calendar call happens outside any DB transaction; DB writes are Postgres-only. Compensating
  delete on DB failure; `reconciliation_tasks` row if the compensating delete also fails.
- **Deterministic 5-factor scoring** (timezone fairness, working-hours comfort, scheduling
  proximity, workload balance, buffer quality). No ML/LLM in the ranking path.
- PostgreSQL = single source of truth (ACID within Postgres only). Redis = booking lock +
  free/busy cache + rate-limit buckets only; losing Redis costs performance, never correctness.
- All timestamps `TIMESTAMPTZ` / UTC; local time only at the API/UI boundary.

Detail: `CODING_GUIDELINES.md`, `requirements.md` §7–§10, `DB_DESIGN.md`.

---

## 3. Ownership & responsibility boundary

- **Backend — Harshit** (this repo's FastAPI service): auth, calendar, users/RBAC, interview
  requests, availability, scheduling (service + pure engine), booking, notifications, audit;
  PostgreSQL schema + migrations, Redis, Google OAuth (both flows), Google Calendar API,
  SendGrid, infra (`docker-compose`, `.env.example`, CI, backend Dockerfile).
- **Frontend — teammate**: Next.js 14 + TypeScript + Tailwind + shadcn/ui; route groups
  `(admin)`/`(panelist)`/`(candidate)`; typed `lib/api-client.ts`; loading/error states;
  role-based UI hiding; the explainability UI (renders `score_breakdown` + `explanation`).
- **Rule:** do not implement, modify, or redesign frontend functionality unless Harshit
  explicitly asks.

### Integration points with the frontend (the seam)

| Seam | Contract |
|---|---|
| REST API | `API_DESIGN.md`, base `/api/v1`. Success = resource directly or `{ items, page, size, total }`. |
| Errors | Standard envelope `{ error: { code, message, field_errors, trace_id } }`; HTTP 401/403/404/409/422/424/429/500/502. |
| Auth | `Authorization: Bearer <JWT>` on all endpoints except `register`/`login`/`google`/`refresh`/`calendar/callback`. |
| Google identity login | Frontend gets Google ID token (identity scopes only) → `POST /auth/google { id_token }`. |
| Calendar connect | Frontend calls `POST /calendar/connect` → `authorization_url` → redirect → `GET /calendar/callback` (backend) → 302 to a frontend landing page. Poll `GET /calendar/status` for state. |
| Scoring JSON | Fixed keys: `timezone_fairness`, `working_hours_comfort`, `scheduling_proximity`, `workload_balance`, `buffer_quality`. Same JSON in the API response and in `recommended_slots.score_breakdown`. |

---

## 4. Backend layer boundaries (the most important internal rule)

| Layer | Files | Does | Must NOT |
|---|---|---|---|
| Router | `router.py` | HTTP wiring, declare required role, bind Pydantic schema. | Business logic; call Engine/Repository directly. |
| Service | `service.py` | Gather data (repos + Calendar integration + Redis cache), normalize to plain dataclasses, call the Engine once, persist results. Only layer allowed to touch both I/O and the Engine. | Contain scoring/ranking logic. |
| Engine | `engine.py`, `scoring.py`, `explain.py` (scheduling only) | Pure 10-step pipeline → 5-factor scoring → explanation. Plain data in, plain data out. | Any I/O; import sqlalchemy/redis/httpx/fastapi/Google client. |
| Repository | `repository.py` | Direct SQLAlchemy access. Only the owning module writes its tables. | Business rules; exist for trivial CRUD where one function is clearer. |

---

## 5. Completed work

- **Phase 0 — Documentation** (frozen). 7 docs on branch `main`: `README.md`, `CLAUDE.md`,
  `requirements.md`, `CODING_GUIDELINES.md`, `IMPLEMENTATION.md`, `DB_DESIGN.md`, `API_DESIGN.md`.
  Commits: `cc4b1a1` Initial commit, `ab68f74` requirements.
- **2026-09-06** — This context system: `PROJECT_CONTEXT.md` + an onboarding pointer in `CLAUDE.md`.
- **2026-09-06 — Backend Phase 1: Foundation & Infrastructure.**
  - `backend/` FastAPI service: `app/main.py` exposes only infra `GET /health` (SELECT 1 + Redis
    PING, never raises, returns `{status, checks}`, `200` even when a dependency is down).
  - `backend/app/core/`: `config.py` (pydantic-settings — `database_url`, `redis_url`,
    `environment` only), `db.py` (async SQLAlchemy engine, no models), `redis.py` (async client).
  - `backend/pyproject.toml` (deps + ruff config + setuptools build), `Dockerfile`, `.dockerignore`,
    `.env.example` (full var list; two Google OAuth groups kept separate).
  - `backend/tests/test_health.py` — smoke test.
  - Root: `docker-compose.yml` (db + redis + backend; `frontend` service commented out — teammate
    owns it), `.github/workflows/ci.yml` (setup-python → `ruff check` → `pytest`, with
    postgres/redis service containers), `.gitignore`.
  - `README.md` — added minimal "Repository layout" + "Local development" sections.
  - **Verified:** `ruff check` clean; `pytest` 1 passed; `uvicorn app.main:app` boots; `GET /health`
    → `200` `{"status":"degraded","checks":{"database":"error","redis":"error"}}` with no Postgres/
    Redis local; unknown path → `404`. **Not verified:** `docker compose up` (Docker not installed
    on the dev machine) — deferred to CI / a Docker host.

### Current backend structure

```
backend/
├── app/
│   ├── main.py            # FastAPI app + GET /health + lifespan cleanup
│   └── core/
│       ├── config.py      # Settings (pydantic-settings)
│       ├── db.py          # async SQLAlchemy engine (no models yet)
│       └── redis.py       # async Redis client
├── tests/test_health.py
├── pyproject.toml  ·  Dockerfile  ·  .dockerignore  ·  .env.example
```

Module folders (`auth/`, `calendar/`, `scheduling/`, …) are **not** created yet — each arrives
with its phase, per `CODING_GUIDELINES.md` §Modular design.

---

## 6. In progress / next immediate task

- **In progress:** nothing — Phase 1 complete and verified.
- **Next immediate step:** run CI once (push branch) to confirm green on GitHub Actions with the
  Postgres/Redis service containers, then **begin Phase 2 — Database & Authentication (login only)**
  (`IMPLEMENTATION.md` Phase 2): `users` + `calendar_connections` (schema-only) tables, Alembic
  migrations, password auth, Google **identity** login (identity scopes only), JWT access/refresh
  with `token_version`, `require_role()` dependency, and the global exception handler + standard
  error envelope.
- **Resolve before starting Phase 2 (see §8):** **C1** (open `register` role selection) and
  **G4** (`/auth/google` scope-claim check wording).

**MVP Acceptance Gate** (end of Phase 7): *"We can successfully demonstrate the complete core
interview scheduling loop from request creation to real Calendar booking."* — **not yet passed.**
No Post-MVP / Bonus work starts until it passes in full (incl. all 4 concurrency/failure tests).

---

## 7. Technical decisions log (append-only, newest first)

Decisions made during the build that are **not** already in the frozen specs.

- **2026-09-06 (Phase 1)** — Repo layout: backend lives in `backend/`, frontend will live in
  `frontend/`. The `app/...` paths in `CODING_GUIDELINES.md` map to `backend/app/...`.
- **2026-09-06 (Phase 1)** — `docker-compose.yml` at repo root; `frontend` service is committed
  **commented out** (frontend is the teammate's; `docker compose up` must not break before
  `frontend/` exists). Backend env example is `backend/.env.example`.
- **2026-09-06 (Phase 1)** — Dependency/build: `pyproject.toml` (setuptools), Python ≥3.12, image
  `python:3.13-slim`. Deps limited to what Phase 1 uses (fastapi, uvicorn, pydantic-settings,
  sqlalchemy[asyncio], asyncpg, redis; dev: pytest, httpx, ruff). Ruff lint rules `E,F,I,UP,B`.
- **2026-09-06 (Phase 1)** — `GET /health` is deliberately non-failing: it reports
  `database`/`redis` as `ok`/`error` and returns `200` with `status: ok|degraded`, so it is useful
  as a readiness signal before the stack is fully up. No `/api/v1` routes, no global exception
  handler yet (no typed exceptions exist until Phase 2).
- **2026-09-06 (Phase 1)** — `Settings` carries only `database_url`/`redis_url`/`environment` with
  local-dev defaults and `extra="ignore"`; the forward-looking vars in `.env.example` (JWT, OAuth,
  SendGrid) are documented now but added to `Settings` by the phase that consumes them.
- **2026-09-06** — Persistent cross-session context = a single `PROJECT_CONTEXT.md` + a pointer in
  `CLAUDE.md`. No multi-file memory system. This file is the shared, git-tracked, teammate-visible
  source of truth for project *state*; the frozen specs remain the source of truth for *design*.

---

## 8. Open questions / risks

Findings from the 2026-09-06 cross-document consistency review. **Architecture is not changed
silently** — each item is resolved with Harshit before the phase it affects.

### Blockers — resolve before the noted phase (none block Phase 1)

- **C1 (Phase 2):** `POST /auth/register` is public and takes a caller-chosen `role`, so anyone
  can self-register as ADMIN. Contradicts `requirements.md` §4 ("create user accounts: ADMIN
  only"). Decide: restrict self-signup to CANDIDATE + ADMIN-provisioned PANELIST/ADMIN, or accept
  as a documented hackathon seeding shortcut.
- **G4 (Phase 2):** `POST /auth/google` spec says to verify the token's `scope` claim contains no
  Calendar scope, but Google **ID tokens** carry no `scope` claim. Reword to: request only
  identity scopes client-side + verify `aud`/`iss`/`exp`; drop the scope-claim inspection.
- **C2 (Phase 3/4):** Nothing transitions `DRAFT → AWAITING_CANDIDATE_AVAILABILITY`. `POST
  /interviews` creates `DRAFT`; `POST /interviews/{id}/candidate-availability` requires
  `AWAITING_CANDIDATE_AVAILABILITY`. Decide: create directly in `AWAITING_CANDIDATE_AVAILABILITY`,
  or add an explicit "send to candidate" transition.
- **G2 (Phase 3 schema / Phase 5):** `requirements.md` §7b mentions per-participant working-hours
  and per-panelist buffer *overrides*, but no schema stores them. Decide: MVP uses org-default
  constants only (mark overrides Post-MVP), or add columns now.
- **G1 (Phase 5):** Workload Balance (§8) needs per-panelist same-day booked-interview counts, but
  §7b's Engine input list omits them. The Service must gather this from `interview_events` and
  pass it into the Engine as normalized input; name it explicitly.
- **G3 (Phase 6 / frontend integration):** `requirements.md` §4 grants CANDIDATE read-only viewing
  of `score_breakdown`, but `POST /recommendations` is ADMIN-only and `GET /interviews/{id}` only
  promises a "summary". Decide whether `GET /interviews/{id}` returns full `recommended_slots` for
  the owning candidate, or add a read endpoint.

### Non-critical — resolve when relevant

- **C3:** `IMPLEMENTATION.md` phase-duration percentages sum to ~115% (likely intentional
  Phase 9 ∥ Phase 10 overlap). Cosmetic; add a footnote when convenient.
- **G5:** Nothing transitions `BOOKED → COMPLETED` (no endpoint/phase/job). Treat as manual/future.
- **G6:** `candidate_availability` schema implies multiple submissions per request; the API allows
  one (state moves off `AWAITING_CANDIDATE_AVAILABILITY`). Fine for MVP; when Phase 9 re-opens it,
  sort by `submitted_at` for "latest wins".
- **G7:** `GET /calendar/status` is not listed under any `IMPLEMENTATION.md` phase — fold into
  Phase 6.
- **G8:** Two distinct "horizon" values — candidate-availability submission horizon (~21 days) vs
  Scheduling Proximity scoring decay `horizon_days` (~14). Keep as two separately named constants.

### Environment gotchas

- **Nested git repos:** the parent folder `…/smart interview scheduler/` has its own empty `.git`
  (branch `master`, 0 commits). The real project is the inner `…/smart-interview-scheduler/`
  (branch `main`, remote `harshit0109/smart-interview-scheduler`). **Always work from the inner
  folder.** Consider removing the outer `.git`.
- **Docker is not installed on the dev machine.** Phase 1's `docker-compose.yml` / `Dockerfile`
  are written to spec but `docker compose up` is **unverified locally** — first real exercise is
  GitHub Actions CI (service containers) or any Docker host. Backend itself is verified via a local
  venv (`ruff`, `pytest`, `uvicorn`).
- **Python launcher:** `python` is the broken Windows Store shim; use `py` (Python 3.13 present).
- **Phase 1 deviation from the literal phase text:** the Next.js placeholder / `frontend` service
  was **not** created (frontend is the teammate's). The `frontend` block in `docker-compose.yml` is
  committed commented-out. `IMPLEMENTATION.md` Phase 1's "empty frontend" item is left to the
  frontend owner.
- `README.md` is still minimal; full setup + the required "AI Usage" section are finalized in
  Phase 12.
