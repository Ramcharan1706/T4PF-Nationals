from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status

from app.config import settings
from app.local_auth import decode_access_token
from app.models import Role, User
from app.repository import repository


async def current_user(authorization: str | None = Header(default=None), x_demo_role: str | None = Header(default=None)) -> User:
    # Test-only compatibility: automated tests may opt into the in-memory fixture.
    if settings.demo_mode and not authorization:
        role = Role(x_demo_role) if x_demo_role in {r.value for r in Role} else Role.therapist
        matches = [u for u in repository.users() if u.role == role]
        if not matches:
            raise HTTPException(status_code=404, detail="Test fixture user unavailable")
        return matches[0]
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")
    try:
        user_id = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc
    user = next((u for u in repository.users() if u.id == user_id), None)
    if not user:
        raise HTTPException(status_code=403, detail="Authenticated user is not provisioned")
    return user


def require_roles(*roles: Role):
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role permissions")
        return user
    return dependency
