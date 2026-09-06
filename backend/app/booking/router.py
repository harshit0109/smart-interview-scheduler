"""Booking route — thin wrapper over the booking service."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import schemas, service
from app.calendar.client import GoogleCalendarClient, get_calendar_client
from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.notifications.client import SendGridClient, get_sendgrid_client

router = APIRouter(prefix="/interviews/{request_id}", tags=["booking"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ClientDep = Annotated[GoogleCalendarClient, Depends(get_calendar_client)]
SendGridDep = Annotated[SendGridClient, Depends(get_sendgrid_client)]


@router.post(
    "/book",
    response_model=schemas.InterviewEventOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def book(
    request_id: uuid.UUID,
    data: schemas.BookRequest,
    user: CurrentUser,
    db: DbDep,
    client: ClientDep,
    sendgrid: SendGridDep,
) -> schemas.InterviewEventOut:
    return await service.book(
        db, user, request_id, data.recommended_slot_id, client, sendgrid
    )
