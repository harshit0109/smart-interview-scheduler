"""Shared test fixtures.

Tests run against the DATABASE_URL Postgres (the docker-compose / CI instance).
The schema is created once via the real Alembic migrations; tables are truncated
between tests. Note: this wipes data in whatever DB DATABASE_URL points at —
point it at a throwaway database, not a populated one.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.calendar.client import CalendarEvent, TokenBundle, get_calendar_client
from app.core.config import settings
from app.core.crypto import encrypt
from app.core.security import create_access_token
from app.main import app
from app.notifications.client import get_sendgrid_client


@pytest.fixture(scope="session", autouse=True)
def _migrate():
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(scope="session")
def client(_migrate):
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clean_db(_migrate):
    async def _truncate():
        eng = create_async_engine(settings.database_url)
        async with eng.begin() as conn:
            # CASCADE also clears interview_requests / interview_participants /
            # calendar_connections / audit_logs (all FK-reference users).
            await conn.execute(text("TRUNCATE users RESTART IDENTITY CASCADE"))
        await eng.dispose()

    asyncio.run(_truncate())
    yield


@pytest.fixture
def db_exec():
    """Run a raw SQL statement against the test DB (for arranging edge-case state)."""

    def _exec(sql: str, params: dict | None = None) -> None:
        async def _go() -> None:
            eng = create_async_engine(settings.database_url)
            try:
                async with eng.begin() as conn:
                    await conn.execute(text(sql), params or {})
            finally:
                await eng.dispose()  # must run even on error, or a leaked
                # connection can hold a lock and hang the next TRUNCATE

        asyncio.run(_go())

    return _exec


@pytest.fixture
def db_val():
    """Run a raw SQL query against the test DB and return the first column."""

    def _val(sql: str, params: dict | None = None):
        async def _go():
            eng = create_async_engine(settings.database_url)
            try:
                async with eng.connect() as conn:
                    return await conn.scalar(text(sql), params or {})
            finally:
                await eng.dispose()

        return asyncio.run(_go())

    return _val


@pytest.fixture
def make_user():
    """Factory: insert a user of the given role directly, return id/email/role/token/headers."""

    def _make(role: str, email: str | None = None, timezone: str = "UTC") -> SimpleNamespace:
        email = email or f"{role.lower()}-{uuid.uuid4().hex[:8]}@example.com"

        async def _insert() -> uuid.UUID:
            eng = create_async_engine(settings.database_url)
            async with eng.begin() as conn:
                uid = await conn.scalar(
                    text(
                        "INSERT INTO users (email, name, role, auth_provider, timezone) "
                        "VALUES (:e, :n, :r, 'PASSWORD', :tz) RETURNING id"
                    ),
                    {"e": email, "n": email, "r": role, "tz": timezone},
                )
            await eng.dispose()
            return uid

        uid = asyncio.run(_insert())
        token = create_access_token(uid, role)
        return SimpleNamespace(
            id=uid,
            email=email,
            role=role,
            timezone=timezone,
            token=token,
            headers={"Authorization": f"Bearer {token}"},
        )

    return _make


@pytest.fixture
def make_calendar_connection():
    """Insert a `calendar_connections` row directly, with encrypted fake tokens."""

    def _make(
        user_id: uuid.UUID,
        *,
        status: str = "CONNECTED",
        expires_in: int = 3600,
        with_refresh: bool = True,
        access_token: str = "fake-access-token",
        refresh_token: str = "fake-refresh-token",
    ) -> None:
        async def _insert() -> None:
            eng = create_async_engine(settings.database_url)
            async with eng.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO calendar_connections "
                        "(user_id, provider, status, scopes_granted, "
                        " access_token_encrypted, refresh_token_encrypted, token_expires_at) "
                        "VALUES (:u, 'GOOGLE', :s, :sc, :a, :r, :e)"
                    ),
                    {
                        "u": str(user_id),
                        "s": status,
                        "sc": "https://www.googleapis.com/auth/calendar.freebusy",
                        "a": encrypt(access_token),
                        "r": encrypt(refresh_token) if with_refresh else None,
                        "e": datetime.now(UTC) + timedelta(seconds=expires_in),
                    },
                )
            await eng.dispose()

        asyncio.run(_insert())

    return _make


class FakeCalendarClient:
    """Stand-in for GoogleCalendarClient. Configure the `*_result` attrs per test;
    set one to an Exception instance to make that call raise it."""

    def __init__(self) -> None:
        self.exchange_result: object = None
        self.refresh_result: object = None
        self.free_busy_result: object = None  # list[BusyInterval] | Exception | callable
        self.create_event_result: object = None  # CalendarEvent | Exception
        self.delete_event_result: object = None  # None | Exception
        self.created_events: list[dict] = []
        self.deleted_event_ids: list[str] = []

    def authorization_url(self, state: str) -> str:
        scopes = "https://www.googleapis.com/auth/calendar.freebusy%20" \
                 "https://www.googleapis.com/auth/calendar.events"
        return f"https://accounts.google.com/o/oauth2/v2/auth?client_id=fake&scope={scopes}&state={state}"

    async def exchange_code(self, code: str) -> TokenBundle:
        return self._resolve(
            self.exchange_result,
            TokenBundle("fake-access-token", "fake-refresh-token", 3600, "scope"),
        )

    async def refresh(self, refresh_token: str) -> TokenBundle:
        return self._resolve(
            self.refresh_result, TokenBundle("fake-access-token-refreshed", None, 3600, "scope")
        )

    async def free_busy(self, access_token, time_min, time_max):
        r = self.free_busy_result
        if isinstance(r, BaseException):
            raise r
        if callable(r):
            return list(r(time_min, time_max))
        return list(r or [])

    async def create_event(
        self, access_token, *, summary, description, start, end, attendee_emails
    ) -> CalendarEvent:
        self.created_events.append(
            {"summary": summary, "start": start, "end": end, "attendees": list(attendee_emails)}
        )
        return self._resolve(
            self.create_event_result,
            CalendarEvent(
                event_id=f"evt-{uuid.uuid4().hex[:12]}",
                meeting_link="https://meet.google.com/fake-abc-defg",
                html_link="https://calendar.google.com/event?eid=fake",
            ),
        )

    async def delete_event(self, access_token, event_id: str) -> None:
        self.deleted_event_ids.append(event_id)
        if isinstance(self.delete_event_result, BaseException):
            raise self.delete_event_result

    @staticmethod
    def _resolve(value, default):
        if isinstance(value, BaseException):
            raise value
        return value if value is not None else default


@pytest.fixture
def fake_calendar():
    """Install a FakeCalendarClient via dependency override; yield it for config."""
    fake = FakeCalendarClient()
    app.dependency_overrides[get_calendar_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_calendar_client, None)


class FakeSendGrid:
    """Stand-in for SendGridClient. `configured=False` -> the SIMULATED path;
    `configured=True` + `fail=True` -> send() raises (FAILED path)."""

    def __init__(self) -> None:
        self.configured = False
        self.fail = False
        self.sent: list = []

    async def send(self, msg) -> None:
        self.sent.append(msg)
        if self.fail:
            raise RuntimeError("sendgrid boom")


@pytest.fixture
def fake_sendgrid():
    """Opt-in: install a FakeSendGrid. Without it, the real client sees an empty
    API key and takes the SIMULATED path (no network) — fine for booking tests."""
    fake = FakeSendGrid()
    app.dependency_overrides[get_sendgrid_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_sendgrid_client, None)


class _RecordCollector(logging.Handler):
    """Installed once, at import time, directly on the `app` logger. Bypasses
    pytest's logging plumbing and works from the TestClient portal thread."""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


_APP_LOG_COLLECTOR = _RecordCollector()
_app_logger = logging.getLogger("app")
_app_logger.addHandler(_APP_LOG_COLLECTOR)
_app_logger.setLevel(logging.DEBUG)


@pytest.fixture
def app_logs():
    """Per-test view of `app.*` log records, cleared at setup."""
    _APP_LOG_COLLECTOR.records.clear()
    yield _APP_LOG_COLLECTOR.records
    _APP_LOG_COLLECTOR.records.clear()
