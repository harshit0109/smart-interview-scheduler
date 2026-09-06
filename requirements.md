# Smart Interview Scheduler — Software Requirements Specification

**Status:** Architecture Consistency Pass complete. This revision resolves: (1) explicit Google Login vs. Google Calendar OAuth separation, (2) practical (non-distributed-transaction) booking consistency, (3) a locked, three-tier MVP/Post-MVP/Bonus scope aligned to a single Core Demo Loop, (4) a precise 10-step Scheduling Engine specification with a documented scoring formula. This document remains the single source of truth; `CODING_GUIDELINES.md`, `IMPLEMENTATION.md`, `DB_DESIGN.md`, and `API_DESIGN.md` are derived from it and must stay consistent with it.

---

# 1. Project Overview

**Project name:** Smart Interview Scheduler

**Problem statement:** Talent acquisition teams spend significant time coordinating interviews among candidates, recruiters, hiring managers, and interview panelists — manually cross-referencing calendars, chasing availability over email, and re-doing the process every time someone declines.

**Background:** A typical interview round requires 2–4 internal participants (recruiter, hiring manager, one or more panelists) plus the candidate to all agree on one time slot. Availability lives in separate calendars nobody else can see, and constraints (time zone, working hours, interviewer load) are tracked in someone's head, not in a system.

**Why interview scheduling is difficult:**
- Availability is distributed across N independent calendars with no shared visibility.
- Constraints are multi-dimensional simultaneously: duration, working hours, time zone, buffer time, and panelist load.
- Time-zone arithmetic is a well-known source of silent, hard-to-catch errors when done manually or naively in code.

**Current manual coordination problems:**
- Email/chat back-and-forth to collect candidate availability.
- Manual eyeballing of multiple calendars to find overlap.
- No visibility into *why* a particular time was chosen over another.
- No systematic handling of declines or reschedules.

**Project vision:** A system where a recruiter creates an interview request and the system finds, ranks, explains, and books the interview — with a real, working calendar event and meeting link at the end.

**Unique value proposition:** *"Don't just schedule an interview. Explain why this is the best possible interview slot."* The system generates every valid candidate slot, scores each one against named, deterministic factors, and surfaces the **score breakdown and explanation** as a visible, persisted part of the product — not a debug log.

---

# 2. Problem Understanding

| Sub-problem | What makes it hard |
|---|---|
| **Candidate availability** | Candidates have no connected calendar in this system; availability is collected as explicit, validated time windows, in their own time zone. |
| **Multiple interviewer coordination** | Every additional required panelist reduces the odds of a common free slot combinatorially. |
| **Calendar conflicts** | A panelist's calendar can change between when availability was fetched and when a slot is booked. |
| **Different time zones** | A slot that is "9am" for one person may be "11pm" for another — fairness, not just feasibility, matters. |
| **Working hours** | Even within a person's free time, some hours are undesirable and should be scored down, not just allowed. |
| **Interview duration** | Slots must be exactly long enough for the specific round's duration. |
| **Panelist availability** | Sourced live from Google Calendar, not manually maintained. |
| **Rescheduling** | A decline should not require a human to manually restart the whole process (Post-MVP — see Section 5). |
| **Declined invitations** | The system must distinguish "no response yet" from "declined" (Post-MVP — see Section 5). |

---

# 3. Stakeholders

| Stakeholder | Goals | Responsibilities | Interaction with system |
|---|---|---|---|
| **Recruiter/Admin** | Fill the role quickly with minimal manual coordination | Create interview requests, assign panelists, select the final slot | Full portal access — creates requests, views all requests, books |
| **Candidate** | Book an interview with minimal friction, at a time that respects their time zone | Submit availability | Receives a link, submits availability, views recommended slots (read-only in MVP — see Section 5 note on who books) |
| **Interviewer/Panelist** | Be scheduled at reasonable times without conflicting with existing commitments | Connect Google Calendar so free/busy is available | Connects Google Calendar explicitly (separate from login — see Section 4) |
| **Hiring Manager** | Visibility into pipeline status | Same actions as Recruiter/Admin | **Represented via the ADMIN role** — no separate login role; distinguishing "Hiring Manager" from "Recruiter" would add a role dimension with no different permission set |
| **System Administrator** | Keep the service running and secure | Deploy, monitor, rotate secrets | **Not an application user/RBAC role** — an operations concern (`CODING_GUIDELINES.md`), not a portal login |

