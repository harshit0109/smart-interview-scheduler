# PROJECT_CONTEXT.md — session handoff

<!-- Living doc. Update §5–§9 at the end of every session and at each phase boundary.
     Do NOT duplicate the spec docs — link to them. Keep it under ~2 min to read.
     Frozen specs: requirements.md, IMPLEMENTATION.md, DB_DESIGN.md, API_DESIGN.md, CODING_GUIDELINES.md -->

**Last updated:** 2026-09-06 — Backend Phase 3 (Interview Request Management) complete and committed (`b6256a4`). Phase 4 (Candidate Availability) implemented, verified, awaiting commit approval.

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

- **2026-09-06 — Backend Phase 2: Database & Authentication (login only).** Commit `44599f9`.
  - `backend/app/auth/`: `register` (public, **CANDIDATE-only** — see C1 resolution), `login`
    (password), `google` (Google **identity** token verification — aud/iss/exp, see G4), `refresh`
    (JWT refresh with `token_version`). `schemas.py` / `service.py` / `repository.py` / `router.py`
    / `google.py`.
  - `backend/app/users/`: `GET /users/me`.
  - `backend/app/core/`: `models.py` (`User`, `CalendarConnection` — the latter schema-only),
    `security.py` (bcrypt + PyJWT access/refresh), `deps.py` (`get_current_user`, `require_role()`),
    `errors.py` (typed `AppError`s + global handler → standard envelope), `db.py` (async session +
    `get_db`).
  - Alembic: `backend/alembic.ini`, `backend/migrations/` (async `env.py`), migration `0001`
    (`users`, `calendar_connections`).
  - `backend/scripts/seed.py` — provisions ADMIN + PANELIST accounts (public register can't).
  - Routes mounted under `/api/v1`. New deps: `alembic`, `bcrypt`, `pyjwt`, `google-auth[requests]`,
    `tzdata`, `pydantic[email]`. CI gained an `alembic upgrade head` step; Dockerfile runs migrations
    on start.
  - **Verified:** `alembic upgrade head` + down/up roundtrip clean; `ruff` clean; `pytest` 23
    passed (auth flow, RBAC 403/401, "Google login writes no `calendar_connections`", bcrypt/JWT
    units). `docker compose up --build` → backend healthy, `/health` 200.

- **2026-09-06 — Backend Phase 3: Interview Request Management.** Commit `b6256a4`.
  - `backend/app/interviews/` (`schemas`/`repository`/`service`/`router`): `POST /interviews`
    (ADMIN — validates candidate is a CANDIDATE + each panelist a PANELIST, unknown id → 404,
    wrong role → 422 `INVALID_PARTICIPANT`), `GET /interviews` (role-filtered + paginated),
    `GET /interviews/{id}` (ADMIN or participant; non-participant → 404), `PATCH /interviews/{id}`
    (ADMIN, state-gated → 409 `REQUEST_LOCKED_FOR_EDITING`).
  - `backend/app/core/`: `pagination.py` (`Page[T]` + `page_params`), `audit.py` (`record_audit()`),
    `models.py` gained `InterviewRequest` / `InterviewParticipant` / `AuditLog`, `errors.py` gained
    `NotFoundError` / `InvalidParticipantError` / `RequestLockedForEditingError`.
  - Migration `0002` (`interview_requests`, `interview_participants`, `audit_logs`). `status` is
    `VARCHAR(40)` (DB_DESIGN's 30 can't hold `AWAITING_CANDIDATE_AVAILABILITY`).
  - `pyproject.toml` packaging: `packages.find` include `app*` so subpackages ship in a
    non-editable / Docker build (the old `packages = ["app"]` dropped them).
  - **Verified:** `alembic` up/down/up clean; `ruff` clean; `pytest` 38 passed; `docker compose
    build backend` → `/health` ok, routes present.

- **2026-09-06 — Backend Phase 4: Candidate Availability.** *Awaiting commit approval.*
  - `backend/app/availability/` (`schemas`/`repository`/`service`/`router`):
    `POST /interviews/{id}/candidate-availability` (CANDIDATE, own request only → else 403;
    request must be `AWAITING_CANDIDATE_AVAILABILITY` → else 409 `REQUEST_NOT_AWAITING_AVAILABILITY`;
    1–10 windows, each offset-aware ISO8601 stored UTC, `end > start`, future, within a 21-day
    horizon; validation errors are `422` with `field_errors` keyed by window index; success
    transitions the request `→ READY_FOR_SCHEDULING` and writes `audit_logs`),
    `GET /interviews/{id}/availability` (ADMIN or owning CANDIDATE; anyone else → 404).
  - `backend/app/core/validators.py` — shared `valid_iana_timezone`, now used by both `auth` and
    `availability` schemas. `errors.py` gained `RequestNotAwaitingAvailabilityError` (409).
    `models.py` gained `CandidateAvailability` / `AvailabilityWindow`.
  - Migration `0003` (`candidate_availability`, `availability_windows`).
  - **Verified:** `alembic` up/down/up clean; `ruff` clean; `pytest` 55 passed;
    `docker compose build backend` → `/health` ok, both new routes present.

### Current backend structure

```
backend/
├── app/
│   ├── main.py            # FastAPI app + GET /health + /api/v1 routers
│   ├── auth/              # register / login / google / refresh
│   ├── users/             # GET /users/me
│   ├── interviews/        # POST/GET/GET{id}/PATCH /interviews
│   ├── availability/      # POST/GET candidate availability (nested under /interviews/{id})
│   └── core/
│       ├── config.py      # Settings (pydantic-settings)
│       ├── db.py          # async engine + session dependency
│       ├── models.py      # User, CalendarConnection, InterviewRequest,
│       │                  #   InterviewParticipant, CandidateAvailability,
│       │                  #   AvailabilityWindow, AuditLog
│       ├── security.py    # bcrypt + JWT
│       ├── deps.py        # get_current_user, require_role()
│       ├── errors.py      # typed errors + global handler
│       ├── pagination.py  # Page[T] + page_params
│       ├── audit.py       # record_audit()
│       ├── validators.py  # valid_iana_timezone
│       └── redis.py       # async Redis client
├── migrations/            # Alembic (env.py + versions/0001..0003)
├── scripts/seed.py
├── tests/  (test_health, test_security, test_auth, test_rbac, test_interviews, test_availability)
├── pyproject.toml  ·  alembic.ini  ·  Dockerfile  ·  .dockerignore  ·  .env.example
```

Remaining module folders (`scheduling/`, `booking/`, …) arrive with their phase,
per `CODING_GUIDELINES.md` §Modular design.

---

## 6. In progress / next immediate task

- **In progress:** **Phase 4 — Candidate Availability** — implemented and verified locally,
  awaiting commit approval. `app/availability/` module, migration `0003`, the two
  `/interviews/{id}/(candidate-availability|availability)` endpoints, the
  `AWAITING_CANDIDATE_AVAILABILITY → READY_FOR_SCHEDULING` transition. No scoring / scheduling.
- **Phase 4 decisions taken (see §7):** offset-aware ISO8601 windows only (naive rejected),
  stored UTC; submitted `timezone` is per-submission metadata; `AVAILABILITY_HORIZON_DAYS = 21`
  (named separately from the Phase 5 scoring proximity horizon — G8); wrong-candidate → 403,
  unauthorised reader → 404.
- **Next:** Phase 5 — Scheduling Engine (pure business logic). **Do not start until Phase 4 is
  committed.** G1 (Workload Balance input naming) must be resolved before Phase 5.

**MVP Acceptance Gate** (end of Phase 7): *"We can successfully demonstrate the complete core
interview scheduling loop from request creation to real Calendar booking."* — **not yet passed.**
No Post-MVP / Bonus work starts until it passes in full (incl. all 4 concurrency/failure tests).

---

## 7. Technical decisions log (append-only, newest first)

Decisions made during the build that are **not** already in the frozen specs.

- **2026-09-06 (Phase 4)** — Candidate availability windows must be **offset-aware ISO8601**
  (naive datetimes → `422`); they are normalised to UTC before persistence (requirements.md §13
  DST safety). The submission's `timezone` field is stored verbatim as per-submission metadata
  (DB_DESIGN.md — not read from `users.timezone`) for Phase 5 scoring. `AVAILABILITY_HORIZON_DAYS
  = 21` lives in `app/availability/schemas.py`, deliberately distinct from the Scheduling
  Proximity `horizon_days` (~14) of Phase 5 (G8). One submission per request in the MVP — the
  `AWAITING_CANDIDATE_AVAILABILITY` state gate enforces it; the schema allows more rows for the
  Post-MVP re-submission flow (G6). Wrong-candidate submit → `403`; a non-ADMIN/non-owner reading
  `GET .../availability` → `404` (per `API_DESIGN.md`).
- **2026-09-06 (Phase 3, D1 — resolves C2)** — `POST /interviews` creates a request **directly in
  `AWAITING_CANDIDATE_AVAILABILITY`**, not `DRAFT`. Deviation from `API_DESIGN.md` (which says
  `status: DRAFT`): the Core Demo Loop and API surface have no separate "send to candidate" step,
  so ADMIN creating the request *is* that step. `DRAFT` stays a valid `CHECK` value for state-machine
  integrity but is never persisted by any endpoint.
- **2026-09-06 (Phase 3, D2 — resolves G2 for MVP)** — No per-participant working-hours or
  per-panelist buffer override columns. MVP scoring (Phase 5) uses the request-level `buffer_minutes`
  and a global working-hours constant. Overrides are Post-MVP.
- **2026-09-06 (Phase 3, D3)** — `audit_logs` table created now (migration `0002`) with a minimal
  `app/core/audit.py::record_audit()` helper, called on interview create/update. No audit
  endpoint/UI (that is Post-MVP, Phase 9). FR-037 "opportunistic" writes begin here.
- **2026-09-06 (Phase 2, C1 resolved)** — `POST /auth/register` is **CANDIDATE-only**: it ignores
  any client-supplied role and always creates a `CANDIDATE`. ADMIN and PANELIST accounts are
  provisioned out of band via `backend/scripts/seed.py`. `API_DESIGN.md`'s `register` body still
  lists `role`; treat that field as removed for the MVP.
- **2026-09-06 (Phase 2, G4 resolved)** — `POST /auth/google` verifies the Google **ID token** by
  signature + `aud` (our login client id) + `iss` (`accounts.google.com`) + `exp` + `email_verified`
  (via `google-auth`). There is **no** `scope`-claim inspection — Google ID tokens carry none;
  identity-only scope is enforced client-side. The endpoint never touches `calendar_connections`.
- **2026-09-06 (Phase 2)** — Migrations: Alembic (async `env.py`, URL/metadata from app config).
  Tests run the real migrations once per session then truncate between tests. CI runs
  `alembic upgrade head` before `pytest`; the backend container runs it on startup.
- **2026-09-06 (Phase 2)** — `tzdata` is a hard runtime dep (Windows / `python:3.13-slim` ship no
  zoneinfo DB, which the `timezone` validator needs). `google-auth[requests]` (not bare
  `google-auth`) — the `requests` transport is required but not a declared dep.
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

- **C1 (Phase 2) — RESOLVED 2026-09-06.** `POST /auth/register` is CANDIDATE-only (ignores any
  supplied role); ADMIN/PANELIST via `scripts/seed.py`. See §7.
- **G4 (Phase 2) — RESOLVED 2026-09-06.** `POST /auth/google` verifies signature + `aud`/`iss`/`exp`
  + `email_verified`; no `scope`-claim inspection; never touches `calendar_connections`. See §7.
- **C2 (Phase 3/4) — RESOLVED 2026-09-06 (D1).** `POST /interviews` creates directly in
  `AWAITING_CANDIDATE_AVAILABILITY`; no "send to candidate" transition. See §7.
- **G2 (Phase 3 schema / Phase 5) — RESOLVED 2026-09-06 (D2).** No override columns; MVP uses
  request-level `buffer_minutes` + a global working-hours constant. Overrides are Post-MVP. See §7.
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
- **G6 — HANDLED (Phase 4).** MVP allows one submission; the `AWAITING_CANDIDATE_AVAILABILITY`
  state gate enforces it. `repository.get_latest()` already sorts by `submitted_at` desc, so the
  Post-MVP re-submission flow (Phase 9) is a state-machine change only.
- **G7:** `GET /calendar/status` is not listed under any `IMPLEMENTATION.md` phase — fold into
  Phase 6.
- **G8 — HANDLED (Phase 4).** `AVAILABILITY_HORIZON_DAYS = 21` in `app/availability/schemas.py`;
  the Phase 5 Scheduling Proximity `horizon_days` (~14) will be a separate, separately-named
  constant in the engine module.

### Environment gotchas

- **Nested git repos:** the parent folder `…/smart interview scheduler/` has its own empty `.git`
  (branch `master`, 0 commits). The real project is the inner `…/smart-interview-scheduler/`
  (branch `main`, remote `harshit0109/smart-interview-scheduler`). **Always work from the inner
  folder.** Consider removing the outer `.git`.
- **Docker now works on the dev machine** (verified Phase 1 onward). `docker compose up --build`
  brings up db + redis + backend; the backend container runs `alembic upgrade head` on start.
- **Host port 5432 is contended:** a native `postgresql-x64-18` Windows service listens on 5432
  alongside the Docker forward, so host→container auth to `localhost:5432` can hit the native PG
  and fail. Tests need that native service **stopped** (or its `sis` role password aligned).
  CI is unaffected (isolated service containers).
- **Python launcher:** `python` is the broken Windows Store shim; use `py` (Python 3.13 present).
- **Phase 1 deviation from the literal phase text:** the Next.js placeholder / `frontend` service
  was **not** created (frontend is the teammate's). The `frontend` block in `docker-compose.yml` is
  committed commented-out. `IMPLEMENTATION.md` Phase 1's "empty frontend" item is left to the
  frontend owner.
- `README.md` is still minimal; full setup + the required "AI Usage" section are finalized in
  Phase 12.
