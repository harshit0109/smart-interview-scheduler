"""Direct DB access for notification_logs (owned by this module)."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import InterviewEvent, NotificationLog


async def list_for_request(
    db: AsyncSession, interview_request_id: uuid.UUID
) -> list[NotificationLog]:
    """Every confirmation / reminder / lifecycle notice written for this
    interview's events, newest first. Invitation delivery lives on its own
    table (participant_invitations) and is surfaced separately."""
    rows = await db.scalars(
        select(NotificationLog)
        .join(InterviewEvent, InterviewEvent.id == NotificationLog.interview_event_id)
        .where(InterviewEvent.interview_request_id == interview_request_id)
        .order_by(NotificationLog.sent_at.desc())
    )
    return list(rows)


async def insert(
    db: AsyncSession,
    *,
    interview_event_id: uuid.UUID,
    channel: str,
    notification_type: str,
    recipient: str,
    status: str,
) -> NotificationLog:
    row = NotificationLog(
        interview_event_id=interview_event_id,
        channel=channel,
        notification_type=notification_type,
        recipient=recipient,
        status=status,
    )
    db.add(row)
    await db.flush()
    return row
