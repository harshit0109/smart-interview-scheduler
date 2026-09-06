"""Phase 9 item 1 — the reminder cron script (scripts/send_reminders.py)."""

import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from scripts.send_reminders import process_due_reminders
from tests.test_booking import _book, _recommended


def _process(hours: int) -> int:
    async def _go() -> int:
        eng = create_async_engine(settings.database_url)
        session = async_sessionmaker(eng, expire_on_commit=False)
        try:
            async with session() as db:
                return await process_due_reminders(db, hours=hours)
        finally:
            await eng.dispose()

    return asyncio.run(_go())


def test_reminder_sent_once_and_idempotent(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    _book(client, ctx, ctx.slots[0]["id"])  # slot is ~2 days out

    assert _process(hours=72) == 1
    assert db_val(
        "SELECT count(*) FROM notification_logs WHERE notification_type='REMINDER'"
    ) == 1

    assert _process(hours=72) == 0  # already reminded
    assert db_val(
        "SELECT count(*) FROM notification_logs WHERE notification_type='REMINDER'"
    ) == 1


def test_reminder_window_excludes_far_future(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    _book(client, ctx, ctx.slots[0]["id"])
    assert _process(hours=1) == 0  # slot is ~2 days out, not within 1h


def test_reminder_ignores_cancelled_event(
    client, make_user, make_calendar_connection, fake_calendar
):
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    _book(client, ctx, ctx.slots[0]["id"])
    client.post(
        f"/api/v1/interviews/{ctx.rid}/cancel", json={}, headers=ctx.admin.headers
    )
    assert _process(hours=72) == 0
