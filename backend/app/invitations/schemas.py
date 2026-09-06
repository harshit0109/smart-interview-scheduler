"""Pydantic models for the invitation lifecycle: issuance, the public
token-resolved view, response, and account claim."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ResponseValue = Literal["ACCEPTED", "DECLINED", "UNAVAILABLE"]


class InvitationSummary(BaseModel):
    """Returned once, at issuance/resend — the only response that carries a
    usable link, since the raw token is never persisted or retrievable again."""

    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    status: str
    requires_account_setup: bool
    delivery_status: str | None
    send_count: int
    expires_at: datetime
    invite_url: str


class InvitationOut(BaseModel):
    """Admin-facing list view (GET) — no invite_url; the link isn't recoverable
    after issuance without a resend, which rotates the token."""

    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    status: str
    requires_account_setup: bool
    delivery_status: str | None
    send_count: int
    expires_at: datetime
    responded_at: datetime | None


class InvitationPublicOut(BaseModel):
    """What an unauthenticated recipient sees at /invite/{token}."""

    role: str
    status: str
    requires_account_setup: bool
    account_claimed: bool
    interview_title: str | None
    round_type: str
    duration_minutes: int


class RespondRequest(BaseModel):
    response: ResponseValue
    reason: str | None = Field(default=None, max_length=1000)


class ClaimAccountRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def _password_has_digit(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("password must contain at least one number")
        return v
