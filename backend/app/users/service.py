"""User directory lookup + ADMIN-driven provisioning of unclaimed accounts."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import repository as auth_repo
from app.core.audit import record_audit
from app.core.errors import InvalidParticipantError, NotFoundError, RoleConflictError
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
    so the frontend can render a stable picker. Archived users are excluded — a
    removed candidate should not be selectable for a new interview."""
    rows = await db.scalars(
        select(User)
        .where(User.role == role, User.archived_at.is_(None))
        .order_by(User.name, User.id)
    )
    return list(rows)


async def set_archived(
    db: AsyncSession, *, actor_id: uuid.UUID, user_id: uuid.UUID, archived: bool
) -> User:
    """ADMIN removes / restores a CANDIDATE from the active pipeline. Reversible:
    all interview history and audit rows are kept; the account is just hidden
    from pickers and blocked from new logins while archived (auth/service.login).
    """
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user not found")
    if user.role != "CANDIDATE":
        raise InvalidParticipantError("only a CANDIDATE account can be archived")

    user.archived_at = datetime.now(UTC) if archived else None
    await record_audit(
        db,
        actor_id=actor_id,
        actor_role="ADMIN",
        action="CANDIDATE_ARCHIVED" if archived else "CANDIDATE_UNARCHIVED",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": user.email},
    )
    await db.commit()
    return user
