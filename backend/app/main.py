from datetime import date, datetime, timezone, timedelta
from uuid import UUID, uuid4
import logging
import threading
import time

from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pathlib import Path
import sys

# Deployment-safe package resolution.
# This keeps `app.*` imports working when this file is launched from Render
# or directly from the backend directory.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi.middleware.cors import CORSMiddleware

from app.auth import current_user, require_roles
from app.local_auth import create_access_token, decode_access_token, create_realtime_ticket, decode_realtime_ticket, create_scoring_token, decode_scoring_token
from app.config import settings
from app.models import (
    Attempt,
    AttemptCreate,
    AuditEvent,
    Child,
    ChildUpdate,
    ConsentRecord,
    CostUsage,
    Message,
    MessageCreate,
    Note,
    NoteCreate,
    NoteUpdate,
    PlanUpdate,
    Progress,
    ProgressSnapshot,
    Role,
    Session,
    TherapyPlan,
    TherapistTransfer,
    Tier,
    TonguePlacement,
    TonguePlacementUpdate,
    User,
    LoginRequest, AuthResponse, RegisterRequest,
)
from app.providers.ai import DeterministicAIProvider, GeminiAIProvider
from app.providers.pronunciation import LocalPronunciationScorer, MockPronunciationScorer
from app.providers.stt import LocalWhisperProvider
from app.repository import (
    DuplicateUserError,
    OrganizationNotFoundError,
    RepositoryError,
    RepositoryAuthConfigurationError,
    RepositorySchemaError,
    RepositoryUnavailableError,
    repository,
)
from app.services.adaptive import select_tier
from app.services.mastery import adherence_percentage, average, update_mastery
from app.services.review import review_priority

app = FastAPI(title=settings.app_name, version="1.1.0")
settings.validate_runtime()
logger = logging.getLogger("app")

_rate_limit_lock = threading.Lock()
_rate_limit_buckets: dict[tuple[str, str], list[float]] = {}
_RATE_LIMITS = {
    "/api/auth/login": (20, 60),
    "/api/auth/register": (10, 300),
    "/api/auth/realtime-ticket": (30, 60),
}


@app.exception_handler(Exception)
async def unhandled_exception(request, exc):
    logger.exception("Unhandled application error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred."})


def _allow_request(path: str, client_key: str) -> tuple[bool, int]:
    limit, window = _RATE_LIMITS[path]
    now = time.monotonic()
    key = (path, client_key)
    with _rate_limit_lock:
        recent = [stamp for stamp in _rate_limit_buckets.get(key, []) if now - stamp < window]
        if len(recent) >= limit:
            retry_after = max(1, int(window - (now - recent[0])))
            _rate_limit_buckets[key] = recent
            return False, retry_after
        recent.append(now)
        _rate_limit_buckets[key] = recent
        return True, 0


@app.middleware("http")
async def abuse_protection(request, call_next):
    route = request.url.path
    if route in _RATE_LIMITS and request.method == "POST":
        client_key = request.client.host if request.client else "unknown"
        allowed, retry_after = _allow_request(route, client_key)
        if not allowed:
            response = JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again later."})
            response.headers["Retry-After"] = str(retry_after)
            return response
    response = await call_next(request)
    response.headers.setdefault("X-Request-ID", str(uuid4()))
    return response


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), payment=()")
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if settings.is_production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex if not settings.is_production else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "ngrok-skip-browser-warning"],
)

api = APIRouter(prefix="/api")
MAX_AUDIO_BYTES = 5 * 1024 * 1024
ALLOWED_AUDIO_PREFIXES = ("audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/aac")


class RealtimeManager:
    def __init__(self) -> None:
        self.enabled = True
        self.connections: dict[WebSocket, User] = {}
        self.sequence = 0

    async def connect(self, websocket: WebSocket, user: User) -> None:
        await websocket.accept()
        self.connections[websocket] = user
        await websocket.send_json({"type": "connected", "message": "Sound Buddy realtime connected"})

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.pop(websocket, None)

    async def broadcast(self, event: str, data: dict, *, organization_id: UUID, child_id: UUID | None = None, recipient_user_id: UUID | None = None) -> None:
        stale: list[WebSocket] = []
        self.sequence += 1
        message = {"id": self.sequence, "type": event, "data": data}
        for websocket, user in list(self.connections.items()):
            if user.organization_id != organization_id:
                continue
            if recipient_user_id and user.id == recipient_user_id:
                allowed = True
            elif recipient_user_id and user.id != recipient_user_id:
                allowed = False
            elif child_id:
                try:
                    child_for_user(child_id, user)
                    allowed = True
                except HTTPException:
                    allowed = False
            else:
                allowed = True
            if not allowed:
                continue
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(websocket)


realtime = RealtimeManager()
whisper_provider = LocalWhisperProvider(settings.whisper_model)


def child_for_user(child_id: UUID, user: User) -> Child:
    child = next((item for item in repository.children() if item.id == child_id), None)
    if not child or not child.active or child.organization_id != user.organization_id:
        raise HTTPException(404, "Child not found")
    if user.role == Role.therapist and child.therapist_id != user.id:
        raise HTTPException(403, "Child is not assigned to this therapist")
    if user.role == Role.caregiver and user.id not in child.caregiver_ids:
        raise HTTPException(403, "Child is not linked to this caregiver")
    if user.role == Role.child and child.id != user.child_id:
        raise HTTPException(403, "Child is not linked to this profile")
    return child


def active_plan_for(child_id: UUID) -> TherapyPlan:
    plan = next((p for p in repository.plans() if p.child_id == child_id and p.active), None)
    if not plan:
        raise HTTPException(404, "Active plan not found")
    return plan


