# Implementation Plan — Smart Interview Scheduler

Status: updated in the Architecture Consistency Pass. Same 13-phase (0–12) skeleton as before; this revision (1) tags every phase MVP / POST-MVP / BONUS, (2) splits the old combined "scheduling engine" phase into a pure-Engine phase followed by a separate Service+Calendar-integration phase, (3) rewrites the booking phase around the compensating-action strategy instead of an implied cross-system transaction, and (4) states the MVP Acceptance Gate verbatim, in one place, as the hard stop before any Post-MVP or Bonus work.

**THE MVP ACCEPTANCE GATE:**

> "We can successfully demonstrate the complete core interview scheduling loop from request creation to real Calendar booking."

This gate sits at the end of Phase 7. **No task tagged POST-MVP or BONUS may begin until this gate passes, in full, including the concurrency test.** This is the single hard rule in this document.

---

## PHASE 0 — Project Planning & Documentation
**Tier:** Prerequisite (neither MVP nor Post-MVP — this phase produces the plan itself)
**Duration:** 5%

**Overview:** No application code. Finalizes the five documents.

**Goal:** A frozen, internally consistent specification.

**Why this phase exists:** Re-litigating scope mid-build is the leading cause of unfinished hackathon projects.

**Prerequisites:** None.

**In scope:** Finalizing `requirements.md`, `CODING_GUIDELINES.md`, `IMPLEMENTATION.md`, `DB_DESIGN.md`, `API_DESIGN.md`, including the locked MVP/Post-MVP/Bonus tiers and the Engine/Service and OAuth separations.

**Explicitly out of scope:** Any code, any infrastructure.

**Deliverables:** The five documents, committed to `docs/`.

**Acceptance criteria:** Cross-document consistency verified (`requirements.md` features ↔ `IMPLEMENTATION.md` phases ↔ `DB_DESIGN.md` tables ↔ `API_DESIGN.md` endpoints — no contradictions).

**STOPPING CONDITION:** Stop once the team agrees no further scope discussion is needed.

---

## PHASE 1 — Foundation & Infrastructure
**Tier:** MVP
**Duration:** 8%

**Overview:** Repo structure, Docker Compose, empty FastAPI app, empty Next.js app, CI.

**Goal:** `docker-compose up` brings up Postgres, Redis, an empty backend, and an empty frontend, all reachable; green CI on an empty commit.

**Prerequisites:** Phase 0 complete.

**In scope:** Repo scaffold per `CODING_GUIDELINES.md`; `docker-compose.yml`; FastAPI `/health`; Next.js placeholder page; CI lint workflow; `.env.example` (including the two separate `GOOGLE_LOGIN_OAUTH_*`/`GOOGLE_CALENDAR_OAUTH_*` variable groups from `CODING_GUIDELINES.md`, even though neither is used yet).

**Explicitly out of scope:** Any business logic, any auth, any database tables beyond a connectivity check.

**Database changes:** None.

**APIs involved:** `GET /health` (infrastructure-only, not part of `/api/v1`).

**Deliverables:** Working Compose stack; green CI badge.

**Acceptance criteria:** A fresh clone + one command reaches both health checks.

**Testing requirements:** CI passes on an empty/near-empty commit.

**STOPPING CONDITION:** Stop once the stack and CI are green. No feature code yet.

---

## PHASE 2 — Database & Authentication (Login Only)
**Tier:** MVP
**Duration:** 10%

**Overview:** `users` table, password authentication, **Google Login OAuth (identity scopes only)**, JWT issuance, and the RBAC dependency used by every later route. This phase explicitly does **not** touch Google Calendar scopes or tokens — that is Phase 6.

**Goal:** A user can register, log in (password or Google identity login), receive a token pair, and access a role-protected test route; the wrong role is rejected with 403.

**Why this phase exists:** Every later module is built behind RBAC.

**Prerequisites:** Phase 1 complete.

**In scope:** Implement FR-001–FR-007; `users` table; `calendar_connections` table created now as a **schema-only** placeholder (empty until Phase 6 — this keeps the migration history linear without implying Calendar functionality exists yet); Auth module; `require_role()` dependency; `token_version` field; Google Login OAuth flow using **only** `openid`/`email`/`profile` scopes (`CODING_GUIDELINES.md` §OAuth Architecture).

