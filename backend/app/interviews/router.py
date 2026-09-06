"""Interview request HTTP routes. Delegates to service; no business logic here."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.pagination import Page, PageParams, page_params
from app.interviews import schemas, service

router = APIRouter(prefix="/interviews", tags=["interviews"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
PageDep = Annotated[PageParams, Depends(page_params)]


@router.post(
    "",
    response_model=schemas.InterviewRequestOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def create_interview(
    data: schemas.CreateInterviewRequest, user: CurrentUser, db: DbDep
) -> schemas.InterviewRequestOut:
    return await service.create_request(db, user, data)


@router.get("", response_model=Page[schemas.InterviewRequestOut])
async def list_interviews(
    user: CurrentUser,
    db: DbDep,
    page: PageDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[schemas.InterviewRequestOut]:
    return await service.list_requests(db, user, status_filter, page)


@router.get("/{request_id}", response_model=schemas.InterviewRequestOut)
async def get_interview(
    request_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> schemas.InterviewRequestOut:
    return await service.get_request(db, user, request_id)


@router.patch(
    "/{request_id}",
    response_model=schemas.InterviewRequestOut,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def update_interview(
    request_id: uuid.UUID,
    data: schemas.UpdateInterviewRequest,
    user: CurrentUser,
    db: DbDep,
) -> schemas.InterviewRequestOut:
    return await service.update_request(db, user, request_id, data)
