"""Calendar connection lifecycle + free/busy retrieval.

The only place that decides CONNECTED / EXPIRED / REVOKED / DISCONNECTED
transitions (CODING_GUIDELINES.md §OAuth Architecture). Decrypted tokens exist
only as locals here and are handed straight to the client seam.
"""

import hashlib
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.calendar import repository, schemas
from app.calendar.client import (
    BusyInterval,
    CalendarAuthError,
    CalendarEvent,
    CalendarTransportError,
    GoogleCalendarClient,
    TokenBundle,
)
from app.core import security
from app.core.audit import record_audit
from app.core.config import settings
from app.core.crypto import decrypt, encrypt
from app.core.errors import (
    CalendarConnectionExpiredError,
    CalendarConnectionRevokedError,
    CalendarEventCreationFailedError,
    CalendarSyncFailedError,
    PanelistCalendarNotConnectedError,
)
from app.core.models import CalendarConnection, User
from app.core.redis import redis_client

logger = logging.getLogger("app.calendar")

_EXPIRY_SKEW = timedelta(seconds=60)
_FREEBUSY_TTL_SECONDS = 900  # 15 minutes (DB_DESIGN.md §Redis)


class CalendarStateError(Exception):
    """Bad / expired OAuth `state`, or the user is not allowed to connect."""


# ------------------------------------------------------------------- connect ----


def start_connect(user: User, client: GoogleCalendarClient) -> str:
    state = security.create_calendar_state_token(user.id, settings.calendar_state_ttl_seconds)
    return client.authorization_url(state)


async def complete_callback(
    db: AsyncSession, *, code: str, state: str, client: GoogleCalendarClient
) -> None:
    try:
        payload = security.decode_token(state, "calendar_state")
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError) as exc:
        raise CalendarStateError("invalid or expired state") from exc

    user = await db.get(User, user_id)
    if user is None or user.role not in ("ADMIN", "PANELIST"):
        raise CalendarStateError("user may not connect a calendar")

    bundle: TokenBundle = await client.exchange_code(code)  # CalendarAuth/TransportError -> router

    conn = await repository.upsert_connected(
        db,
        user_id=user_id,
        access_token_encrypted=encrypt(bundle.access_token),
        refresh_token_encrypted=encrypt(bundle.refresh_token) if bundle.refresh_token else None,
        token_expires_at=datetime.now(UTC) + timedelta(seconds=bundle.expires_in),
        scopes_granted=bundle.scope,
    )
    await record_audit(
        db,
        actor_id=user_id,
        actor_role=user.role,
        action="CALENDAR_CONNECTED",
        entity_type="calendar_connection",
        entity_id=conn.id,
        metadata={"scopes_granted": bundle.scope},  # scopes only — never tokens
    )
    await db.commit()
    logger.info("calendar.connected user_id=%s", user_id)


async def get_status(db: AsyncSession, user: User) -> schemas.CalendarStatusResponse:
    conn = await repository.get_by_user(db, user.id)
    if conn is None:
        return schemas.CalendarStatusResponse(status="DISCONNECTED", last_synced_at=None)
    return schemas.CalendarStatusResponse(status=conn.status, last_synced_at=conn.last_synced_at)


# ------------------------------------------------------- usability / refresh ----


async def ensure_usable(
    db: AsyncSession, conn: CalendarConnection, client: GoogleCalendarClient, *, panelist_email: str
) -> CalendarConnection:
    """Return a CONNECTED connection or raise a specific 424 — never a guess.

    The three terminal 424s are kept distinct per API_DESIGN.md / requirements.md
    §9d: NOT_CONNECTED (no usable grant), REVOKED (Google rejected the refresh
    token), EXPIRED (grant lapsed with no refresh token to retry). An access
    token that has merely lapsed but is refreshable is handled silently below and
    is never surfaced.
    """
    if conn.status == "REVOKED":
        raise CalendarConnectionRevokedError(
            f"Panelist {panelist_email} must reconnect their Google Calendar (access revoked)"
        )
    if conn.status == "DISCONNECTED":
        raise PanelistCalendarNotConnectedError(
            f"Panelist {panelist_email} has not connected their Google Calendar"
        )

    near_expiry = (
        conn.token_expires_at is not None
        and conn.token_expires_at <= datetime.now(UTC) + _EXPIRY_SKEW
    )
    if conn.status == "EXPIRED" or near_expiry:
        return await _refresh(db, conn, client, panelist_email=panelist_email)
    return conn


