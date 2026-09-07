"""Direct DB access for interview_events / reconciliation_tasks (owned here)."""

import uuid
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import (
    InterviewEvent,
    InterviewParticipant,
    RecommendationRun,
    RecommendedSlot,
    ReconciliationTask,
    User,
)


async def get_slot_with_run(
    db: AsyncSession, slot_id: uuid.UUID
) -> RecommendedSlot | None:
    return await db.scalar(
        select(RecommendedSlot)
        .where(RecommendedSlot.id == slot_id)
        .options(selectinload(RecommendedSlot.run))
    )


async def latest_run_id(
    db: AsyncSession, interview_request_id: uuid.UUID
) -> uuid.UUID | None:
    return await db.scalar(
        select(RecommendationRun.id)
        .where(RecommendationRun.interview_request_id == interview_request_id)
        .order_by(RecommendationRun.generated_at.desc())
        .limit(1)
    )


async def get_confirmed_event(
    db: AsyncSession, interview_request_id: uuid.UUID
) -> InterviewEvent | None:
    return await db.scalar(
        select(InterviewEvent).where(
            InterviewEvent.interview_request_id == interview_request_id,
            InterviewEvent.status == "CONFIRMED",
        )
    )


async def participants_with_users(
    db: AsyncSession, interview_request_id: uuid.UUID
) -> list[tuple[InterviewParticipant, User]]:
    rows = await db.execute(
        select(InterviewParticipant, User)
        .join(User, User.id == InterviewParticipant.user_id)
        .where(InterviewParticipant.interview_request_id == interview_request_id)
    )
    return list(rows.all())


async def confirmed_events_for_users(
    db: AsyncSession,
    user_ids: list[uuid.UUID],
    *,
    exclude_request_id: uuid.UUID,
    overlaps_start: datetime | None = None,
    overlaps_end: datetime | None = None,
) -> list[tuple[uuid.UUID, datetime, datetime]]:
    """`(user_id, start, end)` for every CONFIRMED interview_event whose request
    has one of `user_ids` as a participant, excluding `exclude_request_id`.

    Used both to feed the scheduler each panelist's real internal commitments and
    to guard booking against double-booking a shared participant. When
    `overlaps_start`/`overlaps_end` are given, only rows that time-overlap that
    window are returned (half-open: `start < window_end AND window_start < end`).
    """
    if not user_ids:
        return []
    stmt = (
        select(InterviewParticipant.user_id, InterviewEvent.start_time, InterviewEvent.end_time)
        .join(
            InterviewEvent,
            InterviewEvent.interview_request_id == InterviewParticipant.interview_request_id,
        )
        .where(
            InterviewParticipant.user_id.in_(user_ids),
            InterviewParticipant.interview_request_id != exclude_request_id,
            InterviewEvent.status == "CONFIRMED",
        )
    )
    if overlaps_start is not None and overlaps_end is not None:
        stmt = stmt.where(
            and_(
                InterviewEvent.start_time < overlaps_end,
                overlaps_start < InterviewEvent.end_time,
            )
        )
    rows = await db.execute(stmt)
    return [(uid, s, e) for uid, s, e in rows.all()]


async def insert_interview_event(
    db: AsyncSession,
    *,
    interview_request_id: uuid.UUID,
    start,
    end,
    calendar_event_id: str,
    meeting_link: str | None,
    provider: str = "GOOGLE",
) -> InterviewEvent:
    event = InterviewEvent(
        interview_request_id=interview_request_id,
        start_time=start,
        end_time=end,
        calendar_event_id=calendar_event_id,
        meeting_link=meeting_link,
        provider=provider,
        status="CONFIRMED",
    )
    db.add(event)
    await db.flush()
    return event


async def create_reconciliation_task(
    db: AsyncSession,
    *,
    external_calendar_event_id: str,
    reason: str,
    metadata: dict,
    interview_event_id: uuid.UUID | None = None,
    commit: bool = True,
) -> ReconciliationTask:
    task = ReconciliationTask(
        interview_event_id=interview_event_id,
        external_calendar_event_id=external_calendar_event_id,
        reason=reason,
        status="OPEN",
        task_metadata=metadata,
    )
    db.add(task)
    if commit:
        await db.commit()  # Phase 7 compensation runs after a rollback — needs its own commit
    else:
        await db.flush()  # Phase 9 lifecycle is mid-transaction; caller commits
    return task