---

# 4. User Roles and RBAC

Three application roles, enforced server-side on every mutating endpoint:

| Role | Summary |
|---|---|
| **ADMIN** | Recruiter/Hiring-Manager — creates requests, reviews recommendations, books the slot |
| **PANELIST** | Interviewer — connects Google Calendar so their free/busy can be read |
| **CANDIDATE** | Applicant — submits availability |

### Permissions Matrix

| Action | ADMIN | PANELIST | CANDIDATE |
|---|:---:|:---:|:---:|
| Create interview request | Y | N | N |
| View all interview requests | Y | N | N |
| View own assigned/related interview request | Y | Y (own) | Y (own) |
| Assign/change panelists on a request | Y | N | N |
| Submit candidate availability | N | N | Y (own request) |
| View recommended slots + score breakdown | Y | N | Y (own request, read-only) |
| **Book/confirm a slot** | **Y (MVP)** | N | N in MVP — self-service booking is **Post-MVP** (Section 5) |
| Connect Google Calendar | N | Y (own) | N |
| Accept/decline an assigned interview | N | Y (own) — **Post-MVP** | N |
| Cancel an interview request | Y — **Post-MVP** | N | N |
| Trigger/approve a reschedule | Y / Y / Y — **Post-MVP** | — | — |
| View audit log | Y — **Post-MVP** | N | N |
| View scheduling analytics | Y — **Post-MVP** | N | N |
| Create/deactivate user accounts | Y | N | N |

**Note on Google Login vs. Google Calendar (see also Section 9):** logging in with Google grants identity only (name/email), never Calendar access. A PANELIST or ADMIN may be logged in — via password or Google identity login, it makes no difference — and still have **no** connected calendar until they take the separate, explicit "Connect Google Calendar" action. The system must never assume Calendar access exists just because a user authenticated via Google.

---

# 5. Assumed Functional Features — Locked MVP Scope

The hackathon brief leaves functional scope open by design. This is the explicit, locked answer, in three tiers. **Tier boundaries are a hard rule, not a suggestion: no Post-MVP or Bonus work starts before the MVP Acceptance Gate (see `IMPLEMENTATION.md`) passes.**

### Core Demo Loop (defines the MVP)

```
Admin/Recruiter creates interview request
        ↓
Candidate submits availability
        ↓
System obtains panelist calendar availability (Google Calendar free/busy)
        ↓
Scheduling Engine finds valid overlapping slots
        ↓
Scheduling Engine scores and ranks the slots
        ↓
UI shows each recommended slot with its score breakdown and explanation
        ↓
Admin/Recruiter selects a slot
        ↓
System prevents double-booking (Redis lock + revalidation, see Section 9a)
        ↓
Google Calendar event is created, with a Google Meet link
        ↓
Participants receive a confirmation (real email if feasible; may degrade to a logged/simulated confirmation without blocking the gate — see Section 5, Real vs. Mocked)
```

### MVP — MUST COMPLETE

