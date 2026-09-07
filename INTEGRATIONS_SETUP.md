# Real integrations setup — Google Calendar / Meet + email

The app runs end to end with **no credentials**. Booking then records a
`SIMULATED` calendar event (local id, **no** meeting link — never a fake Meet
URL) and every notification is logged with status `SIMULATED` (never "sent").
This document is how you switch the two seams to real services.

Nothing here is required to run or demo the product.

---

## 1. Google Calendar + Google Meet

### 1.1 Google Cloud project

1. Create (or pick) a project at <https://console.cloud.google.com/>.
2. **APIs & Services → Enable APIs** — enable **Google Calendar API**. That
   single API covers free/busy reads, event creation, and Meet conference
   creation (`conferenceData` with `hangoutsMeet`). No separate "Meet API".
3. **OAuth consent screen** — External (or Internal for a Workspace org). Add
   the two scopes the client requests:
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `https://www.googleapis.com/auth/calendar.events`
   While the consent screen is in "Testing", add each panelist/admin Google
   account under **Test users**.

### 1.2 OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Web application**
- Authorized redirect URI: must exactly equal `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI`
  (default `http://localhost:8000/api/v1/calendar/callback`). For a deployed
  backend use `https://<your-backend-host>/api/v1/calendar/callback`.

Copy the client ID and client secret.

### 1.3 Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` | yes | from 1.2 |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` | yes | from 1.2 |
| `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` | if not localhost | must match the client config byte-for-byte |
| `CALENDAR_TOKEN_ENCRYPTION_KEY` | yes for real use | urlsafe-base64 32-byte Fernet key; `"dev"` sentinel is dev-only. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `FRONTEND_BASE_URL` | if not localhost | where `/calendar/connected` and `/calendar/error` redirects land |
| `CALENDAR_DEV_MODE` | no | ignored once real credentials are set |

Setting `CLIENT_ID` + `CLIENT_SECRET` flips `settings.google_calendar_configured`
to true, which makes `settings.calendar_simulated` false. The real Google path in
`app/booking/service.py` and `app/scheduling/service.py` takes over automatically —
no code change, no other flag.

### 1.4 Connect and verify

1. Restart the backend with the vars set.
2. `GET /api/v1/calendar/status` now returns `"mode": "GOOGLE"`.
3. In the app: **Calendar** (admin) or **/panelist/calendar** → **Connect Google
   Calendar** → Google consent → redirected back to `/calendar/connected`.
   At least the organiser panelist (lowest user-id among assigned panelists)
   must be connected; booking raises a specific 424 naming the panelist if not.
4. Book an interview. Expect:
   - exactly **one** Google Calendar event on the organiser's primary calendar
     (guarded by a Redis lock + a partial unique index on `status='CONFIRMED'`;
     re-booking a booked request is rejected, so no duplicate event);
   - candidate + every panelist on the event as **attendees** (`sendUpdates=all`,
     so Google emails them the invite directly);
   - a **Google Meet link** created via `conferenceData.createRequest`
     (`conferenceDataVersion=1`), stored on `interview_events.meeting_link`;
   - the **same** link shown to every participant in-app and in the confirmation
     email — it is one stored value on one event;
   - `interview_events.provider = 'GOOGLE'`, `calendar_event_id` = the Google id.
5. A Google failure (auth revoked, transport, 5xx after retries) surfaces as an
   honest error on booking — it is never swallowed and never faked. A step-6
   DB failure triggers a compensating delete of the just-created event.

---

## 2. Email (SendGrid)

### 2.1 Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `SENDGRID_API_KEY` | yes | SendGrid → Settings → API Keys, "Mail Send" permission |
| `EMAIL_FROM_ADDRESS` | yes | a **verified** SendGrid sender or domain; otherwise SendGrid rejects the send and the row is logged `FAILED` |

A non-empty `SENDGRID_API_KEY` flips `SendGridClient.configured` to true. With it
unset, every message is logged (`SIMULATED`) and a `notification_logs` /
`participant_invitations` row records status `SIMULATED` — the UI shows
"Simulated (no email service)", never "sent".

### 2.2 What gets sent

| Trigger | Type | Body contents |
| --- | --- | --- |
| Send invitations (admin) | invitation | interview label, duration, one-time invite link |
| Booking confirmed | `CONFIRMATION` | company, role, round, date/time (UTC), Meet link |
| `POST /interviews/{id}/send-reminder` or `scripts/send_reminders.py` | `REMINDER` | company, role, round, date/time (UTC), Meet link (or explicit "SIMULATED booking, no link") |
| Interviewer declines | `DECLINE` | brief notice + reason |
| Reschedule requested | `RESCHEDULE` | brief notice + reason |
| Interview cancelled | `CANCELLATION` | brief notice + reason |

Delivery outcome per message: `SENT` / `FAILED` / `SIMULATED`, visible to the
admin at `GET /api/v1/interviews/{id}/notifications` and on the interview page's
**Email notifications** card.

Known limitation: date/time in every email body is rendered in **UTC**, labelled
as such — not localised per recipient timezone. One shared email carries all
recipients (candidate in `to`, panelists in `cc`).

### 2.3 Verify

1. Set both vars, restart backend.
2. Book an interview → check the **Email notifications** card shows
   `CONFIRMATION … SENT`, and the mail arrives at the candidate address.
3. `POST /api/v1/interviews/{id}/send-reminder` → `REMINDER … SENT`.

---

## 3. Secrets hygiene

- None of these values are committed. `docker-compose.yml` reads them from the
  host environment (`${VAR:-default}`); put real values in a git-ignored `.env`.
- Access tokens and API keys are never written to logs or `audit_logs` (calendar
  audit records store granted **scopes** only; invitation issuance never logs the
  token or the email body).
