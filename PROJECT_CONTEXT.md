# PROJECT_CONTEXT.md — session handoff

<!-- Living doc. Update §5–§9 at the end of every session and at each phase boundary.
     Do NOT duplicate the spec docs — link to them. Keep it under ~2 min to read.
     Frozen specs: requirements.md, IMPLEMENTATION.md, DB_DESIGN.md, API_DESIGN.md, CODING_GUIDELINES.md -->

**Last updated:** 2026-09-06 — Backend Phase 8 (Booking Confirmation) complete and committed (`290af4f`). Phase 9 (POST-MVP: decline / reschedule / cancel / audit / reminders / self-service) implemented, verified, awaiting commit approval. Analytics (item 6) deferred.

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

### Current backend structure

```
backend/
├── app/
│   ├── main.py            # FastAPI app + GET /health + /api/v1 routers
│   ├── auth/              # register / login / google / refresh
│   ├── users/             # GET /users/me
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

---

## 6. In progress / next immediate task

- **In progress:** **Phase 9 — POST-MVP** — implemented and verified locally, awaiting commit
  approval. `app/interviews/lifecycle.py` (+ 4 routes), `admin_or_owning_candidate()` dep,
  generalised notifications, `scripts/send_reminders.py`. No new tables / migrations / deps /
  invented endpoints. **Analytics (item 6) deferred** — no API_DESIGN endpoint exists and the
  phase forbids inventing one.
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
- **Next:** Phase 10 (frontend — teammate) / Phase 11 (resilience & security hardening) /
  Phase 12 (docs + bonus). Backend Post-MVP items done except analytics.

---

## 7. Technical decisions log (append-only, newest first)

Decisions made during the build that are **not** already in the frozen specs.

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
