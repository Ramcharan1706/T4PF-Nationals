from dataclasses import dataclass

from app.models import Tier


@dataclass(frozen=True)
class AdaptiveResult:
    recommended_tier: Tier
    reason: str


# Keep thresholds centralized and transparent.
ISOLATION_MAX = 54.99
WHOLE_WORD_MAX = 74.99


def select_tier(mastery: float) -> AdaptiveResult:
    if mastery < 55:
        return AdaptiveResult(Tier.isolation, "Mastery is below 55%, so practice stays at isolation.")
    if mastery < 75:
        return AdaptiveResult(Tier.whole_word, "Mastery is currently in the whole-word practice range.")
    return AdaptiveResult(Tier.sentence, "Mastery is 75% or higher, so short sentence practice is recommended.")
