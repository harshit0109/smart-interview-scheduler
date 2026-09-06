"""The 8-step booking sequence (requirements.md §10 / DB_DESIGN.md §Concurrency).

The step numbers below map 1:1 to §10 so the code and the spec read side by side.
Calendar-vs-DB consistency is a compensating-action sequence — NOT a distributed
transaction. Success is reported only after the Postgres commit in step 7.
"""

import logging
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import repository, schemas
from app.calendar import repository as calendar_repository
from app.calendar import service as calendar_service
from app.calendar.client import GoogleCalendarClient
from app.core.audit import record_audit
from app.core.errors import (
    BookingPersistenceFailedError,
    NotFoundError,
    PanelistCalendarNotConnectedError,
    SlotNoLongerAvailableError,
)
from app.core.locks import LockNotAcquired, redis_lock
from app.core.models import CalendarConnection, InterviewParticipant, InterviewRequest, User
from app.notifications import service as notifications_service
from app.notifications.client import SendGridClient

logger = logging.getLogger("app.booking")

RECOMMENDED = "RECOMMENDED"


def _safe_error(exc: BaseException) -> dict:
    """A token-free summary of a failure for a reconciliation-task payload."""
    return {"type": type(exc).__name__, "detail": str(exc)[:300]}


def _to_out(event) -> schemas.InterviewEventOut:
    return schemas.InterviewEventOut(
        id=event.id,
        interview_request_id=event.interview_request_id,
        start_time=event.start_time,
        end_time=event.end_time,
        calendar_event_id=event.calendar_event_id,
        meeting_link=event.meeting_link,
        status=event.status,
        created_at=event.created_at,
    )


async def organiser_connection(
    db: AsyncSession,
    panelists: list[tuple[InterviewParticipant, User]],
    client: GoogleCalendarClient,
) -> CalendarConnection:
    """The event is hosted on the first assigned panelist's calendar (D-1),
    deterministic by user id. A bad connection surfaces its specific 424 (D-8).
    Reused by the Phase 9 lifecycle flows to cancel the event."""
    _p, user = sorted(panelists, key=lambda pu: str(pu[1].id))[0]
    conn = await calendar_repository.get_by_user(db, user.id)
    if conn is None:
        raise PanelistCalendarNotConnectedError(
            f"Panelist {user.email} has not connected their Google Calendar"
        )
    return await calendar_service.ensure_usable(db, conn, client, panelist_email=user.email)