async def _refresh(
    db: AsyncSession, conn: CalendarConnection, client: GoogleCalendarClient, *, panelist_email: str
) -> CalendarConnection:
    if not conn.refresh_token_encrypted:
        # Grant lapsed with nothing to refresh from — expired, not revoked.
        await repository.set_status(db, conn, "EXPIRED")
        await db.commit()
        raise CalendarConnectionExpiredError(
            f"Panelist {panelist_email} must reconnect their Google Calendar (session expired)"
        )
    try:
        bundle = await client.refresh(decrypt(conn.refresh_token_encrypted))
    except CalendarAuthError:
        await repository.set_status(db, conn, "REVOKED")
        await db.commit()
        logger.warning("calendar.refresh_revoked user_id=%s", conn.user_id)
        raise CalendarConnectionRevokedError(
            f"Panelist {panelist_email} must reconnect their Google Calendar (refresh rejected)"
        ) from None
    except CalendarTransportError as exc:
        raise CalendarSyncFailedError() from exc

    await repository.update_access_token(
        db,
        conn,
        access_token_encrypted=encrypt(bundle.access_token),
        token_expires_at=datetime.now(UTC) + timedelta(seconds=bundle.expires_in),
    )
    await db.commit()
    return conn


# ----------------------------------------------------------------- free/busy ---


def _cache_key(user_id: uuid.UUID, time_min: datetime, time_max: datetime) -> str:
    digest = hashlib.sha256(
        f"{time_min.isoformat()}|{time_max.isoformat()}".encode()
    ).hexdigest()[:16]
    return f"freebusy:{user_id}:{digest}"


async def get_free_busy(
    conn: CalendarConnection,
    time_min: datetime,
    time_max: datetime,
    client: GoogleCalendarClient,
) -> list[BusyInterval]:
    key = _cache_key(conn.user_id, time_min, time_max)
    try:
        cached = await redis_client.get(key)
    except Exception:  # noqa: BLE001 - losing Redis is a perf hit, never correctness
        cached = None
    if cached:
        return [
            BusyInterval(
                start=datetime.fromisoformat(b["start"]), end=datetime.fromisoformat(b["end"])
            )
            for b in json.loads(cached)
        ]

    try:
        busy = await client.free_busy(
            decrypt(conn.access_token_encrypted or ""), time_min, time_max
        )
    except (CalendarAuthError, CalendarTransportError) as exc:
        raise CalendarSyncFailedError() from exc

    try:
        await redis_client.set(
            key,
            json.dumps([{"start": b.start.isoformat(), "end": b.end.isoformat()} for b in busy]),
            ex=_FREEBUSY_TTL_SECONDS,
        )
    except Exception:  # noqa: BLE001
        pass
    return busy


# ---------------------------------------------------------------- event ops -----


def access_token_of(conn: CalendarConnection) -> str:
    """Decrypt a connection's access token. Call it while `conn` is still loaded
    (before any rollback) and hold the result as a local — never re-read the row
    in a failure path."""
    return decrypt(conn.access_token_encrypted or "")


async def create_event(
    access_token: str,
    client: GoogleCalendarClient,
    *,
    summary: str,
    description: str,
    start: datetime,
    end: datetime,
    attendee_emails: list[str],
) -> CalendarEvent:
    """Create the booked event. Raises CalendarEventCreationFailedError (502) on
    any Google failure after retries."""
    try:
        return await client.create_event(
            access_token,
            summary=summary,
            description=description,
            start=start,
            end=end,
            attendee_emails=attendee_emails,
        )
    except (CalendarAuthError, CalendarTransportError) as exc:
        raise CalendarEventCreationFailedError() from exc


async def delete_event(
    access_token: str, client: GoogleCalendarClient, event_id: str
) -> bool:
    """Best-effort delete for the compensating action. Returns True if the event
    is gone, False if the delete could not be completed."""
    try:
        await client.delete_event(access_token, event_id)
        return True
    except (CalendarAuthError, CalendarTransportError):
        return False
