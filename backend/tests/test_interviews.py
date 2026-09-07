"""Phase 3 — interview request CRUD + per-role visibility (FR-012..FR-014)."""

import uuid

V1 = "/api/v1"


def _payload(candidate_id, panelist_ids, **over):
    body = {
        "candidate_id": str(candidate_id),
        "round_type": "TECHNICAL",
        "duration_minutes": 60,
        "panelist_ids": [str(p) for p in panelist_ids],
    }
    body.update(over)
    return body


def _create(client, admin, candidate, panelists, **over):
    return client.post(
        f"{V1}/interviews",
        json=_payload(candidate.id, [p.id for p in panelists], **over),
        headers=admin.headers,
    )


# ---------------------------------------------------------------- create --------


def test_admin_creates_request_in_awaiting_availability(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    p1, p2 = make_user("PANELIST"), make_user("PANELIST")

    resp = _create(client, admin, candidate, [p1, p2])
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "AWAITING_CANDIDATE_AVAILABILITY"  # D1, not DRAFT
    assert body["created_by"] == str(admin.id)
    assert body["buffer_minutes"] == 15  # default
    roles = {p["user_id"]: p["role_in_interview"] for p in body["participants"]}
    assert roles[str(candidate.id)] == "CANDIDATE"
    assert roles[str(p1.id)] == "PANELIST"
    assert roles[str(p2.id)] == "PANELIST"


def test_create_persists_and_returns_title(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")

    resp = _create(client, admin, candidate, [panelist], title="Senior Backend Engineer")
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "Senior Backend Engineer"

    get_resp = client.get(f"{V1}/interviews/{body['id']}", headers=admin.headers)
    assert get_resp.json()["title"] == "Senior Backend Engineer"


def test_create_without_title_returns_null(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")

    resp = _create(client, admin, candidate, [panelist])
    assert resp.status_code == 201
    assert resp.json()["title"] is None


def test_create_persists_and_returns_company(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")

    resp = _create(client, admin, candidate, [panelist], company="Acme Corp")
    assert resp.status_code == 201
    assert resp.json()["company"] == "Acme Corp"

    get_resp = client.get(f"{V1}/interviews/{resp.json()['id']}", headers=admin.headers)
    assert get_resp.json()["company"] == "Acme Corp"


def test_create_without_company_returns_null(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")

    resp = _create(client, admin, candidate, [panelist])
    assert resp.status_code == 201
    assert resp.json()["company"] is None


def test_non_admin_cannot_create(client, make_user):
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    for actor in (candidate, panelist):
        resp = client.post(
            f"{V1}/interviews",
            json=_payload(candidate.id, [panelist.id]),
            headers=actor.headers,
        )
        assert resp.status_code == 403


def test_create_rejects_unknown_candidate(client, make_user):
    admin = make_user("ADMIN")
    panelist = make_user("PANELIST")
    resp = client.post(
        f"{V1}/interviews",
        json=_payload(uuid.uuid4(), [panelist.id]),
        headers=admin.headers,
    )
    assert resp.status_code == 404


def test_create_rejects_candidate_with_wrong_role(client, make_user):
    admin = make_user("ADMIN")
    not_candidate = make_user("PANELIST")
    panelist = make_user("PANELIST")
    resp = client.post(
        f"{V1}/interviews",
        json=_payload(not_candidate.id, [panelist.id]),
        headers=admin.headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_PARTICIPANT"


def test_create_rejects_non_panelist_in_panelist_ids(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    other_candidate = make_user("CANDIDATE")
    resp = client.post(
        f"{V1}/interviews",
        json=_payload(candidate.id, [other_candidate.id]),
        headers=admin.headers,
    )
    assert resp.status_code == 422


def test_create_with_zero_panelists_records_the_creating_admin_as_interviewer(
    client, make_user
):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    resp = client.post(
        f"{V1}/interviews", json=_payload(candidate.id, []), headers=admin.headers
    )
    assert resp.status_code == 201, resp.text
    parts = resp.json()["participants"]
    panelist_ids = {p["user_id"] for p in parts if p["role_in_interview"] == "PANELIST"}
    assert panelist_ids == {str(admin.id)}  # the admin fills the interviewer slot


def test_create_rejects_non_positive_duration(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    resp = _create(client, admin, candidate, [panelist], duration_minutes=0)
    assert resp.status_code == 422


# ------------------------------------------------------------ list / detail ------


def test_list_visibility_per_role(client, make_user):
    admin = make_user("ADMIN")
    cand_a, cand_b = make_user("CANDIDATE"), make_user("CANDIDATE")
    pan_a, pan_b = make_user("PANELIST"), make_user("PANELIST")

    r_a = _create(client, admin, cand_a, [pan_a]).json()
    r_b = _create(client, admin, cand_b, [pan_b]).json()

    admin_list = client.get(f"{V1}/interviews", headers=admin.headers).json()
    seen_by_admin = {x["id"] for x in admin_list["items"]}
    assert {r_a["id"], r_b["id"]} <= seen_by_admin

    by_pan_a = client.get(f"{V1}/interviews", headers=pan_a.headers).json()
    assert [x["id"] for x in by_pan_a["items"]] == [r_a["id"]]

    by_cand_b = client.get(f"{V1}/interviews", headers=cand_b.headers).json()
    assert [x["id"] for x in by_cand_b["items"]] == [r_b["id"]]


def test_freshly_registered_candidate_sees_no_interviews(client, make_user):
    """A brand-new self-registered account starts clean — none of the demo /
    other-tenant interviews leak into its list or its detail reads."""
    admin = make_user("ADMIN")
    existing_cand = make_user("CANDIDATE")
    other_rid = _create(client, admin, existing_cand, [make_user("PANELIST")]).json()["id"]

    email = f"fresh-{uuid.uuid4().hex[:8]}@example.com"
    reg = client.post(
        f"{V1}/auth/register",
        json={"name": "New Person", "email": email, "password": "password1", "timezone": "UTC"},
    )
    assert reg.status_code == 201, reg.text
    assert reg.json()["role"] == "CANDIDATE"  # self-registration is candidate-only

    login = client.post(f"{V1}/auth/login", json={"email": email, "password": "password1"})
    assert login.status_code == 200, login.text
    hdrs = {"Authorization": f"Bearer {login.json()['access_token']}"}

    listing = client.get(f"{V1}/interviews", headers=hdrs).json()
    assert listing["items"] == [] and listing["total"] == 0
    assert client.get(f"{V1}/interviews/{other_rid}", headers=hdrs).status_code == 404


def test_list_pagination_and_status_filter(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    for _ in range(3):
        _create(client, admin, candidate, [panelist])

    page0 = client.get(f"{V1}/interviews?page=0&size=2", headers=admin.headers).json()
    assert page0["total"] == 3 and len(page0["items"]) == 2 and page0["size"] == 2

    hit = client.get(
        f"{V1}/interviews?status=AWAITING_CANDIDATE_AVAILABILITY", headers=admin.headers
    ).json()
    assert hit["total"] == 3
    miss = client.get(f"{V1}/interviews?status=BOOKED", headers=admin.headers).json()
    assert miss["total"] == 0


def test_detail_visible_to_admin_and_participants_only(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    outsider = make_user("PANELIST")
    rid = _create(client, admin, candidate, [panelist]).json()["id"]

    assert client.get(f"{V1}/interviews/{rid}", headers=admin.headers).status_code == 200
    assert client.get(f"{V1}/interviews/{rid}", headers=candidate.headers).status_code == 200
    assert client.get(f"{V1}/interviews/{rid}", headers=panelist.headers).status_code == 200
    # non-participant: 404, not 403 (API_DESIGN "not found or not visible")
    assert client.get(f"{V1}/interviews/{rid}", headers=outsider.headers).status_code == 404


def test_detail_reports_panelist_calendar_status_to_admin(
    client, make_user, make_calendar_connection
):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    connected_p = make_user("PANELIST")
    unconnected_p = make_user("PANELIST")
    make_calendar_connection(connected_p.id, status="CONNECTED")
    rid = _create(client, admin, candidate, [connected_p, unconnected_p]).json()["id"]

    parts = client.get(f"{V1}/interviews/{rid}", headers=admin.headers).json()["participants"]
    by_id = {p["user_id"]: p for p in parts}
    assert by_id[str(connected_p.id)]["calendar_status"] == "CONNECTED"
    assert by_id[str(unconnected_p.id)]["calendar_status"] == "DISCONNECTED"
    assert by_id[str(candidate.id)]["calendar_status"] is None  # candidates don't connect

    # A non-admin participant never sees calendar status.
    as_cand = client.get(f"{V1}/interviews/{rid}", headers=candidate.headers).json()
    assert all(p["calendar_status"] is None for p in as_cand["participants"])


def test_detail_unknown_id_404(client, make_user):
    admin = make_user("ADMIN")
    assert client.get(f"{V1}/interviews/{uuid.uuid4()}", headers=admin.headers).status_code == 404


# ---------------------------------------------------------------- update ---------


def test_admin_updates_round_details_and_panelists(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    p1, p2 = make_user("PANELIST"), make_user("PANELIST")
    rid = _create(client, admin, candidate, [p1]).json()["id"]

    resp = client.patch(
        f"{V1}/interviews/{rid}",
        json={"duration_minutes": 45, "panelist_ids": [str(p2.id)]},
        headers=admin.headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["duration_minutes"] == 45
    panelist_ids = {
        p["user_id"] for p in body["participants"] if p["role_in_interview"] == "PANELIST"
    }
    assert panelist_ids == {str(p2.id)}
    assert any(
        p["user_id"] == str(candidate.id) and p["role_in_interview"] == "CANDIDATE"
        for p in body["participants"]
    )


def test_update_forbidden_for_non_admin(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create(client, admin, candidate, [panelist]).json()["id"]
    resp = client.patch(
        f"{V1}/interviews/{rid}", json={"duration_minutes": 30}, headers=candidate.headers
    )
    assert resp.status_code == 403


def test_update_locked_once_past_editable_state(client, make_user, db_exec):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create(client, admin, candidate, [panelist]).json()["id"]

    db_exec("UPDATE interview_requests SET status = 'BOOKED' WHERE id = :id", {"id": rid})

    resp = client.patch(
        f"{V1}/interviews/{rid}", json={"duration_minutes": 30}, headers=admin.headers
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "REQUEST_LOCKED_FOR_EDITING"


def test_update_unknown_id_404(client, make_user):
    admin = make_user("ADMIN")
    resp = client.patch(
        f"{V1}/interviews/{uuid.uuid4()}", json={"duration_minutes": 30}, headers=admin.headers
    )
    assert resp.status_code == 404
