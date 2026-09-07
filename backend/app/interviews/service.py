"""Interview request orchestration: validation, RBAC visibility, state gating, audit."""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import repository as booking_repository
from app.booking.schemas import InterviewEventOut
from app.core.audit import record_audit
from app.core.errors import (
    InvalidParticipantError,
    NotFoundError,
    RequestLockedForEditingError,
)
from app.core.models import EDITABLE_STATUSES, InterviewRequest, User
from app.core.pagination import Page, PageParams
from app.interviews import repository, schemas
from app.scheduling import repository as scheduling_repository
from app.scheduling.schemas import SlotOut

# D1 (PROJECT_CONTEXT.md): requests are created ready for the candidate, not DRAFT.
INITIAL_STATUS = "AWAITING_CANDIDATE_AVAILABILITY"


def _to_out(request: InterviewRequest) -> schemas.InterviewRequestOut:
    return schemas.InterviewRequestOut(
        id=request.id,
        candidate_id=request.candidate_id,
        created_by=request.created_by,
        title=request.title,
        company=request.company,
        round_type=request.round_type,
        duration_minutes=request.duration_minutes,
        buffer_minutes=request.buffer_minutes,
        status=request.status,
        outcome=request.outcome,
        outcome_notes=request.outcome_notes,
        round_number=request.round_number,
        parent_request_id=request.parent_request_id,
        created_at=request.created_at,
        participants=[
            schemas.ParticipantOut(
                user_id=p.user_id,
                role_in_interview=p.role_in_interview,
                response_status=p.response_status,
            )
            for p in request.participants
        ],
    )


async def _resolve_roles(
    db: AsyncSession, candidate_id: uuid.UUID | None, panelist_ids: Sequence[uuid.UUID]
) -> None:
    wanted = ({candidate_id} if candidate_id else set()) | set(panelist_ids)
    found = {u.id: u for u in await repository.get_users(db, list(wanted))}

    missing = wanted - found.keys()
    if missing:
        raise NotFoundError(f"unknown user id(s): {', '.join(str(m) for m in sorted(missing))}")

    if candidate_id and found[candidate_id].role != "CANDIDATE":
        raise InvalidParticipantError("candidate_id must reference a CANDIDATE user")
    wrong = [str(pid) for pid in panelist_ids if found[pid].role != "PANELIST"]
    if wrong:
        raise InvalidParticipantError(f"not a PANELIST: {', '.join(wrong)}")


async def create_request(
    db: AsyncSession, actor: User, data: schemas.CreateInterviewRequest
) -> schemas.InterviewRequestOut:
    await _resolve_roles(db, data.candidate_id, data.panelist_ids)
    request = await repository.create(
        db,
        candidate_id=data.candidate_id,
        created_by=actor.id,
        title=data.title,
        company=data.company,
        round_type=data.round_type,
        duration_minutes=data.duration_minutes,
        buffer_minutes=data.buffer_minutes,
        panelist_ids=data.panelist_ids,
        status=INITIAL_STATUS,
    )
    await record_audit(
        db,
        actor_id=actor.id,
        actor_role=actor.role,
        action="INTERVIEW_REQUEST_CREATED",
        entity_type="interview_request",
        entity_id=request.id,
        metadata={
            "round_type": data.round_type,
            "duration_minutes": data.duration_minutes,
            "panelist_count": len(data.panelist_ids),
        },
    )
    await db.commit()
    return _to_out(request)


async def list_requests(
    db: AsyncSession, viewer: User, status: str | None, page: PageParams
) -> Page[schemas.InterviewRequestOut]:
    rows, total = await repository.list_for_viewer(
        db,
        viewer_id=viewer.id,
        is_admin=viewer.role == "ADMIN",
        status=status,
        offset=page.page * page.size,
        limit=page.size,
    )
    return Page(
        items=[_to_out(r) for r in rows], page=page.page, size=page.size, total=total
    )


async def get_request(
    db: AsyncSession, viewer: User, request_id: uuid.UUID
) -> schemas.InterviewRequestOut:
    request = await repository.get(db, request_id)
    if request is None or not _visible_to(request, viewer):
        raise NotFoundError("interview request not found")
    out = _to_out(request)
    # ADMIN and the owning candidate may see the recommended slots (requirements.md §4).
    if viewer.role == "ADMIN" or viewer.id == request.candidate_id:
        run = await scheduling_repository.get_latest_run(db, request_id)
        if run is not None:
            out.recommended_slots = [
                SlotOut(
                    id=s.id,
                    start_time=s.start_time,
                    end_time=s.end_time,
                    total_score=float(s.total_score),
                    score_breakdown=s.score_breakdown,
                    explanation=s.explanation,
                    rank=s.rank,
                )
                for s in run.slots
            ]
    # Anyone who can view the request sees the booked event (API_DESIGN.md).
    event = await booking_repository.get_confirmed_event(db, request_id)
    if event is not None:
        out.booked_event = InterviewEventOut(
            id=event.id,
            interview_request_id=event.interview_request_id,
            start_time=event.start_time,
            end_time=event.end_time,
            calendar_event_id=event.calendar_event_id,
            meeting_link=event.meeting_link,
            provider=event.provider,
            status=event.status,
            created_at=event.created_at,
        )
    return out


def _visible_to(request: InterviewRequest, viewer: User) -> bool:
    if viewer.role == "ADMIN":
        return True
    return any(p.user_id == viewer.id for p in request.participants)


async def update_request(
    db: AsyncSession, actor: User, request_id: uuid.UUID, data: schemas.UpdateInterviewRequest
) -> schemas.InterviewRequestOut:
    request = await repository.get(db, request_id)
    if request is None:
        raise NotFoundError("interview request not found")
    if request.status not in EDITABLE_STATUSES:
        raise RequestLockedForEditingError()

    changed = data.model_dump(exclude_unset=True)
    if not changed:
        return _to_out(request)

    if "panelist_ids" in changed:
        await _resolve_roles(db, None, data.panelist_ids)
        await repository.replace_panelists(db, request, data.panelist_ids)
    for field in ("round_type", "duration_minutes", "buffer_minutes"):
        if field in changed:
            setattr(request, field, changed[field])

    await record_audit(
        db,
        actor_id=actor.id,
        actor_role=actor.role,
        action="INTERVIEW_REQUEST_UPDATED",
        entity_type="interview_request",
        entity_id=request.id,
        metadata={"changed": sorted(changed.keys())},
    )
    await db.commit()
    return _to_out(await repository.get(db, request_id))
