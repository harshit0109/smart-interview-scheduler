"""Opt-in integration test against a REAL Google account.

Skipped unless a sandbox refresh token and the Calendar OAuth client are in the
environment. Never runs in CI. To run locally:

    SIS_SANDBOX_REFRESH_TOKEN=... \
    GOOGLE_CALENDAR_OAUTH_CLIENT_ID=... GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=... \
    pytest tests/test_calendar_sandbox.py -q
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest

from app.calendar.client import GoogleCalendarClient
from app.core.config import settings

_REFRESH = os.getenv("SIS_SANDBOX_REFRESH_TOKEN")

pytestmark = pytest.mark.skipif(
    not (_REFRESH and settings.google_calendar_oauth_client_id
         and settings.google_calendar_oauth_client_secret),
    reason="sandbox Google credentials not configured",
)


def test_real_refresh_and_free_busy():
    client = GoogleCalendarClient(
        client_id=settings.google_calendar_oauth_client_id,
        client_secret=settings.google_calendar_oauth_client_secret,
        redirect_uri=settings.google_calendar_oauth_redirect_uri,
    )

    async def _run():
        bundle = await client.refresh(_REFRESH)
        assert bundle.access_token
        now = datetime.now(UTC)
        busy = await client.free_busy(bundle.access_token, now, now + timedelta(days=7))
        assert isinstance(busy, list)

    asyncio.run(_run())
