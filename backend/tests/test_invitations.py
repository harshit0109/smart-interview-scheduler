"""Invitation phase — issuance, resend/rotation, public token respond, and
account claim (app/invitations/).

Booking/scheduling machinery is untouched: a token-based response only writes
participant_invitations + mirrors interview_participants.response_status.
"""

import uuid
from datetime import UTC, datetime, timedelta

V1 = "/api/v1"


def _create_request(client, admin, candidate, panelists):
    resp = client.post(
        f"{V1}/interviews",
        json={
            "candidate_id": str(candidate.id),
            "round_type": "TECHNICAL",
            "duration_minutes": 60,
            "panelist_ids": [str(p.id) for p in panelists],
        },
        headers=admin.headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _issue(client, admin, request_id):
    return client.post(f"{V1}/interviews/{request_id}/invitations", headers=admin.headers)


def _token_from(invite_url: str) -> str:
    return invite_url.rsplit("/", 1)[-1]


# ------------------------------------------------------------------- issue -----


def test_issue_creates_one_invitation_per_participant(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    p1, p2 = make_user("PANELIST"), make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [p1, p2])

    resp = _issue(client, admin, rid)
    assert resp.status_code == 201
    body = resp.json()
    assert len(body) == 3
    user_ids = {row["user_id"] for row in body}
    assert user_ids == {str(candidate.id), str(p1.id), str(p2.id)}
    for row in body:
        assert row["status"] == "PENDING"
        assert row["send_count"] == 1
        assert row["invite_url"].startswith("http")
        assert row["requires_account_setup"] is True  # make_user sets no password


def test_issue_requires_admin(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])

    for actor in (candidate, panelist):
        resp = client.post(f"{V1}/interviews/{rid}/invitations", headers=actor.headers)
        assert resp.status_code == 403


def test_issue_unknown_request_404(client, make_user):
    admin = make_user("ADMIN")
    resp = client.post(
        f"{V1}/interviews/00000000-0000-0000-0000-000000000000/invitations",
        headers=admin.headers,
    )
    assert resp.status_code == 404


def test_resend_rotates_token_and_increments_send_count(client, make_user, db_val):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])

    first = _issue(client, admin, rid).json()
    first_row = next(r for r in first if r["user_id"] == str(candidate.id))

    second = _issue(client, admin, rid).json()
    second_row = next(r for r in second if r["user_id"] == str(candidate.id))

    assert first_row["id"] == second_row["id"]  # same row, rotated in place
    assert _token_from(first_row["invite_url"]) != _token_from(second_row["invite_url"])
    assert second_row["send_count"] == 2

    count = db_val(
        "SELECT count(*) FROM participant_invitations WHERE interview_request_id = :r "
        "AND user_id = :u",
        {"r": rid, "u": str(candidate.id)},
    )
    assert count == 1  # never a duplicate row

    # The old link is dead — the rotated token_hash no longer matches it.
    stale = client.get(f"{V1}/invitations/{_token_from(first_row['invite_url'])}")
    assert stale.status_code == 404


def test_resend_all_preserves_an_already_responded_invitation(client, make_user, db_val):
    """Resend must never silently reopen a completed response by resetting it
    back to PENDING — only PENDING/EXPIRED invitations get a fresh token."""
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])

    first = {r["user_id"]: r for r in _issue(client, admin, rid).json()}
    candidate_token = _token_from(first[str(candidate.id)]["invite_url"])
    accept = client.post(
        f"{V1}/invitations/{candidate_token}/respond", json={"response": "ACCEPTED"}
    )
    assert accept.status_code == 200

    second = _issue(client, admin, rid).json()
    # candidate excluded from the resend — already responded
    assert {r["user_id"] for r in second} == {str(panelist.id)}

    still_accepted = client.get(f"{V1}/invitations/{candidate_token}")
    assert still_accepted.status_code == 200
    assert still_accepted.json()["status"] == "ACCEPTED"

    responded_at = db_val(
        "SELECT responded_at FROM participant_invitations WHERE interview_request_id = :r "
        "AND user_id = :u",
        {"r": rid, "u": str(candidate.id)},
    )
    assert responded_at is not None  # the original response record is intact

    part_status = db_val(
        "SELECT response_status FROM interview_participants WHERE interview_request_id = :r "
        "AND user_id = :u",
        {"r": rid, "u": str(candidate.id)},
    )
    assert part_status == "ACCEPTED"


