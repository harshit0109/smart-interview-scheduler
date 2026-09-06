"""User read-side helpers. No mutations live here — registration is app/auth/."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import User


async def list_by_role(db: AsyncSession, role: str) -> list[User]:
    """Directory lookup for the ADMIN interview-creation flow (FR-012): the only
    way a client can resolve candidate / panelist ids and names. Ordered by name
    so the frontend can render a stable picker."""
    rows = await db.scalars(
        select(User).where(User.role == role).order_by(User.name, User.id)
    )
    return list(rows)
