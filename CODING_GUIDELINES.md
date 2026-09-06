# Coding Guidelines — Smart Interview Scheduler

Status: updated in the Architecture Consistency Pass. Same finalized stack as before — no new technologies introduced. This revision makes three things explicit that were previously implicit: (1) the Scheduling Engine/Service boundary, (2) the two separate Google OAuth flows, (3) that booking consistency is a compensating-action strategy, not a distributed transaction.

---

# Technology Stack

| Technology | What it is | Why we need it | Why this over the alternative |
|---|---|---|---|
| **Next.js 14** | React framework with routing, SSR | Fast first paint for the candidate availability-submission page; simplifies auth-gated admin views | Over plain React: less glue code under time pressure |
| **TypeScript** | Typed superset of JavaScript | Catches request/response shape mismatches with FastAPI before demo day | Over plain JavaScript: cheaper to fix a type error at compile time than a shape bug live |
| **Tailwind CSS** | Utility-first CSS | Professional UI with near-zero hand-written CSS | Over a full component framework: smaller footprint |
| **shadcn/ui** | Copy-in, themeable component primitives on Tailwind | Accessible forms/dialogs for booking + slot-selection UI | Components are copied into the repo and fully owned — matters for "must understand every line" |
| **FastAPI** | Python async web framework | One backend service, async-suited to waiting on Google Calendar/email | Over Spring Boot/Node/Rust: one language, one runtime, fully explainable by one team |
| **PostgreSQL** | Relational database | Interview data is relational; booking needs real ACID transactions (scoped correctly — see Booking Consistency below) | Over MongoDB: no document-shaped data exists here that would justify a second store |
| **Redis** | In-memory key-value store | (1) short-lived booking lock, (2) short-TTL free/busy cache | Simpler and faster than a DB-only lock for a purely transient concern |
| **Google OAuth2 — two distinct uses (see §OAuth Architecture)** | Authentication protocol | Used twice, for two different purposes, with two different scope sets — never conflated | See §OAuth Architecture for the full rationale |
| **Google Calendar API** | Free/busy query + event creation | The spine of the product — real availability, real event, real Meet link | Mocking this would undercut the entire demo's credibility |
| **Google Meet (via Calendar API `conferenceData`)** | Auto-generated meeting link | Zero additional integration — a field on the event-creation call already being made | Over a separate Zoom integration: Zoom needs marketplace review that won't clear in hackathon time |
| **Email provider (SendGrid)** | Transactional email | Booking confirmation | **Status: REAL if feasible, degrades to logged/simulated if risky** — see §Real vs. Mocked Integrations. This is the one integration in the MVP tier explicitly allowed to degrade without blocking the MVP gate. |
| **Docker Compose** | Local multi-container orchestration | One command brings up Postgres, Redis, backend, frontend | Over Kubernetes: no orchestration features needed at hackathon scale |
| **GitHub Actions** | CI/CD | Lint + test on every push | Already integrated with the repo host |

## Real vs. Mocked Integrations

| Integration | Status |
|---|---|
| Google Calendar (free/busy + event creation) | **REAL — required for the MVP gate** |
| Google Meet link generation | **REAL — required for the MVP gate** |
| Core database persistence (Postgres + Redis) | **REAL — required for the MVP gate** |
| Email confirmation | **REAL if feasible; may degrade to a logged/simulated confirmation without blocking the MVP gate** (`requirements.md` §5, §15) |
| SMS / WhatsApp / other channels | **Mocked/simulated only, if attempted at all** — Bonus tier, never a real integration this cycle |

Do not spend hackathon time integrating multiple communication platforms before the Calendar booking loop (the actual MVP gate) works end to end.

---

# OAuth Architecture — Two Separate Flows, Never Conflated

This is the single most important thing to get right in the auth module, because getting it wrong silently breaks the "logging in with Google does not imply Calendar access" requirement (`requirements.md` §9).

