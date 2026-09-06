"""User self-service routes."""

import uuid

from fastapi import APIRouter
from pydantic import BaseModel, EmailStr

from app.core.deps import CurrentUser

router = APIRouter(prefix="/users", tags=["users"])


class MeResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    role: str
    timezone: str


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse(
        id=user.id, email=user.email, name=user.name, role=user.role, timezone=user.timezone
    )
