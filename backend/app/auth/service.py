"""Auth orchestration: register, password login, Google identity login, refresh.

RBAC/auth-critical — manually reviewed per CODING_GUIDELINES.md §AI Usage.
"""

import logging
import secrets
import uuid

import jwt
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import repository, schemas
from app.auth.google import verify_id_token
from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import (
    AdminAlreadyExistsError,
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    NotFoundError,
    RefreshTokenInvalidError,
    RefreshTokenRevokedError,
)
from app.core.models import User
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger("app.auth")


def _token_pair(user: User) -> schemas.TokenPair:
    return schemas.TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id, user.token_version),
        user=schemas.UserSummary(id=user.id, role=user.role),
    )


async def register(db: AsyncSession, data: schemas.RegisterRequest) -> User:
    # Decision C1 (PROJECT_CONTEXT.md): public self-registration is CANDIDATE-only.
    # ADMIN / PANELIST accounts are provisioned out of band (scripts/seed.py).
    if await repository.get_by_email(db, data.email):
        raise EmailAlreadyRegisteredError()
    try:
        user = await repository.create(
            db,
            email=data.email,
            name=data.name,
            role="CANDIDATE",
            auth_provider="PASSWORD",
            timezone=data.timezone,
            password_hash=hash_password(data.password),
        )
        await db.commit()
    except IntegrityError:  # unique email race
        await db.rollback()
        raise EmailAlreadyRegisteredError() from None
    logger.info("auth.register user_id=%s", user.id)
    return user


async def bootstrap_admin(
    db: AsyncSession, data: schemas.BootstrapAdminRequest, provided_token: str | None
) -> schemas.TokenPair:
    """Create the very first ADMIN through the web. Gated by a shared secret in
    ADMIN_BOOTSTRAP_TOKEN and only while zero ADMIN users exist. When the token
    is not configured OR does not match, the endpoint behaves as if it does not
    exist (404) — no discoverable public admin-registration route.
    """
    configured = settings.admin_bootstrap_token
    if not configured or not provided_token or not secrets.compare_digest(
        provided_token, configured
    ):
        raise NotFoundError()

    if await repository.count_by_role(db, "ADMIN") > 0:
        raise AdminAlreadyExistsError()
    # ponytail: two concurrent bootstrap calls with different emails could both
    # pass this check and create two ADMINs. Acceptable for a one-time cold-start
    # gated by a shared secret + STRICT 10/min rate limit; add a Postgres advisory
    # lock around the check+insert if that ever matters.

    try:
        user = await repository.create(
            db,
            email=data.email,
            name=data.name,
            role="ADMIN",
            auth_provider="PASSWORD",
            timezone=data.timezone,
            password_hash=hash_password(data.password),
        )
        await record_audit(
            db,
            actor_id=user.id,
            actor_role="ADMIN",
            action="ADMIN_BOOTSTRAPPED",
            entity_type="user",
            entity_id=user.id,
            metadata={"email": data.email},
        )
        await db.commit()
    except IntegrityError:  # unique email race / a concurrent bootstrap
        await db.rollback()
        raise EmailAlreadyRegisteredError() from None

    logger.info("auth.bootstrap_admin ok user_id=%s", user.id)
    return _token_pair(user)


async def login(db: AsyncSession, data: schemas.LoginRequest) -> schemas.TokenPair:
    user = await repository.get_by_email(db, data.email)
    # Same error whether the email is unknown or the password is wrong.
    if user is None or user.password_hash is None:
        raise InvalidCredentialsError()
    if not verify_password(data.password, user.password_hash):
        logger.info("auth.login failed email=%s", data.email)
        raise InvalidCredentialsError()
    logger.info("auth.login ok user_id=%s", user.id)
    return _token_pair(user)


async def google_login(db: AsyncSession, data: schemas.GoogleLoginRequest) -> schemas.TokenPair:
    identity = verify_id_token(data.id_token)  # identity scopes only — never Calendar
    user = await repository.get_by_email(db, identity.email)
    if user is None:
        user = await repository.create(
            db,
            email=identity.email,
            name=identity.name,
            role="CANDIDATE",
            auth_provider="GOOGLE",
        )
        await db.commit()
        logger.info("auth.google new user_id=%s", user.id)
    else:
        logger.info("auth.google ok user_id=%s", user.id)
    return _token_pair(user)


async def refresh(db: AsyncSession, data: schemas.RefreshRequest) -> schemas.AccessToken:
    try:
        payload = decode_token(data.refresh_token, "refresh")
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise RefreshTokenInvalidError() from None

    user = await repository.get_by_id(db, user_id)
    if user is None:
        raise RefreshTokenInvalidError()
    if payload.get("token_version") != user.token_version:
        raise RefreshTokenRevokedError()

    return schemas.AccessToken(access_token=create_access_token(user.id, user.role))
