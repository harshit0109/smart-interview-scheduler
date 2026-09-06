# API Design — Smart Interview Scheduler

Status: updated in the Architecture Consistency Pass. Base URL: `/api/v1`. Every endpoint is tagged **[MVP]** or **[POST-MVP]** so the build order in `IMPLEMENTATION.md` is unambiguous from this document alone. Every endpoint maps to at least one FR in `requirements.md` §6, and every table it touches is defined in `DB_DESIGN.md`.

---

# Standard API Response Format

Successful responses return the resource directly (single object) or a paginated envelope (see Pagination).

# Standard Error Format

```json
{
  "error": {
    "code": "SLOT_NO_LONGER_AVAILABLE",
    "message": "This slot was booked by someone else a moment ago. Please choose another.",
    "field_errors": null,
    "trace_id": "a1b2c3d4"
  }
}
```

Error codes introduced or clarified in this revision (all documented at their owning endpoint below): `CALENDAR_CONNECTION_REVOKED`, `CALENDAR_CONNECTION_EXPIRED`, `PANELIST_CALENDAR_NOT_CONNECTED`, `CALENDAR_EVENT_CREATION_FAILED`, `BOOKING_PERSISTENCE_FAILED`, `SLOT_NO_LONGER_AVAILABLE`.

# HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Resource created |
| 400 | Malformed request |
| 401 | Missing/invalid/expired access token |
| 403 | Authenticated, but role does not permit this action |
| 404 | Not found, or not visible to the caller |
| 409 | Conflict (e.g. `SLOT_NO_LONGER_AVAILABLE`) |
| 422 | Schema/business validation failure |
| 424 | Failed dependency (e.g. `PANELIST_CALENDAR_NOT_CONNECTED`) |
| 429 | Rate limit exceeded |
| 500 | Unhandled server error |
| 502 | Upstream (Google) failure after retries exhausted |

# Pagination

`?page=0&size=20` (0-indexed, default 20, max 100) → `{ "items": [...], "page": 0, "size": 20, "total": 42 }`.

# Authentication

Bearer JWT on every endpoint except `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/refresh`, and `GET /calendar/callback`. Note: `/auth/google` and `/calendar/*` are **two entirely separate OAuth client configurations** — see §Google OAuth — Two Flows below before implementing either.

# Authorization

Per the permissions matrix in `requirements.md` §4, enforced via `require_role([...])`.

# Rate Limiting

Public/candidate-facing endpoints: 10 req/min/IP. All other authenticated endpoints: 60 req/min/user. Redis-backed token bucket (`DB_DESIGN.md` §Redis Design).

---

# Google OAuth — Two Flows, Never Conflated

| | `POST /auth/google` | `POST /calendar/connect` + `GET /calendar/callback` |
|---|---|---|
| Purpose | Login/identity | Read free/busy, create events |
| Scopes | `openid`, `email`, `profile` | Calendar-specific |
| Grants Calendar access? | **Never** | Yes — this is the only endpoint pair that does |
| Available to | Any role, for login | PANELIST, ADMIN only, as an explicit separate action |

A client integrating against this API must not assume that a successful `/auth/google` login implies any Calendar capability — `POST /interviews/{id}/recommendations` will fail with `PANELIST_CALENDAR_NOT_CONNECTED` for any required panelist who has not separately completed the `/calendar/connect` flow, regardless of how they logged in.

---

# AUTH `[MVP]`

### `POST /auth/register`
- **Purpose:** create a new user account (FR-001).
- **Authorization:** none (public).
- **Request body:** `{ "email": string, "password": string, "name": string, "role": "ADMIN"|"PANELIST"|"CANDIDATE", "timezone": string }`
- **Validation:** valid email; password ≥ 8 chars with ≥1 number; `role` enum; `timezone` valid IANA zone.
- **Response body:** `{ "id": uuid, "email": string, "name": string, "role": string }`
- **Success:** `201 Created`
- **Errors:** `422`; `409` (`EMAIL_ALREADY_REGISTERED`)
- **Side effects:** inserts `users` (bcrypt-hashed password); writes `audit_logs`.