def validate_practice_target(child_id: UUID, word: str, target_sound: str, word_position: str = "Initial") -> TherapyPlan:
    cleaned_word = (word or "").strip()
    cleaned_sound = (target_sound or "").strip()
    cleaned_position = (word_position or "").strip()
    if not cleaned_word:
        raise HTTPException(422, "Word is required")
    if not cleaned_sound:
        raise HTTPException(422, "Target sound is required")
    if not cleaned_position:
        raise HTTPException(422, "Word position is required")

    plan = active_plan_for(child_id)
    normalized_word = cleaned_word.casefold()
    for target in plan.targets:
        if (
            target.sound.strip() == cleaned_sound
            and target.position.strip().casefold() == cleaned_position.casefold()
            and any(w.strip().casefold() == normalized_word for w in target.words)
        ):
            return plan
    raise HTTPException(422, "Word and target sound are not part of the active therapy plan")


def validate_plan_targets(targets: list) -> None:
    library = {
        (word.word.casefold(), word.target_sound.strip(), word.word_position.strip())
        for word in repository.curriculum()
        if word.active
    }
    for target in targets:
        for word in target.words:
            key = (word.casefold(), target.sound.strip(), target.position.strip())
            if key not in library:
                raise HTTPException(
                    422,
                    f"Word '{word}' is not available for target {target.sound} in the {target.position.lower()} position",
                )


def resolve_caregiver_ids(payload: ChildUpdate, organization_id: UUID) -> list[UUID]:
    caregiver_ids = set(payload.caregiver_ids)
    if payload.caregiver_email:
        caregiver = next((item for item in repository.users() if item.email.casefold() == payload.caregiver_email.strip().casefold()), None)
        if not caregiver or caregiver.role != Role.caregiver or caregiver.organization_id != organization_id:
            raise HTTPException(422, "Caregiver email is not a valid member of this organization")
        caregiver_ids.add(caregiver.id)
    caregivers = [item for item in repository.users() if item.id in caregiver_ids]
    if len(caregivers) != len(caregiver_ids) or any(item.role != Role.caregiver or item.organization_id != organization_id for item in caregivers):
        raise HTTPException(422, "Caregivers must be valid members of this organization")
    return list(caregiver_ids)


def log(user: User, action: str, resource_type: str, resource_id: UUID | None = None) -> None:
    try:
        repository.add_audit(AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action=action, resource_type=resource_type, resource_id=resource_id))
    except RepositoryError:
        # Audit persistence must not turn a committed user action into a
        # misleading failure. The failure remains visible in server logs.
        logger.exception("Audit event persistence failed for %s", action)


def cleanup_audio(object_name: str | None) -> None:
    if not object_name:
        return
    try:
        repository.delete_audio(object_name)
    except Exception:
        logger.exception("Failed to clean up audio object %s", object_name)


@api.get("/health/live")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@api.get("/health")
@api.get("/health/ready")
def health() -> dict[str, str | bool]:
    try:
        if not repository.organization_exists(settings.registration_organization_id):
            raise OrganizationNotFoundError("The registration organization is not configured")
    except OrganizationNotFoundError as exc:
        logger.error("Readiness check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database schema is not initialized") from exc
    except RepositoryUnavailableError as exc:
        logger.exception("Readiness database check failed")
        raise HTTPException(status_code=503, detail="Database is temporarily unavailable") from exc
    except RepositorySchemaError as exc:
        logger.exception("Readiness schema check failed")
        raise HTTPException(status_code=503, detail="Database schema is not initialized") from exc
    except RepositoryError as exc:
        logger.exception("Readiness check failed")
        raise HTTPException(status_code=503, detail="Database is not ready") from exc
    return {"status": "ok", "demo_mode": settings.demo_mode, "database": "memory" if settings.demo_mode else settings.database_backend, "realtime": realtime.enabled}


@api.post("/auth/register", response_model=AuthResponse, status_code=201)
def register(payload: RegisterRequest) -> AuthResponse:
    identifier = payload.username or payload.email.split("@", 1)[0].strip()
    try:
        # Registration is anchored to the explicitly seeded clinic. Do not
        # derive it from the first application user: a new database correctly
        # has zero users, and reading the whole user/child graph can introduce
        # an unrelated schema dependency into account creation.
        org_id = settings.registration_organization_id
        if not repository.organization_exists(org_id):
            raise OrganizationNotFoundError("The registration organization is not configured")
    except OrganizationNotFoundError as exc:
        logger.error("Registration organization is missing: %s", exc)
        raise HTTPException(status_code=503, detail="Account registration is not configured") from exc
    except RepositoryUnavailableError as exc:
        logger.exception("Unable to read registration organization")
        raise HTTPException(status_code=503, detail="Account registration is temporarily unavailable") from exc
    except RepositorySchemaError as exc:
        logger.exception("Registration schema check failed")
        raise HTTPException(status_code=503, detail="Database schema is not initialized") from exc
    except RepositoryAuthConfigurationError as exc:
        logger.exception("Registration Supabase credentials were rejected")
        raise HTTPException(status_code=503, detail="Supabase credentials are not configured correctly") from exc
    except RepositoryError as exc:
        logger.exception("Unable to read registration organization")
        raise HTTPException(status_code=503, detail="Account registration is temporarily unavailable") from exc
    user = User(
        name=payload.name.strip(),
        email=payload.email.strip(),
        username=identifier,
        role=payload.role,
        organization_id=org_id,
    )
    create_user = getattr(repository, "create_user", None)
    if not callable(create_user):
        raise HTTPException(status_code=503, detail="User creation is unavailable")
    try:
        created = create_user(user, payload.password)
    except DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OrganizationNotFoundError as exc:
        logger.error("Registration organization disappeared during registration: %s", exc)
        raise HTTPException(status_code=503, detail="Account registration is not configured") from exc
    except RepositoryUnavailableError as exc:
        logger.exception("User registration is unavailable")
        raise HTTPException(status_code=503, detail="Account registration is temporarily unavailable") from exc
    except RepositorySchemaError as exc:
        logger.exception("User registration schema check failed")
        raise HTTPException(status_code=503, detail="Database schema is not initialized") from exc
    except RepositoryAuthConfigurationError as exc:
        logger.exception("User registration Supabase credentials were rejected")
        raise HTTPException(status_code=503, detail="Supabase credentials are not configured correctly") from exc
    except RepositoryError as exc:
        logger.exception("User registration database dependency failed")
        raise HTTPException(status_code=503, detail="Account registration is temporarily unavailable") from exc
    except Exception as exc:
        logger.exception("Unexpected user registration failure")
        raise HTTPException(status_code=500, detail="Unable to create account. Please try again.") from exc
    return AuthResponse(access_token=create_access_token(created), user=created)


