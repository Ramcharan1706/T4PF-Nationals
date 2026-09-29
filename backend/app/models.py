from datetime import date, datetime, timezone
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, ConfigDict, model_validator


class Role(StrEnum):
    therapist = "therapist"
    caregiver = "caregiver"
    child = "child"
    admin = "admin"


class Tier(StrEnum):
    isolation = "Isolation"
    whole_word = "Whole Word"
    sentence = "Sentence"


class User(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    email: str
    username: str | None = None
    role: Role
    organization_id: UUID
    # Present for child accounts; null for therapist/caregiver accounts.
    child_id: UUID | None = None


class LoginRequest(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=320)
    username: str | None = Field(default=None, min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=256)

    @model_validator(mode="after")
    def validate_identifier(self):
        if not self.email and not self.username:
            raise ValueError("Either email or username is required")
        return self


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    username: str | None = Field(default=None, min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=256)
    role: Role = Role.caregiver

    @model_validator(mode="after")
    def validate_public_role(self):
        if self.role != Role.caregiver:
            raise ValueError("Only caregiver accounts can register publicly")
        return self


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User


class Child(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    age: int = Field(ge=1, le=18)
    organization_id: UUID
    therapist_id: UUID
    caregiver_ids: list[UUID] = Field(default_factory=list)
    mastery: float = Field(default=0, ge=0, le=100)
    adherence: float = Field(default=0, ge=0, le=100)
    last_practice: datetime | None = None
    active: bool = True


class ChildUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    age: int = Field(ge=1, le=18)
    caregiver_ids: list[UUID] = Field(default_factory=list)
    caregiver_email: str | None = Field(default=None, min_length=3, max_length=320)
    child_username: str | None = Field(default=None, min_length=3, max_length=80)
    child_password: str | None = Field(default=None, min_length=8, max_length=256)

    @model_validator(mode="after")
    def validate_child_credentials(self):
        if bool(self.child_username) != bool(self.child_password):
            raise ValueError("Child username and password must be provided together")
        return self


class TonguePlacement(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    target_sound: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=120)
    tongue_position: str = Field(min_length=1, max_length=500)
    airflow: str = Field(min_length=1, max_length=500)
    voice: str = Field(min_length=1, max_length=500)
    cue: str = Field(min_length=1, max_length=500)
    caution: str | None = Field(default=None, max_length=500)
    mouth_position: str = Field(default="", max_length=500)
    language: str = Field(default="en", min_length=2, max_length=16)


class TonguePlacementUpdate(BaseModel):
    target_sound: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=120)
    tongue_position: str = Field(min_length=1, max_length=500)
    mouth_position: str = Field(default="", max_length=500)
    airflow: str = Field(min_length=1, max_length=500)
    voice: str = Field(min_length=1, max_length=500)
    cue: str = Field(min_length=1, max_length=500)
    caution: str | None = Field(default=None, max_length=500)
    language: str = Field(default="en", min_length=2, max_length=16)


class NoteUpdate(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


class PlanTarget(BaseModel):
    sound: str
    words: list[str] = Field(min_length=1, max_length=8)
    position: str = Field(default="Initial", min_length=1, max_length=20)

    @model_validator(mode="after")
    def normalize_target(self):
        self.sound = self.sound.strip()
        self.position = self.position.strip()
        if not self.sound:
            raise ValueError("Target sound is required")
        if not self.position:
            raise ValueError("Target position is required")
        self.words = [word.strip() for word in self.words if word and word.strip()]
        if not self.words:
            raise ValueError("At least one practice word is required")
        return self


class TherapyPlan(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    therapist_id: UUID
    targets: list[PlanTarget] = Field(min_length=1, max_length=8)
    tier: Tier
    cadence_per_week: int = Field(default=5, ge=1, le=7)
    review_date: date
    cue: str = ""
    adaptive_recommended_tier: Tier = Tier.whole_word
    therapist_override_tier: Tier | None = None
    active: bool = True
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def effective_tier(self) -> Tier:
        """The tier actually assigned to the child; AI recommendations never silently override it."""
        return self.therapist_override_tier or self.tier


class Session(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None


class ProgressSnapshot(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    mastery: float = Field(ge=0, le=100)
    average_score: float = Field(ge=0, le=100)
    recent_average: float = Field(ge=0, le=100)
    current_tier: Tier
    recommended_tier: Tier
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AttemptCreate(BaseModel):
    child_id: UUID
    session_id: UUID | None = None
    word: str = Field(min_length=1, max_length=80)
    target_sound: str = Field(default="/s/", max_length=20)
    word_position: str = Field(default="Initial", min_length=1, max_length=20)
    # The score is accepted only by test-mode fixtures. Production scoring must
    # happen on the server after the uploaded audio has been assessed.
    score: float | None = Field(default=None, ge=0, le=100)
    scoring_token: str | None = Field(default=None, min_length=20, max_length=4096)
    transcription: str | None = Field(default=None, max_length=500)
    transcription_status: str = "pending"
    scoring_status: str = "pending"
    duration_ms: int | None = Field(default=None, ge=0, le=120000)

    @model_validator(mode="after")
    def validate_practice_fields(self):
        self.word = self.word.strip()
        self.target_sound = self.target_sound.strip()
        if not self.word:
            raise ValueError("Word is required")
        if not self.target_sound:
            raise ValueError("Target sound is required")
        return self


class Attempt(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    session_id: UUID
    word: str
    target_sound: str
    score: float
    word_position: str = "Initial"
    transcription: str | None = None
    transcription_status: str
    scoring_status: str
    duration_ms: int | None = None
    audio_path: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TherapistTransfer(BaseModel):
    therapist_id: UUID


class ConsentRecord(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    organization_id: UUID
    granted_by: UUID
    consent_type: str = Field(min_length=1, max_length=80)
    granted: bool
    expires_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Progress(BaseModel):
    child_id: UUID
    attempt_count: int
    average_score: float
    recent_average: float
    mastery: float
    adherence: float
    last_attempt: datetime | None
    current_tier: Tier
    recommended_tier: Tier


class NoteCreate(BaseModel):
    child_id: UUID
    note: str = Field(min_length=1, max_length=4000)


class Note(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    therapist_id: UUID
    note: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MessageCreate(BaseModel):
    child_id: UUID
    recipient_user_id: UUID
    body: str = Field(min_length=1, max_length=4000)


class Message(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    child_id: UUID
    sender_user_id: UUID
    recipient_user_id: UUID
    body: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CurriculumWord(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    word: str
    phonemes: list[str]
    target_sound: str
    word_position: str
    syllable_count: int
    difficulty: str
    age_band: str
    tier: Tier
    child_friendly: bool = True
    active: bool = True


class AuditEvent(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    organization_id: UUID
    actor_user_id: UUID
    action: str
    resource_type: str
    resource_id: UUID | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = Field(default_factory=dict)


class CostUsage(BaseModel):
    sessions: int = 0
    attempts: int = 0
    audio_minutes: float = 0
    stt_usage: int = 0
    ai_requests: int = 0
    ai_tokens: int = 0
    pronunciation_requests: int = 0
    tts_usage: int = 0
    estimated_cost: float = 0
    cost_per_session: float = 0


class PlanUpdate(BaseModel):
    targets: list[PlanTarget]
    tier: Tier
    cadence_per_week: int = Field(ge=1, le=7)
    review_date: date
    cue: str = Field(default="", max_length=500)
    therapist_override_tier: Tier | None = None