| | Google Login (Authentication) | Google Calendar Connection (Authorization) |
|---|---|---|
| **Purpose** | Identity verification, basic profile | Read free/busy, create events, generate Meet links |
| **Scopes requested** | `openid`, `email`, `profile` only | Calendar-specific scopes (`calendar.events`, `calendar.freebusy`) |
| **Triggered by** | The login page, for any role | An explicit "Connect Google Calendar" button, PANELIST/ADMIN only |
| **Module** | `app/auth/` | `app/calendar/` (a distinct module, distinct OAuth client config) |
| **Tokens stored in** | Not persisted beyond issuing our own JWT — Google's identity tokens are verified and discarded | `calendar_connections` table, access + refresh tokens **encrypted at rest** |
| **Coupling to login method** | None — a Calendar connection is available regardless of whether the user logged in via password or Google identity | None — see left |

**Implementation rule:** the two OAuth client configurations (redirect URIs, scopes, client secrets if separate) must be configured independently in `app/auth/` and `app/calendar/` respectively. A single shared OAuth handler that requests calendar scopes "just in case" during login is exactly the bug this separation exists to prevent — do not build one, even for convenience.

**Lifecycle handling** (implemented in `app/calendar/service.py`): `CONNECTED → EXPIRED` (silent refresh attempted) `→ CONNECTED` (success) or `→ REVOKED` (refresh failed) `→` user must reconnect. See `requirements.md` §9c–9d and `DB_DESIGN.md` for the `calendar_connections.status` field and its transitions. A revoked/expired connection must produce a specific, named error (`CALENDAR_CONNECTION_REVOKED`/`CALENDAR_CONNECTION_EXPIRED`) — never a silent "treat as busy" or "treat as free" guess.

---

# Architecture Principles

- **Separation of concerns** — HTTP handling, orchestration, pure business logic, and data access are four distinct layers (Router → Service → Engine → Repository), not three or two collapsed together.
- **The Scheduling Engine/Service boundary is the most important boundary in the codebase:**

```
Router  (app/scheduling/router.py)
   ↓  HTTP concerns only — no business logic
Scheduling Service  (app/scheduling/service.py)
   ↓  gathers data via Repository + Calendar integration, normalizes it
Scheduling Engine  (app/scheduling/engine.py)
   ↓  PURE function: (normalized inputs) → (ranked, scored, explained slots)
   ↑  returns plain data back up
Scheduling Service
   ↓  persists the run and its slots
Repository  (app/scheduling/repository.py)
   ↓
PostgreSQL
```

  The **Engine** (`engine.py`, plus `scoring.py` and `explain.py`):
  - Accepts only plain Python dataclasses/structures as input (already-normalized availability, constraints, weights).
  - Performs: normalize → validate → merge busy intervals → generate free intervals → intersect → apply duration/buffer/working-hours → generate candidate slots → score → rank → explain.
  - **Must not** import anything from `sqlalchemy`, `redis`, `httpx`/`requests`, `fastapi`, or any Google client library. This is enforced by code review and by keeping these modules dependency-free at the `import` level — a reviewer can `grep` for forbidden imports in `engine.py`/`scoring.py`/`explain.py` as a two-second check.
  - Is fully unit-testable with hand-constructed synthetic data — no mocks, no fixtures beyond plain objects.

  The **Service** (`service.py`):
  - Is the only place in the scheduling module allowed to call the Repository or the Calendar integration module.
  - Gathers candidate availability (via Repository) and panelist free/busy (via the Calendar integration module, which itself calls Google Calendar and Redis cache).
  - Normalizes/shapes this data into exactly the plain structures the Engine expects.
  - Calls the Engine — a single function call, no I/O in between.
  - Persists the returned recommendation run and its scored slots via the Repository.
  - Is what the Router calls; the Router never touches the Engine or the Repository directly.

- **Modular design** — the FastAPI backend is one deployable service, internally split into modules (auth, calendar, users/RBAC, interview requests, availability, scheduling [service+engine as above], booking, notifications, audit). Each module is a self-contained folder: `router.py`, `service.py`, `schemas.py`, `repository.py` (where it owns tables) — and, for the scheduling module only, the additional pure `engine.py`/`scoring.py`/`explain.py` files.
- **No unnecessary abstraction** — no repository/service split for trivial CRUD where a single function is clearer; the Calendar-provider abstraction is kept to the one narrow seam needed to keep Outlook a scoped future addition, not a promise of a plugin system.
- **API-first thinking** — `API_DESIGN.md` is the contract; a backend change not reflected there is a documentation bug to fix immediately.
- **Security by default** — every new endpoint starts with an explicit role requirement and Pydantic input schema.
- **Explainability** — any code that produces a ranking or recommendation must expose *why*, not just *what*, as a first-class return value — a coding standard, not only a product feature.

