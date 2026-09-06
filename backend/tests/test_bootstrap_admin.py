"""POST /api/v1/auth/bootstrap-admin — token-gated ADMIN web registration.

Gated by the ADMIN_BOOTSTRAP_TOKEN shared secret (X-Bootstrap-Token header).
Not configured OR wrong token => 404 (no discoverable public admin-registration
route). Repeatable: a valid token may create more than one ADMIN.
"""

import pytest

from app.core.config import settings

V1 = "/api/v1"
TOKEN = "bootstrap-secret-0123456789"
BODY = {
    "email": "founder@example.com",
    "password": "founder-pw-1",
    "name": "Founder",
    "timezone": "UTC",
}


@pytest.fixture
def bootstrap_enabled(monkeypatch):
    monkeypatch.setattr(settings, "admin_bootstrap_token", TOKEN)
    return TOKEN


def test_not_configured_endpoint_is_hidden(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_bootstrap_token", "")
    resp = client.post(
        f"{V1}/auth/bootstrap-admin", json=BODY, headers={"X-Bootstrap-Token": "anything"}
    )
    assert resp.status_code == 404


def test_wrong_token_is_hidden(client, bootstrap_enabled):
    resp = client.post(
        f"{V1}/auth/bootstrap-admin", json=BODY, headers={"X-Bootstrap-Token": "wrong-token"}
    )
    assert resp.status_code == 404


def test_missing_token_header_is_hidden(client, bootstrap_enabled):
    resp = client.post(f"{V1}/auth/bootstrap-admin", json=BODY)
    assert resp.status_code == 404


def test_correct_token_zero_admins_creates_admin(client, bootstrap_enabled, db_val):
    resp = client.post(
        f"{V1}/auth/bootstrap-admin", json=BODY, headers={"X-Bootstrap-Token": TOKEN}
    )
    assert resp.status_code == 201
    role = db_val("SELECT role FROM users WHERE email = :e", {"e": BODY["email"]})
    assert role == "ADMIN"
    hashed = db_val("SELECT password_hash FROM users WHERE email = :e", {"e": BODY["email"]})
    assert hashed and hashed != BODY["password"]  # stored hashed, never plaintext


def test_success_returns_normal_token_pair(client, bootstrap_enabled):
    resp = client.post(
        f"{V1}/auth/bootstrap-admin", json=BODY, headers={"X-Bootstrap-Token": TOKEN}
    )
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["role"] == "ADMIN"

    me = client.get(
        f"{V1}/users/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200 and me.json()["email"] == BODY["email"]


def test_token_allows_additional_admin_when_one_already_exists(
    client, bootstrap_enabled, make_user, db_val
):
    make_user("ADMIN")
    resp = client.post(
        f"{V1}/auth/bootstrap-admin", json=BODY, headers={"X-Bootstrap-Token": TOKEN}
    )
    assert resp.status_code == 201
    assert resp.json()["user"]["role"] == "ADMIN"
    role = db_val("SELECT role FROM users WHERE email = :e", {"e": BODY["email"]})
    assert role == "ADMIN"


def test_audit_and_logs_carry_no_secrets(client, bootstrap_enabled, db_val, app_logs):
    resp = client.post(
        f"{V1}/auth/bootstrap-admin", json=BODY, headers={"X-Bootstrap-Token": TOKEN}
    )
    new_id = resp.json()["user"]["id"]

    action = db_val(
        "SELECT action FROM audit_logs WHERE entity_id = :e AND entity_type = 'user'",
        {"e": new_id},
    )
    assert action == "ADMIN_BOOTSTRAPPED"

    meta = db_val(
        "SELECT metadata::text FROM audit_logs WHERE entity_id = :e", {"e": new_id}
    )
    assert BODY["password"] not in meta
    assert TOKEN not in meta
    for key in ("password", "token", "secret"):
        assert key not in meta.lower()

    blob = " ".join(r.getMessage() for r in app_logs)
    assert BODY["password"] not in blob
    assert TOKEN not in blob


def test_strict_rate_limit_applies(client, bootstrap_enabled, rate_limited):
    # Wrong token -> 404s, but the STRICT bucket still fills; the 11th is a 429.
    hdr = {"X-Bootstrap-Token": "wrong"}
    codes = [
        client.post(f"{V1}/auth/bootstrap-admin", json=BODY, headers=hdr).status_code
        for _ in range(10)
    ]
    assert codes == [404] * 10
    assert client.post(f"{V1}/auth/bootstrap-admin", json=BODY, headers=hdr).status_code == 429
