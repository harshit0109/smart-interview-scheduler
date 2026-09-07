"""Send reminder emails for interviews starting within the reminder window.

    python -m scripts.send_reminders [--minutes N]

Default window is INTERVIEW_REMINDER_MINUTES_BEFORE (config, default 15).
Idempotent: an event that already has a REMINDER notification_logs row is
skipped. Run from cron / a scheduled task — there is no in-app scheduler.
"""

import argparse
import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.models import (
    InterviewEvent,
    InterviewParticipant,
    InterviewRequest,
    NotificationLog,
    User,
)
from app.notifications import service as notifications_service
from app.notifications.client import get_sendgrid_client


async def process_due_reminders(db: AsyncSession, *, minutes: int) -> int:
    """Send a REMINDER for every CONFIRMED event starting within `minutes` that
    has no REMINDER row yet. Returns the count processed. Safe to run repeatedly.
    """
    client = get_sendgrid_client()
    now = datetime.now(UTC)
    horizon = now + timedelta(minutes=minutes)

    already = select(NotificationLog.interview_event_id).where(
        NotificationLog.notification_type == "REMINDER"
    )
    events = list(
        await db.scalars(
            select(InterviewEvent).where(
                InterviewEvent.status == "CONFIRMED",
                InterviewEvent.start_time > now,
                InterviewEvent.start_time <= horizon,
                InterviewEvent.id.not_in(already),
            )
        )
    )
    processed = 0
    for event in events:
        rows = (
            await db.execute(
                select(InterviewParticipant, User)
                .join(User, User.id == InterviewParticipant.user_id)
                .where(
                    InterviewParticipant.interview_request_id == event.interview_request_id
                )
            )
        ).all()
        candidate = next(u for p, u in rows if p.role_in_interview == "CANDIDATE")
        panelists = [u.email for p, u in rows if p.role_in_interview == "PANELIST"]
        request = await db.get(InterviewRequest, event.interview_request_id)
        status = await notifications_service.send_lifecycle_notification(
            db,
            event,
            notification_type="REMINDER",
            candidate_email=candidate.email,
            panelist_emails=panelists,
            reason=None,
            client=client,
            title=request.title if request else None,
            company=request.company if request else None,
            round_type=request.round_type if request else None,
        )
        print(f"reminder event={event.id} to={candidate.email} status={status}")
        processed += 1
    return processed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--minutes",
        type=int,
        default=settings.interview_reminder_minutes_before,
        help="reminder window (minutes ahead of the interview start)",
    )
    args = parser.parse_args()

    async def _go() -> int:
        async with SessionLocal() as db:
            return await process_due_reminders(db, minutes=args.minutes)

    print(f"{asyncio.run(_go())} reminder(s) processed")


if __name__ == "__main__":
    main()
