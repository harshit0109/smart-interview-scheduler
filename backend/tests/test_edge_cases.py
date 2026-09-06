"""Phase 11 — resilience edge cases from requirements.md §13 + a Scheduling
Engine load smoke (IMPLEMENTATION.md Phase 11 "in scope").

These complement the per-phase suites; they do NOT modify any frozen file.
"""

import time as _time
from datetime import UTC, datetime, timedelta

from app.scheduling.engine import generate_recommendations
from app.scheduling.types import (
    CandidateWindow,
    EngineInput,
    Participant,
    SchedulingConstraints,
    TimeInterval,
)
from tests.test_availability import _make_request, _submit
from tests.test_booking import _book, _recommended

V1 = "/api/v1"


def _iv(start: datetime, minutes: int) -> TimeInterval:
    return TimeInterval(start, start + timedelta(minutes=minutes))


# ------------------------------------------------------ §13: DST / time zones --


def test_availability_stored_as_exact_utc_across_a_dst_offset_change(client, make_user):
    """A candidate picks a window whose two ends carry different UTC offsets — the
    shape of a client that crossed a fall-back boundary between choosing start and
    end. The backend must store the exact instants it was given (astimezone(UTC)),
    never reinterpret them against a single zone (requirements.md §13, DST row)."""
    _admin, candidate, _panelist, rid = _make_request(client, make_user)
    d = (datetime.now(UTC) + timedelta(days=3)).date().isoformat()

    windows = [{"start_time": f"{d}T14:00:00-04:00", "end_time": f"{d}T16:00:00-05:00"}]
    resp = _submit(client, candidate.headers, rid, windows, tz="America/New_York")
    assert resp.status_code == 201

    got = client.get(f"{V1}/interviews/{rid}/availability", headers=candidate.headers).json()
    assert got["timezone"] == "America/New_York"  # retained as submission metadata
    w = got["windows"][0]
    start = datetime.fromisoformat(w["start_time"]).astimezone(UTC)
    end = datetime.fromisoformat(w["end_time"]).astimezone(UTC)
    assert start == datetime(*map(int, d.split("-")), 18, 0, tzinfo=UTC)  # 14:00 -04:00
    assert end == datetime(*map(int, d.split("-")), 21, 0, tzinfo=UTC)    # 16:00 -05:00
    assert end - start == timedelta(hours=3)  # real elapsed time, not the 2h wall clock


def test_engine_is_stable_on_a_dst_boundary_reference_date():
    """Engine runs entirely in UTC (FR-019). Reference date = 2026-11-01, the
    night the US zones fall back one hour. All four participant zones change their
    clocks that weekend, yet their working hours still overlap — the engine must
    place valid slots whose UTC spans are exact (no wall-clock arithmetic)."""
    ref = datetime(2026, 11, 1, 0, 0, tzinfo=UTC)
    # candidate window covers the two days around the transition, 12:00–23:00 UTC
    windows = tuple(
        CandidateWindow(ref + timedelta(days=d, hours=12), ref + timedelta(days=d, hours=23))
        for d in range(3)
    )
    participants = (
        Participant("cand", "America/New_York", is_candidate=True),
        Participant("p-ny", "America/New_York"),
        Participant("p-chi", "America/Chicago"),
        Participant("p-den", "America/Denver"),
        Participant("p-la", "America/Los_Angeles"),
    )
    result = generate_recommendations(
        EngineInput(
            reference_time=ref,
            participants=participants,
            candidate_windows=windows,
            constraints=SchedulingConstraints(duration_minutes=60, buffer_minutes=15, top_n=3),
        )
    )
    assert result.slots  # a common slot exists across the DST boundary
    assert [s.rank for s in result.slots] == list(range(1, len(result.slots) + 1))
    for s in result.slots:
        assert s.end_time - s.start_time == timedelta(minutes=60)
        assert 0.0 <= s.total_score <= 1.0


# ------------------------------------ §13: double booking leaves no orphans ----


def test_concurrent_booking_leaves_no_orphan_rows(
    client, make_user, make_calendar_connection, fake_calendar, db_val
):
    """After a booking, a second attempt on the same request conflicts (409) and
    must not create a second event, a second CONFIRMED row, or a reconciliation
    task (CODING_GUIDELINES §Testing — 'no orphaned rows')."""
    ctx = _recommended(client, make_user, make_calendar_connection, fake_calendar)
    assert _book(client, ctx, ctx.slots[0]["id"]).status_code == 201

    second_slot = ctx.slots[1]["id"] if len(ctx.slots) > 1 else ctx.slots[0]["id"]
    assert _book(client, ctx, second_slot).status_code == 409

    assert db_val(
        "SELECT count(*) FROM interview_events WHERE interview_request_id = :r",
        {"r": ctx.rid},
    ) == 1
    assert db_val(
        "SELECT count(*) FROM interview_events "
        "WHERE interview_request_id = :r AND status = 'CONFIRMED'",
        {"r": ctx.rid},
    ) == 1
    assert db_val(
        "SELECT count(*) FROM reconciliation_tasks rt "
        "JOIN interview_events e ON e.id = rt.interview_event_id "
        "WHERE e.interview_request_id = :r",
        {"r": ctx.rid},
    ) == 0
    assert fake_calendar.created_events and len(fake_calendar.created_events) == 1


# ------------------------------- Phase 11: Scheduling Engine load smoke --------


def test_engine_load_smoke_twenty_participants_two_week_window():
    """20+ participants over a 2-week candidate window (IMPLEMENTATION.md Phase 11
    'load-testing the Engine with a larger synthetic participant set'). Zones are
    kept to a working-hours-compatible cluster so scoring actually runs at scale.
    The NFR target is <300ms compute; CI boxes vary, so the bound is a loose
    ceiling, not the target."""
    ref = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)
    zones = ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
             "America/New_York", "America/Chicago"]
    participants = [Participant("cand", "Europe/London", is_candidate=True)]
    for i in range(22):
        tz = zones[i % len(zones)]
        busy = tuple(_iv(ref + timedelta(days=d, hours=15), 60) for d in (i % 5, (i % 5) + 7))
        participants.append(Participant(f"p{i}", tz, busy=busy))
    windows = tuple(
        CandidateWindow(ref + timedelta(days=d, hours=13), ref + timedelta(days=d, hours=18))
        for d in range(14)
    )

    started = _time.perf_counter()
    result = generate_recommendations(
        EngineInput(
            reference_time=ref,
            participants=tuple(participants),
            candidate_windows=windows,
            constraints=SchedulingConstraints(duration_minutes=45, buffer_minutes=15, top_n=3),
        )
    )
    elapsed = _time.perf_counter() - started

    assert len(participants) >= 20
    assert result.slots  # a common slot exists for the whole panel
    assert [s.rank for s in result.slots] == list(range(1, len(result.slots) + 1))
    assert elapsed < 5.0, f"engine took {elapsed:.2f}s for {len(participants)} participants"