@api.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest) -> AuthResponse:
    authenticate = getattr(repository, "authenticate", None)
    if not callable(authenticate):
        raise HTTPException(status_code=503, detail="Local authentication is unavailable")
    identifier = (payload.email or payload.username or "").strip()
    try:
        user = authenticate(identifier, payload.password)
    except RepositoryUnavailableError as exc:
        logger.exception("Login dependency is unavailable")
        raise HTTPException(status_code=503, detail="Sign in is temporarily unavailable") from exc
    except RepositorySchemaError as exc:
        logger.exception("Login schema dependency is unavailable")
        raise HTTPException(status_code=503, detail="Database schema is not initialized") from exc
    except RepositoryError as exc:
        logger.exception("Login database dependency failed")
        raise HTTPException(status_code=503, detail="Sign in is temporarily unavailable") from exc
    except Exception as exc:
        logger.exception("Unexpected login failure")
        raise HTTPException(status_code=500, detail="Unable to sign in. Please try again.") from exc
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username/email or password")
    return AuthResponse(access_token=create_access_token(user), user=user)


@api.get("/auth/profile")
@api.post("/auth/profile")
def profile(user: User = Depends(current_user)) -> User:
    return user


@api.post("/auth/realtime-ticket")
def realtime_ticket(user: User = Depends(current_user)) -> dict[str, str]:
    return {"ticket": create_realtime_ticket(user)}


@api.get("/therapists/me/caseload")
def caseload(user: User = Depends(require_roles(Role.therapist, Role.admin))) -> list[Child]:
    return [child for child in repository.children() if child.active and (user.role == Role.admin and child.organization_id == user.organization_id or child.therapist_id == user.id)]


@api.post("/children", response_model=Child, status_code=201)
async def create_child(payload: ChildUpdate, user: User = Depends(require_roles(Role.therapist))) -> Child:
    if payload.child_username and any(existing.username and existing.username.casefold() == payload.child_username.strip().casefold() for existing in repository.users()):
        raise HTTPException(409, "That child username is already in use")
    child = Child(name=payload.name.strip(), age=payload.age, organization_id=user.organization_id, therapist_id=user.id, caregiver_ids=resolve_caregiver_ids(payload, user.organization_id))
    repository.add_child(child)
    if payload.child_username and payload.child_password:
        # Keep the public username independent from the internal Supabase Auth
        # email. Usernames may contain characters that are invalid in an email
        # local-part; the UUID-derived address is always valid and unique.
        child_user = User(name=child.name, email=f"child-{child.id}@accounts.soundbuddy.app", username=payload.child_username.strip(), role=Role.child, organization_id=user.organization_id, child_id=child.id)
        account_created = False
        try:
            repository.create_user(child_user, payload.child_password)
            account_created = True
            repository.link_child_user(child.id, child_user.id)
        except DuplicateUserError as exc:
            repository.delete_child(child.id)
            raise HTTPException(409, str(exc)) from exc
        except RepositoryUnavailableError as exc:
            repository.delete_child(child.id)
            if account_created:
                try:
                    repository.delete_user(child_user.id)
                except Exception:
                    logger.exception("Failed to roll back child account %s", child_user.id)
            logger.exception("Child account provisioning is unavailable")
            raise HTTPException(503, "Child account provisioning is temporarily unavailable") from exc
        except RepositoryError as exc:
            repository.delete_child(child.id)
            if account_created:
                try:
                    repository.delete_user(child_user.id)
                except Exception:
                    logger.exception("Failed to roll back child account %s", child_user.id)
            logger.exception("Child account provisioning failed")
            raise HTTPException(500, "Unable to create the child account") from exc
        except Exception as exc:
            repository.delete_child(child.id)
            if account_created:
                try:
                    repository.delete_user(child_user.id)
                except Exception:
                    logger.exception("Failed to roll back child account %s", child_user.id)
            logger.exception("Unexpected child account provisioning failure")
            raise HTTPException(500, "Unable to create the child account") from exc
    log(user, "Created child profile", "child", child.id)
    await realtime.broadcast("child_changed", {"child_id": str(child.id)}, organization_id=user.organization_id, child_id=child.id)
    return child


@api.patch("/children/{child_id}", response_model=Child)
async def update_child(child_id: UUID, payload: ChildUpdate, user: User = Depends(require_roles(Role.therapist))) -> Child:
    child = child_for_user(child_id, user)
    child.name = payload.name.strip()
    child.age = payload.age
    child.caregiver_ids = resolve_caregiver_ids(payload, user.organization_id)
    repository.update_child(child)
    log(user, "Updated child profile", "child", child.id)
    await realtime.broadcast("child_changed", {"child_id": str(child.id)}, organization_id=user.organization_id, child_id=child.id)
    return child


@api.get("/children/{child_id}")
def get_child(child_id: UUID, user: User = Depends(current_user)) -> Child:
    return child_for_user(child_id, user)

@api.get("/caregivers/me/children")
def caregiver_children(user: User = Depends(require_roles(Role.caregiver))) -> list[Child]:
    return [child for child in repository.children() if child.active and user.id in child.caregiver_ids]


@api.get("/therapists", response_model=list[User])
def list_therapists(user: User = Depends(require_roles(Role.therapist, Role.admin))) -> list[User]:
    return [item for item in repository.users() if item.role == Role.therapist and item.organization_id == user.organization_id]


