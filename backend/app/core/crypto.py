"""Symmetric encryption for OAuth tokens stored at rest (Fernet / AES-128-CBC + HMAC).

Only `calendar_connections.access_token_encrypted` / `refresh_token_encrypted` use
this today. Ciphertext is what lands in the DB; plaintext never leaves this module
except to the outbound Google client.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_DEV_SENTINEL = "dev"


class TokenCryptoError(RuntimeError):
    """Misconfiguration or a corrupt/undecryptable ciphertext."""


def _key() -> bytes:
    configured = settings.calendar_token_encryption_key
    if configured and configured != _DEV_SENTINEL:
        return configured.encode()
    if settings.environment == "production":
        raise TokenCryptoError(
            "CALENDAR_TOKEN_ENCRYPTION_KEY must be set to a real Fernet key in production"
        )
    # Deterministic, obviously-not-secret key for local dev and tests only.
    return base64.urlsafe_b64encode(hashlib.sha256(b"sis-dev-calendar-token-key").digest())


def _fernet() -> Fernet:
    try:
        return Fernet(_key())
    except (ValueError, TypeError) as exc:
        raise TokenCryptoError("CALENDAR_TOKEN_ENCRYPTION_KEY is not a valid Fernet key") from exc


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise TokenCryptoError("could not decrypt stored token") from exc