def test_resend_still_reissues_pending_and_expired(client, make_user, db_exec):
    """The exclusion is specific to a completed response — PENDING and EXPIRED
    invitations still get resent (that's the whole point of "resend")."""
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    p1, p2 = make_user("PANELIST"), make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [p1, p2])

    first = {r["user_id"]: r for r in _issue(client, admin, rid).json()}
    db_exec(
        "UPDATE participant_invitations SET expires_at = now() - interval '1 hour' "
        "WHERE id = :i",
        {"i": first[str(p1.id)]["id"]},
    )

    second = _issue(client, admin, rid).json()
    resent_ids = {r["user_id"] for r in second}
    assert resent_ids == {str(candidate.id), str(p1.id), str(p2.id)}
    p1_row = next(r for r in second if r["user_id"] == str(p1.id))
    assert p1_row["status"] == "PENDING"  # the expired link is revived, not left dead


def test_candidate_and_panelists_both_included(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    p1, p2 = make_user("PANELIST"), make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [p1, p2])

    body = _issue(client, admin, rid).json()
    roles = {row["user_id"]: row["role"] for row in body}
    assert roles[str(candidate.id)] == "CANDIDATE"
    assert roles[str(p1.id)] == "PANELIST"
    assert roles[str(p2.id)] == "PANELIST"


def test_delivery_status_simulated_by_default_and_sent_when_configured(
    client, make_user, fake_sendgrid
):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])

    simulated = _issue(client, admin, rid).json()
    assert all(row["delivery_status"] == "SIMULATED" for row in simulated)
    assert fake_sendgrid.sent == []

    fake_sendgrid.configured = True
    sent = _issue(client, admin, rid).json()
    assert all(row["delivery_status"] == "SENT" for row in sent)

    fake_sendgrid.fail = True
    failed = _issue(client, admin, rid).json()
    assert all(row["delivery_status"] == "FAILED" for row in failed)