@api.get("/caregivers", response_model=list[User])
def list_caregivers(user: User = Depends(require_roles(Role.therapist, Role.admin))) -> list[User]:
    return [item for item in repository.users() if item.role == Role.caregiver and item.organization_id == user.organization_id]


@api.post("/children/{child_id}/transfer-therapist", response_model=Child)
async def transfer_therapist(child_id: UUID, payload: TherapistTransfer, user: User = Depends(require_roles(Role.therapist, Role.admin))) -> Child:
    child = child_for_user(child_id, user)
    new_therapist = next((item for item in repository.users() if item.id == payload.therapist_id), None)
    if not new_therapist or new_therapist.role != Role.therapist or new_therapist.organization_id != user.organization_id:
        raise HTTPException(422, "New therapist must be a valid therapist in this organization")
    previous_therapist_id = child.therapist_id
    if previous_therapist_id == new_therapist.id:
        return child
    child.therapist_id = new_therapist.id
    repository.update_child(child)
    log(user, "Transferred child to a new therapist", "child_therapist", child.id)
    await realtime.broadcast(
        "child_changed",
        {"child_id": str(child.id), "therapist_id": str(new_therapist.id), "previous_therapist_id": str(previous_therapist_id)},
        organization_id=user.organization_id,
        child_id=child.id,
    )
    return child


@api.post("/children/{child_id}/caregivers/{caregiver_id}", response_model=Child)
async def add_caregiver(child_id: UUID, caregiver_id: UUID, user: User = Depends(require_roles(Role.therapist))) -> Child:
    child = child_for_user(child_id, user)
    caregiver = next((item for item in repository.users() if item.id == caregiver_id), None)
    if not caregiver or caregiver.role != Role.caregiver or caregiver.organization_id != user.organization_id:
        raise HTTPException(404, "Caregiver not found in this organization")
    if caregiver_id not in child.caregiver_ids:
        child.caregiver_ids.append(caregiver_id)
        repository.update_child(child)
    log(user, "Assigned caregiver relationship", "caregiver_child", child.id)
    await realtime.broadcast("caregiver_relationship_changed", {"child_id": str(child.id), "caregiver_id": str(caregiver_id), "active": True}, organization_id=user.organization_id, child_id=child.id)
    return child


@api.delete("/children/{child_id}/caregivers/{caregiver_id}", status_code=204)
async def remove_caregiver(child_id: UUID, caregiver_id: UUID, user: User = Depends(require_roles(Role.therapist))) -> None:
    child = child_for_user(child_id, user)
    if caregiver_id not in child.caregiver_ids:
        raise HTTPException(404, "Caregiver relationship not found")
    child.caregiver_ids.remove(caregiver_id)
    repository.update_child(child)
    log(user, "Removed caregiver relationship", "caregiver_child", child.id)
    await realtime.broadcast("caregiver_relationship_changed", {"child_id": str(child.id), "caregiver_id": str(caregiver_id), "active": False}, organization_id=user.organization_id, child_id=child.id)


@api.get("/children/{child_id}/plan")
def get_plan(child_id: UUID, user: User = Depends(current_user)) -> TherapyPlan | None:
    child_for_user(child_id, user)
    return next((plan for plan in repository.plans() if plan.child_id == child_id and plan.active), None)


@api.post("/children/{child_id}/plan")
async def create_plan(child_id: UUID, payload: PlanUpdate, user: User = Depends(require_roles(Role.therapist))) -> TherapyPlan:
    child = child_for_user(child_id, user)
    validate_plan_targets(payload.targets)
    adaptive = select_tier(child.mastery)
    plan = TherapyPlan(
        child_id=child.id,
        therapist_id=user.id,
        targets=payload.targets,
        tier=payload.tier,
        cadence_per_week=payload.cadence_per_week,
        review_date=payload.review_date,
        cue=payload.cue.strip(),
        adaptive_recommended_tier=adaptive.recommended_tier,
        therapist_override_tier=payload.therapist_override_tier,
    )
    try:
        repository.add_plan(plan)
    except RepositoryUnavailableError as exc:
        logger.exception("Therapy plan persistence is unavailable")
        raise HTTPException(503, "Therapy plan storage is temporarily unavailable") from exc
    except RepositorySchemaError as exc:
        logger.exception("Therapy plan schema is not ready")
        raise HTTPException(503, "Therapy plan database migration is required") from exc
    except RepositoryError as exc:
        logger.exception("Therapy plan persistence failed")
        raise HTTPException(503, "Unable to save the therapy plan") from exc
    log(user, "Created therapy plan", "therapy_plan", plan.id)
    await realtime.broadcast("therapy_plan_changed", {"child_id": str(plan.child_id), "plan_id": str(plan.id)}, organization_id=user.organization_id, child_id=plan.child_id)
    return plan


@api.patch("/therapy-plans/{plan_id}")
async def update_plan(plan_id: UUID, payload: PlanUpdate, user: User = Depends(require_roles(Role.therapist))) -> TherapyPlan:
    plan = next((p for p in repository.plans() if p.id == plan_id), None)
    if not plan or plan.therapist_id != user.id:
        raise HTTPException(404, "Plan not found")
    child = child_for_user(plan.child_id, user)
    validate_plan_targets(payload.targets)
    adaptive = select_tier(child.mastery)
    plan.targets = payload.targets
    plan.tier = payload.tier
    plan.cadence_per_week = payload.cadence_per_week
    plan.review_date = payload.review_date
    plan.cue = payload.cue.strip()
    plan.adaptive_recommended_tier = adaptive.recommended_tier
    plan.therapist_override_tier = payload.therapist_override_tier
    plan.updated_at = datetime.now(timezone.utc)
    repository.update_plan(plan)
    log(user, "Updated therapy plan", "therapy_plan", plan.id)
    await realtime.broadcast("therapy_plan_changed", {"child_id": str(plan.child_id), "plan_id": str(plan.id)}, organization_id=user.organization_id, child_id=plan.child_id)
    return plan


