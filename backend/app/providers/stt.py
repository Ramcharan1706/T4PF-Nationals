import asyncio
import tempfile
from pathlib import Path


class LocalWhisperProvider:
    """Local Whisper transcription through faster-whisper."""

    def __init__(self, model_name: str = "base") -> None:
        self.model_name = model_name
        self._model = None

    def _transcribe_file(self, path: str) -> str:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("faster-whisper is not installed") from exc
        if self._model is None:
            self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
        segments, _ = self._model.transcribe(path, beam_size=5, vad_filter=True)
        return " ".join(segment.text.strip() for segment in segments).strip()

    async def transcribe(self, audio_bytes: bytes) -> str:
        if not audio_bytes:
            raise ValueError("Audio recording is required")
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as temporary:
            temporary.write(audio_bytes)
            path = temporary.name
        try:
            transcript = await asyncio.to_thread(self._transcribe_file, path)
            if not transcript:
                raise RuntimeError("Whisper returned an empty transcript")
            return transcript[:500]
        finally:
            Path(path).unlink(missing_ok=True)
