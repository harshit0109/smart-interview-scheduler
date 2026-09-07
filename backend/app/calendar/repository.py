"""Direct DB access for `calendar_connections` (owned by the calendar module)."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import CalendarConnection


async def get_by_user(
    db: AsyncSession, user_id: uuid.UUID, provider: str = "GOOGLE"
) -> CalendarConnection | None:
    return await db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user_id,
            CalendarConnection.provider == provider,
        )
    )


async def statuses_by_user(
    db: AsyncSession, user_ids: list[uuid.UUID], provider: str = "GOOGLE"
) -> dict[uuid.UUID, str]:
    """`{user_id: status}` for every user in `user_ids` that has a connection
    row. Users with no row are simply absent from the dict. One query — used to
    show per-panelist calendar connection state on the interview detail."""
    if not user_ids:
        return {}
    rows = await db.execute(
        select(CalendarConnection.user_id, CalendarConnection.status).where(
            CalendarConnection.user_id.in_(user_ids),
            CalendarConnection.provider == provider,
        )
    )
    return {uid: status for uid, status in rows.all()}


async def upsert_connected(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    access_token_encrypted: str,
    refresh_token_encrypted: str | None,
    token_expires_at: datetime,
    scopes_granted: str,
    provider: str = "GOOGLE",
) -> CalendarConnection:
    conn = await get_by_user(db, user_id, provider)
    if conn is None:
        conn = CalendarConnection(user_id=user_id, provider=provider)
        db.add(conn)
    conn.status = "CONNECTED"
    conn.access_token_encrypted = access_token_encrypted
    if refresh_token_encrypted is not None:
        conn.refresh_token_encrypted = refresh_token_encrypted
    conn.token_expires_at = token_expires_at
    conn.scopes_granted = scopes_granted
    await db.flush()
    return conn


async def set_status(db: AsyncSession, conn: CalendarConnection, status: str) -> None:
    conn.status = status
    await db.flush()


async def update_access_token(
    db: AsyncSession,
    conn: CalendarConnection,
    *,
    access_token_encrypted: str,
    token_expires_at: datetime,
) -> None:
    conn.access_token_encrypted = access_token_encrypted
    conn.token_expires_at = token_expires_at
    conn.status = "CONNECTED"
    await db.flush()