@api.delete("/therapy-plans/{plan_id}", status_code=204)
async def deactivate_plan(plan_id: UUID, user: User = Depends(require_roles(Role.therapist))) -> None:
    plan = next((item for item in repository.plans() if item.id == plan_id and item.therapist_id == user.id), None)
    if not plan:
        raise HTTPException(404, "Plan not found")
    child_for_user(plan.child_id, user)
    repository.deactivate_plan(plan.id)
    log(user, "Deactivated therapy plan", "therapy_plan", plan.id)
    await realtime.broadcast("therapy_plan_changed", {"child_id": str(plan.child_id), "plan_id": str(plan.id), "active": False}, organization_id=user.organization_id, child_id=plan.child_id)


@api.delete("/children/{child_id}", status_code=204)
async def deactivate_child(child_id: UUID, user: User = Depends(require_roles(Role.therapist))) -> None:
    child = child_for_user(child_id, user)
    child.active = False
    repository.update_child(child)
    log(user, "Deactivated child profile", "child", child.id)
    await realtime.broadcast("child_changed", {"child_id": str(child.id), "active": False}, organization_id=user.organization_id, child_id=child.id)


@api.get("/therapy-plans")
def list_plans(user: User = Depends(require_roles(Role.therapist, Role.admin))) -> list[TherapyPlan]:
    if user.role == Role.admin:
        organization_child_ids = {child.id for child in repository.children() if child.organization_id == user.organization_id}
        return [plan for plan in repository.plans() if plan.child_id in organization_child_ids]
    return [plan for plan in repository.plans() if plan.therapist_id == user.id]


@api.post("/sessions", response_model=Session)
async def create_session(child_id: UUID, user: User = Depends(require_roles(Role.child, Role.caregiver))) -> Session:
    child_for_user(child_id, user)
    session = Session(child_id=child_id)
    repository.add_session(session)
    log(user, "Started practice session", "session", session.id)
    await realtime.broadcast("session_changed", {"child_id": str(session.child_id), "session_id": str(session.id)}, organization_id=user.organization_id, child_id=session.child_id)
    return session


@api.get("/children/{child_id}/sessions", response_model=list[Session])
def list_sessions(child_id: UUID, user: User = Depends(current_user)) -> list[Session]:
    child_for_user(child_id, user)
    return sorted((item for item in repository.sessions() if item.child_id == child_id), key=lambda item: item.started_at)


@api.post("/sessions/{session_id}/complete", response_model=Session)
async def complete_session(session_id: UUID, user: User = Depends(require_roles(Role.child, Role.caregiver))) -> Session:
    session = next((item for item in repository.sessions() if item.id == session_id), None)
    if not session:
        raise HTTPException(404, "Practice session not found")
    child = child_for_user(session.child_id, user)
    if session.completed_at is not None:
        return session
    plan = active_plan_for(child.id)
    required = {(target.sound.strip(), target.position.strip().casefold(), word.strip().casefold())
                for target in plan.targets for word in target.words}
    completed = {(a.target_sound.strip(), a.word_position.strip().casefold(), a.word.strip().casefold())
                 for a in repository.attempts()
                 if a.session_id == session.id and a.scoring_status == "complete" and a.score is not None}
    missing = sorted(required - completed)
    if missing:
        preview = [f"{word} ({sound}, {position.title()})" for sound, position, word in missing[:8]]
        suffix = "" if len(missing) <= 8 else f" and {len(missing) - 8} more"
        raise HTTPException(409, f"Session is incomplete. Score every assigned word before completing: {', '.join(preview)}{suffix}")
    session.completed_at = datetime.now(timezone.utc)
    repository.update_session(session)
    log(user, "Completed practice session", "session", session.id)
    await realtime.broadcast("session_changed", {"child_id": str(session.child_id), "session_id": str(session.id)}, organization_id=user.organization_id, child_id=session.child_id)
    return session


@api.get("/children/{child_id}/attempts")
def attempts(child_id: UUID, user: User = Depends(current_user)) -> list[Attempt]:
    child_for_user(child_id, user)
    return sorted((a for a in repository.attempts() if a.child_id == child_id), key=lambda a: a.created_at)


