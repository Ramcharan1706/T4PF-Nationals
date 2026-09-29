from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable, TypeVar
from uuid import UUID, uuid4
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import threading

import httpx

from app.config import settings
from app.models import (
    Attempt, Session, ProgressSnapshot, AuditEvent, Child, CurriculumWord,
    Message, Note, TherapyPlan, User, Role, Tier, PlanTarget, CostUsage, TonguePlacement,
    ConsentRecord,
)


logger = logging.getLogger("app.repository")


class RepositoryError(RuntimeError):
    """A safe, expected repository failure that can be mapped to an API response."""


class RepositoryUnavailableError(RepositoryError):
    """The database or Supabase service could not complete the operation."""


class DuplicateUserError(ValueError):
    """The requested email or username is already registered."""


class OrganizationNotFoundError(RepositoryError):
    """The configured registration organization is missing from the database."""


class RepositorySchemaError(RepositoryError):
    """A required Supabase table or schema object is missing."""


class RepositoryAuthConfigurationError(RepositoryError):
    """Supabase rejected the server credential configuration."""


class Repository:
    def users(self) -> list[User]: raise NotImplementedError
    def children(self) -> list[Child]: raise NotImplementedError
    def plans(self) -> list[TherapyPlan]: raise NotImplementedError
    def attempts(self) -> list[Attempt]: raise NotImplementedError
    def sessions(self) -> list[Session]: raise NotImplementedError
    def progress_snapshots(self) -> list[ProgressSnapshot]: raise NotImplementedError
    def notes(self) -> list[Note]: raise NotImplementedError
    def messages(self) -> list[Message]: raise NotImplementedError
    def curriculum(self) -> list[CurriculumWord]: raise NotImplementedError
    def audits(self) -> list[AuditEvent]: raise NotImplementedError
    def tongue_placements(self) -> list[TonguePlacement]: raise NotImplementedError
    def create_user(self, user: User, password: str) -> User: raise NotImplementedError
    def delete_user(self, user_id: UUID) -> None: raise NotImplementedError
    def organization_exists(self, organization_id: UUID) -> bool: raise NotImplementedError

    def add_plan(self, plan: TherapyPlan) -> TherapyPlan: raise NotImplementedError
    def add_child(self, child: Child) -> Child: raise NotImplementedError
    def link_child_user(self, child_id: UUID, user_id: UUID) -> None: raise NotImplementedError
    def delete_child(self, child_id: UUID) -> None: raise NotImplementedError
    def update_plan(self, plan: TherapyPlan) -> TherapyPlan: raise NotImplementedError
    def add_session(self, session: Session) -> Session: raise NotImplementedError
    def update_session(self, session: Session) -> Session: raise NotImplementedError
    def add_attempt(self, attempt: Attempt) -> Attempt: raise NotImplementedError
    def persist_attempt_transaction(self, attempt: Attempt, child: Child, plan: TherapyPlan, snapshot: ProgressSnapshot, audit: AuditEvent) -> Attempt: raise NotImplementedError
    def update_child(self, child: Child) -> Child: raise NotImplementedError
    def deactivate_plan(self, plan_id: UUID) -> None: raise NotImplementedError
    def update_note(self, note: Note) -> Note: raise NotImplementedError
    def delete_note(self, note_id: UUID) -> None: raise NotImplementedError
    def add_tongue_placement(self, placement: TonguePlacement) -> TonguePlacement: raise NotImplementedError
    def update_tongue_placement(self, placement: TonguePlacement) -> TonguePlacement: raise NotImplementedError
    def add_progress_snapshot(self, snapshot: ProgressSnapshot) -> ProgressSnapshot: raise NotImplementedError
    def add_note(self, note: Note) -> Note: raise NotImplementedError
    def add_message(self, message: Message) -> Message: raise NotImplementedError
    def add_audit(self, audit: AuditEvent) -> AuditEvent: raise NotImplementedError
    def consents(self) -> list[ConsentRecord]: raise NotImplementedError
    def add_consent(self, consent: ConsentRecord) -> ConsentRecord: raise NotImplementedError
    def store_audio(self, object_name: str, audio_bytes: bytes, content_type: str) -> str: raise NotImplementedError
    def delete_audio(self, object_name: str) -> None: raise NotImplementedError
    def signed_audio_url(self, object_name: str) -> str | None: raise NotImplementedError


