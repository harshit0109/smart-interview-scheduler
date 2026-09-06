"""Phase 9 item 4 — /recommendations and /book widened to the owning CANDIDATE."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

V1 = "/api/v1"


def _ready(client, make_user, make_calendar_connection):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelists = [make_user("PANELIST") for _ in range(2)]
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
    return SimpleNamespace(admin=admin, candidate=candidate, panelists=panelists, rid=rid)


def test_owning_candidate_can_recommend_and_book(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = []

    rec = client.post(
        f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.candidate.headers
    )
    assert rec.status_code == 200
    slot_id = rec.json()["slots"][0]["id"]

    booked = client.post(
        f"{V1}/interviews/{ctx.rid}/book",
        json={"recommended_slot_id": slot_id},
        headers=ctx.candidate.headers,
    )
    assert booked.status_code == 201
    assert booked.json()["status"] == "CONFIRMED"


def test_other_candidate_is_forbidden(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready(client, make_user, make_calendar_connection)
    fake_calendar.free_busy_result = []
    intruder = make_user("CANDIDATE")

    assert client.post(
        f"{V1}/interviews/{ctx.rid}/recommendations", headers=intruder.headers
    ).status_code == 403
    assert client.post(
        f"{V1}/interviews/{ctx.rid}/book",
        json={"recommended_slot_id": "00000000-0000-0000-0000-000000000000"},
        headers=intruder.headers,
    ).status_code == 403


def test_panelist_still_forbidden(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _ready(client, make_user, make_calendar_connection)
    assert client.post(
        f"{V1}/interviews/{ctx.rid}/recommendations", headers=ctx.panelists[0].headers
    ).status_code == 403