@api.post("/attempts")
async def create_attempt(payload: AttemptCreate, user: User = Depends(require_roles(Role.child, Role.caregiver))) -> dict:
    child = child_for_user(payload.child_id, user)
    plan = validate_practice_target(child.id, payload.word, payload.target_sound, payload.word_position)
    now = datetime.now(timezone.utc)
    normalized_word = payload.word.casefold()
    session = next((item for item in repository.sessions() if item.id == payload.session_id), None) if payload.session_id else None
    if not settings.demo_mode:
        if not session or session.child_id != child.id:
            raise HTTPException(422, "A valid practice session is required")
        if session.completed_at is not None:
            raise HTTPException(409, "Practice session is already complete")
        if not payload.scoring_token:
            raise HTTPException(422, "A server speech assessment is required")
        try:
            scored = decode_scoring_token(payload.scoring_token)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if any(str(scored.get(key)) != str(value) for key, value in (("child_id", child.id), ("session_id", session.id), ("word", normalized_word), ("target_sound", payload.target_sound.strip()), ("word_position", payload.word_position.strip()))):
            raise HTTPException(422, "Speech assessment does not match this attempt")
        payload.score = float(scored["score"])
        payload.transcription = scored.get("transcription")
        payload.transcription_status = "complete"
        payload.scoring_status = "complete"
        payload.transcription = scored.get("transcription")
    session_id = session.id if session else (payload.session_id or uuid4())
    duplicate_window = (
        a.child_id == child.id
        and a.word.casefold() == normalized_word
        and (now - a.created_at).total_seconds() < 10
        and a.session_id == session_id
        for a in repository.attempts()
    )
    if any(duplicate_window):
        raise HTTPException(409, "Duplicate attempt submission")
    if settings.demo_mode and payload.score is not None:
        payload.transcription_status = "mocked"
        payload.scoring_status = "complete"

    attempt = Attempt(
        child_id=child.id,
        session_id=session_id,
        word=payload.word.strip(),
        target_sound=payload.target_sound.strip(),
        word_position=payload.word_position.strip(),
        score=payload.score if payload.score is not None else 0,
        transcription=payload.transcription,
        transcription_status=payload.transcription_status,
        scoring_status=payload.scoring_status,
        duration_ms=payload.duration_ms,
        audio_path=scored.get("audio_path") if not settings.demo_mode else None,
    )
    prior = child.mastery
    child.mastery = update_mastery(prior, attempt.score)
    child.last_practice = attempt.created_at
    child.adherence = adherence_percentage([a for a in repository.attempts() if a.child_id == child.id], plan.cadence_per_week)
    adaptive = select_tier(child.mastery)
    plan.adaptive_recommended_tier = adaptive.recommended_tier
    recent = [a.score for a in repository.attempts() if a.child_id == child.id][-5:]
    snapshot = ProgressSnapshot(
        child_id=child.id,
        mastery=child.mastery,
        average_score=average([a.score for a in repository.attempts() if a.child_id == child.id]),
        recent_average=average(recent),
        current_tier=plan.effective_tier,
        recommended_tier=adaptive.recommended_tier,
    )
    audit = AuditEvent(organization_id=user.organization_id, actor_user_id=user.id, action="Recorded speech attempt", resource_type="attempt", resource_id=attempt.id)
    try:
        repository.persist_attempt_transaction(attempt, child, plan, snapshot, audit)
    except RepositoryUnavailableError as exc:
        cleanup_audio(attempt.audio_path)
        logger.exception("Attempt persistence is unavailable")
        raise HTTPException(503, "Practice data is temporarily unavailable. Please try again.") from exc
    except Exception as exc:
        cleanup_audio(attempt.audio_path)
        logger.exception("Attempt persistence failed")
        raise HTTPException(500, "Unable to save practice data. Please try again.") from exc
    await realtime.broadcast("progress_changed", {"child_id": str(child.id), "attempt_id": str(attempt.id), "mastery": child.mastery, "adherence": child.adherence, "recommended_tier": adaptive.recommended_tier.value}, organization_id=user.organization_id, child_id=child.id)
    return {"attempt": attempt, "mastery": child.mastery, "adherence": child.adherence, "recommendedTier": adaptive.recommended_tier, "effectiveTier": plan.effective_tier, "reason": adaptive.reason}


@api.get("/children/{child_id}/progress/history")
def progress_history(child_id: UUID, user: User = Depends(current_user)) -> list[ProgressSnapshot]:
    child_for_user(child_id, user)
    return sorted((snapshot for snapshot in repository.progress_snapshots() if snapshot.child_id == child_id), key=lambda snapshot: snapshot.created_at)


@api.post("/children/{child_id}/consent", response_model=ConsentRecord, status_code=201)
def record_consent(child_id: UUID, consent_type: str = Form(...), granted: bool = Form(...), user: User = Depends(require_roles(Role.therapist, Role.caregiver))) -> ConsentRecord:
    child = child_for_user(child_id, user)
    consent = ConsentRecord(child_id=child.id, organization_id=user.organization_id, granted_by=user.id, consent_type=consent_type.strip(), granted=granted)
    repository.add_consent(consent)
    log(user, "Recorded child-data consent", "consent", consent.id)
    return consent


@api.get("/children/{child_id}/consent", response_model=list[ConsentRecord])
def get_consent(child_id: UUID, user: User = Depends(require_roles(Role.therapist, Role.caregiver))) -> list[ConsentRecord]:
    child_for_user(child_id, user)
    return [consent for consent in repository.consents() if consent.child_id == child_id]


@api.get("/children/{child_id}/progress")
def progress(child_id: UUID, user: User = Depends(current_user)) -> Progress:
    child = child_for_user(child_id, user)
    attempts_for_child = sorted(
        (a for a in repository.attempts() if a.child_id == child_id),
        key=lambda attempt: attempt.created_at,
    )
    scores = [a.score for a in attempts_for_child]
    recent = scores[-5:]
    plan = next((p for p in repository.plans() if p.child_id == child_id and p.active), None)
    recommendation = select_tier(child.mastery)
    current = plan.effective_tier if plan else recommendation.recommended_tier
    return Progress(
        child_id=child.id,
        attempt_count=len(scores),
        average_score=average(scores),
        recent_average=average(recent),
        mastery=child.mastery,
        adherence=adherence_percentage(attempts_for_child, plan.cadence_per_week) if plan else child.adherence,
        last_attempt=attempts_for_child[-1].created_at if attempts_for_child else None,
        current_tier=current,
        recommended_tier=recommendation.recommended_tier,
    )


@api.get("/children/{child_id}/data-export")
def export_child_data(child_id: UUID, user: User = Depends(current_user)) -> dict:
    child = child_for_user(child_id, user)
    return {
        "child": child,
        "plans": [plan for plan in repository.plans() if plan.child_id == child_id],
        "sessions": [session for session in repository.sessions() if session.child_id == child_id],
        "attempts": [{**attempt.model_dump(mode="json"), "audio_path": None} for attempt in repository.attempts() if attempt.child_id == child_id],
        "progress": [snapshot for snapshot in repository.progress_snapshots() if snapshot.child_id == child_id],
        "messages": [message for message in repository.messages() if message.child_id == child_id and (message.sender_user_id == user.id or message.recipient_user_id == user.id)],
        "notes": [note for note in repository.notes() if note.child_id == child_id] if user.role == Role.therapist else [],
    }


@api.get("/audit-events", response_model=list[AuditEvent])
def audit_events(user: User = Depends(require_roles(Role.admin))) -> list[AuditEvent]:
    return [event for event in repository.audits() if event.organization_id == user.organization_id]


