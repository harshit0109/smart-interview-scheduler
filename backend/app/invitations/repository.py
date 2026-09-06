"""Direct DB access for `participant_invitations` (owned by this module)."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import InterviewParticipant, ParticipantInvitation


async def get_for_request_user(
    db: AsyncSession, request_id: uuid.UUID, user_id: uuid.UUID
) -> ParticipantInvitation | None:
    return await db.scalar(
        select(ParticipantInvitation).where(
            ParticipantInvitation.interview_request_id == request_id,
            ParticipantInvitation.user_id == user_id,
        )
    )


async def get_by_token_hash(db: AsyncSession, token_hash: str) -> ParticipantInvitation | None:
    return await db.scalar(
        select(ParticipantInvitation).where(ParticipantInvitation.token_hash == token_hash)
    )


async def list_for_request(
    db: AsyncSession, request_id: uuid.UUID
) -> list[ParticipantInvitation]:
    rows = await db.scalars(
        select(ParticipantInvitation)
        .where(ParticipantInvitation.interview_request_id == request_id)
        .order_by(ParticipantInvitation.role, ParticipantInvitation.created_at)
    )
    return list(rows)


async def get_participant(
    db: AsyncSession, request_id: uuid.UUID, user_id: uuid.UUID
) -> InterviewParticipant | None:
    return await db.scalar(
        select(InterviewParticipant).where(
            InterviewParticipant.interview_request_id == request_id,
            InterviewParticipant.user_id == user_id,
        )
    )


def apply(
    row: ParticipantInvitation | None,
    *,
    request_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
    token_hash: str,
    requires_account_setup: bool,
    expires_at: datetime,
) -> ParticipantInvitation:
    """Build a fresh row, or rotate an existing one in place (the resend path —
    new token, reset status/response, same DB row per the unique
    (request_id, user_id) constraint). Caller flushes; caller `db.add()`s a new
    row (this function never touches the session)."""
    if row is None:
        return ParticipantInvitation(
            interview_request_id=request_id,
            user_id=user_id,
            role=role,
            token_hash=token_hash,
            status="PENDING",
            requires_account_setup=requires_account_setup,
            expires_at=expires_at,
            send_count=0,
        )
    row.token_hash = token_hash
    row.status = "PENDING"
    row.requires_account_setup = requires_account_setup
    row.expires_at = expires_at
    row.responded_at = None
    row.response_reason = None
    return row
