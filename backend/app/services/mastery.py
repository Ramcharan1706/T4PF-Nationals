from collections.abc import Sequence
from datetime import date, timedelta


PREVIOUS_WEIGHT = 0.85
LATEST_WEIGHT = 0.15


def update_mastery(previous_mastery: float, latest_score: float) -> float:
    value = PREVIOUS_WEIGHT * previous_mastery + LATEST_WEIGHT * latest_score
    return round(max(0.0, min(100.0, value)), 2)


def average(scores: Sequence[float]) -> float:
    return round(sum(scores) / len(scores), 2) if scores else 0.0


def adherence_percentage(attempts: Sequence[object], cadence_per_week: int, today: date | None = None) -> float:
    """Estimate weekly adherence from unique practice days, capped at the plan cadence."""
    if cadence_per_week <= 0:
        return 0.0
    current = today or date.today()
    cutoff = current - timedelta(days=6)
    days: set[date] = set()
    for attempt in attempts:
        created_at = getattr(attempt, "created_at", None)
        if created_at is None:
            continue
        attempt_date = created_at.date()
        if cutoff <= attempt_date <= current:
            days.add(attempt_date)
    return round(min(100.0, len(days) / cadence_per_week * 100), 2)
