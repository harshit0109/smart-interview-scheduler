"""Integration tests for the auth flow (register / login / google / refresh)."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.auth import service
from app.auth.google import GoogleIdentity
from app.core.config import settings

V1 = "/api/v1"


def _register(client, email="cand@example.com", password="password1", name="Cand", tz="UTC"):
    return client.post(
        f"{V1}/auth/register",
        json={"email": email, "password": password, "name": name, "timezone": tz},
    )


def _login(client, email="cand@example.com", password="password1"):
    return client.post(f"{V1}/auth/login", json={"email": email, "password": password})


def test_register_creates_candidate(client):
    resp = _register(client)
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "cand@example.com"
    assert body["role"] == "CANDIDATE"  # decision C1: self-signup is always CANDIDATE
    assert "password" not in body and "password_hash" not in body


def test_register_duplicate_email_conflicts(client):
    _register(client)
    resp = _register(client)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"


def test_register_rejects_weak_password(client):
    resp = _register(client, password="short")
    assert resp.status_code == 422
    assert "password" in resp.json()["error"]["field_errors"]


def test_register_rejects_bad_timezone(client):
    resp = _register(client, tz="Mars/Olympus")
    assert resp.status_code == 422
    assert "timezone" in resp.json()["error"]["field_errors"]


def test_login_and_me(client):
    _register(client)
    resp = _login(client)
    assert resp.status_code == 200
    tokens = resp.json()
    assert tokens["token_type"] == "bearer"
    assert tokens["user"]["role"] == "CANDIDATE"

    me = client.get(f"{V1}/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "cand@example.com"


def test_login_wrong_password_is_generic_401(client):
    _register(client)
    resp = _login(client, password="nope1234")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_unknown_email_same_error(client):
    resp = _login(client, email="ghost@example.com")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_me_requires_token(client):
    assert client.get(f"{V1}/users/me").status_code == 401


def test_refresh_issues_new_access_token(client):
    _register(client)
    tokens = client.post(
        f"{V1}/auth/login", json={"email": "cand@example.com", "password": "password1"}
    ).json()
    resp = client.post(f"{V1}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_refresh_rejects_access_token_as_refresh(client):
    _register(client)
    tokens = client.post(
        f"{V1}/auth/login", json={"email": "cand@example.com", "password": "password1"}
    ).json()
    resp = client.post(f"{V1}/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "REFRESH_TOKEN_INVALID"


def test_refresh_revoked_when_token_version_bumped(client):
    _register(client)
    tokens = client.post(
        f"{V1}/auth/login", json={"email": "cand@example.com", "password": "password1"}
    ).json()

    async def _bump():
        eng = create_async_engine(settings.database_url)
        async with eng.begin() as conn:
            await conn.execute(text("UPDATE users SET token_version = token_version + 1"))
        await eng.dispose()

    asyncio.run(_bump())
    resp = client.post(f"{V1}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "REFRESH_TOKEN_REVOKED"


def test_google_login_creates_user_and_no_calendar_connection(client, monkeypatch):
    monkeypatch.setattr(
        service, "verify_id_token", lambda _t: GoogleIdentity(email="g@example.com", name="G User")
    )
    resp = client.post(f"{V1}/auth/google", json={"id_token": "fake"})
    assert resp.status_code == 200
    assert resp.json()["user"]["role"] == "CANDIDATE"

    async def _counts():
        eng = create_async_engine(settings.database_url)
        async with eng.connect() as conn:
            users = await conn.scalar(
                text("SELECT count(*) FROM users WHERE email = 'g@example.com'")
            )
            conns = await conn.scalar(text("SELECT count(*) FROM calendar_connections"))
        await eng.dispose()
        return users, conns

    users, conns = asyncio.run(_counts())
    assert users == 1
    assert conns == 0  # login must never create a Calendar connection


def test_google_login_matches_existing_email(client, monkeypatch):
    _register(client, email="dual@example.com")
    monkeypatch.setattr(
        service, "verify_id_token", lambda _t: GoogleIdentity(email="dual@example.com", name="Dual")
    )
    resp = client.post(f"{V1}/auth/google", json={"id_token": "fake"})
    assert resp.status_code == 200
