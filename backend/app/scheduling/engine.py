"""The Scheduling Engine — the pure 10-step pipeline (requirements.md §7c).

Plain data in (`EngineInput`), plain data out (`EngineResult`). No I/O, no
wall-clock, no randomness. Standard library only.

Pipeline: normalize -> validate -> merge busy -> free intervals -> intersect ->
apply duration/buffer/working-hours -> generate candidate slots -> score ->
rank -> return top-N with breakdown + explanation.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.scheduling import scoring
from app.scheduling.explain import build_explanation
from app.scheduling.types import (
    CandidateWindow,
    EngineInput,
    EngineResult,
    Participant,
    SchedulingEngineError,
    ScoreBreakdown,
    ScoredSlot,
    TimeInterval,
)

# ---------------------------------------------------------------- interval math -


def _as_utc(dt: datetime, label: str) -> datetime:
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise SchedulingEngineError(f"{label} must be timezone-aware")
    return dt.astimezone(UTC)


def _merge(intervals: list[TimeInterval]) -> list[TimeInterval]:
    """Sort and coalesce overlapping or touching intervals."""
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda i: i.start)
    merged = [ordered[0]]
    for cur in ordered[1:]:
        last = merged[-1]
        if cur.start <= last.end:
            if cur.end > last.end:
                merged[-1] = TimeInterval(last.start, cur.end)
        else:
            merged.append(cur)
    return merged


def _subtract(base: list[TimeInterval], cuts: list[TimeInterval]) -> list[TimeInterval]:
    """base minus cuts (both need not be pre-merged)."""
    result = list(base)
    for cut in _merge(cuts):
        nxt: list[TimeInterval] = []
        for iv in result:
            if cut.end <= iv.start or cut.start >= iv.end:
                nxt.append(iv)
                continue
            if cut.start > iv.start:
                nxt.append(TimeInterval(iv.start, cut.start))
            if cut.end < iv.end:
                nxt.append(TimeInterval(cut.end, iv.end))
        result = nxt
    return result


def _intersect(a: list[TimeInterval], b: list[TimeInterval]) -> list[TimeInterval]:
    a, b = _merge(a), _merge(b)
    out: list[TimeInterval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        lo = max(a[i].start, b[j].start)
        hi = min(a[i].end, b[j].end)
        if lo < hi:
            out.append(TimeInterval(lo, hi))
        if a[i].end < b[j].end:
            i += 1
        else:
            j += 1
    return out


def _clip(intervals: list[TimeInterval], lo: datetime, hi: datetime) -> list[TimeInterval]:
    out = []
    for iv in intervals:
        s, e = max(iv.start, lo), min(iv.end, hi)
        if s < e:
            out.append(TimeInterval(s, e))
    return out


# ------------------------------------------------------------------ steps 1-2 ---


def _validate(inp: EngineInput) -> None:
    c = inp.constraints
    if c.duration_minutes <= 0:
        raise SchedulingEngineError("duration_minutes must be > 0")
    if c.buffer_minutes < 0:
        raise SchedulingEngineError("buffer_minutes must be >= 0")
    if c.slot_step_minutes <= 0:
        raise SchedulingEngineError("slot_step_minutes must be > 0")
    if c.top_n <= 0:
        raise SchedulingEngineError("top_n must be > 0")
    if c.proximity_horizon_days <= 0:
        raise SchedulingEngineError("proximity_horizon_days must be > 0")

    ref = _as_utc(inp.reference_time, "reference_time")
    horizon_end = ref + timedelta(days=c.horizon_days)

    candidates = [p for p in inp.participants if p.is_candidate]
    if len(candidates) != 1:
        raise SchedulingEngineError("exactly one participant must be the candidate")
    if not [p for p in inp.participants if not p.is_candidate]:
        raise SchedulingEngineError("at least one panelist is required")
    for p in inp.participants:
        try:
            ZoneInfo(p.timezone)
        except Exception as exc:  # noqa: BLE001 - surface as an engine input error
            raise SchedulingEngineError(f"invalid timezone: {p.timezone!r}") from exc
        for b in p.busy:
            if _as_utc(b.end, "busy.end") <= _as_utc(b.start, "busy.start"):
                raise SchedulingEngineError("busy interval end must be after start")

    if not inp.candidate_windows:
        raise SchedulingEngineError("at least one candidate availability window is required")
    for w in inp.candidate_windows:
        s, e = _as_utc(w.start, "window.start"), _as_utc(w.end, "window.end")
        if e <= s:
            raise SchedulingEngineError("window end must be after start")
        if s < ref:
            raise SchedulingEngineError("window start must not be in the past")
        if e > horizon_end:
            raise SchedulingEngineError(
                f"window must fall within {c.horizon_days} days of reference_time"
            )


def _normalize_windows(windows: tuple[CandidateWindow, ...]) -> list[TimeInterval]:
    return [
        TimeInterval(w.start.astimezone(UTC), w.end.astimezone(UTC)) for w in windows
    ]


# ---------------------------------------------------------------- steps 3-5 -----


def _working_intervals(
    participant: Participant, span: TimeInterval, wh
) -> list[TimeInterval]:
    """Per local calendar day in `span`: the participant's working-hours window."""
    tz = ZoneInfo(participant.timezone)
    d = span.start.astimezone(tz).date()
    last = span.end.astimezone(tz).date()
    out: list[TimeInterval] = []
    while d <= last:
        start_local = datetime.combine(d, wh.day_start, tzinfo=tz)
        end_local = datetime.combine(d, wh.day_end, tzinfo=tz)
        out.append(TimeInterval(start_local.astimezone(UTC), end_local.astimezone(UTC)))
        d += timedelta(days=1)
    return _merge(out)