class InMemoryRepository(Repository):
    def __init__(self) -> None:
        self.organization_id = UUID("11111111-1111-1111-1111-111111111111")
        self._users: list[User] = []
        self._children: list[Child] = []
        self._plans: list[TherapyPlan] = []
        self._attempts: list[Attempt] = []
        self._sessions: list[Session] = []
        self._progress_snapshots: list[ProgressSnapshot] = []
        self._notes: list[Note] = []
        self._messages: list[Message] = []
        self._curriculum: list[CurriculumWord] = []
        self._audits: list[AuditEvent] = []
        self._tongue_placements: list[TonguePlacement] = []
        self._consents: list[ConsentRecord] = []
        self._credentials: dict[UUID, str] = {}
        self.seed()

    def users(self): return self._users
    def children(self): return self._children
    def plans(self): return self._plans
    def attempts(self): return self._attempts
    def sessions(self): return self._sessions
    def progress_snapshots(self): return self._progress_snapshots
    def notes(self): return self._notes
    def messages(self): return self._messages
    def curriculum(self): return self._curriculum
    def audits(self): return self._audits
    def tongue_placements(self): return self._tongue_placements
    def consents(self): return self._consents

    def add_plan(self, plan): self._plans.append(plan); return plan
    def add_child(self, child): self._children.append(child); return child
    def update_plan(self, plan): return plan
    def deactivate_plan(self, plan_id):
        for plan in self._plans:
            if plan.id == plan_id:
                plan.active = False
                break
    def add_session(self, session): self._sessions.append(session); return session
    def update_session(self, session): return session
    def add_attempt(self, attempt): self._attempts.append(attempt); return attempt
    def persist_attempt_transaction(self, attempt, child, plan, snapshot, audit):
        self._attempts.append(attempt)
        self.update_child(child)
        self.update_plan(plan)
        self._progress_snapshots.append(snapshot)
        self._audits.append(audit)
        return attempt
    def update_child(self, child): return child
    def update_note(self, note): return note
    def delete_note(self, note_id): self._notes[:] = [note for note in self._notes if note.id != note_id]
    def add_tongue_placement(self, placement): self._tongue_placements.append(placement); return placement
    def update_tongue_placement(self, placement):
        for index, current in enumerate(self._tongue_placements):
            if current.id == placement.id:
                self._tongue_placements[index] = placement
                break
        return placement
    def add_progress_snapshot(self, snapshot): self._progress_snapshots.append(snapshot); return snapshot
    def add_note(self, note): self._notes.append(note); return note
    def add_message(self, message): self._messages.append(message); return message
    def add_audit(self, audit): self._audits.append(audit); return audit
    def add_consent(self, consent): self._consents.append(consent); return consent
    def store_audio(self, object_name, audio_bytes, content_type): return object_name
    def delete_audio(self, object_name): return None
    def signed_audio_url(self, object_name): return None

    def create_user(self, user: User, password: str) -> User:
        normalized_email = user.email.strip().casefold()
        normalized_username = (user.username or user.email.split("@", 1)[0]).strip().casefold()
        if any(u.email.strip().casefold() == normalized_email or (u.username and u.username.strip().casefold() == normalized_username) for u in self._users):
            raise DuplicateUserError("An account with that email or username already exists")
        self._users.append(user)
        self._credentials[user.id] = _hash_password(password)
        return user

    def delete_user(self, user_id: UUID) -> None:
        self._users[:] = [user for user in self._users if user.id != user_id]
        self._credentials.pop(user_id, None)

    def link_child_user(self, child_id: UUID, user_id: UUID) -> None:
        return None

    def delete_child(self, child_id: UUID) -> None:
        self._children[:] = [child for child in self._children if child.id != child_id]

    def organization_exists(self, organization_id: UUID) -> bool:
        return organization_id == self.organization_id

    def authenticate(self, identifier: str, password: str) -> User | None:
        normalized = identifier.strip().casefold()
        for user in self._users:
            if user.email.casefold() == normalized or (user.username and user.username.casefold() == normalized):
                encoded = self._credentials.get(user.id)
                if encoded and _verify_password(password, encoded):
                    return user
                return None
        return None

    def seed(self) -> None:
        org = self.organization_id
        therapist = User(id=UUID("22222222-2222-2222-2222-222222222222"), name="Dr. Priya Patel", email="priya@example.test", username="priya", role=Role.therapist, organization_id=org)
        therapist2 = User(id=UUID("22222222-2222-2222-2222-222222222223"), name="Dr. Jordan Lee", email="jordan@example.test", username="jordan", role=Role.therapist, organization_id=org)
        therapist3 = User(id=UUID("22222222-2222-2222-2222-222222222224"), name="Dr. Sam Rivera", email="sam@example.test", username="sam", role=Role.therapist, organization_id=org)
        caregiver1 = User(id=UUID("33333333-3333-3333-3333-333333333331"), name="Alex Chen", email="alex@example.test", username="alex", role=Role.caregiver, organization_id=org)
        caregiver2 = User(id=UUID("33333333-3333-3333-3333-333333333332"), name="Nina Rao", email="nina@example.test", username="nina", role=Role.caregiver, organization_id=org)
        caregiver3 = User(id=UUID("33333333-3333-3333-3333-333333333333"), name="Kim Kim", email="kim@example.test", username="kim", role=Role.caregiver, organization_id=org)
        child_user = User(id=UUID("44444444-4444-4444-4444-444444444441"), name="Maya Demo", email="maya@example.test", username="maya", role=Role.child, organization_id=org, child_id=UUID("55555555-5555-5555-5555-555555555551"))
        child_ids = [UUID(f"55555555-5555-5555-5555-55555555555{i}") for i in range(1, 6)]
        self._users.extend([therapist, therapist2, therapist3, caregiver1, caregiver2, caregiver3, child_user])
        self._children.extend([
            Child(id=child_ids[0], name="Maya Chen", age=7, organization_id=org, therapist_id=therapist.id, caregiver_ids=[caregiver1.id], mastery=61, adherence=78, last_practice=datetime.now(timezone.utc) - timedelta(hours=2)),
            Child(id=child_ids[1], name="Arjun Rao", age=8, organization_id=org, therapist_id=therapist.id, caregiver_ids=[caregiver2.id], mastery=43, adherence=64, last_practice=datetime.now(timezone.utc) - timedelta(days=1)),
            Child(id=child_ids[2], name="Sara Kim", age=6, organization_id=org, therapist_id=therapist2.id, caregiver_ids=[caregiver3.id], mastery=78, adherence=91, last_practice=datetime.now(timezone.utc) - timedelta(hours=5)),
            Child(id=child_ids[3], name="Leo Park", age=7, organization_id=org, therapist_id=therapist2.id, caregiver_ids=[], mastery=56, adherence=71, last_practice=datetime.now(timezone.utc) - timedelta(days=2)),
            Child(id=child_ids[4], name="Noor Shah", age=9, organization_id=org, therapist_id=therapist3.id, caregiver_ids=[], mastery=69, adherence=83, last_practice=datetime.now(timezone.utc) - timedelta(days=1)),
        ])
        self._plans.extend([
            TherapyPlan(child_id=child_ids[0], therapist_id=therapist.id, targets=[PlanTarget(sound="/s/", words=["sun", "sock", "soap", "snake", "soup"], position="Initial")], tier=Tier.whole_word, cadence_per_week=5, review_date=date.today()+timedelta(days=7), cue="Smile, then let the snake sound slide out.", adaptive_recommended_tier=Tier.whole_word),
            TherapyPlan(child_id=child_ids[1], therapist_id=therapist.id, targets=[PlanTarget(sound="/r/", words=["red", "rain", "run", "rocket"], position="Initial")], tier=Tier.isolation, cadence_per_week=4, review_date=date.today()+timedelta(days=3), adaptive_recommended_tier=Tier.isolation),
            TherapyPlan(child_id=child_ids[2], therapist_id=therapist2.id, targets=[PlanTarget(sound="/l/", words=["leaf", "lamp", "lion", "ball"], position="Initial")], tier=Tier.sentence, cadence_per_week=5, review_date=date.today()+timedelta(days=14), adaptive_recommended_tier=Tier.sentence),
        ])
        words = [("sun","/s/","Initial"),("sock","/s/","Initial"),("soap","/s/","Initial"),("snake","/s/","Initial"),("sand","/s/","Initial"),("messy","/s/","Medial"),("pencil","/s/","Medial"),("bus","/s/","Final"),("house","/s/","Final"),("mouse","/s/","Final"),("red","/r/","Initial"),("rain","/r/","Initial"),("rocket","/r/","Initial"),("run","/r/","Initial"),("rabbit","/r/","Initial"),("car","/r/","Final"),("door","/r/","Final"),("floor","/r/","Final"),("leaf","/l/","Initial"),("lamp","/l/","Initial"),("lion","/l/","Initial"),("ball","/l/","Final"),("bell","/l/","Final"),("yellow","/l/","Medial"),("thumb","/th/","Initial"),("three","/th/","Initial"),("think","/th/","Initial"),("bath","/th/","Final"),("teeth","/th/","Final"),("earth","/th/","Final")]
        for word, sound, position in words:
            self._curriculum.append(CurriculumWord(word=word, phonemes=[sound], target_sound=sound, word_position=position, syllable_count=1 if len(word)<7 else 2, difficulty="Everyday", age_band="5-9", tier=Tier.whole_word))
        self._tongue_placements.extend([
            TonguePlacement(target_sound="/s/", title="Smile and slide", tongue_position="Keep the tongue tip just behind the top teeth without touching them.", airflow="Let a narrow, steady stream of air flow over the center of the tongue.", voice="Keep the voice off.", cue="Smile, then let the snake sound slide out.", caution="Stop if the sound feels tight or uncomfortable."),
            TonguePlacement(target_sound="/r/", title="Curl without touching", tongue_position="Lift and slightly curl the tongue tip toward the roof of the mouth; keep it relaxed.", airflow="Shape the mouth for a smooth, continuous airflow.", voice="Use a voiced sound.", cue="Make the tongue small and relaxed, then turn your voice on.", caution="A therapist should individualize /r/ placement."),
            TonguePlacement(target_sound="/l/", title="Touch and lift", tongue_position="Touch the ridge just behind the top front teeth with the tongue tip.", airflow="Let air flow around the sides of the tongue.", voice="Use a voiced sound.", cue="Tap the ridge, then let the sound flow around your tongue.", caution=None),
        ])
        seeded_attempts = [(child_ids[0], [72,76,68,81,74,79], "sun", "/s/"), (child_ids[1], [44,48,42,39,46], "red", "/r/"), (child_ids[2], [75,82,79,81,77], "leaf", "/l/")]
        for child, scores, word, sound in seeded_attempts:
            for idx, score in enumerate(scores):
                self._attempts.append(Attempt(child_id=child, session_id=uuid4(), word=word, target_sound=sound, score=score, transcription="mock transcription", transcription_status="mocked", scoring_status="complete", created_at=datetime.now(timezone.utc)-timedelta(days=len(scores)-idx)))
        self._notes.append(Note(child_id=child_ids[0], therapist_id=therapist.id, note="Continue whole-word /s/ practice. Maya is improving but /r/ remains difficult."))
        self._messages.append(Message(child_id=child_ids[0], sender_user_id=therapist.id, recipient_user_id=caregiver1.id, body="Continue whole-word /s/ practice this week."))
        self._audits.append(AuditEvent(organization_id=org, actor_user_id=therapist.id, action="Updated therapy plan", resource_type="therapy_plan", resource_id=self._plans[0].id))
        for user in self._users:
            self._credentials[user.id] = _hash_password(settings.seed_password)


