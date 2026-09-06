"""Auth HTTP routes. No business logic here — everything delegates to service."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import schemas, service
from app.core.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/register",
    response_model=schemas.RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(data: schemas.RegisterRequest, db: DbDep) -> schemas.RegisterResponse:
    user = await service.register(db, data)
    return schemas.RegisterResponse(id=user.id, email=user.email, name=user.name, role=user.role)


@router.post("/login", response_model=schemas.TokenPair)
async def login(data: schemas.LoginRequest, db: DbDep) -> schemas.TokenPair:
    return await service.login(db, data)


@router.post("/google", response_model=schemas.TokenPair)
async def google_login(data: schemas.GoogleLoginRequest, db: DbDep) -> schemas.TokenPair:
    return await service.google_login(db, data)


@router.post("/refresh", response_model=schemas.AccessToken)
async def refresh(data: schemas.RefreshRequest, db: DbDep) -> schemas.AccessToken:
    return await service.refresh(db, data)