@api.get("/review-queue")
def review_queue(user: User = Depends(require_roles(Role.therapist, Role.admin))) -> list[dict]:
    result: list[dict] = []
    for child in repository.children():
        if child.organization_id != user.organization_id or (user.role != Role.admin and child.therapist_id != user.id):
            continue
        priority = review_priority(child, repository.attempts())
        plan = next((p for p in repository.plans() if p.child_id == child.id and p.active), None)
        upcoming = bool(plan and plan.review_date <= date.today() + timedelta(days=3))
        if priority or upcoming:
            result.append({"child": child, "priority": priority or "upcoming", "reviewDate": plan.review_date if plan else None})
    return result


@api.post("/notes")
async def create_note(payload: NoteCreate, user: User = Depends(require_roles(Role.therapist))) -> Note:
    child_for_user(payload.child_id, user)
    note = Note(child_id=payload.child_id, therapist_id=user.id, note=payload.note.strip())
    repository.add_note(note)
    log(user, "Added therapist note", "note", note.id)
    await realtime.broadcast("note_changed", {"child_id": str(note.child_id), "note_id": str(note.id)}, organization_id=user.organization_id, child_id=note.child_id)
    return note


@api.get("/notes/{child_id}")
def get_notes(child_id: UUID, user: User = Depends(require_roles(Role.therapist))) -> list[Note]:
    child_for_user(child_id, user)
    return [n for n in repository.notes() if n.child_id == child_id]


@api.patch("/notes/{note_id}", response_model=Note)
async def update_note(note_id: UUID, payload: NoteUpdate, user: User = Depends(require_roles(Role.therapist))) -> Note:
    note = next((item for item in repository.notes() if item.id == note_id), None)
    if not note:
        raise HTTPException(404, "Note not found")
    child_for_user(note.child_id, user)
    note.note = payload.note.strip()
    note.updated_at = datetime.now(timezone.utc)
    repository.update_note(note)
    log(user, "Updated therapist note", "note", note.id)
    await realtime.broadcast("note_changed", {"child_id": str(note.child_id), "note_id": str(note.id)}, organization_id=user.organization_id, child_id=note.child_id)
    return note


@api.delete("/notes/{note_id}", status_code=204)
async def delete_note(note_id: UUID, user: User = Depends(require_roles(Role.therapist))) -> None:
    note = next((item for item in repository.notes() if item.id == note_id), None)
    if not note:
        raise HTTPException(404, "Note not found")
    child_for_user(note.child_id, user)
    repository.delete_note(note.id)
    log(user, "Deleted therapist note", "note", note.id)
    await realtime.broadcast("note_changed", {"child_id": str(note.child_id), "note_id": str(note.id), "deleted": True}, organization_id=user.organization_id, child_id=note.child_id)


@api.get("/tongue-placement-guidance", response_model=list[TonguePlacement])
def tongue_placement_guidance(target_sound: str | None = None, user: User = Depends(current_user)) -> list[TonguePlacement]:
    guidance = repository.tongue_placements()
    return [item for item in guidance if not target_sound or item.target_sound.casefold() == target_sound.strip().casefold()]


@api.post("/tongue-placement-guidance", response_model=TonguePlacement, status_code=201)
async def create_tongue_placement(payload: TonguePlacementUpdate, user: User = Depends(require_roles(Role.therapist))) -> TonguePlacement:
    placement = TonguePlacement(**payload.model_dump())
    repository.add_tongue_placement(placement)
    log(user, "Created tongue placement guidance", "tongue_placement", placement.id)
    await realtime.broadcast("guidance_changed", {"guidance_id": str(placement.id), "target_sound": placement.target_sound}, organization_id=user.organization_id)
    return placement


@api.patch("/tongue-placement-guidance/{guidance_id}", response_model=TonguePlacement)
async def update_tongue_placement(guidance_id: UUID, payload: TonguePlacementUpdate, user: User = Depends(require_roles(Role.therapist))) -> TonguePlacement:
    placement = next((item for item in repository.tongue_placements() if item.id == guidance_id), None)
    if not placement:
        raise HTTPException(404, "Tongue placement guidance not found")
    updated = TonguePlacement(id=guidance_id, **payload.model_dump())
    repository.update_tongue_placement(updated)
    log(user, "Updated tongue placement guidance", "tongue_placement", guidance_id)
    await realtime.broadcast("guidance_changed", {"guidance_id": str(guidance_id), "target_sound": updated.target_sound}, organization_id=user.organization_id)
    return updated


@api.post("/messages")
async def create_message(payload: MessageCreate, user: User = Depends(current_user)) -> Message:
    child = child_for_user(payload.child_id, user)
    recipient = next((item for item in repository.users() if item.id == payload.recipient_user_id), None)
    if not recipient or recipient.organization_id != user.organization_id:
        raise HTTPException(404, "Recipient not found")
    allowed_recipient_ids = {child.therapist_id, *child.caregiver_ids}
    if payload.recipient_user_id not in allowed_recipient_ids:
        raise HTTPException(403, "Recipient is not part of this child's care circle")
    if recipient.id == user.id:
        raise HTTPException(400, "Cannot send a message to yourself")
    message = Message(child_id=child.id, sender_user_id=user.id, recipient_user_id=recipient.id, body=payload.body.strip())
    repository.add_message(message)
    log(user, "Sent care-team message", "message", message.id)
    await realtime.broadcast("message_created", {"child_id": str(message.child_id), "message_id": str(message.id), "recipient_user_id": str(message.recipient_user_id)}, organization_id=user.organization_id, child_id=message.child_id, recipient_user_id=message.recipient_user_id)
    return message


@api.get("/messages/{child_id}")
def get_messages(child_id: UUID, user: User = Depends(current_user)) -> list[Message]:
    child_for_user(child_id, user)
    return sorted((m for m in repository.messages() if m.child_id == child_id and (m.sender_user_id == user.id or m.recipient_user_id == user.id)), key=lambda m: m.created_at)


@api.get("/curriculum")
def get_curriculum(user: User = Depends(current_user)):
    return repository.curriculum()


