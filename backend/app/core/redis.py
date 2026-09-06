"""Async Redis client.

Phase 1: connection only. Booking lock, free/busy cache and rate-limit buckets
(DB_DESIGN.md Redis Design) are added in the phases that use them.
"""

from redis.asyncio import Redis

from app.core.config import settings

redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
