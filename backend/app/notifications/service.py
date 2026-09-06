"""Notification dispatch — booking confirmation (Phase 8) and lifecycle notices
(Phase 9: decline / reschedule / cancellation / reminder).

Callers invoke this *after* their own commit. `_dispatch` never raises: whatever
happens it writes exactly one `notification_logs` row (SENT / FAILED / SIMULATED)
for the given `interview_event_id` and commits it. The triggering action's
success is already durable and is unaffected.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import InterviewEvent
from app.notifications import repository
from app.notifications.client import EmailMessage, SendGridClient

logger = logging.getLogger("app.notifications")

_LIFECYCLE_COPY = {
    "DECLINE": ("Interview needs rescheduling", "an interviewer has declined this time"),
    "RESCHEDULE": ("Interview reschedule requested", "a reschedule has been requested"),
    "CANCELLATION": ("Interview cancelled", "this interview has been cancelled"),
    "REMINDER": ("Interview reminder", "this is a reminder for your upcoming interview"),
}


def _when(event: InterviewEvent) -> str:
    return event.start_time.strftime("%A %d %B %Y, %H:%M UTC")


async def _dispatch(
    db: AsyncSession,
    *,
    interview_event_id,
    notification_type: str,
    msg: EmailMessage,
    client: SendGridClient,
) -> str:
    if not client.configured:
        status = "SIMULATED"
        logger.info(
            "notification.simulated event_id=%s type=%s to=%s subject=%r body=%r",
            interview_event_id, notification_type, msg.to, msg.subject, msg.text_body,
        )
    else:
        try:
            await client.send(msg)
            status = "SENT"
            logger.info(
                "notification.sent event_id=%s type=%s to=%s",
                interview_event_id, notification_type, msg.to,
            )
        except Exception as exc:  # noqa: BLE001 - a send failure must not affect the caller
            status = "FAILED"
            logger.warning(
                "notification.failed event_id=%s type=%s to=%s: %s",
                interview_event_id, notification_type, msg.to, type(exc).__name__,
            )

    await repository.insert(
        db,
        interview_event_id=interview_event_id,
        channel="EMAIL",
        notification_type=notification_type,
        recipient=msg.to,
        status=status,
    )
    await db.commit()
    return status


async def send_booking_confirmation(
    db: AsyncSession,
    event: InterviewEvent,
    *,
    candidate_email: str,
    panelist_emails: list[str],
    round_type: str,
    client: SendGridClient,
    title: str | None = None,
    company: str | None = None,
) -> str:
    """Exactly one CONFIRMATION row per successful booking."""
    link = event.meeting_link or "(a meeting link will follow separately)"
    context = ""
    if company:
        context += f"Company: {company}\n"
    if title:
        context += f"Role:  {title}\n"
    body = (
        "Your interview is confirmed.\n\n"
        f"{context}"
        f"Round: {round_type.title()}\n"
        f"When:  {_when(event)}\n"
        f"Join:  {link}\n\n"
        "This time is also on the interviewers' calendars.\n"
    )
    msg = EmailMessage(
        to=candidate_email,
        cc=list(panelist_emails),
        subject=f"Interview confirmed — {round_type.title()} round",
        text_body=body,
    )
    return await _dispatch(
        db,
        interview_event_id=event.id,
        notification_type="CONFIRMATION",
        msg=msg,
        client=client,
    )


async def send_lifecycle_notification(
    db: AsyncSession,
    event: InterviewEvent,
    *,
    notification_type: str,
    candidate_email: str,
    panelist_emails: list[str],
    reason: str | None,
    client: SendGridClient,
) -> str:
    """One DECLINE / RESCHEDULE / CANCELLATION / REMINDER row against `event`."""
    subject, phrase = _LIFECYCLE_COPY[notification_type]
    body = (
        f"Regarding the interview on {_when(event)}: {phrase}.\n"
    )
    if reason:
        body += f"\nReason given: {reason}\n"
    if notification_type != "CANCELLATION":
        body += "\nWe will follow up with a new time shortly.\n"
    msg = EmailMessage(
        to=candidate_email,
        cc=list(panelist_emails),
        subject=subject,
        text_body=body,
    )
    return await _dispatch(
        db,
        interview_event_id=event.id,
        notification_type=notification_type,
        msg=msg,
        client=client,
    )
