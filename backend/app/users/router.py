"""User self-service + ADMIN directory routes."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.users import service

router = APIRouter(prefix="/users", tags=["users"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


class MeResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    role: str
    timezone: str


class DirectoryUser(BaseModel):
    id: uuid.UUID
    name: str
    email: EmailStr
    timezone: str
    role: str


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse(
        id=user.id, email=user.email, name=user.name, role=user.role, timezone=user.timezone
    )


@router.get(
    "",
    response_model=list[DirectoryUser],
    dependencies=[Depends(require_role("ADMIN"))],
)
async def list_users(
    db: DbDep,
    role: Annotated[Literal["CANDIDATE", "PANELIST"], Query()],
) -> list[DirectoryUser]:
    """ADMIN-only directory for building an interview request (FR-012). `role` is
    required and limited to the two roles the create flow picks from."""
    users = await service.list_by_role(db, role)
    return [
        DirectoryUser(
            id=u.id, name=u.name, email=u.email, timezone=u.timezone, role=u.role
        )
        for u in users
    ]
