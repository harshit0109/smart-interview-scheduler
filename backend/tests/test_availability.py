"""Phase 4 — candidate availability submission + validation (FR-015, FR-016)."""

import uuid
from datetime import UTC, datetime, timedelta

V1 = "/api/v1"


def _future(days: float, hours: float = 0.0) -> datetime:
    return datetime.now(UTC) + timedelta(days=days, hours=hours)


def _win(start: datetime, dur_hours: float = 1.0) -> dict:
    return {
        "start_time": start.isoformat(),
        "end_time": (start + timedelta(hours=dur_hours)).isoformat(),
    }


def _make_request(client, make_user):
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
    return admin, candidate, panelist, rid


def _submit(client, headers, rid, windows, tz="America/New_York"):
    return client.post(
        f"{V1}/interviews/{rid}/candidate-availability",
        json={"timezone": tz, "windows": windows},
        headers=headers,
    )


def _get_avail(client, headers, rid):
    return client.get(f"{V1}/interviews/{rid}/availability", headers=headers)


# --------------------------------------------------------------- submit ---------


def test_submit_single_window_transitions_status(client, make_user):
    admin, candidate, _p, rid = _make_request(client, make_user)

    resp = _submit(client, candidate.headers, rid, [_win(_future(2))])
    assert resp.status_code == 201
    body = resp.json()
    assert body["timezone"] == "America/New_York"
    assert len(body["windows"]) == 1

    detail = client.get(f"{V1}/interviews/{rid}", headers=admin.headers).json()
    assert detail["status"] == "READY_FOR_SCHEDULING"


def test_submit_multiple_windows(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    windows = [_win(_future(1)), _win(_future(3)), _win(_future(5))]
    resp = _submit(client, candidate.headers, rid, windows)
    assert resp.status_code == 201
    assert len(resp.json()["windows"]) == 3


def test_non_candidate_roles_forbidden(client, make_user):
    admin, _c, panelist, rid = _make_request(client, make_user)
    for actor in (admin, panelist):
        resp = _submit(client, actor.headers, rid, [_win(_future(2))])
        assert resp.status_code == 403


def test_other_candidate_forbidden(client, make_user):
    _a, _c, _p, rid = _make_request(client, make_user)
    intruder = make_user("CANDIDATE")
    resp = _submit(client, intruder.headers, rid, [_win(_future(2))])
    assert resp.status_code == 403


def test_unknown_request_404(client, make_user):
    candidate = make_user("CANDIDATE")
    resp = _submit(client, candidate.headers, uuid.uuid4(), [_win(_future(2))])
    assert resp.status_code == 404


def test_end_before_start_rejected_with_window_index(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    bad = {
        "start_time": _future(3).isoformat(),
        "end_time": _future(2).isoformat(),
    }
    resp = _submit(client, candidate.headers, rid, [_win(_future(1)), bad])
    assert resp.status_code == 422
    assert any("1" in k for k in resp.json()["error"]["field_errors"])


def test_past_start_rejected(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    resp = _submit(client, candidate.headers, rid, [_win(_future(-1))])
    assert resp.status_code == 422


def test_window_beyond_horizon_rejected(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    resp = _submit(client, candidate.headers, rid, [_win(_future(25))])
    assert resp.status_code == 422


def test_zero_windows_rejected(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    resp = _submit(client, candidate.headers, rid, [])
    assert resp.status_code == 422


def test_too_many_windows_rejected(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    windows = [_win(_future(1 + i)) for i in range(11)]
    resp = _submit(client, candidate.headers, rid, windows)
    assert resp.status_code == 422


def test_invalid_timezone_rejected(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    resp = _submit(client, candidate.headers, rid, [_win(_future(2))], tz="Mars/Base")
    assert resp.status_code == 422
    assert "timezone" in resp.json()["error"]["field_errors"]


def test_naive_datetime_rejected(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    naive = {
        "start_time": "2099-01-01T10:00:00",
        "end_time": "2099-01-01T11:00:00",
    }
    resp = _submit(client, candidate.headers, rid, [naive])
    assert resp.status_code == 422


def test_second_submission_conflicts(client, make_user):
    _a, candidate, _p, rid = _make_request(client, make_user)
    assert _submit(client, candidate.headers, rid, [_win(_future(2))]).status_code == 201
    resp = _submit(client, candidate.headers, rid, [_win(_future(4))])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "REQUEST_NOT_AWAITING_AVAILABILITY"


def test_no_partial_persistence_on_validation_failure(client, make_user):
    admin, candidate, _p, rid = _make_request(client, make_user)
    bad = [_win(_future(2)), _win(_future(-1))]  # 2nd window invalid
    assert _submit(client, candidate.headers, rid, bad).status_code == 422
    assert _get_avail(client, admin.headers, rid).status_code == 404


def test_stored_timezone_is_submission_metadata_and_times_are_utc(client, make_user):
    admin, candidate, _p, rid = _make_request(client, make_user)
    # candidate.timezone in `users` defaults to UTC; submit a different one.
    start = _future(2)
    _submit(client, candidate.headers, rid, [_win(start)], tz="Asia/Kolkata")

    body = client.get(f"{V1}/interviews/{rid}/availability", headers=admin.headers).json()
    assert body["timezone"] == "Asia/Kolkata"
    stored = datetime.fromisoformat(body["windows"][0]["start_time"])
    assert stored.utcoffset() == timedelta(0)  # persisted/returned in UTC
    assert abs(stored - start) < timedelta(seconds=1)


# ------------------------------------------------------------- get availability -


def test_get_availability_visibility(client, make_user):
    admin, candidate, panelist, rid = _make_request(client, make_user)
    other_candidate = make_user("CANDIDATE")

    assert _get_avail(client, admin.headers, rid).status_code == 404  # before any submission

    _submit(client, candidate.headers, rid, [_win(_future(2))])

    assert _get_avail(client, admin.headers, rid).status_code == 200
    assert _get_avail(client, candidate.headers, rid).status_code == 200
    assert _get_avail(client, panelist.headers, rid).status_code == 404
    assert _get_avail(client, other_candidate.headers, rid).status_code == 404


def test_get_availability_unknown_request_404(client, make_user):
    admin = make_user("ADMIN")
    resp = client.get(f"{V1}/interviews/{uuid.uuid4()}/availability", headers=admin.headers)
    assert resp.status_code == 404