### `POST /auth/login`
- **Purpose:** password authentication (FR-002).
- **Authorization:** none.
- **Request body:** `{ "email": string, "password": string }`
- **Response body:** `{ "access_token": string, "refresh_token": string, "token_type": "bearer", "user": { "id": uuid, "role": string } }`
- **Success:** `200 OK`
- **Errors:** `401` (`INVALID_CREDENTIALS` — identical message whether the email doesn't exist or the password is wrong)
- **Side effects:** logs the authentication event.

### `POST /auth/google`
- **Purpose:** Google **identity login only** (FR-003). **Does not touch Calendar scopes or `calendar_connections` in any way.**
- **Authorization:** none.
- **Request body:** `{ "id_token": string }` — a Google ID token obtained using **only** `openid`/`email`/`profile` scopes on the frontend.
- **Validation:** token verifies against Google's public keys, unexpired, and its scope claim contains no Calendar scope (defensive check — if a Calendar scope is somehow present, the endpoint ignores it entirely rather than acting on it, since this endpoint's contract is identity-only).
- **Response body:** same shape as `/auth/login`.
- **Success:** `200 OK`
- **Errors:** `401` (`INVALID_GOOGLE_TOKEN`)
- **Side effects:** creates a `users` row on first login (`auth_provider: "GOOGLE"`) or matches an existing one by email. **Never creates or modifies a `calendar_connections` row.**

### `POST /auth/refresh`
- **Purpose:** exchange a refresh token for a new access token (FR-004).
- **Authorization:** none (the refresh token is the credential).
- **Request body:** `{ "refresh_token": string }`
- **Validation:** valid, unexpired JWT whose `token_version` matches `users.token_version`.
- **Response body:** `{ "access_token": string, "token_type": "bearer" }`
- **Success:** `200 OK`
- **Errors:** `401` (`REFRESH_TOKEN_INVALID` or `REFRESH_TOKEN_REVOKED`)

---

# USERS `[MVP]`

### `GET /users/me`
- **Purpose:** return the caller's own profile (FR-005).
- **Authorization:** any authenticated role.
- **Response body:** `{ "id": uuid, "email": string, "name": string, "role": string, "timezone": string }`
- **Success:** `200 OK`
- **Errors:** `401`

---

# CALENDAR `[MVP]`

This module is entirely separate from AUTH — see §Google OAuth above. Available only to ADMIN/PANELIST.

### `POST /calendar/connect`
- **Purpose:** begin the **Calendar-scoped** OAuth flow (FR-008).
- **Authorization:** ADMIN or PANELIST.
- **Request body:** none.
- **Response body:** `{ "authorization_url": string }` — requests Calendar-specific scopes only; the frontend redirects here.
- **Success:** `200 OK`
- **Errors:** `401`
- **Side effects:** none yet — tokens are stored only on callback.

### `GET /calendar/callback`
- **Purpose:** OAuth callback — exchanges the code for Calendar-scoped tokens (FR-008).
- **Authorization:** none directly; the `state` parameter round-trips the authenticated user's id, signed and verified server-side.
- **Request:** query params `?code=&state=`.
- **Validation:** `state` matches an issued value, unexpired (5-minute window).
- **Response:** redirects the browser to the frontend's "calendar connected" page.
- **Success:** `302 Found`
- **Errors:** redirect to a frontend error page on `state` mismatch or token-exchange failure.
- **Side effects:** upserts `calendar_connections` with `status = 'CONNECTED'`, encrypted tokens, and `scopes_granted` recorded from Google's response; writes `audit_logs` (`action: "CALENDAR_CONNECTED"`).

### `GET /calendar/status`
- **Purpose:** let the frontend show whether the current user's calendar is connected, and its lifecycle status (supports FR-010's "never guess" requirement by making the state visible before it causes a downstream failure).
- **Authorization:** ADMIN or PANELIST (own status only).
- **Response body:** `{ "status": "CONNECTED"|"EXPIRED"|"REVOKED"|"DISCONNECTED", "last_synced_at": string|null }`
- **Success:** `200 OK`
- **Errors:** `401`

---

# INTERVIEW REQUESTS `[MVP]`

### `POST /interviews`
- **Purpose:** create a new interview request (FR-012).
- **Authorization:** ADMIN only.
- **Request body:** `{ "candidate_id": uuid, "round_type": "SCREENING"|"TECHNICAL"|"MANAGERIAL"|"HR", "duration_minutes": int, "buffer_minutes": int (optional, default 15), "panelist_ids": [uuid] }`
- **Validation:** `candidate_id` references a `CANDIDATE`; every `panelist_ids` entry references a `PANELIST`; `duration_minutes` > 0; at least one panelist.
- **Response body:** the created `interview_requests` row plus its `interview_participants`.
- **Success:** `201 Created`
- **Errors:** `422`; `404` (unknown candidate/panelist id)
- **Side effects:** inserts `interview_requests` (`status: "DRAFT"`) and `interview_participants`; writes `audit_logs`.

### `GET /interviews`
- **Purpose:** list requests visible to the caller (FR-013).
- **Authorization:** any authenticated role — filtered per role.
- **Request:** `?status=&page=&size=`.
- **Response body:** paginated list, filtered per the permissions matrix.
- **Success:** `200 OK`

