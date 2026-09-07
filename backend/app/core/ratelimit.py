"""Redis-backed rate limiting — pure ASGI middleware (Phase 11).

Spec: API_DESIGN.md §Rate Limiting + DB_DESIGN.md §Redis Design.

  STRICT   10/min  public (unauthenticated) endpoints + candidate-facing endpoints
  STANDARD 60/min  every other authenticated endpoint
  REC       5/min  POST /interviews/{id}/recommendations   (Google Free/Busy amplification)
  BOOK     10/min  POST /interviews/{id}/{book,reschedule,decline,cancel}
  INVITE   10/min  POST /interviews/{id}/invitations       (issuance/resend, real email sends)

Fixed-window counter via one atomic Lua script (INCR + first-hit EXPIRE) — O(1)
and correct across multiple backend instances (single Redis authority).

Redis failure -> FAIL OPEN (log a warning, allow the request). Consistent with
app/core/locks.py and app/calendar/service.py: losing Redis is a performance/UX
hit, never a correctness one (DB_DESIGN.md §Redis Design).

Written as raw ASGI (not starlette BaseHTTPMiddleware) — BaseHTTPMiddleware
buffers the response body and reschedules the endpoint, which races the sync
test client against the async DB. This layer only reads request headers and
rewrites `http.response.start` headers, so raw ASGI is both correct and lighter.

ponytail: fixed-window has a known ~2x burst at the window boundary; acceptable
for abuse control and it is exactly the `ratelimit:{id}:{endpoint}` + 60s-TTL
pattern the spec describes.
"""

import logging
import re
import time
import uuid

import jwt
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.errors import error_body
from app.core.redis import redis_client
from app.core.security import decode_token

logger = logging.getLogger("app.core.ratelimit")

# INCR the counter; on the first hit of a new window, arm the TTL. Return
# (current_count, ttl_seconds). Atomic, so concurrent requests can't race EXPIRE.
_LUA_FIXED_WINDOW = (
    "local n = redis.call('INCR', KEYS[1]) "
    "if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end "
    "local t = redis.call('TTL', KEYS[1]) "
    "return {n, t}"
)

# (method, compiled path pattern, bucket, settings attr for the limit).
# First match wins; order = most specific first. `bucket` keeps a caller's
# strict / standard / rec / book budgets in separate Redis keys.
_RULES: list[tuple[str, re.Pattern[str], str, str]] = [
    ("POST", re.compile(r"/auth/(login|register|google|refresh|bootstrap-admin)"), "strict",
     "rate_limit_strict_per_minute"),
    ("GET", re.compile(r"/calendar/callback"), "strict", "rate_limit_strict_per_minute"),
    ("POST", re.compile(r"/interviews/[^/]+/recommendations"), "rec",
     "rate_limit_recommendations_per_minute"),
    ("POST", re.compile(r"/interviews/[^/]+/(book|reschedule|decline|cancel)"), "book",
     "rate_limit_booking_per_minute"),
    ("POST", re.compile(r"/interviews/[^/]+/invitations"), "invite",
     "rate_limit_invite_per_minute"),
    ("GET", re.compile(r"/invitations/[^/]+"), "strict", "rate_limit_strict_per_minute"),
    ("POST", re.compile(r"/invitations/[^/]+/respond"), "strict",
     "rate_limit_strict_per_minute"),
    ("POST", re.compile(r"/invitations/[^/]+/claim-account"), "strict",
     "rate_limit_strict_per_minute"),
    ("POST", re.compile(r"/interviews/[^/]+/candidate-availability"), "strict",
     "rate_limit_strict_per_minute"),
    # GET reads of interviews / a single interview / its availability do no
    # downstream amplification (no Google, no email) and are hit repeatedly by
    # normal dashboard navigation, so for an authenticated caller they fall
    # through to STANDARD (60/min). Unauthenticated callers still land on STRICT
    # via the default in _rule_for.
]


def _endpoint_path(full_path: str) -> str:
    for prefix in ("/api/v1", "/api"):
        if full_path.startswith(prefix):
            return full_path[len(prefix):] or "/"
    return full_path


def _client_ip(scope: Scope, headers: Headers) -> str:
    if settings.rate_limit_trust_forwarded_for:
        xff = headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    client = scope.get("client")
    return client[0] if client else "unknown"


def _identity(scope: Scope, headers: Headers) -> tuple[str, bool]:
    """Return (redis-identity, is_authenticated). Decodes the access token only —
    never a DB lookup (runs on every request, before routing)."""
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            payload = decode_token(auth.split(" ", 1)[1], "access")
            return f"user:{payload['sub']}", True
        except (jwt.InvalidTokenError, KeyError, ValueError, IndexError):
            pass
    return f"ip:{_client_ip(scope, headers)}", False


def _rule_for(method: str, path: str, is_authenticated: bool) -> tuple[str, int]:
    for rule_method, pattern, bucket, attr in _RULES:
        if method == rule_method and pattern.fullmatch(path):
            return bucket, getattr(settings, attr)
    if is_authenticated:
        return "standard", settings.rate_limit_standard_per_minute
    return "strict", settings.rate_limit_strict_per_minute


async def _incr(key: str, window: int) -> tuple[int, int]:
    result = await redis_client.eval(_LUA_FIXED_WINDOW, 1, key, window)
    return int(result[0]), int(result[1])


def _rejected(limit: int, ttl: int) -> JSONResponse:
    resp = JSONResponse(
        status_code=429,
        content=error_body(
            "RATE_LIMITED",
            "Too many requests. Please slow down and try again shortly.",
            trace_id=uuid.uuid4().hex[:8],
        ),
    )
    resp.headers["Retry-After"] = str(ttl)
    resp.headers["X-RateLimit-Limit"] = str(limit)
    resp.headers["X-RateLimit-Remaining"] = "0"
    resp.headers["X-RateLimit-Reset"] = str(int(time.time()) + ttl)
    return resp


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not settings.rate_limit_enabled:
            await self.app(scope, receive, send)
            return

        method: str = scope["method"]
        path: str = scope["path"]
        # Exempt: CORS preflight, infra/liveness, docs — anything outside the API.
        if method == "OPTIONS" or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        identity, is_authenticated = _identity(scope, headers)
        bucket, limit = _rule_for(method, _endpoint_path(path), is_authenticated)
        window = settings.rate_limit_window_seconds
        key = f"ratelimit:{identity}:{bucket}"

        try:
            count, ttl = await _incr(key, window)
        except Exception as exc:  # noqa: BLE001 - Redis down must not fail requests
            logger.warning("ratelimit: Redis unavailable, allowing request (%s): %s", key, exc)
            await self.app(scope, receive, send)
            return

        if ttl < 0:  # key had no TTL (shouldn't happen) — treat as a fresh window
            ttl = window

        if count > limit:
            logger.info(
                "ratelimit: 429 identity=%s bucket=%s count=%d/%d", identity, bucket, count, limit
            )
            await _rejected(limit, ttl)(scope, receive, send)
            return

        reset = int(time.time()) + ttl
        remaining = str(max(limit - count, 0))

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                mh = MutableHeaders(scope=message)
                mh["X-RateLimit-Limit"] = str(limit)
                mh["X-RateLimit-Remaining"] = remaining
                mh["X-RateLimit-Reset"] = str(reset)
            await send(message)

        await self.app(scope, receive, send_with_headers)
