from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.repository import repository
from app.repository import RepositoryError

client = TestClient(app)
MAYA_ID = "55555555-5555-5555-5555-555555555551"
ARJUN_ID = "55555555-5555-5555-5555-555555555552"
THERAPIST_ID = "22222222-2222-2222-2222-222222222222"
OTHER_THERAPIST_ID = "22222222-2222-2222-2222-222222222223"
CAREGIVER_ID = "33333333-3333-3333-3333-333333333331"
OTHER_CAREGIVER_ID = "33333333-3333-3333-3333-333333333332"


def test_child_demo_identity_is_linked_to_maya():
    response = client.get(f"/api/children/{MAYA_ID}", headers={"X-Demo-Role": "child"})
    assert response.status_code == 200
    assert response.json()["name"] == "Maya Chen"


def test_child_cannot_access_another_child():
    response = client.get(f"/api/children/{ARJUN_ID}", headers={"X-Demo-Role": "child"})
    assert response.status_code == 403


def test_score_preview_accepts_uploaded_audio():
    response = client.post(
        "/api/attempts/score-preview?word=sun&target_sound=%2Fs%2F",
        data={"child_id": MAYA_ID, "word": "sun", "target_sound": "/s/"},
        files={"audio": ("sun.webm", b"fake-audio", "audio/webm")},
        headers={"X-Demo-Role": "child"},
    )
    assert response.status_code == 200
    body = response.json()
    assert 0 <= body["overallScore"] <= 100
    assert body["clinicalStatus"] == "development/mock"


def test_message_recipient_must_be_in_child_care_circle():
    bad_recipient = str(repository.users()[1].id)  # another therapist
    response = client.post(
        "/api/messages",
        json={"child_id": MAYA_ID, "recipient_user_id": bad_recipient, "body": "Hello"},
        headers={"X-Demo-Role": "therapist"},
    )
    assert response.status_code == 403


def test_valid_care_team_message_is_recorded():
    response = client.post(
        "/api/messages",
        json={"child_id": MAYA_ID, "recipient_user_id": CAREGIVER_ID, "body": "Keep practice short."},
        headers={"X-Demo-Role": "therapist"},
    )
    assert response.status_code == 200
    assert response.json()["recipient_user_id"] == CAREGIVER_ID


