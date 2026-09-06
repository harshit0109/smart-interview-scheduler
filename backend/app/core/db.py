"""Async SQLAlchemy engine.

Phase 1: connection only, no models and no tables. The ORM models and the
session dependency arrive in Phase 2.
"""

from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
