"""Direct DB access for candidate_availability / availability_windows."""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import AvailabilityWindow, CandidateAvailability


async def create(
    db: AsyncSession,
    *,
    interview_request_id: uuid.UUID,
    candidate_id: uuid.UUID,
    timezone: str,
    windows: Sequence[tuple[datetime, datetime]],
) -> CandidateAvailability:
    row = CandidateAvailability(
        interview_request_id=interview_request_id,
        candidate_id=candidate_id,
        timezone=timezone,
        windows=[
            AvailabilityWindow(start_time=start, end_time=end) for start, end in windows
        ],
    )
    db.add(row)
    await db.flush()
    return row


async def get_latest(
    db: AsyncSession, interview_request_id: uuid.UUID
) -> CandidateAvailability | None:
    return await db.scalar(
        select(CandidateAvailability)
        .where(CandidateAvailability.interview_request_id == interview_request_id)
        .order_by(CandidateAvailability.submitted_at.desc())
        .options(selectinload(CandidateAvailability.windows))
        .limit(1)
    )
