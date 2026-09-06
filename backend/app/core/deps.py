"""Shared FastAPI dependencies: current user + role gate.

Every mutating route in later phases declares `Depends(require_role(...))`.
"""

import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import ForbiddenError, NotAuthenticatedError
from app.core.models import User
from app.core.security import decode_token

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if creds is None:
        raise NotAuthenticatedError()
    try:
        payload = decode_token(creds.credentials, "access")
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise NotAuthenticatedError("Invalid or expired access token.") from None

    user = await db.get(User, user_id)
    if user is None:
        raise NotAuthenticatedError("Invalid or expired access token.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(
    *roles: str,
) -> Callable[[User], Coroutine[Any, Any, User]]:
    allowed = set(roles)

    async def _dep(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise ForbiddenError()
        return user

    return _dep
