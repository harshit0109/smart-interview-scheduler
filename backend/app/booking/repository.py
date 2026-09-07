"""Direct DB access for interview_events / reconciliation_tasks (owned here)."""

import uuid

from sqlalchemy import select
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
