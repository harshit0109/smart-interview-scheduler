"""POST /api/v1/users — ADMIN provisioning of unclaimed CANDIDATE/PANELIST accounts (Phase B)."""

V1 = "/api/v1"


def _provision(client, headers, *, email, role, name="Provisioned", tz="UTC"):
    body = {"email": email, "name": name, "role": role}
    if tz is not None:
        body["timezone"] = tz
    return client.post(f"{V1}/users", json=body, headers=headers)


def test_admin_provisions_new_candidate(client, make_user):
    admin = make_user("ADMIN")
    resp = _provision(client, admin.headers, email="cand1@example.com", role="CANDIDATE")
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "CANDIDATE"
    assert body["created"] is True
    assert body["email"] == "cand1@example.com"
    assert set(body) == {"id", "email", "name", "role", "timezone", "created"}


def test_admin_provisions_new_panelist(client, make_user):
    admin = make_user("ADMIN")
    resp = _provision(
        client, admin.headers, email="pan1@example.com", role="PANELIST", tz="Europe/London"
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "PANELIST"
    assert body["created"] is True
    assert body["timezone"] == "Europe/London"


def test_provisioned_user_has_no_password_hash(client, make_user, db_val):
    admin = make_user("ADMIN")
    _provision(client, admin.headers, email="nopw@example.com", role="CANDIDATE")
    hashed = db_val(
        "SELECT password_hash FROM users WHERE email = :e", {"e": "nopw@example.com"}
    )
    assert hashed is None


def test_same_email_same_role_is_idempotent(client, make_user, db_val):
    admin = make_user("ADMIN")
    first = _provision(client, admin.headers, email="dup@example.com", role="PANELIST")
    second = _provision(client, admin.headers, email="dup@example.com", role="PANELIST")
    assert first.status_code == 201 and first.json()["created"] is True
    assert second.status_code == 201 and second.json()["created"] is False
    assert first.json()["id"] == second.json()["id"]
    count = db_val("SELECT count(*) FROM users WHERE email = :e", {"e": "dup@example.com"})
    assert count == 1


def test_same_email_different_role_is_role_conflict(client, make_user):
    admin = make_user("ADMIN")
    _provision(client, admin.headers, email="clash@example.com", role="CANDIDATE")
    resp = _provision(client, admin.headers, email="clash@example.com", role="PANELIST")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "ROLE_CONFLICT"


def test_role_admin_is_rejected(client, make_user, db_val):
    admin = make_user("ADMIN")
    resp = _provision(client, admin.headers, email="wannabe@example.com", role="ADMIN")
    assert resp.status_code == 422
    assert db_val(
        "SELECT count(*) FROM users WHERE email = :e", {"e": "wannabe@example.com"}
    ) == 0


def test_non_admin_is_forbidden(client, make_user):
    for role in ("CANDIDATE", "PANELIST"):
        actor = make_user(role)
        resp = _provision(client, actor.headers, email=f"x-{role}@example.com", role="CANDIDATE")
        assert resp.status_code == 403


def test_unauthenticated_is_rejected(client):
    resp = client.post(
        f"{V1}/users", json={"email": "a@example.com", "name": "A", "role": "CANDIDATE"}
    )
    assert resp.status_code == 401


def test_audit_records_user_provisioned_without_secrets(client, make_user, db_val):
    admin = make_user("ADMIN")
    resp = _provision(client, admin.headers, email="audited@example.com", role="PANELIST")
    new_id = resp.json()["id"]

    action = db_val(
        "SELECT action FROM audit_logs WHERE entity_id = :e AND entity_type = 'user'",
        {"e": new_id},
    )
    assert action == "USER_PROVISIONED"

    meta = db_val(
        "SELECT metadata::text FROM audit_logs WHERE entity_id = :e "
        "AND action = 'USER_PROVISIONED'",
        {"e": new_id},
    )
    assert "audited@example.com" in meta
    assert "PANELIST" in meta
    for secret_key in ("password", "password_hash", "token", "secret"):
        assert secret_key not in meta.lower()
