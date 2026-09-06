"""Shared test fixtures.

Tests run against the DATABASE_URL Postgres (the docker-compose / CI instance).
The schema is created once via the real Alembic migrations; tables are truncated
between tests. Note: this wipes data in whatever DB DATABASE_URL points at —
point it at a throwaway database, not a populated one.
"""

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.core.security import create_access_token
from app.main import app


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
            async with eng.begin() as conn:
                await conn.execute(text(sql), params or {})
            await eng.dispose()

        asyncio.run(_go())

    return _exec


@pytest.fixture
def make_user():
    """Factory: insert a user of the given role directly, return id/email/role/token/headers."""

    def _make(role: str, email: str | None = None) -> SimpleNamespace:
        email = email or f"{role.lower()}-{uuid.uuid4().hex[:8]}@example.com"

        async def _insert() -> uuid.UUID:
            eng = create_async_engine(settings.database_url)
            async with eng.begin() as conn:
                uid = await conn.scalar(
                    text(
                        "INSERT INTO users (email, name, role, auth_provider) "
                        "VALUES (:e, :n, :r, 'PASSWORD') RETURNING id"
                    ),
                    {"e": email, "n": email, "r": role},
                )
            await eng.dispose()
            return uid

        uid = asyncio.run(_insert())
        token = create_access_token(uid, role)
        return SimpleNamespace(
            id=uid,
            email=email,
            role=role,
            token=token,
            headers={"Authorization": f"Bearer {token}"},
        )

    return _make
