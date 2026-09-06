"""Pure data contracts for the Scheduling Engine.

Plain dataclasses only. No imports outside the standard library. The Phase 6
Service maps ORM rows / Calendar data into these before calling the engine, and
maps `EngineResult` back out into `recommendation_runs` / `recommended_slots`.
"""

from dataclasses import dataclass, field
from datetime import datetime, time

ALGORITHM_VERSION = "1.0.0"

FACTOR_NAMES = (
    "timezone_fairness",
    "working_hours_comfort",
    "scheduling_proximity",
    "workload_balance",
    "buffer_quality",
)


class SchedulingEngineError(Exception):
    """Malformed engine input (10-step pipeline, step 2). Never an HTTP concern."""


@dataclass(frozen=True)
class TimeInterval:
    """A half-open [start, end) interval. Both ends tz-aware UTC."""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class WorkingHours:
    """Local-time working-hours preference (MVP: one global value, no overrides)."""

    day_start: time = time(9, 0)
    day_end: time = time(18, 0)
    core_start: time = time(10, 0)
    core_end: time = time(17, 0)


@dataclass(frozen=True)
class Participant:
    participant_id: str
    timezone: str  # IANA name, e.g. "America/New_York"
    is_candidate: bool = False
    # Panelist busy blocks from Google Calendar free/busy (tz-aware UTC).
    # Ignored for the candidate, whose free time is given by candidate_windows.
    busy: tuple[TimeInterval, ...] = ()


@dataclass(frozen=True)
class CandidateWindow:
    start: datetime  # tz-aware UTC
    end: datetime


@dataclass(frozen=True)
class ScoringWeights:
    """requirements.md §8 defaults (sum = 1.00)."""

    timezone_fairness: float = 0.30
    working_hours_comfort: float = 0.20
    scheduling_proximity: float = 0.20
    workload_balance: float = 0.15
    buffer_quality: float = 0.15


@dataclass(frozen=True)
class SchedulingConstraints:
    duration_minutes: int
    buffer_minutes: int
    # Availability validation horizon (matches Phase 4's AVAILABILITY_HORIZON_DAYS).
    horizon_days: int = 21
    # Scheduling-Proximity scoring decay horizon — deliberately separate (G8).
    proximity_horizon_days: int = 14
    slot_step_minutes: int = 15
    top_n: int = 3
    working_hours: WorkingHours = WorkingHours()


@dataclass(frozen=True)
class EngineInput:
    reference_time: datetime  # tz-aware UTC "now"; the engine never calls now()
    participants: tuple[Participant, ...]
    candidate_windows: tuple[CandidateWindow, ...]
    constraints: SchedulingConstraints
    # Per-panelist already-booked interview start times (tz-aware UTC). Bucketed
    # by the panelist's LOCAL calendar day for Workload Balance (G1).
    existing_bookings: dict[str, list[datetime]] = field(default_factory=dict)
    weights: ScoringWeights = ScoringWeights()


@dataclass(frozen=True)
class ScoreBreakdown:
    timezone_fairness: float
    working_hours_comfort: float
    scheduling_proximity: float
    workload_balance: float
    buffer_quality: float

    def as_dict(self) -> dict[str, float]:
        return {name: getattr(self, name) for name in FACTOR_NAMES}


@dataclass(frozen=True)
class ScoredSlot:
    start_time: datetime
    end_time: datetime
    total_score: float
    rank: int
    score_breakdown: ScoreBreakdown
    explanation: str
    relevant_reasoning_factors: tuple[str, ...]


@dataclass(frozen=True)
class EngineResult:
    slots: tuple[ScoredSlot, ...]
    algorithm_version: str = ALGORITHM_VERSION
