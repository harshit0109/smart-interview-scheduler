"""Interview request HTTP routes. Delegates to service; no business logic here."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.calendar.client import GoogleCalendarClient, get_calendar_client
from app.core.db import get_db
from app.core.deps import CurrentUser, admin_or_owning_candidate, require_role
from app.core.pagination import Page, PageParams, page_params
from app.interviews import lifecycle, schemas, service
from app.notifications.client import SendGridClient, get_sendgrid_client

router = APIRouter(prefix="/interviews", tags=["interviews"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
PageDep = Annotated[PageParams, Depends(page_params)]
CalDep = Annotated[GoogleCalendarClient, Depends(get_calendar_client)]
SendGridDep = Annotated[SendGridClient, Depends(get_sendgrid_client)]


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


# ------------------------------------------- Phase 9 (POST-MVP) lifecycle -------


@router.post(
    "/{request_id}/decline",
    response_model=schemas.LifecycleStatusResponse,
    dependencies=[Depends(require_role("PANELIST"))],
)
async def decline_interview(
    request_id: uuid.UUID,
    data: schemas.LifecycleRequest,
    user: CurrentUser,
    db: DbDep,
    calendar_client: CalDep,
    sendgrid: SendGridDep,
) -> schemas.LifecycleStatusResponse:
    return await lifecycle.decline(
        db, user, request_id, data.reason, calendar_client=calendar_client, sendgrid=sendgrid
    )


@router.post(
    "/{request_id}/reschedule",
    response_model=schemas.LifecycleStatusResponse,
    dependencies=[Depends(admin_or_owning_candidate())],
)
async def reschedule_interview(
    request_id: uuid.UUID,
    data: schemas.LifecycleRequest,
    user: CurrentUser,
    db: DbDep,
    calendar_client: CalDep,
    sendgrid: SendGridDep,
) -> schemas.LifecycleStatusResponse:
    return await lifecycle.reschedule(
        db, user, request_id, data.reason, calendar_client=calendar_client, sendgrid=sendgrid
    )


@router.post(
    "/{request_id}/cancel",
    response_model=schemas.LifecycleStatusResponse,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def cancel_interview(
    request_id: uuid.UUID,
    data: schemas.LifecycleRequest,
    user: CurrentUser,
    db: DbDep,
    calendar_client: CalDep,
    sendgrid: SendGridDep,
) -> schemas.LifecycleStatusResponse:
    return await lifecycle.cancel(
        db, user, request_id, data.reason, calendar_client=calendar_client, sendgrid=sendgrid
    )


@router.get(
    "/{request_id}/audit",
    response_model=Page[schemas.AuditEntryOut],
    dependencies=[Depends(require_role("ADMIN"))],
)
async def get_interview_audit(
    request_id: uuid.UUID, user: CurrentUser, db: DbDep, page: PageDep
) -> Page[schemas.AuditEntryOut]:
    return await lifecycle.get_audit(db, request_id, page)