---

# Backend Coding Standards

Each module in `app/<module_name>/` follows:

| Layer | File | Responsibility |
|---|---|---|
| Router | `router.py` | HTTP routing, request/response wiring, role-requirement declarations. No business logic. |
| Service | `service.py` | Orchestration: gathers data, calls integrations/repositories, and — for the scheduling module specifically — calls the pure Engine. |
| Engine *(scheduling module only)* | `engine.py`, `scoring.py`, `explain.py` | Pure business logic. No I/O of any kind. |
| Schema | `schemas.py` | Pydantic request/response models — source of truth for input validation. |
| Repository | `repository.py` | Direct DB access (SQLAlchemy). Only the module that owns a table writes to it. |

- **Dependency injection** via FastAPI's `Depends()` for the current user, DB session, and Redis client.
- **Error handling** — business-logic errors are raised as typed exceptions (e.g., `SlotNoLongerAvailableError`, `CalendarConnectionRevokedError`, `CalendarEventCreationFailedError`) and translated to the standard API error envelope by a single global exception handler.
- **Booking consistency is implemented as a compensating-action sequence, not a transaction spanning external systems** — see §Booking Consistency Implementation below. Do not wrap a Google API call inside a SQLAlchemy `session.begin()` block; the two are never in the same transaction boundary.

## Booking Consistency Implementation

Implements `requirements.md` §10 exactly:

```python
# app/booking/service.py (illustrative structure, not final code)
def book_slot(request_id, slot_id, actor):
    with redis_lock(f"lock:booking:{request_id}", ttl_seconds=10):
        revalidate_slot_still_valid(request_id, slot_id)          # step 2
        check_for_conflicts(request_id)                            # step 3
        calendar_result = calendar_integration.create_event(...)   # step 4 — OUTSIDE any DB transaction
        try:
            with db.transaction():                                 # step 6 — Postgres-only
                repository.insert_interview_event(calendar_result)  # step 6
                repository.update_request_status(request_id, "BOOKED")
            # step 7: transaction committed here
        except Exception as db_error:
            compensate(calendar_result.event_id, db_error)          # attempt calendar cleanup
            raise BookingFailedError(...)                            # never report success
    # step 8: lock released automatically on context exit

def compensate(calendar_event_id, original_error):
    try:
        calendar_integration.delete_event(calendar_event_id)
        log_error("booking_compensated", calendar_event_id, original_error)
    except Exception as cleanup_error:
        repository.create_reconciliation_task(calendar_event_id, original_error, cleanup_error)
        log_error("booking_compensation_failed_needs_manual_reconciliation", calendar_event_id)
```

The comment on each numbered step corresponds directly to the numbered list in `requirements.md` §10 — this is deliberate, so the code and the spec can be read side by side during the walkthrough.

---

# Frontend Standards

- **Component organization** — `app/(admin)/`, `app/(panelist)/`, `app/(candidate)/` route groups; shared primitives in `components/ui/` (shadcn) and `components/shared/`.
- **API client** — a single typed client module (`lib/api-client.ts`) wraps every backend call.
- **Loading states** — every async action renders an explicit loading state.
- **Error states** — every async action renders the specific error message from the API's standard error envelope, including the new booking-failure and calendar-connection error codes.
- **Role-based UI** — reads the current user's role and hides/disables actions the permissions matrix (`requirements.md` §4) does not allow — a UX convenience only; enforcement is server-side.
- **Explainability UI is not optional polish** — the slot-recommendation screen must render the `score_breakdown` and `explanation` for every recommended slot, not just its `total_score`.

---

# Database Standards

- **Naming** — `snake_case`, plural table names.
- **Foreign keys** — explicit FK constraints, never enforced only in application code.
- **Indexes** — on every foreign key and every hot-path filter column.
- **Transactions** — scoped to PostgreSQL only, never assumed to span an external API call (§Booking Consistency).
- **UTC timestamps** — every timestamp column `TIMESTAMPTZ`, converted to local time only at the API-response/UI boundary.

