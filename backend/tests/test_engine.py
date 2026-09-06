"""Pipeline-level tests for the Scheduling Engine (requirements.md §7c, §8)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.scheduling import scoring
from app.scheduling.engine import generate_recommendations
from app.scheduling.types import (
    FACTOR_NAMES,
    CandidateWindow,
    EngineInput,
    Participant,
    SchedulingConstraints,
    SchedulingEngineError,
    ScoringWeights,
    TimeInterval,
)

REF = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)  # Monday, no DST edge nearby
CAND = Participant("cand", "UTC", is_candidate=True)
PANEL = Participant("p1", "UTC")


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return REF + timedelta(days=day, hours=hour, minutes=minute)


def _input(windows, *, participants=(CAND, PANEL), duration=60, buffer=15,
           weights=None, bookings=None, top_n=3) -> EngineInput:
    return EngineInput(
        reference_time=REF,
        participants=tuple(participants),
        candidate_windows=tuple(windows),
        constraints=SchedulingConstraints(
            duration_minutes=duration, buffer_minutes=buffer, top_n=top_n
        ),
        existing_bookings=bookings or {},
        weights=weights or ScoringWeights(),
    )


# --------------------------------------------------------------- core outcomes --


def test_no_common_availability_returns_empty():
    # candidate free Tue 10-12, panelist busy the whole of Tue 10-12
    windows = [CandidateWindow(_at(1, 10), _at(1, 12))]
    panel = Participant("p1", "UTC", busy=(TimeInterval(_at(1, 10), _at(1, 12)),))
    result = generate_recommendations(_input(windows, participants=(CAND, panel)))
    assert result.slots == ()


def test_window_too_short_returns_empty():
    # 60-min window can't hold duration(60) + 2*buffer(15)
    result = generate_recommendations(_input([CandidateWindow(_at(1, 10), _at(1, 11))]))
    assert result.slots == ()


def test_exactly_one_slot():
    # 90-min window == duration + 2*buffer -> exactly one placement
    result = generate_recommendations(_input([CandidateWindow(_at(1, 10), _at(1, 11, 30))]))
    assert len(result.slots) == 1
    only = result.slots[0]
    assert only.rank == 1
    assert only.start_time == _at(1, 10, 15)
    assert only.end_time == _at(1, 11, 15)


def test_ranking_prefers_sooner_when_all_else_equal():
    # identical time-of-day on two different days -> only proximity differs
    windows = [
        CandidateWindow(_at(1, 12), _at(1, 13, 30)),  # Tue
        CandidateWindow(_at(4, 12), _at(4, 13, 30)),  # Fri
    ]
    slots = generate_recommendations(_input(windows)).slots
    assert [s.rank for s in slots] == [1, 2]
    assert slots[0].start_time == _at(1, 12, 15)
    assert slots[1].start_time == _at(4, 12, 15)
    assert slots[0].total_score > slots[1].total_score
    b0, b1 = slots[0].score_breakdown.as_dict(), slots[1].score_breakdown.as_dict()
    differing = [k for k in FACTOR_NAMES if b0[k] != b1[k]]
    assert differing == ["scheduling_proximity"]


def test_deterministic_tie_break_on_earlier_start():
    # weight only buffer_quality; slots with >= 2x buffer on both sides all score
    # 1.0, so ranking is a pure earliest-start tie-break. The very first placement
    # (t == interval.start + buffer) has only the minimum buffer before it, so the
    # first 1.0 slot is one step later.
    weights = ScoringWeights(
        timezone_fairness=0.0, working_hours_comfort=0.0, scheduling_proximity=0.0,
        workload_balance=0.0, buffer_quality=1.0,
    )
    windows = [CandidateWindow(_at(1, 9), _at(1, 18))]
    slots = generate_recommendations(_input(windows, weights=weights)).slots
    assert len(slots) == 3
    assert [s.rank for s in slots] == [1, 2, 3]
    assert slots[0].start_time == _at(1, 9, 30)
    assert slots[1].start_time == _at(1, 9, 45)
    assert slots[2].start_time == _at(1, 10, 0)
    assert slots[0].total_score == slots[1].total_score == slots[2].total_score == 1.0


def test_top_n_is_respected():
    windows = [CandidateWindow(_at(1, 9), _at(1, 18))]
    assert len(generate_recommendations(_input(windows, top_n=2)).slots) == 2
    assert len(generate_recommendations(_input(windows, top_n=5)).slots) == 5


# --------------------------------------------------------- breakdown integrity --


def test_breakdown_keys_and_total_consistent_with_weights():
    windows = [CandidateWindow(_at(2, 10), _at(2, 16))]
    weights = ScoringWeights()
    for s in generate_recommendations(_input(windows, weights=weights)).slots:
        assert tuple(s.score_breakdown.as_dict()) == FACTOR_NAMES
        recomputed = scoring.weighted_total(s.score_breakdown, weights)
        assert abs(s.total_score - recomputed) < 1e-9
        assert 0.0 <= s.total_score <= 1.0


def test_engine_is_deterministic():
    windows = [CandidateWindow(_at(1, 9), _at(1, 18)), CandidateWindow(_at(3, 9), _at(3, 15))]
    a = generate_recommendations(_input(windows))
    b = generate_recommendations(_input(windows))
    assert a == b


def test_workload_balance_lowers_score_for_busy_panelist_day():
    windows = [CandidateWindow(_at(1, 12), _at(1, 13, 30))]
    free = generate_recommendations(_input(windows)).slots[0]
    loaded = generate_recommendations(
        _input(windows, bookings={"p1": [_at(1, 8)]})
    ).slots[0]
    assert loaded.score_breakdown.workload_balance < free.score_breakdown.workload_balance
    assert loaded.total_score < free.total_score


def test_explanation_names_a_top_factor():
    windows = [CandidateWindow(_at(1, 12), _at(1, 13, 30))]
    s = generate_recommendations(_input(windows)).slots[0]
    assert s.relevant_reasoning_factors
    assert all(f in FACTOR_NAMES for f in s.relevant_reasoning_factors)
    assert s.explanation.startswith("Strong ")


# ------------------------------------------------------------------ validation --


@pytest.mark.parametrize(
    "windows",
    [
        [],  # no windows
        [CandidateWindow(_at(1, 12), _at(1, 12))],  # end == start
        [CandidateWindow(_at(1, 13), _at(1, 12))],  # end < start
        [CandidateWindow(_at(-1, 12), _at(-1, 13))],  # in the past
        [CandidateWindow(_at(60, 12), _at(60, 13))],  # beyond 21-day horizon
    ],
)
def test_invalid_windows_raise(windows):
    with pytest.raises(SchedulingEngineError):
        generate_recommendations(_input(windows))


def test_missing_candidate_raises():
    windows = [CandidateWindow(_at(1, 10), _at(1, 12))]
    with pytest.raises(SchedulingEngineError):
        generate_recommendations(_input(windows, participants=(PANEL, PANEL)))


def test_missing_panelist_raises():
    windows = [CandidateWindow(_at(1, 10), _at(1, 12))]
    with pytest.raises(SchedulingEngineError):
        generate_recommendations(_input(windows, participants=(CAND,)))


def test_naive_datetime_raises():
    naive = datetime(2026, 6, 2, 10, 0)  # no tzinfo
    with pytest.raises(SchedulingEngineError):
        generate_recommendations(_input([CandidateWindow(naive, naive)]))


# ------------------------------------------------------------------------ dst ---


def test_dst_boundary_window_does_not_crash():
    # US DST 2026 begins Sun 2026-03-08 02:00 local.
    ref = datetime(2026, 3, 2, 0, 0, tzinfo=UTC)
    cand = Participant("c", "America/New_York", is_candidate=True)
    panel = Participant("p", "America/New_York")
    win = CandidateWindow(
        datetime(2026, 3, 9, 13, 0, tzinfo=UTC), datetime(2026, 3, 9, 20, 0, tzinfo=UTC)
    )
    inp = EngineInput(
        reference_time=ref,
        participants=(cand, panel),
        candidate_windows=(win,),
        constraints=SchedulingConstraints(duration_minutes=60, buffer_minutes=15),
    )
    result = generate_recommendations(inp)
    assert all(s.end_time > s.start_time for s in result.slots)
