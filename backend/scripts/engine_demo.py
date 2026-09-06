"""Synthetic demo of the pure Scheduling Engine.

    python -m scripts.engine_demo

No database, no network — fixed inputs and a fixed reference_time, so the output
is fully deterministic.
"""

from datetime import UTC, datetime, timedelta

from app.scheduling.engine import generate_recommendations
from app.scheduling.types import (
    CandidateWindow,
    EngineInput,
    Participant,
    SchedulingConstraints,
    TimeInterval,
)

REF = datetime(2026, 9, 7, 0, 0, tzinfo=UTC)  # a Monday, fixed


def _at(day_offset: int, hour: int, minute: int = 0) -> datetime:
    return REF + timedelta(days=day_offset, hours=hour, minutes=minute)


def build_input() -> EngineInput:
    # NY 09-18 local == 13-22 UTC, London 09-18 == 08-17 UTC,
    # Chicago 09-18 == 14-23 UTC  ->  common working window ~14:00-17:00 UTC.
    candidate = Participant("cand", "America/New_York", is_candidate=True)
    panel_ldn = Participant(
        "p-london",
        "Europe/London",
        busy=(TimeInterval(_at(2, 15), _at(2, 16, 30)),),  # busy Wed 15:00-16:30 UTC
    )
    panel_chi = Participant("p-chicago", "America/Chicago")

    windows = (
        CandidateWindow(_at(1, 12), _at(1, 20)),  # Tue 12:00-20:00 UTC
        CandidateWindow(_at(2, 12), _at(2, 20)),  # Wed
        CandidateWindow(_at(4, 12), _at(4, 20)),  # Fri
    )
    constraints = SchedulingConstraints(duration_minutes=60, buffer_minutes=15)
    existing = {"p-chicago": [_at(1, 15)]}  # Chicago panelist already has a Tue interview

    return EngineInput(
        reference_time=REF,
        participants=(candidate, panel_ldn, panel_chi),
        candidate_windows=windows,
        constraints=constraints,
        existing_bookings=existing,
    )


def main() -> None:
    result = generate_recommendations(build_input())
    print(f"algorithm_version = {result.algorithm_version}")
    print(f"{len(result.slots)} recommended slot(s):\n")
    for s in result.slots:
        print(
            f"  #{s.rank}  {s.start_time:%a %Y-%m-%d %H:%M}-{s.end_time:%H:%M} UTC"
            f"   total={s.total_score:.3f}"
        )
        for name, val in s.score_breakdown.as_dict().items():
            print(f"        {name:<22} {val:.3f}")
        print(f"        -> {s.explanation}")
        print(f"        factors: {', '.join(s.relevant_reasoning_factors)}\n")


if __name__ == "__main__":
    main()
