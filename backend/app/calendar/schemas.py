"""Pydantic models for the calendar endpoints. Tokens never appear here."""

from datetime import datetime

from pydantic import BaseModel


class ConnectResponse(BaseModel):
    authorization_url: str


class CalendarStatusResponse(BaseModel):
    status: str  # CONNECTED | EXPIRED | REVOKED | DISCONNECTED
    last_synced_at: datetime | None
    # How bookings actually create events, so the UI can be honest:
    #   GOOGLE     — real Google Calendar OAuth is configured
    #   SIMULATED  — dev/demo mode; bookings are local, no Meet link
    #   NOT_CONFIGURED — no OAuth client AND dev mode is off (bookings will 424)
    mode: str = "GOOGLE"