**Explicitly out of scope:** Any interview-request logic; the separate Google Calendar OAuth flow and any Calendar API usage (Phase 6) — **do not request Calendar scopes here even "for later convenience."**

**Database changes:** Create `users`, `calendar_connections` (schema only).

**APIs involved:** `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/refresh`, `GET /users/me`.

**Deliverables:** Working register/login/OAuth/refresh flow.

**Acceptance criteria:** RBAC proven with an automated test; a Google-identity-login test explicitly asserts no Calendar-scoped token is requested or stored.

**Testing requirements:** Unit tests for hashing/JWT; integration test for the full auth flow; explicit 403 test; explicit "login grants no calendar access" assertion.

**STOPPING CONDITION:** Stop once RBAC and the login-only OAuth boundary are both proven with automated tests. Do not build the Calendar connect flow yet.

---

## PHASE 3 — Interview Request Management
**Tier:** MVP
**Duration:** 8%

**Overview:** CRUD for interview requests and their participants.

**Goal:** An ADMIN can create a request with a candidate and required panelists; roles list/view what they're permitted to see.

**Prerequisites:** Phase 2 complete.

**In scope:** Implement FR-012–FR-014; `interview_requests`, `interview_participants` tables; the `DRAFT` state and state-machine skeleton (full transitions arrive in later phases).

**Explicitly out of scope:** Availability collection (Phase 4), scheduling (Phases 5–6), booking (Phase 7).

**Database changes:** Create `interview_requests`, `interview_participants`.

**APIs involved:** `POST /interviews`, `GET /interviews`, `GET /interviews/{id}`, `PATCH /interviews/{id}`.

**Deliverables:** Working create/list/detail/update flow, RBAC-correct.

**Acceptance criteria:** Visibility rules per the permissions matrix verified by automated test for all three roles.

**STOPPING CONDITION:** Stop once visibility/RBAC tests pass.

---

## PHASE 4 — Candidate Availability
**Tier:** MVP
**Duration:** 7%

**Overview:** Candidate availability submission with validation.

**Goal:** A candidate submits valid windows; invalid ones are rejected with specific errors; the request transitions `AWAITING_CANDIDATE_AVAILABILITY → READY_FOR_SCHEDULING`.

**Prerequisites:** Phase 3 complete.

**In scope:** Implement FR-015, FR-016; `candidate_availability`, `availability_windows` tables.

**Explicitly out of scope:** Panelist free/busy retrieval (Phase 6); any scoring (Phase 5).

**Database changes:** Create `candidate_availability`, `availability_windows`.

**APIs involved:** `POST /interviews/{id}/candidate-availability`, `GET /interviews/{id}/availability`.

**Deliverables:** Working submission flow with validation errors demoable.

**Acceptance criteria:** Availability-related edge cases from `requirements.md` §13 are covered by automated tests.

**STOPPING CONDITION:** Stop once validation and the state transition are tested. Do not build scoring logic here.

---

## PHASE 5 — Scheduling Engine (Pure Business Logic)
**Tier:** MVP
**Duration:** 10%

**Overview:** Build the Engine **in isolation**, against synthetic data — no real Calendar, no database, no HTTP. This is the strict separation from FIX 1: the Engine is built and fully proven correct *before* the Service that will feed it real data exists.

**Goal:** Given plain-data inputs (synthetic availability, constraints, weights), the Engine returns the top-N scored, ranked, explained candidate slots exactly per `requirements.md` §7c (the 10-step pipeline) and §8 (the five-factor scoring model).

**Why this phase exists:** This is the project's stated differentiator. Building it dependency-free, first, and testing it exhaustively before anything else touches it is what makes it defensible in a code walkthrough.

