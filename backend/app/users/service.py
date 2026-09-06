"""User directory lookup + ADMIN-driven provisioning of unclaimed accounts."""

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import repository as auth_repo
from app.core.audit import record_audit
from app.core.errors import RoleConflictError
from app.core.models import User


async def provision(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID,
    email: str,
    name: str,
    role: str,
    timezone: str,
) -> tuple[User, bool]:
    """Create an unclaimed (`password_hash IS NULL`) CANDIDATE/PANELIST account so
    an ADMIN can name it on an interview before the person has signed up.
    Idempotent: an existing user with the same role is returned unchanged; a
    different role is a ROLE_CONFLICT. Returns (user, created).
    """
    existing = await auth_repo.get_by_email(db, email)
    if existing is not None:
        if existing.role != role:
            raise RoleConflictError()
        return existing, False

    try:
        user = await auth_repo.create(
            db,
            email=email,
            name=name,
            role=role,
            auth_provider="PASSWORD",
            timezone=timezone,
            password_hash=None,
        )
        await record_audit(
            db,
            actor_id=actor_id,
            actor_role="ADMIN",
            action="USER_PROVISIONED",
            entity_type="user",
            entity_id=user.id,
            metadata={"email": email, "role": role},
        )
        await db.commit()
    except IntegrityError:  # unique email race
        await db.rollback()
        existing = await auth_repo.get_by_email(db, email)
        if existing is None or existing.role != role:
            raise RoleConflictError() from None
        return existing, False

    return user, True


async def list_by_role(db: AsyncSession, role: str) -> list[User]:
    """Directory lookup for the ADMIN interview-creation flow (FR-012): the only
    way a client can resolve candidate / panelist ids and names. Ordered by name
    so the frontend can render a stable picker."""
    rows = await db.scalars(
        select(User).where(User.role == role).order_by(User.name, User.id)
    )
    return list(rows)
