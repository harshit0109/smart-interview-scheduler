"""Persistence for recommendation_runs / recommended_slots.

Written only by the Scheduling Service — never by the pure engine (DB_DESIGN.md).
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import RecommendationRun, RecommendedSlot


async def create_run(
    db: AsyncSession,
    *,
    interview_request_id: uuid.UUID,
    algorithm_version: str,
    input_snapshot: dict,
    slots: Sequence[dict],
) -> RecommendationRun:
    run = RecommendationRun(
        interview_request_id=interview_request_id,
        algorithm_version=algorithm_version,
        input_snapshot=input_snapshot,
        slots=[
            RecommendedSlot(
                start_time=s["start_time"],
                end_time=s["end_time"],
                total_score=s["total_score"],
                score_breakdown=s["score_breakdown"],
                explanation=s["explanation"],
                rank=s["rank"],
            )
            for s in slots
        ],
    )
    db.add(run)
    await db.flush()
    return run


async def get_latest_run(
    db: AsyncSession, interview_request_id: uuid.UUID
) -> RecommendationRun | None:
    return await db.scalar(
        select(RecommendationRun)
        .where(RecommendationRun.interview_request_id == interview_request_id)
        .order_by(RecommendationRun.generated_at.desc())
        .options(selectinload(RecommendationRun.slots))
        .limit(1)
    )
