"""Phase 6 — Calendar OAuth connect flow, lifecycle, token encryption.

No real Google credentials: all HTTP goes through the injected fake client, and
the one real-transport test uses httpx.MockTransport.
"""

import asyncio

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.calendar import repository as cal_repo
from app.calendar import service as cal_service
from app.calendar.client import (
    CalendarAuthError,
    CalendarTransportError,
    GoogleCalendarClient,
)
from app.core import crypto
from app.core.config import settings
from app.core.errors import (
    CalendarConnectionExpiredError,
    CalendarConnectionRevokedError,
)
from app.core.security import create_calendar_state_token

V1 = "/api/v1"


# ---------------------------------------------------------------- connect -------


def test_connect_requires_admin_or_panelist(client, make_user, fake_calendar):
    for role in ("ADMIN", "PANELIST"):
        u = make_user(role)
        resp = client.post(f"{V1}/calendar/connect", headers=u.headers)
        assert resp.status_code == 200
        body = resp.json()
        assert list(body) == ["authorization_url"]
        assert "state=" in body["authorization_url"]

    cand = make_user("CANDIDATE")
    assert client.post(f"{V1}/calendar/connect", headers=cand.headers).status_code == 403


def test_connect_real_authorization_url_shape(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "google_calendar_oauth_client_id", "test-client-id")
    admin = make_user("ADMIN")
    url = client.post(f"{V1}/calendar/connect", headers=admin.headers).json()["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=test-client-id" in url
    assert "calendar.freebusy" in url and "calendar.events" in url
    assert "access_type=offline" in url and "state=" in url


# ---------------------------------------------------------------- callback ------


def test_callback_stores_encrypted_tokens_and_redirects(
    client, make_user, fake_calendar, db_val
):
    user = make_user("PANELIST")
    state = create_calendar_state_token(user.id, 300)

    resp = client.get(
        f"{V1}/calendar/callback", params={"code": "abc", "state": state}, follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/calendar/connected")
    assert "fake-access-token" not in resp.text and "fake-refresh-token" not in resp.text

    row_status = db_val(
        "SELECT status FROM calendar_connections WHERE user_id = :u", {"u": str(user.id)}
    )
    assert row_status == "CONNECTED"

    enc_access = db_val(
        "SELECT access_token_encrypted FROM calendar_connections WHERE user_id = :u",
        {"u": str(user.id)},
    )
    enc_refresh = db_val(
        "SELECT refresh_token_encrypted FROM calendar_connections WHERE user_id = :u",
        {"u": str(user.id)},
    )
    assert enc_access != "fake-access-token"
    assert crypto.decrypt(enc_access) == "fake-access-token"
    assert crypto.decrypt(enc_refresh) == "fake-refresh-token"

    audit_action = db_val(
        "SELECT action FROM audit_logs WHERE entity_type = 'calendar_connection' LIMIT 1"
    )
    assert audit_action == "CALENDAR_CONNECTED"
    audit_meta = db_val(
        "SELECT metadata::text FROM audit_logs WHERE entity_type = 'calendar_connection' LIMIT 1"
    )
    assert "fake-access-token" not in audit_meta and "fake-refresh-token" not in audit_meta


def test_callback_bad_state_redirects_error_without_writing(client, fake_calendar, db_val):
    resp = client.get(
        f"{V1}/calendar/callback", params={"code": "abc", "state": "garbage"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/calendar/error")
    assert db_val("SELECT count(*) FROM calendar_connections") == 0


def test_callback_expired_state_redirects_error(client, make_user, fake_calendar, db_val):
    user = make_user("PANELIST")
    expired = create_calendar_state_token(user.id, -10)
    resp = client.get(
        f"{V1}/calendar/callback", params={"code": "abc", "state": expired},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/calendar/error")
    assert db_val("SELECT count(*) FROM calendar_connections") == 0


def test_callback_missing_params_redirects_error(client, fake_calendar):
    r1 = client.get(f"{V1}/calendar/callback", params={"state": "x"}, follow_redirects=False)
    r2 = client.get(f"{V1}/calendar/callback", params={"code": "x"}, follow_redirects=False)
    assert r1.status_code == r2.status_code == 302
    assert r1.headers["location"].endswith("/calendar/error")


def test_callback_token_exchange_failure_redirects_error(
    client, make_user, fake_calendar, db_val
):
    user = make_user("PANELIST")
    fake_calendar.exchange_result = CalendarAuthError("invalid_grant")
    state = create_calendar_state_token(user.id, 300)
    resp = client.get(
        f"{V1}/calendar/callback", params={"code": "abc", "state": state}, follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/calendar/error")
    assert db_val("SELECT count(*) FROM calendar_connections") == 0


# ---------------------------------------------------------------- status --------


def test_status_reports_lifecycle(client, make_user, make_calendar_connection):
    panelist = make_user("PANELIST")
    before = client.get(f"{V1}/calendar/status", headers=panelist.headers).json()
    assert before["status"] == "DISCONNECTED" and before["last_synced_at"] is None

    make_calendar_connection(panelist.id)
    after = client.get(f"{V1}/calendar/status", headers=panelist.headers).json()
    assert after["status"] == "CONNECTED"

    cand = make_user("CANDIDATE")
    assert client.get(f"{V1}/calendar/status", headers=cand.headers).status_code == 403


# ---------------------------------------------------- retry / backoff wrapper ---


def test_retry_wrapper_recovers_then_gives_up(monkeypatch):
    monkeypatch.setattr("app.calendar.client._BACKOFF_SECONDS", (0.0, 0.0, 0.0))
    calls = {"n": 0}

    def handler_two_failures(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, json={"error": "backend"})
        return httpx.Response(200, json={"access_token": "a", "expires_in": 3600, "scope": "s"})

    c = GoogleCalendarClient(
        client_id="id", client_secret="sec", redirect_uri="uri",
        transport=httpx.MockTransport(handler_two_failures),
    )
    bundle = asyncio.run(c.exchange_code("code"))
    assert bundle.access_token == "a"
    assert calls["n"] == 3

    calls["n"] = 0

    def handler_always_fail(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503, json={"error": "backend"})

    c2 = GoogleCalendarClient(
        client_id="id", client_secret="sec", redirect_uri="uri",
        transport=httpx.MockTransport(handler_always_fail),
    )
    with pytest.raises(CalendarTransportError):
        asyncio.run(c2.exchange_code("code"))
    assert calls["n"] == 3


def test_invalid_grant_is_not_retried(monkeypatch):
    monkeypatch.setattr("app.calendar.client._BACKOFF_SECONDS", (0.0, 0.0, 0.0))
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, json={"error": "invalid_grant"})

    c = GoogleCalendarClient(
        client_id="id", client_secret="sec", redirect_uri="uri",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(CalendarAuthError):
        asyncio.run(c.exchange_code("code"))
    assert calls["n"] == 1


# ------------------------------------------------------- ensure_usable / REVOKED-


def test_ensure_usable_marks_revoked_on_failed_refresh(make_user, make_calendar_connection):
    panelist = make_user("PANELIST")
    make_calendar_connection(panelist.id, status="EXPIRED")

    class RefreshFails:
        async def refresh(self, refresh_token):
            raise CalendarAuthError("invalid_grant")

    async def _run():
        eng = create_async_engine(settings.database_url)
        session = async_sessionmaker(eng, expire_on_commit=False)
        async with session() as db:
            conn = await cal_repo.get_by_user(db, panelist.id)
            with pytest.raises(CalendarConnectionRevokedError):
                await cal_service.ensure_usable(
                    db, conn, RefreshFails(), panelist_email=panelist.email
                )
            assert (await cal_repo.get_by_user(db, panelist.id)).status == "REVOKED"
        await eng.dispose()

    asyncio.run(_run())


def test_ensure_usable_reports_expired_when_no_refresh_token(make_user, make_calendar_connection):
    panelist = make_user("PANELIST")
    make_calendar_connection(panelist.id, status="EXPIRED", with_refresh=False)

    async def _run():
        eng = create_async_engine(settings.database_url)
        session = async_sessionmaker(eng, expire_on_commit=False)
        async with session() as db:
            conn = await cal_repo.get_by_user(db, panelist.id)
            with pytest.raises(CalendarConnectionExpiredError):
                await cal_service.ensure_usable(
                    db, conn, object(), panelist_email=panelist.email
                )
            # stays EXPIRED — not escalated to REVOKED (nothing was rejected)
            assert (await cal_repo.get_by_user(db, panelist.id)).status == "EXPIRED"
        await eng.dispose()

    asyncio.run(_run())


# ----------------------------------------------------------- token encryption ---


def test_crypto_roundtrip():
    enc = crypto.encrypt("super-secret-token")
    assert enc != "super-secret-token"
    assert crypto.decrypt(enc) == "super-secret-token"


def test_crypto_refuses_dev_key_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "calendar_token_encryption_key", "dev")
    with pytest.raises(crypto.TokenCryptoError):
        crypto.encrypt("x")
