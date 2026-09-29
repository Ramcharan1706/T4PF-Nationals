from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt

from app.config import settings
from app.models import User


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> UUID:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid or expired access token") from exc


def create_realtime_ticket(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "realtime-ticket",
        "sub": str(user.id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=2)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_realtime_ticket(token: str) -> UUID:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("typ") != "realtime-ticket":
            raise ValueError("Invalid realtime ticket")
        return UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid or expired realtime ticket") from exc


def create_scoring_token(*, child_id: UUID, session_id: UUID, word: str, target_sound: str, word_position: str = "Initial", score: float, transcription: str | None, provider: str, audio_path: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "speech-score",
        "child_id": str(child_id),
        "session_id": str(session_id),
        "word": word.casefold(),
        "target_sound": target_sound,
        "word_position": word_position,
        "score": score,
        "transcription": transcription,
        "provider": provider,
        "audio_path": audio_path,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_scoring_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("typ") != "speech-score":
            raise ValueError("Invalid scoring token")
        return payload
    except (jwt.InvalidTokenError, TypeError, ValueError) as exc:
        raise ValueError("Invalid or expired scoring token") from exc