def _free_intervals(inp: EngineInput, windows: list[TimeInterval]) -> list[TimeInterval]:
    span = TimeInterval(
        min(w.start for w in windows), max(w.end for w in windows)
    )
    wh = inp.constraints.working_hours
    merged_windows = _merge(windows)

    per_participant: list[list[TimeInterval]] = []
    for p in inp.participants:
        working = _working_intervals(p, span, wh)
        if p.is_candidate:
            free = _intersect(working, merged_windows)
        else:
            busy = [
                TimeInterval(b.start.astimezone(UTC), b.end.astimezone(UTC)) for b in p.busy
            ]
            free = _subtract(working, busy)
        per_participant.append(_clip(free, span.start, span.end))

    common = per_participant[0]
    for nxt in per_participant[1:]:
        common = _intersect(common, nxt)
    return common


# ---------------------------------------------------------------- steps 6-10 ----


def _score(
    inp: EngineInput, interval: TimeInterval, start: datetime
) -> tuple[ScoreBreakdown, float]:
    c = inp.constraints
    dur = timedelta(minutes=c.duration_minutes)
    end = start + dur
    mid = start + dur / 2
    panelists = [p for p in inp.participants if not p.is_candidate]

    gap_before = (start - interval.start).total_seconds() / 60
    gap_after = (interval.end - end).total_seconds() / 60

    breakdown = ScoreBreakdown(
        timezone_fairness=scoring.timezone_fairness(mid, inp.participants, c.working_hours),
        working_hours_comfort=scoring.working_hours_comfort(
            mid, inp.participants, c.working_hours
        ),
        scheduling_proximity=scoring.scheduling_proximity(
            start, inp.reference_time.astimezone(UTC), c.proximity_horizon_days
        ),
        workload_balance=scoring.workload_balance(start, panelists, inp.existing_bookings),
        buffer_quality=scoring.buffer_quality(gap_before, gap_after, c.buffer_minutes),
    )
    return breakdown, scoring.weighted_total(breakdown, inp.weights)


def generate_recommendations(inp: EngineInput) -> EngineResult:
    """Run the full 10-step pipeline and return the ranked top-N."""
    _validate(inp)  # steps 1-2
    windows = _normalize_windows(inp.candidate_windows)

    common_free = _free_intervals(inp, windows)  # steps 3-5

    c = inp.constraints
    dur = timedelta(minutes=c.duration_minutes)
    buf = timedelta(minutes=c.buffer_minutes)
    step = timedelta(minutes=c.slot_step_minutes)
    needed = dur + 2 * buf  # buffer on BOTH sides (requirements.md §8)

    raw: list[tuple[datetime, datetime, ScoreBreakdown, float]] = []
    for iv in common_free:  # step 6
        if iv.end - iv.start < needed:
            continue
        t = iv.start + buf  # step 7
        latest = iv.end - dur - buf
        while t <= latest:
            breakdown, total = _score(inp, iv, t)  # step 8
            raw.append((t, t + dur, breakdown, total))
            t += step

    # step 9: rank by score desc, deterministic tie-break on earlier start.
    raw.sort(key=lambda r: (-r[3], r[0]))

    slots: list[ScoredSlot] = []
    for rank, (start, end, breakdown, total) in enumerate(raw[: c.top_n], start=1):  # step 10
        explanation, factors = build_explanation(breakdown, inp.weights)
        slots.append(
            ScoredSlot(
                start_time=start,
                end_time=end,
                total_score=total,
                rank=rank,
                score_breakdown=breakdown,
                explanation=explanation,
                relevant_reasoning_factors=factors,
            )
        )
    return EngineResult(slots=tuple(slots))