@api.post("/attempts/score-preview")
async def score_preview(
    child_id: UUID = Form(...),
    session_id: UUID | None = Form(default=None),
    word: str = Form(...),
    target_sound: str = Form("/s/"),
    word_position: str = Form("Initial"),
    audio: UploadFile | None = File(default=None),
    user: User = Depends(require_roles(Role.child, Role.caregiver)),
):
    child_for_user(child_id, user)
    session = next((item for item in repository.sessions() if item.id == session_id and item.child_id == child_id), None) if session_id else None
    if not settings.demo_mode and (not session or session.completed_at is not None):
        raise HTTPException(422, "A valid active practice session is required")
    validate_practice_target(child_id, word, target_sound, word_position)
    if not word or not word.strip():
        raise HTTPException(422, "Word is required")
    if not target_sound or not target_sound.strip():
        raise HTTPException(422, "Target sound is required")
    if audio is None:
        raise HTTPException(400, "Audio recording is required")
    if not audio.content_type or not audio.content_type.lower().startswith(ALLOWED_AUDIO_PREFIXES):
        raise HTTPException(415, "Unsupported audio format")
    audio_bytes = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio recording is too large (maximum 5 MB)")
    stored_name = f"{child_id}/{session.id if session else uuid4()}/{uuid4()}.audio"
    try:
        stored_path = repository.store_audio(stored_name, audio_bytes, audio.content_type or "application/octet-stream")
    except (RepositoryError, RuntimeError) as exc:
        raise HTTPException(503, "Audio storage is unavailable") from exc
    # Production pronunciation scoring is fully local:
    # faster-whisper creates the transcription and the local pronunciation
    # scorer evaluates that transcription. No Azure account or API key is used.
    scorer = MockPronunciationScorer() if settings.demo_mode else LocalPronunciationScorer()
    try:
        if settings.demo_mode:
            transcription = "development transcript"
        else:
            transcription = await whisper_provider.transcribe(audio_bytes)

        result = scorer.score(
            word=word.strip(),
            target_sound=target_sound.strip(),
            audio_bytes=audio_bytes,
            transcription=transcription,
            content_type=audio.content_type,
        )
    except Exception as exc:
        cleanup_audio(stored_path)
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Pronunciation scoring failed for child %s", child_id)
        raise HTTPException(503, "Pronunciation scoring is temporarily unavailable. Please try again.") from exc
    token = create_scoring_token(child_id=child_id, session_id=session.id if session else uuid4(), word=word.strip(), target_sound=target_sound.strip(), score=result.overall_score, transcription=transcription, provider=result.provider, audio_path=stored_path, word_position=word_position.strip())
    return {"overallScore": result.overall_score, "phonemes": result.phonemes, "provider": result.provider, "transcription": transcription, "scoringToken": token, "clinicalStatus": "development/mock" if settings.demo_mode else "development/local"}


@api.get("/attempts/{attempt_id}/audio")
def attempt_audio(attempt_id: UUID, user: User = Depends(current_user)) -> FileResponse:
    attempt = next((item for item in repository.attempts() if item.id == attempt_id), None)
    if not attempt:
        raise HTTPException(404, "Attempt not found")
    child_for_user(attempt.child_id, user)
    if not attempt.audio_path:
        raise HTTPException(404, "Audio is not available")
    signed_url = None
    try:
        signed_url = repository.signed_audio_url(attempt.audio_path)
    except RepositoryUnavailableError as exc:
        logger.exception("Audio signing service is unavailable")
        raise HTTPException(503, "Audio storage is temporarily unavailable") from exc
    except RepositoryError as exc:
        logger.exception("Audio signing failed")
        raise HTTPException(503, "Audio is temporarily unavailable") from exc
    if signed_url:
        return RedirectResponse(signed_url)
    root = Path(settings.audio_storage_path or (Path(__file__).resolve().parents[1] / "data" / "audio")).resolve()
    path = Path(attempt.audio_path).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(404, "Audio is not available")
    return FileResponse(path, media_type="application/octet-stream", filename=f"{attempt_id}.audio")


@api.post("/ai-guidance")
async def ai_guidance(payload: dict, user: User = Depends(require_roles(Role.therapist, Role.caregiver))):
    raw_child_id = payload.get("childId")
    try:
        child_id = UUID(str(raw_child_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "childId is required") from exc
    child = child_for_user(child_id, user)
    plan = active_plan_for(child.id)
    raw_words = payload.get("selectedWords", [])
    allowed_words = {word.strip().casefold() for target in plan.targets for word in target.words}
    words = [
        str(word).strip()[:40]
        for word in raw_words
        if isinstance(word, str) and str(word).strip().casefold() in allowed_words
    ][:8] if isinstance(raw_words, list) else []
    args = {
        "child_name": child.name,
        "target_sound": plan.targets[0].sound,
        "mastery": child.mastery,
        "words": words or plan.targets[0].words[:5],
        "language": str(payload.get("language") or "en").lower(),
        "difficulty": str(payload.get("difficulty") or "steady").lower(),
        "therapy_goal": str(payload.get("therapyGoal") or plan.cue or "keep practice calm and encouraging").strip(),
        "attempt_result": str(payload.get("attemptResult") or "the current attempt").strip(),
    }
    fallback = DeterministicAIProvider()
    if settings.gemini_api_key:
        try:
            return {"guidance": await GeminiAIProvider().guidance(**args), "source": "gemini"}
        except Exception:
            pass
    return {"guidance": await fallback.guidance(**args), "source": "deterministic-fallback"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    ticket = websocket.query_params.get("ticket", "")
    try:
        user_id = decode_realtime_ticket(ticket)
    except ValueError:
        await websocket.close(code=1008)
        return
    user = next((u for u in repository.users() if u.id == user_id), None)
    if not user:
        await websocket.close(code=1008)
        return
    await realtime.connect(websocket, user)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        realtime.disconnect(websocket)
    except Exception:
        realtime.disconnect(websocket)


app.include_router(api)
