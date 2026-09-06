"""Direct DB access for notification_logs (owned by this module)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import NotificationLog


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