### `GET /interviews/{id}`
- **Purpose:** detail view (FR-013).
- **Authorization:** ADMIN, or PANELIST/CANDIDATE if a participant.
- **Response body:** full request + participants + latest `recommendation_runs` summary (if any) + `interview_events` (if booked).
- **Success:** `200 OK`
- **Errors:** `404` (not found or not visible)

### `PATCH /interviews/{id}`
- **Purpose:** update participants/round details pre-booking (FR-014).
- **Authorization:** ADMIN only.
- **Request body:** any subset of `{ "round_type", "duration_minutes", "buffer_minutes", "panelist_ids" }`.
- **Validation:** only while `status` is `DRAFT` or `AWAITING_CANDIDATE_AVAILABILITY`; later states → `409` (`REQUEST_LOCKED_FOR_EDITING`).
- **Success:** `200 OK`
- **Errors:** `422`; `409`; `404`

---

# AVAILABILITY `[MVP]`

### `POST /interviews/{id}/candidate-availability`
- **Purpose:** candidate submits availability (FR-015, FR-016).
- **Authorization:** CANDIDATE only, and only the request's own candidate.
- **Request body:** `{ "timezone": string, "windows": [ { "start_time": ISO8601, "end_time": ISO8601 } ] }`
- **Validation:** 1–10 windows; each `end_time` > `start_time`; each `start_time` in the future; windows within a bounded horizon (e.g., 21 days).
- **Response body:** the created `candidate_availability` + `availability_windows`.
- **Success:** `201 Created`
- **Errors:** `422` (with `field_errors` pointing at the offending window index); `403`; `409` (`REQUEST_NOT_AWAITING_AVAILABILITY`)
- **Side effects:** inserts rows; transitions `interview_requests.status → READY_FOR_SCHEDULING`; writes `audit_logs`.

### `GET /interviews/{id}/availability`
- **Purpose:** view submitted availability.
- **Authorization:** ADMIN, or the owning CANDIDATE.
- **Success:** `200 OK`
- **Errors:** `404`

---

# SCHEDULING `[MVP]`

### `POST /interviews/{id}/recommendations`
- **Purpose:** run the Scheduling Service, which gathers real data and calls the pure Scheduling Engine, returning ranked, explained candidate slots (FR-017–FR-023).
- **Authorization:** ADMIN only in the MVP (CANDIDATE read-only viewing is via `GET /interviews/{id}` once booked/recommended; candidate-triggered self-service is Post-MVP — see RESCHEDULING below).
- **Request body:** none — all inputs are derived from stored data.
- **Validation:** request must be in `READY_FOR_SCHEDULING` (or `RESCHEDULING`, Post-MVP); every panelist must have a `calendar_connections` row with `status = 'CONNECTED'`, or the call fails fast naming the panelist rather than silently excluding them.
- **Response body:**
```json
{
  "recommendation_run_id": "uuid",
  "slots": [
    {
      "start_time": "2026-09-10T09:30:00Z",
      "end_time": "2026-09-10T10:00:00Z",
      "total_score": 0.92,
      "score_breakdown": {
        "timezone_fairness": 0.90,
        "working_hours_comfort": 0.85,
        "scheduling_proximity": 0.95,
        "workload_balance": 1.00,
        "buffer_quality": 0.90
      },
      "explanation": "Strong timezone fairness and light interviewer workload; slightly later than the earliest option.",
      "rank": 1
    }
  ]
}
```
  Note: `score_breakdown` keys match `requirements.md` §8's five factors exactly — this is the same JSON persisted into `recommended_slots.score_breakdown` by the Scheduling Service, not a separate presentation-layer computation.
- **Success:** `200 OK`
- **Errors:** `409` (`NOT_READY_FOR_SCHEDULING`); `424` (`PANELIST_CALENDAR_NOT_CONNECTED`, naming which panelist); `424` (`CALENDAR_CONNECTION_REVOKED` / `CALENDAR_CONNECTION_EXPIRED`, naming which panelist — distinct from "not connected," per `requirements.md` §9d); `422` (`NO_COMMON_AVAILABILITY` — transitions the request to `FAILED`)
- **Side effects:** the **Scheduling Service** (not the Router) calls the Calendar integration module for fresh/cached free-busy, calls the **pure Scheduling Engine**, and persists `recommendation_runs` + `recommended_slots` via Repository; transitions `interview_requests.status → RECOMMENDED` on success or `→ FAILED` on no-common-availability; writes `audit_logs`.

---

# BOOKING `[MVP — the acceptance-gate endpoint]`

