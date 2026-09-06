"""Pydantic models for the recommendations endpoint.

`score_breakdown` keys are the five requirements.md §8 factor names, exactly as
the pure engine emits them — the same JSON persisted to
`recommended_slots.score_breakdown`.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class SlotOut(BaseModel):
    # The persisted recommended_slots row id — the value POST /book takes as
    # `recommended_slot_id`. (API_DESIGN.md's response example omits it.)
    id: uuid.UUID
    start_time: datetime
    end_time: datetime
    total_score: float
    score_breakdown: dict[str, float]
    explanation: str
    rank: int


class RecommendationResponse(BaseModel):
    recommendation_run_id: uuid.UUID
    slots: list[SlotOut]
