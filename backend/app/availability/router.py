"""Candidate availability HTTP routes. Nested under an interview request."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.availability import schemas, service
from app.core.db import get_db
from app.core.deps import CurrentUser, require_role

router = APIRouter(prefix="/interviews/{request_id}", tags=["availability"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/candidate-availability",
    response_model=schemas.AvailabilityOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("CANDIDATE"))],
)
async def submit_availability(
    request_id: uuid.UUID,
    data: schemas.SubmitAvailabilityRequest,
    user: CurrentUser,
    db: DbDep,
) -> schemas.AvailabilityOut:
    return await service.submit(db, user, request_id, data)


@router.get("/availability", response_model=schemas.AvailabilityOut)
async def get_availability(
    request_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> schemas.AvailabilityOut:
    return await service.get_availability(db, user, request_id)