| Feature | Why it's MVP, not Post-MVP/Bonus |
|---|---|
| Google identity login (password + Google OAuth, identity scopes only) | Prerequisite to every role-gated action in the loop |
| Explicit, separate Google Calendar connection action for PANELIST/ADMIN | The loop cannot fetch real free/busy without it — this is not a bonus, it is load-bearing (Section 9) |
| Interview request creation (candidate, round type, duration, buffer, panelists) | Step 1 of the loop |
| Candidate availability submission, validated | Step 2 of the loop |
| Panelist free/busy retrieval via Google Calendar | Step 3 of the loop |
| Scheduling Engine: intersection, duration/buffer/working-hours constraints, deterministic 5-factor scoring (Section 7), ranking, explanation generation | Steps 4–6 of the loop — this is the project's stated differentiator, not optional |
| Time-zone fairness and buffer quality as scoring factors | These are two of the five scoring factors baked into the engine itself (Section 7) — not separable "bonus" add-ons as in earlier drafts of this document |
| UI display of ranked slots with visible score breakdown + explanation | Step 6 of the loop — explainability is a product requirement, not decoration |
| Admin/Recruiter books the selected slot | Step 7 of the loop. **Candidate self-service booking is explicitly Post-MVP** — the Core Demo Loop has the Recruiter selecting the slot |
| Double-booking prevention (Redis lock, revalidation, compensating-action consistency — Section 9a) | Step 8 of the loop |
| Real Google Calendar event creation | Step 9 of the loop |
| Real Google Meet link generation via the Calendar API | Step 9 of the loop |
| Confirmation to participants | Step 10 of the loop — see Real vs. Mocked note below: real email is the target, but is allowed to degrade to a logged/simulated confirmation without blocking the MVP Acceptance Gate if provider integration proves risky |
| Minimal RBAC sufficient to gate the above (ADMIN, PANELIST connect-only, CANDIDATE submit-only) | Required to make the loop meaningful and secure |

### POST-MVP — Implement only after the MVP Acceptance Gate passes

| Feature | Note |
|---|---|
| Automated reminder emails ahead of the interview | Confirmation email is MVP; scheduled reminders are an enhancement on top of it |
| Panelist accept/decline workflow | Not part of the Core Demo Loop — free/busy is the scheduling source of truth, not manual per-interview acknowledgment |
| Automatic re-recommendation on decline/cancellation | Depends on the decline workflow above |
| Admin cancellation workflow | Depends on booking existing first |
| Candidate self-service booking & reschedule | Reuses MVP endpoints, but is explicitly not in the Core Demo Loop (Admin books, not Candidate) |
| Full audit-trail viewing/UI | The underlying `audit_logs` table may be written to opportunistically during MVP phases as a side effect, but a dedicated audit UI/endpoint is Post-MVP |
| Basic scheduling analytics | Depends on audit/booking data existing first |

### BONUS / STRETCH — only if Post-MVP is also complete

| Feature | Note |
|---|---|
| AI-personalized notification copy | Isolated to non-critical text generation only; never touches scheduling correctness |
| Intelligent panelist selection by skill | Requires a skill-tagging data model not otherwise needed |
| Advanced analytics dashboard | Beyond the basic Post-MVP metrics |
| SMS/WhatsApp/other channels | Explicitly mocked/simulated only if attempted at all — see Real vs. Mocked below |
| Complex automation (e.g., rule-based auto-approval) | Not needed to prove the core thesis of the product |

### Real vs. Mocked Integrations (applies across all tiers)

| Integration | Status |
|---|---|
| Google Calendar (free/busy + event creation) | **REAL — required.** The core loop is meaningless without it. |
| Google Meet link generation (via Calendar API `conferenceData`) | **REAL — required.** Same API call already being made for event creation. |
| Core database persistence (PostgreSQL + Redis) | **REAL — required.** |
| Email delivery (confirmation) | **REAL if feasible; degrade to logged/simulated if provider setup becomes a blocker.** This is the one deliberate flexibility point in the MVP tier — the MVP Acceptance Gate (`IMPLEMENTATION.md`) is defined around the booking/Calendar-event outcome, not the email send, precisely so that an email-provider hiccup cannot block the gate. |
| SMS / WhatsApp / other messaging platforms | **Mocked/simulated only, if attempted at all** — never a real integration in this hackathon cycle; explicitly Bonus-tier and out of scope otherwise |

---

# 6. Functional Requirements

### Authentication & User Management
- **FR-001** — The system shall allow a user to register with email and password.
- **FR-002** — The system shall allow a user to log in with email and password, issuing a JWT access token and a refresh token.
- **FR-003** — The system shall allow a user to authenticate via Google OAuth2 using **only identity scopes** (`openid`, `email`, `profile`). This flow grants login/identity only and shall never itself request or receive Calendar scopes.
- **FR-004** — The system shall allow a user to obtain a new access token using a valid, unrevoked refresh token.
- **FR-005** — The system shall allow a user to retrieve their own profile (`/users/me`).