_MODEL_TYPES = {
    "users": User,
    "children": Child,
    "plans": TherapyPlan,
    "attempts": Attempt,
    "sessions": Session,
    "progress_snapshots": ProgressSnapshot,
    "notes": Note,
    "messages": Message,
    "curriculum": CurriculumWord,
    "audits": AuditEvent,
    "consents": ConsentRecord,
}


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
    return f"pbkdf2_sha256$180000${salt.hex()}${digest.hex()}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, rounds, salt_hex, digest_hex = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(expected.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


class SQLiteRepository(Repository):
    """Persistent, self-contained SQLite repository for the local/live build.

    The repository stores the exact Pydantic domain objects as JSON payloads while
    keeping stable IDs and entity types indexed in SQLite. This deliberately keeps
    the domain model identical to the existing Supabase repository, so the same
    word library, therapy plans, children and progress data can be moved to a
    PostgreSQL backend later without changing service logic.
    """

    def __init__(self, db_path: str | None = None) -> None:
        default_path = Path(__file__).resolve().parents[1] / "data" / "soundbuddy.db"
        self.db_path = Path(db_path or settings.local_db_path or default_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=15)
        self._conn.row_factory = sqlite3.Row
        self.audio_root = Path(settings.audio_storage_path or (self.db_path.parent / "audio")).resolve()
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._init_schema()
        self._seed_if_empty()

    def _init_schema(self) -> None:
        with self._conn:
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS records (
                    entity TEXT NOT NULL,
                    id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (entity, id)
                )
            """)
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_records_entity ON records(entity)")
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS credentials (
                    user_id TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL
                )
            """)

    def _seed_if_empty(self) -> None:
        row = self._conn.execute("SELECT COUNT(*) AS count FROM records").fetchone()
        if row and row["count"] > 0:
            return
        source = InMemoryRepository()
        # The curriculum is the only content allowed to ship in a runtime database.
        # Users, children, plans, attempts, messages and notes must be created through
        # authenticated application workflows.
        for obj in source.curriculum():
            self._upsert("curriculum", obj)
        for obj in source.tongue_placements():
            self._upsert("tongue_placements", obj)
        self._conn.commit()

    def _upsert(self, entity: str, obj: Any) -> Any:
        payload = json.dumps(obj.model_dump(mode="json"), separators=(",", ":"), ensure_ascii=False)
        self._conn.execute(
            "INSERT INTO records(entity,id,payload,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) "
            "ON CONFLICT(entity,id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
            (entity, str(obj.id), payload),
        )
        self._conn.commit()
        return obj

    def _all(self, entity: str, model: type[Any]) -> list[Any]:
        with self._lock:
            rows = self._conn.execute("SELECT payload FROM records WHERE entity=?", (entity,)).fetchall()
        return [model.model_validate(json.loads(row["payload"])) for row in rows]

    def _get(self, entity: str, model: type[Any], obj_id: UUID) -> Any | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM records WHERE entity=? AND id=?", (entity, str(obj_id))).fetchone()
        return model.model_validate(json.loads(row["payload"])) if row else None

    def _set_password(self, user_id: UUID, password: str) -> None:
        self._conn.execute(
            "INSERT INTO credentials(user_id,password_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash",
            (str(user_id), _hash_password(password)),
        )

    def create_user(self, user: User, password: str) -> User:
        existing = [u for u in self.users() if u.email.casefold() == user.email.casefold() or (u.username and u.username.casefold() == (user.username or user.email.split("@", 1)[0]).casefold())]
        if existing:
            raise DuplicateUserError("An account with that email or username already exists")
        self._upsert("users", user)
        self._set_password(user.id, password)
        self._conn.commit()
        return user

    def delete_user(self, user_id: UUID) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM credentials WHERE user_id=?", (str(user_id),))
            self._conn.execute("DELETE FROM records WHERE entity='users' AND id=?", (str(user_id),))
            self._conn.commit()

    def organization_exists(self, organization_id: UUID) -> bool:
        # SQLite has no organizations table because local mode only persists
        # application records. The local repository uses the same fixed clinic
        # identifier as the in-memory fixture.
        return organization_id == UUID("11111111-1111-1111-1111-111111111111")

    def authenticate(self, identifier: str, password: str) -> User | None:
        normalized = identifier.strip().casefold()
        users = [
            u for u in self.users()
            if u.email.casefold() == normalized or (getattr(u, "username", None) and u.username.casefold() == normalized)
        ]
        if not users:
            return None
        user = users[0]
        row = self._conn.execute("SELECT password_hash FROM credentials WHERE user_id=?", (str(user.id),)).fetchone()
        if not row or not _verify_password(password, row["password_hash"]):
            return None
        return user

    def users(self) -> list[User]: return self._all("users", User)
    def children(self) -> list[Child]: return self._all("children", Child)
    def plans(self) -> list[TherapyPlan]: return self._all("plans", TherapyPlan)
    def attempts(self) -> list[Attempt]: return self._all("attempts", Attempt)
    def sessions(self) -> list[Session]: return self._all("sessions", Session)
    def progress_snapshots(self) -> list[ProgressSnapshot]: return self._all("progress_snapshots", ProgressSnapshot)
    def notes(self) -> list[Note]: return self._all("notes", Note)
    def messages(self) -> list[Message]: return self._all("messages", Message)
    def curriculum(self) -> list[CurriculumWord]: return self._all("curriculum", CurriculumWord)
    def audits(self) -> list[AuditEvent]: return self._all("audits", AuditEvent)
    def tongue_placements(self) -> list[TonguePlacement]: return self._all("tongue_placements", TonguePlacement)

    def add_plan(self, plan):
        with self._lock:
            for current in self.plans():
                if current.child_id == plan.child_id and current.active and current.id != plan.id:
                    current.active = False
                    self._upsert("plans", current)
            return self._upsert("plans", plan)

    def add_child(self, child):
        return self._upsert("children", child)

    def link_child_user(self, child_id, user_id):
        return None

    def delete_child(self, child_id):
        with self._lock:
            self._conn.execute("DELETE FROM records WHERE entity='children' AND id=?", (str(child_id),))
            self._conn.commit()

    def update_plan(self, plan): return self._upsert("plans", plan)
    def deactivate_plan(self, plan_id):
        with self._lock:
            self._conn.execute("UPDATE records SET payload=json_set(payload, '$.active', json('false')), updated_at=CURRENT_TIMESTAMP WHERE entity='plans' AND id=?", (str(plan_id),))
            self._conn.commit()
    def add_session(self, session): return self._upsert("sessions", session)
    def update_session(self, session): return self._upsert("sessions", session)
    def add_attempt(self, attempt): return self._upsert("attempts", attempt)
    def persist_attempt_transaction(self, attempt, child, plan, snapshot, audit):
        with self._lock:
            try:
                self._conn.execute("BEGIN")
                for entity, obj in (("attempts", attempt), ("children", child), ("plans", plan), ("progress_snapshots", snapshot), ("audits", audit)):
                    payload = json.dumps(obj.model_dump(mode="json"), separators=(",", ":"), ensure_ascii=False)
                    self._conn.execute("INSERT INTO records(entity,id,payload,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(entity,id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP", (entity, str(obj.id), payload))
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
        return attempt
    def update_child(self, child): return self._upsert("children", child)
    def update_note(self, note): return self._upsert("notes", note)
    def delete_note(self, note_id):
        with self._lock:
            self._conn.execute("DELETE FROM records WHERE entity='notes' AND id=?", (str(note_id),))
            self._conn.commit()
    def add_tongue_placement(self, placement): return self._upsert("tongue_placements", placement)
    def update_tongue_placement(self, placement): return self._upsert("tongue_placements", placement)
    def add_progress_snapshot(self, snapshot): return self._upsert("progress_snapshots", snapshot)
    def add_note(self, note): return self._upsert("notes", note)
    def add_message(self, message): return self._upsert("messages", message)
    def add_audit(self, audit): return self._upsert("audits", audit)
    def consents(self): return self._all("consents", ConsentRecord)
    def add_consent(self, consent): return self._upsert("consents", consent)
    def store_audio(self, object_name, audio_bytes, content_type):
        path = self.audio_root / object_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(audio_bytes)
        return str(path)
    def delete_audio(self, object_name):
        path = Path(object_name).resolve()
        if self.audio_root not in path.parents:
            raise RepositoryError("Invalid audio path")
        path.unlink(missing_ok=True)
    def signed_audio_url(self, object_name): return None

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class SupabaseRepository(Repository):
    """Live PostgreSQL repository through Supabase PostgREST.

    The backend uses the service-role key only server-side. API authorization still
    happens before repository calls; the service key is never exposed to the browser.
    """
    def __init__(self) -> None:
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Live mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        self.base = settings.supabase_url.rstrip("/") + "/rest/v1"
        self.headers = {
            # These calls are server-side. The service-role key must be used
            # consistently for both gateway authentication headers.
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, table: str, *, params: dict[str, str] | None = None, json: Any = None, prefer: str | None = "return=representation") -> list[dict[str, Any]]:
        headers = dict(self.headers)
        if prefer: headers["Prefer"] = prefer
        try:
            with httpx.Client(timeout=15) as client:
                response = client.request(method, f"{self.base}/{table}", headers=headers, params=params or {}, json=json)
        except httpx.RequestError as exc:
            raise RepositoryUnavailableError("Supabase database is unavailable") from exc
        if response.status_code >= 400:
            detail = response.text[:500]
            lowered = detail.casefold()
            if response.status_code == 401:
                raise RepositoryAuthConfigurationError("Supabase server credentials were rejected")
            if response.status_code == 404:
                raise RepositorySchemaError("A required Supabase schema object is missing")
            if response.status_code == 409 or "duplicate key" in lowered or "already exists" in lowered or "already registered" in lowered:
                raise DuplicateUserError("An account with that email or username already exists")
            if response.status_code >= 500 or response.status_code in {408, 429}:
                raise RepositoryUnavailableError("Supabase database is unavailable")
            raise RepositoryError(f"Supabase {method} {table} request was rejected ({response.status_code})")
        if not response.content:
            return []
        data = response.json()
        return data if isinstance(data, list) else [data]

    def _auth_request(self, method: str, path: str, *, json: Any = None, params: dict[str, str] | None = None) -> dict[str, Any]:
        """Call Supabase Auth with the server-only service role key."""
        try:
            with httpx.Client(timeout=15) as client:
                response = client.request(
                    method,
                    f"{settings.supabase_url.rstrip('/')}/auth/v1/{path}",
                    headers={"apikey": settings.supabase_service_role_key or "", "Authorization": f"Bearer {settings.supabase_service_role_key or ''}", "Content-Type": "application/json"},
                    params=params or {},
                    json=json,
                )
        except httpx.RequestError as exc:
            raise RepositoryUnavailableError("Supabase Auth is unavailable") from exc
        if response.status_code >= 400:
            detail = response.text[:500]
            lowered = detail.casefold()
            if response.status_code == 401:
                raise RepositoryAuthConfigurationError("Supabase Auth credentials were rejected")
            if response.status_code in {409, 422} and ("already" in lowered or "exists" in lowered or "registered" in lowered or "duplicate" in lowered):
                raise DuplicateUserError("An account with that email or username already exists")
            if response.status_code >= 500 or response.status_code in {408, 429}:
                raise RepositoryUnavailableError("Supabase Auth is unavailable")
            raise RepositoryError(f"Supabase Auth request was rejected ({response.status_code})")
        return response.json() if response.content else {}

    def _all(self, table: str, select: str = "*") -> list[dict[str, Any]]:
        return self._request("GET", table, params={"select": select})

    @staticmethod
    def _uuid(value: Any) -> UUID:
        return UUID(str(value))

    def users(self) -> list[User]:
        rows = self._all("users")
        try:
            children = self._all("children", "id,user_id")
        except RepositoryError:
            # Authentication/profile operations must not fail merely because
            # optional child provisioning tables are not populated yet.
            logger.exception("Unable to load optional child links while reading users")
            children = []
        child_by_user = {self._uuid(r["user_id"]): self._uuid(r["id"]) for r in children if r.get("user_id")}
        return [User(id=self._uuid(r["id"]), name=r["name"], email=r["email"], username=r.get("username"), role=Role(r["role"]), organization_id=self._uuid(r["organization_id"]), child_id=child_by_user.get(self._uuid(r["id"]))) for r in rows]

    def organization_exists(self, organization_id: UUID) -> bool:
        return bool(self._request("GET", "organizations", params={"select": "id", "id": f"eq.{organization_id}"}))

    def create_user(self, user: User, password: str) -> User:
        if not self.organization_exists(user.organization_id):
            raise OrganizationNotFoundError("The registration organization is not configured")
        existing_rows = self._all("users", "email,username")
        existing = [item for item in existing_rows if item.get("email", "").casefold() == user.email.casefold() or (item.get("username") and item["username"].casefold() == (user.username or "").casefold())]
        if existing:
            raise DuplicateUserError("An account with that email or username already exists")
        auth_user = self._auth_request("POST", "admin/users", json={
            "email": user.email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"name": user.name, "role": user.role.value},
        })
        auth_id = auth_user.get("id")
        if not auth_id:
            raise RuntimeError("Supabase Auth did not return a user id")
        user.id = self._uuid(auth_id)
        try:
            self._request("POST", "users", json={
                "id": str(user.id), "name": user.name, "email": user.email,
                "username": user.username, "role": user.role.value,
                "organization_id": str(user.organization_id),
            })
            self._request("POST", "organization_members", json={"organization_id": str(user.organization_id), "user_id": str(user.id)})
        except Exception:
            # Auth and public.users are separate Supabase APIs, so compensate
            # for a failed profile/membership insert to avoid an orphaned Auth
            # account. The original exception is preserved for the API mapper.
            try:
                self._auth_request("DELETE", f"admin/users/{user.id}")
            except Exception:
                logger.exception("Failed to roll back Supabase Auth user %s after registration failure", user.id)
            raise
        return user

    def delete_user(self, user_id: UUID) -> None:
        self._auth_request("DELETE", f"admin/users/{user_id}")

    def link_child_user(self, child_id: UUID, user_id: UUID) -> None:
        self._request("PATCH", "children", params={"id": f"eq.{child_id}"}, json={"user_id": str(user_id)}, prefer="return=minimal")

    def delete_child(self, child_id: UUID) -> None:
        self._request("DELETE", "children", params={"id": f"eq.{child_id}"}, prefer="return=minimal")

    def authenticate(self, identifier: str, password: str) -> User | None:
        normalized = identifier.strip().casefold()
        user = next((item for item in self.users() if item.email.casefold() == normalized or (item.username and item.username.casefold() == normalized)), None)
        if not user:
            return None
        try:
            self._auth_request("POST", "token", json={"email": user.email, "password": password}, params={"grant_type": "password"})
        except RepositoryError as exc:
            if not isinstance(exc, RepositoryUnavailableError):
                return None
            raise
        return user

    def children(self) -> list[Child]:
        rows = self._all("children")
        links = self._all("caregiver_child")
        caregivers: dict[UUID, list[UUID]] = {}
        for row in links:
            caregivers.setdefault(self._uuid(row["child_id"]), []).append(self._uuid(row["caregiver_id"]))
        return [Child(id=self._uuid(r["id"]), name=r["name"], age=r["age"], organization_id=self._uuid(r["organization_id"]), therapist_id=self._uuid(r["therapist_id"]), caregiver_ids=caregivers.get(self._uuid(r["id"]), []), mastery=float(r.get("mastery", 0)), adherence=float(r.get("adherence", 0)), last_practice=datetime.fromisoformat(r["last_practice"].replace("Z", "+00:00")) if r.get("last_practice") else None, active=r.get("active", True)) for r in rows]

    def plans(self) -> list[TherapyPlan]:
        rows = self._all("therapy_plans")
        targets = self._all("therapy_plan_targets")
        by_plan: dict[UUID, list[PlanTarget]] = {}
        for t in targets:
            word_ids = t.get("word_ids") or []
            words = []
            if word_ids:
                ids = ",".join(str(x) for x in word_ids)
                word_rows = self._request("GET", "words", params={"select":"word", "id":f"in.({ids})"})
                words = [r["word"] for r in word_rows]
            by_plan.setdefault(self._uuid(t["therapy_plan_id"]), []).append(PlanTarget(sound=t["target_sound"], words=words, position=t["position"]))
        result=[]
        for r in rows:
            result.append(TherapyPlan(id=self._uuid(r["id"]), child_id=self._uuid(r["child_id"]), therapist_id=self._uuid(r["therapist_id"]), targets=by_plan.get(self._uuid(r["id"]), []), tier=Tier(r["tier"]), cadence_per_week=r["cadence_per_week"], review_date=date.fromisoformat(r["review_date"]), cue=r.get("cue", ""), adaptive_recommended_tier=Tier(r["adaptive_recommended_tier"]), therapist_override_tier=Tier(r["therapist_override_tier"]) if r.get("therapist_override_tier") else None, active=r.get("active", True), updated_at=datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))))
        return result

    def attempts(self) -> list[Attempt]:
        rows = self._all("attempts")
        return [Attempt(id=self._uuid(r["id"]), child_id=self._uuid(r["child_id"]), session_id=self._uuid(r["session_id"]), word=r["word"], target_sound=r["target_sound"], word_position=r.get("word_position", "Initial"), score=float(r["score"]), transcription=r.get("transcription"), transcription_status=r.get("transcription_status","pending"), scoring_status=r.get("scoring_status","pending"), duration_ms=r.get("duration_ms"), audio_path=r.get("audio_path"), created_at=datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))) for r in rows]

    def sessions(self) -> list[Session]:
        rows=self._all("sessions")
        return [Session(id=self._uuid(r["id"]), child_id=self._uuid(r["child_id"]), started_at=datetime.fromisoformat(r["started_at"].replace("Z", "+00:00")), completed_at=datetime.fromisoformat(r["completed_at"].replace("Z", "+00:00")) if r.get("completed_at") else None) for r in rows]

    def progress_snapshots(self) -> list[ProgressSnapshot]:
        rows=self._all("progress_snapshots")
        return [ProgressSnapshot(id=self._uuid(r["id"]), child_id=self._uuid(r["child_id"]), mastery=float(r["mastery"]), average_score=float(r["average_score"]), recent_average=float(r["recent_average"]), current_tier=Tier(r["current_tier"]), recommended_tier=Tier(r["recommended_tier"]), created_at=datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))) for r in rows]

    def notes(self) -> list[Note]:
        rows=self._all("therapist_notes")
        return [Note(id=self._uuid(r["id"]), child_id=self._uuid(r["child_id"]), therapist_id=self._uuid(r["therapist_id"]), note=r["note"], created_at=datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")), updated_at=datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))) for r in rows]

    def messages(self) -> list[Message]:
        rows=self._all("messages")
        return [Message(id=self._uuid(r["id"]), child_id=self._uuid(r["child_id"]), sender_user_id=self._uuid(r["sender_user_id"]), recipient_user_id=self._uuid(r["recipient_user_id"]), body=r["body"], created_at=datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))) for r in rows]

    def curriculum(self) -> list[CurriculumWord]:
        rows=self._all("words")
        return [CurriculumWord(id=self._uuid(r["id"]), word=r["word"], phonemes=r.get("phonemes") or [], target_sound=r["target_sound"], word_position=r["word_position"], syllable_count=r["syllable_count"], difficulty=r["difficulty"], age_band=r["age_band"], tier=Tier(r["tier"]), child_friendly=r.get("child_friendly", True), active=r.get("active", True)) for r in rows]

    def audits(self) -> list[AuditEvent]:
        rows=self._all("audit_logs")
        return [AuditEvent(id=self._uuid(r["id"]), organization_id=self._uuid(r["organization_id"]), actor_user_id=self._uuid(r["actor_user_id"]), action=r["action"], resource_type=r["resource_type"], resource_id=self._uuid(r["resource_id"]) if r.get("resource_id") else None, timestamp=datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")), metadata=r.get("metadata") or {}) for r in rows]

    def tongue_placements(self) -> list[TonguePlacement]:
        rows = self._all("tongue_placements")
        return [TonguePlacement.model_validate(r) for r in rows]

    def add_tongue_placement(self, placement: TonguePlacement) -> TonguePlacement:
        self._request("POST", "tongue_placements", json=placement.model_dump(mode="json"))
        return placement

    def update_tongue_placement(self, placement: TonguePlacement) -> TonguePlacement:
        self._request("PATCH", "tongue_placements", params={"id": f"eq.{placement.id}"}, json=placement.model_dump(mode="json"))
        return placement

    def add_plan(self, plan: TherapyPlan) -> TherapyPlan:
        self._request("PATCH", "therapy_plans", params={"child_id":f"eq.{plan.child_id}", "active":"eq.true"}, json={"active":False}, prefer="return=minimal")
        row=self._request("POST", "therapy_plans", json={"id":str(plan.id),"child_id":str(plan.child_id),"therapist_id":str(plan.therapist_id),"tier":plan.tier.value,"cadence_per_week":plan.cadence_per_week,"review_date":plan.review_date.isoformat(),"cue":plan.cue,"adaptive_recommended_tier":plan.adaptive_recommended_tier.value,"therapist_override_tier":plan.therapist_override_tier.value if plan.therapist_override_tier else None,"active":True})[0]
        for target in plan.targets:
            word_rows=self._request("GET","words",params={
                "select":"id,word,target_sound,word_position",
                "word":f"in.({','.join(target.words)})",
                "target_sound":f"eq.{target.sound}",
                "word_position":f"eq.{target.position}",
                "active":"eq.true",
            })
            word_ids=[r["id"] for r in word_rows]
            self._request("POST","therapy_plan_targets",json={"therapy_plan_id":str(plan.id),"target_sound":target.sound,"position":target.position,"word_ids":word_ids})
        return plan

    def add_child(self, child: Child) -> Child:
        self._request("POST", "children", json={"id": str(child.id), "name": child.name, "age": child.age, "organization_id": str(child.organization_id), "therapist_id": str(child.therapist_id), "mastery": child.mastery, "adherence": child.adherence})
        for caregiver_id in child.caregiver_ids:
            self._request("POST", "caregiver_child", json={"child_id": str(child.id), "caregiver_id": str(caregiver_id)})
        return child

    def update_plan(self, plan: TherapyPlan) -> TherapyPlan:
        self._request("POST", "rpc/update_therapy_plan_transaction", json={
            "p_plan": {
                "id": str(plan.id), "tier": plan.tier.value, "cadence_per_week": plan.cadence_per_week,
                "review_date": plan.review_date.isoformat(), "cue": plan.cue,
                "adaptive_recommended_tier": plan.adaptive_recommended_tier.value,
                "therapist_override_tier": plan.therapist_override_tier.value if plan.therapist_override_tier else None,
                "updated_at": plan.updated_at.isoformat(),
            },
            "p_targets": [target.model_dump(mode="json") for target in plan.targets],
        }, prefer="return=minimal")
        return plan

    def deactivate_plan(self, plan_id: UUID) -> None:
        self._request("PATCH", "therapy_plans", params={"id": f"eq.{plan_id}"}, json={"active": False}, prefer="return=minimal")

    def add_session(self, session: Session) -> Session:
        self._request("POST","sessions",json={"id":str(session.id),"child_id":str(session.child_id),"started_at":session.started_at.isoformat()})
        return session

    def update_session(self, session: Session) -> Session:
        self._request("PATCH","sessions",params={"id":f"eq.{session.id}"},json={"completed_at":session.completed_at.isoformat() if session.completed_at else None})
        return session

    def add_attempt(self, attempt: Attempt) -> Attempt:
        self._request("POST","attempts",json={"id":str(attempt.id),"session_id":str(attempt.session_id),"child_id":str(attempt.child_id),"word":attempt.word,"target_sound":attempt.target_sound,"word_position":attempt.word_position,"score":attempt.score,"transcription":attempt.transcription,"transcription_status":attempt.transcription_status,"scoring_status":attempt.scoring_status,"duration_ms":attempt.duration_ms,"audio_path":attempt.audio_path})
        return attempt

    def persist_attempt_transaction(self, attempt, child, plan, snapshot, audit):
        self._request("POST", "rpc/record_attempt_transaction", json={
            "p_attempt": attempt.model_dump(mode="json"),
            "p_child": child.model_dump(mode="json"),
            "p_plan": plan.model_dump(mode="json"),
            "p_snapshot": snapshot.model_dump(mode="json"),
            "p_audit": audit.model_dump(mode="json"),
        }, prefer="return=minimal")
        return attempt

    def update_child(self, child: Child) -> Child:
        self._request("PATCH","children",params={"id":f"eq.{child.id}"},json={"mastery":child.mastery,"adherence":child.adherence,"last_practice":child.last_practice.isoformat() if child.last_practice else None})
        self._request("DELETE", "caregiver_child", params={"child_id": f"eq.{child.id}"}, prefer="return=minimal")
        for caregiver_id in child.caregiver_ids:
            self._request("POST", "caregiver_child", json={"child_id": str(child.id), "caregiver_id": str(caregiver_id)})
        return child

    def add_progress_snapshot(self, snapshot: ProgressSnapshot) -> ProgressSnapshot:
        self._request("POST","progress_snapshots",json={"id":str(snapshot.id),"child_id":str(snapshot.child_id),"mastery":snapshot.mastery,"average_score":snapshot.average_score,"recent_average":snapshot.recent_average,"current_tier":snapshot.current_tier.value,"recommended_tier":snapshot.recommended_tier.value})
        return snapshot

    def add_note(self, note: Note) -> Note:
        self._request("POST","therapist_notes",json={"id":str(note.id),"child_id":str(note.child_id),"therapist_id":str(note.therapist_id),"note":note.note})
        return note

    def update_note(self, note: Note) -> Note:
        self._request("PATCH", "therapist_notes", params={"id": f"eq.{note.id}"}, json={"note": note.note, "updated_at": note.updated_at.isoformat()})
        return note

    def delete_note(self, note_id: UUID) -> None:
        self._request("DELETE", "therapist_notes", params={"id": f"eq.{note_id}"}, prefer="return=minimal")

    def add_message(self, message: Message) -> Message:
        self._request("POST","messages",json={"id":str(message.id),"child_id":str(message.child_id),"sender_user_id":str(message.sender_user_id),"recipient_user_id":str(message.recipient_user_id),"body":message.body})
        return message

    def add_audit(self, audit: AuditEvent) -> AuditEvent:
        self._request("POST","audit_logs",json={"id":str(audit.id),"organization_id":str(audit.organization_id),"actor_user_id":str(audit.actor_user_id),"action":audit.action,"resource_type":audit.resource_type,"resource_id":str(audit.resource_id) if audit.resource_id else None,"metadata":audit.metadata})
        return audit

    def consents(self):
        rows = self._all("consents")
        return [ConsentRecord.model_validate(row) for row in rows]

    def add_consent(self, consent):
        self._request("POST", "consents", json=consent.model_dump(mode="json"))
        return consent

    def store_audio(self, object_name, audio_bytes, content_type):
        try:
            response = httpx.post(f"{settings.supabase_url.rstrip('/')}/storage/v1/object/practice-audio/{object_name}", headers={**self.headers, "Content-Type": content_type, "x-upsert": "false"}, content=audio_bytes, timeout=30)
        except httpx.RequestError as exc:
            raise RepositoryUnavailableError("Supabase audio storage is unavailable") from exc
        if response.status_code >= 400:
            if response.status_code >= 500 or response.status_code in {408, 429}:
                raise RepositoryUnavailableError("Supabase audio storage is unavailable")
            raise RepositoryError("Supabase audio upload was rejected")
        return object_name

    def delete_audio(self, object_name):
        try:
            response = httpx.delete(f"{settings.supabase_url.rstrip('/')}/storage/v1/object/practice-audio", headers=self.headers, json={"prefixes": [object_name]}, timeout=15)
        except httpx.RequestError as exc:
            raise RepositoryUnavailableError("Supabase audio storage is unavailable") from exc
        if response.status_code >= 400 and response.status_code != 404:
            raise RepositoryError("Supabase audio deletion was rejected")

    def signed_audio_url(self, object_name):
        try:
            response = httpx.post(f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/practice-audio/{object_name}", headers=self.headers, json={"expiresIn": 300}, timeout=15)
        except httpx.RequestError as exc:
            raise RepositoryUnavailableError("Supabase audio storage is unavailable") from exc
        if response.status_code >= 400:
            raise RuntimeError("Supabase audio signing failed")
        signed = response.json().get("signedURL")
        return f"{settings.supabase_url.rstrip('/')}/storage/v1{signed}" if signed and signed.startswith("/") else signed


settings.validate_runtime()

if settings.demo_mode or settings.database_backend.casefold() == "memory":
    repository: Repository = InMemoryRepository()
elif settings.database_backend.casefold() == "supabase":
    repository = SupabaseRepository()
else:
    repository = SQLiteRepository()
