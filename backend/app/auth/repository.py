"""Direct DB access for the `users` table (owned by the auth module)."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import User


async def get_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == email))


async def count_by_role(db: AsyncSession, role: str) -> int:
    return await db.scalar(
        select(func.count()).select_from(User).where(User.role == role)
    ) or 0


async def get_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def create(
    db: AsyncSession,
    *,
    email: str,
    name: str,
    role: str,
    auth_provider: str,
    timezone: str = "UTC",
    password_hash: str | None = None,
) -> User:
    user = User(
        email=email,
        name=name,
        role=role,
        auth_provider=auth_provider,
        timezone=timezone,
        password_hash=password_hash,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user
