"""The five deterministic scoring factors (requirements.md §8).

Every function is pure: plain data in, a float in [0.0, 1.0] out. No I/O, no
wall-clock, no randomness. Standard library only (`zoneinfo` for tz math).
"""

from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from app.scheduling.types import (
    Participant,
    ScoreBreakdown,
    ScoringWeights,
    WorkingHours,
)


def _clamp(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _local_hours(dt_utc: datetime, tz_name: str) -> float:
    """Time of day, in fractional hours, at `dt_utc` in `tz_name`."""
    local = dt_utc.astimezone(ZoneInfo(tz_name))
    return local.hour + local.minute / 60 + local.second / 3600


def _hours(t) -> float:
    return t.hour + t.minute / 60 + t.second / 3600


# --------------------------------------------------------------------- factors --


def timezone_fairness(slot_mid_utc: datetime, participants: Sequence[Participant],
                      wh: WorkingHours) -> float:
    """Fairness governed by the worst-off participant (min across all)."""
    mid = (_hours(wh.day_start) + _hours(wh.day_end)) / 2
    half_width = (_hours(wh.day_end) - _hours(wh.day_start)) / 2
    per_participant = [
        _clamp(1.0 - abs(_local_hours(slot_mid_utc, p.timezone) - mid) / half_width)
        for p in participants
    ]
    return min(per_participant) if per_participant else 0.0


def working_hours_comfort(slot_mid_utc: datetime, participants: Sequence[Participant],
                          wh: WorkingHours) -> float:
    """Absolute desirability: 1.0 inside the core band, linear decay to the day edge.

    Evaluated per participant, then the worst-off wins (min) — the slot is only as
    comfortable as it is for the least comfortable person.
    """
    day_start, day_end = _hours(wh.day_start), _hours(wh.day_end)
    core_start, core_end = _hours(wh.core_start), _hours(wh.core_end)

    def one(local_mid: float) -> float:
        if core_start <= local_mid <= core_end:
            return 1.0
        if day_start <= local_mid < core_start:
            return _clamp((local_mid - day_start) / (core_start - day_start))
        if core_end < local_mid <= day_end:
            return _clamp((day_end - local_mid) / (day_end - core_end))
        return 0.0

    per_participant = [one(_local_hours(slot_mid_utc, p.timezone)) for p in participants]
    return min(per_participant) if per_participant else 0.0


def scheduling_proximity(slot_start_utc: datetime, reference_time: datetime,
                         horizon_days: int) -> float:
    days_until = (slot_start_utc - reference_time).total_seconds() / 86400.0
    return _clamp(1.0 - days_until / horizon_days)


def workload_balance(slot_start_utc: datetime, panelists: Sequence[Participant],
                     existing_bookings: dict[str, list[datetime]]) -> float:
    """Team-level: averaged across panelists. 1.0 when nobody else has an
    interview on that panelist's local calendar day."""
    if not panelists:
        return 1.0
    scores = []
    for p in panelists:
        local_day = slot_start_utc.astimezone(ZoneInfo(p.timezone)).date()
        count = sum(
            1
            for b in existing_bookings.get(p.participant_id, ())
            if b.astimezone(ZoneInfo(p.timezone)).date() == local_day
        )
        scores.append(1.0 / (1 + count))
    return sum(scores) / len(scores)


def buffer_quality(gap_before_min: float, gap_after_min: float,
                   buffer_minutes: int) -> float:
    """Breathing room beyond the mandatory buffer.

    Per §8: exactly the minimum buffer on both sides scores 0.0; twice the
    minimum available on both sides scores 1.0.
    """
    if buffer_minutes <= 0:
        return 1.0
    extra = min(gap_before_min, gap_after_min) - buffer_minutes
    return _clamp(extra / buffer_minutes)


# ------------------------------------------------------------------ aggregate ---


def weighted_total(breakdown: ScoreBreakdown, weights: ScoringWeights) -> float:
    return (
        weights.timezone_fairness * breakdown.timezone_fairness
        + weights.working_hours_comfort * breakdown.working_hours_comfort
        + weights.scheduling_proximity * breakdown.scheduling_proximity
        + weights.workload_balance * breakdown.workload_balance
        + weights.buffer_quality * breakdown.buffer_quality
    )
