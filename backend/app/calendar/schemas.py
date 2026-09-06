"""Pydantic models for the calendar endpoints. Tokens never appear here."""

from datetime import datetime

from pydantic import BaseModel


class ConnectResponse(BaseModel):
    authorization_url: str


class CalendarStatusResponse(BaseModel):
    status: str  # CONNECTED | EXPIRED | REVOKED | DISCONNECTED
    last_synced_at: datetime | None
