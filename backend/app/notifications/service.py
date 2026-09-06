"""Booking-confirmation dispatch.

`send_booking_confirmation` is called by the booking service *after* the booking
commit. It never raises: whatever happens, it writes exactly one CONFIRMATION
row (SENT / FAILED / SIMULATED) and commits it. The booking's success is already
durable and is unaffected.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import InterviewEvent
from app.notifications import repository
from app.notifications.client import EmailMessage, SendGridClient

logger = logging.getLogger("app.notifications")


def _build_message(
    event: InterviewEvent, candidate_email: str, panelist_emails: list[str], round_type: str
) -> EmailMessage:
    start = event.start_time.strftime("%A %d %B %Y, %H:%M UTC")
    link = event.meeting_link or "(a meeting link will follow separately)"
    body = (
        "Your interview is confirmed.\n\n"
        f"Round: {round_type.title()}\n"
        f"When:  {start}\n"
        f"Join:  {link}\n\n"
        "This time is also on the interviewers' calendars.\n"
    )
    return EmailMessage(
        to=candidate_email,
        cc=list(panelist_emails),
        subject=f"Interview confirmed — {round_type.title()} round",
        text_body=body,
    )


async def send_booking_confirmation(
    db: AsyncSession,
    event: InterviewEvent,
    *,
    candidate_email: str,
    panelist_emails: list[str],
    round_type: str,
    client: SendGridClient,
) -> str:
    """Return the recorded status. Guaranteed to write exactly one row + commit."""
    msg = _build_message(event, candidate_email, panelist_emails, round_type)

    if not client.configured:
        status = "SIMULATED"
        logger.info(
            "notification.simulated event_id=%s to=%s subject=%r body=%r",
            event.id, msg.to, msg.subject, msg.text_body,
        )
    else:
        try:
            await client.send(msg)
            status = "SENT"
            logger.info("notification.sent event_id=%s to=%s", event.id, msg.to)
        except Exception as exc:  # noqa: BLE001 - a send failure must not break booking
            status = "FAILED"
            logger.warning(
                "notification.failed event_id=%s to=%s: %s",
                event.id, msg.to, type(exc).__name__,
            )

    await repository.insert(
        db,
        interview_event_id=event.id,
        channel="EMAIL",
        notification_type="CONFIRMATION",
        recipient=msg.to,
        status=status,
    )
    await db.commit()
    return status