def test_duplicate_attempt_guard_is_scoped_to_session():
    session_id = str(uuid4())
    payload = {
        "child_id": MAYA_ID,
        "session_id": session_id,
        "word": "sun",
        "target_sound": "/s/",
        "score": 70,
    }
    headers = {"X-Demo-Role": "child"}
    first = client.post("/api/attempts", json=payload, headers=headers)
    second = client.post("/api/attempts", json=payload, headers=headers)
    other_session = client.post("/api/attempts", json={**payload, "session_id": str(uuid4())}, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 409
    assert other_session.status_code == 200


def test_attempt_rejects_word_outside_active_plan():
    response = client.post(
        "/api/attempts",
        json={"child_id": MAYA_ID, "word": "not-in-plan", "target_sound": "/s/", "score": 90},
        headers={"X-Demo-Role": "child"},
    )
    assert response.status_code == 422


def test_attempt_rejects_blank_word_or_target_sound():
    blank_word = client.post(
        "/api/attempts",
        json={"child_id": MAYA_ID, "word": "   ", "target_sound": "/s/", "score": 90},
        headers={"X-Demo-Role": "child"},
    )
    blank_sound = client.post(
        "/api/attempts",
        json={"child_id": MAYA_ID, "word": "sun", "target_sound": "   ", "score": 90},
        headers={"X-Demo-Role": "child"},
    )
    assert blank_word.status_code == 422
    assert blank_sound.status_code == 422


def test_score_preview_rejects_oversized_audio():
    response = client.post(
        "/api/attempts/score-preview",
        data={"child_id": MAYA_ID, "word": "sun", "target_sound": "/s/"},
        files={"audio": ("sun.webm", b"x" * (5 * 1024 * 1024 + 1), "audio/webm")},
        headers={"X-Demo-Role": "child"},
    )
    assert response.status_code == 413


def test_ai_guidance_requires_linked_child():
    response = client.post(
        "/api/ai-guidance",
        json={"childId": ARJUN_ID, "selectedWords": ["sun"]},
        headers={"X-Demo-Role": "caregiver"},
    )
    assert response.status_code == 403


def test_session_lifecycle_is_restricted_to_practice_roles():
    therapist = client.post("/api/sessions?child_id=" + MAYA_ID, headers={"X-Demo-Role": "therapist"})
    assert therapist.status_code == 403
    child = client.post("/api/sessions?child_id=" + MAYA_ID, headers={"X-Demo-Role": "child"})
    assert child.status_code == 200
    session_id = child.json()["id"]
    incomplete = client.post(f"/api/sessions/{session_id}/complete", headers={"X-Demo-Role": "child"})
    assert incomplete.status_code == 409

    attempt = client.post("/api/attempts", json={
        "child_id": MAYA_ID, "session_id": session_id, "word": "sun",
        "target_sound": "/s/", "word_position": "Initial", "score": 82,
    }, headers={"X-Demo-Role": "child"})
    assert attempt.status_code == 200

    # All five words in Maya's active plan must be scored before completion.
    for word in ["sock", "soap", "snake", "soup"]:
        response = client.post("/api/attempts", json={
            "child_id": MAYA_ID, "session_id": session_id, "word": word,
            "target_sound": "/s/", "word_position": "Initial", "score": 80,
        }, headers={"X-Demo-Role": "child"})
        assert response.status_code == 200

    completed = client.post(f"/api/sessions/{session_id}/complete", headers={"X-Demo-Role": "child"})
    assert completed.status_code == 200
    assert completed.json()["completed_at"] is not None


def test_score_preview_rejects_wrong_role():
    response = client.post(
        "/api/attempts/score-preview",
        data={"child_id": MAYA_ID, "word": "sun", "target_sound": "/s/"},
        files={"audio": ("sun.webm", b"audio", "audio/webm")},
        headers={"X-Demo-Role": "therapist"},
    )
    assert response.status_code == 403


def test_user_can_create_account_with_role_and_login():
    payload = {
        "name": "Jamie Miller",
        "email": "jamie@example.test",
        "password": "SecurePass123!",
        "role": "caregiver",
    }
    register_response = client.post("/api/auth/register", json=payload)
    assert register_response.status_code == 201
    body = register_response.json()
    assert body["user"]["email"] == "jamie@example.test"
    assert body["user"]["role"] == "caregiver"

    login_response = client.post("/api/auth/login", json={"email": payload["email"], "password": payload["password"]})
    assert login_response.status_code == 200
    assert login_response.json()["user"]["role"] == "caregiver"


def test_public_registration_cannot_grant_therapist_role():
    response = client.post(
        "/api/auth/register",
        json={"name": "Unapproved Therapist", "email": "unapproved@example.test", "password": "SecurePass123!", "role": "therapist"},
    )
    assert response.status_code == 422


def test_realtime_ticket_requires_authentication():
    from app.config import settings

    previous_demo_mode = settings.demo_mode
    settings.demo_mode = False
    try:
        response = client.post("/api/auth/realtime-ticket")
        assert response.status_code == 401
    finally:
        settings.demo_mode = previous_demo_mode


def test_readiness_checks_the_registration_organization():
    response = client.get("/api/health/ready")
    assert response.status_code == 200
    assert response.json()["realtime"] is True


def test_auth_preflight_allows_configured_frontend_origin():
    response = client.options(
        "/api/auth/register",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_unexpected_registration_repository_failure_is_safe(monkeypatch):
    def fail_create_user(user, password):
        raise RepositoryError("private database details must not reach the client")

    monkeypatch.setattr(repository, "create_user", fail_create_user)
    response = client.post(
        "/api/auth/register",
        json={"name": "Safe Failure", "email": "safe-failure@example.test", "password": "SecurePass123!", "role": "caregiver"},
    )
    assert response.status_code == 500
    assert response.json() == {"detail": "Unable to create account. Please try again."}


def test_profile_route_supports_get_for_logged_in_session():
    token = client.post("/api/auth/login", json={"email": "priya@example.test", "password": "SoundBuddy@2026!"}).json()["access_token"]
    response = client.get("/api/auth/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "priya@example.test"
    assert response.json()["role"] == "therapist"


def test_duplicate_email_cannot_register():
    response = client.post(
        "/api/auth/register",
        json={"name": "Existing User", "email": "alex@example.test", "password": "StrongPass123!", "role": "caregiver"},
    )
    assert response.status_code == 409


def test_therapist_can_create_and_update_child_with_valid_caregiver():
    payload = {"name": "New Learner", "age": 6, "caregiver_ids": [CAREGIVER_ID]}
    created = client.post("/api/children", json=payload, headers={"X-Demo-Role": "therapist"})
    assert created.status_code == 201
    child_id = created.json()["id"]
    assert created.json()["caregiver_ids"] == [CAREGIVER_ID]
    updated = client.patch(f"/api/children/{child_id}", json={**payload, "name": "Updated Learner"}, headers={"X-Demo-Role": "therapist"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated Learner"


def test_child_account_can_login_after_provisioning():
    created = client.post(
        "/api/children",
        json={"name": "Linked Learner", "age": 7, "caregiver_ids": [], "child_username": "linked-child", "child_password": "SecurePass123!"},
        headers={"X-Demo-Role": "therapist"},
    )
    assert created.status_code == 201
    login = client.post("/api/auth/login", json={"username": "linked-child", "password": "SecurePass123!"})
    assert login.status_code == 200
    assert login.json()["user"]["child_id"] == created.json()["id"]


def test_child_crud_rejects_invalid_caregiver_and_non_therapist():
    invalid = client.post("/api/children", json={"name": "Invalid Learner", "age": 6, "caregiver_ids": [THERAPIST_ID]}, headers={"X-Demo-Role": "therapist"})
    assert invalid.status_code == 422
    forbidden = client.post("/api/children", json={"name": "Nope", "age": 8, "caregiver_ids": []}, headers={"X-Demo-Role": "caregiver"})
    assert forbidden.status_code == 403


def test_tongue_placement_guidance_is_structured_and_filterable():
    response = client.get("/api/tongue-placement-guidance?target_sound=%2Fs%2F", headers={"X-Demo-Role": "child"})
    assert response.status_code == 200
    assert response.json()[0]["target_sound"] == "/s/"
    assert response.json()[0]["tongue_position"]


def test_therapist_can_update_and_delete_owned_note():
    created = client.post("/api/notes", json={"child_id": MAYA_ID, "note": "Temporary note"}, headers={"X-Demo-Role": "therapist"})
    assert created.status_code == 200
    note_id = created.json()["id"]
    updated = client.patch(f"/api/notes/{note_id}", json={"note": "Updated note"}, headers={"X-Demo-Role": "therapist"})
    assert updated.status_code == 200
    assert updated.json()["note"] == "Updated note"
    deleted = client.delete(f"/api/notes/{note_id}", headers={"X-Demo-Role": "therapist"})
    assert deleted.status_code == 204


def test_therapist_and_caregiver_directories_are_scoped_to_org_and_role():
    therapists = client.get("/api/therapists", headers={"X-Demo-Role": "therapist"})
    assert therapists.status_code == 200
    assert all(item["role"] == "therapist" for item in therapists.json())
    assert any(item["id"] == OTHER_THERAPIST_ID for item in therapists.json())

    caregivers = client.get("/api/caregivers", headers={"X-Demo-Role": "therapist"})
    assert caregivers.status_code == 200
    assert all(item["role"] == "caregiver" for item in caregivers.json())

    forbidden = client.get("/api/therapists", headers={"X-Demo-Role": "caregiver"})
    assert forbidden.status_code == 403


def test_therapist_can_transfer_child_to_another_therapist_and_loses_access():
    transferred = client.post(
        f"/api/children/{MAYA_ID}/transfer-therapist",
        json={"therapist_id": OTHER_THERAPIST_ID},
        headers={"X-Demo-Role": "therapist"},
    )
    assert transferred.status_code == 200
    assert transferred.json()["therapist_id"] == OTHER_THERAPIST_ID

    try:
        lost_access = client.get(f"/api/children/{MAYA_ID}", headers={"X-Demo-Role": "therapist"})
        assert lost_access.status_code == 403
    finally:
        # Restore original ownership so other tests relying on Maya's fixtures are unaffected.
        maya = next(item for item in repository.children() if str(item.id) == MAYA_ID)
        maya.therapist_id = UUID(THERAPIST_ID)
        repository.update_child(maya)


def test_transfer_rejects_non_therapist_target_and_unowned_child():
    invalid_target = client.post(
        f"/api/children/{MAYA_ID}/transfer-therapist",
        json={"therapist_id": OTHER_CAREGIVER_ID},
        headers={"X-Demo-Role": "therapist"},
    )
    assert invalid_target.status_code == 422

    sara_kim_id = "55555555-5555-5555-5555-555555555553"
    not_owned = client.post(
        f"/api/children/{sara_kim_id}/transfer-therapist",
        json={"therapist_id": OTHER_THERAPIST_ID},
        headers={"X-Demo-Role": "therapist"},
    )
    assert not_owned.status_code == 403
