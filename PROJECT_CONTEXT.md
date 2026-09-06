# PROJECT_CONTEXT.md — session handoff

<!-- Living doc. Update §5–§9 at the end of every session and at each phase boundary.
     Do NOT duplicate the spec docs — link to them. Keep it under ~2 min to read.
     Frozen specs: requirements.md, IMPLEMENTATION.md, DB_DESIGN.md, API_DESIGN.md, CODING_GUIDELINES.md -->

**Last updated:** 2026-09-06 — Backend Phases 1–11 (partial, rate limiting) complete and committed on `main`. **Phase 10 — frontend/backend integration** done: the Next.js 14 frontend (subtree-checked into `frontend/smart-interview-scheduler-frontend/`) is now wired to the **real backend** (mock/demo auth removed), talking to it through a Next.js **same-origin `/api` rewrite proxy** (no backend CORS). One minimal backend capability added: `GET /api/v1/users?role=CANDIDATE|PANELIST` (ADMIN-only) for interview-creation user discovery (FR-012). Google Identity login **deferred**; Post-MVP lifecycle UI (decline/reschedule/cancel/audit) **not built in the frontend**; `docker-compose` frontend container **deferred**. **New real-world onboarding/invitation architecture started:** Phase A (invitation schema, migration `0007`), Phase B (`POST /users` ADMIN provisioning + `POST /auth/bootstrap-admin` first-ADMIN web setup + `/setup` frontend route), Phase C (admin RBAC fix + misleading-copy/UI cleanup), and Phase C3/C4 (admin interview-creation wizard rebuild, `interview_requests.title` wired into the API) are committed locally on `main`, **not yet pushed**. Current migration head: `0007` (no new migration in C3/C4 — `title` already existed as a column, just wasn't exposed by the API). Invitation token issuance/dispatch is **not yet built** — the next phase.

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

- **2026-09-06 — Backend Phase 4: Candidate Availability.** Commit `54508b3`.
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

- **2026-09-06 — Backend Phase 5: Scheduling Engine (pure business logic).** Commit `12d8f19`.
  - `backend/app/scheduling/` — **pure, zero I/O** (stdlib only; `test_engine_purity.py` enforces
    no `sqlalchemy`/`redis`/`httpx`/`fastapi`/Google/`app.*`-outside-`scheduling` imports, no
    `datetime.now()`, no `random`):
    - `types.py` — `EngineInput` / `EngineResult` / `ScoredSlot` / `ScoreBreakdown` /
      `Participant` / `CandidateWindow` / `SchedulingConstraints` / `ScoringWeights` (§8 defaults)
      / `WorkingHours` / `TimeInterval`, and `SchedulingEngineError(Exception)`.
    - `engine.py` — `generate_recommendations(EngineInput) -> EngineResult`, the full 10-step
      pipeline (normalize → validate → merge → per-participant free intervals → sweep-line
      intersection → duration+2×buffer / working-hours constraints → slide slots at 15-min steps →
      score → rank desc, tie-break earlier `start_time` → top-N, default 3).
    - `scoring.py` — the five §8 factors as independent pure functions (timezone fairness = **min**
      across participants; working-hours comfort = **min**; scheduling proximity `1 − days/horizon`,
      `PROXIMITY_HORIZON_DAYS = 14`; workload balance `1/(1+count)` **averaged** over panelists,
      bucketed by each panelist's local day; buffer quality `(min(gap)−buffer)/buffer` clamped) +
      `weighted_total`.
    - `explain.py` — deterministic explanation string naming the top 1–2 factors by weighted
      contribution + one honest trade-off; returns `relevant_reasoning_factors`.
  - `backend/scripts/engine_demo.py` — `python -m scripts.engine_demo`, fixed synthetic 3-participant
    input + fixed `reference_time`, prints ranked/scored/explained slots.
  - **No** migration, **no** endpoint, **no** dependency, **no** `main.py` change.
  - **Verified:** `ruff` clean; `pytest` 94 passed; demo prints 3 ranked slots deterministically.

- **2026-09-06 — Backend Phase 6: Calendar Integration & Scheduling Service.** Commit `8831f99`.
  - `backend/app/calendar/` — the **separate** Calendar OAuth flow (never merged with login):
    `client.py` (single async-`httpx` Google seam: `authorization_url` / `exchange_code` /
    `refresh` / `free_busy` + 3-try exp-backoff on transport/5xx/429; `invalid_grant`/401 →
    `CalendarAuthError`, no retry), `service.py` (connect-URL + signed state, callback exchange →
    **encrypt** + upsert + `audit_logs("CALENDAR_CONNECTED")`, `get_status`, `ensure_usable`
    = silent refresh on `EXPIRED`/near-expiry → `REVOKED` on failed refresh, `get_free_busy` with
    Redis `freebusy:{uid}:{hash}` 15-min cache), `repository.py`, `schemas.py`, `router.py`
    (`POST /calendar/connect` [ADMIN|PANELIST], `GET /calendar/callback` [signed state; 302 to
    `${FRONTEND_BASE_URL}/calendar/(connected|error)`], `GET /calendar/status` [ADMIN|PANELIST]).
  - `backend/app/core/crypto.py` — Fernet `encrypt`/`decrypt` for tokens at rest. Sentinel key
    `"dev"` derives a throwaway local key; **`environment=production` + no real key → refuses**
    (`TokenCryptoError`).
  - `backend/app/scheduling/` gained the layer files around the frozen engine: `service.py`
    (`generate()` — status gate → resolve panelist connections → free/busy → build `EngineInput`
    with `reference_time = now(UTC)` and `existing_bookings = {}` → call engine → persist +
    transition + audit; drops/clips windows that passed while the request waited), `repository.py`
    (`recommendation_runs` / `recommended_slots`), `router.py` (`POST /interviews/{id}/
    recommendations` [ADMIN]), `schemas.py`.
  - `models.py`: `RecommendationRun`, `RecommendedSlot`. `errors.py`: `NotReadyForSchedulingError`
    (409), `PanelistCalendarNotConnectedError` / `CalendarConnectionRevokedError` /
    `CalendarConnectionExpiredError` (424), `NoCommonAvailabilityError` (422),
    `CalendarSyncFailedError` (502). `security.py`: `create_calendar_state_token` +
    `TokenType` gains `"calendar_state"`. `config.py`: `google_calendar_oauth_*`,
    `calendar_token_encryption_key`, `frontend_base_url`, `calendar_state_ttl_seconds`.
  - `GET /interviews/{id}` now includes `recommended_slots` (latest run) for ADMIN + the owning
    candidate (D-5 / resolves G3 — via the frozen endpoint, no new GET route invented).
  - Migration `0004` (`recommendation_runs`, `recommended_slots`). New deps: `httpx` (→ prod),
    `cryptography`.
  - **Verified:** `alembic` up/down/up clean; `ruff` clean; `pytest` 118 passed + 1 skipped;
    `docker compose build backend` → `/health` ok, 14 routes.

- **2026-09-06 — Backend Phase 7: Booking & Conflict Prevention (the MVP Acceptance Gate).**
  *Awaiting commit approval.*
  - `backend/app/booking/` — `POST /interviews/{id}/book` [ADMIN], the 8-step §10 sequence in
    `service.py`: Redis `SET NX EX 10` lock (`app/core/locks.py`, token-guarded release; Redis
    down → warn + proceed, the partial unique index is the guard) → re-validate slot is from the
    latest run + request `RECOMMENDED` → conflict check (any `CONFIRMED` `interview_events`) →
    `calendar_service.create_event` on the **first assigned panelist's** calendar (`conferenceData`
    → Meet), **outside any DB txn** → Postgres-only persist (`interview_events` CONFIRMED +
    status `→ BOOKED` + winning `recommended_slots.is_selected` + audit `INTERVIEW_BOOKED`) →
    commit → release. `_compensate()` on a step-6 failure: delete the Calendar event; if that
    also fails, `reconciliation_tasks (OPEN, external_calendar_event_id, COMPENSATING_DELETE_FAILED)`.
    Unique-index violation in step 6 → compensate → `409 SLOT_NO_LONGER_AVAILABLE` (D-3); any other
    step-6 failure → compensate → `500 BOOKING_PERSISTENCE_FAILED`. Success is only ever reported
    after the commit.
  - `app/calendar/client.py`: `create_event` / `delete_event` (+ `_post`→`_request(method,…)` for
    DELETE; `CalendarEvent` dataclass). `app/calendar/service.py`: `create_event(access_token,…)` /
    `delete_event(access_token,…)` / `access_token_of(conn)` — the token is captured as a local
    **before** step 6 so a rollback (which expires the row) can't force an async lazy-load in the
    compensation path.
  - `models.py`: `InterviewEvent` (+ partial unique index `WHERE status='CONFIRMED'`),
    `ReconciliationTask`. `errors.py`: `SlotNoLongerAvailableError` (409),
    `CalendarEventCreationFailedError` (502), `BookingPersistenceFailedError` (500).
  - `SlotOut` gained `id` (the `recommended_slot_id` `POST /book` needs — API_DESIGN's response
    example omitted it); `POST /recommendations` and `GET /interviews/{id}` now return it from the
    persisted rows. `GET /interviews/{id}` gained `booked_event` (D-5) for anyone who can view the
    request. Migration `0005` (`interview_events`, `reconciliation_tasks`).
  - `migrations/env.py`: `fileConfig(..., disable_existing_loggers=False)` — alembic's default was
    silencing every `app.*` logger when migrations run in-process (tests, container start).
  - **Verified:** `alembic` up/down/up clean (head `0005`); `ruff` clean; `pytest` **133 passed +
    1 skipped** — the 4 mandatory gate tests pass (full loop → 201 + Meet link; two-booking
    conflict via held-lock / existing-CONFIRMED / partial-unique-index backstops; DB-fail →
    compensating delete + no success; compensating-delete-fail → `reconciliation_tasks` row + no
    success). `docker compose build backend` → `/health` ok, 15 routes. Frozen engine files
    unchanged. No token in any schema, log, audit row, or reconciliation metadata (asserted).
  - **Committed `82764be`.**

- **2026-09-06 — Backend Phase 8: Booking Confirmation (FR-030).** Commit `290af4f`.
  - `backend/app/notifications/` — confirmation email only. `client.py` (single SendGrid HTTP seam,
    one `httpx` POST, no vendor SDK; `configured` = has an API key), `service.py`
    (`send_booking_confirmation` — **never raises**: `SIMULATED` when no API key [logs the full
    "would send" content], `SENT` on a 2xx, `FAILED` on any send error; then writes **exactly one**
    `notification_logs` CONFIRMATION row + commits), `repository.py`.
  - Wired into `app/booking/service.book()` **after the step-7 commit**: the dispatch is wrapped in
    a `try/except` that only logs — a confirmation failure can never roll back or fail the booking.
    `booking/router.py` injects `get_sendgrid_client`. One row per booking, `recipient` = the
    candidate's email (panelists already got the Google Calendar invite via `sendUpdates=all`).
  - `models.py`: `NotificationLog` (channel `EMAIL`, type CHECK incl. the four Post-MVP types but
    MVP writes only `CONFIRMATION`, status `SENT|FAILED|SIMULATED`). Migration `0006`
    (`notification_logs`). `config.py`: `sendgrid_api_key` (empty ⇒ SIMULATED), `email_from_address`.
  - **No new public endpoint.** Reminders / decline / cancel / SMS / WhatsApp explicitly out of scope.
  - **Verified:** `alembic` up/down/up clean (head `0006`); `ruff` clean; `pytest` **141 passed +
    1 skipped**. `docker compose build backend` → `/health` ok, **15 routes unchanged**.

- **2026-09-06 — Backend Phase 9: POST-MVP (decline / reschedule / cancel / audit / reminders /
  self-service).** *Awaiting commit approval.* **No new tables, migrations, dependencies, or
  invented endpoints.** Frozen Phase 5 engine untouched.
  - `app/interviews/lifecycle.py` + 4 routes on the existing `interviews_router`:
    - `POST /interviews/{id}/decline` [PANELIST participant] — `response_status → DECLINED`; if
      `BOOKED`: cancel the Google event + `interview_events → CANCELLED` + `DECLINE` notice +
      `→ RESCHEDULING` (response), then best-effort `→ READY_FOR_SCHEDULING` + re-run
      `scheduling.service.generate` (→ `RECOMMENDED`); pre-booking: `→ READY_FOR_SCHEDULING`.
    - `POST /interviews/{id}/reschedule` [ADMIN | owning CANDIDATE] — requires `BOOKED` else
      `409 NOT_BOOKED`; same booked-branch teardown + `RESCHEDULE` notice + re-recommendation.
    - `POST /interviews/{id}/cancel` [ADMIN] — non-terminal only else `409 REQUEST_ALREADY_TERMINAL`;
      cancel active event + `CANCELLATION` notice (only if an event existed) + `→ CANCELLED`.
    - `GET /interviews/{id}/audit` [ADMIN] — paginated `audit_logs` for `entity_id = {id}`, newest
      first.
  - Each mutating op: `redis_lock` → cancel the Google event **outside any DB txn** (best-effort:
    Google delete failure still cancels locally + writes a `reconciliation_tasks` row
    `CANCEL_DELETE_FAILED`) → one Postgres txn (statuses + participant + audit) → commit → release
    → best-effort notification + re-recommendation. Re-recommendation and notification failures
    are logged and never propagate.
  - **Self-service (item 4):** `POST /interviews/{id}/recommendations` and `.../book` authz widened
    from `require_role("ADMIN")` to `admin_or_owning_candidate()` (`app/core/deps.py`) — a
    CANDIDATE may act only on their own request.
  - `app/notifications/service.py` generalised: `_dispatch` (SIMULATED/SENT/FAILED + one row +
    commit) + `send_booking_confirmation` + `send_lifecycle_notification` (DECLINE / RESCHEDULE /
    CANCELLATION / REMINDER — all `notification_type` values already in the CHECK from `0006`).
  - `scripts/send_reminders.py` — `process_due_reminders(db, *, hours)` cron one-shot: one
    `REMINDER` `notification_logs` row per CONFIRMED event starting within the window that has none
    yet; idempotent; **no in-app scheduler**.
  - `app/booking/service._organiser_connection` → public `organiser_connection` (reused to cancel
    the event); `booking.repository.create_reconciliation_task` gained `commit=False` (lifecycle
    calls it mid-transaction). `errors.py`: `NotBookedError` (409), `RequestAlreadyTerminalError`
    (409). `interviews/repository.list_audit`.
  - **`migrations/env.py`** already carried the `disable_existing_loggers=False` fix (Phase 7).
  - **Deferred:** item 6 **analytics** — API_DESIGN defines no analytics endpoint and the phase
    forbids inventing one; a bare stats script was judged low-value. Not built.
  - **Verified:** `ruff` clean; `alembic` still head `0006` (no migration); `pytest` **166 passed +
    1 skipped** (+25 Phase 9: `test_lifecycle` 15, `test_audit_view` 4, `test_self_service` 3,
    `test_reminders` 3); **all 4 Phase 7 gate tests still green** (two supporting authz tests
    updated for the widened self-service rule). `docker compose build backend` → `/health` ok,
    **19 routes**. Frozen engine `git diff` empty. No token in any schema, log, audit row, or
    reconciliation metadata (asserted).

- **2026-09-06 — Phase 10: Frontend ↔ backend integration.** *Awaiting commit approval.* Frozen
  Phase 5 engine untouched; **no existing backend endpoint changed**; no migration/dep/table added
  on the backend.
  - **Backend (additive only):** `GET /api/v1/users?role=CANDIDATE|PANELIST` — ADMIN-only
    (`require_role("ADMIN")`), `role` required + `Literal["CANDIDATE","PANELIST"]` (else 422),
    returns `[{id,name,email,timezone,role}]` ordered by name. New `app/users/service.py`
    (`list_by_role`), new `tests/test_users.py` (5 tests). **No `calendar_status`** in the payload
    (not MVP-required; connectivity is still enforced + panelist-named at the recommendation step).
    Rationale: FR-012 needs candidate/panelist id + name discovery and `API_DESIGN.md` had no
    user-list endpoint — smallest change that unblocks the ADMIN create flow and lets all identity
    display be solved in the frontend adapter without touching the frozen `InterviewRequestOut`.
  - **Frontend** (`frontend/smart-interview-scheduler-frontend/`):
    - **Transport:** `next.config.mjs` `rewrites()` proxies `/api/:path*` →
      `${BACKEND_ORIGIN}/api/:path*` (default `http://localhost:8000`). Browser always calls
      same-origin `/api/v1/...` (`NEXT_PUBLIC_API_BASE_URL=/api/v1`). **No backend CORS.**
      `BACKEND_ORIGIN` is server-side only and is **baked at `next build` time** (`next dev`
      re-reads it per request).
    - **Auth:** `lib/auth-context.tsx` mock/localStorage auth removed; real backend-wired impl
      activated (`login` → `/auth/login` → `/users/me`; `register` → `/auth/register` → immediate
      `login`; boot rehydrate; logout clears tokens + caches). **Refresh-token fix:**
      `POST /auth/refresh` returns only `{access_token, token_type}` — new `storeAccessToken()`
      updates only the access token and never overwrites the refresh token with `undefined`.
    - **Adapter layer** (`lib/api-client.ts`): central backend→frontend mapping —
      `booked_event`→`event`, `recommended_slots`→`latest_recommendations`,
      `interview_request_id`→`interview_id`, participants → enriched `panelists[]` /
      `candidate_*` via a cached ADMIN user-directory fetch (non-ADMIN → 403 → falls back to the
      caller's own profile + generic labels), plus a side fetch of
      `GET /interviews/{id}/availability` attached as `.availability`.
    - **OAuth callback:** aligned to the existing backend 302 flow — new
      `app/calendar/connected/page.tsx` + `app/calendar/error/page.tsx`; the incorrect JSON
      `app/calendar/callback/page.tsx` deleted. Backend callback architecture unchanged.
    - **Registration UI:** role selector removed — self-registration creates a **CANDIDATE**
      (backend decision C1); Admin/Panelist accounts are provisioned out-of-band.
    - **Google Identity login: deferred** — removed from the UI/client rather than left as a
      misleading mock. Re-add needs GIS + `google_login_oauth_client_id` on both sides.
    - **Post-MVP lifecycle UI (decline/reschedule/cancel/audit): not implemented** — backend
      endpoints stay available without a frontend surface.
    - Fixes: candidate availability times anchored to the selected IANA zone
      (`lib/utils.ts` `zonedWallTimeToISO`); candidate recommendations page reads
      `latest_recommendations` from the detail payload instead of re-`POST`ing `/recommendations`.
    - Tooling: `.eslintrc.json` added (`next/core-web-vitals`) + devDeps `eslint` +
      `eslint-config-next` (lint was previously unconfigured).
  - **Verified:** backend `ruff` clean, `pytest` **171 passed + 1 skipped** (+5 `test_users.py`,
    zero Phase 1–9 regression, 4 Phase 7 gate tests green). Frontend `npm ci` ok, `next lint`
    clean (3 pre-existing `exhaustive-deps` warnings), `tsc --noEmit` clean, `next build` ok
    (22 routes; `/calendar/connected` + `/calendar/error` present, `/calendar/callback` gone).
    Live smoke test (Next prod server → proxy → backend-from-source → docker PG/Redis): register
    ignores `role` → CANDIDATE; ADMIN directory 200 + non-ADMIN 403 + bad role 422; refresh
    returns access-token only; ADMIN `POST /interviews` with directory-resolved ids →
    `AWAITING_CANDIDATE_AVAILABILITY`.
  - **Deferred:** `docker-compose.yml` frontend service — no frontend `Dockerfile` yet and the
    commented stub points at the wrong context path; needs a multi-stage Dockerfile +
    `output: "standalone"` + build-time `BACKEND_ORIGIN`. `docker-compose.yml` left untouched.

- **2026-09-06 — Phase 11 (partial): Resilience & Security Hardening — rate limiting.**
  *Awaiting push approval.* Frozen Phase 5 engine untouched (`git diff` empty); no existing
  endpoint contract changed; no new dependency.
  - **`app/core/ratelimit.py`** — Redis-backed fixed-window rate limiter as a **pure ASGI
    middleware** (`app.add_middleware(RateLimitMiddleware)` in `main.py`). Reuses the shared
    `redis_client`. One atomic Lua script (`INCR` + first-hit `EXPIRE`) → multi-instance safe.
    Tiers per API_DESIGN.md §Rate Limiting (60s window, key
    `ratelimit:{user:<id>|ip:<addr>}:{bucket}`): **STRICT 10/min** (public auth routes +
    candidate-facing endpoints), **STANDARD 60/min** (all other authenticated), plus additive
    **REC 5/min** (`POST /recommendations`) and **BOOK 10/min**
    (`/book`,`/reschedule`,`/decline`,`/cancel`). Identity = access-token `sub` when present,
    else client IP (first `X-Forwarded-For` hop when `rate_limit_trust_forwarded_for`). Redis
    failure **fails open** (logs a warning, allows the request). Exempt: `OPTIONS`,
    `GET /health`, non-`/api/`. `429` → standard error envelope (`RATE_LIMITED`) + `Retry-After`
    + `X-RateLimit-Limit/Remaining/Reset`; allowed responses carry the `X-RateLimit-*` headers.
  - **`app/core/config.py`** — `rate_limit_*` settings (`enabled` default True; disabled by an
    autouse test fixture so the existing suite is unaffected). **`app/core/errors.py`** —
    `RateLimitedError` + `error_body()` helper.
  - **Tests:** `tests/test_rate_limit.py` (18) + `tests/test_edge_cases.py` (4 — DST/UTC storage,
    engine DST-boundary stability, no-orphaned-rows on double booking, 22-participant engine load
    smoke). Full suite **193 passed + 1 skipped** (was 171+1). Live smoke against a running
    uvicorn confirmed: `/health` never limited; `/auth/login` 429s at the 11th; 429 body +
    `Retry-After`/`X-RateLimit-*` correct; `X-Forwarded-For` identity separation works.
  - **CI:** new `frontend` job (`npm ci` → lint → `tsc --noEmit` → build); backend `Migrate`
    step now also runs `alembic downgrade base && alembic upgrade head`.
  - **Remaining Phase 11:** written §13 edge-case checklist doc, git-history secret scan,
    security-checklist sign-off, structured/JSON request logging (recommended deferral).

### Current backend structure

```
backend/
├── app/
│   ├── main.py            # FastAPI app + GET /health + /api/v1 routers
│   ├── main.py also wires app/core/ratelimit.py (RateLimitMiddleware, Phase 11)
│   ├── auth/              # register / login / google / refresh
│   ├── users/             # GET /users/me  +  GET /users?role= (ADMIN directory, Phase 10)
│   ├── interviews/        # POST/GET/GET{id}/PATCH /interviews
│   ├── availability/      # POST/GET candidate availability (nested under /interviews/{id})
│   ├── calendar/          # Calendar OAuth connect/callback/status + free/busy + event create/delete (client seam)
│   ├── scheduling/        # PURE engine (types/engine/scoring/explain) + layer (service/repository/router/schemas)
│   ├── booking/           # POST /interviews/{id}/book — the 8-step compensating-action sequence
│   ├── notifications/     # confirmation + lifecycle emails (SendGrid seam; no endpoint)
│   └── core/
│       ├── config.py      # Settings (pydantic-settings)
│       ├── db.py          # async engine + session dependency
│       ├── models.py      # User, CalendarConnection, InterviewRequest, InterviewParticipant,
│       │                  #   CandidateAvailability, AvailabilityWindow, AuditLog, RecommendationRun,
│       │                  #   RecommendedSlot, InterviewEvent, ReconciliationTask, NotificationLog
│       ├── security.py    # bcrypt + JWT (+ calendar_state token)
│       ├── crypto.py      # Fernet encrypt/decrypt for OAuth tokens at rest
│       ├── locks.py       # redis_lock async CM (SET NX EX, token-guarded release)
│       ├── deps.py        # get_current_user, require_role(), admin_or_owning_candidate()
│       ├── errors.py      # typed errors + global handler
│       ├── pagination.py  # Page[T] + page_params
│       ├── audit.py       # record_audit()
│       ├── validators.py  # valid_iana_timezone
│       └── redis.py       # async Redis client
│   interviews/ also holds lifecycle.py (decline/reschedule/cancel/audit, Phase 9)
├── migrations/            # Alembic (env.py + versions/0001..0006)
├── scripts/  (seed.py, engine_demo.py, send_reminders.py)
├── tests/  (…, test_calendar, test_recommendations, test_booking, test_notifications,
│            test_lifecycle, test_audit_view, test_self_service, test_reminders,
│            test_calendar_sandbox [skipif])
├── pyproject.toml  ·  alembic.ini  ·  Dockerfile  ·  .dockerignore  ·  .env.example
```

All MVP + Post-MVP module folders now exist. No new module folders expected before Phase 12.

- **2026-09-06 — Phase A: Invitation schema foundation.** Commit `6ddc1dd`. *Not yet pushed.*
  Migration `0007` adds `participant_invitations` (token stored only as `SHA-256(raw_token)`,
  never the raw token; statuses `PENDING/ACCEPTED/DECLINED/UNAVAILABLE/EXPIRED`; delivery
  `SENT/FAILED/SIMULATED`; one row per `(interview_request_id, user_id)`). Extends
  `interview_participants.response_status` with `UNAVAILABLE`; adds `interview_requests.title`
  (nullable, the Job/Role field). No endpoint yet — schema only. Scheduling engine untouched.

- **2026-09-06 — Phase B: User provisioning + first-ADMIN web bootstrap.** Commit `21fe1f8`.
  *Not yet pushed.* `POST /api/v1/users` (ADMIN-only) provisions an unclaimed CANDIDATE/PANELIST
  (`password_hash = NULL`); idempotent on matching `(email, role)`, `422 ROLE_CONFLICT` on a role
  mismatch; ADMIN cannot be provisioned this way. `POST /api/v1/auth/bootstrap-admin` creates the
  first ADMIN via `X-Bootstrap-Token` (`secrets.compare_digest`, only when zero ADMINs exist,
  `409 ADMIN_ALREADY_EXISTS` after), STRICT rate-limited. New frontend `/setup` route collects
  name/email/password/timezone/bootstrap token. `POST /auth/register` unchanged (still public
  CANDIDATE-only). Full backend suite: 210 passed + 1 skipped. Scheduling engine untouched.

- **2026-09-06 — Phase C: Admin frontend corrections + misleading-UI fixes.** *Not yet pushed.*
  Frontend-only; no backend/migration/scheduling changes. Fixed: (1) `app/(admin)/admin/layout.tsx`
  RBAC guard was `allowedRole={["ADMIN","PANELIST"]}` — a real bug letting panelists reach the
  admin app; narrowed to `"ADMIN"` only. (2) That fix orphaned the panelist sidebar's "Profile" link
  (previously `/admin/settings`, now correctly blocked) — extracted the role-agnostic settings UI
  into `components/shared/ProfileSettings.tsx` and added a real `/panelist/settings` route reusing
  it, rather than pointing at a route that doesn't exist. (3) Registration/login copy said "Create
  Enterprise Account" implying public admin signup; reworded to "Create Candidate Account" /
  "Create a candidate account" across `app/page.tsx`, `app/register/page.tsx`, `app/login/page.tsx`,
  with a login-page note that ADMIN/PANELIST sign in with org-provided credentials. (4) The admin
  interview-detail panelist list had a **hard-coded** "Calendar Active" badge on every panelist
  regardless of real status; replaced with a conditional on `panelist.calendar_status` (which the
  real API adapter already sets `undefined` for — the backend doesn't surface per-panelist calendar
  status on this endpoint), showing "Calendar status unknown" rather than fabricating "Active".
  (5) Panelist Google Calendar connect flow: the backend has **no** `CALENDAR_OAUTH_NOT_CONFIGURED`
  error and doesn't validate its OAuth client config before building `authorization_url` — an
  unconfigured deployment returns a URL with an empty `client_id`, which would send the panelist to
  a broken Google consent screen. Detected client-side (empty `client_id` param) and shown as a
  clear "ask your administrator to configure Google Calendar" notice instead of redirecting.
  **Discrepancy noted:** the Phase C brief described `CALENDAR_OAUTH_NOT_CONFIGURED` as existing
  backend behavior; it does not exist in `backend/app/core/errors.py` or `app/calendar/`. Adding it
  server-side was out of scope for this frontend-only phase — flagged here for whoever picks up
  invitation dispatch or calendar hardening next.
  **Verified:** `next lint` clean (only the 3 pre-existing `exhaustive-deps` warnings), `tsc --noEmit`
  clean, `next build` OK (23 routes, `/panelist/settings` new). `git diff -- backend/app/scheduling/`
  empty. No backend files touched.

- **2026-09-06 — Phase C3/C4: Admin interview-creation wizard rebuild.** *Not yet pushed.*
  Reordered the wizard to Details → Candidate → Panelists → Review (was Candidate → Details →
  Panelists → Review) to match the real-world flow. **Gap found and fixed (approved before
  implementing):** `interview_requests.title` (Phase A's migration `0007`) existed only as a raw
  ORM column — `CreateInterviewRequest`, `InterviewRequestOut`, and the repository/service create
  path never read or wrote it, so nothing an admin typed could reach the database. Wired it through
  end-to-end: `CreateInterviewRequest.title` (optional, max 200), `InterviewRequestOut.title`,
  `repository.create(..., title=...)`, `service.create_request` pass-through, `service._to_out`
  read-back. No migration needed (column already existed); no other endpoint or contract touched.
  Two new backend tests (`test_create_persists_and_returns_title`,
  `test_create_without_title_returns_null`) — `tests/test_interviews.py` now 17/17 passing.
  **Candidate/Panelist steps:** existing `GET /users?role=` list + client-side name/email filter for
  "search" (the backend has no free-text search param — confirmed by reading the router; a full
  role-filtered list is what Phase 10 already built this on, so client-side filtering was the
  correct minimal solution rather than inventing a server search endpoint). "Add new" inline forms
  call the real `POST /users` (new `usersApi.provision()` in `lib/api-client.ts`) — surfaces
  `ROLE_CONFLICT` (422) with a clear message, is idempotent on `(email, role)`, never offers ADMIN
  as a role. Newly-provisioned vs. selected-existing participants are visibly tagged ("New" badge)
  through to the review screen. Panelists support multi-select with removable chips. Empty
  candidate/panelist directories show an inline "add one to get started" state instead of a dead
  end; a directory *load failure* shows a distinct error + Retry rather than a silent empty list.
  **Success screen stays honest:** states the interview was created (and participants provisioned,
  when applicable) and explicitly says no invitations have been sent — no fake invitation-sent
  status.
  **Frontend directory-cache fix:** `usersApi.provision()` writes the newly-created user straight
  into `api-client.ts`'s `_directoryCache` (used to enrich interview participant identity) so a
  `POST /interviews` immediately following a provision resolves the new person's name/email instead
  of falling back to a generic label.
  **Scope not touched:** invitation issuance/dispatch, `/invitations/{token}`, `/invite/[token]`,
  accept/decline/reschedule UI, resend, account claim — all deferred to the invitation phase.
  **Verified:** targeted backend `pytest tests/test_interviews.py` 17 passed (full-suite run was
  attempted but hung with no output — the documented port-5432 native-Postgres/Docker contention —
  and was killed; targeted tests were the correct and sufficient scope per this phase's own
  verification rule since only `app/interviews/` was touched). Frontend `next lint` clean (same 3
  pre-existing warnings), `tsc --noEmit` clean, `next build` OK (24 routes; `admin/interviews/new`
  bundle grew from ~6.3kB to ~8.6kB). `git diff -- backend/app/scheduling/` empty.

- **2026-09-06 — Invitation phase, commit 1: backend `app/invitations/` module.** *Not yet
  pushed.* No migration (Phase A's `0007` schema was already complete — this commit is the first
  code that reads/writes `participant_invitations`). New module: `schemas.py` / `repository.py` /
  `service.py` / two routers in `router.py` — `router` (ADMIN-only, nested
  `/interviews/{id}/invitations`: `POST` issues-or-resends one invitation per current participant,
  `GET` lists current invitation state) and `public_router` (unauthenticated, top-level
  `/invitations/{token}`: `GET`, `POST .../respond`, `POST .../claim-account`).
  **Design decisions (approved before implementing):** (1) issuance is explicit and ADMIN-only,
  never automatic on `POST /interviews` — matches the C3/C4 success screen's honest "no invitations
  sent yet." (2) Resend = calling issuance again; the DB's existing unique `(request_id, user_id)`
  constraint is the upsert key that rotates the token in place (new hash, new `expires_at`,
  `send_count += 1`) — no separate resend endpoint. (3) **Token-based response is deliberately
  decoupled from the authenticated Phase 9 lifecycle** — `respond()` only writes
  `participant_invitations.status/responded_at/response_reason` and mirrors the same value onto
  `interview_participants.response_status`; it never calls `lifecycle.decline()`, cancels a
  booking, or re-triggers recommendations. That cascade is a later phase's decision, not this one.
  (4) Claiming an account (`POST .../claim-account`, sets `password_hash` for a
  `requires_account_setup` user, returns a `TokenPair`) is independent of responding — either can
  happen without the other, both gated only on the token being valid and not expired.
  **Token handling:** `secrets.token_urlsafe(32)` generated in `service.py`, hashed with
  `hashlib.sha256` before the first DB write; the raw value exists only in memory, the one-time
  `invite_url` in the issuance API response, and the outbound email body — asserted never to reach
  a log line or `audit_logs.metadata` (`test_no_raw_token_leaks_into_audit_or_logs`, following the
  same pattern as Phase B's `test_audit_and_logs_carry_no_secrets`). Delivery status
  (SENT/SIMULATED/FAILED) is written onto `participant_invitations.delivery_status` — deliberately
  **not** `notification_logs`, per the Phase A model docstring's own note that invitation delivery
  state lives on its own table. Expiry (`invitation_ttl_hours` = 168) is lazy: `GET`/`respond`/
  `claim-account` flip a past-due `PENDING` row to `EXPIRED` on read, no cron job.
  **Rate limiting:** new `INVITE` tier (`rate_limit_invite_per_minute` = 10) for the ADMIN
  issuance/resend route; the three public token routes added to the existing `STRICT` tier.
  **Verified:** `ruff` clean; new `tests/test_invitations.py` 20/20 passing (issuance,
  one-row-per-participant, resend rotation + old-token-dead, candidate+panelists both included,
  SENT/SIMULATED/FAILED delivery, admin-only list, public GET, respond for all three response
  values, double-response rejected, expiry rejected on respond but shown (not errored) on GET,
  claim sets password and enables `POST /auth/login`, claim rejected when already claimed or not
  required, decline-then-claim still succeeds, no-secret-leak assertion, both new rate-limit
  tiers). Regression: `test_interviews.py` (17), `test_bootstrap_admin.py`/`test_provisioning.py`
  (34 combined), `test_rate_limit.py`/`test_notifications.py` (26 combined),
  `test_booking.py`/`test_lifecycle.py`/`test_self_service.py` (33 combined) — all still green.
  `git diff -- backend/app/scheduling/` empty; alembic head still `0007`.

- **2026-09-06 — Invitation phase, commit 2: frontend `/invite/[token]` + admin trigger.** *Not
  yet pushed.* Backend untouched (re-ran `tests/test_invitations.py`, still 20/20 — implemented
  exactly against the existing contract, no gaps found this round).
  - **`lib/types.ts`:** `InvitationRecord`/`InvitationSummary`/`InvitationPublic`/
    `InvitationRespondPayload`/`ClaimAccountPayload`, matching the backend response/request shapes
    field-for-field.
  - **`lib/api-client.ts`:** `invitationsApi.{issue, list, getByToken, respond, claimAccount}` — a
    deliberate exception to this file's usual `IS_DEMO_MODE` branch on every call: invitations have
    no offline fixture data and are implemented directly against the live backend only (noted in a
    comment). `claimAccount` calls the existing `storeTokens()` helper — the same one
    `authApi.login`/`bootstrapAdmin` use — so the refresh/session flow picks the new tokens up
    unchanged.
  - **`lib/auth-context.tsx`:** new `claimInvitationAccount(token, password)`, mirroring
    `bootstrapAdmin` exactly (call the API, then `usersApi.getMe()` to populate app-wide user state
    so the rest of the UI reflects the login immediately).
  - **`app/invite/[token]/page.tsx`** (new, public — no `RoleGuard`, same tier as `/login`/
    `/register`/`/setup`): loading / not-found / expired / already-responded states are all
    distinct and honest (no generic catch-all error swallowing an expired or already-used link).
    Accept/Decline/Unavailable buttons call `respond()`; an optional reason field is always visible
    (backend accepts `reason` on any response, not just decline). The account-setup form (password
    + confirm, same validation as `/register`) only appears when `requires_account_setup &&
    !account_claimed`, and is **structurally independent** of the response section — a decline
    doesn't hide or block it (`test_respond_and_claim_are_independent` on the backend covers the
    matching case). After a successful claim, the page shows "you're signed in" **only** because
    `claimInvitationAccount` actually returned and stored a token pair — there is no
    optimistic/assumed-success copy anywhere in the flow.
  - **Admin trigger** (`app/(admin)/admin/interviews/[id]/page.tsx`): a new "Invitations" card
    fetches `GET .../invitations` on load and lists each participant's real `status` +
    `delivery_status` (SENT/SIMULATED/FAILED shown verbatim, SIMULATED labeled "no email service"
    rather than implying anything was sent). "Send Invitations" / "Resend All" calls the issuance
    endpoint and shows the freshly-returned `invite_url` per participant as a copy-box (reusing the
    existing `CopyButton`) — links from a previous session aren't shown again, matching the
    backend's own "not recoverable outside a resend" design.
  - **Verified:** `next lint` clean (same 3 pre-existing warnings), `tsc --noEmit` clean, `next
    build` OK (24 routes; `/invite/[token]` new, dynamic). `git diff -- backend/` empty for this
    commit (frontend-only). `git diff -- backend/app/scheduling/` empty.

---

## 6. In progress / next immediate task

- **In progress:** **Phase 11 — resilience & security hardening** — rate limiting done
  (3 local commits, awaiting push approval): `app/core/ratelimit.py` pure-ASGI middleware +
  `rate_limit_*` config + 18 rate-limit tests + 4 edge-case/load tests + CI (frontend job +
  Alembic down/up). Full suite 193 pass + 1 skip; live smoke confirmed. **Remaining Phase 11:**
  §13 edge-case checklist doc, git-history secret scan, security-checklist sign-off. See §5 + §7.
- **Phase 10 — frontend/backend integration:** complete, committed (`cbbb7ff`), pushed;
  `IMPLEMENTATION.md` PHASE 10 marked COMPLETED (`6508788`).
- **Backend Phases 1–9:** complete, committed, and pushed to `main`. Analytics (Phase 9 item 6)
  deferred — no API_DESIGN endpoint and the phase forbids inventing one.
- **Phase 9 decisions taken (see §7):** D-1 lifecycle lives in `app/interviews/`; D-2 scope =
  items 1–5 (reminders as a cron script); D-3 `send_reminders.py`, 24h default window; D-4
  analytics deferred; D-5 the decline/reschedule response is the value at the transition point
  (`RESCHEDULING`), re-recommendation is a best-effort follow-through; D-6 Google delete failure
  on cancel/decline → local `CANCELLED` still commits + `reconciliation_tasks` row; D-7
  `/recommendations` + `/book` widened to `admin_or_owning_candidate()`; D-8 `409
  REQUEST_ALREADY_TERMINAL` for cancelling a terminal request.
- **MVP Acceptance Gate:** Phase 7's 4 mandatory tests pass and are committed (`82764be`); still
  green after Phases 8–9. **Remaining for full sign-off: a green CI run + a real end-to-end demo
  against a live Google account** (+ optionally a real SendGrid key for a live `SENT`).
- **Next:** finish Phase 11 (edge-case checklist doc, secret scan, checklist sign-off) /
  Phase 12 (docs + bonus). Also open:
  Google Identity login end-to-end, `docker-compose` frontend service, real end-to-end demo
  against a live Google account, green CI run.
- **In progress (new track):** Phases A (invitation schema), B (user provisioning + bootstrap
  ADMIN), C (admin RBAC + misleading-UI fixes), C3/C4 (interview-creation wizard rebuild +
  `title` wired into the API), and both invitation-phase commits (backend `app/invitations/` +
  frontend `/invite/[token]` + admin trigger) are committed locally on `main` (`6ddc1dd`,
  `21fe1f8`, plus the Phase C, C3/C4, and two invitation commits — see log), **not yet pushed**.
  Migration head still `0007`.
  **Next:** the invitation phase's frontend/backend foundation is now complete end-to-end
  (issue → link → respond → claim). Open follow-ups for a later phase: cascading a DECLINED
  response into the authenticated booking-cancellation lifecycle (deliberately not done — see the
  commit-1 entry above), a resend-cooldown UI, and bulk invitation management. Scheduling engine
  remains frozen throughout.

---

## 7. Technical decisions log (append-only, newest first)

Decisions made during the build that are **not** already in the frozen specs.

- **2026-09-06 (Phase 11)** — Rate limiting. **P11-1:** implemented as **pure ASGI middleware**,
  not `starlette.BaseHTTPMiddleware` — the latter buffers the response body and reschedules the
  endpoint, which intermittently corrupted the sync `TestClient` portal against the async DB
  (whole-suite `RuntimeError` cascade; caught in Phase 11 verification). The pure-ASGI layer only
  reads request headers and rewrites `http.response.start` headers. **P11-2:** **fixed-window**
  counter (one atomic `INCR`+`EXPIRE` Lua script), not a true token bucket — it is exactly the
  `ratelimit:{id}:{endpoint}` + 60s-TTL pattern DB_DESIGN.md describes and is multi-instance
  safe; the ~2× boundary burst is acceptable for abuse control. **P11-3:** the spec's STRICT tier
  is keyed by **user id when the caller is authenticated**, by IP otherwise — the frozen wording
  ("10 req/min/IP") assumes unauthenticated callers, and IP-keying authenticated candidate
  traffic would collapse every user behind the Next.js proxy into one bucket. STRICT 10/min and
  STANDARD 60/min are unchanged. **P11-4:** two additive expensive tiers not in the frozen
  numbers — **REC 5/min** (`POST /recommendations`, amplifies to N Google Free/Busy calls) and
  **BOOK 10/min** (`/book`,`/reschedule`,`/decline`,`/cancel`; Google event ops + lock + txn) —
  justified by §11 "resource exhaustion". **P11-5:** Redis failure **fails open** for rate
  limiting (matches `core/locks.py` / `calendar/service.py` and DB_DESIGN "degrades performance,
  never correctness"). **P11-6:** rate limiting is installed on the app always; an autouse test
  fixture flips `settings.rate_limit_enabled` off for the existing suite, and `test_rate_limit.py`
  opts back in — production behavior is not weakened. **P11-7:** CI gains a `frontend` job and an
  `alembic downgrade base && upgrade head` round-trip; not treated as a spec change.

- **2026-09-06 (Phase 10)** — Frontend/backend integration. **P10-1:** the frontend↔backend seam
  uses a **Next.js same-origin rewrite proxy** (`/api/:path*` → `${BACKEND_ORIGIN}/api/:path*`),
  **not** backend CORS — nothing about the backend host reaches the browser and there is no
  preflight surface. `BACKEND_ORIGIN` is server-side only and frozen at `next build` time (fine
  for Docker/CI build args; `next dev` re-reads it live). **P10-2:** `GET /api/v1/users?role=`
  (ADMIN-only) was added because FR-012 (ADMIN creates a request naming candidate + panelists)
  is un-serviceable through any UI without a user-discovery endpoint and `API_DESIGN.md` defined
  none; it is additive (new route + `users/service.py`, no migration, no existing endpoint or
  response contract changed). It deliberately **omits `calendar_status`** — not MVP-required, and
  connectivity is already enforced + panelist-named at `POST /recommendations`. **P10-3:** all
  other backend/frontend shape mismatches (`booked_event`/`recommended_slots`/`interview_request_id`
  naming, participant enrichment, availability side-fetch) are resolved **only in the frontend
  adapter layer** (`lib/api-client.ts`); the frozen `InterviewRequestOut` etc. are untouched.
  **P10-4:** the mock/localStorage auth in `lib/auth-context.tsx` is deleted and the real
  backend-wired implementation is the only one; `POST /auth/refresh` returning
  `{access_token, token_type}` updates **only** the access token (never clobbers the refresh
  token). **P10-5:** self-registration UI creates a **CANDIDATE** only (matches backend C1) — no
  ADMIN/PANELIST self-serve. **P10-6:** Google Identity login is **deferred** and removed from the
  UI/client (no misleading mock). **P10-7:** Post-MVP lifecycle UI (decline/reschedule/cancel/
  audit) is **not built** — backend endpoints remain available headless. **P10-8:** the
  `docker-compose` frontend service stays **deferred/commented** until a frontend `Dockerfile`
  (multi-stage, `output: "standalone"`, build-time `BACKEND_ORIGIN`) exists; `docker-compose.yml`
  was not modified this phase.

- **2026-09-06 (Phase 9)** — POST-MVP lifecycle. **D-1:** `decline` / `reschedule` / `cancel` /
  `audit` live in `app/interviews/lifecycle.py` on the existing `interviews_router` (the module
  that owns `interview_requests`). **D-2:** this session implements priority items 1–5; **item 6
  (analytics) is deferred** — API_DESIGN has no analytics endpoint and Phase 9 forbids inventing
  one, and a bare numbers script was judged low-value. **D-3:** reminders = `scripts/
  send_reminders.py` (`process_due_reminders(db, *, hours)`), cron-run, 24 h default window, one
  `REMINDER` row per CONFIRMED in-window event with none yet, idempotent; **no in-app scheduler**.
  **D-5:** the `decline`/`reschedule` response carries the status **at the transition point**
  (`RESCHEDULING` for a was-BOOKED request, else `READY_FOR_SCHEDULING`); the `→
  READY_FOR_SCHEDULING` + re-run of `scheduling.service.generate` is a best-effort follow-through
  the client observes via `GET /interviews/{id}` — a re-recommendation failure leaves the request
  in `READY_FOR_SCHEDULING`/`FAILED` and the decline still returns `200`. **D-6:** a Google
  event-delete failure during `cancel`/`decline`/`reschedule` still commits the local
  `interview_events.status = CANCELLED` (user intent is authoritative) and records a
  `reconciliation_tasks` row `reason='CANCEL_DELETE_FAILED'`; the endpoint returns `200`. **D-7:**
  `POST /interviews/{id}/recommendations` and `.../book` authz widened from `require_role("ADMIN")`
  to `admin_or_owning_candidate()` (`app/core/deps.py`) — a CANDIDATE may act only on their own
  request (IMPLEMENTATION.md Phase 9 item 4). Two supporting Phase 6/7 authz tests were updated
  accordingly (the 4 mandatory gate tests are unaffected). **D-8:** cancelling a `CANCELLED` /
  `COMPLETED` request → `409 REQUEST_ALREADY_TERMINAL` (API_DESIGN names no code). No panelist
  "accept" endpoint (API_DESIGN defines only `/decline`); `interview_participants.response_status
  = 'ACCEPTED'` stays unused. `BOOKED → COMPLETED` remains manual/future (G5).
- **2026-09-06 (Phase 8)** — Booking confirmation. **N-1:** **one** `notification_logs` row per
  booking (the acceptance criterion says "exactly one"), `recipient` = the candidate's email; the
  panelists already receive the Google Calendar invite (Phase 7 sends with `sendUpdates=all`). The
  email itself `cc`s the panelists. **N-2:** no `sendgrid` SDK — one `httpx` POST to
  `api.sendgrid.com/v3/mail/send` behind the standard client seam (`app/notifications/client.py`),
  injectable for tests. **N-3:** empty `SENDGRID_API_KEY` (dev/CI default) ⇒ status `SIMULATED`
  with the full "would-send" body logged at INFO; a real key ⇒ `SENT` on 2xx, `FAILED` on any
  send error. This is the requirements.md §5 documented degradation path; it does **not** block
  the MVP gate. **N-4:** `send_booking_confirmation` never raises, and `book()` wraps the whole
  dispatch in a `try/except` that only logs — a confirmation failure can never roll back or affect
  the already-committed booking. Trade-off: if the DB is unavailable for the notification write
  itself, the booking still succeeds and the missing row is logged loudly (booking success is the
  priority, per the phase brief).
- **2026-09-06 (Phase 7)** — Booking. **D-1:** the Calendar event is created on the **first
  assigned panelist's** connected calendar (deterministic by user id), attendees = candidate +
  all panelists, `conferenceData` → Meet. No new precondition — every panelist already had a
  CONNECTED calendar for the request to reach `RECOMMENDED`. **D-2:** if Redis is unreachable at
  lock time the booking **proceeds** (warned); the `interview_events` partial unique index
  `WHERE status='CONFIRMED'` is the real double-booking guard, "independent of the Redis lock"
  (DB_DESIGN.md). **D-3:** a unique-index violation during step 6 → compensate (delete the event)
  → `409 SLOT_NO_LONGER_AVAILABLE` (it *is* "lost the race"); `500 BOOKING_PERSISTENCE_FAILED` is
  reserved for any *other* step-6 failure. **D-4:** `book` on a request whose status ≠
  `RECOMMENDED` → `409 SLOT_NO_LONGER_AVAILABLE` (API_DESIGN names no code for it). **D-5:** OAuth
  `state` reuse (Phase 6) — n/a here. **D-6:** `app/calendar/client.py` gained `create_event` /
  `delete_event` and `_post`→`_request(method,…)` — it is the designated Google seam, not the
  frozen engine. **D-7:** the "two simultaneous bookings" gate criterion is proven by deterministic
  backstops (held Redis lock → 409; pre-existing `CONFIRMED` event → 409; raw double-insert →
  `UniqueViolation`), not a threaded test — a real thread race against the shared sync `TestClient`
  deadlocks its portal. **D-8:** if the organiser panelist's connection is `REVOKED`/`EXPIRED` at
  book time, surface that specific `424` (consistent with Phase 6), not `502`. **D-9:** the Redis
  lock is released with a token-guarded Lua `GET`+`DEL` so a slow holder can't drop a later
  holder's lock. Also: `SlotOut` gained `id` (the value `POST /book` takes as `recommended_slot_id`
  — API_DESIGN's response example omitted it); `POST /book` never claims success before the
  Postgres commit; `migrations/env.py` now passes `disable_existing_loggers=False` (alembic's
  default was silencing `app.*` loggers when migrations run in-process).
- **2026-09-06 (Phase 6)** — Calendar integration & the Scheduling Service. **D-1:** Google HTTP is
  `httpx` (async) behind one seam, `app/calendar/client.py`; OAuth tokens are Fernet-encrypted
  (`app/core/crypto.py`). **D-2:** every automated test injects a fake client; `test_calendar_
  sandbox.py` is `skipif`-gated on real sandbox creds and never runs in CI. **D-3:** a free/busy
  fetch that fails after retries → `502 CALENDAR_SYNC_FAILED`; the request stays
  `READY_FOR_SCHEDULING` (requirements.md §13). **D-4:** `datetime.now(UTC)` enters only in
  `app/scheduling/service.py` (as `EngineInput.reference_time`); `existing_bookings = {}` until
  Phase 7. **D-5 (resolves G3):** `GET /interviews/{id}` carries `recommended_slots` (latest run)
  for ADMIN + the owning candidate — the frozen API_DESIGN routes recommendation viewing through
  this endpoint, so no new GET route was added. **D-6:** OAuth `state` is a signed JWT with
  `type="calendar_state"`, 5-minute TTL, distinct from access/refresh tokens. **D-7:** callback
  redirects to `${FRONTEND_BASE_URL}/calendar/connected` | `/calendar/error`. **D-8:**
  `CALENDAR_TOKEN_ENCRYPTION_KEY` sentinel `"dev"` derives a throwaway local key; with
  `environment=production` and no real key the app refuses (`TokenCryptoError`). **D-9:** no
  dev-only Calendar event creation — event creation is entirely Phase 7. **D-10:** module folder is
  `app/calendar/` per CODING_GUIDELINES (absolute imports; nothing imports stdlib `calendar`).
  **G7 resolved:** `GET /calendar/status` is folded into Phase 6. The three terminal `424`s on
  `POST .../recommendations` are kept distinct per API_DESIGN.md / §9d: `PANELIST_CALENDAR_NOT_
  CONNECTED` (no grant), `CALENDAR_CONNECTION_REVOKED` (Google rejected the refresh token),
  `CALENDAR_CONNECTION_EXPIRED` (grant lapsed with **no refresh token to retry** — the one path
  that surfaces `EXPIRED`; a refreshable lapsed access token is refreshed silently and never
  shown). The Service also drops candidate availability windows that wholly passed while the
  request waited, and clips an in-progress window to `reference_time` (the engine rejects any
  past-start window) — Service-layer normalization, not an engine change.
- **2026-09-06 (Phase 5)** — Scheduling Engine layout & contracts. **D-A:** the engine package is
  `types.py` + `engine.py` + `scoring.py` + `explain.py` (the IMPLEMENTATION.md "and nothing else"
  is read as "no Service/Router/Repo/migration", not "no data-definition module"). **D-B (resolves
  G1):** `EngineInput.existing_bookings: dict[participant_id, list[datetime]]` (tz-aware UTC),
  bucketed by **each panelist's local calendar day** for Workload Balance; Phase 6 fills it from
  `interview_events` (empty until Phase 7). **D-C:** the five §8 factors implemented with the
  concrete formulas from the Phase 5 plan — timezone fairness & working-hours comfort aggregate by
  **min** across participants, workload balance by **mean** across panelists; `buffer_quality =
  clamp((min(gap_before, gap_after) − buffer_minutes) / buffer_minutes)` so exactly-minimum → 0.0
  and ≥2× → 1.0, matching §8's worded examples. **D-D:** `EngineInput.reference_time` is an
  explicit tz-aware UTC input; the engine never reads the wall clock or uses randomness (enforced
  by `test_engine_purity.py`). **D-E:** `SchedulingEngineError(Exception)` lives in
  `app/scheduling/types.py`; the engine imports nothing from fastapi or `app.core`. Slot validity
  requires the full `duration + 2×buffer` inside one common-free interval (buffer on **both**
  sides — §8). `PROXIMITY_HORIZON_DAYS = 14` in the engine, separate from Phase 4's
  `AVAILABILITY_HORIZON_DAYS = 21` (G8). `algorithm_version = "1.0.0"` (feeds
  `recommendation_runs.algorithm_version` in Phase 6).
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
- **G1 (Phase 5) — RESOLVED 2026-09-06 (D-B).** `EngineInput.existing_bookings:
  dict[participant_id, list[datetime]]`, bucketed by panelist-local day. Phase 6's Service
  populates it from `interview_events` (empty until the table exists in Phase 7). See §7.
- **G3 (Phase 6) — RESOLVED 2026-09-06 (D-5).** `GET /interviews/{id}` returns the latest run's
  full `recommended_slots` for ADMIN + the owning candidate (panelists: `null`). No separate read
  endpoint — API_DESIGN.md already routes this through `GET /interviews/{id}`. See §7.

### Non-critical — resolve when relevant

- **C3:** `IMPLEMENTATION.md` phase-duration percentages sum to ~115% (likely intentional
  Phase 9 ∥ Phase 10 overlap). Cosmetic; add a footnote when convenient.
- **G5:** Nothing transitions `BOOKED → COMPLETED` (no endpoint/phase/job). Confirmed still true
  after Phase 7 — booking lands the request in `BOOKED`; `COMPLETED` remains manual/future.
- **`reconciliation_tasks` (Phase 7/9):** rows are created on a failed compensating delete
  (`COMPENSATING_DELETE_FAILED`) and on a failed cancel/decline event delete
  (`CANCEL_DELETE_FAILED`); there is still **no** resolution endpoint or job (an operator queries
  `WHERE status='OPEN'`).
- **G6 — HANDLED (Phase 4/9).** MVP allows one candidate submission (the
  `AWAITING_CANDIDATE_AVAILABILITY` gate). Phase 9's decline/reschedule re-runs the Scheduling
  Service against the **existing** `candidate_availability` — no re-submission flow was needed.
- **Analytics (Phase 9 item 6) — DEFERRED.** No API_DESIGN endpoint; Phase 9 forbids inventing
  one. Revisit in Phase 12 (bonus) if time remains, likely as `scripts/analytics.py`.
- **G7 — RESOLVED 2026-09-06.** `GET /calendar/status` implemented as part of Phase 6.
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
