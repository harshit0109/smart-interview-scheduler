"""Auth orchestration: register, password login, Google identity login, refresh.

RBAC/auth-critical — manually reviewed per CODING_GUIDELINES.md §AI Usage.
"""

import logging
import uuid

import jwt
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import repository, schemas
from app.auth.google import verify_id_token
from app.core.errors import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
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