**Prerequisites:** Phase 4 complete (so real candidate-availability *shapes* are known, even though this phase still uses synthetic data — it does not call Phase 4's repository).

**In scope:** Implement FR-019–FR-021; the 10-step pipeline (normalize → validate → merge → free-intervals → intersect → apply constraints → generate slots → score → rank → explain); the five scoring factors (Timezone Fairness, Working-Hours Comfort, Scheduling Proximity, Workload Balance, Buffer Quality) as independent, named, unit-tested functions; the explanation-string generator.

**Explicitly out of scope:** Any Google Calendar call; any database access; any HTTP endpoint; the Scheduling Service (Phase 6) — **this phase produces `engine.py`, `scoring.py`, `explain.py` and nothing else.**

**Database changes:** None — the Engine is stateless by design.

**APIs involved:** None — the Engine is not exposed directly; it is called by the Service in Phase 6.

**Deliverables:** A standalone, fully unit-tested Engine, demoable via a script feeding it synthetic multi-participant data and printing the ranked, scored, explained output.

**Acceptance criteria:** Unit tests pass for: no valid slot; exactly one valid slot; multiple slots with a verifiably correct ranking given known weights; the score breakdown is internally consistent with the documented weights (`requirements.md` §8); an automated check (or code review checklist item) confirms zero forbidden imports (`sqlalchemy`, `redis`, `httpx`, `fastapi`, any Google client) in `engine.py`/`scoring.py`/`explain.py`.

**STOPPING CONDITION:** Stop once every acceptance test above passes against synthetic data. Do **not** start Phase 6 wiring until this phase's Engine is frozen and proven — the Service in Phase 6 must treat the Engine as a black box it calls, not something it co-develops.

---

## PHASE 6 — Google Calendar Integration & Scheduling Service
**Tier:** MVP
**Duration:** 12%

**Overview:** Two things happen in this phase, both real-data-facing and both distinct from Phase 5: (a) the **separate Calendar OAuth connection flow** (distinct from Phase 2's login OAuth), and (b) the **Scheduling Service**, which orchestrates real data into the Phase 5 Engine.

**Goal:** A panelist can explicitly connect their real Google Calendar (independent of how they logged in); the system retrieves real free/busy data; the Scheduling Service normalizes it and calls the frozen Phase 5 Engine; `POST /interviews/{id}/recommendations` returns real, engine-ranked, explained slots.

**Why this phase exists:** This is where the product becomes real. Deliberately split from Phase 5 so a Calendar API surprise never contaminates the Engine's correctness, and deliberately split from Phase 2 so login and Calendar authorization never share code, per FIX 2.

**Prerequisites:** Phase 5's Engine is frozen and fully tested against synthetic data.

**In scope:**
- Implement FR-008–FR-011 (Calendar connection lifecycle) and FR-017–FR-018 (free/busy retrieval + caching).
- The **Calendar OAuth connect flow**, requesting Calendar-specific scopes only, populating the `calendar_connections` table (schema already existed from Phase 2) with encrypted tokens and a `status` field (`CONNECTED`/`EXPIRED`/`REVOKED`/`DISCONNECTED`).
- Silent access-token refresh on `EXPIRED`; detection and marking of `REVOKED` on a failed refresh.
- Retry-with-backoff wrapper on all outbound Calendar API calls.
- The **Scheduling Service** (`app/scheduling/service.py`): gathers candidate availability (Repository) and panelist free/busy (Calendar integration module), normalizes both into the Engine's expected input shape, calls the Phase 5 Engine, and persists the result via Repository into `recommendation_runs`/`recommended_slots` (FR-022, FR-023).
- The `POST /interviews/{id}/recommendations` endpoint, implemented as a thin Router wrapping the Service.

**Explicitly out of scope:** Outlook/MS Graph (out of scope, `requirements.md` §14); booking/event-creation-on-booking (Phase 7 — this phase may create a Calendar event only for manual developer verification, never as part of the request flow).

**Database changes:** Populate `calendar_connections` (add `status`, `scopes_granted` columns if not already present — see `DB_DESIGN.md`); create `recommendation_runs`, `recommended_slots`.

**APIs involved:** `POST /calendar/connect`, `GET /calendar/callback`, `POST /interviews/{id}/recommendations`.

**Deliverables:** A real connected test Google account; a real free/busy fetch; a real recommendations call returning ranked slots computed by the untouched Phase 5 Engine from real data.

**Acceptance criteria:** Simulating a Calendar API timeout does not crash the request — it retries per policy and returns a specific error; simulating a revoked refresh token correctly marks the connection `REVOKED` and the recommendations call fails fast naming that panelist, rather than guessing their availability (`requirements.md` §9d).

**Testing requirements:** Integration test against a sandbox Google account; unit test for retry/backoff using a mocked failing client; unit test for the `REVOKED` detection path.

**STOPPING CONDITION:** Stop once real free/busy data flows correctly into the unmodified Phase 5 Engine and a recommendations call returns real, ranked, explained slots. Do not build the booking flow yet.

---

## PHASE 7 — Booking & Conflict Prevention
**Tier:** MVP — **this phase's acceptance criteria ARE the MVP Acceptance Gate.**
**Duration:** 10%

**Overview:** Wire recommendation → selection → booking → real Calendar event, using the practical compensating-action consistency strategy from `requirements.md` §10 — explicitly **not** a distributed transaction across PostgreSQL and Google Calendar.

**Goal:** An ADMIN books one of the recommended slots; the system prevents two simultaneous bookings on the same request from both succeeding; a real Calendar event with a Meet link is created on success; every failure mode from §10 is handled explicitly.

**Why this phase exists:** This is the complete, working, end-to-end loop the entire hackathon brief is graded on.

**Prerequisites:** Phase 6 complete.

**In scope:** Implement FR-024–FR-029 exactly per the 8-step sequence in `requirements.md` §10 (Redis lock → revalidate → conflict check → create Calendar event *outside* any DB transaction → receive external event ID/link → persist in a Postgres-only transaction → commit → release lock); the compensating-cancellation path on DB-persistence failure; the reconciliation-record path if the compensating cancellation itself fails; the `interview_events` and `reconciliation_tasks` tables; the DB-level uniqueness constraint as the final line of defense (`DB_DESIGN.md` §Concurrency Strategy).

**Explicitly out of scope:** Notifications (Phase 8 — booking succeeds independent of whether the confirmation email sends); decline/reschedule handling (Post-MVP, Phase 9).

**Database changes:** Create `interview_events`, `reconciliation_tasks`; add the partial unique index described in `DB_DESIGN.md`.

**APIs involved:** `POST /interviews/{id}/book`.

**Deliverables:** A demoable booking flow producing a real calendar event with a working Meet link.

**Acceptance criteria — THE MVP GATE, stated in full:**
1. **The full loop works end-to-end:** create request → candidate availability → real recommendations (Phase 6, using the Phase 5 Engine) → book → real Calendar event with a Meet link.
2. An automated test fires two simultaneous booking requests on the same request; exactly one succeeds, the other receives `SLOT_NO_LONGER_AVAILABLE`.
3. An automated test forces a DB failure after a successful Calendar event creation; asserts the compensating cancellation is attempted and logged, and that the user-facing response never claims success.
4. An automated test forces the compensating cancellation itself to fail; asserts a `reconciliation_tasks` row is created with the external event ID, and that the user-facing response still never claims success.

**Testing requirements:** All four tests above are mandatory, not optional.

**STOPPING CONDITION:** **Stop and do not proceed to Phase 8 or any Post-MVP/Bonus work until all four acceptance criteria above pass.** This is the one hard gate in the entire plan, restated: *"We can successfully demonstrate the complete core interview scheduling loop from request creation to real Calendar booking."*

---

## PHASE 8 — Booking Confirmation
**Tier:** MVP (with a documented degradation path — see `requirements.md` §5)
**Duration:** 5%

**Overview:** The last step of the Core Demo Loop — confirming to participants that booking succeeded. Deliberately scoped narrowly: **confirmation only**, not the full notification suite (reminders, decline/cancel notices are Post-MVP, Phase 9).

**Goal:** A successful booking produces a confirmation — real email via SendGrid if the integration is straightforward within remaining time, or a logged/simulated confirmation (clearly labeled as such in the demo) if it is not. **Either outcome satisfies this phase — the MVP gate does not depend on which.**

**Prerequisites:** Phase 7's gate has passed.

**In scope:** Implement FR-030; SendGrid integration attempt; `notification_logs` table; a clear fallback path (log the "would send" event with full content) if SendGrid setup is consuming disproportionate time.

**Explicitly out of scope:** Reminder scheduling (FR-031, Post-MVP); decline/cancellation notices (Post-MVP); SMS/WhatsApp (Bonus tier, mocked only if attempted at all).

**Database changes:** Create `notification_logs`.

**APIs involved:** No new public endpoint — triggered internally by the booking service.

**Deliverables:** A real or clearly-logged-simulated confirmation on booking, demoable either way.

**Acceptance criteria:** Every booking produces exactly one `notification_logs` row, `SENT` or `FAILED`, regardless of which path was used.

**STOPPING CONDITION:** Time-box this phase strictly. If SendGrid isn't working cleanly within a short, fixed budget, switch to the logged/simulated fallback and move on — do not let an email provider block progress toward the rest of the plan.

---

## PHASE 9 — POST-MVP: Decline, Cancellation, Rescheduling, Reminders & Audit
**Tier:** POST-MVP — **must not start before Phase 7's gate has passed.**
**Duration:** 12%

**Overview:** Everything explicitly deferred in `requirements.md` §5's Post-MVP tier, in priority order. Attempt in this order; stop at whichever point time runs out — each item is independently demoable.

**Goal (priority order):**
1. Scheduled reminder emails ahead of the interview (FR-031).
2. Panelist accept/decline workflow (FR-033) + automatic re-recommendation on decline of a booked interview (FR-034).
3. Admin cancellation workflow (FR-035).
4. Candidate self-service booking & reschedule (FR-036) — reusing the Phase 6/7 recommendation and booking endpoints, now also authorized for CANDIDATE.
5. A basic audit-trail viewing endpoint/UI (FR-038) — the underlying `audit_logs` writes (FR-037) may already exist opportunistically from earlier phases; this item is specifically about exposing them.
6. Basic scheduling analytics (time-to-book, decline rate) computed from `interview_events`/`audit_logs`.

**Prerequisites:** Phase 7's MVP gate passed; Phase 8 complete or explicitly time-boxed off.

**Explicitly out of scope for this phase:** Any Bonus-tier item (Phase 12's strict-order bonus list) — do not reach for those until this entire phase's priority list is either done or time-boxed off.

**Database changes:** No new tables — uses existing schema; updates `interview_requests.status` transitions to `RESCHEDULING`/`CANCELLED`.

**APIs involved:** `POST /interviews/{id}/decline`, `POST /interviews/{id}/reschedule`, `POST /interviews/{id}/cancel`, `GET /interviews/{id}/audit`.

**Deliverables:** Whichever priority items were completed, each independently demoable.

**Acceptance criteria:** Each completed item must not regress Phase 7's gate — re-run the Phase 7 acceptance tests after each addition.

**STOPPING CONDITION:** Stop at the time budget for this phase regardless of how far down the priority list you got — a hardened MVP with zero Post-MVP items beats a fragile build with all of them and a broken gate.

---

## PHASE 10 — Frontend Integration
**Tier:** MVP for the Core Loop screens; Post-MVP for the remaining role dashboards
**Duration:** 15%

**Overview:** Build the UI. The MVP-critical subset is narrow: enough screens to demonstrate the Core Demo Loop end to end, including the explainability UI. Everything beyond that (full Panelist dashboard, full Admin request list/detail views, decline/cancel UI from Phase 9) is Post-MVP UI work, sequenced after the MVP screens are solid.

**Goal — MVP subset:** Admin can create a request and see it; Candidate can submit availability via a link; Admin can view ranked recommended slots **with visible score breakdown and explanation** and book one; a confirmation (real or simulated) is shown.

**Goal — Post-MVP subset:** Panelist calendar-connect UI (note: this is technically load-bearing for the MVP loop's data — see note below); full dashboards; decline/cancel/reschedule UI; audit/analytics views.

**Important scoping note:** the Panelist "Connect Google Calendar" screen is functionally required for the MVP loop to have real data to work with, even though the Panelist role has no other MVP-tier UI — build this one screen as part of the MVP subset, not deferred with the rest of the Panelist dashboard.

**Prerequisites:** Phase 8 complete (Phase 9 may run in parallel with the Post-MVP portion of this phase, time permitting).

**In scope (MVP subset):** Admin request-creation form; candidate availability-submission page; recommendation-list screen rendering `score_breakdown` and `explanation` per slot; booking action; confirmation screen; Panelist calendar-connect screen.

**In scope (Post-MVP subset):** Everything else per `CODING_GUIDELINES.md` §Frontend Standards route groups.

**Database changes:** None.

**APIs involved:** All endpoints from Phases 2–9, called from their respective screens.

**Deliverables:** A demoable UI for the full Core Loop at minimum.

**Acceptance criteria:** Every async action in the MVP subset has a loading state and a specific error state; the explainability UI is present and legible.

**STOPPING CONDITION:** The MVP subset must be solid before any Post-MVP screen is touched. Visual polish beyond functional correctness is Phase 12's job, time-permitting.

---

## PHASE 11 — Resilience, Testing & Security
**Tier:** MVP (hardens the gate) with a Post-MVP-aware pass once Phase 9/10's Post-MVP work exists
**Duration:** 8%

**Overview:** A dedicated hardening pass across the whole system.

**Goal:** Every edge case in `requirements.md` §13 has verified, correct behavior; the security checklist in `CODING_GUIDELINES.md` is fully checked.

**Why this phase exists:** Resilience and security are graded as first-class criteria.

**Prerequisites:** Phase 10's MVP subset complete (this phase may re-run after Phase 9/10's Post-MVP work too, but the MVP-facing pass takes priority).

**In scope:** Systematic pass through every row of `requirements.md` §13, with particular attention to the booking-consistency edge cases (Calendar success + DB failure, compensating-delete failure) added in this revision; systematic pass through the security checklist; secret-scan of git history; load-testing the Engine with a larger synthetic participant set.

**Explicitly out of scope:** New features of any kind.

**Deliverables:** A written edge-case checklist, every row checked off and linked to its test.

**Acceptance criteria:** Every row in `requirements.md` §13 has a passing automated or documented-manual test; the security checklist is fully checked.

**STOPPING CONDITION:** Stop once every edge case and every security item is checked. No scope creep into new features even if a gap "reveals" an interesting one.

---

## PHASE 12 — Documentation, Presentation & Bonus (if time remains)
**Tier:** MVP wrap-up, with a strict-order Bonus list appended
**Duration:** 5%

**Overview:** README, diagrams matched to what was actually built, presentation deck, rehearsal — and, only if genuine time remains after all of the above, the Bonus-tier items in strict order.

**Goal:** A team member can clone the repo fresh, run one command, and reproduce the demo; the deck and walkthrough are rehearsed.

**Prerequisites:** Phase 11 complete.

**In scope:** Finalize `README.md` (setup, AI usage disclosure); finalize architecture diagram and sequence diagrams (including the two-OAuth-flow diagram and the booking compensating-action sequence diagram — see `API_DESIGN.md`); build the deck; rehearse the walkthrough and the "why did you choose X" / "why isn't this a distributed transaction" answers.

**In scope, strict order, only if time remains:** (1) AI-personalized notification copy, with input sanitization; (2) intelligent panelist selection by skill; (3) advanced analytics dashboard; (4) any additional communication channel — **mocked/simulated only, never real, per `requirements.md` §5.**

**Explicitly out of scope:** Anything not already named in `requirements.md` §5's Bonus tier.

**Deliverables:** Final README, diagrams, deck, rehearsed walkthrough.

**Acceptance criteria:** Fresh clone + `docker-compose up` + `.env` from `.env.example` reproduces the demo exactly; every team member can explain any file if asked, including why the booking flow is a compensating-action sequence and not a distributed transaction.

**STOPPING CONDITION:** No new features after this phase starts, including the strict-order Bonus list, once the submission deadline is within reach. A finished, rehearsed MVP always outranks an unfinished Bonus feature.