---

# Security Standards

- Passwords hashed with bcrypt (never stored/logged in plaintext).
- JWT signing key and all third-party credentials from environment variables only.
- **Two separate encrypted-token stores, never merged:** login-related tokens are not persisted beyond our own JWT issuance; Google Calendar OAuth tokens are stored encrypted at rest in `calendar_connections` only.
- Every mutating route declares its required role explicitly.
- Rate limiting middleware on all public/candidate-facing routes.

---

# Error Handling Standards

- All errors returned in the standard envelope (`API_DESIGN.md`) — no raw stack traces reach the client.
- Every custom exception maps to exactly one documented error `code`, including the booking/calendar-specific codes introduced in this revision: `SLOT_NO_LONGER_AVAILABLE`, `CALENDAR_EVENT_CREATION_FAILED`, `BOOKING_PERSISTENCE_FAILED`, `CALENDAR_CONNECTION_REVOKED`, `CALENDAR_CONNECTION_EXPIRED`.

---

# Logging Standards

- Structured (JSON) logs for every request.
- Authentication events (login, OAuth callback — both flows, logged distinctly) and token refresh/failure logged explicitly.
- **Never** log: passwords, JWTs, or OAuth access/refresh tokens (login or Calendar) — of either kind.
- A failed compensating cancellation (§Booking Consistency) is logged at error/critical severity, since it is the one failure mode that requires human follow-up.

---

# Testing Standards

- The Scheduling Engine has the highest test bar: unit tests for no-valid-slot, exactly-one-valid-slot, multiple-slots-with-a-verifiable-ranking, and a test asserting the five-factor score breakdown is internally consistent with the documented weights (`requirements.md` §8).
- Every module ships at least one integration test covering its documented API contract.
- RBAC: at least one "wrong role gets 403" test per protected route category.
- Concurrency: an automated test simulates two simultaneous booking requests and asserts exactly one succeeds and no orphaned rows exist.
- **Compensation path test:** an automated test simulates a successful Calendar event creation followed by a forced DB failure, and asserts the compensating cancellation is attempted and logged.

---

# Git Workflow

- `main` is always demoable.
- Branches: `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`.
- Commits: `<module>: <imperative summary>`.
- One PR per `IMPLEMENTATION.md` phase deliverable.

---

# Environment Variables

```
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=
JWT_REFRESH_TOKEN_EXPIRE_DAYS=
GOOGLE_LOGIN_OAUTH_CLIENT_ID=
GOOGLE_LOGIN_OAUTH_CLIENT_SECRET=
GOOGLE_LOGIN_OAUTH_REDIRECT_URI=
GOOGLE_CALENDAR_OAUTH_CLIENT_ID=
GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=
GOOGLE_CALENDAR_OAUTH_REDIRECT_URI=
CALENDAR_TOKEN_ENCRYPTION_KEY=
SENDGRID_API_KEY=
EMAIL_FROM_ADDRESS=
FRONTEND_BASE_URL=
```

Note the **deliberately separate** `GOOGLE_LOGIN_OAUTH_*` and `GOOGLE_CALENDAR_OAUTH_*` variable groups — even if a real deployment ends up using the same underlying Google Cloud project, the two are configured as independent client credentials/scope sets in code, never one shared config object.

---

# AI Usage Transparency

AI-assisted development (Copilot/Cursor/ChatGPT/Claude) is permitted, under one condition: **every line of submitted code must be understood and defensible by the team.**

- Boilerplate (CRUD scaffolding, Dockerfiles, test scaffolding, first-draft docs) may be AI-generated and then reviewed.
- The Scheduling Engine's scoring logic, the booking compensating-action sequence, the OAuth scope handling, and all authentication/RBAC code must be manually written or manually verified line-by-line — these are exactly the places a subtle AI-introduced bug becomes a security hole, a double-booked interview, or an orphaned Calendar event.
- The top-level `README.md` must contain an "AI Usage" section disclosing which tools were used, for which parts, and which parts were explicitly excluded from AI assistance and why.
