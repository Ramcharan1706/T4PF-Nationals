from app.models import Tier
from uuid import UUID
from app.services.adaptive import select_tier
from app.services.mastery import adherence_percentage, update_mastery


def test_adaptive_thresholds():
    assert select_tier(40).recommended_tier == Tier.isolation
    assert select_tier(60).recommended_tier == Tier.whole_word
    assert select_tier(80).recommended_tier == Tier.sentence


def test_mastery_formula():
    assert update_mastery(60, 80) == 63
    assert update_mastery(0, 100) == 15


def test_adherence_counts_unique_practice_days():
    from datetime import datetime, timedelta, timezone
    from app.models import Attempt

    now = datetime.now(timezone.utc)
    attempts = [
        Attempt(child_id=UUID("55555555-5555-5555-5555-555555555551"), session_id=UUID(int=i + 1), word="sun", target_sound="/s/", score=80, transcription_status="mocked", scoring_status="development/mock", created_at=now - timedelta(days=i))
        for i in range(4)
    ]
    assert adherence_percentage(attempts, 5, today=now.date()) == 80
