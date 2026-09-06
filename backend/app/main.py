"""FastAPI application entrypoint.

Infra `GET /health` (unversioned) + the versioned `/api/v1` API. Domain modules
are mounted as they are built, phase by phase.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.auth.router import router as auth_router
from app.availability.router import router as availability_router
from app.calendar.router import router as calendar_router
from app.core.db import engine
from app.core.errors import register_exception_handlers
from app.core.redis import redis_client
from app.interviews.router import router as interviews_router
from app.scheduling.router import router as scheduling_router
from app.users.router import router as users_router

logger = logging.getLogger(__name__)

API_V1 = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await engine.dispose()
    await redis_client.aclose()


app = FastAPI(title="Smart Interview Scheduler", version="0.1.0", lifespan=lifespan)
register_exception_handlers(app)
app.include_router(auth_router, prefix=API_V1)
app.include_router(users_router, prefix=API_V1)
app.include_router(interviews_router, prefix=API_V1)
app.include_router(availability_router, prefix=API_V1)
app.include_router(calendar_router, prefix=API_V1)
app.include_router(scheduling_router, prefix=API_V1)


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