def test_list_invitations_admin_only(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    _issue(client, admin, rid)

    resp = client.get(f"{V1}/interviews/{rid}/invitations", headers=admin.headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    forbidden = client.get(f"{V1}/interviews/{rid}/invitations", headers=candidate.headers)
    assert forbidden.status_code == 403


# ---------------------------------------------------------------- get token ----


def test_get_by_token_public_no_auth_required(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))

    resp = client.get(f"{V1}/invitations/{_token_from(row['invite_url'])}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "CANDIDATE"
    assert body["status"] == "PENDING"
    assert body["requires_account_setup"] is True
    assert body["round_type"] == "TECHNICAL"


def test_get_by_token_unknown_returns_404(client):
    resp = client.get(f"{V1}/invitations/not-a-real-token")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "INVITATION_NOT_FOUND"


# ------------------------------------------------------------------ respond ----


def test_respond_accepted_updates_both_tables(client, make_user, db_val):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    resp = client.post(f"{V1}/invitations/{token}/respond", json={"response": "ACCEPTED"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "ACCEPTED"

    inv_status = db_val(
        "SELECT status FROM participant_invitations WHERE id = :i", {"i": row["id"]}
    )
    assert inv_status == "ACCEPTED"
    part_status = db_val(
        "SELECT response_status FROM interview_participants WHERE interview_request_id = :r "
        "AND user_id = :u",
        {"r": rid, "u": str(candidate.id)},
    )
    assert part_status == "ACCEPTED"


def test_respond_declined_and_unavailable(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    p1, p2 = make_user("PANELIST"), make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [p1, p2])
    rows = {r["user_id"]: r for r in _issue(client, admin, rid).json()}

    decl = client.post(
        f"{V1}/invitations/{_token_from(rows[str(p1.id)]['invite_url'])}/respond",
        json={"response": "DECLINED", "reason": "scheduling conflict"},
    )
    assert decl.status_code == 200
    assert decl.json()["status"] == "DECLINED"

    unavail = client.post(
        f"{V1}/invitations/{_token_from(rows[str(p2.id)]['invite_url'])}/respond",
        json={"response": "UNAVAILABLE"},
    )
    assert unavail.status_code == 200
    assert unavail.json()["status"] == "UNAVAILABLE"


def test_candidate_unavailable_is_rejected(client, make_user):
    """UNAVAILABLE is a panelist-only response (the candidate's counterpart is
    DECLINE); a candidate invitation must not accept it."""
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    resp = client.post(f"{V1}/invitations/{token}/respond", json={"response": "UNAVAILABLE"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_PARTICIPANT"

    # The rejected attempt must not have consumed the PENDING invitation.
    still_pending = client.get(f"{V1}/invitations/{token}")
    assert still_pending.json()["status"] == "PENDING"


def test_respond_twice_is_rejected(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    first = client.post(f"{V1}/invitations/{token}/respond", json={"response": "ACCEPTED"})
    assert first.status_code == 200
    second = client.post(f"{V1}/invitations/{token}/respond", json={"response": "DECLINED"})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "INVITATION_ALREADY_RESPONDED"


def test_respond_after_expiry_is_rejected(client, make_user, db_exec):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    db_exec(
        "UPDATE participant_invitations SET expires_at = :e WHERE id = :i",
        {"e": datetime.now(UTC) - timedelta(hours=1), "i": row["id"]},
    )

    resp = client.post(f"{V1}/invitations/{token}/respond", json={"response": "ACCEPTED"})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "INVITATION_EXPIRED"

    get_resp = client.get(f"{V1}/invitations/{token}")
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "EXPIRED"


# ------------------------------------------------------------- claim account ---


def test_claim_account_sets_password_and_enables_login(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    claim = client.post(
        f"{V1}/invitations/{token}/claim-account", json={"password": "newpass1"}
    )
    assert claim.status_code == 200
    body = claim.json()
    assert body["user"]["id"] == str(candidate.id)
    assert "access_token" in body and "refresh_token" in body

    login = client.post(
        f"{V1}/auth/login", json={"email": candidate.email, "password": "newpass1"}
    )
    assert login.status_code == 200


def test_claim_account_twice_is_rejected(client, make_user):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    assert client.post(
        f"{V1}/invitations/{token}/claim-account", json={"password": "newpass1"}
    ).status_code == 200
    second = client.post(
        f"{V1}/invitations/{token}/claim-account", json={"password": "otherpass1"}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "ACCOUNT_ALREADY_CLAIMED"


def test_claim_account_not_required_is_rejected(client, make_user, db_exec):
    """A candidate who already has a password (self-registered, then invited)
    has requires_account_setup=False; claim-account must refuse."""
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    # make_user leaves password_hash NULL by default — set one to simulate a
    # self-registered account that an ADMIN later invites onto an interview.
    db_exec(
        "UPDATE users SET password_hash = 'not-a-real-hash' WHERE id = :id",
        {"id": str(candidate.id)},
    )
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    assert row["requires_account_setup"] is False

    resp = client.post(
        f"{V1}/invitations/{_token_from(row['invite_url'])}/claim-account",
        json={"password": "newpass1"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "ACCOUNT_SETUP_NOT_REQUIRED"


def test_respond_and_claim_are_independent(client, make_user):
    """Declining an invitation must not block claiming the account afterwards."""
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    row = next(r for r in _issue(client, admin, rid).json() if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])

    assert client.post(
        f"{V1}/invitations/{token}/respond", json={"response": "DECLINED"}
    ).status_code == 200
    claim = client.post(
        f"{V1}/invitations/{token}/claim-account", json={"password": "newpass1"}
    )
    assert claim.status_code == 200


# ---------------------------------------------------------- no secret leaks ----


def test_no_raw_token_leaks_into_audit_or_logs(client, make_user, db_val, app_logs):
    admin = make_user("ADMIN")
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    rid = _create_request(client, admin, candidate, [panelist])
    rows = _issue(client, admin, rid).json()
    raw_tokens = [_token_from(r["invite_url"]) for r in rows]

    row = next(r for r in rows if r["user_id"] == str(candidate.id))
    token = _token_from(row["invite_url"])
    client.post(f"{V1}/invitations/{token}/respond", json={"response": "ACCEPTED"})

    metas = db_val(
        "SELECT string_agg(metadata::text, ' ') FROM audit_logs WHERE entity_type IN "
        "('participant_invitation', 'user')"
    ) or ""
    blob = " ".join(r.getMessage() for r in app_logs) + " " + metas

    for token in raw_tokens:
        assert token not in blob
    for key in ("token_hash", "\"token\""):
        assert key not in metas.lower()


# --------------------------------------------------------------- rate limits ---


def test_issue_bucket_is_ten_per_minute(client, make_user, rate_limited):
    admin = make_user("ADMIN")
    rid = uuid.uuid4()  # unknown request -> 404, but the invite bucket still counts
    codes = [
        client.post(f"{V1}/interviews/{rid}/invitations", headers=admin.headers).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [404] * 10
    assert codes[10] == 429


def test_public_token_routes_are_strict(client, rate_limited):
    codes = [client.get(f"{V1}/invitations/not-a-real-token").status_code for _ in range(11)]
    assert codes[:10] == [404] * 10
    assert codes[10] == 429
