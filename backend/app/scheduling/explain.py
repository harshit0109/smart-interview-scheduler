"""Human-readable explanation for a scored slot (requirements.md §8).

Assembled deterministically from the same ScoreBreakdown returned to the API —
never a separate heuristic. Names the 1-2 factors that contributed most (by
weighted contribution) and, when a factor is materially weak, one honest
trade-off.
"""

from app.scheduling.types import FACTOR_NAMES, ScoreBreakdown, ScoringWeights

_STRENGTH_PHRASE = {
    "timezone_fairness": "balanced timezone fairness across participants",
    "working_hours_comfort": "comfortable working-hours placement",
    "scheduling_proximity": "how soon it can happen",
    "workload_balance": "light interviewer workload",
    "buffer_quality": "generous buffer time on both sides",
}

_TRADEOFF_PHRASE = {
    "timezone_fairness": "less balanced across time zones than other options",
    "working_hours_comfort": "close to the edge of the working day for someone",
    "scheduling_proximity": "later than the earliest available option",
    "workload_balance": "on a day an interviewer already has interviews",
    "buffer_quality": "with only the minimum buffer on at least one side",
}

_TRADEOFF_THRESHOLD = 0.6


def build_explanation(
    breakdown: ScoreBreakdown, weights: ScoringWeights
) -> tuple[str, tuple[str, ...]]:
    values = breakdown.as_dict()
    weight_map = {name: getattr(weights, name) for name in FACTOR_NAMES}

    # Rank by weighted contribution; stable tie-break on factor name.
    contributions = sorted(
        FACTOR_NAMES,
        key=lambda n: (-(weight_map[n] * values[n]), n),
    )
    top = tuple(contributions[:2])

    if len(top) == 2:
        strengths = f"{_STRENGTH_PHRASE[top[0]]} and {_STRENGTH_PHRASE[top[1]]}"
    else:
        strengths = _STRENGTH_PHRASE[top[0]]
    sentence = f"Strong {strengths}."

    # Trade-off: the weakest factor overall, if it is genuinely weak and not
    # already sold as a strength.
    weakest = min(FACTOR_NAMES, key=lambda n: (values[n], n))
    if values[weakest] < _TRADEOFF_THRESHOLD and weakest not in top:
        sentence += f" Trade-off: {_TRADEOFF_PHRASE[weakest]}."

    return sentence, top
