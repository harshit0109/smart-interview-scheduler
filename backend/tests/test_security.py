"""Unit tests for password hashing and JWT helpers (no DB, no app)."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core import security
from app.core.config import settings


def test_password_hash_roundtrip():
    h = security.hash_password("s3cret-pw")
    assert h != "s3cret-pw"
    assert security.verify_password("s3cret-pw", h)
    assert not security.verify_password("wrong", h)


def test_verify_password_rejects_garbage_hash():
    assert security.verify_password("anything", "not-a-bcrypt-hash") is False


def test_access_token_roundtrip():
    uid = uuid.uuid4()
    token = security.create_access_token(uid, "ADMIN")
    payload = security.decode_token(token, "access")
    assert payload["sub"] == str(uid)
    assert payload["role"] == "ADMIN"
    assert payload["type"] == "access"


def test_refresh_token_carries_version():
    uid = uuid.uuid4()
    payload = security.decode_token(security.create_refresh_token(uid, 7), "refresh")
    assert payload["token_version"] == 7


def test_decode_rejects_wrong_type():
    token = security.create_access_token(uuid.uuid4(), "CANDIDATE")
    with pytest.raises(jwt.InvalidTokenError):
        security.decode_token(token, "refresh")


def test_decode_rejects_expired():
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": "x", "type": "access", "iat": now - timedelta(hours=2),
         "exp": now - timedelta(hours=1)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        security.decode_token(token, "access")
