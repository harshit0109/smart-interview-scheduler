"""Candidate availability orchestration: ownership, state gate, atomic persist, audit."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.availability import repository, schemas
from app.core.audit import record_audit
from app.core.errors import (
    ForbiddenError,
    NotFoundError,
    RequestNotAwaitingAvailabilityError,
)
from app.core.models import CandidateAvailability, InterviewRequest, User

AWAITING = "AWAITING_CANDIDATE_AVAILABILITY"
READY = "READY_FOR_SCHEDULING"


def _to_out(row: CandidateAvailability) -> schemas.AvailabilityOut:
    return schemas.AvailabilityOut(
        id=row.id,
        interview_request_id=row.interview_request_id,
        candidate_id=row.candidate_id,
        timezone=row.timezone,
        submitted_at=row.submitted_at,
        windows=[
            schemas.WindowOut(start_time=w.start_time, end_time=w.end_time)
            for w in row.windows
        ],
    )


async def submit(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    data: schemas.SubmitAvailabilityRequest,
) -> schemas.AvailabilityOut:
    request = await db.get(InterviewRequest, request_id)
    if request is None:
        raise NotFoundError("interview request not found")
    if actor.id != request.candidate_id:
        raise ForbiddenError("only the request's own candidate may submit availability")
    if request.status != AWAITING:
        raise RequestNotAwaitingAvailabilityError()

    row = await repository.create(
        db,
        interview_request_id=request.id,
        candidate_id=actor.id,
        timezone=data.timezone,
        windows=[(w.start_time, w.end_time) for w in data.windows],
    )
    request.status = READY
    await record_audit(
        db,
        actor_id=actor.id,
        actor_role=actor.role,
        action="CANDIDATE_AVAILABILITY_SUBMITTED",
        entity_type="interview_request",
        entity_id=request.id,
        metadata={"window_count": len(data.windows), "timezone": data.timezone},
    )
    await db.commit()
    await db.refresh(row, ["windows"])
    return _to_out(row)


async def get_availability(
    db: AsyncSession, viewer: User, request_id: uuid.UUID
) -> schemas.AvailabilityOut:
    request = await db.get(InterviewRequest, request_id)
    if request is None:
        raise NotFoundError("availability not found")
    # ADMIN or the owning candidate only; anyone else gets 404 (API_DESIGN.md).
    if viewer.role != "ADMIN" and viewer.id != request.candidate_id:
        raise NotFoundError("availability not found")

    row = await repository.get_latest(db, request_id)
    if row is None:
        raise NotFoundError("availability not found")
    return _to_out(row)
