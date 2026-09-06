"""Phase 8 — booking-confirmation email (FR-030).

Every successful booking writes exactly one CONFIRMATION notification_logs row
(SENT / FAILED / SIMULATED); a notification failure never affects booking success.
"""

import asyncio
import json

import httpx
import pytest

from app.notifications.client import EmailMessage, SendGridClient
from tests.test_booking import _book, _recommended

V1 = "/api/v1"


def _rows(db_val, rid: str):
    return db_val(
        "SELECT count(*) FROM notification_logs nl JOIN interview_events e "
        "ON e.id = nl.interview_event_id WHERE e.interview_request_id = :r",
        {"r": rid},
    )


def _one(db_val, rid: str, col: str):
    return db_val(
        f"SELECT nl.{col} FROM notification_logs nl JOIN interview_events e "
        "ON e.id = nl.interview_event_id WHERE e.interview_request_id = :r",
        {"r": rid},
    )


# ---------------------------------------------------------- the three paths -----


def test_confirmation_simulated_when_no_api_key(
    client, make_user, make_calendar_connection, fake_calendar, fake_sendgrid, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 201

    assert _rows(db_val, ctx.rid) == 1
    assert _one(db_val, ctx.rid, "channel") == "EMAIL"
    assert _one(db_val, ctx.rid, "notification_type") == "CONFIRMATION"
    assert _one(db_val, ctx.rid, "recipient") == ctx.candidate.email
    assert _one(db_val, ctx.rid, "status") == "SIMULATED"
    assert fake_sendgrid.sent == []  # SIMULATED path never calls send()


def test_confirmation_sent_when_configured(
    client, make_user, make_calendar_connection, fake_calendar, fake_sendgrid, db_val
):
    fake_sendgrid.configured = True
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 201

    assert _rows(db_val, ctx.rid) == 1
    assert _one(db_val, ctx.rid, "status") == "SENT"
    assert len(fake_sendgrid.sent) == 1
    msg = fake_sendgrid.sent[0]
    assert msg.to == ctx.candidate.email
    assert set(msg.cc) == {p.email for p in ctx.panelists}
    assert "TECHNICAL".title() in msg.subject


def test_confirmation_failed_does_not_break_booking(
    client, make_user, make_calendar_connection, fake_calendar, fake_sendgrid, db_val
):
    fake_sendgrid.configured = True
    fake_sendgrid.fail = True
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)

    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 201  # booking still succeeds

    assert _rows(db_val, ctx.rid) == 1
    assert _one(db_val, ctx.rid, "status") == "FAILED"
    # booking is intact
    assert db_val(
        "SELECT status FROM interview_requests WHERE id = :r", {"r": ctx.rid}
    ) == "BOOKED"
    assert db_val(
        "SELECT count(*) FROM interview_events WHERE interview_request_id = :r", {"r": ctx.rid}
    ) == 1


# ---------------------------------------------------- invariants / edge cases ---


def test_exactly_one_row_per_successful_booking(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    _book(client, ctx, ctx.slots[0]["id"])
    assert _rows(db_val, ctx.rid) == 1
    # a rejected second booking adds nothing
    _book(client, ctx, ctx.slots[0]["id"])
    assert _rows(db_val, ctx.rid) == 1


def test_failed_booking_writes_no_notification(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    from app.calendar.client import CalendarTransportError

    fake_calendar.create_event_result = CalendarTransportError("google down")
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 502
    assert db_val("SELECT count(*) FROM notification_logs") == 0


def test_dispatch_exception_still_leaves_booking_and_logs(
    client, make_user, make_calendar_connection, fake_calendar, monkeypatch, app_logs, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)

    async def _boom(*_a, **_k):
        raise RuntimeError("dispatch exploded")

    monkeypatch.setattr(
        "app.booking.service.notifications_service.send_booking_confirmation", _boom
    )
    resp = _book(client, ctx, ctx.slots[0]["id"])
    assert resp.status_code == 201  # booking unaffected by a dispatch bug
    assert any("confirmation_dispatch_failed" in r.getMessage() for r in app_logs)


# ------------------------------------------------------------ sendgrid client ---


def test_sendgrid_client_builds_payload():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(202)

    c = SendGridClient(
        api_key="sg-key", from_address="from@x.test",
        transport=httpx.MockTransport(handler),
    )
    asyncio.run(
        c.send(EmailMessage(to="cand@x.test", cc=["p1@x.test"], subject="Hi", text_body="Body"))
    )
    body = seen["body"]
    assert body["from"]["email"] == "from@x.test"
    assert body["personalizations"][0]["to"] == [{"email": "cand@x.test"}]
    assert body["personalizations"][0]["cc"] == [{"email": "p1@x.test"}]
    assert body["subject"] == "Hi"
    assert body["content"][0]["value"] == "Body"
    assert seen["auth"] == "Bearer sg-key"


def test_sendgrid_client_raises_on_error_status():
    c = SendGridClient(
        api_key="k", from_address="f@x.test",
        transport=httpx.MockTransport(lambda req: httpx.Response(400, json={"errors": []})),
    )
    with pytest.raises(RuntimeError):
        asyncio.run(c.send(EmailMessage(to="a@x.test", cc=[], subject="s", text_body="b")))
