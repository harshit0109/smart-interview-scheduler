"""Shared test fixtures.

Tests run against the DATABASE_URL Postgres (the docker-compose / CI instance).
The schema is created once via the real Alembic migrations; `users` is truncated
between tests. Note: this wipes `users` in whatever DB DATABASE_URL points at —
point it at a throwaway database, not a populated one.
"""

import asyncio

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
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
            await conn.execute(text("TRUNCATE users RESTART IDENTITY CASCADE"))
        await eng.dispose()

    asyncio.run(_truncate())
    yield
