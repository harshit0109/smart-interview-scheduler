"""Phase 9 — GET /interviews/{id}/audit (FR-038, ADMIN only)."""

import uuid

from tests.test_booking import _book, _recommended

V1 = "/api/v1"


def test_audit_lists_this_requests_entries_newest_first(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    _book(client, ctx, ctx.slots[0]["id"])
    # a second, unrelated request whose audit rows must NOT leak in
    other = _recommended(client, make_user, make_calendar_connection, fake_calendar)

    resp = client.get(f"{V1}/interviews/{ctx.rid}/audit", headers=ctx.admin.headers)
    assert resp.status_code == 200
    body = resp.json()
    actions = [e["action"] for e in body["items"]]
    assert "INTERVIEW_BOOKED" in actions
    assert "RECOMMENDATION_GENERATED" in actions
    assert all(e["entity_id"] == ctx.rid for e in body["items"])
    assert body["total"] == len(actions)

    # newest first
    times = [e["created_at"] for e in body["items"]]
    assert times == sorted(times, reverse=True)

    # no token-shaped strings anywhere in the metadata
    dumped = str(body)
    for needle in ("fake-access", "fake-refresh", "Bearer", "access_token"):
        assert needle not in dumped

    # isolation
    other_body = client.get(
        f"{V1}/interviews/{other.rid}/audit", headers=other.admin.headers
    ).json()
    assert all(e["entity_id"] == other.rid for e in other_body["items"])


def test_audit_pagination(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    _book(client, ctx, ctx.slots[0]["id"])  # >= 2 audit rows

    page0 = client.get(
        f"{V1}/interviews/{ctx.rid}/audit?page=0&size=1", headers=ctx.admin.headers
    ).json()
    assert page0["size"] == 1 and len(page0["items"]) == 1 and page0["total"] >= 2


def test_audit_requires_admin(client, make_user, make_calendar_connection, fake_calendar):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    for actor in (ctx.candidate, ctx.panelists[0]):
        assert client.get(
            f"{V1}/interviews/{ctx.rid}/audit", headers=actor.headers
        ).status_code == 403


def test_audit_unknown_request_404(client, make_user):
    admin = make_user("ADMIN")
    assert client.get(
        f"{V1}/interviews/{uuid.uuid4()}/audit", headers=admin.headers
    ).status_code == 404