### RBAC
- **FR-006** — The system shall enforce role-based access control on every mutating endpoint, server-side, independent of any client-side UI restriction.
- **FR-007** — The system shall reject any request where the authenticated user's role does not match the permissions matrix (Section 4) with HTTP 403.

### Google Calendar Connection (separate from login — Section 9)
- **FR-008** — The system shall allow a PANELIST or ADMIN to explicitly initiate a Google Calendar connection, via a distinct OAuth authorization flow requesting Calendar-specific scopes, independent of how they logged in.
- **FR-009** — The system shall never infer or grant Calendar access as a side effect of Google identity login.
- **FR-010** — The system shall track the lifecycle status of each Calendar connection (`CONNECTED`, `EXPIRED`, `REVOKED`, `DISCONNECTED` — Section 9) and shall not attempt free/busy retrieval or event creation against a connection that is not `CONNECTED`.
- **FR-011** — The system shall detect a revoked or expired Calendar connection when a Google API call fails with an authorization error, mark the connection accordingly, and surface a specific, actionable error naming the affected panelist rather than failing silently or misreporting them as simply "busy."

### Interview Request Management
- **FR-012** — The system shall allow an ADMIN to create an interview request specifying candidate, round type, duration, buffer time, and required panelists.
- **FR-013** — The system shall allow an ADMIN to view all interview requests; PANELIST and CANDIDATE shall only view requests they are a participant of.
- **FR-014** — The system shall allow an ADMIN to update an interview request's participants or round details while it is in a non-booked state.

### Candidate & Panelist Availability
- **FR-015** — The system shall allow a CANDIDATE to submit one or more availability windows, each with a start time, end time, and time zone.
- **FR-016** — The system shall validate submitted availability windows (end after start, within a reasonable future date range, bounded window count) and reject invalid submissions with a specific, field-level error.
- **FR-017** — The system shall retrieve panelist free/busy data from Google Calendar for the interview's candidate date range, only for panelists with a `CONNECTED` calendar connection.
- **FR-018** — The system shall cache retrieved free/busy data in Redis with a defined TTL to avoid redundant Calendar API calls.

### Scheduling Intelligence (see Section 7 for the full specification)
- **FR-019** — The Scheduling Engine shall normalize all availability data to UTC before processing, as a pure function with no database, cache, or external API access (`CODING_GUIDELINES.md` §Architecture Principles).
- **FR-020** — The Scheduling Engine shall compute each participant's free intervals, intersect them across all required participants, and generate every valid candidate slot given duration and buffer constraints.
- **FR-021** — The Scheduling Engine shall score every candidate slot using the five named, weighted factors defined in Section 7, and return each slot's total score, per-factor breakdown, and a human-readable explanation.
- **FR-022** — The Scheduling Service (distinct from the Engine — Section 7a) shall gather the required input data via repositories and the Calendar integration, normalize it, invoke the Engine, and persist the run and its scored slots.
- **FR-023** — The system shall persist every recommendation run and its scored slots (`recommendation_runs`, `recommended_slots`) for later audit/explanation, even after a different slot is ultimately booked.

### Booking
- **FR-024** — The system shall allow an ADMIN to book one of the currently recommended slots.
- **FR-025** — The system shall prevent two simultaneous booking attempts on the same interview request from both succeeding, using the practical consistency strategy defined in Section 9a — not a distributed transaction spanning PostgreSQL and Google Calendar.
- **FR-026** — The system shall create a Google Calendar event with all participants upon successful booking, and shall not persist a booking record in PostgreSQL unless the Calendar event was created successfully.
- **FR-027** — The system shall attach an auto-generated Google Meet link to the created calendar event.
- **FR-028** — If Calendar event creation succeeds but subsequent database persistence fails, the system shall attempt a compensating cancellation of the created Calendar event, log the failure, and return a recoverable error indicating the booking did not complete (Section 9a).
- **FR-029** — If the compensating cancellation itself fails, the system shall log the external Calendar event ID, create a reconciliation record for manual/retry follow-up, and shall never report booking success to the user in this case.

