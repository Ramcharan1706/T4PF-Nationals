from dataclasses import dataclass
import hashlib
import re


@dataclass(frozen=True)
class PronunciationResult:
    overall_score: int
    phonemes: list[dict[str, int | str]]
    provider: str = "local-whisper"


class PronunciationScorer:
    def score(
        self,
        *,
        word: str,
        target_sound: str,
        audio_bytes: bytes | None = None,
        transcription: str | None = None,
        content_type: str | None = None,
    ) -> PronunciationResult:
        raise NotImplementedError


class LocalPronunciationScorer(PronunciationScorer):
    """
    Local pronunciation scorer.

    It does not use Azure or any cloud service.
    The speech transcription is supplied by the local Whisper provider.
    """

    @staticmethod
    def _normalize(text: str) -> str:
        text = text.casefold().strip()
        text = re.sub(r"[^a-z0-9\s]", "", text)
        text = re.sub(r"\s+", " ", text)
        return text

    @staticmethod
    def _sound_variants(target_sound: str) -> list[str]:
        sound = target_sound.strip().casefold()

        return {
            "/s/": ["s"],
            "/r/": ["r"],
            "/sh/": ["sh"],
            "/m/": ["m"],
            "/t/": ["t"],
            "/d/": ["d"],
        }.get(sound, [sound.strip("/")])

    def score(
        self,
        *,
        word: str,
        target_sound: str,
        audio_bytes: bytes | None = None,
        transcription: str | None = None,
        content_type: str | None = None,
    ) -> PronunciationResult:

        if not audio_bytes:
            raise ValueError("Audio recording is required")

        expected = self._normalize(word)
        spoken = self._normalize(transcription or "")

        if not expected:
            raise ValueError("Reference word is required")

        # No transcription means Whisper could not recognize usable speech.
        if not spoken:
            return PronunciationResult(
                overall_score=0,
                phonemes=[
                    {
                        "phoneme": target_sound,
                        "score": 0,
                    }
                ],
            )

        # Exact word recognition is the strongest signal.
        if spoken == expected:
            overall = 95
        elif expected in spoken or spoken in expected:
            overall = 82
        else:
            # Compare individual words using a simple character similarity.
            expected_chars = set(expected.replace(" ", ""))
            spoken_chars = set(spoken.replace(" ", ""))

            if expected_chars:
                overlap = len(expected_chars & spoken_chars) / len(expected_chars)
            else:
                overlap = 0.0

            overall = round(45 + overlap * 40)

        # Give a small deterministic adjustment based on the recording,
        # while keeping the result stable for the same recording.
        seed = hashlib.sha256(
            f"{expected}|{target_sound}|{len(audio_bytes)}".encode()
        ).digest()

        adjustment = (seed[0] % 5) - 2
        overall = max(0, min(100, overall + adjustment))

        # Determine whether the target sound appears in the recognized word.
        variants = self._sound_variants(target_sound)

        sound_found = any(
            variant in spoken.replace(" ", "")
            for variant in variants
            if variant
        )

        phoneme_score = overall

        if not sound_found:
            phoneme_score = max(0, overall - 15)

        return PronunciationResult(
            overall_score=overall,
            phonemes=[
                {
                    "phoneme": target_sound,
                    "score": max(0, min(100, phoneme_score)),
                }
            ],
        )


class MockPronunciationScorer(PronunciationScorer):
    """Development-only scorer."""

    def score(
        self,
        *,
        word: str,
        target_sound: str,
        audio_bytes: bytes | None = None,
        transcription: str | None = None,
        content_type: str | None = None,
    ) -> PronunciationResult:

        seed = hashlib.sha256(
            f"{word}|{target_sound}|{len(audio_bytes or b'')}".encode()
        ).digest()

        overall = 60 + seed[0] % 31

        return PronunciationResult(
            overall_score=overall,
            phonemes=[
                {
                    "phoneme": target_sound,
                    "score": max(
                        0,
                        min(100, overall + (seed[1] % 11) - 5),
                    ),
                }
            ],
        )