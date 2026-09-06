"""FastAPI application entrypoint.

Phase 1 (Foundation & Infrastructure): an empty app exposing only an
infrastructure health check. No business logic, no auth, no domain routes.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.core.db import engine
from app.core.redis import redis_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await engine.dispose()
    await redis_client.aclose()


app = FastAPI(title="Smart Interview Scheduler", version="0.1.0", lifespan=lifespan)


async def _check_database() -> str:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok"
    except Exception as exc:
        logger.warning("health: database check failed: %s", exc)
        return "error"


async def _check_redis() -> str:
    try:
        await redis_client.ping()
        return "ok"
    except Exception as exc:
        logger.warning("health: redis check failed: %s", exc)
        return "error"


@app.get("/health", tags=["infra"])
async def health() -> dict:
    """Infrastructure liveness/readiness. Not part of the /api/v1 contract."""
    checks = {"database": await _check_database(), "redis": await _check_redis()}
    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "checks": checks}