### Notifications
- **FR-030** — The system shall send a confirmation notification on successful booking; if real email delivery is not feasible within the hackathon timeframe, this may be implemented as a logged/simulated confirmation without blocking the MVP Acceptance Gate (Section 5).
- **FR-031** *(Post-MVP)* — The system shall send scheduled reminder notifications ahead of the interview.
- **FR-032** *(Post-MVP)* — The system shall log every notification attempt regardless of success or failure.

### Declines, Cancellation & Rescheduling *(all Post-MVP)*
- **FR-033** *(Post-MVP)* — The system shall allow a PANELIST to decline an assigned interview.
- **FR-034** *(Post-MVP)* — The system shall, upon a decline of a booked interview, automatically transition the request back into scheduling and re-run the recommendation engine.
- **FR-035** *(Post-MVP)* — The system shall allow an ADMIN to cancel an interview request at any non-terminal state.
- **FR-036** *(Post-MVP)* — The system shall allow a CANDIDATE to request a reschedule of their own booked interview.

### Audit Logging *(basic writes are opportunistic during MVP; the viewing feature is Post-MVP)*
- **FR-037** — The system shall record an audit log entry for key state-changing actions (request created, recommendation generated, booking succeeded/failed), capturing actor, role, action type, entity, and metadata.
- **FR-038** *(Post-MVP)* — The system shall expose an endpoint for an ADMIN to retrieve the audit trail for a given interview request.

---

# 7. Scheduling Intelligence Requirements

This is the core differentiator of the product. It is specified precisely so it can be implemented, tested, and defended without ambiguity.

## 7a. Engine vs. Service — a hard architectural boundary

| | Scheduling Engine | Scheduling Service |
|---|---|---|
| **Nature** | Pure business logic — a function of its inputs only | Orchestration layer |
| **May access** | Nothing external — no DB, no cache, no HTTP, no Google API | PostgreSQL (via repository), Redis (via cache client), Google Calendar (via integration module) |
| **Responsibilities** | Normalize, validate, merge, intersect, generate candidate slots, score, rank, explain | Gather availability data, call the Calendar integration, normalize inputs for the Engine, invoke the Engine, persist `recommendation_runs`/`recommended_slots` via repository |
| **Testability** | Fully unit-testable with synthetic data, no mocks needed | Tested with integration tests (real or sandboxed dependencies) |

This boundary is enforced at the code level (`CODING_GUIDELINES.md` §Architecture Principles): the Engine module has zero imports of any database, HTTP, or Google API library. This is what makes it the easiest, most defensible module in the codebase during a code walkthrough.

## 7b. Input (gathered by the Scheduling Service, passed into the Engine)

- Candidate availability windows (start, end, time zone)
- Panelist free/busy blocks (from Google Calendar, per panelist)
- Each participant's time zone
- Working-hours preference per participant (default 09:00–18:00 local, overridable)
- Interview round's required duration (minutes)
- Configurable buffer time (minutes; org default, overridable per panelist)
- Scheduling constraints (date-range horizon, minimum notice period)

## 7c. Processing — exact 10-step pipeline

1. **Normalize** every input timestamp to UTC. No downstream step reasons in local time.
2. **Validate** availability windows (structurally valid, end after start, within the allowed horizon) — malformed input is rejected here, before any computation.
3. **Merge overlapping busy intervals**, per participant, into a minimal set.
4. **Generate free intervals** per participant: (working-hours window, per calendar day in range) minus (merged busy intervals).
5. **Find intersections** — a sweep-line computation of the intervals where *every* required participant is simultaneously free.
6. **Apply constraints** to the intersected free time: interview duration, required buffer time, and working-hour boundaries.
7. **Generate valid candidate slots** by sliding a window of `duration + buffer` minutes across each constrained free interval, at a fixed step (e.g., 15-minute increments).
8. **Score** every candidate slot using the five-factor model (Section 8).
9. **Rank** candidate slots by total score, descending.
10. **Return the top-N (default 3) recommendations**, each with its score, rank, full score breakdown, and a generated explanation naming the most influential factors.

## 7d. Output (per recommended slot)

