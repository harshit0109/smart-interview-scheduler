"""Phase 6 — POST /interviews/{id}/recommendations: real data -> pure engine -> DB.

Google free/busy is the injected fake; the Phase 5 engine runs unmodified.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.calendar.client import BusyInterval, CalendarTransportError

V1 = "/api/v1"
FACTORS = {
    "timezone_fairness",
    "working_hours_comfort",
    "scheduling_proximity",
    "workload_balance",
    "buffer_quality",
}


def _ready_request(client, make_user, make_calendar_connection, *, connect=True, n_panelists=2):
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
    resp = client.post(
        f"{V1}/interviews/{rid}/candidate-availability",
        json={
            "timezone": "UTC",
            "windows": [{"start_time": start.isoformat(), "end_time": end.isoformat()}],
        },
        headers=candidate.headers,
    )
    assert resp.status_code == 201

    if connect:
        for p in panelists:
            make_calendar_connection(p.id)

    return SimpleNamespace(
        admin=admin, candidate=candidate, panelists=panelists, rid=rid, window_start=start
    )


def _status(client, admin, rid):
    return client.get(f"{V1}/interviews/{rid}", headers=admin.headers).json()["status"]


# ------------------------------------------------------------------ happy path --


def test_happy_path_persists_and_transitions(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _ready_request(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = []  # everyone fully free within working hours

    resp = client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["recommendation_run_id"]
    assert body["slots"]
    assert [s["rank"] for s in body["slots"]] == list(range(1, len(body["slots"]) + 1))
    for s in body["slots"]:
        assert set(s["score_breakdown"]) == FACTORS
        assert 0.0 <= s["total_score"] <= 1.0
        assert "fake-access" not in s["explanation"]

    assert _status(client, ctx.admin, ctx.rid) == "RECOMMENDED"

    assert db_val(
        "SELECT algorithm_version FROM recommendation_runs WHERE interview_request_id = :r",
        {"r": ctx.rid},
    ) == "1.0.0"
    assert db_val(
        "SELECT count(*) FROM recommended_slots rs JOIN recommendation_runs rr "
        "ON rr.id = rs.recommendation_run_id WHERE rr.interview_request_id = :r",
        {"r": ctx.rid},
    ) == len(body["slots"])
    assert db_val(
        "SELECT bool_or(is_selected) FROM recommended_slots rs JOIN recommendation_runs rr "
        "ON rr.id = rs.recommendation_run_id WHERE rr.interview_request_id = :r",
        {"r": ctx.rid},
    ) is False
    assert db_val(
        "SELECT count(*) FROM audit_logs WHERE action = 'RECOMMENDATION_GENERATED' "
        "AND entity_id = :r",
        {"r": ctx.rid},
    ) == 1


def test_input_snapshot_carries_no_tokens(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _ready_request(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = []
    client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)

    snapshot = db_val(
        "SELECT input_snapshot::text FROM recommendation_runs WHERE interview_request_id = :r",
        {"r": ctx.rid},
    )
    for needle in ("fake-access", "fake-refresh", "access_token", "refresh_token", "Bearer"):
        assert needle not in snapshot


# ---------------------------------------------------------------------- rbac ----


def test_recommendations_requires_admin(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _ready_request(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = []
    for actor in (ctx.candidate, ctx.panelists[0]):
        resp = client.post(
            f"{V1}/interviews/{ctx.rid}/recommendations", headers=actor.headers
        )
        assert resp.status_code == 403


# ----------------------------------------------------------------- pre-checks ---


def test_not_ready_for_scheduling_409(client, make_user, make_calendar_connection, fake_calendar):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = client.post(
        f"{V1}/interviews",
        json={
            "candidate_id": str(candidate.id),
            "round_type": "TECHNICAL",
            "duration_minutes": 60,
            "panelist_ids": [str(panelist.id)],
        },
        headers=admin.headers,
    ).json()["id"]
    make_calendar_connection(panelist.id)

    resp = client.post(f"{V1}/interviews/{rid}/recommendations", headers=admin.headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NOT_READY_FOR_SCHEDULING"


def test_panelist_without_connection_424_and_request_unchanged(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready_request(client, make_user, make_calendar_connection, connect=False)
    resp = client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    assert resp.status_code == 424
    err = resp.json()["error"]
    assert err["code"] == "PANELIST_CALENDAR_NOT_CONNECTED"
    assert ctx.panelists[0].email in err["message"] or ctx.panelists[1].email in err["message"]
    assert _status(client, ctx.admin, ctx.rid) == "READY_FOR_SCHEDULING"


def test_panelist_revoked_424_names_panelist(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready_request(client, make_user, make_calendar_connection, connect=False)
    make_calendar_connection(ctx.panelists[0].id)
    make_calendar_connection(ctx.panelists[1].id, status="REVOKED")

    resp = client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    assert resp.status_code == 424
    err = resp.json()["error"]
    assert err["code"] == "CALENDAR_CONNECTION_REVOKED"
    assert ctx.panelists[1].email in err["message"]
    assert _status(client, ctx.admin, ctx.rid) == "READY_FOR_SCHEDULING"


def test_panelist_expired_without_refresh_token_424(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready_request(client, make_user, make_calendar_connection, connect=False)
    make_calendar_connection(ctx.panelists[0].id)
    make_calendar_connection(
        ctx.panelists[1].id, status="EXPIRED", with_refresh=False
    )

    resp = client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    assert resp.status_code == 424
    err = resp.json()["error"]
    assert err["code"] == "CALENDAR_CONNECTION_EXPIRED"  # distinct from REVOKED / NOT_CONNECTED
    assert ctx.panelists[1].email in err["message"]
    assert _status(client, ctx.admin, ctx.rid) == "READY_FOR_SCHEDULING"


# ------------------------------------------------------------- engine outcomes --


def test_no_common_availability_422_and_failed(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready_request(client, make_user, make_calendar_connection)
    # every panelist is busy for the entire queried range -> empty intersection
    fake_calendar.free_busy_result = lambda tmin, tmax: [BusyInterval(tmin, tmax)]

    resp = client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "NO_COMMON_AVAILABILITY"
    assert _status(client, ctx.admin, ctx.rid) == "FAILED"


def test_calendar_timeout_502_and_request_unchanged(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready_request(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = CalendarTransportError("timed out after retries")

    resp = client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "CALENDAR_SYNC_FAILED"
    assert _status(client, ctx.admin, ctx.rid) == "READY_FOR_SCHEDULING"


# --------------------------------------------------- detail-endpoint visibility -


def test_detail_recommendations_visibility(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready_request(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = []
    client.post(f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.admin.headers)

    as_admin = client.get(f"{V1}/interviews/{ctx.rid}", headers=ctx.admin.headers).json()
    assert as_admin["recommended_slots"] and len(as_admin["recommended_slots"]) >= 1

    as_candidate = client.get(f"{V1}/interviews/{ctx.rid}", headers=ctx.candidate.headers).json()
    assert as_candidate["recommended_slots"]

    as_panelist = client.get(
        f"{V1}/interviews/{ctx.rid}", headers=ctx.panelists[0].headers
    ).json()
    assert as_panelist["recommended_slots"] is None
