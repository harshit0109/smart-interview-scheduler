"""Direct DB access for interview_requests / interview_participants."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import InterviewParticipant, InterviewRequest, User

_WITH_PARTICIPANTS = selectinload(InterviewRequest.participants)


async def get_users(db: AsyncSession, ids: Sequence[uuid.UUID]) -> list[User]:
    if not ids:
        return []
    return list(await db.scalars(select(User).where(User.id.in_(ids))))


async def get(db: AsyncSession, request_id: uuid.UUID) -> InterviewRequest | None:
    return await db.scalar(
        select(InterviewRequest)
        .where(InterviewRequest.id == request_id)
        .options(_WITH_PARTICIPANTS)
    )


async def create(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    created_by: uuid.UUID,
    round_type: str,
    duration_minutes: int,
    buffer_minutes: int,
    panelist_ids: Sequence[uuid.UUID],
    status: str,
) -> InterviewRequest:
    request = InterviewRequest(
        candidate_id=candidate_id,
        created_by=created_by,
        round_type=round_type,
        duration_minutes=duration_minutes,
        buffer_minutes=buffer_minutes,
        status=status,
        participants=[
            InterviewParticipant(user_id=candidate_id, role_in_interview="CANDIDATE"),
            *(
                InterviewParticipant(user_id=pid, role_in_interview="PANELIST")
                for pid in panelist_ids
            ),
        ],
    )
    db.add(request)
    await db.flush()
    return request


async def replace_panelists(
    db: AsyncSession, request: InterviewRequest, panelist_ids: Sequence[uuid.UUID]
) -> None:
    request.participants = [
        p for p in request.participants if p.role_in_interview == "CANDIDATE"
    ] + [
        InterviewParticipant(user_id=pid, role_in_interview="PANELIST")
        for pid in panelist_ids
    ]
    await db.flush()


async def list_for_viewer(
    db: AsyncSession,
    *,
    viewer_id: uuid.UUID,
    is_admin: bool,
    status: str | None,
    offset: int,
    limit: int,
) -> tuple[list[InterviewRequest], int]:
    filters = []
    if status is not None:
        filters.append(InterviewRequest.status == status)
    if not is_admin:
        visible = select(InterviewParticipant.interview_request_id).where(
            InterviewParticipant.user_id == viewer_id
        )
        filters.append(InterviewRequest.id.in_(visible))

    total = await db.scalar(
        select(func.count()).select_from(InterviewRequest).where(*filters)
    )
    rows = await db.scalars(
        select(InterviewRequest)
        .where(*filters)
        .options(_WITH_PARTICIPANTS)
        .order_by(InterviewRequest.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(rows), int(total or 0)
