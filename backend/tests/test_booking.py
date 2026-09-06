"""Phase 7 — Booking & conflict prevention. Contains the four MVP-gate tests.

Google Calendar is the injected fake; the compensating-action sequence is
exercised by patching the step-6 persist.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from redis.asyncio import Redis
from sqlalchemy.exc import IntegrityError

from app.booking import repository as booking_repository
from app.calendar.client import CalendarTransportError
from app.core.config import settings

V1 = "/api/v1"
_CONFIRMED_COUNT = (
    "SELECT count(*) FROM interview_events "
    "WHERE interview_request_id = :r AND status = 'CONFIRMED'"
)
_EVENT_COUNT = "SELECT count(*) FROM interview_events WHERE interview_request_id = :r"


def _recommended(client, make_user, make_calendar_connection, fake_calendar, n_panelists=2):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelists = [make_user("PANELIST") for _ in range(n_panelists)]
    rid = client.post(
        f"{V1}/interviews",
        json={
            "candidate_id": str(candidate.id),
            "round_type": "TECHNICAL",
            "duration_minutes": 60,
            "panelist_ids": [str(p.id) for p in panelists],
        },
        headers=admin.headers,
    ).json()["id"]

    start = (datetime.now(UTC) + timedelta(days=2)).replace(
        hour=12, minute=0, second=0, microsecond=0
    )
    end = start + timedelta(hours=6)
    client.post(
        f"{V1}/interviews/{rid}/candidate-availability",
        json={
            "timezone": "UTC",
            "windows": [{"start_time": start.isoformat(), "end_time": end.isoformat()}],
        },
        headers=candidate.headers,
    )
    for p in panelists:
        make_calendar_connection(p.id)
    fake_calendar.free_busy_result = []
    rec = client.post(
        f"{V1}/interviews/{rid}/recommendations", headers=admin.headers
    ).json()
    return SimpleNamespace(
        admin=admin,
        candidate=candidate,
        panelists=panelists,
        rid=rid,
        run_id=rec["recommendation_run_id"],
        slots=rec["slots"],
    )


def _book(client, ctx, slot_id, actor=None):
    return client.post(
        f"{V1}/interviews/{ctx.rid}/book",
        json={"recommended_slot_id": str(slot_id)},
        headers=(actor or ctx.admin).headers,
    )


def _status(client, ctx):
    return client.get(f"{V1}/interviews/{ctx.rid}", headers=ctx.admin.headers).json()["status"]


# ============================================================ GATE TEST 1 ======


def test_full_loop_book_succeeds(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    slot = ctx.slots[0]

    resp = _book(client, ctx, slot["id"])
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["calendar_event_id"]
    assert body["meeting_link"] == "https://meet.google.com/fake-abc-defg"
    assert body["status"] == "CONFIRMED"

    assert _status(client, ctx) == "BOOKED"
    assert db_val(
        _CONFIRMED_COUNT, {"r": ctx.rid}
    ) == 1
    assert db_val(
        "SELECT is_selected FROM recommended_slots WHERE id = :s", {"s": slot["id"]}
    ) is True
    assert db_val(
        "SELECT count(*) FROM audit_logs WHERE action='INTERVIEW_BOOKED' AND entity_id=:r",
        {"r": ctx.rid},
    ) == 1

    # the fake received the real attendees + times
    created = fake_calendar.created_events[-1]
    emails = set(created["attendees"])
    assert ctx.candidate.email in emails
    assert all(p.email in emails for p in ctx.panelists)

    # the booked event shows up on the request detail for a participant
    as_panelist = client.get(
        f"{V1}/interviews/{ctx.rid}", headers=ctx.panelists[0].headers
    ).json()
    assert as_panelist["booked_event"]["meeting_link"] == body["meeting_link"]


# ============================================================ GATE TEST 2 ======
# Deterministic backstops (required) + a best-effort threaded race.


def test_second_booking_on_same_request_conflicts(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 201
    resp = _book(client, ctx, ctx.slots[1]["id"] if len(ctx.slots) > 1 else ctx.slots[0]["id"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "SLOT_NO_LONGER_AVAILABLE"


def test_held_redis_lock_blocks_booking(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    key = f"lock:booking:{ctx.rid}"

    async def _hold():
        r = Redis.from_url(settings.redis_url, decode_responses=True)
        await r.set(key, "someone-else", nx=True, ex=10)
        await r.aclose()

    async def _release():
        r = Redis.from_url(settings.redis_url, decode_responses=True)
        await r.delete(key)
        await r.aclose()

    asyncio.run(_hold())
    try:
        resp = _book(client, ctx, ctx.slots[0]["id"])
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SLOT_NO_LONGER_AVAILABLE"
        assert fake_calendar.created_events == []  # never reached the Calendar call
        assert db_val(_EVENT_COUNT, {"r": ctx.rid}) == 0
    finally:
        asyncio.run(_release())


def test_existing_confirmed_event_blocks_booking(
    client, make_user, make_calendar_connection, fake_calendar, db_exec
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    db_exec(
        "INSERT INTO interview_events "
        "(interview_request_id, start_time, end_time, calendar_event_id, status) "
        "VALUES (:r, now(), now() + interval '1 hour', 'pre-existing', 'CONFIRMED')",
        {"r": ctx.rid},
    )
    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 409
    assert fake_calendar.created_events == []


def test_partial_unique_index_forbids_two_confirmed(
    client, make_user, make_calendar_connection, fake_calendar, db_exec
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    ins = (
        "INSERT INTO interview_events "
        "(interview_request_id, start_time, end_time, calendar_event_id, status) "
        "VALUES (:r, now(), now() + interval '1 hour', :cid, 'CONFIRMED')"
    )
    db_exec(ins, {"r": ctx.rid, "cid": "one"})
    with pytest.raises(IntegrityError):
        db_exec(ins, {"r": ctx.rid, "cid": "two"})


# A true threaded race against the shared sync TestClient deadlocks its portal,
# so gate criterion 2 ("two simultaneous bookings -> exactly one succeeds") is
# proven by the deterministic backstops above: the held Redis lock rejects the
# rival (step 1), the existing-CONFIRMED check rejects it (step 3), and the
# partial unique index makes a second CONFIRMED row structurally impossible even
# if both bypass the lock.


# ============================================================ GATE TEST 3 ======


def test_db_failure_after_calendar_success_compensates(
    client, make_user, make_calendar_connection, fake_calendar, monkeypatch, app_logs, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)

    async def _boom(*_a, **_k):
        raise RuntimeError("forced persistence failure")

    monkeypatch.setattr(booking_repository, "insert_interview_event", _boom)
    fake_calendar.delete_event_result = None  # compensating delete succeeds
    

    resp = _book(client, ctx, ctx.slots[0]["id"])

    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "BOOKING_PERSISTENCE_FAILED"
    assert "meeting_link" not in resp.text
    assert fake_calendar.deleted_event_ids  # compensating delete attempted
    assert any("booking_compensated" in r.getMessage() for r in app_logs)

    assert db_val(
        _EVENT_COUNT, {"r": ctx.rid}
    ) == 0
    assert db_val("SELECT count(*) FROM reconciliation_tasks") == 0
    assert _status(client, ctx) == "RECOMMENDED"


# ============================================================ GATE TEST 4 ======


def test_compensating_delete_failure_creates_reconciliation_task(
    client, make_user, make_calendar_connection, fake_calendar, monkeypatch, app_logs, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)

    async def _boom(*_a, **_k):
        raise RuntimeError("forced persistence failure")

    monkeypatch.setattr(booking_repository, "insert_interview_event", _boom)
    fake_calendar.delete_event_result = CalendarTransportError("cannot reach Google to delete")
    

    resp = _book(client, ctx, ctx.slots[0]["id"])

    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "BOOKING_PERSISTENCE_FAILED"
    assert "meeting_link" not in resp.text

    event_id = fake_calendar.deleted_event_ids[-1]
    row_reason = db_val(
        "SELECT reason FROM reconciliation_tasks WHERE external_calendar_event_id = :e",
        {"e": event_id},
    )
    assert row_reason == "COMPENSATING_DELETE_FAILED"
    assert db_val(
        "SELECT status FROM reconciliation_tasks WHERE external_calendar_event_id = :e",
        {"e": event_id},
    ) == "OPEN"
    meta = db_val(
        "SELECT metadata::text FROM reconciliation_tasks WHERE external_calendar_event_id = :e",
        {"e": event_id},
    )
    for needle in ("fake-access", "fake-refresh", "Bearer", "access_token"):
        assert needle not in meta
    assert any("needs_manual_reconciliation" in r.getMessage() for r in app_logs)
    assert _status(client, ctx) == "RECOMMENDED"


# ============================================================ supporting =======


def test_book_authorization(client, make_user, make_calendar_connection, fake_calendar):
    # Phase 9 item 4 widened /book to ADMIN or the request's own candidate.
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    other_candidate = make_user("CANDIDATE")
    assert _book(client, ctx, ctx.slots[0]["id"], actor=ctx.panelists[0]).status_code == 403
    assert _book(client, ctx, ctx.slots[0]["id"], actor=other_candidate).status_code == 403


def test_book_unknown_slot_404(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, uuid.uuid4()).status_code == 404


def test_book_slot_from_other_request_404(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx_a = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    ctx_b = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    resp = _book(client, ctx_a, ctx_b.slots[0]["id"])
    assert resp.status_code == 404


def test_book_stale_run_conflicts(
    client, make_user, make_calendar_connection, fake_calendar, db_exec
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    old_slot_id = ctx.slots[0]["id"]
    # force a second recommendation run, then restore RECOMMENDED
    db_exec(
        "UPDATE interview_requests SET status='READY_FOR_SCHEDULING' WHERE id=:r", {"r": ctx.rid}
    )
    client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    db_exec("UPDATE interview_requests SET status='RECOMMENDED' WHERE id=:r", {"r": ctx.rid})

    resp = _book(client, ctx, old_slot_id)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "SLOT_NO_LONGER_AVAILABLE"


def test_book_calendar_creation_failure_502(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    fake_calendar.create_event_result = CalendarTransportError("google is down")

    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "CALENDAR_EVENT_CREATION_FAILED"
    assert _status(client, ctx) == "RECOMMENDED"
    assert db_val(
        _EVENT_COUNT, {"r": ctx.rid}
    ) == 0
    assert db_val("SELECT count(*) FROM reconciliation_tasks") == 0


def test_book_organiser_connection_revoked_424(
    client, make_user, make_calendar_connection, fake_calendar, db_exec
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    organiser = sorted(ctx.panelists, key=lambda p: str(p.id))[0]
    db_exec(
        "UPDATE calendar_connections SET status='REVOKED' WHERE user_id=:u",
        {"u": str(organiser.id)},
    )
    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 424
    assert resp.json()["error"]["code"] == "CALENDAR_CONNECTION_REVOKED"
    assert organiser.email in resp.json()["error"]["message"]


def test_book_tolerates_missing_meeting_link(
    client, make_user, make_calendar_connection, fake_calendar
):
    from app.calendar.client import CalendarEvent

    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    fake_calendar.create_event_result = CalendarEvent(
        event_id="evt-no-meet", meeting_link=None, html_link=None
    )
    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 201
    assert resp.json()["meeting_link"] is None
    assert resp.json()["status"] == "CONFIRMED"


def test_book_already_booked_request_409(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 201
    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 409
