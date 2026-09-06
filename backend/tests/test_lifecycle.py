"""Phase 9 — decline / reschedule / cancel lifecycle transitions."""

import uuid

from app.calendar.client import CalendarTransportError
from tests.test_booking import _book, _recommended

V1 = "/api/v1"


def _booked(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 201
    return ctx


def _status(client, ctx):
    return client.get(f"{V1}/interviews/{ctx.rid}", headers=ctx.admin.headers).json()["status"]


def _notif_rows(db_val, ctx, ntype: str | None = None):
    sql = (
        "SELECT count(*) FROM notification_logs nl JOIN interview_events e "
        "ON e.id = nl.interview_event_id WHERE e.interview_request_id = :r"
    )
    params = {"r": ctx.rid}
    if ntype is not None:
        sql += " AND nl.notification_type = :t"
        params["t"] = ntype
    return db_val(sql, params)


# ------------------------------------------------------------------- decline ----


def test_decline_pre_booking(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/decline",
        json={"reason": "conflict"},
        headers=ctx.panelists[0].headers,
    )
    assert resp.status_code == 200
    assert resp.json()["interview_request_status"] == "READY_FOR_SCHEDULING"
    assert db_val(
        "SELECT response_status FROM interview_participants WHERE interview_request_id=:r "
        "AND user_id=:u",
        {"r": ctx.rid, "u": str(ctx.panelists[0].id)},
    ) == "DECLINED"
    assert db_val(
        "SELECT count(*) FROM audit_logs WHERE action='INTERVIEW_DECLINED' AND entity_id=:r",
        {"r": ctx.rid},
    ) == 1
    assert db_val("SELECT count(*) FROM notification_logs") == 0


def test_decline_of_booked_cancels_event_and_re_recommends(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    fake_calendar.deleted_event_ids.clear()

    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/decline", json={}, headers=ctx.panelists[0].headers
    )
    assert resp.status_code == 200
    assert resp.json()["interview_request_status"] == "RESCHEDULING"

    assert db_val(
        "SELECT status FROM interview_events WHERE interview_request_id=:r", {"r": ctx.rid}
    ) == "CANCELLED"
    assert fake_calendar.deleted_event_ids  # Google event delete attempted
    assert _notif_rows(db_val, ctx, "DECLINE") == 1
    assert db_val(
        "SELECT nl.status FROM notification_logs nl JOIN interview_events e "
        "ON e.id=nl.interview_event_id WHERE e.interview_request_id=:r AND "
        "nl.notification_type='DECLINE'",
        {"r": ctx.rid},
    ) in ("SIMULATED", "SENT")
    # re-recommendation ran (fake free/busy is empty) -> RECOMMENDED again
    assert _status(client, ctx) == "RECOMMENDED"


def test_decline_by_non_participant_panelist_forbidden(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    outsider = make_user("PANELIST")
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/decline", json={}, headers=outsider.headers
    )
    assert resp.status_code == 403


def test_decline_requires_panelist_role(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    for actor in (ctx.admin, ctx.candidate):
        resp = client.post(
            f"{V1}/interviews/{ctx.rid}/decline", json={}, headers=actor.headers
        )
        assert resp.status_code == 403


def test_decline_unknown_request_404(client, make_user):
    panelist = make_user("PANELIST")
    resp = client.post(
        f"{V1}/interviews/{uuid.uuid4()}/decline", json={}, headers=panelist.headers
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------- reschedule ----


def test_reschedule_by_owning_candidate(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/reschedule",
        json={"reason": "clash"},
        headers=ctx.candidate.headers,
    )
    assert resp.status_code == 200
    assert resp.json()["interview_request_status"] == "RESCHEDULING"
    assert db_val(
        "SELECT status FROM interview_events WHERE interview_request_id=:r", {"r": ctx.rid}
    ) == "CANCELLED"
    assert _notif_rows(db_val, ctx, "RESCHEDULE") == 1
    assert _status(client, ctx) == "RECOMMENDED"


def test_reschedule_by_admin(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/reschedule", json={}, headers=ctx.admin.headers
    )
    assert resp.status_code == 200


def test_reschedule_when_not_booked_409(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/reschedule", json={}, headers=ctx.admin.headers
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_BOOKED"


def test_reschedule_by_other_candidate_forbidden(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    intruder = make_user("CANDIDATE")
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/reschedule", json={}, headers=intruder.headers
    )
    assert resp.status_code == 403


def test_reschedule_by_panelist_forbidden(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/reschedule", json={}, headers=ctx.panelists[0].headers
    )
    assert resp.status_code == 403


# -------------------------------------------------------------------- cancel ----


def test_cancel_booked_request(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    fake_calendar.deleted_event_ids.clear()
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/cancel", json={"reason": "role filled"},
        headers=ctx.admin.headers,
    )
    assert resp.status_code == 200
    assert resp.json()["interview_request_status"] == "CANCELLED"
    assert _status(client, ctx) == "CANCELLED"
    assert db_val(
        "SELECT status FROM interview_events WHERE interview_request_id=:r", {"r": ctx.rid}
    ) == "CANCELLED"
    assert fake_calendar.deleted_event_ids
    assert _notif_rows(db_val, ctx, "CANCELLATION") == 1


def test_cancel_pre_booking_request(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    resp = client.post(f"{V1}/interviews/{ctx.rid}/cancel", json={}, headers=ctx.admin.headers)
    assert resp.status_code == 200
    assert _status(client, ctx) == "CANCELLED"
    assert db_val("SELECT count(*) FROM notification_logs") == 0
    assert fake_calendar.created_events == []


def test_cancel_already_terminal_409(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert client.post(
        f"{V1}/interviews/{ctx.rid}/cancel", json={}, headers=ctx.admin.headers
    ).status_code == 200
    resp = client.post(
        f"{V1}/interviews/{ctx.rid}/cancel", json={}, headers=ctx.admin.headers
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "REQUEST_ALREADY_TERMINAL"


def test_cancel_requires_admin(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    for actor in (ctx.candidate, ctx.panelists[0]):
        assert client.post(
            f"{V1}/interviews/{ctx.rid}/cancel", json={}, headers=actor.headers
        ).status_code == 403


def test_cancel_with_google_delete_failure_still_cancels_and_records(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _booked(client, make_user, make_calendar_connection, fake_calendar)
    fake_calendar.delete_event_result = CalendarTransportError("google down")

    resp = client.post(f"{V1}/interviews/{ctx.rid}/cancel", json={}, headers=ctx.admin.headers)
    assert resp.status_code == 200
    assert _status(client, ctx) == "CANCELLED"
    assert db_val(
        "SELECT status FROM interview_events WHERE interview_request_id=:r", {"r": ctx.rid}
    ) == "CANCELLED"
    assert db_val(
        "SELECT reason FROM reconciliation_tasks WHERE interview_event_id = "
        "(SELECT id FROM interview_events WHERE interview_request_id=:r)",
        {"r": ctx.rid},
    ) == "CANCEL_DELETE_FAILED"