- `start_time`, `end_time`
- `total_score` (0.0–1.0)
- `rank`
- `score_breakdown` (per-factor scores — Section 8)
- `explanation` (human-readable string)
- `relevant_reasoning_factors` (the 1–2 factor names that most influenced this slot's rank, used to generate the explanation string)

The Engine uses **deterministic, explainable scoring only**. No machine learning is used in the correctness-critical ranking path — this is a documented design decision (Section 8), not a limitation, and is the direct answer to the bonus item "responsible use of AI to rank suitable slots."

---

# 8. Scoring Model

Deterministic weighted sum of five named factors:

```
Final Score =
    w1 × Timezone Fairness
  + w2 × Working-Hours Comfort
  + w3 × Scheduling Proximity
  + w4 × Workload Balance
  + w5 × Buffer Quality
```

Default weights (configurable constants, not hardcoded inline): `w1=0.30, w2=0.20, w3=0.20, w4=0.15, w5=0.15` (sum = 1.00).

| Factor | What it measures | How it's calculated (simple, not ML) |
|---|---|---|
| **Timezone Fairness** | Is this slot equally reasonable for everyone, given they're in different zones? A *fairness* measure, not an absolute-comfort measure. | For each participant, compute how far the slot's local time deviates from the center of their comfortable window (normalized 0–1, 1 = centered). Take the **minimum across all participants** — fairness is governed by the worst-off participant, not the average. |
| **Working-Hours Comfort** | How close to the middle of an ordinary workday is this, in absolute terms? | Score 1.0 if the slot sits within a "core" band (e.g., 10:00–17:00 local) for every participant; decays linearly toward 0 as it approaches the outer edges of the allowed working-hours window. Distinct from Timezone Fairness: this is about absolute desirability, not relative fairness across zones. |
| **Scheduling Proximity** | How soon can this happen? | `score = max(0, 1 - days_until_slot / horizon_days)`, with `horizon_days` a configurable constant (e.g., 14) so "immediately" doesn't dominate every other factor beyond a reasonable point. |
| **Workload Balance** | Does this slot overload a panelist's day? | For each panelist, count already-booked interviews on the same calendar day; score decreases as the count increases (1.0 = no other interview that day). **Averaged across all panelists** — a team-level concern, not a single-worst-off concern. |
| **Buffer Quality** | Is there comfortable breathing room, or just the bare minimum? | `score = min(1.0, extra_buffer_available / buffer_minutes)` — a slot with double the configured minimum buffer available on both sides scores 1.0; exactly the minimum scores lower but still valid. |

**Explanation generation:** the explanation string names the top 1–2 contributing factors (by weighted contribution to the total score) and, where relevant, one honest trade-off (e.g., "later than the earliest available option"). This is generated from the same `score_breakdown` object returned to the API — never a separate, undocumented heuristic.

**Explicit non-goal:** no machine-learned or LLM-based scoring is used here. This is documented as a deliberate choice for reliability and explainability, not a shortcut — see `requirements.md` §5 Bonus tier for where AI is used instead (personalized message copy only, never ranking).

---

# 9. Google OAuth — Two Separate Flows

This section exists specifically to prevent a common and dangerous conflation: **logging in with Google is not the same as connecting a Google Calendar.**

### 9a. Google Login (Authentication)
- **Purpose:** identity verification and basic profile info only.
- **Scopes:** `openid`, `email`, `profile` — nothing else.
- **Result:** issues the same JWT access/refresh token pair as password login. Sets `users.auth_provider = 'GOOGLE'`.
- **Does NOT** grant any Calendar read/write capability, regardless of role.

### 9b. Google Calendar Connection (Authorization)
- **Purpose:** reading free/busy, creating events, generating Meet links.
- **Scopes:** Calendar-specific (e.g., `calendar.events`, `calendar.freebusy`) — requested only in this flow, never during login.
- **Triggered by:** an explicit, separate user action ("Connect Google Calendar" button), available only to PANELIST and ADMIN roles.
- **Independent of login method:** a user who logged in with email/password can still connect a Google Calendar; a user who logged in via Google identity login still must separately connect a Calendar — the two are entirely decoupled.
- **Token storage:** access and refresh tokens for the Calendar grant are stored **encrypted at rest** in `calendar_connections`, distinct from any login-related token, and are never returned in any API response body (`CODING_GUIDELINES.md` §Security Standards).

### 9c. Calendar Connection Lifecycle

| Status | Meaning | Transition trigger |
|---|---|---|
| `CONNECTED` | Tokens valid, Calendar API calls succeed | Successful OAuth callback |
| `EXPIRED` | Access token expired but refresh token still valid | Detected on next use; system attempts silent refresh — if refresh succeeds, returns to `CONNECTED` transparently, no user action needed |
| `REVOKED` | Refresh token itself rejected by Google (user revoked access externally, e.g. from their Google Account settings) | Detected when a refresh attempt fails with an authorization error |
| `DISCONNECTED` | User explicitly disconnected within the app | Explicit user action |

### 9d. What happens if Calendar access is revoked or expired

- **Expired access token:** handled transparently via silent refresh; invisible to the user in the common case.
- **Revoked refresh token:** the connection is marked `REVOKED`. Any subsequent recommendation request involving this panelist fails fast with a specific error (`CALENDAR_CONNECTION_REVOKED`, naming the panelist) rather than silently treating them as fully busy or fully free — a wrong guess in either direction would corrupt the recommendation's correctness and its explainability. The ADMIN is shown a clear "this panelist needs to reconnect their calendar" message.
- **The system never guesses** a panelist's availability when their connection is not `CONNECTED` — this is a deliberate reliability requirement, not an oversight.

---

# 10. Booking Consistency (see also `DB_DESIGN.md` §Concurrency Strategy)

Google Calendar is an external system. **There is no distributed transaction spanning PostgreSQL, Redis, and the Google Calendar API** — this document does not claim otherwise, and no implementation may assume otherwise.

The practical, hackathon-appropriate consistency strategy:

1. Acquire a short-lived Redis lock for the interview request.
2. Revalidate the selected slot is still valid (re-check free/busy and existing bookings).
3. Check for conflicts/double-booking.
4. Call the Google Calendar API to create the event — **outside of any database transaction.**
5. Receive the external event ID and meeting link.
6. Persist the booking in PostgreSQL, inside a local database transaction (Postgres-only; does not span step 4).
7. Commit the database transaction.
8. Release the Redis lock.

**Failure handling is explicit, not assumed:**
- If step 4 (Calendar creation) fails → no DB booking is created, the lock is released, and a clear error is returned. The request remains `RECOMMENDED`.
- If step 4 succeeds but step 6 (DB persistence) fails → the system attempts a **compensating action**: delete/cancel the just-created Calendar event, log the failure, and return a recoverable error. This is a compensating-action (saga-style) strategy, explicitly **not** a rollback of a distributed transaction, because no such transaction exists.
- If the compensating delete **itself** fails → the external event ID is logged, a reconciliation record is created for manual/retry follow-up (`DB_DESIGN.md` §`reconciliation_tasks`), and — critically — **the user is never told the booking succeeded** in this case, even though an orphaned event may exist on Google's calendar until reconciled.

---

# 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Slot generation + scoring for ≤ 20 participants over a 2-week window completes in a target of < 300ms server-side compute time |
| Reliability | Booking failure modes are explicit and handled per Section 10 — never a silent partial state |
| Scalability | The application tier is stateless; horizontal scaling is possible without code change |
| Security | See Section 12 |
| Usability | Every async UI action has a distinct loading state and a specific, human-readable error message |
| Maintainability | Router → Service → Engine → Service → Repository layering (`CODING_GUIDELINES.md`) keeps the Engine testable independent of every other concern |
| Observability | Structured request logs plus an audit log for state-changing actions (two separate, non-conflated concerns) |
| Availability | A Calendar API outage degrades the affected request to a retry/queued state rather than failing the whole system |

---

# 12. Security Requirements

- Passwords hashed with bcrypt/argon2 — never stored or logged in plaintext.
- JWT access tokens short-lived (≈30 min); refresh tokens longer-lived (≈7 days), revocable via a `token_version` check.
- Google Calendar OAuth tokens stored encrypted at rest, never returned in any API response — kept in a table entirely separate from login credentials (Section 9).
- RBAC enforced server-side on every mutating route.
- All external input validated at the API boundary before touching business logic.
- No secrets in source control — environment variables only, `.env.example` documents required keys.
- Rate limiting on public/candidate-facing endpoints.
- Authentication events and all state-changing actions logged; secrets and tokens never appear in any log output.

---

# 13. Edge Cases

| Edge case | Expected behavior |
|---|---|
| No common availability found | Request transitions to `FAILED`; ADMIN sees a specific message and may adjust constraints and re-trigger |
| Double booking attempt | Exactly one booking succeeds; the other receives `SLOT_NO_LONGER_AVAILABLE` (Section 10) |
| Panelist becomes unavailable after recommendation but before booking | Booking re-validates free/busy at booking time; if now conflicting, booking fails with a clear error |
| Candidate submits invalid availability | Rejected at the API boundary with a field-specific error; no partial data persisted |
| Panelist's Calendar connection is revoked or expired | Handled per Section 9d — never guessed, always surfaced explicitly |
| Time zone changes between submissions | Time zone captured per submission, not globally, so a later submission with a different zone doesn't corrupt earlier data |
| DST transitions | All storage/computation in UTC; local-time conversion only at the display/API boundary, via IANA time zone data |
| Google Calendar API failure/timeout | Retried with bounded exponential backoff; on final failure, the request stays in its prior state with a clear "calendar sync failed, retrying" status |
| Calendar event created but DB persistence fails | Compensating cancellation attempted; if that also fails, a reconciliation record is created and the user is never told the booking succeeded (Section 10) |
| Network failure mid-booking | The Redis lock and the explicit failure-handling steps (Section 10) prevent any half-booked state from being reported as success |
| Duplicate/replayed booking request | Rejected via the Redis lock plus the DB uniqueness constraint (`DB_DESIGN.md`) |
| Expired candidate availability-submission link | *(Post-MVP if a time-boxed link is implemented at all — MVP uses a simple authenticated/role-scoped link)* |

---

# 14. Scope

### IN SCOPE (MVP + Post-MVP + Bonus, per Section 5's locked tiers)

### OUT OF SCOPE (this hackathon cycle, with justification)

| Excluded | Why |
|---|---|
| Multi-tenant/multi-org support | No evaluation upside for a single-team hackathon demo |
| Outlook/MS Graph integration | A second real calendar provider doubles OAuth/API surface for no additional score |
| Real Zoom integration | Requires marketplace app review that cannot complete in hackathon time; Meet (bundled with Calendar API) covers the same bonus point |
| Real SMS/WhatsApp | Mocked/simulated only if attempted at all — see Section 5 |
| Kubernetes / Kafka / a microservices split | No independent-scaling need at hackathon traffic scale; a modular monolith gets full separation-of-concerns credit at far lower operational risk |
| Distributed transactions across services | Explicitly rejected in favor of the practical compensating-action strategy (Section 10) |

### FUTURE SCOPE
- Outlook/MS Graph as a second Calendar provider implementation.
- SMS/WhatsApp as a real (not mocked) notification channel.
- Multi-organization tenancy.
- Revisiting deterministic scoring with a learned model, once enough historical booking data exists to validate one responsibly.

---

# 15. Success Criteria

**The MVP Acceptance Gate (verbatim, also stated in `IMPLEMENTATION.md`):**

> "We can successfully demonstrate the complete core interview scheduling loop from request creation to real Calendar booking."

Concretely, end to end, without manual calendar cross-checking:
1. An ADMIN creates an interview request; a CANDIDATE submits availability.
2. The system retrieves real panelist free/busy data from Google Calendar (for panelists with a `CONNECTED` calendar connection).
3. The Scheduling Engine returns ranked, explainable slot recommendations with a visible score breakdown for each.
4. The ADMIN books a recommended slot; the system prevents a simultaneous double-booking.
5. A real Google Calendar event is created with a working Google Meet link.
6. Participants receive a confirmation (real email, or a documented logged/simulated fallback per Section 5).

Post-MVP and Bonus success criteria are additive and are only evaluated once the above is demonstrated first.
