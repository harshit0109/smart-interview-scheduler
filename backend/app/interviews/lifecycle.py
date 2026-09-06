"""Phase 9 (POST-MVP) lifecycle transitions: decline / reschedule / cancel /
audit view.

Each mutating op: take the booking lock, cancel the Google event outside any DB
transaction (best-effort), then one Postgres transaction for the status +
participant + audit changes, commit, release the lock, then best-effort
notification + re-recommendation. Same compensating-action posture as Phase 7 —
no distributed transaction. The frozen Phase 5 engine is untouched.
"""

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import repository as booking_repository
from app.booking.service import organiser_connection
from app.calendar import service as calendar_service
from app.calendar.client import GoogleCalendarClient
from app.core.audit import record_audit
from app.core.errors import (
    AppError,
    ForbiddenError,
    NotBookedError,
    NotFoundError,
    RequestAlreadyTerminalError,
)
from app.core.locks import redis_lock
from app.core.models import InterviewEvent, InterviewParticipant, InterviewRequest, User
from app.core.pagination import Page, PageParams
from app.interviews import repository, schemas
from app.notifications import service as notifications_service
from app.notifications.client import SendGridClient
from app.scheduling import service as scheduling_service

logger = logging.getLogger("app.interviews.lifecycle")

_TERMINAL = {"CANCELLED", "COMPLETED"}
Parts = list[tuple[InterviewParticipant, User]]


async def _load(db: AsyncSession, request_id: uuid.UUID) -> InterviewRequest:
    request = await db.get(InterviewRequest, request_id)
    if request is None:
        raise NotFoundError("interview request not found")
    return request


def _emails(parts: Parts) -> tuple[str, list[str]]:
    candidate = next(u for p, u in parts if p.role_in_interview == "CANDIDATE")
    panelists = [u.email for p, u in parts if p.role_in_interview == "PANELIST"]
    return candidate.email, panelists


async def _cancel_active_event(
    db: AsyncSession,
    parts: Parts,
    event: InterviewEvent,
    client: GoogleCalendarClient,
    *,
    trigger: str,
) -> None:
    """Delete the Google event and mark the local row CANCELLED. A Google failure
    still cancels locally (user intent is authoritative) and records a
    reconciliation task (D-6). Must be called inside the caller's transaction."""
    panelists = [(p, u) for p, u in parts if p.role_in_interview == "PANELIST"]
    deleted = False
    try:
        organiser = await organiser_connection(db, panelists, client)
        deleted = await calendar_service.delete_event(
            calendar_service.access_token_of(organiser), client, event.calendar_event_id
        )
    except AppError as exc:
        logger.warning("lifecycle.organiser_unavailable event_id=%s: %s", event.id, exc.code)

    event.status = "CANCELLED"
    if not deleted:
        await booking_repository.create_reconciliation_task(
            db,
            interview_event_id=event.id,
            external_calendar_event_id=event.calendar_event_id,
            reason="CANCEL_DELETE_FAILED",
            metadata={"trigger": trigger},
            commit=False,
        )
        logger.warning(
            "lifecycle.calendar_delete_failed event_id=%s trigger=%s", event.id, trigger
        )


async def _notify(
    db: AsyncSession,
    event: InterviewEvent,
    ntype: str,
    parts: Parts,
    reason: str | None,
    sendgrid: SendGridClient,
) -> None:
    candidate_email, panelist_emails = _emails(parts)
    try:
        await notifications_service.send_lifecycle_notification(
            db,
            event,
            notification_type=ntype,
            candidate_email=candidate_email,
            panelist_emails=panelist_emails,
            reason=reason,
            client=sendgrid,
        )
    except Exception:  # noqa: BLE001 - the transition already committed
        logger.error(
            "lifecycle.notification_dispatch_failed event_id=%s type=%s",
            event.id, ntype, exc_info=True,
        )


async def _retrigger_recommendations(
    db: AsyncSession, actor: User, request_id: uuid.UUID, client: GoogleCalendarClient
) -> None:
    request = await db.get(InterviewRequest, request_id)
    if request is None:
        return
    request.status = "READY_FOR_SCHEDULING"
    await db.commit()
    try:
        await scheduling_service.generate(db, actor, request_id, client)
    except Exception as exc:  # noqa: BLE001 - re-recommendation is best-effort (D-5)
        logger.info("lifecycle.re_recommend_deferred request_id=%s: %s", request_id, exc)


# ------------------------------------------------------------------- decline ----


