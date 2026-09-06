"""Boundary tests for the five scoring factors (requirements.md §8)."""

from datetime import UTC, datetime, timedelta

from app.scheduling import scoring
from app.scheduling.types import (
    Participant,
    ScoreBreakdown,
    ScoringWeights,
    WorkingHours,
)

WH = WorkingHours()
REF = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)  # summer; no DST edge in these tests


def _utc(y=2026, m=6, d=2, h=0, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=UTC)


# ------------------------------------------------------- timezone_fairness ------


def test_timezone_fairness_centered_is_one():
    # 13:30 local == working-hours midpoint -> 1.0
    p = Participant("x", "UTC")
    assert scoring.timezone_fairness(_utc(h=13, mn=30), [p], WH) == 1.0


def test_timezone_fairness_day_edge_is_zero():
    p = Participant("x", "UTC")
    assert scoring.timezone_fairness(_utc(h=9), [p], WH) == 0.0
    assert scoring.timezone_fairness(_utc(h=18), [p], WH) == 0.0


def test_timezone_fairness_is_worst_participant():
    good = Participant("g", "UTC")  # 13:30 local -> 1.0
    bad = Participant("b", "Asia/Kolkata")  # 13:30 UTC == 19:00 IST -> past the edge
    assert scoring.timezone_fairness(_utc(h=13, mn=30), [good, bad], WH) == 0.0


# --------------------------------------------------- working_hours_comfort ------


def test_working_hours_comfort_core_band_is_one():
    p = Participant("x", "UTC")
    assert scoring.working_hours_comfort(_utc(h=13), [p], WH) == 1.0


def test_working_hours_comfort_linear_decay():
    p = Participant("x", "UTC")
    assert scoring.working_hours_comfort(_utc(h=9, mn=30), [p], WH) == 0.5
    assert scoring.working_hours_comfort(_utc(h=17, mn=30), [p], WH) == 0.5


def test_working_hours_comfort_outside_day_is_zero():
    p = Participant("x", "UTC")
    assert scoring.working_hours_comfort(_utc(h=8), [p], WH) == 0.0


# --------------------------------------------------- scheduling_proximity -------


def test_scheduling_proximity_now_is_one():
    assert scoring.scheduling_proximity(REF, REF, 14) == 1.0


def test_scheduling_proximity_half_horizon():
    assert scoring.scheduling_proximity(REF + timedelta(days=7), REF, 14) == 0.5


def test_scheduling_proximity_beyond_horizon_clamped():
    assert scoring.scheduling_proximity(REF + timedelta(days=20), REF, 14) == 0.0


# ------------------------------------------------------- workload_balance -------


def test_workload_balance_no_bookings_is_one():
    p = Participant("p", "UTC")
    assert scoring.workload_balance(_utc(h=12), [p], {}) == 1.0


def test_workload_balance_one_same_day_booking_is_half():
    p = Participant("p", "UTC")
    bookings = {"p": [_utc(h=9)]}
    assert scoring.workload_balance(_utc(h=12), [p], bookings) == 0.5


def test_workload_balance_averaged_across_panelists():
    a = Participant("a", "UTC")
    b = Participant("b", "UTC")
    bookings = {"a": [_utc(h=9)]}  # a busy that day, b free
    assert scoring.workload_balance(_utc(h=12), [a, b], bookings) == 0.75


def test_workload_balance_other_day_booking_ignored():
    p = Participant("p", "UTC")
    bookings = {"p": [_utc(d=5, h=9)]}
    assert scoring.workload_balance(_utc(d=2, h=12), [p], bookings) == 1.0


# ---------------------------------------------------------- buffer_quality ------


def test_buffer_quality_minimum_is_zero():
    assert scoring.buffer_quality(15, 15, 15) == 0.0


def test_buffer_quality_double_is_one():
    assert scoring.buffer_quality(30, 30, 15) == 1.0


def test_buffer_quality_uses_tighter_side():
    assert scoring.buffer_quality(60, 20, 15) == (20 - 15) / 15


def test_buffer_quality_clamped_above_one():
    assert scoring.buffer_quality(100, 100, 15) == 1.0


# ------------------------------------------------------------- weighted_total ---


def test_weighted_total_matches_documented_weights():
    b = ScoreBreakdown(1.0, 1.0, 1.0, 1.0, 1.0)
    assert abs(scoring.weighted_total(b, ScoringWeights()) - 1.0) < 1e-9
    b2 = ScoreBreakdown(0.5, 0.0, 1.0, 0.0, 0.0)
    assert abs(scoring.weighted_total(b2, ScoringWeights()) - (0.30 * 0.5 + 0.20)) < 1e-9
