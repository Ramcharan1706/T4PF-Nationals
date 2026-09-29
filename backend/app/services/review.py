from datetime import date

from app.models import Attempt, Child


def review_priority(child: Child, attempts: list[Attempt]) -> str | None:
    recent = [a.score for a in attempts if a.child_id == child.id][-5:]
    if child.mastery < 50 or (len(recent) >= 3 and sum(recent) / len(recent) < 50):
        return "high"
    if child.adherence < 60 or (len(recent) >= 4 and max(recent) - min(recent) < 8):
        return "medium"
    return None
