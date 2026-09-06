"""Pydantic models for candidate availability (API_DESIGN.md §Availability).

All window datetimes must be offset-aware ISO8601 (naive rejected) and are
normalised to UTC before persistence (requirements.md §13 — DST safety).
"""

import uuid
from datetime import UTC, datetime, timedelta

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator

from app.core.validators import valid_iana_timezone

# Distinct from the Scheduling Proximity scoring horizon (Phase 5) — see G8.
AVAILABILITY_HORIZON_DAYS = 21
MAX_WINDOWS = 10


class WindowIn(BaseModel):
    start_time: AwareDatetime
    end_time: AwareDatetime

    @field_validator("start_time", "end_time")
    @classmethod
    def _to_utc(cls, v: datetime) -> datetime:
        return v.astimezone(UTC)

    @model_validator(mode="after")
    def _check_bounds(self) -> "WindowIn":
        now = datetime.now(UTC)
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        if self.start_time <= now:
            raise ValueError("start_time must be in the future")
        if self.end_time > now + timedelta(days=AVAILABILITY_HORIZON_DAYS):
            raise ValueError(f"window must fall within {AVAILABILITY_HORIZON_DAYS} days")
        return self


class SubmitAvailabilityRequest(BaseModel):
    timezone: str
    windows: list[WindowIn] = Field(min_length=1, max_length=MAX_WINDOWS)

    @field_validator("timezone")
    @classmethod
    def _valid_timezone(cls, v: str) -> str:
        return valid_iana_timezone(v)


class WindowOut(BaseModel):
    start_time: datetime
    end_time: datetime


class AvailabilityOut(BaseModel):
    id: uuid.UUID
    interview_request_id: uuid.UUID
    candidate_id: uuid.UUID
    timezone: str
    submitted_at: datetime
    windows: list[WindowOut]
