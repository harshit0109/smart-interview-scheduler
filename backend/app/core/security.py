"""Password hashing (bcrypt) and JWT issue/verify.

Manually written and line-by-line reviewable per CODING_GUIDELINES.md
§AI Usage Transparency — this is auth-critical code.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import bcrypt
import jwt

from app.core.config import settings

TokenType = Literal["access", "refresh", "calendar_state"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _encode(sub: str, token_type: TokenType, expires_delta: timedelta, **extra: object) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": sub,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        **extra,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    return _encode(
        str(user_id),
        "access",
        timedelta(minutes=settings.jwt_access_token_expire_minutes),
        role=role,
    )


def create_refresh_token(user_id: uuid.UUID, token_version: int) -> str:
    return _encode(
        str(user_id),
        "refresh",
        timedelta(days=settings.jwt_refresh_token_expire_days),
        token_version=token_version,
    )


def create_calendar_state_token(user_id: uuid.UUID, ttl_seconds: int) -> str:
    """A short-lived signed value for the Calendar OAuth `state` round-trip.

    Distinct `type` claim from access/refresh tokens — `decode_token(..., "access")`
    will reject it and vice versa.
    """
    return _encode(str(user_id), "calendar_state", timedelta(seconds=ttl_seconds))


def decode_token(token: str, expected_type: TokenType) -> dict:
    """Raises jwt.InvalidTokenError (incl. ExpiredSignatureError) on any problem."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"expected {expected_type} token")
    return payload
