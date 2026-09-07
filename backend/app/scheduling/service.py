"""Scheduling Service — orchestrates real data into the pure Phase 5 engine.

The only layer allowed to touch both I/O and the engine. It gathers stored
availability + live panelist free/busy, normalizes everything into an
`EngineInput`, calls the frozen engine once, and persists the run + slots.
`datetime.now(UTC)` enters the system HERE and nowhere in the engine.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.availability import repository as availability_repository
from app.booking import repository as booking_repository
from app.calendar import repository as calendar_repository
from app.calendar import service as calendar_service
from app.calendar.client import GoogleCalendarClient
from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import (
    AppError,
    NoCommonAvailabilityError,
    NotFoundError,
    NotReadyForSchedulingError,
    PanelistCalendarNotConnectedError,
)
from app.core.locks import LockNotAcquired, redis_lock
from app.core.models import InterviewParticipant, InterviewRequest, User
from app.scheduling import repository, schemas
from app.scheduling.engine import generate_recommendations
from app.scheduling.types import (
    CandidateWindow,
    EngineInput,
    Participant,
    SchedulingConstraints,
    SchedulingEngineError,
    ScoringWeights,
    TimeInterval,
    WorkingHours,
)

logger = logging.getLogger("app.scheduling")

READY = "READY_FOR_SCHEDULING"

# Interviewer availability window, in each interviewer's LOCAL timezone
# (requirements — 7:00 AM to 10:00 PM local). The engine clips generated slots
# to this per participant per local day; core hours only steer the comfort
# score toward the middle of the day.
_AVAILABILITY_WINDOW = WorkingHours(
    day_start=time(7, 0),
    day_end=time(22, 0),
    core_start=time(9, 0),
    core_end=time(18, 0),
)


def _snapshot(ei: EngineInput) -> dict:
    """JSON-able record of exactly what the engine ran against. Contains time
    zones, windows, busy blocks and constraints only — never any OAuth token."""
    return {
        "reference_time": ei.reference_time.isoformat(),
        "constraints": {
            "duration_minutes": ei.constraints.duration_minutes,
            "buffer_minutes": ei.constraints.buffer_minutes,
            "proximity_horizon_days": ei.constraints.proximity_horizon_days,
            "slot_step_minutes": ei.constraints.slot_step_minutes,
            "top_n": ei.constraints.top_n,
        },
        "weights": {
            "timezone_fairness": ei.weights.timezone_fairness,
            "working_hours_comfort": ei.weights.working_hours_comfort,
            "scheduling_proximity": ei.weights.scheduling_proximity,
            "workload_balance": ei.weights.workload_balance,
            "buffer_quality": ei.weights.buffer_quality,
        },
        "participants": [
            {
                "participant_id": p.participant_id,
                "timezone": p.timezone,
                "is_candidate": p.is_candidate,
                "busy": [
                    {"start": b.start.isoformat(), "end": b.end.isoformat()} for b in p.busy
                ],
            }
            for p in ei.participants
        ],
        "candidate_windows": [
            {"start": w.start.isoformat(), "end": w.end.isoformat()}
            for w in ei.candidate_windows
        ],
    }


async def _participants(
    db: AsyncSession, request_id: uuid.UUID
) -> list[tuple[InterviewParticipant, User]]:
    rows = await db.execute(
        select(InterviewParticipant, User)
        .join(User, User.id == InterviewParticipant.user_id)
        .where(InterviewParticipant.interview_request_id == request_id)
    )
    return list(rows.all())


def _run_to_response(run) -> schemas.RecommendationResponse:
    return schemas.RecommendationResponse(
        recommendation_run_id=run.id,
        slots=[
            schemas.SlotOut(
                id=s.id,
                start_time=s.start_time,
                end_time=s.end_time,
                total_score=float(s.total_score),
                score_breakdown=s.score_breakdown,
                explanation=s.explanation,
                rank=s.rank,
            )
            for s in sorted(run.slots, key=lambda s: s.rank)
        ],
    )


async def generate(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    client: GoogleCalendarClient,
) -> schemas.RecommendationResponse:
    """Idempotent + concurrency-safe. Two near-simultaneous calls (a double-fired
    client effect, a double-click) must not each create a recommendation run —
    `book()` rejects any slot that isn't from the *latest* run, which is exactly
    the "this time is no longer available" the demo hit. The first caller
    generates under a short Redis lock; a caller that arrives once the request is
    already RECOMMENDED returns that same run."""
    request = await db.get(InterviewRequest, request_id)
    if request is None:
        raise NotFoundError("interview request not found")
    if request.status == "RECOMMENDED":
        existing = await repository.get_latest_run(db, request_id)
        if existing is not None:
            return _run_to_response(existing)

    try:
        async with redis_lock(f"lock:recommend:{request_id}", ttl_seconds=30):
            return await _generate_locked(db, actor, request_id, client)
    except LockNotAcquired:
        # A concurrent call holds the lock and is generating — wait for its run.
        for _ in range(50):  # ~10s
            await asyncio.sleep(0.2)
            fresh = await db.get(InterviewRequest, request_id)
            await db.refresh(fresh)
            if fresh.status == "FAILED":
                raise NoCommonAvailabilityError() from None
            if fresh.status in ("RECOMMENDED", "BOOKED", "COMPLETED"):
                run = await repository.get_latest_run(db, request_id)
                if run is not None:
                    return _run_to_response(run)
        raise NotReadyForSchedulingError() from None


async def _generate_locked(
    db: AsyncSession,
    actor: User,
    request_id: uuid.UUID,
    client: GoogleCalendarClient,
) -> schemas.RecommendationResponse:
    request = await db.get(InterviewRequest, request_id)
    await db.refresh(request)
    if request.status == "RECOMMENDED":
        existing = await repository.get_latest_run(db, request_id)
        if existing is not None:
            return _run_to_response(existing)  # first caller already finished
    if request.status != READY:
        raise NotReadyForSchedulingError()

    avail = await availability_repository.get_latest(db, request_id)
    if avail is None or not avail.windows:
        raise NotReadyForSchedulingError()

    panelists = [
        (p, u)
        for p, u in await _participants(db, request_id)
        if p.role_in_interview == "PANELIST"
    ]
    if not panelists:
        raise NotReadyForSchedulingError()

    ref = datetime.now(UTC)

    # Drop windows that have wholly passed while the request waited; clip a
    # window that is currently in progress to `ref` (the engine rejects any
    # window that starts before reference_time).
    windows = [
        (max(w.start_time, ref), w.end_time)
        for w in avail.windows
        if w.end_time > ref
    ]
    if not windows:
        return await _fail(db, actor, request, "all_windows_expired")

    time_min = min(s for s, _e in windows)
    time_max = max(e for _s, e in windows)

    # SIMULATED calendar path (dev / no Google Calendar OAuth): skip the
    # per-panelist connection requirement and treat every panelist as fully
    # available. The run snapshot records `simulated_calendar` so the UI labels
    # the recommendations honestly. The real Google free/busy path below is
    # unchanged and resumes the moment OAuth creds are configured.
    simulated = settings.calendar_simulated
    busy_by_user: dict[uuid.UUID, list] = {}
    if simulated:
        for _p, user in panelists:
            busy_by_user[user.id] = []
    else:
        conns: dict[uuid.UUID, object] = {}
        for _p, user in panelists:
            conn = await calendar_repository.get_by_user(db, user.id)
            if conn is None:
                raise PanelistCalendarNotConnectedError(
                    f"Panelist {user.email} has not connected their Google Calendar"
                )
            conns[user.id] = await calendar_service.ensure_usable(
                db, conn, client, panelist_email=user.email
            )
        for _p, user in panelists:
            busy_by_user[user.id] = await calendar_service.get_free_busy(
                conns[user.id], time_min, time_max, client
            )

    # Internal commitments: a panelist already CONFIRMED on another interview in
    # this system is busy then, whether or not Google free/busy shows it (it
    # never does in simulated mode, and in real mode only the organiser's own
    # calendar carries the event). Fed as hard `busy` intervals so the engine
    # will not recommend an overlapping slot.
    panelist_ids = [user.id for _p, user in panelists]
    internal = await booking_repository.confirmed_events_for_users(
        db, panelist_ids, exclude_request_id=request_id,
        overlaps_start=time_min, overlaps_end=time_max,
    )
    for uid, s, e in internal:
        busy_by_user.setdefault(uid, []).append(TimeInterval(s, e))

    engine_input = EngineInput(
        reference_time=ref,
        participants=(
            Participant(str(request.candidate_id), avail.timezone, is_candidate=True),
            *(
                Participant(
                    str(user.id),
                    user.timezone or "UTC",
                    busy=tuple(
                        TimeInterval(b.start, b.end) for b in busy_by_user[user.id]
                    ),
                )
                for _p, user in panelists
            ),
        ),
        candidate_windows=tuple(CandidateWindow(s, e) for s, e in windows),
        constraints=SchedulingConstraints(
            duration_minutes=request.duration_minutes,
            buffer_minutes=request.buffer_minutes,
            working_hours=_AVAILABILITY_WINDOW,
        ),
        existing_bookings={},  # interview_events arrives in Phase 7 (G1 / D-B)
        weights=ScoringWeights(),
    )

    try:
        result = generate_recommendations(engine_input)
    except SchedulingEngineError as exc:
        logger.error("scheduling.engine_rejected_input request_id=%s: %s", request_id, exc)
        raise AppError("the scheduling engine could not process this request") from exc

    if not result.slots:
        return await _fail(db, actor, request, "no_common_availability")

    snapshot = _snapshot(engine_input)
    snapshot["simulated_calendar"] = simulated
    run = await repository.create_run(
        db,
        interview_request_id=request.id,
        algorithm_version=result.algorithm_version,
        input_snapshot=snapshot,
        slots=[
            {
                "start_time": s.start_time,
                "end_time": s.end_time,
                "total_score": round(s.total_score, 3),
                "score_breakdown": s.score_breakdown.as_dict(),
                "explanation": s.explanation,
                "rank": s.rank,
            }
            for s in result.slots
        ],
    )
    request.status = "RECOMMENDED"
    await record_audit(
        db,
        actor_id=actor.id,
        actor_role=actor.role,
        action="RECOMMENDATION_GENERATED",
        entity_type="interview_request",
        entity_id=request.id,
        metadata={"recommendation_run_id": str(run.id), "slot_count": len(result.slots)},
    )
    await db.commit()
    logger.info(
        "scheduling.recommended request_id=%s run_id=%s slots=%d",
        request_id, run.id, len(result.slots),
    )

    # Build the response from the PERSISTED rows so callers get real slot ids
    # (POST /book takes one as `recommended_slot_id`).
    return _run_to_response(run)


async def _fail(
    db: AsyncSession, actor: User, request: InterviewRequest, reason: str
) -> schemas.RecommendationResponse:
    request.status = "FAILED"
    await record_audit(
        db,
        actor_id=actor.id,
        actor_role=actor.role,
        action="RECOMMENDATION_FAILED",
        entity_type="interview_request",
        entity_id=request.id,
        metadata={"reason": reason},
    )
    await db.commit()
    raise NoCommonAvailabilityError()