async def decline(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    reason: str | None,
    *,
    calendar_client: GoogleCalendarClient,
    sendgrid: SendGridClient,
) -> schemas.LifecycleStatusResponse:
    await _load(db, request_id)
    parts = await booking_repository.participants_with_users(db, request_id)
    me = next(
        (p for p, u in parts if u.id == actor.id and p.role_in_interview == "PANELIST"),
        None,
    )
    if me is None:
        raise ForbiddenError("only an assigned panelist may decline this interview")

    event: InterviewEvent | None = None
    async with redis_lock(f"lock:booking:{request_id}"):
        request = await _load(db, request_id)
        was_booked = request.status == "BOOKED"
        me.response_status = "DECLINED"
        if was_booked:
            event = await booking_repository.get_confirmed_event(db, request_id)
            if event is not None:
                await _cancel_active_event(db, parts, event, calendar_client, trigger="decline")
            request.status = "RESCHEDULING"
            resp = "RESCHEDULING"
        else:
            request.status = "READY_FOR_SCHEDULING"
            resp = "READY_FOR_SCHEDULING"
        await record_audit(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="INTERVIEW_DECLINED",
            entity_type="interview_request",
            entity_id=request_id,
            metadata=({"reason": reason} if reason else {}),
        )
        await db.commit()

    if event is not None:
        await _notify(db, event, "DECLINE", parts, reason, sendgrid)
    if resp == "RESCHEDULING":
        await _retrigger_recommendations(db, actor, request_id, calendar_client)
    return schemas.LifecycleStatusResponse(interview_request_status=resp)


# ---------------------------------------------------------------- reschedule ----


async def reschedule(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    reason: str | None,
    *,
    calendar_client: GoogleCalendarClient,
    sendgrid: SendGridClient,
) -> schemas.LifecycleStatusResponse:
    request = await _load(db, request_id)
    if request.status != "BOOKED":
        raise NotBookedError()
    parts = await booking_repository.participants_with_users(db, request_id)

    event: InterviewEvent | None = None
    async with redis_lock(f"lock:booking:{request_id}"):
        request = await _load(db, request_id)
        if request.status != "BOOKED":
            raise NotBookedError()
        event = await booking_repository.get_confirmed_event(db, request_id)
        if event is not None:
            await _cancel_active_event(db, parts, event, calendar_client, trigger="reschedule")
        request.status = "RESCHEDULING"
        await record_audit(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="INTERVIEW_RESCHEDULE_REQUESTED",
            entity_type="interview_request",
            entity_id=request_id,
            metadata=({"reason": reason} if reason else {}),
        )
        await db.commit()

    if event is not None:
        await _notify(db, event, "RESCHEDULE", parts, reason, sendgrid)
    await _retrigger_recommendations(db, actor, request_id, calendar_client)
    return schemas.LifecycleStatusResponse(interview_request_status="RESCHEDULING")


# -------------------------------------------------------------------- cancel ----


async def cancel(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    reason: str | None,
    *,
    calendar_client: GoogleCalendarClient,
    sendgrid: SendGridClient,
) -> schemas.LifecycleStatusResponse:
    request = await _load(db, request_id)
    if request.status in _TERMINAL:
        raise RequestAlreadyTerminalError()
    parts = await booking_repository.participants_with_users(db, request_id)

    event: InterviewEvent | None = None
    async with redis_lock(f"lock:booking:{request_id}"):
        request = await _load(db, request_id)
        if request.status in _TERMINAL:
            raise RequestAlreadyTerminalError()
        event = await booking_repository.get_confirmed_event(db, request_id)
        if event is not None:
            await _cancel_active_event(db, parts, event, calendar_client, trigger="cancel")
        request.status = "CANCELLED"
        await record_audit(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="INTERVIEW_CANCELLED",
            entity_type="interview_request",
            entity_id=request_id,
            metadata=({"reason": reason} if reason else {}),
        )
        await db.commit()

    if event is not None:
        await _notify(db, event, "CANCELLATION", parts, reason, sendgrid)
    return schemas.LifecycleStatusResponse(interview_request_status="CANCELLED")


# --------------------------------------------------------------- audit view -----


async def get_audit(
    db: AsyncSession, request_id: uuid.UUID, page: PageParams
) -> Page[schemas.AuditEntryOut]:
    await _load(db, request_id)
    rows, total = await repository.list_audit(
        db, request_id, offset=page.page * page.size, limit=page.size
    )
    return Page(
        items=[
            schemas.AuditEntryOut(
                id=r.id,
                actor_id=r.actor_id,
                actor_role=r.actor_role,
                action=r.action,
                entity_type=r.entity_type,
                entity_id=r.entity_id,
                metadata=r.audit_metadata,
                created_at=r.created_at,
            )
            for r in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )
