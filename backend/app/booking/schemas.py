"""Pydantic models for the booking endpoint."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class BookRequest(BaseModel):
    recommended_slot_id: uuid.UUID


class InterviewEventOut(BaseModel):
    id: uuid.UUID
    interview_request_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    calendar_event_id: str
    meeting_link: str | None
    # GOOGLE (real event + real Meet link) or SIMULATED (dev booking, no link).
    provider: str = "GOOGLE"
    status: str
    created_at: datetime
