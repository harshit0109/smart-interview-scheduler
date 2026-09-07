"""User self-service + ADMIN directory routes."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.models import User
from app.core.validators import valid_iana_timezone
from app.users import service

router = APIRouter(prefix="/users", tags=["users"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminDep = Annotated[User, Depends(require_role("ADMIN"))]


class MeResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    role: str
    timezone: str


class ProvisionUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=255)
    # ADMIN is deliberately not accepted — no ADMIN creation through this endpoint.
    role: Literal["CANDIDATE", "PANELIST"]
    timezone: str = "UTC"

    @field_validator("timezone")
    @classmethod
    def _valid_timezone(cls, v: str) -> str:
        return valid_iana_timezone(v)


class ProvisionedUser(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    role: str
    timezone: str
    created: bool


class DirectoryUser(BaseModel):
    id: uuid.UUID
    name: str
    email: EmailStr
    timezone: str
    role: str


@router.post("", response_model=ProvisionedUser, status_code=status.HTTP_201_CREATED)
async def provision_user(
    data: ProvisionUserRequest, db: DbDep, admin: AdminDep
) -> ProvisionedUser:
    """ADMIN provisions an unclaimed CANDIDATE/PANELIST account (no password) so it
    can be named on an interview before that person has signed up. Idempotent for
    a matching (email, role); a role mismatch is 422 ROLE_CONFLICT."""
    user, created = await service.provision(
        db,
        actor_id=admin.id,
        email=data.email,
        name=data.name,
        role=data.role,
        timezone=data.timezone,
    )
    return ProvisionedUser(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        timezone=user.timezone,
        created=created,
    )


@router.post(
    "/{user_id}/archive",
    response_model=DirectoryUser,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def archive_user(user_id: uuid.UUID, db: DbDep, admin: AdminDep) -> "DirectoryUser":
    """Remove a CANDIDATE from the active pipeline (reversible — history kept)."""
    u = await service.set_archived(db, actor_id=admin.id, user_id=user_id, archived=True)
    return DirectoryUser(id=u.id, name=u.name, email=u.email, timezone=u.timezone, role=u.role)


@router.post(
    "/{user_id}/unarchive",
    response_model=DirectoryUser,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def unarchive_user(user_id: uuid.UUID, db: DbDep, admin: AdminDep) -> "DirectoryUser":
    u = await service.set_archived(db, actor_id=admin.id, user_id=user_id, archived=False)
    return DirectoryUser(id=u.id, name=u.name, email=u.email, timezone=u.timezone, role=u.role)


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