### `POST /interviews/{id}/book`
- **Purpose:** confirm one recommended slot and create the real Calendar event, using the compensating-action consistency strategy (FR-024–FR-029; `requirements.md` §10; `DB_DESIGN.md` §Concurrency Strategy).
- **Authorization:** ADMIN only in the MVP (candidate self-service booking is Post-MVP — see RESCHEDULING below).
- **Request body:** `{ "recommended_slot_id": uuid }`
- **Validation:** the slot id must belong to the request's most recent `recommendation_run`; request must be `RECOMMENDED`.
- **Response body (success):** the created `interview_events` row, including `meeting_link`.
- **Success:** `201 Created`
- **Errors:**
  - `409` (`SLOT_NO_LONGER_AVAILABLE`) — the Redis lock was already held, or re-validation found a participant no longer free (step 1–2 of the sequence).
  - `502` (`CALENDAR_EVENT_CREATION_FAILED`) — the Calendar API call itself failed after retries (step 4). **No DB row is created; the request remains `RECOMMENDED`.**
  - `500` (`BOOKING_PERSISTENCE_FAILED`) — the Calendar event was created successfully but the subsequent database write failed (step 6). **A compensating cancellation of the Calendar event is attempted automatically; this response means the booking did not complete, regardless of the Calendar side-effect, which is being cleaned up.** The request remains `RECOMMENDED`.
  - `404` — unknown `recommended_slot_id`.
- **Side effects — the full sequence, explicitly not a single distributed transaction (`requirements.md` §10):**
  1. Acquire `lock:booking:{id}` in Redis.
  2. Re-validate the slot is still current.
  3. Check for existing conflicting bookings.
  4. Call the Google Calendar API to create the event — **outside** any DB transaction.
  5. Receive `calendar_event_id` and `meeting_link`.
  6. Insert `interview_events` and update `interview_requests.status → BOOKED` inside a **PostgreSQL-only** transaction.
  7. Commit.
  8. Release the lock.
  If step 6 fails: attempt to delete the Calendar event created in step 4; log the failure; if that delete also fails, create a `reconciliation_tasks` row and log the external event id — **the response to the client is a failure in every one of these sub-cases; success is only ever reported once the local DB commit in step 7 has actually happened.**

---

# RESCHEDULING `[POST-MVP]`

Not part of the Core Demo Loop or the MVP Acceptance Gate. Do not build before `IMPLEMENTATION.md` Phase 7's gate passes.

### `POST /interviews/{id}/decline`
- **Purpose:** a panelist declines their assigned interview (FR-033, FR-034).
- **Authorization:** PANELIST only, and only a participant on this request.
- **Request body:** `{ "reason": string (optional) }`
- **Response body:** `{ "interview_request_status": "RESCHEDULING" }` (if was `BOOKED`) or `{ "interview_request_status": "READY_FOR_SCHEDULING" }` (if pre-booking).
- **Success:** `200 OK`
- **Errors:** `403`; `404`
- **Side effects:** updates `interview_participants.response_status → DECLINED`; if `BOOKED`, cancels the `interview_events` row, transitions state, automatically re-triggers `POST /interviews/{id}/recommendations` server-side, and queues re-notification.

### `POST /interviews/{id}/reschedule`
- **Purpose:** candidate-initiated self-service reschedule of a booked interview (FR-036) — **this is also where candidate self-service booking, deferred from the MVP tier per `requirements.md` §5, is implemented.**
- **Authorization:** CANDIDATE (owner) or ADMIN.
- **Request body:** `{ "reason": string (optional) }`
- **Response body:** same shape as `/decline`.
- **Success:** `200 OK`
- **Errors:** `409` (`NOT_BOOKED`); `403`; `404`
- **Side effects:** same as `/decline`'s "was booked" branch.

### `POST /interviews/{id}/cancel`
- **Purpose:** outright cancellation (FR-035).
- **Authorization:** ADMIN only.
- **Request body:** `{ "reason": string (optional) }`
- **Response body:** `{ "interview_request_status": "CANCELLED" }`
- **Success:** `200 OK`
- **Errors:** `409` (already terminal); `404`
- **Side effects:** cancels any active `interview_events`; transitions to `CANCELLED` (terminal); writes `audit_logs`; sends a cancellation notification if any event existed.

---

# AUDIT `[POST-MVP]`

### `GET /interviews/{id}/audit`
- **Purpose:** retrieve the audit trail for one request (FR-038). The underlying `audit_logs` writes (FR-037) happen opportunistically from MVP phases onward; this endpoint — the *viewing* feature — is Post-MVP.
- **Authorization:** ADMIN only.
- **Request:** `?page=&size=`.
- **Response body:** paginated `audit_logs` rows scoped to `entity_id = {id}`.
- **Success:** `200 OK`
- **Errors:** `404`