async def book(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    slot_id: uuid.UUID,
    client: GoogleCalendarClient,
    sendgrid: SendGridClient,
) -> schemas.InterviewEventOut:
    slot = await repository.get_slot_with_run(db, slot_id)
    if slot is None or slot.run.interview_request_id != request_id:
        raise NotFoundError("recommended slot not found for this request")

    request = await db.get(InterviewRequest, request_id)
    if request is None:
        raise NotFoundError("interview request not found")

    if slot.recommendation_run_id != await repository.latest_run_id(db, request_id):
        raise SlotNoLongerAvailableError("this recommendation is no longer current")
    if request.status != RECOMMENDED:
        raise SlotNoLongerAvailableError("this request can no longer be booked")

    try:
        async with redis_lock(f"lock:booking:{request_id}"):  # step 1
            await db.refresh(request)
            if request.status != RECOMMENDED:  # step 2 (re-validate under the lock)
                raise SlotNoLongerAvailableError("this request can no longer be booked")
            if await repository.get_confirmed_event(db, request_id) is not None:  # step 3
                raise SlotNoLongerAvailableError("this request is already booked")

            parts = await repository.participants_with_users(db, request_id)
            panelists = [(p, u) for p, u in parts if p.role_in_interview == "PANELIST"]
            candidate = next(u for p, u in parts if p.role_in_interview == "CANDIDATE")
            # Plain strings captured before step 6 — used for the post-commit
            # confirmation, safe against a rollback expiring the ORM rows.
            candidate_email = candidate.email
            panelist_emails = [u.email for _p, u in panelists]
            round_type = request.round_type
            organiser = await organiser_connection(db, panelists, client)
            # Capture the token now, while `organiser` is loaded — a later rollback
            # expires the row and an implicit reload would fail in async context.
            organiser_token = calendar_service.access_token_of(organiser)

            cal = await calendar_service.create_event(  # step 4 — OUTSIDE any DB transaction
                organiser_token,
                client,
                summary=f"{request.round_type.title()} interview",
                description="Scheduled via Smart Interview Scheduler.",
                start=slot.start_time,
                end=slot.end_time,
                attendee_emails=[candidate.email, *(u.email for _p, u in panelists)],
            )  # step 5 — calendar_event_id + meeting_link

            try:  # step 6 — Postgres-only transaction
                event = await repository.insert_interview_event(
                    db,
                    interview_request_id=request_id,
                    start=slot.start_time,
                    end=slot.end_time,
                    calendar_event_id=cal.event_id,
                    meeting_link=cal.meeting_link,
                )
                request.status = "BOOKED"
                slot.is_selected = True
                await record_audit(
                    db,
                    actor_id=actor.id,
                    actor_role=actor.role,
                    action="INTERVIEW_BOOKED",
                    entity_type="interview_request",
                    entity_id=request_id,
                    metadata={
                        "interview_event_id": str(event.id),
                        "calendar_event_id": cal.event_id,
                    },
                )
                await db.commit()  # step 7
            except IntegrityError as exc:  # lost the DB-level double-booking race
                await db.rollback()
                await _compensate(db, organiser_token, client, cal.event_id, exc)
                raise SlotNoLongerAvailableError(
                    "this request was booked by someone else"
                ) from exc
            except Exception as exc:
                await db.rollback()
                await _compensate(db, organiser_token, client, cal.event_id, exc)
                raise BookingPersistenceFailedError() from exc
        # step 8 — lock released on context exit
    except LockNotAcquired:
        raise SlotNoLongerAvailableError(
            "a booking is already in progress for this request"
        ) from None

    logger.info(
        "booking.confirmed request_id=%s event_id=%s calendar_event_id=%s",
        request_id, event.id, cal.event_id,
    )

    # Step 10 of the Core Demo Loop — confirmation. Booking is already durable;
    # a failure here is logged and never propagated (requirements.md §5, FR-030).
    try:
        await notifications_service.send_booking_confirmation(
            db,
            event,
            candidate_email=candidate_email,
            panelist_emails=panelist_emails,
            round_type=round_type,
            client=sendgrid,
        )
    except Exception:  # noqa: BLE001 - the booking succeeded; never let this undo it
        logger.error(
            "booking.confirmation_dispatch_failed event_id=%s", event.id, exc_info=True
        )

    return _to_out(event)


async def _compensate(
    db: AsyncSession,
    organiser_token: str,
    client: GoogleCalendarClient,
    calendar_event_id: str,
    original_error: BaseException,
) -> None:
    """Undo the step-4 Calendar event after a step-6 failure. If the delete also
    fails, record a reconciliation task. Never reports success either way."""
    if await calendar_service.delete_event(organiser_token, client, calendar_event_id):
        logger.error(
            "booking_compensated calendar_event_id=%s original_error=%s",
            calendar_event_id, _safe_error(original_error),
        )
        return
    try:
        await repository.create_reconciliation_task(
            db,
            external_calendar_event_id=calendar_event_id,
            reason="COMPENSATING_DELETE_FAILED",
            metadata={"original_error": _safe_error(original_error), "phase": "db_persist"},
        )
        logger.critical(
            "booking_compensation_failed_needs_manual_reconciliation calendar_event_id=%s",
            calendar_event_id,
        )
    except Exception:  # noqa: BLE001 - DB truly unavailable; last-resort log
        logger.critical(
            "booking_compensation_and_reconciliation_failed calendar_event_id=%s",
            calendar_event_id,
        )
