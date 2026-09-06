"""Short-lived Redis mutex for the booking critical section.

`SET key token NX EX ttl` to acquire; a token-guarded Lua GET+DEL to release so a
slow holder can never delete a later holder's lock. Losing Redis degrades to
"proceed without the lock" — correctness then rests on the DB-level partial
unique index (DB_DESIGN.md §Concurrency Strategy), never on Redis.
"""

import logging
import uuid
from contextlib import asynccontextmanager

from app.core.redis import redis_client

logger = logging.getLogger("app.core.locks")

_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] "
    "then return redis.call('del', KEYS[1]) else return 0 end"
)


class LockNotAcquired(Exception):
    """The lock is currently held by someone else."""


@asynccontextmanager
async def redis_lock(key: str, ttl_seconds: int = 10):
    token = uuid.uuid4().hex
    held = False
    try:
        try:
            held = bool(await redis_client.set(key, token, nx=True, ex=ttl_seconds))
        except Exception as exc:  # noqa: BLE001 - Redis down is a perf/UX hit, not correctness
            logger.warning(
                "redis_lock: Redis unavailable, proceeding without lock (%s): %s", key, exc
            )
            held = None  # degraded: no lock, DB unique index is the guard
        if held is False:
            raise LockNotAcquired(key)
        yield
    finally:
        if held:
            try:
                await redis_client.eval(_RELEASE_LUA, 1, key, token)
            except Exception:  # noqa: BLE001
                pass  # 10s TTL will clean it up
