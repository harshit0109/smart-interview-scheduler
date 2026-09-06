"""Send reminder emails for interviews starting within the reminder window.

    python -m scripts.send_reminders [--hours 24]

Idempotent: an event that already has a REMINDER notification_logs row is
skipped. Run from cron — there is no in-app scheduler (Phase 9, item 1).
"""

import argparse
import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.models import (
    InterviewEvent,
    InterviewParticipant,
    NotificationLog,
    User,
)
from app.notifications import service as notifications_service
from app.notifications.client import get_sendgrid_client


async def process_due_reminders(db: AsyncSession, *, hours: int) -> int:
    """Send a REMINDER for every CONFIRMED event starting within `hours` that has
    no REMINDER row yet. Returns the count processed. Safe to run repeatedly."""
    client = get_sendgrid_client()
    now = datetime.now(UTC)
    horizon = now + timedelta(hours=hours)

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
        status = await notifications_service.send_lifecycle_notification(
            db,
            event,
            notification_type="REMINDER",
            candidate_email=candidate.email,
            panelist_emails=panelists,
            reason=None,
            client=client,
        )
        print(f"reminder event={event.id} to={candidate.email} status={status}")
        processed += 1
    return processed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=24, help="reminder window (hours ahead)")
    args = parser.parse_args()

    async def _go() -> int:
        async with SessionLocal() as db:
            return await process_due_reminders(db, hours=args.hours)

    print(f"{asyncio.run(_go())} reminder(s) processed")


if __name__ == "__main__":
    main()
