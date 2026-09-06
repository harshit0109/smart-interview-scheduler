"""Pydantic models for interview request management (API_DESIGN.md §Interview Requests)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

RoundType = Literal["SCREENING", "TECHNICAL", "MANAGERIAL", "HR"]


class CreateInterviewRequest(BaseModel):
    candidate_id: uuid.UUID
    round_type: RoundType
    duration_minutes: int = Field(gt=0)
    buffer_minutes: int = Field(default=15, ge=0)
    panelist_ids: list[uuid.UUID] = Field(min_length=1)

    @field_validator("panelist_ids")
    @classmethod
    def _dedupe(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        return list(dict.fromkeys(v))

    @model_validator(mode="after")
    def _candidate_not_panelist(self) -> "CreateInterviewRequest":
        if self.candidate_id in self.panelist_ids:
            raise ValueError("candidate_id cannot also be a panelist")
        return self


class UpdateInterviewRequest(BaseModel):
    round_type: RoundType | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    buffer_minutes: int | None = Field(default=None, ge=0)
    panelist_ids: list[uuid.UUID] | None = Field(default=None, min_length=1)

    @field_validator("panelist_ids")
    @classmethod
    def _dedupe(cls, v: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        return list(dict.fromkeys(v)) if v is not None else None


class ParticipantOut(BaseModel):
    user_id: uuid.UUID
    role_in_interview: str
    response_status: str


class InterviewRequestOut(BaseModel):
    id: uuid.UUID
    candidate_id: uuid.UUID
    created_by: uuid.UUID
    round_type: str
    duration_minutes: int
    buffer_minutes: int
    status: str
    created_at: datetime
    participants: list[ParticipantOut]
